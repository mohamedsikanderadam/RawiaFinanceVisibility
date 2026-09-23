export type Dimension = "mass" | "volume" | "count" | "can" | "cup";
export type BaseUnit = "g" | "ml" | "pcs" | "can" | "cup";

export type NormalizedUnit = { base: BaseUnit; factor: number; dimension: Dimension; raw: string };

const TABLE: Record<string, { base: BaseUnit; factor: number }> = {
  g: { base: "g", factor: 1 },
  gm: { base: "g", factor: 1 },
  gms: { base: "g", factor: 1 },
  gram: { base: "g", factor: 1 },
  grams: { base: "g", factor: 1 },
  kg: { base: "g", factor: 1000 },
  kgs: { base: "g", factor: 1000 },
  kilogram: { base: "g", factor: 1000 },
  ml: { base: "ml", factor: 1 },
  l: { base: "ml", factor: 1000 },
  lt: { base: "ml", factor: 1000 },
  ltr: { base: "ml", factor: 1000 },
  ltrs: { base: "ml", factor: 1000 },
  litre: { base: "ml", factor: 1000 },
  liter: { base: "ml", factor: 1000 },
  litres: { base: "ml", factor: 1000 },
  pcs: { base: "pcs", factor: 1 },
  pc: { base: "pcs", factor: 1 },
  piece: { base: "pcs", factor: 1 },
  pieces: { base: "pcs", factor: 1 },
  peice: { base: "pcs", factor: 1 },
  slice: { base: "pcs", factor: 1 },
  slices: { base: "pcs", factor: 1 },
  bar: { base: "pcs", factor: 1 },
  unit: { base: "pcs", factor: 1 },
  can: { base: "can", factor: 1 },
  cans: { base: "can", factor: 1 },
  cup: { base: "cup", factor: 1 },
  cups: { base: "cup", factor: 1 },
};

const DIM: Record<BaseUnit, Dimension> = { g: "mass", ml: "volume", pcs: "count", can: "can", cup: "cup" };

/** Normalizes workbook unit labels such as "grams", "pcs(1 box)", "Ltr" or "peice". */
export function normalizeUnit(raw: string | null | undefined): NormalizedUnit | null {
  if (!raw) return null;
  const cleaned = String(raw).toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z]/g, "");
  const hit = TABLE[cleaned];
  if (!hit) return null;
  return { ...hit, dimension: DIM[hit.base], raw: String(raw) };
}

export type UnitCompatibility =
  | { kind: "same"; factor: number }
  | { kind: "density_assumed"; factor: number }
  | { kind: "incompatible" };

/**
 * How a recipe quantity in `recipeUnit` converts into the purchase item's base unit.
 * g↔ml is treated 1:1 only as a flagged estimate (the workbook does this implicitly).
 */
export function compareUnits(recipeUnit: NormalizedUnit, itemBase: BaseUnit): UnitCompatibility {
  if (recipeUnit.base === itemBase) return { kind: "same", factor: recipeUnit.factor };
  const pair = new Set([recipeUnit.base, itemBase]);
  if (pair.has("g") && pair.has("ml") && pair.size === 2) return { kind: "density_assumed", factor: recipeUnit.factor };
  return { kind: "incompatible" };
}
