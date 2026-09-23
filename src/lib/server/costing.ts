import { and, asc, desc, eq, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import { parseCostingWorkbook } from "../costing/workbook";
import { applyOverrides, type CostingOverride } from "../costing/snapshot";
import type { CostingSnapshot } from "../costing/types";
import { audit, type Actor } from "./audit";

export type CostingVersionRow = typeof schema.costingVersions.$inferSelect;

export async function importWorkbook(buffer: Buffer, fileName: string, actor: Actor, note = ""): Promise<CostingVersionRow> {
  const snapshot = await parseCostingWorkbook(buffer, fileName);
  const count = await db.$count(schema.costingVersions);
  const [row] = await db
    .insert(schema.costingVersions)
    .values({
      label: `v${count + 1} – ${fileName}`,
      sourceFile: fileName,
      sourceSha256: snapshot.sourceSha256,
      snapshot,
      overrides: [],
      note,
      createdBy: actor?.id ?? null,
    })
    .returning();
  await audit(actor, "costing.import", "costing_version", row.id, {
    fileName,
    sha256: snapshot.sourceSha256,
    items: snapshot.items.length,
    menu: snapshot.menu.length,
    issues: snapshot.issues.length,
  });
  return row;
}

/** Creates a new draft version = root workbook import + the full list of owner corrections. */
export async function deriveVersion(fromId: number, overrides: CostingOverride[], note: string, actor: Actor): Promise<CostingVersionRow> {
  const from = await getVersion(fromId);
  if (!from) throw new Error("Costing version not found.");
  const rootId = from.baseVersionId ?? from.id;
  const root = rootId === from.id ? from : await getVersion(rootId);
  if (!root) throw new Error("Base costing version not found.");
  const snapshot = applyOverrides(root.snapshot, overrides);
  const count = await db.$count(schema.costingVersions);
  const [row] = await db
    .insert(schema.costingVersions)
    .values({
      label: `v${count + 1} – ${root.sourceFile} + ${overrides.length} correction${overrides.length === 1 ? "" : "s"}`,
      sourceFile: root.sourceFile,
      sourceSha256: root.sourceSha256,
      baseVersionId: root.id,
      overrides,
      snapshot,
      note,
      createdBy: actor?.id ?? null,
    })
    .returning();
  await audit(actor, "costing.derive", "costing_version", row.id, { from: fromId, root: root.id, overrides, note });
  return row;
}

export async function activateVersion(id: number, effectiveFrom: string, actor: Actor): Promise<void> {
  const v = await getVersion(id);
  if (!v) throw new Error("Costing version not found.");
  await db.update(schema.costingVersions).set({ status: "active", effectiveFrom, activatedAt: new Date() }).where(eq(schema.costingVersions.id, id));
  await audit(actor, "costing.activate", "costing_version", id, { effectiveFrom, label: v.label });
}

export async function archiveVersion(id: number, actor: Actor): Promise<void> {
  await db.update(schema.costingVersions).set({ status: "archived" }).where(eq(schema.costingVersions.id, id));
  await audit(actor, "costing.archive", "costing_version", id);
}

export async function getVersion(id: number): Promise<CostingVersionRow | null> {
  const rows = await db.select().from(schema.costingVersions).where(eq(schema.costingVersions.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function listVersions(): Promise<Omit<CostingVersionRow, "snapshot">[]> {
  return db
    .select({
      id: schema.costingVersions.id,
      label: schema.costingVersions.label,
      sourceFile: schema.costingVersions.sourceFile,
      sourceSha256: schema.costingVersions.sourceSha256,
      baseVersionId: schema.costingVersions.baseVersionId,
      overrides: schema.costingVersions.overrides,
      status: schema.costingVersions.status,
      effectiveFrom: schema.costingVersions.effectiveFrom,
      note: schema.costingVersions.note,
      createdBy: schema.costingVersions.createdBy,
      createdAt: schema.costingVersions.createdAt,
      activatedAt: schema.costingVersions.activatedAt,
    })
    .from(schema.costingVersions)
    .orderBy(desc(schema.costingVersions.id));
}

export type CostingForDate = { id: number; label: string; snapshot: CostingSnapshot; effectiveFrom: string | null; beforeEffective: boolean };

// Snapshots are immutable once stored, so they can be cached by version id.
const snapshotCache = new Map<number, CostingSnapshot>();

export async function snapshotOf(id: number): Promise<CostingSnapshot> {
  const hit = snapshotCache.get(id);
  if (hit) return hit;
  const rows = await db.select({ s: schema.costingVersions.snapshot }).from(schema.costingVersions).where(eq(schema.costingVersions.id, id)).limit(1);
  if (!rows[0]) throw new Error(`Costing version ${id} not found.`);
  snapshotCache.set(id, rows[0].s);
  return rows[0].s;
}

/** The active costing version in effect on `date` (latest effective-from ≤ date; later activation wins ties). */
export async function costingFor(date: string): Promise<CostingForDate | null> {
  const meta = { id: schema.costingVersions.id, label: schema.costingVersions.label, effectiveFrom: schema.costingVersions.effectiveFrom };
  const active = eq(schema.costingVersions.status, "active");
  const rows = await db
    .select(meta)
    .from(schema.costingVersions)
    .where(and(active, lte(schema.costingVersions.effectiveFrom, date)))
    .orderBy(desc(schema.costingVersions.effectiveFrom), desc(schema.costingVersions.activatedAt))
    .limit(1);
  if (rows[0]) return { ...rows[0], snapshot: await snapshotOf(rows[0].id), beforeEffective: false };
  const earliest = await db.select(meta).from(schema.costingVersions).where(active).orderBy(asc(schema.costingVersions.effectiveFrom)).limit(1);
  const e = earliest[0];
  return e ? { ...e, snapshot: await snapshotOf(e.id), beforeEffective: true } : null;
}
