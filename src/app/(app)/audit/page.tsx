import Link from "next/link";
import { Card, PageHeader } from "@/components/ui";
import { fmtStamp } from "@/lib/dates";
import { auditFilter, queryAudit } from "@/lib/server/audit";
import { pageSession } from "@/lib/server/auth";
import { Decimal } from "@/lib/money";

export const metadata = { title: "Audit trail" };

const AREAS = [
  ["", "All"],
  ["import.", "Sales imports"],
  ["mapping.", "Mappings"],
  ["adjustment.", "Adjustments"],
  ["order.", "Preparation decisions"],
  ["day.", "Finalization"],
  ["ledger.", "Ledger"],
  ["costing.", "Costing"],
  ["settings.", "Settings"],
  ["user.", "Users"],
  ["backup.", "Backups"],
  ["auth.", "Sign-ins"],
] as const;

const LONG_DECIMAL = /(?<![\d:.])-?\d+\.\d{4,}/g;

function shorten(s: string): string {
  return s.replace(LONG_DECIMAL, (n) => new Decimal(n).toDecimalPlaces(2).toFixed(2));
}

/** Display summary only; the CSV export keeps exact values. */
function summarize(d: Record<string, unknown>): string {
  return Object.entries(d)
    .filter(([k]) => k !== "value")
    .map(([k, v]) => `${k}: ${shorten(typeof v === "object" ? JSON.stringify(v) : String(v))}`)
    .join(" · ")
    .slice(0, 400);
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await pageSession("view_finance");
  const sp = await searchParams;
  const f = auditFilter((k) => (typeof sp[k] === "string" ? (sp[k] as string) : null));
  const { area, date, from, to } = f;
  const rows = await queryAudit(f, 500);
  const exp = new URLSearchParams(Object.entries({ area, date: date ?? "", from: from ?? "", to: to ?? "" }).filter(([, v]) => v)).toString();

  return (
    <>
      <PageHeader title="Audit trail" sub="Every import, mapping, adjustment, decision, finalization, ledger, costing, settings and user change, with who made it and when." actions={<a className="btn btn-ghost btn-sm" href={`/api/export/audit?${exp}`}>Export CSV</a>} />
      <Card className="mb-4">
        <form className="flex flex-wrap items-end gap-2" method="get">
          <label>
            <span className="label">Area</span>
            <select name="area" defaultValue={area} className="input">
              {AREAS.map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <label>
            <span className="label">Business date affected</span>
            <input type="date" name="date" defaultValue={date ?? ""} className="input" />
          </label>
          <label>
            <span className="label">Changed from</span>
            <input type="date" name="from" defaultValue={from ?? ""} className="input" />
          </label>
          <label>
            <span className="label">to</span>
            <input type="date" name="to" defaultValue={to ?? ""} className="input" />
          </label>
          <button className="btn btn-primary btn-sm">Filter</button>
          <Link className="btn btn-ghost btn-sm" href="/audit">
            Clear
          </Link>
        </form>
      </Card>
      <Card title={`${rows.length} entries${rows.length === 500 ? " (latest 500)" : ""}`}>
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>When</th>
                <th>Who</th>
                <th>Action</th>
                <th>Record</th>
                <th>Business date</th>
                <th>Details</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((a) => (
                <tr key={a.id}>
                  <td className="whitespace-nowrap text-xs">{fmtStamp(a.at)}</td>
                  <td>{a.userName ?? "system"}</td>
                  <td className="font-mono text-xs">{a.action}</td>
                  <td className="text-xs">
                    {a.entity}
                    {a.entityId ? ` #${a.entityId}` : ""}
                  </td>
                  <td>
                    {a.businessDate && (
                      <Link className="underline" href={`/day/${a.businessDate}`}>
                        {a.businessDate}
                      </Link>
                    )}
                  </td>
                  <td className="max-w-lg break-words text-xs text-ink-soft">{summarize(a.details)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
