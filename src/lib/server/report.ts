import { and, asc, between, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { aggregateRange, type RangeSummary } from "../engine/aggregate";
import { assumptionsFor } from "../report";
import { defaultSettings, settingsSchema } from "../settings";
import { snapshotOf } from "./costing";
import { getDay, type DayView } from "./day";
import { computeFunding, type Funding } from "./ledger";
import { loadRange, reconcileRange, type RangeReconciliation } from "./range";

export type ReportData = {
  from: string;
  to: string;
  generatedAt: string;
  views: DayView[];
  summary: RangeSummary;
  funding: Funding;
  recon: RangeReconciliation;
  assumptions: { label: string; lines: string[] }[];
  revisions: { date: string; revision: number; reason: string; finalizedAt: Date; supersededAt: Date | null; name: string | null }[];
  status: "final" | "partly_final" | "provisional" | "empty";
};

async function assumptionSets(views: DayView[]): Promise<ReportData["assumptions"]> {
  const pairs = new Map<number, { costingId: number; dates: string[] }>();
  for (const v of views) {
    if (!v.result) continue;
    const e = pairs.get(v.result.settingsVersionId) ?? { costingId: v.result.costingVersionId, dates: [] };
    e.dates.push(v.date);
    pairs.set(v.result.settingsVersionId, e);
  }
  const out: ReportData["assumptions"] = [];
  for (const [id, { costingId, dates }] of pairs) {
    let value;
    if (id === 0) value = defaultSettings(await snapshotOf(costingId));
    else {
      const rows = await db.select({ v: schema.settingsVersions.value }).from(schema.settingsVersions).where(eq(schema.settingsVersions.id, id)).limit(1);
      value = rows[0] ? settingsSchema.parse(rows[0].v) : defaultSettings(await snapshotOf(costingId));
    }
    const span = dates.length === 1 ? dates[0] : `${dates[0]} to ${dates[dates.length - 1]}`;
    out.push({ label: `${id === 0 ? "Default settings (not yet saved)" : `Settings version ${id}`} · ${span}`, lines: assumptionsFor(value) });
  }
  return out;
}

/** Everything a report shows. Dashboard, report pages, PDF and Excel all read from this, so their totals agree. */
export async function loadReport(from: string, to: string, opts: { revision?: number; live?: boolean } = {}): Promise<ReportData> {
  let { views, summary } = await loadRange(from, to);
  if (opts.live && from === to) {
    views = [await getDay(from, { live: true })];
    summary = aggregateRange(from, to, views);
  } else if (opts.revision !== undefined && from === to) {
    const rows = await db
      .select({ payload: schema.dayFinalizations.payload, finalizedAt: schema.dayFinalizations.finalizedAt, name: schema.users.name })
      .from(schema.dayFinalizations)
      .leftJoin(schema.users, eq(schema.users.id, schema.dayFinalizations.finalizedBy))
      .where(and(eq(schema.dayFinalizations.businessDate, from), eq(schema.dayFinalizations.revision, opts.revision)))
      .limit(1);
    if (!rows[0]) throw new Error(`Revision ${opts.revision} of ${from} does not exist.`);
    views = [{ ...views[0], result: rows[0].payload, state: "finalized", revision: opts.revision, finalizedAt: rows[0].finalizedAt.toISOString(), finalizedBy: rows[0].name, liveDiff: null }];
    summary = aggregateRange(from, to, views);
  }
  const [funding, recon, assumptions, revisions] = await Promise.all([
    computeFunding(from, to, views),
    reconcileRange(views),
    assumptionSets(views),
    db
      .select({
        date: schema.dayFinalizations.businessDate,
        revision: schema.dayFinalizations.revision,
        reason: schema.dayFinalizations.reason,
        finalizedAt: schema.dayFinalizations.finalizedAt,
        supersededAt: schema.dayFinalizations.supersededAt,
        name: schema.users.name,
      })
      .from(schema.dayFinalizations)
      .leftJoin(schema.users, eq(schema.users.id, schema.dayFinalizations.finalizedBy))
      .where(and(between(schema.dayFinalizations.businessDate, from, to)))
      .orderBy(asc(schema.dayFinalizations.businessDate), asc(schema.dayFinalizations.revision)),
  ]);
  const withData = views.filter((v) => v.result);
  const fin = withData.filter((v) => v.state === "finalized").length;
  const status = withData.length === 0 ? "empty" : fin === withData.length ? "final" : fin > 0 ? "partly_final" : "provisional";
  return { from, to, generatedAt: new Date().toISOString(), views, summary, funding, recon, assumptions, revisions, status };
}

export const REPORT_STATUS_LABEL: Record<ReportData["status"], string> = {
  final: "FINAL – every day in the period is finalized",
  partly_final: "PARTLY FINAL – some days are still live calculations",
  provisional: "PROVISIONAL – live calculation, not finalized",
  empty: "NO DATA for this period",
};
