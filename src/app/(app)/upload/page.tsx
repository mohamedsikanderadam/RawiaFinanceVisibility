import Link from "next/link";
import { uploadSalesAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/action-form";
import { Alert, Card, PageHeader } from "@/components/ui";
import { dubaiToday, fmtStamp } from "@/lib/dates";
import { pageSession } from "@/lib/server/auth";
import { listImports } from "@/lib/server/sales";

export const metadata = { title: "Upload sales" };

export default async function UploadPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await pageSession("import");
  const sp = await searchParams;
  const imports = (await listImports()).reverse().slice(0, 30);
  const committed = typeof sp.committed === "string" ? imports.find((i) => String(i.id) === sp.committed) : null;

  return (
    <>
      <PageHeader title="Upload daily sales" sub="CSV or Excel order-history export from the POS. Times are read in Asia/Dubai; amounts in AED." />
      {committed?.summary && (
        <div className="mb-4">
          <Alert tone="ok">
            Import #{committed.id} committed: {committed.summary.newOrders} new, {committed.summary.changed} replaced, {committed.summary.duplicates} already imported. Dates:{" "}
            {committed.summary.dates.map((d, i) => (
              <span key={d}>
                {i > 0 && ", "}
                <Link className="font-semibold underline" href={`/day/${d}`}>
                  {d}
                </Link>
              </span>
            ))}
          </Alert>
        </div>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="1. Choose date and file" className="lg:col-span-1">
          <ActionForm action={uploadSalesAction} className="space-y-3">
            <label className="block">
              <span className="label">Business date</span>
              <input type="date" name="date" defaultValue={dubaiToday()} className="input" />
            </label>
            <fieldset className="space-y-1 text-sm">
              <legend className="label">Which orders to import</legend>
              <label className="flex items-center gap-2">
                <input type="radio" name="scope" value="selected_date" defaultChecked /> Only the selected date
              </label>
              <label className="flex items-center gap-2">
                <input type="radio" name="scope" value="all_dates" /> Every date in the file (multi-day)
              </label>
            </fieldset>
            <label className="block">
              <span className="label">Sales file (.csv, .xlsx)</span>
              <input type="file" name="file" accept=".csv,.xlsx,.xlsm" required className="input" />
            </label>
            <Submit pending="Reading file…">Preview import</Submit>
          </ActionForm>
          <p className="mt-3 text-xs text-ink-soft">Nothing is saved until you confirm the preview. Re-uploading the same or an overlapping file is safe: orders already imported are recognised by their order UUID (or a fingerprint when the export has none) and are not counted twice.</p>
        </Card>
        <Card title="Recent imports" className="lg:col-span-2">
          {imports.length === 0 ? (
            <p className="text-sm text-ink-soft">No imports yet.</p>
          ) : (
            <div className="overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>File</th>
                    <th>Scope</th>
                    <th>Status</th>
                    <th>Result</th>
                    <th>Uploaded</th>
                  </tr>
                </thead>
                <tbody>
                  {imports.map((i) => (
                    <tr key={i.id}>
                      <td>{i.id}</td>
                      <td>
                        {i.status === "preview" ? (
                          <Link className="font-semibold text-red underline" href={`/upload/${i.id}`}>
                            {i.fileName}
                          </Link>
                        ) : (
                          i.fileName
                        )}
                      </td>
                      <td className="text-xs">{i.scope === "all_dates" ? "all dates" : i.selectedDate}</td>
                      <td>{i.status === "preview" ? <span className="font-semibold text-amber">awaiting review</span> : i.status}</td>
                      <td className="text-xs">
                        {i.summary
                          ? `${i.summary.newOrders} new · ${i.summary.changed} replaced · ${i.summary.duplicates} duplicates${i.summary.dates.length ? ` · ${i.summary.dates.join(", ")}` : ""}`
                          : "—"}
                      </td>
                      <td className="text-xs">{fmtStamp(i.createdAt)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </>
  );
}
