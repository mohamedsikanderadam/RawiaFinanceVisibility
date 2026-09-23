import Link from "next/link";
import { notFound } from "next/navigation";
import { addOverrideAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { reconcileMenu } from "@/lib/costing/expand";
import type { CostItem, RecipeLine } from "@/lib/costing/types";
import { dubaiToday, fmtStamp } from "@/lib/dates";
import { D, fmtNum } from "@/lib/money";
import { can, pageSession } from "@/lib/server/auth";
import { getVersion } from "@/lib/server/costing";
import { settingsFor } from "@/lib/server/settings";

export const metadata = { title: "Costing version" };

const TABS = [
  ["menu", "Menu items"],
  ["items", "Ingredients & packaging"],
  ["issues", "Issues"],
  ["sheets", "Workbook structure"],
  ["fixed", "Fixed costs & fees"],
] as const;

const STATUS_TONE: Record<CostItem["costStatus"], string> = {
  ok: "text-olive",
  computed: "text-olive",
  override: "text-olive",
  confirmed_zero: "text-olive",
  bom_only: "text-amber",
  missing: "text-red font-semibold",
  invalid: "text-red font-semibold",
};

function refLabel(l: RecipeLine, names: Map<string, string>) {
  if (l.ref.type === "item") return names.get(l.ref.key) ?? l.ref.key;
  if (l.ref.type === "menu") return `${names.get(`menu:${l.ref.code}`) ?? l.ref.code} (sub-recipe)`;
  return `${l.rawName} (unresolved)`;
}

export default async function CostingVersionPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await pageSession("view_finance");
  const { id } = await params;
  const sp = await searchParams;
  const tab = typeof sp.tab === "string" && TABS.some(([k]) => k === sp.tab) ? sp.tab : "menu";
  const v = await getVersion(Number(id));
  if (!v) notFound();
  const snap = v.snapshot;
  const settings = await settingsFor(v.effectiveFrom ?? dubaiToday(), snap);
  const recon = reconcileMenu(snap, new Set([settings.value.karak.menuCode]));
  const names = new Map<string, string>([...snap.items.map((i) => [i.key, i.name] as [string, string]), ...snap.menu.map((m) => [`menu:${m.code}`, m.name] as [string, string])]);
  const canEdit = can(s.role, "costing");
  const errors = snap.issues.filter((i) => i.severity === "error").length;

  return (
    <>
      <PageHeader
        title={v.label}
        sub={
          <>
            {v.sourceFile} · sha256 {v.sourceSha256.slice(0, 12)} · {v.status}
            {v.effectiveFrom ? ` from ${v.effectiveFrom}` : ""} · parsed {fmtStamp(snap.parsedAt)} · {snap.items.length} items, {snap.menu.length} menu items, {snap.issues.length} issues ({errors} errors)
            {v.baseVersionId && (
              <>
                {" "}
                · based on{" "}
                <Link className="underline" href={`/costing/${v.baseVersionId}`}>
                  v{v.baseVersionId}
                </Link>
              </>
            )}
          </>
        }
        actions={
          <Link className="btn btn-ghost btn-sm" href="/costing">
            All versions
          </Link>
        }
      />
      {v.overrides.length > 0 && (
        <Card title="Corrections applied in this version" className="mb-4">
          <ul className="list-disc pl-5 text-sm">
            {v.overrides.map((o, i) => (
              <li key={i}>
                {o.type === "item_cost" ? `${names.get(o.itemKey) ?? o.itemKey}: unit cost set to AED ${o.unitCost}` : o.type === "item_zero" ? `${names.get(o.itemKey) ?? o.itemKey}: confirmed zero cost` : `${o.code}: packaging changed`} — {o.note}
              </li>
            ))}
          </ul>
        </Card>
      )}
      <nav className="mb-3 flex flex-wrap gap-1">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/costing/${v.id}?tab=${k}`} className={`rounded-lg px-3 py-1.5 text-sm font-semibold ${tab === k ? "bg-brown text-cream" : "bg-white text-brown ring-1 ring-cream-deep"}`}>
            {l}
          </Link>
        ))}
      </nav>

      {tab === "menu" && (
        <Card title="Menu items: app costing vs workbook Menu Master">
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Code</th>
                  <th>Item</th>
                  <th>Mode</th>
                  <th className="r">App food</th>
                  <th className="r">Workbook food</th>
                  <th className="r">Diff</th>
                  <th className="r">App packaging</th>
                  <th className="r">Workbook incl. pkg</th>
                  <th>Recipe / notes</th>
                </tr>
              </thead>
              <tbody>
                {recon.map((r) => {
                  const m = snap.menu.find((x) => x.code === r.code)!;
                  const bad = r.foodDiff && r.foodDiff.abs().gte(0.01);
                  return (
                    <tr key={r.code}>
                      <td className="text-xs">{r.code}</td>
                      <td className="font-medium">
                        {r.name}
                        <div className="text-xs text-ink-soft">{m.category}</div>
                      </td>
                      <td className="text-xs">{r.costMode.replace("_", " ")}</td>
                      <td className="r">
                        {fmtNum(r.appFood.toString(), 3)}
                        {r.incomplete && <span className="ml-1 text-xs text-red">incomplete</span>}
                      </td>
                      <td className="r">{r.workbookFood === null ? "—" : fmtNum(r.workbookFood, 3)}</td>
                      <td className={`r ${bad ? "font-bold text-red" : ""}`}>{r.foodDiff ? fmtNum(r.foodDiff.toString(), 3) : "—"}</td>
                      <td className="r">{fmtNum(r.appPackaging.toString(), 3)}</td>
                      <td className="r">{r.workbookWithPackaging === null ? "—" : fmtNum(r.workbookWithPackaging, 3)}</td>
                      <td className="text-xs">
                        <details>
                          <summary className="cursor-pointer">
                            {m.recipe.length} recipe lines{m.components.length ? `, ${m.components.length} combo components` : ""}
                            {m.packaging ? `, ${m.packaging.length} packaging` : ", no packaging"}
                          </summary>
                          <ul className="mt-1 space-y-0.5">
                            {m.recipe.map((l, i) => (
                              <li key={i}>
                                {refLabel(l, names)}: {l.qty ?? "?"} {l.unit ?? ""} <span className="text-ink-soft">({l.source})</span>
                              </li>
                            ))}
                            {m.components.map((c) => (
                              <li key={c.code}>
                                Combo component {names.get(`menu:${c.code}`) ?? c.code} × {c.qty}
                              </li>
                            ))}
                            {m.packaging?.map((p, i) => (
                              <li key={`p${i}`}>
                                Packaging {names.get(p.key) ?? p.key} × {p.qty}
                              </li>
                            ))}
                            <li className="text-ink-soft">Workbook: {m.workbook.foodFormula ?? "no formula"} | {m.workbook.packagingFormula ?? ""}</li>
                          </ul>
                        </details>
                        {r.missing.length > 0 && <div className="text-red">Missing: {r.missing.join(", ")}</div>}
                        {r.costMode === "total_only" && <div className="text-amber">Total cost only — ingredient allocation unavailable.</div>}
                        {r.code === settings.value.karak.menuCode && <div className="text-olive">Daily batch item: costed at AED {settings.value.karak.batchPrice} per batch, not per cup.</div>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {tab === "items" && (
        <Card title="Ingredients, prepared items and packaging">
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th>Kind</th>
                  <th>Supplier</th>
                  <th className="r">Purchase price</th>
                  <th className="r">Purchase qty</th>
                  <th className="r">Recipe-unit cost</th>
                  <th>Status</th>
                  {canEdit && <th>Correct</th>}
                </tr>
              </thead>
              <tbody>
                {snap.items.map((i) => (
                  <tr key={i.key}>
                    <td className="font-medium">
                      {i.name}
                      <div className="text-xs text-ink-soft">{i.source}</div>
                    </td>
                    <td className="text-xs">{i.kind}</td>
                    <td className="text-xs">{i.supplier}</td>
                    <td className="r">{i.purchasePrice === null ? "—" : fmtNum(i.purchasePrice, 2)}</td>
                    <td className="r text-xs">
                      {i.purchaseQty ?? "—"} {i.purchaseUnitLabel ?? ""}
                    </td>
                    <td className="r">{i.unitCost === null ? "—" : `${fmtNum(i.unitCost, 5)} / ${i.baseUnit ?? "?"}`}</td>
                    <td className={`text-xs ${STATUS_TONE[i.costStatus]}`}>
                      {i.costStatus.replace("_", " ")}
                      {i.costNote && <div className="font-normal text-ink-soft">{i.costNote}</div>}
                      {i.prepared && (
                        <div className="font-normal text-ink-soft">
                          Prepared: yield {i.prepared.yieldQty ?? "?"} {i.baseUnit}, breakdown {i.prepared.breakdown}. {i.prepared.note}
                        </div>
                      )}
                    </td>
                    {canEdit && (
                      <td>
                        <ActionForm action={addOverrideAction} className="flex flex-wrap items-center gap-1">
                          <input type="hidden" name="versionId" value={v.id} />
                          <input type="hidden" name="itemKey" value={i.key} />
                          <select name="kind" className="input w-auto py-1 text-xs" aria-label="Correction type" defaultValue="cost">
                            <option value="cost">Unit cost</option>
                            <option value="zero">Confirm zero cost</option>
                          </select>
                          <input name="unitCost" placeholder={`AED / ${i.baseUnit ?? "unit"}`} inputMode="decimal" className="input w-24 py-1 text-xs" />
                          <input name="note" placeholder="Reason (required)" className="input w-32 py-1 text-xs" />
                          <Submit className="btn btn-ghost btn-sm">New version</Submit>
                        </ActionForm>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-soft">Recipe-unit cost = purchase price ÷ usable quantity in grams, ml or pieces (kg and litres are converted). A correction creates a new draft version; the original import is never modified.</p>
        </Card>
      )}

      {tab === "issues" && (
        <Card title={`Issues found in the workbook (${snap.issues.length})`}>
          <table className="data">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Issue</th>
                <th>Source</th>
              </tr>
            </thead>
            <tbody>
              {snap.issues.map((i, k) => (
                <tr key={k}>
                  <td className={i.severity === "error" ? "font-semibold text-red" : i.severity === "warning" ? "text-amber" : "text-ink-soft"}>{i.severity}</td>
                  <td>{i.message}</td>
                  <td className="text-xs">{i.source}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      {tab === "sheets" && (
        <Card title="Sheets detected">
          <table className="data">
            <thead>
              <tr>
                <th>Sheet</th>
                <th>State</th>
                <th className="r">Rows</th>
                <th className="r">Columns</th>
                <th>Used as</th>
              </tr>
            </thead>
            <tbody>
              {snap.sheets.map((sh) => (
                <tr key={sh.name}>
                  <td className="font-medium">{sh.name}</td>
                  <td>{sh.state}</td>
                  <td className="r">{sh.rows}</td>
                  <td className="r">{sh.cols}</td>
                  <td className="text-xs">{sh.role ?? "not used"}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {snap.orphanRecipes.length > 0 && <p className="mt-2 text-sm">BOM recipes with no menu item: {snap.orphanRecipes.map((o) => o.name).join(", ")}</p>}
        </Card>
      )}

      {tab === "fixed" && (
        <div className="grid gap-4 md:grid-cols-2">
          <Card title="Fixed costs in the workbook">
            <table className="data">
              <tbody>
                {snap.fixedExpenses.map((f) => (
                  <tr key={f.name}>
                    <td>{f.name}</td>
                    <td className="r">{f.monthly === null ? "—" : fmtNum(f.monthly, 2)}</td>
                    <td className="text-xs text-ink-soft">{f.source}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="font-bold">Total</td>
                  <td className="r font-bold">{fmtNum(snap.fixedExpenses.reduce((a, f) => a.plus(f.monthly ?? 0), D(0)).toString(), 2)}</td>
                  <td />
                </tr>
              </tfoot>
            </table>
            <p className="mt-2 text-xs text-ink-soft">
              Which lines are included is set in{" "}
              <Link className="underline" href="/settings">
                Settings
              </Link>
              .
            </p>
          </Card>
          <Card title="Aggregator commission rates in the workbook">
            <table className="data">
              <tbody>
                {snap.aggregatorRates.map((a) => (
                  <tr key={a.channel}>
                    <td>{a.channel}</td>
                    <td className="r">{a.ratePct}%</td>
                    <td className="text-xs text-ink-soft">
                      {a.formula} ({a.source})
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
      )}
    </>
  );
}
