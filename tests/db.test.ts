import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { D, Decimal } from "@/lib/money";

// Integration tests run against TEST_DATABASE_URL, which is wiped on every run.
const TEST_URL = process.env.TEST_DATABASE_URL;
if (TEST_URL) process.env.DATABASE_URL = TEST_URL;

const FIX = path.join(__dirname, "fixtures");
const CSV = readFileSync(path.join(FIX, "order-history-2026-09-14.csv"), "utf8");
const DATE = "2026-09-14";

type Mods = {
  dbm: typeof import("@/db");
  sales: typeof import("@/lib/server/sales");
  costing: typeof import("@/lib/server/costing");
  day: typeof import("@/lib/server/day");
  ledger: typeof import("@/lib/server/ledger");
};
let m: Mods;
let baseVersion = 0;

function csvLines(): { header: string; rows: string[] } {
  const lines = CSV.replace(/^\uFEFF/, "").trim().split(/\r?\n/);
  return { header: lines[0], rows: lines.slice(1) };
}

async function importCsv(content: string, name: string, date: string | null, scope: "selected_date" | "all_dates", commit = true) {
  const id = await m.sales.createPreview(Buffer.from(content, "utf8"), name, date, scope, null);
  const p = await m.sales.getPreview(id);
  const res = commit ? await m.sales.commitImport(id, { changedPolicy: "keep", includePossible: [] }, null) : null;
  return { id, preview: p!.preview, res };
}

describe.skipIf(!TEST_URL)("persistence (PostgreSQL)", () => {
  beforeAll(async () => {
    const { migrate } = await import("drizzle-orm/node-postgres/migrator");
    const dbm = await import("@/db");
    const { sql } = await import("drizzle-orm");
    await migrate(dbm.db, { migrationsFolder: path.join(__dirname, "..", "drizzle") });
    const tables = await dbm.db.execute<{ t: string }>(sql`select tablename as t from pg_tables where schemaname = 'public'`);
    if (tables.rows.length) await dbm.db.execute(sql.raw(`truncate ${tables.rows.map((r) => `"${r.t}"`).join(", ")} restart identity cascade`));
    m = {
      dbm,
      sales: await import("@/lib/server/sales"),
      costing: await import("@/lib/server/costing"),
      day: await import("@/lib/server/day"),
      ledger: await import("@/lib/server/ledger"),
    };
    const v = await m.costing.importWorkbook(readFileSync(path.join(FIX, "rawia cafe OPS (4).xlsx")), "rawia cafe OPS (4).xlsx", null);
    await m.costing.activateVersion(v.id, "2000-01-01", null);
    baseVersion = v.id;
  });

  afterAll(async () => {
    if (m) await m.dbm.db.$client.end();
  });

  it("does not double count re-uploaded or overlapping files", async () => {
    const first = await importCsv(CSV, "day1.csv", DATE, "selected_date");
    expect(first.res!.inserted).toBe(7);

    const again = await importCsv(CSV, "day1-again.csv", DATE, "selected_date");
    expect(again.preview.byClass.duplicate).toBe(7);
    expect(again.res!.inserted).toBe(0);

    // Multi-day file: three orders already imported plus one new order on the next day.
    const { header, rows } = csvLines();
    const extra = rows[3].replace(/2026-09-14/g, "2026-09-15").replace(/[0-9a-f-]{36}$/, "11111111-2222-4333-8444-555555555555");
    const overlap = await importCsv([header, rows[0], rows[1], rows[2], extra].join("\n"), "multi.csv", null, "all_dates");
    expect(overlap.preview.byClass.duplicate).toBe(3);
    expect(overlap.preview.byClass.new).toBe(1);
    expect(overlap.res!.inserted).toBe(1);

    const d14 = await m.day.getDay(DATE);
    expect(d14.result!.counts.orders).toBe(7);
    expect(D(d14.result!.metrics.netSalesInclVat.value).toFixed(2)).toBe("131.50");
    const d15 = await m.day.getDay("2026-09-15");
    expect(d15.result!.counts.orders).toBe(1);
  });

  it("flags edited re-exports as changed and only replaces them when asked", async () => {
    const { header, rows } = csvLines();
    const cols = rows[3].split(",");
    const changedRow = rows[3].replace(",card,10.50,0.00,10.50,", ",card,10.50,5.00,5.50,");
    expect(changedRow).not.toBe(rows[3]);
    const keep = await importCsv([header, changedRow].join("\n"), "changed.csv", DATE, "selected_date");
    expect(keep.preview.byClass.changed).toBe(1);
    expect(keep.res!.skipped).toBe(1);
    expect(cols.length).toBeGreaterThan(20);

    const id = await m.sales.createPreview(Buffer.from([header, changedRow].join("\n")), "changed2.csv", DATE, "selected_date", null);
    const r = await m.sales.commitImport(id, { changedPolicy: "replace", includePossible: [] }, null);
    expect(r.replaced).toBe(1);
    const d = await m.day.getDay(DATE);
    expect(D(d.result!.metrics.refunds.value).toFixed(2)).toBe("5.00");
    expect(d.result!.counts.orders).toBe(7);
  });

  it("uses fingerprints when the export has no order UUID", async () => {
    const { header, rows } = csvLines();
    const strip = (l: string) => l.split(",").slice(0, -1).join(",");
    const noId = [strip(header), ...rows.slice(0, 2).map((r) => strip(r).replace(/2026-09-14/g, "2026-09-20"))].join("\n");
    const first = await importCsv(noId, "noid.csv", "2026-09-20", "selected_date");
    expect(first.res!.inserted).toBe(2);
    const second = await importCsv(noId, "noid-again.csv", "2026-09-20", "selected_date");
    expect(second.preview.byClass.duplicate).toBe(2);
    expect(second.res!.inserted).toBe(0);
  });

  it("keeps finalized history when costs change and records revisions", async () => {
    const before = await m.day.getDay(DATE);
    expect(before.state).toBe("live");
    const rev1 = await m.day.finalizeDay(DATE, "", null);
    expect(rev1).toBe(1);
    const fin = await m.day.getDay(DATE);
    const reserve1 = fin.result!.metrics.reserve.value;

    const base = (await m.costing.getVersion(baseVersion))!;
    const bun = base.snapshot.items.find((i) => /burger bun/i.test(i.name))!;
    const v2 = await m.costing.deriveVersion(baseVersion, [{ type: "item_cost", itemKey: bun.key, unitCost: D(bun.unitCost!).times(3).toString(), note: "price rise" }], "bun price rise", null);
    await m.costing.activateVersion(v2.id, "2026-09-01", null);

    const after = await m.day.getDay(DATE);
    expect(after.state).toBe("finalized");
    expect(after.result!.metrics.reserve.value).toBe(reserve1);
    expect(after.result!.costingVersionId).toBe(baseVersion);
    expect(after.liveDiff).not.toBeNull();
    expect(D(after.liveDiff!.reserve).gt(D(reserve1))).toBe(true);

    await expect(m.day.finalizeDay(DATE, "  ", null)).rejects.toThrow(/reason/);
    const rev2 = await m.day.finalizeDay(DATE, "Bun price correction", null);
    expect(rev2).toBe(2);
    const revised = await m.day.getDay(DATE);
    expect(revised.revision).toBe(2);
    expect(revised.result!.costingVersionId).toBe(v2.id);
    expect((await m.day.getRevision(DATE, 1))!.metrics.reserve.value).toBe(reserve1);
    expect(await m.day.dayRevisions(DATE)).toHaveLength(2);
  });

  it("does not deduct stock purchases a second time", async () => {
    const d = await m.day.getDay("2026-09-15");
    const reserve = d.result!.metrics.reserve.value;
    const op = d.result!.metrics.operatingResult.value;
    await m.ledger.addLedgerEntry({ entryDate: "2026-09-15", type: "allocation", account: "cash", amount: "50", counterparty: null, fromReserve: false, description: "set aside" }, null);
    await m.ledger.addLedgerEntry({ entryDate: "2026-09-15", type: "purchase", account: "cash", amount: "30", counterparty: "Supplier", fromReserve: true, description: "buns" }, null);
    const after = await m.day.getDay("2026-09-15");
    expect(after.result!.metrics.reserve.value).toBe(reserve);
    expect(after.result!.metrics.operatingResult.value).toBe(op);

    const days = await m.day.getRange("2026-09-15", "2026-09-15");
    const f = await m.ledger.computeFunding("2026-09-15", "2026-09-15", days);
    expect(f.lines.remaining.value).toBe("20");
    expect(D(f.lines.unfunded.value).toString()).toBe(Decimal.max(D(reserve).minus(50), 0).toString());
    expect(f.lines.cash.status).toBe("unavailable");
    expect(f.lines.unearmarked.value).toBeNull();

    await m.ledger.addLedgerEntry({ entryDate: "2026-09-15", type: "opening_balance", account: "cash", amount: "500", counterparty: null, fromReserve: false, description: "" }, null);
    await m.ledger.addLedgerEntry({ entryDate: "2026-09-15", type: "opening_balance", account: "bank", amount: "1000", counterparty: null, fromReserve: false, description: "" }, null);
    const f2 = await m.ledger.computeFunding("2026-09-15", "2026-09-15", days);
    const cashSales = D(days[0].result!.metrics.cashReceived.value);
    expect(D(f2.lines.cash.value).toString()).toBe(D(500).minus(30).plus(cashSales).toString());
    expect(f2.lines.unearmarked.status).toBe("incomplete");
  });

  it("exports the same totals the dashboard shows", async () => {
    const ExcelJS = (await import("exceljs")).default;
    const { loadRange } = await import("@/lib/server/range");
    const { loadReport } = await import("@/lib/server/report");
    const { renderReportXlsx } = await import("@/lib/server/xlsx");
    const { renderReportPdf } = await import("@/lib/server/pdf");
    const dash = (await loadRange(DATE, DATE)).summary.metrics;
    const report = await loadReport(DATE, DATE);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await renderReportXlsx(report, "full")) as unknown as ArrayBuffer);
    const summary = new Map<string, string>();
    wb.getWorksheet("Summary")!.eachRow((row, i) => {
      if (i > 1) summary.set(String(row.getCell(2).value), String(row.getCell(4).value));
    });
    for (const key of ["netSales", "cogsSold", "reserve", "operatingResult"] as const) {
      expect(D(summary.get(dash[key].label)!).toString()).toBe(D(dash[key].value!).toString());
    }
    const rep = wb.getWorksheet("Replenishment")!;
    const exactCol = (rep.getRow(1).values as unknown[]).indexOf("Reserve exact");
    expect(D(String(rep.getRow(rep.rowCount).getCell(exactCol).value)).toString()).toBe(D(dash.reserve.value!).toString());
    const pdf = await renderReportPdf(report);
    expect(pdf.subarray(0, 5).toString()).toBe("%PDF-");
  });
});
