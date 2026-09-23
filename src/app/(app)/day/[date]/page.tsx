import Link from "next/link";
import { notFound } from "next/navigation";
import {
  finalizeDayAction,
  setDecisionAction,
  voidAdjustmentAction,
} from "@/app/actions";
import { ActionForm, Submit } from "@/components/action-form";
import { AdjustmentForm } from "@/components/adjustment-form";
import {
  Alert,
  Card,
  DayStateBadge,
  Empty,
  MetricRow,
  Money,
  PageHeader,
  StatusBadge,
} from "@/components/ui";
import { addDays, fmtDate, fmtStamp, isIsoDate } from "@/lib/dates";
import { reconcileSold } from "@/lib/engine/reconcile";
import { BUCKET_LABEL, type DayResult } from "@/lib/engine/types";
import { D, fmtNum } from "@/lib/money";
import { METRIC_GROUPS, groupKeys } from "@/lib/report";
import { can, pageSession } from "@/lib/server/auth";
import { costingFor, snapshotOf } from "@/lib/server/costing";
import {
  dayRevisions,
  getDay,
  getRevision,
  listAdjustments,
  ordersFor,
} from "@/lib/server/day";
import { computeFunding } from "@/lib/server/ledger";

export const metadata = { title: "Day" };

function Metrics({ r }: { r: DayResult }) {
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {METRIC_GROUPS.map((g) => (
        <Card key={g.title} title={g.title}>
          <table className="data">
            <tbody>
              {groupKeys(g).map(({ key, mod }) => (
                <MetricRow
                  key={key}
                  m={r.metrics[key]}
                  indent={mod === "indent"}
                  strong={mod === "strong"}
                />
              ))}
            </tbody>
          </table>
        </Card>
      ))}
    </div>
  );
}

export default async function DayPage({
  params,
  searchParams,
}: {
  params: Promise<{ date: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const s = await pageSession("view");
  const fin = can(s.role, "view_finance");
  const { date } = await params;
  if (!isIsoDate(date)) notFound();
  const sp = await searchParams;
  const live = sp.live === "1";
  const revParam = typeof sp.rev === "string" ? Number(sp.rev) : null;

  const [view, orders, adjustments, revisions, costing] = await Promise.all([
    getDay(date, { live }),
    ordersFor(date),
    listAdjustments(date),
    dayRevisions(date),
    costingFor(date),
  ]);
  const historic = revParam ? await getRevision(date, revParam) : null;
  const r = historic ?? view.result;
  const funding = fin ? await computeFunding(date, date, [view]) : null;
  const snap = r
    ? await snapshotOf(r.costingVersionId)
    : (costing?.snapshot ?? null);
  const recon =
    r && snap ? reconcileSold(r.menuItems, snap, r.karak.menuCode) : null;
  const canAdjust =
    can(s.role, "adjust") && (view.state !== "finalized" || live);
  const decisions = new Map((r?.decisions ?? []).map((d) => [d.orderKey, d]));
  const isFinal = view.state === "finalized" && !live && !historic;

  return (
    <>
      <PageHeader
        title={fmtDate(date)}
        sub={
          <span className="flex flex-wrap items-center gap-2">
            <DayStateBadge state={view.state} revision={view.revision} />
            {historic && <StatusBadge status="confirmed" />}
            {historic && <span>Showing revision {revParam}</span>}
            {live && view.state === "finalized" && (
              <span className="font-semibold text-red">
                Showing live recalculation (not the finalized report)
              </span>
            )}
            {r && (
              <span>
                Costing: {r.costingLabel} (v{r.costingVersionId}) · Settings v
                {r.settingsVersionId ?? "default"}
              </span>
            )}
            {view.finalizedAt && (
              <span>
                · Finalized {fmtStamp(view.finalizedAt)} by {view.finalizedBy}
              </span>
            )}
          </span>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <Link
              className="btn btn-ghost btn-sm"
              href={`/day/${addDays(date, -1)}`}
            >
              ← Prev
            </Link>
            <Link
              className="btn btn-ghost btn-sm"
              href={`/day/${addDays(date, 1)}`}
            >
              Next →
            </Link>
            {r && (
              <>
                <a
                  className="btn btn-primary btn-sm"
                  href={`/api/export/day/${date}/pdf${historic ? `?rev=${revParam}` : live ? "?live=1" : ""}`}
                >
                  EOD PDF
                </a>
                <a
                  className="btn btn-olive btn-sm"
                  href={`/api/export/xlsx?report=full&from=${date}&to=${date}`}
                >
                  Excel
                </a>
              </>
            )}
          </div>
        }
      />

      <div className="mb-4 space-y-2">
        {view.noCostingReason && (
          <Alert tone="error">{view.noCostingReason}</Alert>
        )}
        {view.liveDiff && !live && (
          <Alert tone="warning">
            This finalized report differs from a recalculation with current data
            (reserve {view.liveDiff.reserve ?? "—"}, net sales{" "}
            {view.liveDiff.netSales ?? "—"}). The finalized figures are kept.{" "}
            <Link
              className="font-semibold underline"
              href={`/day/${date}?live=1`}
            >
              View live recalculation
            </Link>{" "}
            {can(s.role, "finalize") && "and finalize a revision to adopt it."}
          </Alert>
        )}
        {(live || historic) && (
          <Alert tone="info">
            <Link className="font-semibold underline" href={`/day/${date}`}>
              Back to the current report
            </Link>
          </Alert>
        )}
        {r?.issues
          .filter((i) => i.severity !== "info")
          .map((i, k) => (
            <Alert key={k} tone={i.severity === "error" ? "error" : "warning"}>
              {i.message}{" "}
              {i.code === "unmatched_item" && can(s.role, "map") && (
                <Link
                  className="font-semibold underline"
                  href={`/mappings?pos=${encodeURIComponent(i.ref ?? "")}`}
                >
                  Map it
                </Link>
              )}
            </Alert>
          ))}
      </div>

      {!r ? (
        <Empty>No sales or adjustments recorded for this date.</Empty>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
            {[
              ["Orders", r.counts.orders],
              ["Items sold", fmtNum(r.counts.units, 0)],
              ["Staff meals", r.counts.staffOrders],
              [
                "Refunded / voided",
                `${r.counts.refunded} / ${r.counts.voided}`,
              ],
              ["Karak cups", fmtNum(r.counts.karakCups, 0)],
            ].map(([l, v]) => (
              <div key={String(l)} className="card p-3">
                <div className="text-xs text-ink-soft">{l}</div>
                <div className="num text-xl font-bold">{v}</div>
              </div>
            ))}
          </div>

          {fin && funding && (
            <>
              <Metrics r={r} />

              <Card title="How much to set aside today?" className="mt-4">
                <div className="grid gap-4 md:grid-cols-3">
                  <div>
                    <div className="text-xs text-ink-soft">
                      Required replenishment reserve
                    </div>
                    <div className="num text-2xl font-bold text-red">
                      <Money v={r.metrics.reserve?.value} />
                    </div>
                    <StatusBadge
                      status={r.metrics.reserve?.status ?? "unavailable"}
                    />
                  </div>
                  <div>
                    <div className="text-xs text-ink-soft">
                      Set aside today (ledger)
                    </div>
                    <div className="num text-2xl font-bold">
                      <Money v={funding.lines.allocated.value} />
                    </div>
                    <div className="text-xs">
                      Unfunded: <Money v={funding.lines.unfunded.value} />
                    </div>
                  </div>
                  <div className="text-sm">
                    It is for replacing the stock listed below (sold items,
                    staff meals, complimentary items, wastage and the Karak
                    batch). It covers cash and card sales, so it is a
                    business-wide amount, not a drawer withdrawal.{" "}
                    {can(s.role, "ledger") && (
                      <Link
                        className="font-semibold text-red underline"
                        href={`/reserve?from=${date}&to=${date}&preset=custom&prefill=${r.metrics.reserve?.value ?? ""}`}
                      >
                        Record set-aside
                      </Link>
                    )}
                  </div>
                </div>
              </Card>

              <Card
                title="Replenishment breakdown (consumption, not a purchase order)"
                className="mt-4"
              >
                <div className="overflow-x-auto">
                  <table className="data">
                    <thead>
                      <tr>
                        <th>Ingredient / packaging</th>
                        <th className="r">Quantity consumed</th>
                        <th>Unit</th>
                        <th className="r">Unit cost</th>
                        <th className="r">Amount</th>
                        <th>Used by</th>
                      </tr>
                    </thead>
                    <tbody>
                      {r.consumption.map((c) => (
                        <tr key={`${c.itemKey}|${c.unit}`}>
                          <td>
                            <Link
                              className="underline decoration-cream-deep hover:decoration-red"
                              href={`/drill/item?key=${encodeURIComponent(c.itemKey)}&preset=custom&from=${date}&to=${date}`}
                            >
                              {c.label}
                            </Link>
                            {c.incomplete && (
                              <StatusBadge
                                status="incomplete"
                                className="ml-2"
                              />
                            )}
                          </td>
                          <td className="r">{fmtNum(c.qty, 3)}</td>
                          <td>{c.unit}</td>
                          <td className="r">
                            {c.unitCost === null ? "—" : fmtNum(c.unitCost, 5)}
                          </td>
                          <td className="r">
                            {c.incomplete ? (
                              <span className="text-red">Missing cost</span>
                            ) : (
                              <Money v={c.amount} />
                            )}
                          </td>
                          <td className="text-xs">
                            {Object.keys(c.byBucket)
                              .map(
                                (b) =>
                                  BUCKET_LABEL[b as keyof typeof BUCKET_LABEL],
                              )
                              .join(", ")}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr>
                        <td colSpan={4} className="font-bold">
                          Total replenishment reserve
                        </td>
                        <td className="r font-bold">
                          <Money v={r.metrics.reserve?.value} />
                        </td>
                        <td>
                          <StatusBadge
                            status={r.metrics.reserve?.status ?? "unavailable"}
                          />
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
                <p className="mt-2 text-xs text-ink-soft">
                  A recommended purchase quantity needs stock on hand, pack
                  sizes and target levels, which are not recorded; this table is
                  what was used.
                </p>
              </Card>
            </>
          )}

          <div className="mt-4 grid gap-4 lg:grid-cols-2">
            <Card title="Cane Karak daily batch">
              <p className="text-sm">
                {r.karak.batches} batch(es) prepared (
                {r.karak.source === "adjusted"
                  ? "adjusted"
                  : r.karak.source === "no_sales"
                    ? "no Karak sold, no adjustment"
                    : "default"}
                ) · {fmtNum(r.karak.cups, 0)} cups sold · Cost{" "}
                <Money v={r.karak.cost} className="font-bold" />
              </p>
              <p className="text-xs text-ink-soft">
                Allocated to batch ingredients <Money v={r.karak.allocated} />,
                unallocated batch reserve <Money v={r.karak.unallocated} />.
                Per-cup recipe cost is not charged; per-cup packaging is.
              </p>
              {canAdjust && <AdjustmentForm date={date} mode="batch" />}
            </Card>
            {fin && (
              <Card title="Reconciliation with workbook menu costs">
                {recon && (
                  <>
                    <p className="mb-2 text-sm">
                      App <Money v={recon.appTotal} /> vs workbook{" "}
                      <Money v={recon.workbookTotal} /> →{" "}
                      <Money
                        v={recon.diffTotal}
                        sign
                        className={
                          D(recon.diffTotal).abs().gte(0.01)
                            ? "font-bold text-red"
                            : "text-olive"
                        }
                      />
                    </p>
                    <table className="data">
                      <thead>
                        <tr>
                          <th>Item</th>
                          <th className="r">Qty</th>
                          <th className="r">App</th>
                          <th className="r">Workbook</th>
                          <th className="r">Diff</th>
                        </tr>
                      </thead>
                      <tbody>
                        {recon.rows.map((x) => (
                          <tr key={x.code}>
                            <td>
                              {x.name}
                              {x.note && (
                                <div className="text-xs text-ink-soft">
                                  {x.note}
                                </div>
                              )}
                            </td>
                            <td className="r">{fmtNum(x.qty, 0)}</td>
                            <td className="r">
                              <Money v={x.appCost} />
                            </td>
                            <td className="r">
                              <Money v={x.workbookCost} />
                            </td>
                            <td
                              className={`r ${x.diff && D(x.diff).abs().gte(0.01) ? "font-bold text-red" : ""}`}
                            >
                              <Money v={x.diff} sign />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </>
                )}
              </Card>
            )}
          </div>
        </>
      )}

      <Card
        title="Adjustments (staff meals, complimentary, wastage, manual)"
        className="mt-4"
        id="adjustments"
      >
        {adjustments.length === 0 ? (
          <p className="text-sm text-ink-soft">None recorded.</p>
        ) : (
          <table className="data mb-3">
            <thead>
              <tr>
                <th>Type</th>
                <th>Item</th>
                <th className="r">Qty</th>
                <th className="r">Amount</th>
                <th>Note</th>
                <th>By</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {adjustments.map(({ a, name }) => (
                <tr
                  key={a.id}
                  className={a.voidedAt ? "text-ink-soft line-through" : ""}
                >
                  <td>{a.type.replace("_", " ")}</td>
                  <td>
                    {a.menuCode
                      ? (snap?.menu.find((m) => m.code === a.menuCode)?.name ??
                        a.menuCode)
                      : a.itemKey
                        ? (snap?.items.find((i) => i.key === a.itemKey)?.name ??
                          a.itemKey)
                        : "—"}
                  </td>
                  <td className="r">{a.qty}</td>
                  <td className="r">
                    <Money v={a.amount} />
                  </td>
                  <td>{a.note}</td>
                  <td className="text-xs">
                    {name} · {fmtStamp(a.createdAt)}
                  </td>
                  <td>
                    {!a.voidedAt && canAdjust && (
                      <ActionForm
                        action={voidAdjustmentAction}
                        confirm="Remove this adjustment?"
                      >
                        <input type="hidden" name="id" value={a.id} />
                        <Submit className="btn btn-ghost btn-sm">Remove</Submit>
                      </ActionForm>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {canAdjust && snap ? (
          <AdjustmentForm
            date={date}
            mode="item"
            menu={snap.menu.map((m) => ({ code: m.code, name: m.name }))}
            items={snap.items.map((i) => ({
              key: i.key,
              name: i.name,
              unit: i.baseUnit ?? "",
            }))}
          />
        ) : view.state === "finalized" && can(s.role, "adjust") ? (
          <p className="text-xs text-ink-soft">
            This day is finalized. Open the{" "}
            <Link className="underline" href={`/day/${date}?live=1`}>
              live view
            </Link>{" "}
            to add a correction, then finalize a revision.
          </p>
        ) : null}
      </Card>

      <Card title={`Orders (${orders.length})`} className="mt-4" id="orders">
        {orders.length === 0 ? (
          <p className="text-sm text-ink-soft">
            No orders imported for this date.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Time</th>
                  <th>Status</th>
                  <th>Channel</th>
                  <th>Items</th>
                  <th className="r">Total</th>
                  <th className="r">After discount</th>
                  <th className="r">Refunded</th>
                  <th>Payment</th>
                  <th>Prepared?</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((o) => {
                  const d = decisions.get(o.orderKey);
                  return (
                    <tr key={o.orderKey}>
                      <td>{o.orderNumber}</td>
                      <td className="whitespace-nowrap text-xs">
                        {o.submittedAt?.slice(11, 16)}
                      </td>
                      <td>
                        {o.status}
                        {o.staffMeal && (
                          <div className="text-xs text-olive">
                            staff meal
                            {o.staffMealFor ? ` (${o.staffMealFor})` : ""}
                          </div>
                        )}
                      </td>
                      <td className="text-xs">
                        {o.deliveryApp ?? o.spotType ?? "—"}
                      </td>
                      <td className="max-w-xs text-xs">{o.itemsText}</td>
                      <td className="r">
                        <Money v={o.totalSales} />
                      </td>
                      <td className="r">
                        <Money v={o.salesAfterDiscount} />
                      </td>
                      <td className="r">
                        <Money v={o.refunded} />
                      </td>
                      <td className="text-xs">
                        {o.paymentRaw ?? (
                          <span className="font-semibold text-red">
                            missing
                          </span>
                        )}
                      </td>
                      <td className="text-xs">
                        {d ? (
                          canAdjust ? (
                            <ActionForm
                              action={setDecisionAction}
                              className="flex flex-col gap-1"
                            >
                              <input
                                type="hidden"
                                name="orderKey"
                                value={o.orderKey}
                              />
                              <select
                                name="prep"
                                defaultValue={d.prep}
                                className="input py-1 text-xs"
                                aria-label="Preparation status"
                              >
                                <option value="prepared">
                                  Prepared, not recoverable
                                </option>
                                <option value="recovered">
                                  Prepared, stock recovered
                                </option>
                                <option value="not_prepared">
                                  Not prepared
                                </option>
                              </select>
                              <input
                                name="note"
                                placeholder="Note"
                                defaultValue={o.decision?.note ?? ""}
                                className="input py-1 text-xs"
                              />
                              <Submit className="btn btn-ghost btn-sm">
                                {d.source === "default" ? "Confirm" : "Update"}
                              </Submit>
                              {d.source === "default" && (
                                <span className="text-amber">default</span>
                              )}
                            </ActionForm>
                          ) : (
                            <span>
                              {d.prep.replace("_", " ")} ({d.source})
                            </span>
                          )
                        ) : o.status === "open" ? (
                          <span className="text-amber">open – excluded</span>
                        ) : (
                          "prepared"
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {fin && (
<Card title="Finalization and revisions" className="mt-4" id="finalize">
        {revisions.length === 0 ? (
          <p className="mb-3 text-sm text-ink-soft">
            Not finalized. Figures recalculate whenever data, costing or
            settings change.
          </p>
        ) : (
          <table className="data mb-3">
            <thead>
              <tr>
                <th>Revision</th>
                <th>Finalized</th>
                <th>By</th>
                <th>Reason</th>
                <th className="r">Reserve</th>
                <th className="r">Net sales</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {revisions.map((v) => (
                <tr key={v.id}>
                  <td>
                    {v.revision}
                    {!v.supersededAt && (
                      <span className="ml-1 text-xs font-semibold text-olive">
                        current
                      </span>
                    )}
                  </td>
                  <td className="text-xs">{fmtStamp(v.finalizedAt)}</td>
                  <td>{v.name}</td>
                  <td>{v.reason || "—"}</td>
                  <td className="r">
                    <Money v={v.payload.metrics.reserve?.value} />
                  </td>
                  <td className="r">
                    <Money
                      v={
                        v.payload.metrics.netSales?.value ??
                        v.payload.metrics.netSalesInclVat?.value
                      }
                    />
                  </td>
                  <td>
                    <Link
                      className="text-xs underline"
                      href={`/day/${date}?rev=${v.revision}`}
                    >
                      View
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {fin &&
          can(s.role, "finalize") &&
          view.result &&
          !historic &&
          (isFinal ? view.liveDiff !== null || live : true) && (
            <ActionForm
              action={finalizeDayAction}
              className="flex flex-wrap items-end gap-2"
              confirm={
                revisions.length
                  ? "Finalize a new revision? The previous revision is kept in history."
                  : "Finalize this day? Later changes will need a revision."
              }
            >
              <input type="hidden" name="date" value={date} />
              <label className="flex-1">
                <span className="label">
                  {revisions.length
                    ? "Reason for revision (required)"
                    : "Note (optional)"}
                </span>
                <input
                  name="reason"
                  className="input"
                  required={revisions.length > 0}
                />
              </label>
              <Submit>
                {revisions.length
                  ? `Finalize revision ${revisions.length + 1}`
                  : "Finalize day"}
              </Submit>
            </ActionForm>
          )}
        {isFinal && !view.liveDiff && (
          <p className="text-xs text-ink-soft">
            Current data matches the finalized report.
          </p>
        )}
      </Card>
)}
    </>
  );
}
