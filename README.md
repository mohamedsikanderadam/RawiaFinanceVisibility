# RAWIA CAFE – Financial Controller

A web app for RAWIA CAFE's end-of-day finance:

**Upload daily sales → match menu items → expand recipes into ingredient and packaging consumption → assign replenishment amounts → show financial performance and cash allocation.**

It uses the real costing workbook (`rawia cafe OPS (4).xlsx`) and the POS "Order History" export. Data is stored in PostgreSQL. Access requires a login, and each role has its own permissions. Finalized days are stored as immutable snapshots with revision history.

- Next.js 16 (App Router, server actions), React 19 and Tailwind 4
- PostgreSQL with Drizzle ORM (migrations in `drizzle/`)
- Decimal.js for all money arithmetic. Values keep full precision; they are only rounded to 2 dp for display.
- PDFKit for the PDFs, ExcelJS for the Excel files and Recharts for the charts
- AED currency. Business dates are in Asia/Dubai.

---

## 1. Setup

### Requirements

- Node.js 20+ (developed on Node 24)
- PostgreSQL 14+

### Database

```bash
sudo -u postgres psql <<'SQL'
CREATE ROLE rawia LOGIN PASSWORD 'choose-a-password';
CREATE DATABASE rawia_finance OWNER rawia;
CREATE DATABASE rawia_finance_test OWNER rawia;   -- only needed to run the integration tests
SQL
```

### Configuration

```bash
cp .env.example .env
```

Then fill in:

| Variable | Purpose |
|---|---|
| `DATABASE_URL` | App database, e.g. `postgres://rawia:…@localhost:5432/rawia_finance` |
| `TEST_DATABASE_URL` | Separate database for the integration tests. **It is wiped on every test run.** If it is unset, the DB tests are skipped. |
| `SESSION_SECRET` | Random string of 32+ characters (`openssl rand -hex 32`) used to sign session cookies |
| `SEED_OWNER_EMAIL` / `SEED_OWNER_NAME` / `SEED_OWNER_PASSWORD` | The first owner account. It is created only if there are no users yet. The password needs 10+ characters. |
| `SEED_WORKBOOK` | Optional. Costing workbook to import and activate on the first seed. |

### Install, migrate, seed, run

```bash
npm ci
npm run db:setup        # = db:migrate (drizzle migrations) + db:seed (owner + workbook)
npm run dev             # http://localhost:3000
# production
npm run build && npm start
```

Sign in with the seeded owner account. Then create manager, staff and viewer accounts under **Users**.

### Checks

```bash
npm run lint
npm run typecheck
npm test                # engine unit tests + PostgreSQL integration tests (needs TEST_DATABASE_URL)
npm run build
```

### Sample report

```bash
npm run sample-report   # imports tests/fixtures/order-history-2026-09-14.csv (deduplicated) and writes docs/sample/
```

The command writes:

- `docs/sample/RAWIA_End_of_Day_2026-09-14.pdf`: the daily EOD report.
- `docs/sample/RAWIA_Daily_Breakdown_2026-09-14.xlsx`: the full Excel breakdown, with lineage for every consumption record.

---

## 2. Daily workflow

1. **Upload sales** (`/upload`). Pick the business date, then choose whether to import only that date or every date in the file. Upload the POS CSV or XLSX.
2. **Preview.** The preview shows the detected dates, orders, items, quantities, payment methods, discounts, refunds and channels. Each order is classified as:
   - `new`;
   - `duplicate` (already imported, so it is skipped);
   - `changed` (the same order ID with different values; you choose to keep or replace it);
   - `possible duplicate` (no order ID and a matching fingerprint; you decide);
   - `out of scope`;
   - `repeated in file`.
3. **Review items.** Map unmatched POS names to workbook items (`/mappings`). Mappings are saved and reused for later uploads. Missing costs and missing recipes are listed for review.
4. **Confirm the import.** Only new orders, and changed orders you chose to replace, are written. Re-uploading or uploading overlapping files never double-counts.
5. **Daily page** (`/day/YYYY-MM-DD`). Here you can:
   - add staff meals, complimentary items, wastage and manual adjustments;
   - set the Cane Karak batch count, including 0 for "not prepared today";
   - mark refunds and voids as prepared/not prepared and stock recoverable/not recoverable.
6. **Finalize.** Finalizing stores an immutable snapshot of the day, including the costing version used. Later corrections show as a difference against the live recalculation. They only take effect when you finalize a new **revision**, which requires a reason. Earlier revisions stay viewable and exportable.
7. **Dashboard / Reports / Reserve.**
   - Dashboard: today, yesterday, week, month or a custom range.
   - PDF and Excel exports.
   - Reserve & ledger: record allocations, purchases, settlements and balances.

### Roles

| Role | Can |
|---|---|
| owner | Everything, including costing imports, settings, users and full backup |
| manager | View finance, upload, adjust, map, finalize, ledger |
| staff | Upload sales, add adjustments, view the daily operational page. Cannot see financial figures. |
| viewer | Read-only access to the finance figures and reports |

Every server action and export route checks the session and permission on the server.

---

## 3. Costing workbook import

`/costing` imports the workbook and creates a new **costing version**. The import stores:

- the parsed snapshot;
- the file hash;
- every issue it found.

Activate a version from a chosen date. Days that are already finalized keep the version they were finalized with.

What the importer reads (see `src/lib/costing/workbook.ts`):

| Sheet | Used for |
|---|---|
| `Ingredient Master` | Ingredients: purchase price, purchase quantity and unit, and recipe-unit cost. kg is converted to g, L to ml, and packs to pieces. Yield or wastage is applied only when the sheet documents it, and only once. |
| `Packaging List Price` | Packaging items, prices (VAT-inclusive as in the workbook) and the per-item packaging set |
| `Recipe -  BOM` | Recipes per menu item and sub-recipe (sauces, Karak batch), including sub-recipe expansion |
| `Menu Master(Packaging Included)` / `Menu Master` | Menu items, Item IDs, selling prices, workbook food/packaging costs used for reconciliation, and combos |
| `Aggregator- Menu Item` | Delivery-app prices and commission rates (imported as *unconfirmed* settings) |
| `Fixed Costs` | Monthly fixed expenses (become effective-dated settings) |

Items are matched by stable Item ID first. If there is no ID, the importer uses a saved POS-name mapping, then the exact name.

The importer never fills gaps in the data. The following are all recorded as costing issues:

- a menu item with only a total workbook cost is shown with that cost, but its ingredient allocation is marked **unavailable** (`unallocated`);
- missing prices;
- invalid quantities;
- missing recipes;
- inconsistent units;
- formula errors (for example `#VALUE!`);
- formulas that point to the wrong BOM rows.

Issues are shown on the costing version page. An owner can add a costing **override**, such as a confirmed price or a confirmed zero cost for water. The override is stored in addition to the source snapshot and does not change it.

Workbook problems found in `rawia cafe OPS (4).xlsx` and flagged (not fixed) by the app:

- 3 milk-mixer formulas reference the wrong BOM rows.
- Condensed milk is priced per can but used in ml.
- Lemon Syrup has no price.
- Water and ice have no cost.
- Several recipes are missing: Matcha drinks, Moroccan Mint Tea, and the Lemon Iced Tea tea bag.
- The `Menu Master` formula error at G65/J65 is preserved.

---

## 4. Calculation definitions

Every metric in the app, the PDF and the Excel file comes from the same engine (`src/lib/engine/compute.ts` for each day, `src/lib/engine/aggregate.ts` for ranges). Every metric carries a **status**:

- `confirmed`: from the POS or the ledger;
- `calculated`;
- `estimate`: uses unconfirmed settings;
- `incomplete`: some inputs, usually costs, are missing, so the true value is higher or lower;
- `unavailable`: cannot be computed from the data.

Missing costs are never treated as zero.

### Consumption and replenishment

For each fulfilled line:

```
ingredient consumption            = quantity served × recipe quantity per serving
ingredient replenishment reserve  = consumption × effective recipe-unit cost
```

- **Packaging** is added once per item served, following the item's packaging set. A combo uses the combo's packaging, not its components' packaging.
- **Combos** expand into their component recipes, and each component is counted once.
- **Modifiers and substitutions** are applied where the POS line carries them and they map to workbook items.
- **Staff meals and complimentary items** consume stock at zero revenue.
- **Discounts** change revenue only. They never change consumption.
- **Refunds** keep their consumption by default (prepared, not recoverable). Marking a refund *not prepared* or *stock recovered* removes the consumption.
- **Voids and cancellations** consume nothing by default (not prepared). Marking one *prepared* adds its consumption as wastage.
- **Cane Karak.** One prepared batch is charged at **AED 23** (a setting), however many cups are sold. There is no per-cup recipe cost; per-cup packaging is still charged. The workbook's batch recipe costs AED 19.43, and those ingredients are allocated. The AED 3.57 difference is shown as an *unallocated batch reserve*. You can change the batch count per day, and 0 means "not prepared today".

The replenishment table aggregates records by ingredient or packaging item. Each row shows quantity, unit, unit cost, amount, and the split between sold, staff, complimentary, wastage and batch use. Every row drills down to the orders and menu items that consumed it (`/drill/item`).

> **Consumption-based replenishment reserve ≠ recommended purchase quantity.** The reserve is the money needed to replace what was used. Knowing how many packs to buy also needs stock balances, pack sizes and target stock levels. The app does not know these, so it never presents consumption as a purchase order or a stock balance.

### Financial metrics

| Metric | Definition | Calculation |
|---|---|---|
| Sales before discounts | Menu value of all closed orders, including staff and complimentary orders, VAT-inclusive | Σ Total Sales (paid + refunded; voided/open excluded) |
| Discounts | All discounts, including 100% staff and complimentary discounts | Σ (Total Sales − Sales After Discount) |
| Refunds | Refunded to customers per the POS | Σ Refunded |
| Net sales incl. VAT | What customers paid | Sales before discounts − Discounts − Refunds |
| VAT | Output VAT as recorded by the POS (VAT/subtotal columns). It stays an *estimate* until VAT treatment is confirmed in Settings, and is *unavailable* when the file has no VAT columns. | Net sales incl. VAT − Net sales ex VAT |
| Net sales (ex VAT) | Revenue earned by the café | Σ Subtotal After Discount × (1 − Refunded ÷ Sales After Discount) |
| Ingredient cost – sold items | Recipe ingredients of paid customer orders | Σ qty × recipe qty × unit cost |
| Packaging cost – sold items | Packaging of paid customer orders, once per item | Σ qty × packaging qty × unit price |
| Cost of goods sold | Sold-item ingredients + packaging | Ingredient cost + Packaging cost |
| Daily batch cost (Cane Karak) | Fixed price per prepared batch | Batches × batch price |
| Gross profit from sales | Net sales less what was sold | Net sales ex VAT − COGS − Batch cost |
| Staff meal consumption | Stock used by staff meals (zero revenue) | Σ recipe cost of staff lines |
| Complimentary consumption | Stock used by complimentary orders | Σ recipe cost of complimentary lines |
| Wastage & prepared refunds/voids | Recorded wastage + prepared orders that were refunded or voided | Σ recipe cost |
| Manual reserve adjustments | Owner-entered consumption amounts | Σ manual amounts |
| Channel commissions | Delivery-app commissions from effective-dated rates | Σ per app: commission base × rate |
| Payment fees | Card processing fees. *Unavailable* until a rate is configured. | Card sales × fee rate |
| Fixed operating expense allocation | Included monthly fixed costs, spread evenly over the days in the month | Σ monthly amounts ÷ days in month |
| **Estimated operating result** | A profit estimate. **It is not cash available.** | Gross profit − Staff − Complimentary − Wastage − Manual − Commissions − Payment fees − Fixed costs |
| **Replenishment reserve** | Cost to replace everything consumed, whether it was paid by cash or card | COGS + Batch + Staff + Complimentary + Wastage + Manual |
| Cash received (POS) | Net received on cash orders. This is not a drawer count. | Σ Net Received, method = cash |
| Card sales (to be settled) | Card receipts. They are a receivable until the bank settlement is recorded in the ledger. | Σ Net Received, method = card |
| Aggregator sales (receivable) | Delivery-app sales. They are a receivable until the app settles. | Σ net sales with a Delivery App |
| Split / unknown payments | Split amounts are unknown, and a blank method is **never** treated as cash | Σ Net Received |

Each cost is deducted only once:

- sold-item COGS covers paid orders;
- staff meals, complimentary items and wastage are separate lines;
- the reserve includes all of them.

### Cash allocation (`/reserve`)

This page answers *"How much should I set aside, what is it for, and what remains?"* for any date range:

| Line | Meaning |
|---|---|
| Required replenishment reserve | Σ daily reserves, also broken down by ingredient and packaging item |
| Actually set aside | Ledger entries of type *allocation* |
| Recorded replenishment purchases | Purchases paid from the reserve. **These are not deducted again as cost**, because consumption already counts the stock used. |
| Remaining funded reserve | Amount set aside to date − purchases from the reserve to date |
| Unfunded reserve requirement | Required − set aside (never below 0) |
| Cash / bank balance | Shown only after an opening balance is recorded. Calculated as the opening balance plus movements since then. Card sales count only once they are settled. |
| Cash not earmarked | Cash + bank − remaining reserve − unfunded reserve − liabilities. It is *incomplete* when liabilities or costs are missing. It is never labeled "available to withdraw". |

The ledger records these entry types:

- allocations;
- purchases;
- expenses;
- card and aggregator settlements;
- owner contributions and withdrawals;
- opening balances;
- liabilities statements;
- adjustments.

The reserve is a business-wide requirement. It is not automatically an amount to take out of the physical cash drawer.

### Default settings (effective-dated, editable in `/settings`)

All of these are stored as effective-dated settings versions and printed in every report's *Assumptions* section:

- **Karak:** AED 23 per prepared batch, one batch per day with Karak sales, with the batch recipe allocated.
- **Packaging:** the workbook packaging applies on every channel. You can change this per channel.
- **Packaging VAT:** VAT-inclusive, as in the workbook.
- **Water and ice:** incomplete until you confirm them as zero-cost.
- **Refunds and voids:** refunds default to *prepared, not recoverable*; voids default to *not prepared*.
- **Aggregator commissions:** Talabat 32%, noon 19% and Keeta 25% of the aggregator price, taken from the workbook and marked **unconfirmed**. Card and Smiles fees are not configured, so they show as *unavailable*.
- **Fixed costs:** all workbook lines except Cane Sauce and Original Sauce, which duplicate recipe costs. The earlier AED 18,000 owner allowance is not in the workbook, so it is not included.

---

## 5. Reports and exports

| Report | Where |
|---|---|
| Daily EOD PDF | `/api/export/day/YYYY-MM-DD/pdf`. Add `?rev=N` for a finalized revision or `?live=1` for the live recalculation. |
| Date-range financial summary (page / PDF / Excel) | `/reports/summary`, `/api/export/pdf?from=&to=`, `/api/export/xlsx?report=summary` |
| Ingredient replenishment Excel (with lineage) | `/reports/replenishment`, `/api/export/xlsx?report=replenishment` |
| Menu-item margin report (with workbook reconciliation) | `/reports/menu`, `/api/export/xlsx?report=menu` |
| Staff meals, complimentary items and wastage | `/reports/nonsales`, `/api/export/xlsx?report=nonsales[&bucket=staff]` |
| Unresolved issues | `/reports/issues`, `/api/export/xlsx?report=issues` |
| Full Excel workbook | `/api/export/xlsx?report=full` |
| Import and adjustment audit trail | `/audit`, `/api/export/audit` (CSV) |
| Backup | `/api/export/backup` (owner only). JSON export of every table except password hashes. |

Every report shows:

- the period;
- its finalization status (FINAL / PARTLY FINAL / PROVISIONAL);
- the costing versions used;
- the assumptions;
- unresolved issues;
- revision history.

Incomplete totals are labeled wherever they appear. The dashboard, the report pages and the exports all read the same `loadReport` / `loadRange` data. An integration test checks that exported totals match the dashboard.

### Backups

- Download the JSON backup from **Reports → Backup** for an application-level export.
- For full disaster recovery, also run a regular database dump:

  ```bash
  pg_dump --format=custom "$DATABASE_URL" > rawia_finance_$(date +%F).dump
  pg_restore --clean --dbname "$DATABASE_URL" rawia_finance_YYYY-MM-DD.dump
  ```

---

## 6. Verification

`tests/engine.test.ts` (unit tests) and `tests/db.test.ts` (PostgreSQL integration tests) cover these cases using the real workbook and sales fixture:

- A normal item allocates ingredients and packaging, and the result matches the workbook cost.
- Discounts reduce revenue without reducing consumption.
- Staff and complimentary items create replenishment cost with zero revenue, and so do manual staff-meal and wastage adjustments.
- Cane Karak costs AED 23 once per prepared batch. The tests also cover batch-count and not-prepared adjustments, and the unallocated fallback.
- Combos and packaging are not double-counted.
- Refunds and cancellations follow their preparation status.
- Re-uploaded and overlapping files do not duplicate sales. This is tested with order IDs, with fingerprints, and with changed re-exports.
- Missing costs produce visible incomplete totals, and confirmed-zero overrides clear the flag.
- Updating costs does not change finalized history, and revisions are recorded.
- Recorded stock purchases are not deducted a second time.
- Exported PDF and Excel totals match the dashboard.

---

## 7. Project layout

```
src/lib/costing/     workbook parser, unit conversion, recipe/combo expansion
src/lib/sales/       POS CSV/XLSX parser, date handling, dedupe keys
src/lib/engine/      daily computation + range aggregation (pure, Decimal-based)
src/lib/server/      DB-backed services: auth, sales imports, costing, day/finalization, ledger, reports, PDF/XLSX
src/app/(app)/       authenticated pages; src/app/api/export/ route handlers
src/db/schema.ts     Drizzle schema; drizzle/ migrations
scripts/             seed and sample-report
tests/               unit + integration tests and the real fixtures
```
