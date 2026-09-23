import { expandBatch, expandMenu, isIncompleteLine, menuItem, costItem, type ConsumptionLine } from "../costing/expand";
import type { CostingSnapshot } from "../costing/types";
import { daysInMonth } from "../dates";
import { D, Decimal, ZERO, sum } from "../money";
import { channelOf, type PrepState, type Settings } from "../settings";
import type {
  Bucket,
  ConsumptionRecord,
  ConsumptionRow,
  DayResult,
  EngineAdjustment,
  EngineOrder,
  Issue,
  MenuRow,
  Metric,
} from "./types";

export type DayInput = {
  date: string;
  snapshot: CostingSnapshot;
  costingVersion: { id: number; label: string };
  settings: Settings;
  settingsVersionId: number;
  orders: EngineOrder[];
  decisions: Map<string, PrepState>;
  adjustments: EngineAdjustment[];
};

type OrderClass = "included" | "voided" | "open";

function classify(o: EngineOrder): OrderClass {
  if (/void|cancel/.test(o.status)) return "voided";
  if (/paid|refund|closed|complete/.test(o.status)) return "included";
  return "open";
}

function isComplimentary(o: EngineOrder): boolean {
  return !o.staffMeal && D(o.totalSales).gt(0) && o.salesAfterDiscount !== null && D(o.salesAfterDiscount).lte(0);
}

function isFullRefund(o: EngineOrder): boolean {
  return /refund/.test(o.status) || (D(o.refunded).gt(0) && D(o.refunded).gte(D(o.salesAfterDiscount ?? o.paid)));
}

const m = (
  key: string,
  label: string,
  value: Decimal | null,
  status: Metric["status"],
  definition: string,
  formula: string,
  notes: string[] = [],
): Metric => ({ key, label, value: value === null ? null : value.toString(), status, definition, formula, notes });

export function computeDay(input: DayInput): DayResult {
  const { date, snapshot: snap, settings } = input;
  const issues: Issue[] = [];
  const records: ConsumptionRecord[] = [];
  const batchCodes = new Set([settings.karak.menuCode]);

  const push = (lines: ConsumptionLine[], bucket: Bucket, origin: ConsumptionRecord["origin"]) => {
    for (const l of lines) {
      records.push({
        itemKey: l.itemKey,
        label: l.label,
        kind: l.kind,
        unit: l.unit,
        qty: l.qty.toString(),
        unitCost: l.unitCost?.toString() ?? null,
        amount: l.amount?.toString() ?? null,
        incomplete: isIncompleteLine(l),
        flags: l.flags,
        bucket,
        origin,
        path: l.path,
      });
    }
  };

  const decisions: DayResult["decisions"] = [];
  const counts = { orders: input.orders.length, included: 0, voided: 0, refunded: 0, open: 0, staffOrders: 0, compOrders: 0, units: ZERO, karakCups: ZERO };
  const unmatched = new Map<string, { qty: Decimal; orders: Set<string> }>();

  // Revenue accumulators (incl. VAT unless stated).
  let gross = ZERO,
    staffValue = ZERO,
    compValue = ZERO,
    discounts = ZERO,
    refunds = ZERO,
    netIncl = ZERO,
    netEx = ZERO,
    vatMissing = 0;
  const payments = new Map<string, { orders: number; amount: Decimal; treatment: string }>();
  const channels = new Map<string, { orders: number; gross: Decimal; net: Decimal }>();
  const apps = new Map<string, { orders: number; base: Decimal }>();
  let cardBase = ZERO,
    splitAmount = ZERO,
    cashReceived = ZERO,
    unknownAmount = ZERO,
    aggregatorAmount = ZERO;
  const menuRev = new Map<string, Decimal>();

  for (const o of input.orders) {
    const cls = classify(o);
    const chan = channelOf(o);
    if (cls === "open") {
      counts.open++;
      issues.push({ severity: "warning", code: "order_open", message: `Order #${o.orderNumber ?? o.orderKey} has status "${o.status}" and is excluded until it is closed.`, ref: o.orderKey });
      continue;
    }
    // Preparation state drives consumption; revenue follows the POS amounts.
    let prep: PrepState = "prepared";
    let fullRefund = false;
    if (cls === "voided") {
      counts.voided++;
      const d = input.decisions.get(o.orderKey);
      prep = d ?? settings.voidDefault;
      decisions.push({ orderKey: o.orderKey, orderNumber: o.orderNumber, status: o.status, prep, source: d ? "recorded" : "default" });
    } else {
      counts.included++;
      fullRefund = isFullRefund(o);
      if (fullRefund || D(o.refunded).gt(0)) {
        counts.refunded++;
        const d = input.decisions.get(o.orderKey);
        prep = d ?? settings.refundDefault;
        decisions.push({ orderKey: o.orderKey, orderNumber: o.orderNumber, status: o.status, prep, source: d ? "recorded" : "default" });
      }
    }

    const comp = cls === "included" && isComplimentary(o);
    if (cls === "included") {
      if (o.staffMeal) counts.staffOrders++;
      if (comp) counts.compOrders++;
      const total = D(o.totalSales);
      const after = o.salesAfterDiscount !== null ? D(o.salesAfterDiscount) : o.paid !== null ? D(o.paid) : total;
      const refunded = D(o.refunded);
      const net = after.minus(refunded);
      gross = gross.plus(total);
      if (o.staffMeal) staffValue = staffValue.plus(total);
      else if (comp) compValue = compValue.plus(total);
      discounts = discounts.plus(total.minus(after));
      refunds = refunds.plus(refunded);
      netIncl = netIncl.plus(net);
      let orderEx: Decimal | null = null;
      if (o.subtotalAfterDiscount !== null) {
        orderEx = after.gt(0) ? D(o.subtotalAfterDiscount).times(net.div(after)) : ZERO;
      } else if (settings.vat.pricesIncludeVat && settings.vat.confirmed) {
        orderEx = net.div(D(1).plus(D(settings.vat.ratePct).div(100)));
      } else vatMissing++;
      if (orderEx !== null) netEx = netEx.plus(orderEx);

      const ch = channels.get(chan) ?? { orders: 0, gross: ZERO, net: ZERO };
      ch.orders++;
      ch.gross = ch.gross.plus(total);
      ch.net = ch.net.plus(net);
      channels.set(chan, ch);

      const received = o.netReceived !== null ? D(o.netReceived) : net;
      if (o.deliveryApp) {
        const key = o.deliveryApp.toLowerCase();
        const a = apps.get(key) ?? { orders: 0, base: ZERO };
        a.orders++;
        const fee = settings.channelFees[key];
        a.base = a.base.plus(fee?.basis === "subtotal_ex_vat" ? orderEx ?? net : net);
        apps.set(key, a);
        aggregatorAmount = aggregatorAmount.plus(net);
        const p = payments.get(`aggregator:${o.deliveryApp}`) ?? { orders: 0, amount: ZERO, treatment: "Receivable from aggregator until settlement is recorded" };
        p.orders++;
        p.amount = p.amount.plus(net);
        payments.set(`aggregator:${o.deliveryApp}`, p);
      } else if (received.gt(0) || o.paymentMethods.length > 0) {
        const methods = o.paymentMethods;
        let key: string;
        let treatment: string;
        if (methods.length === 0) {
          key = "unspecified";
          treatment = "Payment method missing in POS – not assumed to be cash";
          unknownAmount = unknownAmount.plus(received);
        } else if (methods.length > 1) {
          key = methods.join(" + ");
          treatment = "Split payment – POS export does not show the split";
          splitAmount = splitAmount.plus(received);
        } else if (methods[0] === "cash") {
          key = "cash";
          treatment = "Cash received per POS (drawer count not recorded)";
          cashReceived = cashReceived.plus(received);
        } else if (methods[0] === "card") {
          key = "card";
          treatment = "Card sale – receivable until bank settlement is recorded";
          cardBase = cardBase.plus(received);
        } else {
          key = methods[0];
          treatment = "Other method – treated as receivable";
          unknownAmount = unknownAmount.plus(received);
        }
        const p = payments.get(key) ?? { orders: 0, amount: ZERO, treatment };
        p.orders++;
        p.amount = p.amount.plus(received);
        payments.set(key, p);
      }

      // Allocate the order's net ex-VAT revenue to its lines by menu price (POS export has no line prices).
      if (!o.staffMeal && !comp && orderEx !== null && orderEx.gt(0)) {
        const weights = o.lines.map((l) => {
          const mi = l.menuCode ? menuItem(snap, l.menuCode) : undefined;
          return D(mi?.priceDineIn ?? 1).times(l.qty);
        });
        const wsum = sum(weights);
        o.lines.forEach((l, i) => {
          const k = l.menuCode ?? `pos:${l.posName}`;
          menuRev.set(k, (menuRev.get(k) ?? ZERO).plus(wsum.gt(0) ? orderEx!.times(weights[i]).div(wsum) : ZERO));
        });
      }
    }

    if (prep !== "prepared") continue;
    const bucket: Bucket =
      cls === "voided" ? "wastage" : fullRefund ? "refund_loss" : o.staffMeal ? "staff" : comp ? "complimentary" : "sold";
    const includePackaging = (settings.packaging[chan] ?? "workbook") === "workbook";
    for (const l of o.lines) {
      counts.units = counts.units.plus(l.qty);
      if (!l.menuCode) {
        const u = unmatched.get(l.posName) ?? { qty: ZERO, orders: new Set<string>() };
        u.qty = u.qty.plus(l.qty);
        u.orders.add(o.orderKey);
        unmatched.set(l.posName, u);
        push(
          [{ itemKey: `unmatched:${l.posName}`, label: `Unmatched POS item: ${l.posName}`, kind: "unallocated", qty: D(l.qty), unit: "serving", unitCost: null, amount: null, flags: ["recipe_missing"], path: [l.posName], source: "" }],
          bucket,
          { type: "order", orderKey: o.orderKey, orderNumber: o.orderNumber, lineKey: l.lineKey, posName: l.posName, menuCode: null, servings: String(l.qty) },
        );
        continue;
      }
      const lines = expandMenu(snap, l.menuCode, l.qty, { includePackaging, batchCodes });
      for (const x of lines) if (x.kind === "batch_cup") counts.karakCups = counts.karakCups.plus(x.qty);
      push(lines, bucket, { type: "order", orderKey: o.orderKey, orderNumber: o.orderNumber, lineKey: l.lineKey, posName: l.posName, menuCode: l.menuCode, servings: String(l.qty) });
    }
  }

  // Manual adjustments.
  let batchOverride: number | null = null;
  for (const a of input.adjustments) {
    const origin = { type: "adjustment" as const, adjustmentId: a.id, menuCode: a.menuCode, posName: a.note, servings: a.qty ?? "0" };
    if (a.type === "batch_count") {
      batchOverride = Number(a.qty ?? 0);
      continue;
    }
    if (a.type === "manual_cost") {
      const amt = D(a.amount);
      push([{ itemKey: a.itemKey ?? `manual:${a.id}`, label: a.itemKey ? costItem(snap, a.itemKey)?.name ?? a.itemKey : `Manual: ${a.note}`, kind: "unallocated", qty: D(1), unit: "entry", unitCost: amt, amount: amt, flags: [], path: [`Adjustment #${a.id}`], source: "" }], "manual", origin);
      continue;
    }
    const bucket: Bucket = a.type === "staff_meal" ? "staff" : a.type === "complimentary" ? "complimentary" : "wastage";
    if (a.menuCode) {
      const includePackaging = a.type === "wastage" ? false : (settings.packaging[a.type === "staff_meal" ? "staff_meal" : "indoor"] ?? "workbook") === "workbook";
      push(expandMenu(snap, a.menuCode, D(a.qty), { includePackaging, batchCodes }), bucket, origin);
    } else if (a.itemKey) {
      const it = costItem(snap, a.itemKey);
      const q = D(a.qty);
      const uc = it?.unitCost !== null && it?.unitCost !== undefined && it.costStatus !== "invalid" ? D(it.unitCost) : null;
      push([{ itemKey: a.itemKey, label: it?.name ?? a.itemKey, kind: it?.kind === "packaging" ? "packaging" : "ingredient", qty: q, unit: it?.baseUnit ?? "", unitCost: uc, amount: uc ? q.times(uc) : null, flags: uc ? [] : ["cost_missing"], path: [`Adjustment #${a.id}: ${a.note}`], source: "" }], bucket, origin);
    }
  }

  // Daily batch (Cane Karak): fixed price per prepared batch, independent of cups sold.
  const hasSales = input.orders.length > 0;
  const batches = batchOverride ?? (hasSales ? settings.karak.defaultBatchesPerDay : 0);
  const karakSource: DayResult["karak"]["source"] = batchOverride !== null ? "adjusted" : hasSales ? "default" : "no_sales";
  const batchLines = settings.karak.allocateRecipe
    ? expandBatch(snap, settings.karak.menuCode, batches, settings.karak.batchPrice)
    : batches > 0
      ? [{ itemKey: `batch:${settings.karak.menuCode}`, label: "Karak batch – unallocated reserve", kind: "unallocated" as const, qty: D(batches), unit: "batch", unitCost: D(settings.karak.batchPrice), amount: D(settings.karak.batchPrice).times(batches), flags: ["batch_unallocated" as const], path: ["Daily batch"], source: "" }]
      : [];
  push(batchLines, "batch", { type: "batch", menuCode: settings.karak.menuCode, servings: String(batches) });
  if (counts.karakCups.gt(0) && batches === 0) issues.push({ severity: "warning", code: "karak_not_prepared", message: `${counts.karakCups} Karak cups were sold but the batch is marked not prepared.` });
  const karakCost = D(settings.karak.batchPrice).times(batches);
  const karakUnalloc = sum(batchLines.filter((l) => l.flags.includes("batch_unallocated")).map((l) => l.amount ?? ZERO));

  // ---- Consumption aggregation ----
  const byItem = new Map<string, { row: ConsumptionRow; qty: Decimal; amount: Decimal; buckets: Map<Bucket, Decimal>; unitCosts: Set<string> }>();
  for (const r of records) {
    let e = byItem.get(r.itemKey);
    if (!e) {
      e = { row: { itemKey: r.itemKey, label: r.label, kind: r.kind, unit: r.unit, qty: "0", unitCost: null, amount: "0", incomplete: false, flags: [], byBucket: {} }, qty: ZERO, amount: ZERO, buckets: new Map(), unitCosts: new Set() };
      byItem.set(r.itemKey, e);
    }
    e.qty = e.qty.plus(r.qty);
    if (r.amount !== null) e.amount = e.amount.plus(r.amount);
    if (r.unitCost !== null) e.unitCosts.add(r.unitCost);
    if (r.incomplete) e.row.incomplete = true;
    e.row.flags = [...new Set([...e.row.flags, ...r.flags])];
    e.buckets.set(r.bucket, (e.buckets.get(r.bucket) ?? ZERO).plus(r.amount ?? ZERO));
  }
  const consumption: ConsumptionRow[] = [...byItem.values()]
    .map((e) => ({
      ...e.row,
      qty: e.qty.toString(),
      amount: e.amount.toString(),
      unitCost: e.unitCosts.size === 1 ? [...e.unitCosts][0] : e.qty.gt(0) && e.unitCosts.size > 1 ? e.amount.div(e.qty).toString() : null,
      byBucket: Object.fromEntries([...e.buckets].map(([b, v]) => [b, v.toString()])),
    }))
    .sort((a, b) => D(b.amount).comparedTo(D(a.amount)) || a.label.localeCompare(b.label));

  const bucketTotal = (b: Bucket, kinds?: string[]) =>
    sum(records.filter((r) => r.bucket === b && (!kinds || kinds.includes(r.kind))).map((r) => D(r.amount ?? 0)));
  const bucketIncomplete = (b: Bucket, kinds?: string[]) => records.some((r) => r.bucket === b && r.incomplete && (!kinds || kinds.includes(r.kind)));
  const soldIng = bucketTotal("sold", ["ingredient", "unallocated", "batch_cup"]);
  const soldPkg = bucketTotal("sold", ["packaging"]);
  const staff = bucketTotal("staff");
  const compC = bucketTotal("complimentary");
  const waste = bucketTotal("wastage").plus(bucketTotal("refund_loss"));
  const batch = bucketTotal("batch");
  const manual = bucketTotal("manual");
  const reserve = sum(records.map((r) => D(r.amount ?? 0)));
  const reserveIncomplete = records.some((r) => r.incomplete);
  const st = (inc: boolean): Metric["status"] => (inc ? "incomplete" : "calculated");

  // ---- Menu profitability ----
  const menuRows = new Map<string, MenuRow & { _rev: Decimal; _cost: Decimal; _sold: Decimal; _staff: Decimal; _comp: Decimal; _waste: Decimal }>();
  const menuRow = (key: string, code: string | null, name: string) => {
    let r = menuRows.get(key);
    if (!r) {
      r = { key, menuCode: code, name, soldQty: "0", staffQty: "0", compQty: "0", wasteQty: "0", revenueExVat: "0", soldCost: "0", margin: "0", marginPct: null, incomplete: false, _rev: ZERO, _cost: ZERO, _sold: ZERO, _staff: ZERO, _comp: ZERO, _waste: ZERO };
      menuRows.set(key, r);
    }
    return r;
  };
  const seenLine = new Set<string>();
  for (const rec of records) {
    if (rec.origin.type === "batch") continue;
    const code = rec.origin.menuCode ?? null;
    const key = code ?? `pos:${rec.origin.posName}`;
    const name = code ? menuItem(snap, code)?.name ?? code : rec.origin.posName ?? key;
    const row = menuRow(key, code, name);
    const lk = `${rec.origin.lineKey ?? `adj${rec.origin.adjustmentId}`}`;
    if (!seenLine.has(lk)) {
      seenLine.add(lk);
      const q = D(rec.origin.servings);
      if (rec.bucket === "sold") row._sold = row._sold.plus(q);
      else if (rec.bucket === "staff") row._staff = row._staff.plus(q);
      else if (rec.bucket === "complimentary") row._comp = row._comp.plus(q);
      else if (rec.bucket === "wastage" || rec.bucket === "refund_loss") row._waste = row._waste.plus(q);
    }
    if (rec.bucket === "sold") {
      row._cost = row._cost.plus(rec.amount ?? 0);
      if (rec.incomplete) row.incomplete = true;
    }
  }
  for (const [k, v] of menuRev) {
    const code = k.startsWith("pos:") ? null : k;
    const row = menuRow(k, code, code ? menuItem(snap, code)?.name ?? code : k.slice(4));
    row._rev = row._rev.plus(v);
  }
  const menuItems: MenuRow[] = [...menuRows.values()]
    .map(({ _rev, _cost, _sold, _staff, _comp, _waste, ...r }) => ({
      ...r,
      soldQty: _sold.toString(),
      staffQty: _staff.toString(),
      compQty: _comp.toString(),
      wasteQty: _waste.toString(),
      revenueExVat: _rev.toString(),
      soldCost: _cost.toString(),
      margin: _rev.minus(_cost).toString(),
      marginPct: _rev.gt(0) ? _rev.minus(_cost).div(_rev).toString() : null,
    }))
    .sort((a, b) => D(b.revenueExVat).comparedTo(D(a.revenueExVat)) || a.name.localeCompare(b.name));

  // ---- Fees ----
  const feesByApp: DayResult["feesByApp"] = [];
  let commissions = ZERO;
  let commissionMissing = false;
  let commissionUnconfirmed = false;
  for (const [app, a] of apps) {
    const fee = settings.channelFees[app];
    const amount = fee?.ratePct !== null && fee?.ratePct !== undefined ? a.base.times(fee.ratePct).div(100) : null;
    if (amount === null) commissionMissing = true;
    else commissions = commissions.plus(amount);
    if (fee && !fee.confirmed) commissionUnconfirmed = true;
    feesByApp.push({ app, orders: a.orders, base: a.base.toString(), ratePct: fee?.ratePct ?? null, amount: amount?.toString() ?? null, confirmed: fee?.confirmed ?? false });
    if (amount === null) issues.push({ severity: "warning", code: "fee_missing", message: `No commission rate configured for ${app}; channel commissions are incomplete.` });
  }
  const cardRate = settings.paymentFees.card.ratePct;
  const cardFeeBase = cardBase;
  const paymentFees = cardRate !== null ? cardFeeBase.times(cardRate).div(100) : null;
  const paymentFeesIncomplete = (cardRate === null && cardFeeBase.gt(0)) || splitAmount.gt(0);

  // ---- Fixed costs ----
  const dim = daysInMonth(date);
  const fixed = settings.fixedExpenses.map((f) => ({
    name: f.name,
    monthly: f.monthly,
    daily: f.include && f.monthly !== null ? D(f.monthly).div(dim).toString() : null,
    included: f.include,
    note: f.note,
  }));
  const fixedTotal = sum(fixed.filter((f) => f.daily !== null).map((f) => D(f.daily!)));
  const fixedIncomplete = settings.fixedExpenses.some((f) => f.include && f.monthly === null);

  // ---- Metrics ----
  const vatAvailable = vatMissing === 0;
  const vat = vatAvailable ? netIncl.minus(netEx) : null;
  const netSales = vatAvailable ? netEx : null;
  const vatNote = settings.vat.confirmed ? [] : ["VAT treatment in Settings is not yet confirmed; VAT is shown as recorded by the POS."];
  const revenueBase = netSales ?? netIncl;
  const grossProfit = revenueBase.minus(soldIng).minus(soldPkg).minus(batch);
  const opResult = grossProfit
    .minus(staff)
    .minus(compC)
    .minus(waste)
    .minus(manual)
    .minus(commissions)
    .minus(paymentFees ?? ZERO)
    .minus(fixedTotal);
  const soldIncomplete = bucketIncomplete("sold") || bucketIncomplete("batch");
  const opIncomplete = soldIncomplete || reserveIncomplete || commissionMissing || paymentFeesIncomplete || cardRate === null || fixedIncomplete || !vatAvailable;
  const opNotes: string[] = [];
  if (reserveIncomplete) opNotes.push("Some consumed items have no cost.");
  if (commissionMissing) opNotes.push("A delivery app has no commission rate.");
  if (cardRate === null && cardFeeBase.gt(0)) opNotes.push("Card processing fee rate not configured.");
  if (fixedIncomplete) opNotes.push("Some fixed expenses have no amount.");
  if (commissionUnconfirmed) opNotes.push("Commission rates are unconfirmed workbook values.");

  const metrics: Record<string, Metric> = {
    grossSales: m("grossSales", "Sales before discounts", gross, "confirmed", "Menu value of all closed orders, including staff meals and complimentary orders, VAT-inclusive, as recorded by the POS.", "Σ Total Sales (paid + refunded orders; voided/open excluded)"),
    staffMealValue: m("staffMealValue", "of which staff meals (menu value)", staffValue, "confirmed", "Menu value of staff-meal orders. They are fully discounted, so they add no revenue.", "Σ Total Sales where Staff Meal = Yes"),
    complimentaryValue: m("complimentaryValue", "of which complimentary (menu value)", compValue, "confirmed", "Menu value of non-staff orders discounted to zero.", "Σ Total Sales where Sales After Discount = 0 and not a staff meal"),
    discounts: m("discounts", "Discounts", discounts, "confirmed", "All discounts including 100% staff and complimentary discounts, VAT-inclusive.", "Σ (Total Sales − Sales After Discount)"),
    refunds: m("refunds", "Refunds", refunds, "confirmed", "Amounts refunded to customers per the POS.", "Σ Refunded"),
    netSalesInclVat: m("netSalesInclVat", "Net sales incl. VAT", netIncl, "confirmed", "What customers paid after discounts and refunds.", "Sales before discounts − Discounts − Refunds"),
    vat: m("vat", "VAT", vat, vatAvailable ? (settings.vat.confirmed ? "confirmed" : "estimate") : "unavailable", "Output VAT included in net sales, from the POS VAT/subtotal columns (refunds reduce VAT pro rata).", "Net sales incl. VAT − Net sales ex VAT", vatAvailable ? vatNote : ["The sales file has no VAT/subtotal columns and VAT treatment is not confirmed in Settings."]),
    netSales: m("netSales", "Net sales (ex VAT)", netSales, vatAvailable ? "confirmed" : "unavailable", "Revenue earned by the café, excluding VAT.", "Σ Subtotal After Discount × (1 − Refunded ÷ Sales After Discount)"),
    ingredientCost: m("ingredientCost", "Ingredient cost – sold items", soldIng, st(bucketIncomplete("sold", ["ingredient", "unallocated", "batch_cup"])), "Recipe ingredients consumed by paid customer orders (discounts do not reduce it). Items with only a total workbook cost are included as unallocated.", "Σ qty served × recipe qty per serving × effective unit cost"),
    packagingCost: m("packagingCost", "Packaging cost – sold items", soldPkg, st(bucketIncomplete("sold", ["packaging"])), "Packaging used by paid customer orders, once per item sold (combo packaging comes from the combo, not its components).", "Σ qty served × packaging qty × VAT-inclusive unit price"),
    cogsSold: m("cogsSold", "Cost of goods sold", soldIng.plus(soldPkg), st(bucketIncomplete("sold")), "Ingredient + packaging cost of sold items.", "Ingredient cost + Packaging cost"),
    batchCost: m("batchCost", "Daily batch cost (Cane Karak)", batch, "calculated", `Fixed AED ${settings.karak.batchPrice} per prepared batch regardless of cups sold; per-cup Karak recipe cost is not charged.`, "Batches prepared × batch price"),
    staffConsumption: m("staffConsumption", "Staff meal consumption", staff, st(bucketIncomplete("staff")), "Ingredients and packaging consumed by staff meals (zero revenue).", "Σ recipe cost of staff-meal lines"),
    complimentaryConsumption: m("complimentaryConsumption", "Complimentary consumption", compC, st(bucketIncomplete("complimentary")), "Ingredients and packaging consumed by complimentary orders (zero revenue).", "Σ recipe cost of complimentary lines"),
    wastage: m("wastage", "Wastage & prepared refunds/voids", waste, st(bucketIncomplete("wastage") || bucketIncomplete("refund_loss")), "Recorded wastage plus orders that were prepared but refunded in full or voided.", "Σ recipe cost of wastage adjustments + prepared refunded/voided orders"),
    manualCost: m("manualCost", "Manual reserve adjustments", manual, "calculated", "Owner-entered consumption amounts.", "Σ manual adjustment amounts"),
    reserve: m("reserve", "Replenishment reserve", reserve, st(reserveIncomplete), "Money needed to replace everything consumed today: sold items, staff meals, complimentary items, wastage, batches and manual adjustments, whether paid by cash or card. It is a business-wide requirement, not an amount to remove from the cash drawer.", "COGS + batch + staff + complimentary + wastage + manual"),
    grossProfit: m("grossProfit", "Gross profit from sales", grossProfit, soldIncomplete || !vatAvailable ? "incomplete" : "calculated", "Net sales less the cost of what was sold (including the daily batch).", "Net sales (ex VAT) − COGS − Daily batch cost", !vatAvailable ? ["Net sales ex VAT unavailable; VAT-inclusive sales used."] : []),
    channelCommissions: m("channelCommissions", "Channel commissions", commissions, commissionMissing ? "incomplete" : commissionUnconfirmed ? "estimate" : "calculated", "Aggregator commissions from the effective-dated rates in Settings.", "Σ per app: commission base × rate", commissionUnconfirmed ? ["Rates are workbook values awaiting confirmation."] : []),
    paymentFees: m("paymentFees", "Payment fees", paymentFees ?? ZERO, cardRate === null ? (cardFeeBase.gt(0) ? "unavailable" : "calculated") : paymentFeesIncomplete ? "incomplete" : "calculated", "Card processing fees from the configured rate.", "Card sales × card fee rate", cardRate === null ? ["Card fee rate not configured."] : splitAmount.gt(0) ? ["Split payments are not included (split unknown)."] : []),
    fixedCosts: m("fixedCosts", "Fixed operating expense allocation", fixedTotal, fixedIncomplete ? "incomplete" : "calculated", `Included monthly fixed costs spread evenly over the ${dim} days of the month.`, "Σ included monthly amounts ÷ days in month"),
    operatingResult: m("operatingResult", "Estimated operating result", opResult, opIncomplete ? "incomplete" : "estimate", "Gross profit less staff meals, complimentary items, wastage, commissions, payment fees and fixed-cost allocation. This is a profit estimate, not cash available.", "Gross profit − Staff − Complimentary − Wastage − Manual − Commissions − Payment fees − Fixed costs", opNotes),
    cashReceived: m("cashReceived", "Cash received (POS)", cashReceived, "confirmed", "Net received on cash-only orders, as recorded by the POS. Not a drawer count.", "Σ Net Received where Payment Method = cash"),
    cardSales: m("cardSales", "Card sales (to be settled)", cardBase, "confirmed", "Card receipts recorded by the POS. They become cash only when the bank settlement is recorded in the ledger.", "Σ Net Received where Payment Method = card"),
    aggregatorSales: m("aggregatorSales", "Aggregator sales (receivable)", aggregatorAmount, "confirmed", "Net sales through delivery apps, receivable until the app settles.", "Σ net sales where Delivery App is set"),
    splitPayments: m("splitPayments", "Split payments (cash/card split unknown)", splitAmount, splitAmount.gt(0) ? "incomplete" : "confirmed", "Orders paid with more than one method; the export does not show each method's amount.", "Σ Net Received where more than one method"),
    unknownPayments: m("unknownPayments", "Payment method unknown", unknownAmount, unknownAmount.gt(0) ? "incomplete" : "confirmed", "Money received with no payment method in the POS. Not treated as cash.", "Σ Net Received where Payment Method is blank"),
  };

  if (!vatAvailable) issues.push({ severity: "warning", code: "vat_unavailable", message: "VAT could not be separated for some orders (no subtotal column and VAT not confirmed in Settings)." });
  for (const [name, u] of unmatched) issues.push({ severity: "error", code: "unmatched_item", message: `POS item "${name}" (${u.qty} sold) is not mapped to a workbook item; its cost is missing.`, ref: name });
  const missingItems = consumption.filter((c) => c.incomplete);
  for (const c of missingItems.filter((c) => !c.itemKey.startsWith("unmatched:"))) {
    issues.push({ severity: "warning", code: "cost_missing", message: `${c.label}: consumed ${D(c.qty).toDecimalPlaces(2)} ${c.unit} with no usable cost (${c.flags.join(", ")}).`, ref: c.itemKey });
  }
  for (const d of decisions.filter((x) => x.source === "default")) {
    issues.push({ severity: "info", code: "prep_default", message: `Order #${d.orderNumber ?? d.orderKey} (${d.status}) uses the default "${d.prep.replace("_", " ")}" preparation status; confirm it on the order.`, ref: d.orderKey });
  }

  return {
    date,
    costingVersionId: input.costingVersion.id,
    costingLabel: input.costingVersion.label,
    settingsVersionId: input.settingsVersionId,
    counts: { ...counts, units: counts.units.toString(), karakCups: counts.karakCups.toString() },
    metrics,
    payments: [...payments].map(([method, p]) => ({ method, orders: p.orders, amount: p.amount.toString(), treatment: p.treatment })),
    channels: [...channels].map(([channel, c]) => ({ channel, orders: c.orders, gross: c.gross.toString(), net: c.net.toString() })),
    feesByApp,
    fixed,
    karak: { menuCode: settings.karak.menuCode, batches, source: karakSource, cups: counts.karakCups.toString(), cost: karakCost.toString(), allocated: karakCost.minus(karakUnalloc).toString(), unallocated: karakUnalloc.toString() },
    consumption,
    menuItems,
    records,
    unmatched: [...unmatched].map(([posName, u]) => ({ posName, qty: u.qty.toString(), orders: u.orders.size })),
    decisions,
    issues,
  };
}
