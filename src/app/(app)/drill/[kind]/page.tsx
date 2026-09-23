import Link from "next/link";
import { notFound } from "next/navigation";
import { RangeFilter } from "@/components/range-filter";
import { RecordsTable } from "@/components/records-table";
import { Card, Empty, Money, PageHeader, StatusBadge } from "@/components/ui";
import { fmtRange } from "@/lib/dates";
import { drillItem } from "@/lib/engine/aggregate";
import { BUCKET_LABEL } from "@/lib/engine/types";
import { D, fmtNum, sum } from "@/lib/money";
import { pageSession } from "@/lib/server/auth";
import { ordersBetween } from "@/lib/server/day";
import { loadRange, rangeQuery, resolveRange, type SearchParams } from "@/lib/server/range";
import { channelOf, paymentKeyOf } from "@/lib/settings";

export const metadata = { title: "Drill-down" };

export default async function Drill({ params, searchParams }: { params: Promise<{ kind: string }>; searchParams: Promise<SearchParams> }) {
  await pageSession("view_finance");
  const { kind } = await params;
  const sp = await searchParams;
  const r = resolveRange(sp);
  const key = typeof sp.key === "string" ? sp.key : "";
  const base = `/drill/${kind}`;
  const extra = Object.fromEntries(Object.entries(sp).filter(([k, v]) => typeof v === "string" && !["preset", "date", "from", "to"].includes(k)) as [string, string][]);
  const filter = <RangeFilter r={r} base={base} extra={extra} />;

  if (kind === "item") {
    const { views, summary } = await loadRange(r.from, r.to);
    const rows = drillItem(views, key);
    const row = summary.consumption.find((c) => c.itemKey === key);
    const total = sum(rows.map((x) => D(x.amount ?? 0)));
    const byMenu = new Map<string, { qty: ReturnType<typeof D>; amount: ReturnType<typeof D>; servings: ReturnType<typeof D> }>();
    for (const x of rows) {
      const k = `${BUCKET_LABEL[x.bucket]} · ${x.origin.posName ?? x.path[0] ?? "—"}`;
      const e = byMenu.get(k) ?? { qty: D(0), amount: D(0), servings: D(0) };
      e.qty = e.qty.plus(D(x.qty));
      e.amount = e.amount.plus(D(x.amount ?? 0));
      e.servings = e.servings.plus(D(x.origin.servings));
      byMenu.set(k, e);
    }
    return (
      <>
        <PageHeader title={row?.label ?? key} sub={<>Consumption drill-down · {fmtRange(r.from, r.to)} · {row ? `${fmtNum(row.qty, 3)} ${row.unit}` : ""}</>} actions={filter} />
        <div className="grid gap-4">
          <Card title="By menu item and use">
            <table className="data">
              <thead>
                <tr>
                  <th>Menu item</th>
                  <th className="r">Servings</th>
                  <th className="r">Qty consumed</th>
                  <th className="r">Amount</th>
                </tr>
              </thead>
              <tbody>
                {[...byMenu].map(([k, v]) => (
                  <tr key={k}>
                    <td>{k}</td>
                    <td className="r">{fmtNum(v.servings, 2)}</td>
                    <td className="r">
                      {fmtNum(v.qty, 3)} {row?.unit}
                    </td>
                    <td className="r">
                      <Money v={v.amount.toString()} />
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td colSpan={3} className="font-bold">
                    Total
                  </td>
                  <td className="r font-bold">
                    <Money v={total.toString()} />
                    {row?.incomplete && <StatusBadge status="incomplete" className="ml-1" />}
                  </td>
                </tr>
              </tfoot>
            </table>
          </Card>
          <Card title={`Underlying records (${rows.length})`}>
            <RecordsTable rows={rows} showMenu />
          </Card>
        </div>
      </>
    );
  }

  if (kind === "menu") {
    const { views, summary } = await loadRange(r.from, r.to);
    const mr = summary.menuItems.find((x) => x.key === key);
    const code = key.startsWith("pos:") ? null : key;
    const rows = views.flatMap((v) =>
      (v.result?.records ?? []).filter((x) => x.origin.type !== "batch" && (code ? x.origin.menuCode === code : `pos:${x.origin.posName}` === key)).map((x) => ({ ...x, date: v.date })),
    );
    return (
      <>
        <PageHeader title={mr?.name ?? key} sub={<>Menu item drill-down · {fmtRange(r.from, r.to)}</>} actions={filter} />
        {mr && (
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ["Sold", fmtNum(mr.soldQty, 2)],
              ["Staff / comp / waste", `${fmtNum(mr.staffQty)} / ${fmtNum(mr.compQty)} / ${fmtNum(mr.wasteQty)}`],
              ["Revenue ex VAT", <Money key="r" v={mr.revenueExVat} />],
              ["Sold cost", <Money key="c" v={mr.soldCost} />],
              ["Margin", <Money key="m" v={mr.margin} />],
            ].map(([l, v]) => (
              <div key={String(l)} className="card p-3">
                <div className="text-xs text-ink-soft">{l}</div>
                <div className="font-bold">{v}</div>
              </div>
            ))}
          </div>
        )}
        <Card title={`Ingredient and packaging lines (${rows.length})`}>
          <RecordsTable rows={rows} showItem />
        </Card>
      </>
    );
  }

  if (kind === "orders") {
    const channel = typeof sp.channel === "string" ? sp.channel : null;
    const payment = typeof sp.payment === "string" ? sp.payment : null;
    const orders = (await ordersBetween(r.from, r.to)).filter((o) => (!channel || channelOf(o) === channel) && (!payment || paymentKeyOf(o) === payment));
    return (
      <>
        <PageHeader title={channel ? `Channel: ${channel.replace("_", " ")}` : payment ? `Payment: ${payment}` : "Orders"} sub={`${orders.length} orders · ${fmtRange(r.from, r.to)}`} actions={filter} />
        <Card>
          {orders.length === 0 ? (
            <Empty>No orders.</Empty>
          ) : (
            <div className="overflow-x-auto">
              <table className="data">
                <thead>
                  <tr>
                    <th>Date</th>
                    <th>#</th>
                    <th>Status</th>
                    <th>Items</th>
                    <th className="r">Total</th>
                    <th className="r">Discount</th>
                    <th className="r">After discount</th>
                    <th className="r">Refunded</th>
                    <th>Payment</th>
                  </tr>
                </thead>
                <tbody>
                  {orders.map((o) => (
                    <tr key={o.orderKey}>
                      <td>
                        <Link className="underline" href={`/day/${o.businessDate}?tab=orders`}>
                          {o.businessDate}
                        </Link>
                      </td>
                      <td>{o.orderNumber}</td>
                      <td>
                        {o.status}
                        {o.staffMeal && <span className="ml-1 text-xs text-olive">staff</span>}
                      </td>
                      <td className="max-w-xs text-xs">{o.itemsText}</td>
                      <td className="r">
                        <Money v={o.totalSales} />
                      </td>
                      <td className="r">
                        <Money v={o.discountAmount} />
                      </td>
                      <td className="r">
                        <Money v={o.salesAfterDiscount} />
                      </td>
                      <td className="r">
                        <Money v={o.refunded} />
                      </td>
                      <td>{o.paymentRaw ?? <span className="text-red">missing</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <p className="mt-2 text-xs text-ink-soft">
          <Link className="underline" href={`/?${rangeQuery(r)}`}>
            Back to dashboard
          </Link>
        </p>
      </>
    );
  }

  notFound();
}
