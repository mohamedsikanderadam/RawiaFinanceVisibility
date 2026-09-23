import Link from "next/link";
import { notFound } from "next/navigation";
import { RangeFilter } from "@/components/range-filter";
import { RecordsTable } from "@/components/records-table";
import { ReportFooter, ReportMeta } from "@/components/report-parts";
import { Card, DayStateBadge, Empty, MetricRow, Money, PageHeader, StatusBadge } from "@/components/ui";
import { fmtDate, fmtRange } from "@/lib/dates";
import { BUCKETS, BUCKET_LABEL, type Bucket } from "@/lib/engine/types";
import { D, ZERO, fmtNum, fmtPct, sum } from "@/lib/money";
import { METRIC_GROUPS, REPORTS, groupKeys } from "@/lib/report";
import { pageSession } from "@/lib/server/auth";
import { rangeQuery, resolveRange, type SearchParams } from "@/lib/server/range";
import { loadReport } from "@/lib/server/report";

export const metadata = { title: "Report" };

const NON_SALES: Bucket[] = ["staff", "complimentary", "wastage", "refund_loss", "manual"];

export default async function ReportPage({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<SearchParams> }) {
  await pageSession("view_finance");
  const { kind } = await params;
  const def = REPORTS.find((x) => x.kind === kind);
  if (!def) notFound();
  const sp = await searchParams;
  const r = resolveRange(sp);
  const q = rangeQuery(r);
  const d = await loadReport(r.from, r.to);
  const s = d.summary;
  const m = s.metrics;
  const bucket = typeof sp.bucket === "string" && (BUCKETS as string[]).includes(sp.bucket) ? (sp.bucket as Bucket) : null;
  const extra = bucket ? { bucket } : undefined;
  const exp = `from=${r.from}&to=${r.to}`;

  const header = (
    <PageHeader
      title={def.title}
      sub={fmtRange(r.from, r.to)}
      actions={
        <div className="flex flex-col items-end gap-2">
          <RangeFilter r={r} base={`/reports/${kind}`} extra={extra} />
          <div className="flex gap-2">
            {kind === "summary" && (
              <a className="btn btn-ghost btn-sm" href={r.from === r.to ? `/api/export/day/${r.from}/pdf` : `/api/export/pdf?${exp}`}>
                PDF
              </a>
            )}
            <a className="btn btn-ghost btn-sm" href={`/api/export/xlsx?report=${kind}&${exp}`}>
              Excel
            </a>
          </div>
        </div>
      }
    />
  );

  let body: React.ReactNode = null;

  if (kind === "summary") {
    body = (
      <>
        <div className="grid gap-4 md:grid-cols-2" id="operating">
          {METRIC_GROUPS.map((g) => (
            <Card key={g.title} title={g.title}>
              <table className="data">
                <tbody>
                  {groupKeys(g).map(({ key, mod }) => (
                    <MetricRow key={key} m={m[key]} indent={mod === "indent"} strong={mod === "strong"} />
                  ))}
                </tbody>
              </table>
            </Card>
          ))}
        </div>
        <div className="mt-4 grid gap-4 lg:grid-cols-2">
          <Card title="Revenue to estimated operating result">
            <table className="data">
              <tbody>
                {s.waterfall.map((w) => (
                  <tr key={w.key} className={w.kind === "total" ? "font-bold" : ""}>
                    <td>{w.kind === "minus" ? `less ${w.label}` : w.label}</td>
                    <td className="r">
                      <Money v={w.kind === "minus" ? D(w.value).neg().toString() : w.value} />
                    </td>
                    <td className="w-28 text-right">
                      <StatusBadge status={w.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-ink-soft">Replenishment reserve is not a separate deduction here: sold-item COGS, staff meals, complimentary, wastage and batches are each deducted once and together make up the reserve.</p>
          </Card>
          <Card title="Replenishment funding">
            <table className="data">
              <tbody>
                {Object.values(d.funding.lines).map((l) => (
                  <tr key={l.key}>
                    <td title={l.definition}>{l.label}</td>
                    <td className="r">{l.value === null ? <span className="text-ink-soft">Not available</span> : <Money v={l.value} />}</td>
                    <td className="w-28 text-right">
                      <StatusBadge status={l.status} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Sales channels">
            <table className="data">
              <thead>
                <tr>
                  <th>Channel</th>
                  <th className="r">Orders</th>
                  <th className="r">Gross</th>
                  <th className="r">Net incl. VAT</th>
                </tr>
              </thead>
              <tbody>
                {s.channels.map((c) => (
                  <tr key={c.channel}>
                    <td>
                      <Link className="underline" href={`/drill/orders?channel=${encodeURIComponent(c.channel)}&${q}`}>
                        {c.channel.replace("_", " ")}
                      </Link>
                    </td>
                    <td className="r">{c.orders}</td>
                    <td className="r">
                      <Money v={c.gross} />
                    </td>
                    <td className="r">
                      <Money v={c.net} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <Card title="Payment methods (sales, not settlements)">
            <table className="data">
              <thead>
                <tr>
                  <th>Method</th>
                  <th className="r">Orders</th>
                  <th className="r">Amount</th>
                  <th>Treatment</th>
                </tr>
              </thead>
              <tbody>
                {s.payments.map((p) => (
                  <tr key={p.method}>
                    <td>
                      <Link className="underline" href={`/drill/orders?payment=${encodeURIComponent(p.method)}&${q}`}>
                        {p.method}
                      </Link>
                    </td>
                    <td className="r">{p.orders}</td>
                    <td className="r">
                      <Money v={p.amount} />
                    </td>
                    <td className="text-xs">{p.treatment}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </div>
        <Card title="Daily totals" className="mt-4">
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>State</th>
                  <th>Costing</th>
                  <th className="r">Net sales</th>
                  <th className="r">COGS</th>
                  <th className="r">Reserve</th>
                  <th className="r">Est. operating result</th>
                </tr>
              </thead>
              <tbody>
                {s.days.map((x) => (
                  <tr key={x.date}>
                    <td>
                      <Link className="underline" href={`/day/${x.date}`}>
                        {fmtDate(x.date)}
                      </Link>
                    </td>
                    <td>
                      <DayStateBadge state={x.state} revision={x.revision} />
                      {x.incomplete && <StatusBadge status="incomplete" className="ml-1" />}
                    </td>
                    <td className="text-xs">{x.costingLabel}</td>
                    <td className="r">
                      <Money v={x.netSales} />
                    </td>
                    <td className="r">
                      <Money v={x.cogs} />
                    </td>
                    <td className="r">
                      <Money v={x.reserve} />
                    </td>
                    <td className="r">
                      <Money v={x.operatingResult} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold">
                  <td colSpan={3}>Total</td>
                  <td className="r">
                    <Money v={m.netSales?.value} />
                  </td>
                  <td className="r">
                    <Money v={m.cogsSold?.value} />
                  </td>
                  <td className="r">
                    <Money v={m.reserve?.value} />
                  </td>
                  <td className="r">
                    <Money v={m.operatingResult?.value} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      </>
    );
  }

  if (kind === "replenishment") {
    const used = BUCKETS.filter((b) => s.consumption.some((c) => c.byBucket[b]));
    body = (
      <Card title="Consumption-based replenishment reserve">
        <p className="mb-2 text-xs text-ink-soft">
          Money needed to replace what was consumed. This is not a purchase order: packs to buy depend on stock on hand, pack sizes and target levels, which are not recorded here. Karak batch: {s.karak.batches} batch(es), <Money v={s.karak.cost} /> (allocated <Money v={s.karak.allocated} />, unallocated <Money v={s.karak.unallocated} />).
        </p>
        {s.consumption.length === 0 ? (
          <Empty>No consumption in this period.</Empty>
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Ingredient / packaging</th>
                  <th>Type</th>
                  <th className="r">Qty consumed</th>
                  <th>Unit</th>
                  <th className="r">Unit cost</th>
                  {used.map((b) => (
                    <th key={b} className="r">
                      {BUCKET_LABEL[b]}
                    </th>
                  ))}
                  <th className="r">Reserve</th>
                </tr>
              </thead>
              <tbody>
                {s.consumption.map((c) => (
                  <tr key={`${c.itemKey}|${c.unit}`}>
                    <td>
                      <Link className="underline decoration-cream-deep" href={`/drill/item?key=${encodeURIComponent(c.itemKey)}&${q}`}>
                        {c.label}
                      </Link>
                      {c.incomplete && <StatusBadge status="incomplete" className="ml-1" />}
                    </td>
                    <td className="text-xs">{c.kind.replace("_", " ")}</td>
                    <td className="r">{fmtNum(c.qty, 3)}</td>
                    <td>{c.unit}</td>
                    <td className="r">{c.unitCost === null ? <span className="text-red">missing</span> : fmtNum(c.unitCost, 5)}</td>
                    {used.map((b) => (
                      <td key={b} className="r">
                        {c.byBucket[b] ? <Money v={c.byBucket[b]} /> : ""}
                      </td>
                    ))}
                    <td className="r font-semibold">{c.incomplete && D(c.amount).isZero() ? <span className="text-red">Missing</span> : <Money v={c.amount} />}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="font-bold">
                  <td colSpan={5}>Total {m.reserve?.status === "incomplete" && <StatusBadge status="incomplete" className="ml-1" />}</td>
                  {used.map((b) => (
                    <td key={b} className="r">
                      <Money v={sum(s.consumption.map((c) => D(c.byBucket[b] ?? 0))).toString()} />
                    </td>
                  ))}
                  <td className="r">
                    <Money v={m.reserve?.value} />
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </Card>
    );
  }

  if (kind === "menu") {
    const recon = new Map(d.recon.rows.map((x) => [x.code, x]));
    body = (
      <>
        <Card title="Menu-item margins">
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="r">Sold</th>
                  <th className="r">Staff</th>
                  <th className="r">Comp.</th>
                  <th className="r">Waste</th>
                  <th className="r">Revenue ex VAT</th>
                  <th className="r">Cost of sold</th>
                  <th className="r">Margin</th>
                  <th className="r">Margin %</th>
                  <th className="r">Workbook cost</th>
                  <th className="r">Diff</th>
                </tr>
              </thead>
              <tbody>
                {s.menuItems.map((x) => {
                  const rc = x.menuCode ? recon.get(x.menuCode) : undefined;
                  return (
                    <tr key={x.key}>
                      <td>
                        <Link className="underline decoration-cream-deep" href={`/drill/menu?key=${encodeURIComponent(x.key)}&${q}`}>
                          {x.name}
                        </Link>
                        {x.incomplete && <StatusBadge status="incomplete" className="ml-1" />}
                        {rc?.note && <div className="text-xs text-ink-soft">{rc.note}</div>}
                      </td>
                      <td className="r">{fmtNum(x.soldQty)}</td>
                      <td className="r">{fmtNum(x.staffQty)}</td>
                      <td className="r">{fmtNum(x.compQty)}</td>
                      <td className="r">{fmtNum(x.wasteQty)}</td>
                      <td className="r">
                        <Money v={x.revenueExVat} />
                      </td>
                      <td className="r">
                        <Money v={x.soldCost} />
                      </td>
                      <td className="r">
                        <Money v={x.margin} />
                      </td>
                      <td className="r">{x.marginPct === null ? "—" : fmtPct(x.marginPct)}</td>
                      <td className="r">{rc?.workbookCost ? <Money v={rc.workbookCost} /> : "—"}</td>
                      <td className={`r ${rc?.diff && D(rc.diff).abs().gte(0.01) ? "font-semibold text-red" : ""}`}>{rc?.diff ? <Money v={rc.diff} sign /> : "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-ink-soft">
            Workbook cost = Menu Master &quot;cost with packaging&quot; × units sold. Comparable total: app <Money v={d.recon.appTotal} /> vs workbook <Money v={d.recon.workbookTotal} /> (difference <Money v={d.recon.diffTotal} sign />). Karak is excluded from the comparison because its cost is the daily batch.
          </p>
        </Card>
      </>
    );
  }

  if (kind === "nonsales") {
    const rows = s.nonSales.filter((x) => (bucket ? x.bucket === bucket : true));
    const totals = NON_SALES.map((b) => ({ b, amount: sum(s.nonSales.filter((x) => x.bucket === b).map((x) => D(x.amount ?? 0))), missing: s.nonSales.some((x) => x.bucket === b && x.amount === null) }));
    body = (
      <>
        <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
          {totals.map((t) => (
            <Link key={t.b} href={`/reports/nonsales?${q}&bucket=${t.b}`} className={`card p-3 ${bucket === t.b ? "ring-2 ring-red" : ""}`}>
              <div className="text-xs text-ink-soft">{BUCKET_LABEL[t.b]}</div>
              <div className="font-bold">
                <Money v={t.amount.toString()} />
              </div>
              {t.missing && <StatusBadge status="incomplete" />}
            </Link>
          ))}
        </div>
        <Card title={`${bucket ? BUCKET_LABEL[bucket] : "All zero-revenue consumption"} (${rows.length} records)`} action={bucket && <Link className="text-xs font-semibold text-red" href={`/reports/nonsales?${q}`}>Show all</Link>}>
          <RecordsTable rows={rows} showMenu showItem />
          <p className="mt-2 text-xs text-ink-soft">
            Total: <Money v={sum(rows.map((x) => D(x.amount ?? ZERO))).toString()} />. These costs are in the replenishment reserve and deducted in the operating result, but not in sold-item COGS.
          </p>
        </Card>
      </>
    );
  }

  if (kind === "issues") {
    body = (
      <Card title={`Issues (${s.issues.length})`}>
        {s.issues.length === 0 ? (
          <Empty>No issues.</Empty>
        ) : (
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th>Severity</th>
                <th>Issue</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {s.issues.map((i, k) => (
                <tr key={k}>
                  <td>
                    <Link className="underline" href={`/day/${i.date}`}>
                      {i.date}
                    </Link>
                  </td>
                  <td className={i.severity === "error" ? "font-semibold text-red" : i.severity === "warning" ? "text-amber" : "text-ink-soft"}>{i.severity}</td>
                  <td>{i.message}</td>
                  <td className="text-xs">
                    {i.code === "unmatched_item" ? (
                      <Link className="underline" href="/mappings">
                        Map item
                      </Link>
                    ) : i.code === "cost_missing" ? (
                      <Link className="underline" href="/costing">
                        Fix cost
                      </Link>
                    ) : i.code === "prep_default" ? (
                      <Link className="underline" href={`/day/${i.date}#orders`}>
                        Record preparation
                      </Link>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </Card>
    );
  }

  return (
    <>
      {header}
      <ReportMeta d={d} />
      {body}
      <ReportFooter d={d} q={q} />
    </>
  );
}
