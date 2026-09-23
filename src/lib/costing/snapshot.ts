import { D, ZERO, sum } from "../money";
import { expandMenu, isIncompleteLine } from "./expand";
import type { CostingIssue, CostingSnapshot } from "./types";
import { compareUnits, normalizeUnit } from "./units";

/** Derives prepared-item unit costs and unit-consistency issues after all references are resolved. */
export function finalizeSnapshot(snap: CostingSnapshot): CostingSnapshot {
  const items = new Map(snap.items.map((i) => [i.key, i]));
  const issues: CostingIssue[] = snap.issues.filter((i) => !i.code.startsWith("unit_") || i.code === "unit_unknown");

  for (const it of snap.items) {
    if (it.kind !== "prepared" || it.prepared?.breakdown !== "available" || !it.prepared.yieldQty) continue;
    const fake = { ...snap, menu: [{ code: "__prep__", name: it.name, category: null, status: null, priceDineIn: null, priceAggregator: null, costMode: "recipe" as const, recipe: it.prepared.inputs, components: [], packaging: [], totalOnlyCost: null, workbook: { foodCost: null, foodFormula: null, costWithPackaging: null, packagingFormula: null }, source: it.source }] };
    const lines = expandMenu(fake, "__prep__", 1, { includePackaging: false, batchCodes: new Set() });
    const total = sum(lines.map((l) => l.amount ?? ZERO));
    const incomplete = lines.some(isIncompleteLine);
    const perUnit = total.div(it.prepared.yieldQty);
    const workbookUnit = it.unitCost;
    it.unitCost = perUnit.toString();
    it.costStatus = incomplete ? "missing" : "ok";
    it.costNote = `${it.prepared.note} Batch cost AED ${total.toFixed(4)} ÷ ${it.prepared.yieldQty}${incomplete ? " (some inputs have no cost)" : ""}.`;
    if (workbookUnit && D(workbookUnit).minus(perUnit).abs().gt(D(workbookUnit).abs().times(0.01))) {
      issues.push({ severity: "warning", code: "subrecipe_cost_diff", message: `${it.name}: workbook cost per unit ${D(workbookUnit).toFixed(6)} differs from its recalculated inputs ${perUnit.toFixed(6)}.`, source: it.source, itemKey: it.key });
    }
  }

  const check = (lines: { rawName: string; unit: string | null; qty: number | null; ref: { type: string; key?: string }; source: string }[], owner: string, menuCode?: string) => {
    for (const l of lines) {
      if (l.ref.type !== "item" || !l.ref.key) continue;
      const it = items.get(l.ref.key);
      if (!it?.baseUnit) continue;
      const lu = normalizeUnit(l.unit);
      if (!lu) {
        issues.push({ severity: "error", code: "unit_unrecognised", message: `${owner}: unit "${l.unit ?? ""}" for ${l.rawName} is not recognised.`, source: l.source, menuCode, itemKey: it.key });
        continue;
      }
      const cmp = compareUnits(lu, it.baseUnit);
      if (cmp.kind === "incompatible") {
        issues.push({ severity: "error", code: "unit_incompatible", message: `${owner}: ${l.rawName} is used in ${lu.raw} but priced per ${it.baseUnit} (${it.purchaseUnitLabel ?? it.baseUnit}); cannot convert.`, source: l.source, menuCode, itemKey: it.key });
      } else if (cmp.kind === "density_assumed") {
        issues.push({ severity: "warning", code: "unit_density", message: `${owner}: ${l.rawName} is used in ${lu.raw} but priced per ${it.baseUnit}; treated as 1 ${lu.base} = 1 ${it.baseUnit}.`, source: l.source, menuCode, itemKey: it.key });
      }
    }
  };
  for (const m of snap.menu) if (m.costMode === "recipe") check(m.recipe, `${m.code} ${m.name}`, m.code);
  for (const it of snap.items) if (it.prepared?.breakdown === "available") check(it.prepared.inputs, it.name);

  return { ...snap, issues };
}

export type CostingOverride =
  | { type: "item_cost"; itemKey: string; unitCost: string; note: string }
  | { type: "item_zero"; itemKey: string; note: string }
  | { type: "menu_packaging"; code: string; packaging: { key: string; qty: number }[]; note: string };

/** Produces a new snapshot with owner corrections applied (the base snapshot is left untouched). */
export function applyOverrides(base: CostingSnapshot, overrides: CostingOverride[]): CostingSnapshot {
  const snap: CostingSnapshot = structuredClone(base);
  for (const o of overrides) {
    if (o.type === "item_cost" || o.type === "item_zero") {
      const it = snap.items.find((i) => i.key === o.itemKey);
      if (!it) continue;
      it.unitCost = o.type === "item_zero" ? "0" : o.unitCost;
      it.costStatus = o.type === "item_zero" ? "confirmed_zero" : "override";
      it.costNote = `${o.type === "item_zero" ? "Confirmed no cost" : `Owner-entered cost ${o.unitCost} per ${it.baseUnit ?? "unit"}`}: ${o.note}`;
      if (it.prepared) it.prepared = { ...it.prepared, breakdown: "unavailable" };
      snap.issues = snap.issues.filter((i) => !(i.itemKey === it.key && /cost|subrecipe|not_in_master/.test(i.code)));
    } else {
      const m = snap.menu.find((x) => x.code === o.code);
      if (!m) continue;
      m.packaging = o.packaging.map((p) => ({ ...p, source: `Owner correction: ${o.note}` }));
      snap.issues = snap.issues.filter((i) => !(i.menuCode === m.code && i.code.startsWith("packaging")));
    }
  }
  return finalizeSnapshot(snap);
}
