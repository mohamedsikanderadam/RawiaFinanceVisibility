import { D, ZERO, sum, type Dec } from "../money";
import type { Bucket, ConsumptionRecord, ConsumptionRow, DayResult, Issue, MenuRow, Metric } from "./types";

export type RangeDay = { date: string; state: "no_data" | "live" | "finalized"; revision: number | null; result: DayResult | null };

export type WaterfallStep = { key: string; label: string; value: string; kind: "total" | "minus"; status: Metric["status"] };

export type RangeSummary = {
  from: string;
  to: string;
  days: { date: string; state: RangeDay["state"]; revision: number | null; costingLabel: string | null; netSales: string | null; reserve: string | null; cogs: string | null; operatingResult: string | null; incomplete: boolean }[];
  daysWithData: number;
  finalizedDays: number;
  costingLabels: string[];
  metrics: Record<string, Metric>;
  consumption: ConsumptionRow[];
  menuItems: MenuRow[];
  payments: { method: string; orders: number; amount: string; treatment: string }[];
  channels: { channel: string; orders: number; gross: string; net: string }[];
  karak: { batches: number; cups: string; cost: string; allocated: string; unallocated: string };
  waterfall: WaterfallStep[];
  issues: (Issue & { date: string })[];
  nonSales: (ConsumptionRecord & { date: string })[];
};

const STATUS_RANK: Record<Metric["status"], number> = { confirmed: 0, calculated: 1, estimate: 2, incomplete: 3, unavailable: 4 };

function worst(a: Metric["status"], b: Metric["status"]): Metric["status"] {
  return STATUS_RANK[a] >= STATUS_RANK[b] ? a : b;
}

/** Sums daily results. Dashboard, reports and exports all use this, so their totals agree. */
export function aggregateRange(from: string, to: string, input: RangeDay[]): RangeSummary {
  const days = input.filter((d) => d.result);
  const results = days.map((d) => d.result!);

  const metrics: Record<string, Metric> = {};
  for (const r of results) {
    for (const [k, m] of Object.entries(r.metrics)) {
      const cur = metrics[k];
      if (!cur) {
        metrics[k] = { ...m, notes: [...m.notes] };
        continue;
      }
      const both = cur.value === null || m.value === null ? (cur.value ?? m.value) : D(cur.value).plus(D(m.value)).toString();
      const partial = (cur.value === null) !== (m.value === null);
      metrics[k] = {
        ...cur,
        value: both,
        status: partial ? "incomplete" : worst(cur.status, m.status),
        notes: [...new Set([...cur.notes, ...m.notes, ...(partial ? ["Not available for every day in the range."] : [])])],
      };
    }
  }
  if (results.length > 1) {
    for (const m of Object.values(metrics)) m.definition = `${m.definition} Summed over ${results.length} days.`;
  }

  const cons = new Map<string, { row: ConsumptionRow; qty: Dec; amount: Dec; buckets: Map<Bucket, Dec> }>();
  for (const r of results) {
    for (const c of r.consumption) {
      const key = `${c.itemKey}|${c.unit}`;
      let e = cons.get(key);
      if (!e) {
        e = { row: { ...c, flags: [...c.flags], byBucket: {} }, qty: ZERO, amount: ZERO, buckets: new Map() };
        cons.set(key, e);
      }
      e.qty = e.qty.plus(D(c.qty));
      e.amount = e.amount.plus(D(c.amount));
      e.row.incomplete ||= c.incomplete;
      e.row.flags = [...new Set([...e.row.flags, ...c.flags])];
      for (const [b, v] of Object.entries(c.byBucket) as [Bucket, string][]) e.buckets.set(b, (e.buckets.get(b) ?? ZERO).plus(D(v)));
    }
  }
  const consumption = [...cons.values()]
    .map((e) => ({
      ...e.row,
      qty: e.qty.toString(),
      amount: e.amount.toString(),
      unitCost: e.qty.gt(0) && !e.row.incomplete ? e.amount.div(e.qty).toString() : e.row.unitCost,
      byBucket: Object.fromEntries([...e.buckets].map(([b, v]) => [b, v.toString()])),
    }))
    .sort((a, b) => D(b.amount).comparedTo(D(a.amount)) || a.label.localeCompare(b.label));

  const menu = new Map<string, { row: MenuRow; v: Record<"soldQty" | "staffQty" | "compQty" | "wasteQty" | "revenueExVat" | "soldCost", Dec> }>();
  for (const r of results) {
    for (const mr of r.menuItems) {
      let e = menu.get(mr.key);
      if (!e) {
        e = { row: { ...mr }, v: { soldQty: ZERO, staffQty: ZERO, compQty: ZERO, wasteQty: ZERO, revenueExVat: ZERO, soldCost: ZERO } };
        menu.set(mr.key, e);
      }
      for (const f of Object.keys(e.v) as (keyof typeof e.v)[]) e.v[f] = e.v[f].plus(D(mr[f]));
      e.row.incomplete ||= mr.incomplete;
    }
  }
  const menuItems = [...menu.values()]
    .map(({ row, v }) => ({
      ...row,
      soldQty: v.soldQty.toString(),
      staffQty: v.staffQty.toString(),
      compQty: v.compQty.toString(),
      wasteQty: v.wasteQty.toString(),
      revenueExVat: v.revenueExVat.toString(),
      soldCost: v.soldCost.toString(),
      margin: v.revenueExVat.minus(v.soldCost).toString(),
      marginPct: v.revenueExVat.gt(0) ? v.revenueExVat.minus(v.soldCost).div(v.revenueExVat).toString() : null,
    }))
    .sort((a, b) => D(b.revenueExVat).comparedTo(D(a.revenueExVat)) || a.name.localeCompare(b.name));

  const pay = new Map<string, { orders: number; amount: Dec; treatment: string }>();
  const chan = new Map<string, { orders: number; gross: Dec; net: Dec }>();
  for (const r of results) {
    for (const p of r.payments) {
      const e = pay.get(p.method) ?? { orders: 0, amount: ZERO, treatment: p.treatment };
      e.orders += p.orders;
      e.amount = e.amount.plus(D(p.amount));
      pay.set(p.method, e);
    }
    for (const c of r.channels) {
      const e = chan.get(c.channel) ?? { orders: 0, gross: ZERO, net: ZERO };
      e.orders += c.orders;
      e.gross = e.gross.plus(D(c.gross));
      e.net = e.net.plus(D(c.net));
      chan.set(c.channel, e);
    }
  }

  const mv = (k: string) => metrics[k];
  const step = (key: string, label: string, kind: WaterfallStep["kind"], mk: string): WaterfallStep => ({ key, label, kind, value: mv(mk)?.value ?? "0", status: mv(mk)?.status ?? "unavailable" });
  const waterfall: WaterfallStep[] = results.length
    ? [
        mv("netSales")?.value !== null ? step("netSales", "Net sales (ex VAT)", "total", "netSales") : step("netSalesInclVat", "Net sales incl. VAT", "total", "netSalesInclVat"),
        step("ingredientCost", "Ingredients (sold)", "minus", "ingredientCost"),
        step("packagingCost", "Packaging (sold)", "minus", "packagingCost"),
        step("batchCost", "Karak batch", "minus", "batchCost"),
        step("grossProfit", "Gross profit", "total", "grossProfit"),
        step("staffConsumption", "Staff meals", "minus", "staffConsumption"),
        step("complimentaryConsumption", "Complimentary", "minus", "complimentaryConsumption"),
        step("wastage", "Wastage", "minus", "wastage"),
        step("manualCost", "Manual", "minus", "manualCost"),
        step("channelCommissions", "Commissions", "minus", "channelCommissions"),
        step("paymentFees", "Payment fees", "minus", "paymentFees"),
        step("fixedCosts", "Fixed costs", "minus", "fixedCosts"),
        step("operatingResult", "Operating result", "total", "operatingResult"),
      ]
    : [];

  return {
    from,
    to,
    days: input.map((d) => ({
      date: d.date,
      state: d.state,
      revision: d.revision,
      costingLabel: d.result?.costingLabel ?? null,
      netSales: d.result ? (d.result.metrics.netSales?.value ?? d.result.metrics.netSalesInclVat?.value ?? null) : null,
      reserve: d.result?.metrics.reserve?.value ?? null,
      cogs: d.result?.metrics.cogsSold?.value ?? null,
      operatingResult: d.result?.metrics.operatingResult?.value ?? null,
      incomplete: d.result?.metrics.reserve?.status === "incomplete",
    })),
    daysWithData: results.length,
    finalizedDays: days.filter((d) => d.state === "finalized").length,
    costingLabels: [...new Set(results.map((r) => r.costingLabel))],
    metrics,
    consumption,
    menuItems,
    payments: [...pay].map(([method, p]) => ({ method, orders: p.orders, amount: p.amount.toString(), treatment: p.treatment })),
    channels: [...chan].map(([channel, c]) => ({ channel, orders: c.orders, gross: c.gross.toString(), net: c.net.toString() })),
    karak: {
      batches: results.reduce((a, r) => a + r.karak.batches, 0),
      cups: sum(results.map((r) => D(r.karak.cups))).toString(),
      cost: sum(results.map((r) => D(r.karak.cost))).toString(),
      allocated: sum(results.map((r) => D(r.karak.allocated))).toString(),
      unallocated: sum(results.map((r) => D(r.karak.unallocated))).toString(),
    },
    waterfall,
    issues: results.flatMap((r) => r.issues.map((i) => ({ ...i, date: r.date }))),
    nonSales: results.flatMap((r) => r.records.filter((x) => x.bucket !== "sold" && x.bucket !== "batch").map((x) => ({ ...x, date: r.date }))),
  };
}

/** Records behind one consumption row, for drill-down. */
export function drillItem(input: RangeDay[], itemKey: string): (ConsumptionRecord & { date: string })[] {
  return input.flatMap((d) => (d.result?.records ?? []).filter((r) => r.itemKey === itemKey).map((r) => ({ ...r, date: d.date })));
}
