import { auditFilter, queryAudit } from "@/lib/server/audit";
import { download, guarded } from "@/lib/server/http";

function csv(v: unknown): string {
  const s = v === null || v === undefined ? "" : v instanceof Date ? v.toISOString() : typeof v === "object" ? JSON.stringify(v) : String(v);
  const safe = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s;
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe;
}

export async function GET(req: Request) {
  return guarded("view_finance", async () => {
    const url = new URL(req.url);
    const rows = await queryAudit(auditFilter((k) => url.searchParams.get(k)), 100_000);
    const head = ["id", "at_utc", "user_id", "user_name", "action", "entity", "entity_id", "business_date", "details"];
    const body = rows.map((r) => [r.id, r.at, r.userId, r.userName, r.action, r.entity, r.entityId, r.businessDate, r.details].map(csv).join(","));
    return download([head.join(","), ...body].join("\r\n") + "\r\n", `RAWIA_audit_trail_${new Date().toISOString().slice(0, 10)}.csv`, "text/csv; charset=utf-8");
  });
}
