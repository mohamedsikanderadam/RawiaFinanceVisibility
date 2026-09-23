import { db, schema } from "@/db";
import { audit } from "@/lib/server/audit";
import { download, guarded } from "@/lib/server/http";

/** Complete JSON export of every table except password hashes. */
export async function GET() {
  return guarded("backup", async (s) => {
    const [users, costingVersions, settingsVersions, itemMappings, salesImports, orders, orderDecisions, adjustments, ledgerEntries, dayFinalizations, auditLog] = await Promise.all([
      db.select({ id: schema.users.id, email: schema.users.email, name: schema.users.name, role: schema.users.role, active: schema.users.active, createdAt: schema.users.createdAt }).from(schema.users),
      db.select().from(schema.costingVersions),
      db.select().from(schema.settingsVersions),
      db.select().from(schema.itemMappings),
      db.select().from(schema.salesImports),
      db.select().from(schema.orders),
      db.select().from(schema.orderDecisions),
      db.select().from(schema.adjustments),
      db.select().from(schema.ledgerEntries),
      db.select().from(schema.dayFinalizations),
      db.select().from(schema.auditLog),
    ]);
    const tables = { users, costingVersions, settingsVersions, itemMappings, salesImports, orders, orderDecisions, adjustments, ledgerEntries, dayFinalizations, auditLog };
    const counts = Object.fromEntries(Object.entries(tables).map(([k, v]) => [k, v.length]));
    await audit(s, "backup.export", "database", null, { counts });
    const at = new Date().toISOString();
    return download(JSON.stringify({ format: "rawia-finance-backup", version: 1, exportedAt: at, exportedBy: s.email, counts, tables }), `RAWIA_backup_${at.replace(/[:.]/g, "-")}.json`, "application/json");
  });
}
