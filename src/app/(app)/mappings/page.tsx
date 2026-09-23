import { desc, eq } from "drizzle-orm";
import { deleteMappingAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/action-form";
import { MappingForm } from "@/components/mapping-form";
import { Card, PageHeader } from "@/components/ui";
import { db, schema } from "@/db";
import { dubaiToday, fmtStamp } from "@/lib/dates";
import { mappingKey, matchPosName } from "@/lib/sales/mapping";
import { can, pageSession } from "@/lib/server/auth";
import { costingFor } from "@/lib/server/costing";
import { savedMappings } from "@/lib/server/sales";

export const metadata = { title: "Item mapping" };

/** POS names seen in stored orders that have no saved mapping yet. */
async function seenPosNames(): Promise<Map<string, number>> {
  const rows = await db.select({ lines: schema.orders.lines }).from(schema.orders);
  const m = new Map<string, number>();
  for (const r of rows) for (const l of r.lines) m.set(l.posName, (m.get(l.posName) ?? 0) + l.qty);
  return m;
}

export default async function MappingsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await pageSession("view");
  const sp = await searchParams;
  const focus = typeof sp.pos === "string" ? sp.pos : null;
  const canMap = can(s.role, "map");
  const [rows, costing, seen, saved] = await Promise.all([
    db.select({ m: schema.itemMappings, name: schema.users.name }).from(schema.itemMappings).leftJoin(schema.users, eq(schema.users.id, schema.itemMappings.updatedBy)).orderBy(desc(schema.itemMappings.updatedAt)),
    costingFor(dubaiToday()),
    seenPosNames(),
    savedMappings(),
  ]);
  const snap = costing?.snapshot ?? null;
  const menu = snap?.menu.map((m) => ({ code: m.code, name: m.name })) ?? [];
  const menuName = new Map(menu.map((m) => [m.code, m.name]));
  const unsaved = [...seen]
    .filter(([n]) => !saved.has(mappingKey(n)))
    .map(([posName, qty]) => ({ posName, qty, match: snap ? matchPosName(posName, snap, saved) : null }))
    .sort((a, b) => Number(a.match?.how === "exact") - Number(b.match?.how === "exact") || (focus === b.posName ? 1 : 0) - (focus === a.posName ? 1 : 0) || b.qty - a.qty);

  return (
    <>
      <PageHeader title="POS item mapping" sub={`POS names are matched to workbook menu items by Item ID or exact name; anything else needs a saved mapping. Costing in use: ${costing?.label ?? "none"}.`} />
      <Card title={`Imported POS items without a saved mapping (${unsaved.length})`}>
        {unsaved.length === 0 ? (
          <p className="text-sm text-ink-soft">All imported POS items have saved mappings.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>POS item</th>
                  <th className="r">Qty sold</th>
                  <th>Automatic match</th>
                  {canMap && <th>Save mapping</th>}
                </tr>
              </thead>
              <tbody>
                {unsaved.map((u) => (
                  <tr key={u.posName} className={focus === u.posName ? "bg-amber-soft" : ""}>
                    <td className="font-medium">{u.posName}</td>
                    <td className="r">{u.qty}</td>
                    <td className="text-xs">
                      {u.match?.menuCode ? `${u.match.how}: ${menuName.get(u.match.menuCode)} (${u.match.menuCode})` : <span className="font-semibold text-red">no match – cost missing</span>}
                    </td>
                    {canMap && (
                      <td>
                        <MappingForm posName={u.posName} current={u.match?.menuCode ?? null} candidates={u.match?.candidates ?? []} menu={menu} />
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Card title={`Saved mappings (${rows.length})`} className="mt-4">
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>POS name</th>
                <th>Workbook item</th>
                <th>Note</th>
                <th>Updated</th>
                {canMap && <th />}
              </tr>
            </thead>
            <tbody>
              {rows.map(({ m, name }) => (
                <tr key={m.id}>
                  <td className="font-medium">{m.posName}</td>
                  <td>{m.ignored ? <i>Ignored (no stock)</i> : m.menuCode ? `${menuName.get(m.menuCode) ?? "Not in current costing!"} (${m.menuCode})` : "—"}</td>
                  <td className="text-xs">{m.note}</td>
                  <td className="text-xs">
                    {fmtStamp(m.updatedAt)} · {name}
                  </td>
                  {canMap && (
                    <td className="flex flex-wrap gap-1">
                      <MappingForm posName={m.posName} current={m.ignored ? "__ignore" : m.menuCode} candidates={[]} menu={menu} />
                      <ActionForm action={deleteMappingAction} confirm="Remove this mapping?">
                        <input type="hidden" name="posName" value={m.posName} />
                        <Submit className="btn btn-ghost btn-sm">Remove</Submit>
                      </ActionForm>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
