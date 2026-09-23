import Link from "next/link";
import { fmtRange, fmtStamp } from "@/lib/dates";
import { REPORT_STATUS_LABEL, type ReportData } from "@/lib/server/report";
import { Alert, Card } from "./ui";

export function ReportMeta({ d }: { d: ReportData }) {
  const tone = d.status === "final" ? "ok" : d.status === "empty" ? "info" : "warning";
  return (
    <div className="mb-4 space-y-2">
      <Alert tone={tone}>
        <b>{REPORT_STATUS_LABEL[d.status]}</b> · Period {fmtRange(d.from, d.to)} · {d.summary.daysWithData} day(s) with sales, {d.summary.finalizedDays} finalized · Costing {d.summary.costingLabels.join(", ") || "—"} · Generated {fmtStamp(d.generatedAt)}
      </Alert>
    </div>
  );
}

export function ReportFooter({ d, q }: { d: ReportData; q: string }) {
  const errors = d.summary.issues.filter((i) => i.severity !== "info");
  return (
    <div className="mt-4 grid gap-4 lg:grid-cols-2">
      <Card title="Assumptions">
        {d.assumptions.length === 0 && <p className="text-sm text-ink-soft">No calculated days in this period.</p>}
        {d.assumptions.map((a) => (
          <div key={a.label} className="mb-2">
            <div className="text-xs font-semibold text-brown">{a.label}</div>
            <ul className="list-disc space-y-0.5 pl-5 text-xs">
              {a.lines.map((l) => (
                <li key={l}>{l}</li>
              ))}
            </ul>
          </div>
        ))}
      </Card>
      <div className="space-y-4">
        <Card title={`Unresolved issues (${errors.length})`} action={<Link className="text-xs font-semibold text-red" href={`/reports/issues?${q}`}>All →</Link>}>
          {errors.length === 0 ? (
            <p className="text-sm text-olive">None.</p>
          ) : (
            <ul className="max-h-60 space-y-1 overflow-auto text-xs">
              {errors.slice(0, 40).map((i, k) => (
                <li key={k} className={i.severity === "error" ? "text-red" : "text-brown"}>
                  <Link className="underline" href={`/day/${i.date}`}>
                    {i.date}
                  </Link>{" "}
                  {i.message}
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Finalization and revision history">
          {d.revisions.length === 0 ? (
            <p className="text-sm text-ink-soft">No day in this period has been finalized.</p>
          ) : (
            <table className="data">
              <tbody>
                {d.revisions.map((r) => (
                  <tr key={`${r.date}-${r.revision}`} className={r.supersededAt ? "text-ink-soft" : ""}>
                    <td>
                      <Link className="underline" href={`/day/${r.date}?rev=${r.revision}`}>
                        {r.date} rev {r.revision}
                      </Link>
                    </td>
                    <td className="text-xs">{r.supersededAt ? `superseded ${fmtStamp(r.supersededAt)}` : "current"}</td>
                    <td className="text-xs">
                      {fmtStamp(r.finalizedAt)} · {r.name}
                    </td>
                    <td className="text-xs">{r.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>
    </div>
  );
}
