import { and, asc, between, desc, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { computeDay } from "../engine/compute";
import type { DayResult, EngineAdjustment, EngineOrder } from "../engine/types";
import { matchPosName } from "../sales/mapping";
import type { PrepState } from "../settings";
import { daysBetween } from "../dates";
import { audit, type Actor } from "./audit";
import { costingFor } from "./costing";
import { settingsFor } from "./settings";
import { savedMappings } from "./sales";

export type DayView = {
  date: string;
  result: DayResult | null;
  state: "no_data" | "live" | "finalized";
  revision: number | null;
  finalizedAt: string | null;
  finalizedBy: string | null;
  /** Present when the day is finalized and the live recalculation differs. */
  liveDiff: { reserve: string | null; netSales: string | null } | null;
  noCostingReason: string | null;
};

async function loadOrders(dates: string[]) {
  if (!dates.length) return [];
  return db.select().from(schema.orders).where(inArray(schema.orders.businessDate, dates)).orderBy(asc(schema.orders.submittedAt));
}

export async function computeLive(date: string): Promise<{ result: DayResult | null; reason: string | null }> {
  const costing = await costingFor(date);
  if (!costing) return { result: null, reason: "No active costing version." };
  const settings = await settingsFor(date, costing.snapshot);
  const saved = await savedMappings();
  const orderRows = await loadOrders([date]);
  const orders: EngineOrder[] = orderRows.map((o) => ({
    orderKey: o.orderKey,
    orderNumber: o.orderNumber,
    businessDate: o.businessDate,
    submittedAt: o.submittedAt,
    spotType: o.spotType,
    deliveryApp: o.deliveryApp,
    status: o.status,
    staffMeal: o.staffMeal,
    staffMealFor: o.staffMealFor,
    totalSales: o.totalSales,
    discountAmount: o.discountAmount,
    subtotalAfterDiscount: o.subtotalAfterDiscount,
    vat: o.vat,
    salesAfterDiscount: o.salesAfterDiscount,
    paid: o.paid,
    refunded: o.refunded,
    netReceived: o.netReceived,
    paymentMethods: o.paymentMethods,
    lines: o.lines.map((l) => ({ lineKey: l.lineKey, posName: l.posName, qty: l.qty, menuCode: matchPosName(l.posName, costing.snapshot, saved).menuCode })),
  }));
  const keys = orders.map((o) => o.orderKey);
  const decisionRows = keys.length ? await db.select().from(schema.orderDecisions).where(inArray(schema.orderDecisions.orderKey, keys)) : [];
  const decisions = new Map<string, PrepState>(decisionRows.map((d) => [d.orderKey, d.prep]));
  const adjRows = await db
    .select()
    .from(schema.adjustments)
    .where(and(eq(schema.adjustments.businessDate, date), isNull(schema.adjustments.voidedAt)))
    .orderBy(asc(schema.adjustments.id));
  const adjustments: EngineAdjustment[] = adjRows.map((a) => ({ id: a.id, businessDate: a.businessDate, type: a.type, menuCode: a.menuCode, itemKey: a.itemKey, qty: a.qty, amount: a.amount, note: a.note }));
  if (!orders.length && !adjustments.length) return { result: null, reason: null };
  const result = computeDay({
    date,
    snapshot: costing.snapshot,
    costingVersion: { id: costing.id, label: costing.label },
    settings: settings.value,
    settingsVersionId: settings.id,
    orders,
    decisions,
    adjustments,
  });
  if (costing.beforeEffective) {
    result.issues.unshift({ severity: "warning", code: "costing_before_effective", message: `No costing version was effective on ${date}; used ${costing.label} (effective ${costing.effectiveFrom}).` });
  }
  if (settings.isDefault) {
    result.issues.push({ severity: "info", code: "settings_default", message: "Using default settings derived from the workbook; no saved settings version applies to this date." });
  }
  return { result, reason: null };
}

async function currentFinal(date: string) {
  const rows = await db
    .select({ f: schema.dayFinalizations, name: schema.users.name })
    .from(schema.dayFinalizations)
    .leftJoin(schema.users, eq(schema.users.id, schema.dayFinalizations.finalizedBy))
    .where(and(eq(schema.dayFinalizations.businessDate, date), isNull(schema.dayFinalizations.supersededAt)))
    .orderBy(desc(schema.dayFinalizations.revision))
    .limit(1);
  return rows[0] ?? null;
}

/** Finalized days return their stored snapshot; open days are recalculated from current data. */
export async function getDay(date: string, opts: { live?: boolean } = {}): Promise<DayView> {
  const fin = await currentFinal(date);
  if (fin && !opts.live) {
    const live = await computeLive(date);
    const lr = live.result;
    const differs = (k: string) => (lr?.metrics[k]?.value ?? null) !== (fin.f.payload.metrics[k]?.value ?? null);
    return {
      date,
      result: fin.f.payload,
      state: "finalized",
      revision: fin.f.revision,
      finalizedAt: fin.f.finalizedAt.toISOString(),
      finalizedBy: fin.name,
      liveDiff: differs("reserve") || differs("netSales") ? { reserve: lr?.metrics.reserve?.value ?? null, netSales: lr?.metrics.netSales?.value ?? null } : null,
      noCostingReason: null,
    };
  }
  const live = await computeLive(date);
  return {
    date,
    result: live.result,
    state: live.result ? "live" : "no_data",
    revision: fin?.f.revision ?? null,
    finalizedAt: null,
    finalizedBy: null,
    liveDiff: null,
    noCostingReason: live.reason,
  };
}

/** Days in range: finalized snapshots where they exist, otherwise live results. */
export async function getRange(from: string, to: string): Promise<DayView[]> {
  const days = daysBetween(from, to);
  const finals = await db
    .select({ f: schema.dayFinalizations, name: schema.users.name })
    .from(schema.dayFinalizations)
    .leftJoin(schema.users, eq(schema.users.id, schema.dayFinalizations.finalizedBy))
    .where(and(between(schema.dayFinalizations.businessDate, from, to), isNull(schema.dayFinalizations.supersededAt)));
  const finByDate = new Map(finals.map((r) => [r.f.businessDate, r]));
  const withOrders = new Set(
    (
      await db
        .selectDistinct({ d: schema.orders.businessDate })
        .from(schema.orders)
        .where(between(schema.orders.businessDate, from, to))
    ).map((r) => r.d),
  );
  const withAdj = new Set(
    (
      await db
        .selectDistinct({ d: schema.adjustments.businessDate })
        .from(schema.adjustments)
        .where(and(between(schema.adjustments.businessDate, from, to), isNull(schema.adjustments.voidedAt)))
    ).map((r) => r.d),
  );
  const out: DayView[] = [];
  for (const d of days) {
    const f = finByDate.get(d);
    if (f) {
      out.push({ date: d, result: f.f.payload, state: "finalized", revision: f.f.revision, finalizedAt: f.f.finalizedAt.toISOString(), finalizedBy: f.name, liveDiff: null, noCostingReason: null });
    } else if (withOrders.has(d) || withAdj.has(d)) {
      const live = await computeLive(d);
      out.push({ date: d, result: live.result, state: live.result ? "live" : "no_data", revision: null, finalizedAt: null, finalizedBy: null, liveDiff: null, noCostingReason: live.reason });
    } else {
      out.push({ date: d, result: null, state: "no_data", revision: null, finalizedAt: null, finalizedBy: null, liveDiff: null, noCostingReason: null });
    }
  }
  return out;
}

export async function finalizeDay(date: string, reason: string, actor: Actor): Promise<number> {
  const live = await computeLive(date);
  if (!live.result) throw new Error(live.reason ?? "No sales or adjustments for this date.");
  const result = live.result;
  return db.transaction(async (tx) => {
    const prev = await tx
      .select()
      .from(schema.dayFinalizations)
      .where(eq(schema.dayFinalizations.businessDate, date))
      .orderBy(desc(schema.dayFinalizations.revision))
      .for("update");
    const revision = (prev[0]?.revision ?? 0) + 1;
    if (prev[0] && !reason.trim()) throw new Error("A reason is required to revise a finalized day.");
    await tx
      .update(schema.dayFinalizations)
      .set({ supersededAt: new Date() })
      .where(and(eq(schema.dayFinalizations.businessDate, date), isNull(schema.dayFinalizations.supersededAt)));
    await tx.insert(schema.dayFinalizations).values({ businessDate: date, revision, payload: result, reason, finalizedBy: actor?.id ?? null });
    await audit(
      actor,
      revision === 1 ? "day.finalize" : "day.revise",
      "day",
      date,
      { revision, reason, reserve: result.metrics.reserve?.value, netSales: result.metrics.netSales?.value, costing: result.costingLabel, previous: prev[0] ? { revision: prev[0].revision, reserve: prev[0].payload.metrics.reserve?.value, netSales: prev[0].payload.metrics.netSales?.value } : null },
      date,
      tx,
    );
    return revision;
  });
}

export async function dayRevisions(date: string) {
  return db
    .select({
      id: schema.dayFinalizations.id,
      revision: schema.dayFinalizations.revision,
      reason: schema.dayFinalizations.reason,
      finalizedAt: schema.dayFinalizations.finalizedAt,
      supersededAt: schema.dayFinalizations.supersededAt,
      name: schema.users.name,
      payload: schema.dayFinalizations.payload,
    })
    .from(schema.dayFinalizations)
    .leftJoin(schema.users, eq(schema.users.id, schema.dayFinalizations.finalizedBy))
    .where(eq(schema.dayFinalizations.businessDate, date))
    .orderBy(desc(schema.dayFinalizations.revision));
}

export async function getRevision(date: string, revision: number): Promise<DayResult | null> {
  const rows = await db
    .select({ p: schema.dayFinalizations.payload })
    .from(schema.dayFinalizations)
    .where(and(eq(schema.dayFinalizations.businessDate, date), eq(schema.dayFinalizations.revision, revision)))
    .limit(1);
  return rows[0]?.p ?? null;
}

export async function setDecision(orderKey: string, prep: PrepState, note: string, actor: Actor): Promise<void> {
  const o = await db.select({ d: schema.orders.businessDate }).from(schema.orders).where(eq(schema.orders.orderKey, orderKey)).limit(1);
  if (!o[0]) throw new Error("Order not found.");
  await db
    .insert(schema.orderDecisions)
    .values({ orderKey, prep, note, updatedBy: actor?.id ?? null })
    .onConflictDoUpdate({ target: schema.orderDecisions.orderKey, set: { prep, note, updatedBy: actor?.id ?? null, updatedAt: new Date() } });
  await audit(actor, "order.prep_decision", "order", orderKey, { prep, note }, o[0].d);
}

export type NewAdjustment = Omit<EngineAdjustment, "id">;

export async function addAdjustment(a: NewAdjustment, actor: Actor): Promise<number> {
  const [row] = await db
    .insert(schema.adjustments)
    .values({ businessDate: a.businessDate, type: a.type, menuCode: a.menuCode, itemKey: a.itemKey, qty: a.qty, amount: a.amount, note: a.note, createdBy: actor?.id ?? null })
    .returning({ id: schema.adjustments.id });
  await audit(actor, "adjustment.add", "adjustment", row.id, { ...a }, a.businessDate);
  return row.id;
}

export async function voidAdjustment(id: number, actor: Actor): Promise<void> {
  const rows = await db.update(schema.adjustments).set({ voidedAt: new Date(), voidedBy: actor?.id ?? null }).where(eq(schema.adjustments.id, id)).returning();
  if (rows[0]) await audit(actor, "adjustment.void", "adjustment", id, { type: rows[0].type, note: rows[0].note }, rows[0].businessDate);
}

export async function listAdjustments(date: string) {
  return db
    .select({ a: schema.adjustments, name: schema.users.name })
    .from(schema.adjustments)
    .leftJoin(schema.users, eq(schema.users.id, schema.adjustments.createdBy))
    .where(eq(schema.adjustments.businessDate, date))
    .orderBy(asc(schema.adjustments.id));
}

export async function ordersFor(date: string) {
  const rows = await loadOrders([date]);
  const keys = rows.map((r) => r.orderKey);
  const dec = keys.length ? await db.select().from(schema.orderDecisions).where(inArray(schema.orderDecisions.orderKey, keys)) : [];
  const m = new Map(dec.map((d) => [d.orderKey, d]));
  return rows.map((r) => ({ ...r, decision: m.get(r.orderKey) ?? null }));
}

export async function ordersBetween(from: string, to: string) {
  return db.select().from(schema.orders).where(between(schema.orders.businessDate, from, to)).orderBy(asc(schema.orders.businessDate), asc(schema.orders.submittedAt));
}
