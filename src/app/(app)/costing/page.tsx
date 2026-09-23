import Link from "next/link";
import { activateVersionAction, archiveVersionAction, importWorkbookAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/action-form";
import { Card, PageHeader } from "@/components/ui";
import { dubaiToday, fmtStamp } from "@/lib/dates";
import { can, pageSession } from "@/lib/server/auth";
import { listVersions } from "@/lib/server/costing";

export const metadata = { title: "Costing" };

export default async function CostingPage() {
  const s = await pageSession("view_finance");
  const versions = await listVersions();
  const canEdit = can(s.role, "costing");
  return (
    <>
      <PageHeader title="Costing versions" sub="Each workbook import or correction creates a new immutable version. Finalized days keep the version they were calculated with." />
      {canEdit && (
        <Card title="Import costing workbook" className="mb-4">
          <ActionForm action={importWorkbookAction} className="flex flex-wrap items-end gap-2">
            <label>
              <span className="label">Workbook (.xlsx)</span>
              <input type="file" name="file" accept=".xlsx" required className="input" />
            </label>
            <label className="flex-1">
              <span className="label">Note</span>
              <input name="note" className="input" placeholder="e.g. September supplier prices" />
            </label>
            <Submit pending="Reading workbook…">Import as draft</Submit>
          </ActionForm>
        </Card>
      )}
      <Card title="Versions">
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>#</th>
                <th>Label</th>
                <th>Source</th>
                <th>Status</th>
                <th>Effective from</th>
                <th>Note</th>
                <th>Created</th>
                {canEdit && <th>Actions</th>}
              </tr>
            </thead>
            <tbody>
              {versions.map((v) => (
                <tr key={v.id}>
                  <td>{v.id}</td>
                  <td>
                    <Link href={`/costing/${v.id}`} className="font-semibold text-red underline">
                      {v.label}
                    </Link>
                    {v.baseVersionId && <div className="text-xs text-ink-soft">based on v{v.baseVersionId} + {v.overrides.length} correction(s)</div>}
                  </td>
                  <td className="text-xs">
                    {v.sourceFile}
                    <div className="font-mono text-[10px] text-ink-soft">{v.sourceSha256.slice(0, 12)}</div>
                  </td>
                  <td>
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${v.status === "active" ? "bg-olive/15 text-olive" : v.status === "draft" ? "bg-amber-soft" : "bg-cream-deep"}`}>{v.status}</span>
                  </td>
                  <td>{v.effectiveFrom ?? "—"}</td>
                  <td className="text-xs">{v.note}</td>
                  <td className="text-xs">{fmtStamp(v.createdAt)}</td>
                  {canEdit && (
                    <td>
                      <div className="flex flex-wrap items-end gap-1">
                        {v.status !== "archived" && (
                          <ActionForm action={activateVersionAction} className="flex items-end gap-1" confirm="Activate this costing version from the chosen date? Finalized days are not changed.">
                            <input type="hidden" name="id" value={v.id} />
                            <input type="date" name="effectiveFrom" aria-label="Effective from" defaultValue={v.effectiveFrom ?? dubaiToday()} className="input w-auto py-1 text-xs" />
                            <Submit className="btn btn-olive btn-sm">{v.status === "active" ? "Change date" : "Activate"}</Submit>
                          </ActionForm>
                        )}
                        {v.status !== "archived" && (
                          <ActionForm action={archiveVersionAction} confirm="Archive this version? Days calculated with it keep their stored results.">
                            <input type="hidden" name="id" value={v.id} />
                            <Submit className="btn btn-ghost btn-sm">Archive</Submit>
                          </ActionForm>
                        )}
                      </div>
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
