import Link from "next/link";
import { notFound } from "next/navigation";
import { commitImportAction, discardImportAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/action-form";
import { MappingForm } from "@/components/mapping-form";
import { Alert, Card, Money, PageHeader } from "@/components/ui";
import { fmtDate, dubaiToday } from "@/lib/dates";
import { can, pageSession } from "@/lib/server/auth";
import { costingFor } from "@/lib/server/costing";
import { getPreview, type OrderClass } from "@/lib/server/sales";

export const metadata = { title: "Review import" };

const CLASS: Record<OrderClass, { label: string; tone: string; help: string }> = {
  new: { label: "New", tone: "bg-olive/15 text-olive", help: "Will be imported." },
  duplicate: { label: "Already imported", tone: "bg-cream-deep text-ink-soft", help: "Identical order already stored; skipped." },
  changed: { label: "Changed", tone: "bg-amber/20 text-brown", help: "Same order ID, different content (e.g. later refund). Choose keep or replace below." },
  out_of_scope: { label: "Other date", tone: "bg-cream-deep text-ink-soft", help: "Outside the selected business date; skipped." },
  in_file_repeat: { label: "Repeated in file", tone: "bg-cream-deep text-ink-soft", help: "The same order appears twice in this file; counted once." },
  possible_duplicate: { label: "Possible duplicate", tone: "bg-red/10 text-red", help: "No order ID and an identical order is already stored. Tick to import it anyway." },
};

export default async function PreviewPage({ params }: { params: Promise<{ id: string }> }) {
  const s = await pageSession("import");
  const { id } = await params;
  const data = await getPreview(Number(id));
  if (!data) notFound();
  const { preview: p, status } = data;
  const costing = await costingFor(p.selectedDate ?? p.dates[0]?.date ?? dubaiToday());
  const menu = costing?.snapshot.menu.map((m) => ({ code: m.code, name: m.name })) ?? [];
  const canMap = can(s.role, "map");
  const fin = can(s.role, "view_finance");
  const unmatched = p.items.filter((i) => !i.match.menuCode && i.match.how !== "ignored");
  const incomplete = p.items.filter((i) => i.match.menuCode && i.costIncomplete);
  const finalizedInScope = p.dates.filter((d) => d.inScope && d.finalized);
  const blocking = p.errors.length > 0 || p.costingIssues.length > 0;
  const importable = p.byClass.new + p.byClass.changed + p.byClass.possible_duplicate;

  return (
    <>
      <PageHeader
        title={`Review import #${p.importId}`}
        sub={
          <>
            {p.fileName} · {p.format.toUpperCase()}
            {p.sheetName ? ` (sheet ${p.sheetName})` : ""} · {p.scope === "all_dates" ? "all dates in file" : `business date ${p.selectedDate}`} · Costing {p.costingLabel ?? "none"} · status {status}
          </>
        }
        actions={
          <Link href="/upload" className="btn btn-ghost btn-sm">
            Back
          </Link>
        }
      />

      <div className="mb-4 space-y-2">
        {p.errors.map((e) => (
          <Alert key={e} tone="error">
            {e}
          </Alert>
        ))}
        {p.costingIssues.map((e) => (
          <Alert key={e} tone="error">
            {e}
          </Alert>
        ))}
        {p.missingColumns.length > 0 && <Alert tone="warning">Columns not found in the file: {p.missingColumns.join(", ")}. Related figures will be unavailable.</Alert>}
        {p.dateNotes.map((n) => (
          <Alert key={n} tone="info">
            {n}
          </Alert>
        ))}
        {finalizedInScope.length > 0 && (
          <Alert tone="warning">
            {finalizedInScope.map((d) => d.date).join(", ")} already finalized. Imported changes will not alter the finalized report until a revision is finalized.
          </Alert>
        )}
        {p.skipped.length > 0 && (
          <Alert tone="warning">
            {p.skipped.length} row(s) skipped: {p.skipped.slice(0, 5).map((x) => `row ${x.row}: ${x.reason}`).join("; ")}
          </Alert>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Detected dates">
          <table className="data">
            <thead>
              <tr>
                <th>Date</th>
                <th className="r">Orders</th>
                <th>In scope</th>
              </tr>
            </thead>
            <tbody>
              {p.dates.map((d) => (
                <tr key={d.date} className={d.inScope ? "" : "text-ink-soft"}>
                  <td>{fmtDate(d.date)}</td>
                  <td className="r">{d.orders}</td>
                  <td>{d.inScope ? (d.finalized ? "yes (finalized)" : "yes") : "no"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Totals in scope">
          <dl className="grid grid-cols-2 gap-y-1 text-sm">
            <dt>Orders</dt>
            <dd className="num text-right">{p.totals.orders}</dd>
            <dt>Items</dt>
            <dd className="num text-right">{p.totals.units}</dd>
          </dl>
          {fin && (
          <dl className="mt-1 grid grid-cols-2 gap-y-1 text-sm">
            <dt>Sales before discounts</dt>
            <dd className="text-right">
              <Money v={p.totals.totalSales} />
            </dd>
            <dt>Discounts</dt>
            <dd className="text-right">
              <Money v={p.totals.discounts} />
            </dd>
            <dt>Sales after discount</dt>
            <dd className="text-right">
              <Money v={p.totals.salesAfterDiscount} />
            </dd>
            <dt>Refunds</dt>
            <dd className="text-right">
              <Money v={p.totals.refunds} />
            </dd>
            <dt>VAT (POS)</dt>
            <dd className="text-right">
              <Money v={p.totals.vat} />
            </dd>
          </dl>
          )}
        </Card>
        <Card title="Duplicate check">
          <ul className="space-y-1 text-sm">
            {(Object.keys(CLASS) as OrderClass[]).map((c) => (
              <li key={c} className="flex items-center justify-between gap-2" title={CLASS[c].help}>
                <span className={`rounded px-2 py-0.5 text-xs font-semibold ${CLASS[c].tone}`}>{CLASS[c].label}</span>
                <span className="num">{p.byClass[c]}</span>
              </li>
            ))}
          </ul>
        </Card>
        <Card title="Payment methods">
          <table className="data">
            <tbody>
              {p.payments.map((x) => (
                <tr key={x.method}>
                  <td className={x.method.startsWith("unknown") ? "font-semibold text-red" : ""}>{x.method}</td>
                  <td className="r">{x.orders}</td>
                  {fin && (
                    <td className="r">
                      <Money v={x.amount} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-xs text-ink-soft">Blank payment methods stay unknown; they are never counted as cash.</p>
        </Card>
        <Card title="Sales channels">
          <table className="data">
            <tbody>
              {p.channels.map((x) => (
                <tr key={x.channel}>
                  <td>{x.channel.replace("_", " ")}</td>
                  <td className="r">{x.orders}</td>
                  {fin && (
                    <td className="r">
                      <Money v={x.amount} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
        <Card title="Item check">
          <p className="text-sm">
            {p.items.length} distinct POS items · <b className={unmatched.length ? "text-red" : "text-olive"}>{unmatched.length} unmatched</b> · <b className={incomplete.length ? "text-amber" : "text-olive"}>{incomplete.length} with missing cost data</b>
          </p>
          {unmatched.length > 0 && <p className="mt-1 text-xs text-ink-soft">Unmatched items can still be imported, but their cost is missing and the day&apos;s reserve will be marked incomplete until they are mapped.</p>}
        </Card>
      </div>

      <Card title="2. Match POS items to the costing workbook" className="mt-4">
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>POS item</th>
                <th className="r">Qty</th>
                <th>Match</th>
                <th>Workbook item</th>
                <th>Cost data</th>
                {canMap && <th>Change mapping</th>}
              </tr>
            </thead>
            <tbody>
              {p.items.map((i) => (
                <tr key={i.posName}>
                  <td className="font-medium">{i.posName}</td>
                  <td className="r">{i.qty}</td>
                  <td>
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${i.match.menuCode ? (i.match.how === "suggested" ? "bg-amber/20" : "bg-olive/15 text-olive") : i.match.how === "ignored" ? "bg-cream-deep" : "bg-red/10 text-red"}`}>
                      {i.match.how}
                    </span>
                  </td>
                  <td>{i.menuName ? `${i.menuName} (${i.match.menuCode})` : "—"}</td>
                  <td className={`text-xs ${i.costIncomplete ? "text-red" : "text-olive"}`}>{i.costNote || "Complete"}</td>
                  {canMap && (
                    <td>
                      <MappingForm posName={i.posName} current={i.match.how === "ignored" ? "__ignore" : i.match.menuCode} candidates={i.match.candidates} menu={menu} />
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-xs text-ink-soft">&quot;exact&quot; = same name or Item ID as the workbook; &quot;suggested&quot; = closest name, used until you save a mapping; &quot;saved&quot; = your stored mapping, reused for future uploads.</p>
      </Card>

      <Card title="Orders in file" className="mt-4">
        <div className="max-h-[32rem] overflow-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Import</th>
                <th>Date</th>
                <th>#</th>
                <th>Status</th>
                <th>Channel</th>
                <th>Items</th>
                {fin && (
                  <>
                    <th className="r">Total</th>
                    <th className="r">Discount</th>
                    <th className="r">After disc.</th>
                    <th className="r">Refunded</th>
                  </>
                )}
                <th>Payment</th>
              </tr>
            </thead>
            <tbody>
              {p.orders.map((o) => (
                <tr key={`${o.orderKey}-${o.sourceRow}`} className={o.cls === "new" || o.cls === "changed" || o.cls === "possible_duplicate" ? "" : "text-ink-soft"}>
                  <td>
                    <span className={`rounded px-2 py-0.5 text-xs font-semibold ${CLASS[o.cls].tone}`} title={o.note || CLASS[o.cls].help}>
                      {CLASS[o.cls].label}
                    </span>
                    {o.cls === "possible_duplicate" && (
                      <label className="ml-1 text-xs">
                        <input type="checkbox" name="includePossible" value={o.orderKey} form="commit-form" /> import
                      </label>
                    )}
                    {o.warnings.length > 0 && <div className="text-xs text-amber">{o.warnings.join("; ")}</div>}
                  </td>
                  <td className="text-xs">{o.businessDate}</td>
                  <td>{o.orderNumber}</td>
                  <td>
                    {o.status}
                    {o.staffMeal && <span className="ml-1 text-xs text-olive">staff</span>}
                  </td>
                  <td className="text-xs">{o.channel.replace("_", " ")}</td>
                  <td className="max-w-xs text-xs">{o.itemsText}</td>
                  {fin && (
                    <>
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
                    </>
                  )}
                  <td className="text-xs">{o.paymentRaw ?? <span className="text-red">blank</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {status === "preview" ? (
        <Card title="3. Confirm" className="mt-4">
          <ActionForm action={commitImportAction} id="commit-form" className="space-y-3">
            <input type="hidden" name="importId" value={p.importId} />
            {p.byClass.changed > 0 && (
              <fieldset className="text-sm">
                <legend className="label">{p.byClass.changed} order(s) changed since the last import</legend>
                <label className="mr-4">
                  <input type="radio" name="changedPolicy" value="replace" defaultChecked /> Replace with this file&apos;s version
                </label>
                <label>
                  <input type="radio" name="changedPolicy" value="keep" /> Keep the stored version
                </label>
              </fieldset>
            )}
            <p className="text-sm">
              {importable === 0 ? "Nothing new to import — every order is already stored or out of scope." : `${p.byClass.new} new order(s) will be added${p.byClass.changed ? `, ${p.byClass.changed} changed` : ""}${p.byClass.possible_duplicate ? `, ${p.byClass.possible_duplicate} possible duplicates only if ticked` : ""}.`} After importing, add missed staff meals, complimentary items or wastage on the day page.
            </p>
            <div className="flex flex-wrap gap-2">
              {blocking ? (
                <span className="text-sm font-semibold text-red">Fix the errors above before importing.</span>
              ) : (
                <Submit className="btn btn-primary" pending="Importing…">
                  Confirm import
                </Submit>
              )}
            </div>
          </ActionForm>
          <ActionForm action={discardImportAction} className="mt-2" confirm="Discard this preview?">
            <input type="hidden" name="importId" value={p.importId} />
            <Submit className="btn btn-ghost btn-sm">Discard</Submit>
          </ActionForm>
        </Card>
      ) : (
        <Alert tone="info">This import is {status}.</Alert>
      )}
    </>
  );
}
