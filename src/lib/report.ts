import type { Settings } from "./settings";

export type MetricGroup = { title: string; keys: (string | [string, "indent" | "strong"])[] };

/** Metric layout shared by the day page, reports, PDF and Excel so every view lists the same figures. */
export const METRIC_GROUPS: MetricGroup[] = [
  {
    title: "Sales",
    keys: ["grossSales", ["staffMealValue", "indent"], ["complimentaryValue", "indent"], "discounts", "refunds", ["netSalesInclVat", "strong"], "vat", ["netSales", "strong"]],
  },
  { title: "Cost of sales", keys: ["ingredientCost", "packagingCost", "cogsSold", "batchCost", ["grossProfit", "strong"]] },
  {
    title: "Other consumption and expenses",
    keys: ["staffConsumption", "complimentaryConsumption", "wastage", "manualCost", "channelCommissions", "paymentFees", "fixedCosts", ["operatingResult", "strong"]],
  },
  { title: "Replenishment", keys: [["reserve", "strong"]] },
  { title: "Money received (sales ≠ settlements)", keys: ["cashReceived", "cardSales", "aggregatorSales", "splitPayments", "unknownPayments"] },
];

export function groupKeys(g: MetricGroup): { key: string; mod?: "indent" | "strong" }[] {
  return g.keys.map((k) => (Array.isArray(k) ? { key: k[0], mod: k[1] } : { key: k }));
}

const PREP: Record<Settings["refundDefault"], string> = { prepared: "prepared (stock consumed)", not_prepared: "not prepared (no consumption)", recovered: "stock recovered" };

/** Plain-language list of the business rules and settings behind a report. */
export function assumptionsFor(s: Settings): string[] {
  const fees = Object.entries(s.channelFees).map(([k, r]) => `${k} ${r.ratePct === null ? "not set" : `${r.ratePct}%`}${r.confirmed ? "" : " (unconfirmed)"}`);
  const fixed = s.fixedExpenses.filter((f) => f.include);
  const excluded = s.fixedExpenses.filter((f) => !f.include).map((f) => f.name);
  const noPkg = Object.entries(s.packaging)
    .filter(([, v]) => v === "none")
    .map(([k]) => k);
  return [
    "Currency AED; business dates in Asia/Dubai time.",
    "Consumption = quantity served × recipe quantity per serving; reserve = consumption × recipe-unit cost from the costing version shown.",
    "Staff meals and complimentary items consume stock at zero revenue. Discounts reduce revenue only.",
    `Refunded orders default to ${PREP[s.refundDefault]}; voided orders default to ${PREP[s.voidDefault]}, unless recorded otherwise per order.`,
    `Cane Karak: AED ${s.karak.batchPrice} per prepared batch (default ${s.karak.defaultBatchesPerDay} per day with Karak sales), no per-cup recipe cost; per-cup packaging charged${s.karak.allocateRecipe ? "; batch cost allocated to the BOM batch recipe where available" : ""}.`,
    `Packaging from the workbook recipe${noPkg.length ? `, except none for: ${noPkg.join(", ")}` : " on every channel"}.`,
    `VAT ${s.vat.ratePct}%${s.vat.pricesIncludeVat ? ", included in POS prices" : ""}${s.vat.confirmed ? "" : " (unconfirmed)"}; taken from the POS VAT column.`,
    `Channel commissions: ${fees.length ? fees.join(", ") : "none configured"}. Card fees: ${s.paymentFees.card.ratePct === null ? "not set (shown as unavailable)" : `${s.paymentFees.card.ratePct}%`}.`,
    `Fixed costs spread evenly over the calendar days of the month: ${fixed.map((f) => f.name).join(", ") || "none"}${excluded.length ? `; excluded: ${excluded.join(", ")}` : ""}.`,
    "Missing costs are never treated as zero; affected totals are labelled incomplete.",
    "Card and aggregator sales are receivables until settlement is recorded; blank payment methods are not treated as cash.",
    "The replenishment reserve is money needed to replace what was consumed. It is not a purchase order or an inventory balance.",
    "Estimated operating result is a profit estimate, not cash available to withdraw.",
  ];
}

export const REPORTS = [
  { kind: "summary", title: "Financial summary", body: "Every controller figure with its definition and formula, the revenue-to-operating-result bridge, channels, payments and daily totals." },
  { kind: "replenishment", title: "Ingredient replenishment", body: "Quantity and reserve by ingredient and packaging item, split by sold items, staff meals, complimentary, wastage and batches." },
  { kind: "menu", title: "Menu-item margins", body: "Units, revenue, cost and margin per menu item, reconciled against the workbook Menu Master cost." },
  { kind: "nonsales", title: "Staff meals, complimentary and wastage", body: "Every zero-revenue consumption record with its source order or adjustment." },
  { kind: "issues", title: "Unresolved issues", body: "Unmatched items, missing costs, default preparation decisions and workbook issues affecting the period." },
] as const;

export type ReportKind = (typeof REPORTS)[number]["kind"];
