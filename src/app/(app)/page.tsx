import Link from "next/link";
import { redirect } from "next/navigation";
import { Donut, TrendChart, WaterfallChart } from "@/components/charts";
import { RangeFilter } from "@/components/range-filter";
import { Alert, Card, DayStateBadge, Empty, MetricCard, Money, PageHeader, StatusBadge } from "@/components/ui";
import { fmtDate, fmtRange } from "@/lib/dates";
import { BUCKET_LABEL, type Bucket } from "@/lib/engine/types";
import { D, fmtNum, fmtPct, round2 } from "@/lib/money";
import { can, pageSession } from "@/lib/server/auth";
import { computeFunding } from "@/lib/server/ledger";
import { latestSalesDate, loadRange, rangeQuery, reconcileRange, resolveRange, type SearchParams } from "@/lib/server/range";

export const metadata = { title: "Dashboard" };

const num = (v: string | null | undefined) => (v === null || v === undefined ? null : round2(v));

export default async function Dashboard({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await pageSession("view");
  if (!can(s.role, "view_finance")) redirect("/upload");
  const sp = await searchParams;
  const r = resolveRange(sp);
  const [{ views, summary }, latest] = await Promise.all([loadRange(r.from, r.to), latestSalesDate()]);
  const [funding, recon] = await Promise.all([computeFunding(r.from, r.to, views), reconcileRange(views)]);
  const q = rangeQuery(r);
  const m = summary.metrics;
  const single = r.from === r.to;
  const exportBase = `from=${r.from}&to=${r.to}`;

  const header = (
    <PageHeader
      title="Dashboard"
      sub={
        <>
          {fmtRange(r.from, r.to)} · {summary.daysWithData} day(s) with data · {summary.finalizedDays} finalized
          {summary.costingLabels.length > 0 && <> · Costing: {summary.costingLabels.join(", ")}</>}
        </>
      }
      actions={<RangeFilter r={r} base="/" />}
    />
  );

  if (!summary.daysWithData) {
    return (
      <>
        {header}
        <Empty>
          No sales or adjustments for this period.{" "}
          {latest && (
            <>
              Latest sales are on{" "}
              <Link className="font-semibold text-red underline" href={`/?preset=today&date=${latest}`}>
                {fmtDate(latest)}
              </Link>
              .{" "}
            </>
          )}
          {can(s.role, "import") && (
            <Link className="font-semibold text-red underline" href="/upload">
              Upload sales
            </Link>
          )}
        </Empty>
      </>
    );
  }

  const trend = summary.days.map((d) => ({
    date: d.date,
    label: new Date(`${d.date}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }),
    netSales: num(d.netSales),
    reserve: num(d.reserve),
    operatingResult: num(d.operatingResult),
    incomplete: d.incomplete,
    state: d.state,
  }));
  const gp = m.grossProfit?.value;
  const revenue = m.netSales?.value ?? m.netSalesInclVat?.value;
  const gpPct = gp && revenue && !D(revenue).isZero() ? D(gp).div(D(revenue)) : null;

  const bucketTotals = new Map<Bucket, number>();
  for (const c of summary.consumption) for (const [b, v] of Object.entries(c.byBucket) as [Bucket, string][]) bucketTotals.set(b, (bucketTotals.get(b) ?? 0) + Number(v));
  const errors = summary.issues.filter((i) => i.severity === "error");
  const warnings = summary.issues.filter((i) => i.severity === "warning");
  const incompleteMetrics = Object.values(m).filter((x) => x.status === "incomplete" || x.status === "unavailable");
  const openDays = summary.days.filter((d) => d.state === "live");
  const bigDiffs = recon.rows.filter((x) => x.diff !== null && D(x.diff).abs().gte(0.01));

  return (
    <>
      {header}

      <div className="mb-4 space-y-2">
        {errors.length > 0 && (
          <Alert tone="error">
            <b>{errors.length} blocking issue(s):</b> {[...new Set(errors.map((e) => e.message))].slice(0, 3).join(" · ")}{" "}
            <Link href={`/reports/issues?${q}`} className="font-semibold underline">
              Review all
            </Link>
          </Alert>
        )}
        {incompleteMetrics.length > 0 && (
          <Alert tone="warning">
            <b>Incomplete or unavailable:</b> {incompleteMetrics.map((x) => x.label).join(", ")}. These totals are missing inputs and are not the full figure.
          </Alert>
        )}
        {openDays.length > 0 && can(s.role, "finalize") && (
          <Alert tone="info">
            {openDays.length} day(s) not finalized:{" "}
            {openDays.map((d, i) => (
              <span key={d.date}>
                {i > 0 && ", "}
                <Link className="font-semibold underline" href={`/day/${d.date}`}>
                  {fmtDate(d.date)}
                </Link>
              </span>
            ))}
          </Alert>
        )}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <MetricCard m={m.netSales?.value !== null ? m.netSales : m.netSalesInclVat} tone="olive" href={`/reports/summary?${q}`} sub={<>incl. VAT <Money v={m.netSalesInclVat?.value} /> · {summary.days.reduce((a, d) => a + (d.state !== "no_data" ? 1 : 0), 0)} day(s)</>} />
        <MetricCard m={m.reserve} tone="red" href={`/reports/replenishment?${q}`} sub={<>Set aside: <Money v={funding.lines.allocated.value} /> · Unfunded: <Money v={funding.lines.unfunded.value} /></>} />
        <MetricCard m={m.grossProfit} tone="brown" href={`/reports/menu?${q}`} sub={<>Gross margin {gpPct ? fmtPct(gpPct) : "—"}</>} />
        <MetricCard m={m.operatingResult} tone="brown" href={`/reports/summary?${q}#operating`} sub="Profit estimate — not cash available." />
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Daily revenue and cost trend" className="lg:col-span-2" action={<span className="text-xs text-ink-soft">Click a day to open it</span>}>
          <TrendChart data={trend} />
        </Card>
        <Card title="Days">
          <ul className="max-h-72 space-y-1 overflow-auto text-sm">
            {summary.days
              .filter((d) => d.state !== "no_data")
              .map((d) => (
                <li key={d.date}>
                  <Link href={`/day/${d.date}`} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 hover:bg-cream">
                    <span>{fmtDate(d.date)}</span>
                    <span className="flex items-center gap-2">
                      <Money v={d.netSales} className="text-xs" />
                      <DayStateBadge state={d.state} revision={d.revision} />
                    </span>
                  </Link>
                </li>
              ))}
          </ul>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title="Revenue to estimated operating result" action={<Link className="text-xs font-semibold text-red" href={`/reports/summary?${q}`}>Definitions →</Link>}>
          <WaterfallChart steps={summary.waterfall.map((w) => ({ label: w.label, value: Number(w.value), kind: w.kind, status: w.status }))} />
          <p className="text-xs text-ink-soft">Grey bars are incomplete or not available. Each cost is deducted once.</p>
        </Card>
        <Card title="Replenishment reserve by use">
          <Donut data={[...bucketTotals].map(([b, v]) => ({ name: BUCKET_LABEL[b], value: round2(v) }))} />
          <table className="data mt-2">
            <tbody>
              {[...bucketTotals].map(([b, v]) => (
                <tr key={b}>
                  <td>
                    {b === "sold" || b === "batch" ? (
                      BUCKET_LABEL[b]
                    ) : (
                      <Link className="underline" href={`/reports/nonsales?${q}&bucket=${b}`}>
                        {BUCKET_LABEL[b]}
                      </Link>
                    )}
                  </td>
                  <td className="r">
                    <Money v={String(v)} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {summary.karak.batches > 0 || D(summary.karak.cups).gt(0) ? (
            <p className="mt-2 text-xs text-ink-soft">
              Cane Karak: {summary.karak.batches} batch(es) × fixed price = <Money v={summary.karak.cost} /> for {fmtNum(summary.karak.cups, 0)} cups (allocated <Money v={summary.karak.allocated} />, unallocated <Money v={summary.karak.unallocated} />).
            </p>
          ) : null}
        </Card>
      </div>

      <Card title="Ingredient and packaging replenishment" className="mt-4" action={<div className="flex gap-2"><Link className="btn btn-ghost btn-sm" href={`/reports/replenishment?${q}`}>Full table</Link><a className="btn btn-olive btn-sm" href={`/api/export/xlsx?report=replenishment&${exportBase}`}>Excel</a></div>}>
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Ingredient / packaging</th>
                <th className="r">Quantity consumed</th>
                <th>Unit</th>
                <th className="r">Unit cost</th>
                <th className="r">Replenishment</th>
              </tr>
            </thead>
            <tbody>
              {summary.consumption.slice(0, 12).map((c) => (
                <tr key={`${c.itemKey}|${c.unit}`}>
                  <td>
                    <Link href={`/drill/item?key=${encodeURIComponent(c.itemKey)}&${q}`} className="font-medium underline decoration-cream-deep hover:decoration-red">
                      {c.label}
                    </Link>
                    {c.incomplete && <StatusBadge status="incomplete" className="ml-2" />}
                  </td>
                  <td className="r">{fmtNum(c.qty, 2)}</td>
                  <td>{c.unit}</td>
                  <td className="r">{c.unitCost === null ? "—" : `AED ${fmtNum(c.unitCost, 4)}`}</td>
                  <td className="r">{c.incomplete ? <span className="text-red">Missing cost</span> : <Money v={c.amount} />}</td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td colSpan={4} className="font-bold">
                  Total replenishment reserve ({summary.consumption.length} items)
                </td>
                <td className="r font-bold">
                  <Money v={m.reserve?.value} /> <StatusBadge status={m.reserve?.status ?? "unavailable"} />
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </Card>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card title="Menu-item profitability" className="lg:col-span-2" action={<Link className="btn btn-ghost btn-sm" href={`/reports/menu?${q}`}>All items</Link>}>
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="r">Sold</th>
                  <th className="r">Revenue ex VAT</th>
                  <th className="r">Cost</th>
                  <th className="r">Margin</th>
                  <th className="r">%</th>
                </tr>
              </thead>
              <tbody>
                {summary.menuItems
                  .filter((x) => D(x.soldQty).gt(0))
                  .slice(0, 10)
                  .map((x) => (
                    <tr key={x.key}>
                      <td>
                        <Link className="underline decoration-cream-deep hover:decoration-red" href={`/drill/menu?key=${encodeURIComponent(x.key)}&${q}`}>
                          {x.name}
                        </Link>
                        {x.incomplete && <StatusBadge status="incomplete" className="ml-2" />}
                      </td>
                      <td className="r">{fmtNum(x.soldQty, 2)}</td>
                      <td className="r">
                        <Money v={x.revenueExVat} />
                      </td>
                      <td className="r">
                        <Money v={x.soldCost} />
                      </td>
                      <td className="r">
                        <Money v={x.margin} />
                      </td>
                      <td className="r">{fmtPct(x.marginPct)}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="Reserve funding" action={<Link className="btn btn-ghost btn-sm" href={`/reserve?${q}`}>Ledger</Link>}>
          <dl className="space-y-2 text-sm">
            {Object.values(funding.lines).map((l) => (
              <div key={l.key} className="flex items-start justify-between gap-2">
                <dt title={l.definition}>{l.label}</dt>
                <dd className="flex flex-col items-end">
                  {l.value === null ? <span className="text-ink-soft">Not available</span> : <Money v={l.value} className="font-semibold" />}
                  <StatusBadge status={l.status} />
                </dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-ink-soft">The reserve is a business-wide requirement covering cash and card sales. It is not an amount to remove from the cash drawer.</p>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
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
              {summary.channels.map((c) => (
                <tr key={c.channel}>
                  <td>
                    <Link className="underline decoration-cream-deep" href={`/drill/orders?channel=${encodeURIComponent(c.channel)}&${q}`}>
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
        <Card title="Payment methods (sales ≠ settlements)">
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
              {summary.payments.map((p) => (
                <tr key={p.method}>
                  <td>
                    <Link className="underline decoration-cream-deep" href={`/drill/orders?payment=${encodeURIComponent(p.method)}&${q}`}>
                      {p.method}
                    </Link>
                  </td>
                  <td className="r">{p.orders}</td>
                  <td className="r">
                    <Money v={p.amount} />
                  </td>
                  <td className="text-xs text-ink-soft">{p.treatment}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      </div>

      <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card title={`Missing data (${errors.length + warnings.length})`} action={<Link className="btn btn-ghost btn-sm" href={`/reports/issues?${q}`}>All issues</Link>}>
          {errors.length + warnings.length === 0 ? (
            <p className="text-sm text-olive">No missing costs or unmatched items.</p>
          ) : (
            <ul className="max-h-72 space-y-1 overflow-auto text-sm">
              {[...errors, ...warnings].slice(0, 25).map((i, k) => (
                <li key={k} className="flex gap-2">
                  <span className={`mt-1 h-2 w-2 shrink-0 rounded-full ${i.severity === "error" ? "bg-red" : "bg-amber"}`} />
                  <span>
                    {!single && <span className="text-xs text-ink-soft">{i.date}: </span>}
                    {i.message}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card title="Reconciliation with workbook menu costs">
          <p className="mb-2 text-sm">
            App sold-item cost <Money v={recon.appTotal} /> vs workbook <Money v={recon.workbookTotal} /> → difference <Money v={recon.diffTotal} sign className={D(recon.diffTotal).abs().gte(0.01) ? "font-bold text-red" : "text-olive"} />
          </p>
          {bigDiffs.length === 0 ? (
            <p className="text-sm text-olive">Sold items match the workbook menu costs.</p>
          ) : (
            <table className="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="r">App</th>
                  <th className="r">Workbook</th>
                  <th className="r">Diff</th>
                </tr>
              </thead>
              <tbody>
                {bigDiffs.slice(0, 8).map((x) => (
                  <tr key={x.code}>
                    <td>
                      {x.name}
                      {x.note && <div className="text-xs text-ink-soft">{x.note}</div>}
                    </td>
                    <td className="r">
                      <Money v={x.appCost} />
                    </td>
                    <td className="r">
                      <Money v={x.workbookCost} />
                    </td>
                    <td className="r">
                      <Money v={x.diff} sign />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </div>

      <div className="mt-4 flex flex-wrap gap-2">
        {single && (
          <a className="btn btn-primary" href={`/api/export/day/${r.from}/pdf`}>
            Daily EOD PDF
          </a>
        )}
        <a className="btn btn-ghost" href={`/api/export/pdf?${exportBase}`}>
          Period summary PDF
        </a>
        <a className="btn btn-ghost" href={`/api/export/xlsx?report=full&${exportBase}`}>
          Full Excel breakdown
        </a>
      </div>
    </>
  );
}
