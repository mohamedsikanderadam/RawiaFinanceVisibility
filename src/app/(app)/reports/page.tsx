import Link from "next/link";
import { RangeFilter } from "@/components/range-filter";
import { Card, PageHeader } from "@/components/ui";
import { fmtRange } from "@/lib/dates";
import { REPORTS } from "@/lib/report";
import { can, pageSession } from "@/lib/server/auth";
import { rangeQuery, resolveRange, type SearchParams } from "@/lib/server/range";

export const metadata = { title: "Reports" };


export default async function ReportsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await pageSession("view_finance");
  const r = resolveRange(await searchParams);
  const q = rangeQuery(r);
  const exp = `from=${r.from}&to=${r.to}`;
  return (
    <>
      <PageHeader title="Reports" sub={fmtRange(r.from, r.to)} actions={<RangeFilter r={r} base="/reports" />} />
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {REPORTS.map((x) => (
          <Card key={x.kind} title={x.title}>
            <p className="text-sm text-ink-soft">{x.body}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              <Link className="btn btn-primary btn-sm" href={`/reports/${x.kind}?${q}`}>
                Open
              </Link>
              <a className="btn btn-ghost btn-sm" href={`/api/export/xlsx?report=${x.kind}&${exp}`}>
                Excel
              </a>
            </div>
          </Card>
        ))}
        <Card title="Exports">
          <ul className="space-y-2 text-sm">
            {r.from === r.to && (
              <li>
                <a className="font-semibold text-red underline" href={`/api/export/day/${r.from}/pdf`}>
                  Daily EOD report (PDF) – {r.from}
                </a>
              </li>
            )}
            <li>
              <a className="font-semibold text-red underline" href={`/api/export/pdf?${exp}`}>
                Period financial summary (PDF)
              </a>
            </li>
            <li>
              <a className="font-semibold text-red underline" href={`/api/export/xlsx?report=full&${exp}`}>
                Full workbook: summary, replenishment, menu, non-sales, orders, issues (Excel)
              </a>
            </li>
            <li>
              <Link className="font-semibold text-red underline" href="/audit">
                Import and adjustment audit trail
              </Link>
            </li>
            {can(s.role, "backup") && (
              <li>
                <a className="font-semibold text-red underline" href="/api/export/backup">
                  Full database backup (JSON)
                </a>
              </li>
            )}
          </ul>
        </Card>
      </div>
    </>
  );
}
