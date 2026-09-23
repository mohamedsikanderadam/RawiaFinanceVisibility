import Link from "next/link";
import { addLedgerAction, voidLedgerAction } from "@/app/actions";
import { ActionForm, Submit } from "@/components/action-form";
import { RangeFilter } from "@/components/range-filter";
import { Card, DayStateBadge, Money, PageHeader, StatusBadge } from "@/components/ui";
import { LEDGER_TYPES } from "@/db/schema";
import { fmtDate, fmtRange, fmtStamp } from "@/lib/dates";
import { fmtNum } from "@/lib/money";
import { can, pageSession } from "@/lib/server/auth";
import { LEDGER_LABEL, cashEffect, computeFunding, listLedger } from "@/lib/server/ledger";
import { loadRange, resolveRange, type SearchParams } from "@/lib/server/range";

export const metadata = { title: "Reserve & ledger" };

const HELP: Record<string, string> = {
  opening_balance: "Counted cash or bank statement balance at the start of the date.",
  allocation: "Money earmarked for replenishment. It does not leave the account.",
  purchase: "Stock bought. Reduces cash/bank; tick 'from reserve' to draw down the reserve. Not deducted again as cost.",
  expense: "Rent, salaries, utilities etc. paid.",
  settlement: "Card or aggregator payout received in the bank.",
  owner_contribution: "Money the owner put in.",
  owner_withdrawal: "Money the owner took out.",
  adjustment: "Correction; use a negative amount to reduce.",
  liabilities_statement: "Total of unpaid bills, VAT due, salaries owed, as at the date.",
};

export default async function ReservePage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const s = await pageSession("view_finance");
  const sp = await searchParams;
  const r = resolveRange(sp);
  const prefill = typeof sp.prefill === "string" && /^-?\d+(\.\d+)?$/.test(sp.prefill) ? Number(sp.prefill).toFixed(2) : "";
  const { views } = await loadRange(r.from, r.to);
  const [funding, ledger] = await Promise.all([computeFunding(r.from, r.to, views), listLedger(300)]);
  const canLedger = can(s.role, "ledger");
  const L = funding.lines;

  return (
    <>
      <PageHeader title="Replenishment reserve and cash" sub={`How much should I set aside, what is it for, and what remains? · ${fmtRange(r.from, r.to)}`} actions={<RangeFilter r={r} base="/reserve" />} />

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {["required", "allocated", "purchases", "remaining", "unfunded", "cash", "bank", "unearmarked"].map((k) => (
          <div key={k} className="card p-4">
            <div className="flex items-start justify-between gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{L[k].label}</div>
              <StatusBadge status={L[k].status} />
            </div>
            <div className={`num mt-1 text-2xl font-bold ${k === "unfunded" && Number(L[k].value) > 0 ? "text-red" : ""}`}>{L[k].value === null ? <span className="text-base text-ink-soft">Not available</span> : <Money v={L[k].value} />}</div>
            <details className="mt-1 text-xs text-ink-soft">
              <summary className="cursor-pointer">How is this calculated?</summary>
              <p>{L[k].definition}</p>
              {L[k].notes.map((n) => (
                <p key={n} className="mt-1 text-amber">
                  {n}
                </p>
              ))}
            </details>
          </div>
        ))}
      </div>
      <p className="mt-2 text-xs text-ink-soft">
        The reserve is a business-wide requirement built from all consumption, whether the sale was paid in cash or by card. It is not automatically an amount to take out of the cash drawer, and the operating result is not cash available to withdraw.
      </p>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Required reserve by day">
          <div className="max-h-96 overflow-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th className="r">Required</th>
                  <th className="r">Set aside</th>
                  <th className="r">Purchases</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {funding.perDay
                  .filter((d) => d.state !== "no_data" || Number(d.allocated) || Number(d.purchases))
                  .map((d) => (
                    <tr key={d.date}>
                      <td>
                        <Link className="underline" href={`/day/${d.date}`}>
                          {fmtDate(d.date)}
                        </Link>
                      </td>
                      <td className="r">
                        <Money v={d.required} />
                        {d.incomplete && <StatusBadge status="incomplete" className="ml-1" />}
                      </td>
                      <td className="r">
                        <Money v={d.allocated} />
                      </td>
                      <td className="r">
                        <Money v={d.purchases} />
                      </td>
                      <td>
                        <DayStateBadge state={d.state} revision={null} />
                      </td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        </Card>
        <Card title="What the reserve is for (by ingredient and packaging)">
          <div className="max-h-96 overflow-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Item</th>
                  <th className="r">Qty used</th>
                  <th className="r">Reserve</th>
                </tr>
              </thead>
              <tbody>
                {funding.byItem.map((i) => (
                  <tr key={`${i.itemKey}|${i.unit}`}>
                    <td>
                      <Link className="underline decoration-cream-deep" href={`/drill/item?key=${encodeURIComponent(i.itemKey)}&preset=custom&from=${r.from}&to=${r.to}`}>
                        {i.label}
                      </Link>
                      {i.incomplete && <StatusBadge status="incomplete" className="ml-1" />}
                    </td>
                    <td className="r">
                      {fmtNum(i.qty, 2)} {i.unit}
                    </td>
                    <td className="r">{i.incomplete ? <span className="text-red">Missing cost</span> : <Money v={i.amount} />}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      </div>

      {canLedger && (
        <Card title="Record a ledger entry" className="mt-4">
          <ActionForm action={addLedgerAction} className="grid gap-2 md:grid-cols-7 md:items-end">
            <label>
              <span className="label">Date</span>
              <input type="date" name="entryDate" defaultValue={r.to} className="input" required />
            </label>
            <label className="md:col-span-2">
              <span className="label">Type</span>
              <select name="type" className="input" defaultValue="allocation">
                {LEDGER_TYPES.map((t) => (
                  <option key={t} value={t} title={HELP[t]}>
                    {LEDGER_LABEL[t]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Account</span>
              <select name="account" className="input" defaultValue="cash">
                <option value="cash">Cash</option>
                <option value="bank">Bank</option>
              </select>
            </label>
            <label>
              <span className="label">Amount AED</span>
              <input name="amount" inputMode="decimal" className="input" defaultValue={prefill} required />
            </label>
            <label>
              <span className="label">Supplier / party</span>
              <input name="counterparty" className="input" />
            </label>
            <label className="md:col-span-1">
              <span className="label">Description</span>
              <input name="description" className="input" />
            </label>
            <label className="flex items-center gap-2 text-sm md:col-span-3">
              <input type="checkbox" name="fromReserve" defaultChecked /> Stock purchase paid from the replenishment reserve
            </label>
            <div className="md:col-span-4 md:text-right">
              <Submit>Record entry</Submit>
            </div>
          </ActionForm>
          <ul className="mt-3 grid gap-1 text-xs text-ink-soft md:grid-cols-2">
            {LEDGER_TYPES.map((t) => (
              <li key={t}>
                <b>{LEDGER_LABEL[t]}:</b> {HELP[t]}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card title="Ledger" className="mt-4">
        {ledger.length === 0 ? (
          <p className="text-sm text-ink-soft">No entries yet. Record opening cash and bank balances to see balances.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="data">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Type</th>
                  <th>Account</th>
                  <th className="r">Amount</th>
                  <th className="r">Balance effect</th>
                  <th>Party / description</th>
                  <th>By</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {ledger.map(({ e, name }) => (
                  <tr key={e.id} className={e.voidedAt ? "text-ink-soft line-through" : ""}>
                    <td>{e.entryDate}</td>
                    <td>
                      {LEDGER_LABEL[e.type]}
                      {e.fromReserve && <span className="ml-1 text-xs text-olive">from reserve</span>}
                    </td>
                    <td>{e.account}</td>
                    <td className="r">
                      <Money v={e.amount} />
                    </td>
                    <td className="r">{e.type === "opening_balance" ? "sets balance" : e.type === "liabilities_statement" || e.type === "allocation" ? "earmark only" : <Money v={cashEffect(e).toString()} sign />}</td>
                    <td className="text-xs">
                      {e.counterparty} {e.description}
                    </td>
                    <td className="text-xs">
                      {name} · {fmtStamp(e.createdAt)}
                    </td>
                    <td>
                      {!e.voidedAt && canLedger && (
                        <ActionForm action={voidLedgerAction} confirm="Void this entry? It stays in the audit trail.">
                          <input type="hidden" name="id" value={e.id} />
                          <Submit className="btn btn-ghost btn-sm">Void</Submit>
                        </ActionForm>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
