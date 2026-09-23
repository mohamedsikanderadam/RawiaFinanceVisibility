import { and, asc, desc, eq, gte, isNull, lte } from "drizzle-orm";
import { db, schema } from "@/db";
import type { LedgerType } from "@/db/schema";
import { D, ZERO, sum, type Dec } from "../money";
import { getDay, type DayView } from "./day";
import { audit, type Actor } from "./audit";

export type LedgerRow = typeof schema.ledgerEntries.$inferSelect;

export const LEDGER_LABEL: Record<LedgerType, string> = {
  opening_balance: "Opening balance",
  allocation: "Set aside for replenishment",
  purchase: "Stock purchase",
  expense: "Operating expense",
  settlement: "Card / aggregator settlement received",
  owner_contribution: "Owner contribution",
  owner_withdrawal: "Owner withdrawal",
  adjustment: "Adjustment (+/−)",
  liabilities_statement: "Outstanding liabilities statement",
};

export type NewLedgerEntry = {
  entryDate: string;
  type: LedgerType;
  account: "cash" | "bank" | "none";
  amount: string;
  counterparty: string | null;
  fromReserve: boolean;
  description: string;
};

export async function addLedgerEntry(e: NewLedgerEntry, actor: Actor): Promise<number> {
  const amt = D(e.amount);
  if (e.type !== "adjustment" && amt.lt(0)) throw new Error("Amount must be positive; the entry type sets the direction.");
  if (e.type !== "liabilities_statement" && e.account === "none") throw new Error("Choose the cash or bank account.");
  const [row] = await db
    .insert(schema.ledgerEntries)
    .values({ ...e, fromReserve: e.type === "purchase" ? e.fromReserve : false, createdBy: actor?.id ?? null })
    .returning({ id: schema.ledgerEntries.id });
  await audit(actor, "ledger.add", "ledger_entry", row.id, { ...e }, e.entryDate);
  return row.id;
}

export async function voidLedgerEntry(id: number, actor: Actor): Promise<void> {
  const rows = await db.update(schema.ledgerEntries).set({ voidedAt: new Date(), voidedBy: actor?.id ?? null }).where(eq(schema.ledgerEntries.id, id)).returning();
  if (rows[0]) await audit(actor, "ledger.void", "ledger_entry", id, { type: rows[0].type, amount: rows[0].amount }, rows[0].entryDate);
}

export async function ledgerUpTo(to: string): Promise<LedgerRow[]> {
  return db
    .select()
    .from(schema.ledgerEntries)
    .where(and(lte(schema.ledgerEntries.entryDate, to), isNull(schema.ledgerEntries.voidedAt)))
    .orderBy(asc(schema.ledgerEntries.entryDate), asc(schema.ledgerEntries.id));
}

export async function listLedger(limit = 500) {
  return db
    .select({ e: schema.ledgerEntries, name: schema.users.name })
    .from(schema.ledgerEntries)
    .leftJoin(schema.users, eq(schema.users.id, schema.ledgerEntries.createdBy))
    .orderBy(desc(schema.ledgerEntries.entryDate), desc(schema.ledgerEntries.id))
    .limit(limit);
}

/** Signed effect on the account balance. Allocations only earmark money, so they do not move it. */
export function cashEffect(e: Pick<LedgerRow, "type" | "amount">): Dec {
  const a = D(e.amount);
  switch (e.type) {
    case "settlement":
    case "owner_contribution":
    case "adjustment":
      return a;
    case "purchase":
    case "expense":
    case "owner_withdrawal":
      return a.neg();
    default:
      return ZERO;
  }
}

export type Status = "confirmed" | "calculated" | "estimate" | "incomplete" | "unavailable";

export type FundingLine = { key: string; label: string; value: string | null; status: Status; definition: string; notes: string[] };

export type Funding = {
  from: string;
  to: string;
  lines: Record<string, FundingLine>;
  perDay: { date: string; required: string | null; incomplete: boolean; allocated: string; purchases: string; state: DayView["state"] }[];
  byItem: { itemKey: string; label: string; unit: string; qty: string; amount: string; incomplete: boolean }[];
  entries: LedgerRow[];
};

/** "How much should I set aside, what is it for, and what remains?" for a date range. */
export async function computeFunding(from: string, to: string, days: DayView[]): Promise<Funding> {
  const all = await ledgerUpTo(to);
  const inRange = all.filter((e) => e.entryDate >= from);
  const before = all.filter((e) => e.entryDate < from);

  const required = sum(days.map((d) => D(d.result?.metrics.reserve?.value)));
  const reqIncomplete = days.some((d) => d.result?.metrics.reserve?.status === "incomplete");
  const noCosting = days.some((d) => d.noCostingReason);

  const sumType = (rows: LedgerRow[], t: LedgerType, pred: (e: LedgerRow) => boolean = () => true) => sum(rows.filter((e) => e.type === t && pred(e)).map((e) => D(e.amount)));
  const allocated = sumType(inRange, "allocation");
  const purchasesFromReserve = sumType(inRange, "purchase", (e) => e.fromReserve);
  const purchasesAll = sumType(inRange, "purchase");
  const fundedBefore = sumType(before, "allocation").minus(sumType(before, "purchase", (e) => e.fromReserve));
  const remaining = fundedBefore.plus(allocated).minus(purchasesFromReserve);
  const unfunded = required.minus(allocated);

  const perDay = days.map((d) => ({
    date: d.date,
    required: d.result?.metrics.reserve?.value ?? null,
    incomplete: d.result?.metrics.reserve?.status === "incomplete",
    allocated: sumType(inRange, "allocation", (e) => e.entryDate === d.date).toString(),
    purchases: sumType(inRange, "purchase", (e) => e.entryDate === d.date).toString(),
    state: d.state,
  }));

  const items = new Map<string, { label: string; unit: string; qty: Dec; amount: Dec; incomplete: boolean }>();
  for (const d of days) {
    for (const c of d.result?.consumption ?? []) {
      const key = `${c.itemKey}|${c.unit}`;
      const it = items.get(key) ?? { label: c.label, unit: c.unit, qty: ZERO, amount: ZERO, incomplete: false };
      it.qty = it.qty.plus(D(c.qty));
      it.amount = it.amount.plus(D(c.amount));
      it.incomplete ||= c.incomplete;
      items.set(key, it);
    }
  }

  // Cash and bank balances: need an opening balance per account on or before `from`.
  const balances: Record<"cash" | "bank", { value: Dec | null; notes: string[] }> = { cash: { value: null, notes: [] }, bank: { value: null, notes: [] } };
  for (const acc of ["cash", "bank"] as const) {
    const opens = all.filter((e) => e.account === acc && e.type === "opening_balance");
    const lastOpen = opens[opens.length - 1];
    if (!lastOpen) {
      balances[acc].notes.push(`No ${acc} opening balance recorded.`);
      continue;
    }
    // An opening balance is the balance at the start of its date, so that day's movements count after it.
    const after = all.filter((e) => e.account === acc && e.type !== "opening_balance" && e.entryDate >= lastOpen.entryDate);
    let bal = D(lastOpen.amount).plus(sum(after.map(cashEffect)));
    if (acc === "cash") {
      const posCash = await posCashSince(lastOpen.entryDate, to, days);
      bal = bal.plus(posCash);
      balances.cash.notes.push(`Includes POS cash sales from ${lastOpen.entryDate} (opening balance date) to ${to}: AED ${posCash.toFixed(2)}. No drawer count is recorded.`);
    }
    balances[acc].value = bal;
  }
  const liabilities = [...all].reverse().find((e) => e.type === "liabilities_statement") ?? null;
  const cashParts = [balances.cash.value, balances.bank.value];
  const haveBalances = cashParts.every((v) => v !== null);
  const totalBal = haveBalances ? sum(cashParts.map((v) => v ?? ZERO)) : null;
  const availNotes = [...balances.cash.notes, ...balances.bank.notes];
  if (!liabilities) availNotes.push("No outstanding liabilities statement recorded (supplier bills, VAT due, salaries). Record one in the ledger to complete this figure.");
  else availNotes.push(`Liabilities as stated on ${liabilities.entryDate}: AED ${D(liabilities.amount).toFixed(2)}.`);
  if (unfunded.gt(0)) availNotes.push(`Unfunded reserve of AED ${unfunded.toFixed(2)} is also deducted.`);
  const unearmarked = totalBal === null ? null : totalBal.minus(remaining).minus(unfunded.gt(0) ? unfunded : ZERO).minus(liabilities ? D(liabilities.amount) : ZERO);

  const st = (inc: boolean): Status => (inc ? "incomplete" : "calculated");
  const lines: Record<string, FundingLine> = {
    required: { key: "required", label: "Required replenishment reserve", value: noCosting && required.eq(0) ? null : required.toString(), status: noCosting ? "unavailable" : st(reqIncomplete), definition: "Sum of each day's replenishment reserve: the cost to replace all stock consumed (sold, staff, complimentary, wastage, batches), whatever the payment method.", notes: reqIncomplete ? ["Some consumed items have no cost, so the real requirement is higher."] : [] },
    allocated: { key: "allocated", label: "Actually set aside", value: allocated.toString(), status: "confirmed", definition: "Ledger entries of type 'Set aside for replenishment' in the range.", notes: [] },
    purchases: { key: "purchases", label: "Recorded replenishment purchases", value: purchasesFromReserve.toString(), status: "confirmed", definition: "Stock purchases paid from the reserve in the range. Purchases are not deducted again as cost: the consumption reserve already counts what was used.", notes: purchasesAll.gt(purchasesFromReserve) ? [`A further AED ${purchasesAll.minus(purchasesFromReserve).toFixed(2)} of purchases was not paid from the reserve.`] : [] },
    remaining: { key: "remaining", label: "Remaining funded reserve", value: remaining.toString(), status: "calculated", definition: "Everything set aside to date, less purchases paid from the reserve to date.", notes: fundedBefore.eq(0) ? [] : [`Includes AED ${fundedBefore.toFixed(2)} carried in from before ${from}.`] },
    unfunded: { key: "unfunded", label: "Unfunded reserve requirement", value: unfunded.gt(0) ? unfunded.toString() : "0", status: st(reqIncomplete), definition: "Required reserve for the range not yet set aside.", notes: unfunded.lt(0) ? [`AED ${unfunded.neg().toFixed(2)} more than required was set aside.`] : [] },
    cash: { key: "cash", label: "Cash balance (ledger + POS cash)", value: balances.cash.value?.toString() ?? null, status: balances.cash.value === null ? "unavailable" : "estimate", definition: "Latest cash opening balance plus POS cash sales and ledger movements since then.", notes: balances.cash.notes },
    bank: { key: "bank", label: "Bank balance (ledger)", value: balances.bank.value?.toString() ?? null, status: balances.bank.value === null ? "unavailable" : "estimate", definition: "Latest bank opening balance plus recorded settlements, contributions and payments since then. Card sales count only once settled.", notes: balances.bank.notes },
    unearmarked: { key: "unearmarked", label: "Cash not earmarked (after reserve and liabilities)", value: unearmarked?.toString() ?? null, status: unearmarked === null ? "unavailable" : liabilities && !reqIncomplete ? "estimate" : "incomplete", definition: "Cash + bank, less the remaining funded reserve, any unfunded reserve and recorded liabilities. It is not profit and not automatically available to withdraw.", notes: availNotes },
  };
  return {
    from,
    to,
    lines,
    perDay,
    byItem: [...items].map(([k, v]) => ({ itemKey: k.split("|")[0], label: v.label, unit: v.unit, qty: v.qty.toString(), amount: v.amount.toString(), incomplete: v.incomplete })).sort((a, b) => D(b.amount).cmp(D(a.amount))),
    entries: inRange,
  };
}

async function posCashSince(openDate: string, to: string, days: DayView[]): Promise<Dec> {
  const inView = new Map(days.map((d) => [d.date, d]));
  const rows = await db
    .selectDistinct({ d: schema.orders.businessDate })
    .from(schema.orders)
    .where(and(gte(schema.orders.businessDate, openDate), lte(schema.orders.businessDate, to)));
  let value = ZERO;
  for (const r of rows) {
    const d = inView.get(r.d) ?? (await getDay(r.d));
    value = value.plus(D(d.result?.metrics.cashReceived?.value));
  }
  return value;
}
