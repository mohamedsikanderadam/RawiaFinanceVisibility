import { D, Decimal, ZERO, sum } from "../money";
import type { CostingSnapshot, CostItem, MenuItem, RecipeLine } from "./types";
import { compareUnits, normalizeUnit } from "./units";

export type LineFlag =
  | "cost_missing"
  | "cost_invalid"
  | "bom_only"
  | "computed_cost"
  | "qty_invalid"
  | "unit_incompatible"
  | "unit_unknown"
  | "density_assumed"
  | "allocation_unavailable"
  | "recipe_missing"
  | "packaging_undefined"
  | "karak_batch_cup"
  | "covered_by_batch"
  | "batch_unallocated"
  | "cycle";

export type ConsumptionKind = "ingredient" | "packaging" | "unallocated" | "batch_cup";

export type ConsumptionLine = {
  /** Cost item key, or a synthetic key for unallocated totals (menu:<code>, batch:<code>). */
  itemKey: string;
  label: string;
  kind: ConsumptionKind;
  qty: Decimal;
  unit: string;
  unitCost: Decimal | null;
  /** null = cost unavailable (never treated as zero). */
  amount: Decimal | null;
  flags: LineFlag[];
  path: string[];
  source: string;
};

export type ExpandOptions = {
  includePackaging: boolean;
  /** Menu codes whose per-cup food cost is replaced by the daily batch charge. */
  batchCodes: Set<string>;
};

type Ctx = {
  snap: CostingSnapshot;
  items: Map<string, CostItem>;
  menu: Map<string, MenuItem>;
  opts: ExpandOptions;
};

const contexts = new WeakMap<CostingSnapshot, { items: Map<string, CostItem>; menu: Map<string, MenuItem> }>();

function indexes(snap: CostingSnapshot) {
  let ix = contexts.get(snap);
  if (!ix) {
    ix = { items: new Map(snap.items.map((i) => [i.key, i])), menu: new Map(snap.menu.map((m) => [m.code, m])) };
    contexts.set(snap, ix);
  }
  return ix;
}

export function costItem(snap: CostingSnapshot, key: string): CostItem | undefined {
  return indexes(snap).items.get(key);
}

export function menuItem(snap: CostingSnapshot, code: string): MenuItem | undefined {
  return indexes(snap).menu.get(code);
}

function itemUnitCost(it: CostItem): Decimal | null {
  if (it.costStatus === "invalid") return null;
  return it.unitCost === null ? null : D(it.unitCost);
}

function costFlags(it: CostItem): LineFlag[] {
  if (it.costStatus === "bom_only") return ["bom_only"];
  if (it.costStatus === "computed") return ["computed_cost"];
  if (it.costStatus === "invalid") return ["cost_invalid"];
  if (it.unitCost === null) return ["cost_missing"];
  return [];
}

function expandLine(ctx: Ctx, line: RecipeLine, mult: Decimal, path: string[], out: ConsumptionLine[], depth: number) {
  if (depth > 8) {
    out.push({ itemKey: `unresolved:${line.rawName}`, label: line.rawName, kind: "ingredient", qty: ZERO, unit: "", unitCost: null, amount: null, flags: ["cycle"], path, source: line.source });
    return;
  }
  if (line.ref.type === "menu") {
    if (line.qty === null) {
      out.push({ itemKey: `menu:${line.ref.code}`, label: line.rawName, kind: "unallocated", qty: ZERO, unit: "serving", unitCost: null, amount: null, flags: ["qty_invalid"], path, source: line.source });
      return;
    }
    expandFood(ctx, line.ref.code, mult.times(line.qty), path, out, depth + 1);
    return;
  }
  if (line.ref.type === "unresolved") {
    out.push({ itemKey: `unresolved:${line.rawName}`, label: line.rawName, kind: "ingredient", qty: ZERO, unit: line.unit ?? "", unitCost: null, amount: null, flags: ["cost_missing"], path, source: line.source });
    return;
  }
  const it = ctx.items.get(line.ref.key);
  if (!it) return;
  const unitLabel = it.baseUnit ?? line.unit ?? "";
  if (line.qty === null) {
    out.push({ itemKey: it.key, label: it.name, kind: it.kind === "packaging" ? "packaging" : "ingredient", qty: ZERO, unit: unitLabel, unitCost: itemUnitCost(it), amount: null, flags: ["qty_invalid"], path, source: line.source });
    return;
  }
  const lu = normalizeUnit(line.unit);
  const flags: LineFlag[] = [];
  let qtyBase: Decimal | null = null;
  if (!lu || !it.baseUnit) {
    if (!lu && !it.baseUnit) qtyBase = D(line.qty);
    else flags.push("unit_unknown");
  } else {
    const cmp = compareUnits(lu, it.baseUnit);
    if (cmp.kind === "incompatible") flags.push("unit_incompatible");
    else {
      if (cmp.kind === "density_assumed") flags.push("density_assumed");
      qtyBase = D(line.qty).times(cmp.factor);
    }
  }
  if (qtyBase === null) {
    out.push({ itemKey: it.key, label: it.name, kind: "ingredient", qty: ZERO, unit: unitLabel, unitCost: itemUnitCost(it), amount: null, flags, path, source: line.source });
    return;
  }
  const total = qtyBase.times(mult);

  if (it.kind === "prepared" && it.prepared?.breakdown === "available" && it.prepared.yieldQty) {
    const scale = total.div(it.prepared.yieldQty);
    for (const inp of it.prepared.inputs) expandLine(ctx, inp, scale, [...path, it.name], out, depth + 1);
    return;
  }
  const uc = itemUnitCost(it);
  const extra: LineFlag[] = it.kind === "prepared" ? ["allocation_unavailable"] : [];
  out.push({
    itemKey: it.key,
    label: it.name,
    kind: it.kind === "packaging" ? "packaging" : "ingredient",
    qty: total,
    unit: unitLabel,
    unitCost: uc,
    amount: uc === null ? null : total.times(uc),
    flags: [...flags, ...costFlags(it), ...extra],
    path,
    source: line.source,
  });
}

function expandFood(ctx: Ctx, code: string, qty: Decimal, path: string[], out: ConsumptionLine[], depth: number) {
  const m = ctx.menu.get(code);
  const p = [...path, m ? `${m.code} ${m.name}` : code];
  if (!m) {
    out.push({ itemKey: `menu:${code}`, label: code, kind: "unallocated", qty, unit: "serving", unitCost: null, amount: null, flags: ["recipe_missing"], path: p, source: "" });
    return;
  }
  if (ctx.opts.batchCodes.has(m.code)) {
    out.push({ itemKey: `batchcup:${m.code}`, label: `${m.name} (cup from daily batch)`, kind: "batch_cup", qty, unit: "cup", unitCost: ZERO, amount: ZERO, flags: ["karak_batch_cup"], path: p, source: m.source });
    return;
  }
  switch (m.costMode) {
    case "recipe":
      for (const l of m.recipe) expandLine(ctx, l, qty, p, out, depth + 1);
      return;
    case "combo":
      for (const c of m.components) expandFood(ctx, c.code, qty.times(c.qty), p, out, depth + 1);
      return;
    case "total_only": {
      const uc = D(m.totalOnlyCost ?? 0);
      out.push({ itemKey: `menu:${m.code}`, label: `${m.name} (total cost only)`, kind: "unallocated", qty, unit: "serving", unitCost: uc, amount: qty.times(uc), flags: ["allocation_unavailable"], path: p, source: m.source });
      return;
    }
    default:
      out.push({ itemKey: `menu:${m.code}`, label: `${m.name} (no recipe)`, kind: "unallocated", qty, unit: "serving", unitCost: null, amount: null, flags: ["recipe_missing"], path: p, source: m.source });
  }
}

function expandPackaging(ctx: Ctx, m: MenuItem, qty: Decimal, path: string[], out: ConsumptionLine[]) {
  const p = [...path, `${m.code} ${m.name}`];
  if (m.packaging === null) {
    out.push({ itemKey: `pkgundef:${m.code}`, label: `Packaging not defined – ${m.name}`, kind: "packaging", qty, unit: "serving", unitCost: null, amount: null, flags: ["packaging_undefined"], path: p, source: m.source });
    return;
  }
  for (const pl of m.packaging) {
    const it = ctx.items.get(pl.key);
    if (!it) continue;
    const q = qty.times(pl.qty);
    const uc = itemUnitCost(it);
    out.push({ itemKey: it.key, label: it.name, kind: "packaging", qty: q, unit: "pcs", unitCost: uc, amount: uc === null ? null : q.times(uc), flags: costFlags(it), path: p, source: pl.source });
  }
}

/**
 * Expands `qty` servings of a menu item into ingredient and packaging consumption.
 * Combos expand into their components' food only; packaging comes from the item actually sold,
 * so neither components nor sub-recipes are counted twice.
 */
export function expandMenu(snap: CostingSnapshot, code: string, qty: Decimal.Value, opts: ExpandOptions): ConsumptionLine[] {
  const ix = indexes(snap);
  const ctx: Ctx = { snap, items: ix.items, menu: ix.menu, opts };
  const out: ConsumptionLine[] = [];
  const q = D(qty);
  expandFood(ctx, code, q, [], out, 0);
  const m = ix.menu.get(code);
  if (m && opts.includePackaging) expandPackaging(ctx, m, q, [], out);
  return out;
}

/**
 * Daily prepared batch charged at a fixed price. Known recipe ingredients are allocated;
 * any difference to the fixed price is an unallocated batch reserve.
 */
export function expandBatch(snap: CostingSnapshot, code: string, batches: Decimal.Value, batchPrice: Decimal.Value): ConsumptionLine[] {
  const ix = indexes(snap);
  const m = ix.menu.get(code);
  const n = D(batches);
  const price = D(batchPrice);
  const total = n.times(price);
  const label = m ? m.name : code;
  if (n.lte(0)) return [];
  const ctx: Ctx = { snap, items: ix.items, menu: ix.menu, opts: { includePackaging: false, batchCodes: new Set() } };
  const lines: ConsumptionLine[] = [];
  if (m) for (const l of m.recipe) expandLine(ctx, l, n, [`${m.code} ${m.name} – daily batch`], lines, 0);
  const allocated = sum(lines.map((l) => l.amount ?? ZERO));
  if (lines.length === 0 || allocated.lte(0)) {
    return [{ itemKey: `batch:${code}`, label: `${label} batch – unallocated reserve`, kind: "unallocated", qty: n, unit: "batch", unitCost: price, amount: total, flags: ["batch_unallocated"], path: [`${code} ${label} – daily batch`], source: m?.source ?? "" }];
  }
  let scaled = lines;
  if (allocated.gt(total)) {
    const f = total.div(allocated);
    scaled = lines.map((l) => ({ ...l, unitCost: l.unitCost?.times(f) ?? null, amount: l.amount?.times(f) ?? null }));
  }
  for (const l of scaled) {
    if (l.amount === null) l.flags = [...l.flags, "covered_by_batch"];
  }
  const remainder = total.minus(sum(scaled.map((l) => l.amount ?? ZERO)));
  if (remainder.gt(0)) {
    scaled.push({ itemKey: `batch:${code}`, label: `${label} batch – unallocated reserve`, kind: "unallocated", qty: n, unit: "batch", unitCost: remainder.div(n), amount: remainder, flags: ["batch_unallocated"], path: [`${code} ${label} – daily batch`], source: m?.source ?? "" });
  }
  return scaled;
}

/** A line makes its total incomplete when its cost is unavailable and not covered by a fixed batch price. */
export function isIncompleteLine(l: ConsumptionLine): boolean {
  return l.amount === null && !l.flags.includes("covered_by_batch");
}

export type MenuReconciliation = {
  code: string;
  name: string;
  costMode: MenuItem["costMode"];
  appFood: Decimal;
  appPackaging: Decimal;
  incomplete: boolean;
  missing: string[];
  flags: LineFlag[];
  workbookFood: number | null;
  workbookWithPackaging: number | null;
  foodDiff: Decimal | null;
  packagingDiff: Decimal | null;
};

/** Per-serving app cost vs the workbook's Menu Master cached cost. */
export function reconcileMenu(snap: CostingSnapshot, batchCodes: Set<string> = new Set()): MenuReconciliation[] {
  return snap.menu.map((m) => {
    const lines = expandMenu(snap, m.code, 1, { includePackaging: true, batchCodes });
    const food = lines.filter((l) => l.kind !== "packaging");
    const pkg = lines.filter((l) => l.kind === "packaging");
    const appFood = sum(food.map((l) => l.amount ?? ZERO));
    const appPackaging = sum(pkg.map((l) => l.amount ?? ZERO));
    const missing = [...new Set(lines.filter(isIncompleteLine).map((l) => l.label))];
    const wbFood = m.workbook.foodCost;
    const wbPkg = m.workbook.costWithPackaging !== null && wbFood !== null ? m.workbook.costWithPackaging - wbFood : null;
    return {
      code: m.code,
      name: m.name,
      costMode: m.costMode,
      appFood,
      appPackaging,
      incomplete: missing.length > 0,
      missing,
      flags: [...new Set(lines.flatMap((l) => l.flags))],
      workbookFood: wbFood,
      workbookWithPackaging: m.workbook.costWithPackaging,
      foodDiff: wbFood === null ? null : appFood.minus(wbFood),
      packagingDiff: wbPkg === null ? null : appPackaging.minus(wbPkg),
    };
  });
}
