import { desc } from "drizzle-orm";
import { db, schema } from "@/db";
import { addDays, dubaiToday, isIsoDate, presetRange, type RangePreset } from "../dates";
import { aggregateRange, type RangeSummary } from "../engine/aggregate";
import { getRange, type DayView } from "./day";
import { snapshotOf } from "./costing";
import { reconcileSold, type SoldReconciliation } from "../engine/reconcile";
import { D, ZERO, type Dec } from "../money";

export type SearchParams = Record<string, string | string[] | undefined>;

const PRESETS: RangePreset[] = ["today", "yesterday", "week", "month", "custom"];
const MAX_DAYS = 400;

export type ResolvedRange = { preset: RangePreset; anchor: string; from: string; to: string };

export function resolveRange(sp: SearchParams): ResolvedRange {
  const one = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : undefined);
  const preset = (PRESETS as string[]).includes(one("preset") ?? "") ? (one("preset") as RangePreset) : one("from") ? "custom" : "today";
  const anchor = isIsoDate(one("date")) ? one("date")! : dubaiToday();
  const { to, from: rawFrom } = presetRange(preset, anchor, { from: one("from"), to: one("to") });
  const from = addDays(rawFrom, MAX_DAYS) < to ? addDays(to, -MAX_DAYS) : rawFrom;
  return { preset, anchor, from, to };
}

export async function loadRange(from: string, to: string): Promise<{ views: DayView[]; summary: RangeSummary }> {
  const views = await getRange(from, to);
  return { views, summary: aggregateRange(from, to, views) };
}

export async function latestSalesDate(): Promise<string | null> {
  const r = await db.select({ d: schema.orders.businessDate }).from(schema.orders).orderBy(desc(schema.orders.businessDate)).limit(1);
  return r[0]?.d ?? null;
}

export function rangeQuery(r: { from: string; to: string }): string {
  return `preset=custom&from=${r.from}&to=${r.to}`;
}

export type RangeReconciliation = { rows: SoldReconciliation[]; appTotal: string; workbookTotal: string; diffTotal: string };

/** Per-day reconciliation against each day's own costing version, merged by menu item. */
export async function reconcileRange(views: DayView[]): Promise<RangeReconciliation> {
  const merged = new Map<string, { row: SoldReconciliation; qty: Dec; app: Dec; wb: Dec | null }>();
  let appTotal = ZERO;
  let wbTotal = ZERO;
  for (const v of views) {
    if (!v.result) continue;
    const snap = await snapshotOf(v.result.costingVersionId);
    const r = reconcileSold(v.result.menuItems, snap, v.result.karak.menuCode);
    appTotal = appTotal.plus(D(r.appTotal));
    wbTotal = wbTotal.plus(D(r.workbookTotal));
    for (const row of r.rows) {
      const e = merged.get(row.code) ?? { row: { ...row }, qty: ZERO, app: ZERO, wb: ZERO };
      e.qty = e.qty.plus(D(row.qty));
      e.app = e.app.plus(D(row.appCost));
      e.wb = e.wb === null || row.workbookCost === null ? null : e.wb.plus(D(row.workbookCost));
      e.row.incomplete ||= row.incomplete;
      merged.set(row.code, e);
    }
  }
  const rows = [...merged.values()]
    .map(({ row, qty, app, wb }) => ({ ...row, qty: qty.toString(), appCost: app.toString(), workbookCost: wb?.toString() ?? null, diff: wb ? app.minus(wb).toString() : null }))
    .sort((a, b) => D(b.diff ?? 0).abs().comparedTo(D(a.diff ?? 0).abs()));
  return { rows, appTotal: appTotal.toString(), workbookTotal: wbTotal.toString(), diffTotal: appTotal.minus(wbTotal).toString() };
}
