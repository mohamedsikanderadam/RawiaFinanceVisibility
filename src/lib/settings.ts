import { z } from "zod";
import type { CostingSnapshot } from "./costing/types";

export const PREP_STATES = ["prepared", "not_prepared", "recovered"] as const;
export type PrepState = (typeof PREP_STATES)[number];

export const CHANNELS = ["indoor", "takeaway", "car", "online", "delivery", "staff_meal", "other"] as const;
export type Channel = (typeof CHANNELS)[number];

const rate = z.object({
  ratePct: z.number().min(0).max(100).nullable(),
  basis: z.enum(["sales_after_discount_incl_vat", "subtotal_ex_vat"]).default("sales_after_discount_incl_vat"),
  confirmed: z.boolean().default(false),
  note: z.string().default(""),
});

export const settingsSchema = z.object({
  vat: z.object({
    ratePct: z.number().min(0).max(100),
    pricesIncludeVat: z.boolean(),
    confirmed: z.boolean(),
  }),
  channelFees: z.record(z.string(), rate),
  paymentFees: z.object({ card: rate }),
  fixedExpenses: z.array(
    z.object({ name: z.string(), monthly: z.number().nullable(), include: z.boolean(), note: z.string().default("") }),
  ),
  karak: z.object({
    menuCode: z.string(),
    batchPrice: z.number().min(0),
    defaultBatchesPerDay: z.number().int().min(0),
    allocateRecipe: z.boolean(),
  }),
  packaging: z.record(z.string(), z.enum(["workbook", "none"])),
  refundDefault: z.enum(PREP_STATES),
  voidDefault: z.enum(PREP_STATES),
});

export type Settings = z.infer<typeof settingsSchema>;
export type RateSetting = z.infer<typeof rate>;

/** Defaults derived from the costing workbook; everything not stated in the workbook starts unconfirmed or unavailable. */
export function defaultSettings(snap: CostingSnapshot | null): Settings {
  const channelFees: Settings["channelFees"] = {};
  for (const r of snap?.aggregatorRates ?? []) {
    channelFees[r.channel.toLowerCase()] = {
      ratePct: r.ratePct,
      basis: "sales_after_discount_incl_vat",
      confirmed: false,
      note: `From workbook ${r.source} (=${r.formula}).`,
    };
  }
  const karak = snap?.menu.find((m) => /karak/i.test(m.name) && !/\+/.test(m.name));
  const recipeDuplicates = /^(cane sauce|original sauce)$/i;
  return {
    vat: { ratePct: 5, pricesIncludeVat: true, confirmed: false },
    channelFees,
    paymentFees: { card: { ratePct: null, basis: "sales_after_discount_incl_vat", confirmed: false, note: "Card processing rate not provided." } },
    fixedExpenses: (snap?.fixedExpenses ?? []).map((f) => ({
      name: f.name,
      monthly: f.monthly,
      include: !recipeDuplicates.test(f.name),
      note: recipeDuplicates.test(f.name)
        ? `Excluded: ${f.source} (=${f.formula ?? f.monthly}) is a sauce production cost already included in recipe costs.`
        : f.monthly === null
          ? `No amount in workbook (${f.source}).`
          : `From workbook ${f.source}.`,
    })),
    karak: { menuCode: karak?.code ?? "M023", batchPrice: 23, defaultBatchesPerDay: 1, allocateRecipe: true },
    packaging: Object.fromEntries(CHANNELS.map((c) => [c, "workbook" as const])),
    refundDefault: "prepared",
    voidDefault: "not_prepared",
  };
}

export function channelOf(o: { spotType: string | null; deliveryApp: string | null; staffMeal: boolean }): Channel {
  if (o.staffMeal) return "staff_meal";
  if (o.deliveryApp) return "delivery";
  const s = (o.spotType ?? "").toLowerCase();
  return (CHANNELS as readonly string[]).includes(s) ? (s as Channel) : "other";
}

/** Payment grouping key, matching the engine's payment breakdown. */
export function paymentKeyOf(o: { deliveryApp: string | null; paymentMethods: string[] }): string {
  if (o.deliveryApp) return `aggregator:${o.deliveryApp}`;
  if (o.paymentMethods.length === 0) return "unspecified";
  if (o.paymentMethods.length > 1) return o.paymentMethods.join(" + ");
  return o.paymentMethods[0];
}
