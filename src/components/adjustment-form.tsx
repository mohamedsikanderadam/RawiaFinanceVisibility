"use client";

import { useState } from "react";
import { addAdjustmentAction } from "@/app/actions";
import { ActionForm, Submit } from "./action-form";

type Opt = { code: string; name: string };
type ItemOpt = { key: string; name: string; unit: string };

const TYPES = [
  { v: "staff_meal", l: "Missed staff meal" },
  { v: "complimentary", l: "Complimentary item" },
  { v: "wastage", l: "Wastage" },
  { v: "manual_cost", l: "Manual reserve amount" },
] as const;

export function AdjustmentForm({ date, mode, menu = [], items = [] }: { date: string; mode: "batch" | "item"; menu?: Opt[]; items?: ItemOpt[] }) {
  const [type, setType] = useState<string>("staff_meal");
  if (mode === "batch") {
    return (
      <ActionForm action={addAdjustmentAction} className="mt-3 flex flex-wrap items-end gap-2">
        <input type="hidden" name="date" value={date} />
        <input type="hidden" name="type" value="batch_count" />
        <label>
          <span className="label">Batches prepared</span>
          <input name="qty" type="number" min={0} step={1} defaultValue={1} className="input w-24" />
        </label>
        <label className="flex-1">
          <span className="label">Note</span>
          <input name="note" className="input" placeholder="0 = not prepared today" />
        </label>
        <Submit className="btn btn-olive">Set batches</Submit>
      </ActionForm>
    );
  }
  const manual = type === "manual_cost";
  return (
    <ActionForm action={addAdjustmentAction} className="grid gap-2 md:grid-cols-6 md:items-end">
      <input type="hidden" name="date" value={date} />
      <label className="md:col-span-1">
        <span className="label">Type</span>
        <select name="type" className="input" value={type} onChange={(e) => setType(e.target.value)}>
          {TYPES.map((t) => (
            <option key={t.v} value={t.v}>
              {t.l}
            </option>
          ))}
        </select>
      </label>
      <label className="md:col-span-2">
        <span className="label">{manual ? "Ingredient (optional)" : "Menu item or ingredient"}</span>
        <select name="target" className="input" defaultValue="">
          <option value="">{manual ? "— General —" : "Choose…"}</option>
          {!manual && (
            <optgroup label="Menu items (full recipe + packaging)">
              {menu.map((m) => (
                <option key={m.code} value={`menu:${m.code}`}>
                  {m.name} ({m.code})
                </option>
              ))}
            </optgroup>
          )}
          <optgroup label="Single ingredient / packaging">
            {items.map((i) => (
              <option key={i.key} value={`item:${i.key}`}>
                {i.name}
                {i.unit ? ` (per ${i.unit})` : ""}
              </option>
            ))}
          </optgroup>
        </select>
      </label>
      {manual ? (
        <label>
          <span className="label">Amount AED (− to reduce)</span>
          <input name="amount" inputMode="decimal" className="input" required />
        </label>
      ) : (
        <label>
          <span className="label">Quantity</span>
          <input name="qty" inputMode="decimal" className="input" defaultValue="1" required />
        </label>
      )}
      <label>
        <span className="label">Note{manual ? " (required)" : ""}</span>
        <input name="note" className="input" required={manual} />
      </label>
      <Submit>Add</Submit>
    </ActionForm>
  );
}
