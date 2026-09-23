import type { BaseUnit } from "./units";

export type Severity = "error" | "warning" | "info";

export type CostingIssue = {
  severity: Severity;
  code: string;
  message: string;
  source?: string;
  menuCode?: string;
  itemKey?: string;
};

/**
 * ok            – unit cost = purchase price ÷ usable quantity, as the workbook computes it
 * computed      – workbook cell was blank, derived from its own price ÷ quantity columns
 * bom_only      – ingredient not costed in Ingredient Master; unit cost taken from BOM "Cost per unit"
 * missing       – no usable cost anywhere in the workbook
 * invalid       – the workbook value exists but is demonstrably wrong (e.g. formula points at another recipe)
 * confirmed_zero – owner confirmed the item has no cost (e.g. tap water)
 * override      – owner entered a cost in a derived costing version
 */
export type CostStatus = "ok" | "computed" | "bom_only" | "missing" | "invalid" | "confirmed_zero" | "override";

export type RecipeRef =
  | { type: "item"; key: string }
  | { type: "menu"; code: string }
  | { type: "unresolved"; name: string };

export type RecipeLine = {
  ref: RecipeRef;
  rawName: string;
  qty: number | null;
  unit: string | null;
  /** "Cost per unit (linked)" as typed in the BOM — used only for reconciliation / BOM-only fallback. */
  bomUnitCost: number | null;
  source: string;
  matchNote?: string;
};

export type PreparedInfo = {
  /** Usable output quantity (in the item's base unit) that the inputs produce. */
  yieldQty: number | null;
  inputs: RecipeLine[];
  breakdown: "available" | "unavailable";
  note: string;
};

export type CostItem = {
  key: string;
  kind: "ingredient" | "packaging" | "prepared";
  name: string;
  sku: string | null;
  supplier: string | null;
  purchasePrice: number | null;
  purchaseQty: number | null;
  purchaseUnitLabel: string | null;
  baseUnit: BaseUnit | null;
  /** AED per base unit, full-precision decimal string. null = unavailable. */
  unitCost: string | null;
  /** Packaging only: unit price before VAT as listed in the workbook. */
  unitCostExVat?: string | null;
  costStatus: CostStatus;
  costNote: string;
  source: string;
  prepared?: PreparedInfo;
};

export type PackagingLine = { key: string; qty: number; source: string };

export type CostMode = "recipe" | "combo" | "total_only" | "no_recipe";

export type MenuItem = {
  code: string;
  name: string;
  category: string | null;
  status: string | null;
  priceDineIn: number | null;
  priceAggregator: number | null;
  costMode: CostMode;
  recipe: RecipeLine[];
  components: { code: string; qty: number }[];
  /** null = the workbook does not define packaging for this item. */
  packaging: PackagingLine[] | null;
  totalOnlyCost: number | null;
  workbook: {
    foodCost: number | null;
    foodFormula: string | null;
    costWithPackaging: number | null;
    packagingFormula: string | null;
  };
  source: string;
};

export type FixedExpense = { name: string; monthly: number | null; formula: string | null; source: string };

export type AggregatorRate = { channel: string; ratePct: number; formula: string; source: string };

export type SheetInfo = { name: string; state: string; rows: number; cols: number; role: string | null };

export type CostingSnapshot = {
  schemaVersion: 1;
  sourceFile: string;
  sourceSha256: string;
  parsedAt: string;
  sheets: SheetInfo[];
  items: CostItem[];
  menu: MenuItem[];
  fixedExpenses: FixedExpense[];
  aggregatorRates: AggregatorRate[];
  orphanRecipes: { name: string; lines: RecipeLine[]; source: string }[];
  issues: CostingIssue[];
};
