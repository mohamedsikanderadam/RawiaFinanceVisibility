import { and, desc, eq, gte, like, lte, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { isIsoDate } from "../dates";

export type Actor = { id: number; name: string } | null;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export async function audit(
  actor: Actor,
  action: string,
  entity: string,
  entityId: string | number | null,
  details: Record<string, unknown> = {},
  businessDate: string | null = null,
  tx: Tx | typeof db = db,
): Promise<void> {
  await tx.insert(schema.auditLog).values({
    userId: actor?.id ?? null,
    userName: actor?.name ?? "system",
    action,
    entity,
    entityId: entityId === null ? null : String(entityId),
    businessDate,
    details,
  });
}

export type { Tx };

export type AuditFilter = { area: string; date: string | null; from: string | null; to: string | null };

export function auditFilter(get: (k: string) => string | null | undefined): AuditFilter {
  const d = (k: string) => {
    const v = get(k);
    return isIsoDate(v) ? v : null;
  };
  return { area: get("area") ?? "", date: d("date"), from: d("from"), to: d("to") };
}

export async function queryAudit(f: AuditFilter, limit: number) {
  const where: SQL[] = [];
  if (f.area) where.push(like(schema.auditLog.action, `${f.area.replace(/[%_]/g, "")}%`));
  if (f.date) where.push(eq(schema.auditLog.businessDate, f.date));
  if (f.from) where.push(gte(schema.auditLog.at, new Date(`${f.from}T00:00:00+04:00`)));
  if (f.to) where.push(lte(schema.auditLog.at, new Date(`${f.to}T23:59:59.999+04:00`)));
  return db
    .select()
    .from(schema.auditLog)
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(schema.auditLog.at), desc(schema.auditLog.id))
    .limit(limit);
}
