"use client";

import { useState } from "react";
import { saveSettingsAction } from "@/app/actions";
import { CHANNELS, PREP_STATES, type RateSetting, type Settings } from "@/lib/settings";
import { ActionForm, Submit } from "./action-form";

const PREP_LABEL: Record<(typeof PREP_STATES)[number], string> = {
  prepared: "Prepared – stock consumed",
  not_prepared: "Not prepared – no consumption",
  recovered: "Prepared but stock recovered",
};

function num(v: string): number | null {
  if (v.trim() === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function RateRow({ label, value, onChange }: { label: string; value: RateSetting; onChange: (r: RateSetting) => void }) {
  return (
    <tr>
      <td className="font-medium">{label}</td>
      <td>
        <input className="input w-24 py-1" inputMode="decimal" aria-label={`${label} rate %`} value={value.ratePct ?? ""} placeholder="not set" onChange={(e) => onChange({ ...value, ratePct: num(e.target.value) })} />
      </td>
      <td>
        <select className="input py-1 text-xs" aria-label={`${label} basis`} value={value.basis} onChange={(e) => onChange({ ...value, basis: e.target.value as RateSetting["basis"] })}>
          <option value="sales_after_discount_incl_vat">Sales after discount incl. VAT</option>
          <option value="subtotal_ex_vat">Subtotal excl. VAT</option>
        </select>
      </td>
      <td>
        <input type="checkbox" aria-label={`${label} confirmed`} checked={value.confirmed} onChange={(e) => onChange({ ...value, confirmed: e.target.checked })} />
      </td>
      <td>
        <input className="input py-1 text-xs" aria-label={`${label} note`} value={value.note} onChange={(e) => onChange({ ...value, note: e.target.value })} />
      </td>
    </tr>
  );
}

export function SettingsEditor({ initial, today, karakOptions }: { initial: Settings; today: string; karakOptions: { code: string; name: string }[] }) {
  const [s, setS] = useState<Settings>(initial);
  const [newApp, setNewApp] = useState("");
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS((p) => ({ ...p, [k]: v }));

  return (
    <ActionForm action={saveSettingsAction} className="space-y-4">
      <input type="hidden" name="settings" value={JSON.stringify(s)} />

      <section className="card p-4">
        <h2 className="mb-2 font-bold text-brown">VAT</h2>
        <div className="flex flex-wrap items-center gap-4 text-sm">
          <label>
            Rate %{" "}
            <input className="input ml-1 inline w-20 py-1" inputMode="decimal" value={s.vat.ratePct} onChange={(e) => set("vat", { ...s.vat, ratePct: num(e.target.value) ?? 0 })} />
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={s.vat.pricesIncludeVat} onChange={(e) => set("vat", { ...s.vat, pricesIncludeVat: e.target.checked })} /> POS prices include VAT
          </label>
          <label className="flex items-center gap-1">
            <input type="checkbox" checked={s.vat.confirmed} onChange={(e) => set("vat", { ...s.vat, confirmed: e.target.checked })} /> Confirmed with accountant
          </label>
        </div>
        <p className="mt-1 text-xs text-ink-soft">Net sales use the VAT amount in the POS export. Unconfirmed VAT settings mark VAT figures as estimates.</p>
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-bold text-brown">Channel commissions and payment fees</h2>
        <div className="overflow-x-auto">
          <table className="data">
            <thead>
              <tr>
                <th>Channel</th>
                <th>Rate %</th>
                <th>Applied to</th>
                <th>Confirmed</th>
                <th>Note</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(s.channelFees).map(([k, r]) => (
                <RateRow key={k} label={k} value={r} onChange={(nr) => set("channelFees", { ...s.channelFees, [k]: nr })} />
              ))}
              <RateRow label="Card payments" value={s.paymentFees.card} onChange={(nr) => set("paymentFees", { ...s.paymentFees, card: nr })} />
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex items-center gap-2 text-sm">
          <input className="input w-40 py-1" placeholder="New delivery app" value={newApp} onChange={(e) => setNewApp(e.target.value)} />
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => {
              const k = newApp.trim().toLowerCase();
              if (k && !s.channelFees[k]) set("channelFees", { ...s.channelFees, [k]: { ratePct: null, basis: "sales_after_discount_incl_vat", confirmed: false, note: "" } });
              setNewApp("");
            }}
          >
            Add app
          </button>
        </div>
        <p className="mt-1 text-xs text-ink-soft">Blank rate = not available; the fee is shown as missing, never as zero. Delivery app names must match the POS &quot;Delivery app&quot; column.</p>
      </section>

      <section className="card p-4">
        <h2 className="mb-2 font-bold text-brown">Fixed operating expenses (monthly, spread over calendar days)</h2>
        <table className="data">
          <thead>
            <tr>
              <th>Include</th>
              <th>Expense</th>
              <th>Monthly AED</th>
              <th>Note</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {s.fixedExpenses.map((f, i) => {
              const upd = (nf: Partial<typeof f>) => set("fixedExpenses", s.fixedExpenses.map((x, j) => (j === i ? { ...x, ...nf } : x)));
              return (
                <tr key={i}>
                  <td>
                    <input type="checkbox" aria-label={`Include ${f.name}`} checked={f.include} onChange={(e) => upd({ include: e.target.checked })} />
                  </td>
                  <td>
                    <input className="input py-1" value={f.name} aria-label="Expense name" onChange={(e) => upd({ name: e.target.value })} />
                  </td>
                  <td>
                    <input className="input w-28 py-1" inputMode="decimal" aria-label={`${f.name} monthly`} value={f.monthly ?? ""} placeholder="missing" onChange={(e) => upd({ monthly: num(e.target.value) })} />
                  </td>
                  <td>
                    <input className="input py-1 text-xs" aria-label={`${f.name} note`} value={f.note} onChange={(e) => upd({ note: e.target.value })} />
                  </td>
                  <td>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => set("fixedExpenses", s.fixedExpenses.filter((_, j) => j !== i))}>
                      Remove
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <button type="button" className="btn btn-ghost btn-sm mt-2" onClick={() => set("fixedExpenses", [...s.fixedExpenses, { name: "New expense", monthly: null, include: true, note: "" }])}>
          Add expense
        </button>
      </section>

      <section className="card grid gap-3 p-4 md:grid-cols-2">
        <div>
          <h2 className="mb-2 font-bold text-brown">Karak daily batch</h2>
          <div className="space-y-2 text-sm">
            <label className="block">
              <span className="label">Menu item</span>
              <select className="input" value={s.karak.menuCode} onChange={(e) => set("karak", { ...s.karak, menuCode: e.target.value })}>
                {karakOptions.map((m) => (
                  <option key={m.code} value={m.code}>
                    {m.name} ({m.code})
                  </option>
                ))}
              </select>
            </label>
            <label className="block">
              <span className="label">Cost per prepared batch (AED)</span>
              <input className="input" inputMode="decimal" value={s.karak.batchPrice} onChange={(e) => set("karak", { ...s.karak, batchPrice: num(e.target.value) ?? 0 })} />
            </label>
            <label className="block">
              <span className="label">Default batches per day with Karak sales</span>
              <input className="input" inputMode="numeric" value={s.karak.defaultBatchesPerDay} onChange={(e) => set("karak", { ...s.karak, defaultBatchesPerDay: Math.max(0, Math.trunc(num(e.target.value) ?? 0)) })} />
            </label>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={s.karak.allocateRecipe} onChange={(e) => set("karak", { ...s.karak, allocateRecipe: e.target.checked })} /> Allocate batch cost to the BOM batch recipe ingredients
            </label>
          </div>
        </div>
        <div>
          <h2 className="mb-2 font-bold text-brown">Packaging by channel</h2>
          <table className="data">
            <tbody>
              {CHANNELS.map((c) => (
                <tr key={c}>
                  <td>{c.replace("_", " ")}</td>
                  <td>
                    <select className="input py-1 text-xs" aria-label={`Packaging for ${c}`} value={s.packaging[c] ?? "workbook"} onChange={(e) => set("packaging", { ...s.packaging, [c]: e.target.value as "workbook" | "none" })}>
                      <option value="workbook">Workbook packaging</option>
                      <option value="none">No packaging</option>
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <h2 className="mb-2 mt-4 font-bold text-brown">Default preparation status</h2>
          <label className="block text-sm">
            <span className="label">Refunded orders</span>
            <select className="input" value={s.refundDefault} onChange={(e) => set("refundDefault", e.target.value as Settings["refundDefault"])}>
              {PREP_STATES.map((p) => (
                <option key={p} value={p}>
                  {PREP_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
          <label className="mt-2 block text-sm">
            <span className="label">Voided / cancelled orders</span>
            <select className="input" value={s.voidDefault} onChange={(e) => set("voidDefault", e.target.value as Settings["voidDefault"])}>
              {PREP_STATES.map((p) => (
                <option key={p} value={p}>
                  {PREP_LABEL[p]}
                </option>
              ))}
            </select>
          </label>
        </div>
      </section>

      <section className="card flex flex-wrap items-end gap-3 p-4">
        <label>
          <span className="label">Effective from</span>
          <input type="date" name="effectiveFrom" defaultValue={today} className="input" required />
        </label>
        <label className="flex-1">
          <span className="label">Reason for change</span>
          <input name="note" className="input" placeholder="e.g. Talabat contract rate confirmed" />
        </label>
        <Submit>Save new settings version</Submit>
      </section>
    </ActionForm>
  );
}
