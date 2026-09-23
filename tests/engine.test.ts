import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { aggregateRange } from "@/lib/engine/aggregate";
import { computeDay, type DayInput } from "@/lib/engine/compute";
import type { DayResult, EngineAdjustment, EngineOrder } from "@/lib/engine/types";
import { applyOverrides, finalizeSnapshot } from "@/lib/costing/snapshot";
import type { CostingSnapshot } from "@/lib/costing/types";
import { parseCostingWorkbook } from "@/lib/costing/workbook";
import { reconcileMenu } from "@/lib/costing/expand";
import { D } from "@/lib/money";
import { defaultSettings, type PrepState, type Settings } from "@/lib/settings";

const WB = path.join(__dirname, "fixtures", "rawia cafe OPS (4).xlsx");
const DATE = "2026-09-14";
let snap: CostingSnapshot;
let settings: Settings;

beforeAll(async () => {
  snap = finalizeSnapshot(await parseCostingWorkbook(readFileSync(WB), path.basename(WB)));
  settings = defaultSettings(snap);
});

let seq = 0;
function order(lines: [string, number][], o: Partial<EngineOrder> = {}): EngineOrder {
  seq++;
  const price = lines.reduce((a, [code, q]) => a + (snap.menu.find((m) => m.code === code)?.priceDineIn ?? 0) * q, 0);
  const after = o.salesAfterDiscount ?? String(price);
  return {
    orderKey: `o${seq}`,
    orderNumber: String(seq),
    businessDate: DATE,
    submittedAt: `${DATE}T10:00:00+04:00`,
    spotType: "Indoor",
    deliveryApp: null,
    status: "paid",
    staffMeal: false,
    staffMealFor: null,
    totalSales: String(price),
    discountAmount: null,
    subtotalAfterDiscount: D(after).div(1.05).toString(),
    vat: D(after).minus(D(after).div(1.05)).toString(),
    salesAfterDiscount: after,
    paid: after,
    refunded: "0",
    netReceived: after,
    paymentMethods: ["card"],
    lines: lines.map(([code, qty], i) => ({ lineKey: `o${seq}:${i}`, posName: code, qty, menuCode: code })),
    ...o,
  };
}

function run(orders: EngineOrder[], extra: { adjustments?: EngineAdjustment[]; decisions?: [string, PrepState][]; settings?: Settings; snapshot?: CostingSnapshot } = {}): DayResult {
  const input: DayInput = {
    date: DATE,
    snapshot: extra.snapshot ?? snap,
    costingVersion: { id: 1, label: "test" },
    settings: extra.settings ?? settings,
    settingsVersionId: 0,
    orders,
    decisions: new Map(extra.decisions ?? []),
    adjustments: extra.adjustments ?? [],
  };
  return computeDay(input);
}

const noBatch = (): Settings => ({ ...settings, karak: { ...settings.karak, defaultBatchesPerDay: 0 } });
const val = (r: DayResult, k: string) => D(r.metrics[k].value);
const row = (r: DayResult, key: string) => r.consumption.find((c) => c.itemKey === key);

describe("normal item allocation", () => {
  it("expands Chicken Dynamite Burger into ingredients and packaging and matches the workbook cost", () => {
    const r = run([order([["M002", 2]])], { settings: noBatch() });
    const bun = r.consumption.find((c) => /burger bun/i.test(c.label));
    expect(bun).toBeDefined();
    expect(D(bun!.qty).toNumber()).toBe(2);
    expect(D(bun!.amount).toFixed(6)).toBe(D(4.7).div(6).times(2).toFixed(6));
    const box = row(r, "pkg:burger-box");
    expect(D(box!.qty).toNumber()).toBe(2);
    const wb = snap.menu.find((m) => m.code === "M002")!.workbook;
    expect(val(r, "ingredientCost").toFixed(4)).toBe(D(wb.foodCost!).times(2).toFixed(4));
    expect(val(r, "cogsSold").toFixed(4)).toBe(D(wb.costWithPackaging!).times(2).toFixed(4));
    expect(r.metrics.reserve.status).toBe("calculated");
    expect(val(r, "reserve").eq(val(r, "cogsSold"))).toBe(true);
  });
});

describe("discounts", () => {
  it("reduce revenue but not consumption", () => {
    const full = run([order([["M002", 1]])], { settings: noBatch() });
    const half = run([order([["M002", 1]], { salesAfterDiscount: "12" })], { settings: noBatch() });
    expect(val(half, "netSalesInclVat").toNumber()).toBe(12);
    expect(val(full, "netSalesInclVat").toNumber()).toBe(24);
    expect(val(half, "discounts").toNumber()).toBe(12);
    expect(val(half, "reserve").eq(val(full, "reserve"))).toBe(true);
    expect(val(half, "cogsSold").eq(val(full, "cogsSold"))).toBe(true);
  });
});

describe("staff meals and complimentary", () => {
  it("create replenishment cost with zero revenue", () => {
    const staff = order([["M002", 1]], { staffMeal: true, salesAfterDiscount: "0", paymentMethods: [] });
    const comp = order([["M034", 1]], { salesAfterDiscount: "0", paymentMethods: [] });
    const r = run([staff, comp], { settings: noBatch() });
    expect(val(r, "netSales").toNumber()).toBe(0);
    expect(val(r, "cogsSold").toNumber()).toBe(0);
    expect(val(r, "staffConsumption").toFixed(4)).toBe(D(snap.menu.find((m) => m.code === "M002")!.workbook.costWithPackaging!).toFixed(4));
    expect(val(r, "complimentaryConsumption").toFixed(4)).toBe(D(snap.menu.find((m) => m.code === "M034")!.workbook.costWithPackaging!).toFixed(4));
    expect(val(r, "reserve").eq(val(r, "staffConsumption").plus(val(r, "complimentaryConsumption")))).toBe(true);
    expect(val(r, "unknownPayments").toNumber()).toBe(0);
  });

  it("manual staff-meal and wastage adjustments consume stock with no revenue", () => {
    const r = run([], {
      settings: noBatch(),
      adjustments: [
        { id: 1, businessDate: DATE, type: "staff_meal", menuCode: "M002", itemKey: null, qty: "1", amount: null, note: "missed" },
        { id: 2, businessDate: DATE, type: "wastage", menuCode: "M012", itemKey: null, qty: "2", amount: null, note: "dropped" },
      ],
    });
    expect(val(r, "staffConsumption").gt(0)).toBe(true);
    expect(val(r, "wastage").toFixed(4)).toBe(D(snap.menu.find((m) => m.code === "M012")!.workbook.foodCost!).times(2).toFixed(4));
    expect(val(r, "netSalesInclVat").toNumber()).toBe(0);
  });
});

describe("Cane Karak daily batch", () => {
  it("charges AED 23 once per prepared batch regardless of cups sold, with no per-cup recipe cost", () => {
    const one = run([order([["M023", 1]])]);
    const many = run([order([["M023", 7]]), order([["M023", 5]])]);
    expect(val(one, "batchCost").toNumber()).toBe(23);
    expect(val(many, "batchCost").toNumber()).toBe(23);
    expect(many.karak.cups).toBe("12");
    const batchRecords = (r: DayResult) => r.records.filter((x) => x.bucket === "batch");
    expect(batchRecords(many).reduce((a, x) => a.plus(D(x.amount)), D(0)).toNumber()).toBe(23);
    // Per-cup lines carry zero ingredient cost; only packaging is charged per cup.
    const perCupIngredient = many.records.filter((x) => x.bucket === "sold" && x.kind === "ingredient");
    expect(perCupIngredient).toHaveLength(0);
    const cupPkg = many.records.filter((x) => x.bucket === "sold" && x.kind === "packaging");
    expect(cupPkg.length).toBeGreaterThan(0);
    expect(D(many.karak.allocated).plus(D(many.karak.unallocated)).toNumber()).toBe(23);
  });

  it("follows batch-count and not-prepared adjustments", () => {
    const adj = (qty: string): EngineAdjustment => ({ id: 1, businessDate: DATE, type: "batch_count", menuCode: null, itemKey: null, qty, amount: null, note: "" });
    expect(val(run([order([["M023", 3]])], { adjustments: [adj("2")] }), "batchCost").toNumber()).toBe(46);
    const none = run([order([["M023", 3]])], { adjustments: [adj("0")] });
    expect(val(none, "batchCost").toNumber()).toBe(0);
    expect(none.issues.some((i) => i.code === "karak_not_prepared")).toBe(true);
  });

  it("shows AED 23 as unallocated when recipe allocation is off", () => {
    const s = { ...settings, karak: { ...settings.karak, allocateRecipe: false } };
    const r = run([order([["M023", 1]])], { settings: s });
    expect(D(r.karak.unallocated).toNumber()).toBe(23);
    expect(row(r, `batch:${s.karak.menuCode}`)?.label).toMatch(/unallocated/);
  });
});

describe("combos", () => {
  it("expand into components with the combo's packaging counted once", () => {
    const r = run([order([["M047", 1]])], { settings: noBatch() });
    const bag = row(r, "pkg:paper-bag-printed-29x29x15");
    expect(D(bag!.qty).toNumber()).toBe(1);
    const cup = row(r, "pkg:16-oz-frosted-pet-cup-printed-with-lid");
    expect(D(cup!.qty).toNumber()).toBe(1);
    const components = ["M001", "M012", "M037"].map((c) => D(snap.menu.find((m) => m.code === c)!.workbook.foodCost!));
    expect(val(r, "ingredientCost").toFixed(4)).toBe(components.reduce((a, b) => a.plus(b)).toFixed(4));
    const rec = reconcileMenu(snap).find((m) => m.code === "M047")!;
    expect(D(rec.appPackaging ?? 0).toFixed(4)).toBe(val(r, "packagingCost").toFixed(4));
  });
});

describe("refunds and cancellations", () => {
  it("prepared refunds keep consumption; recovered refunds and unprepared voids consume nothing", () => {
    const refunded = order([["M002", 1]], { status: "refunded", refunded: "24", netReceived: "0" });
    const voided = order([["M002", 1]], { status: "void" });
    const base = run([refunded, voided], { settings: noBatch() });
    expect(val(base, "netSalesInclVat").toNumber()).toBe(0);
    expect(val(base, "wastage").gt(0)).toBe(true);
    const wb = D(snap.menu.find((m) => m.code === "M002")!.workbook.costWithPackaging!);
    expect(val(base, "reserve").toFixed(4)).toBe(wb.toFixed(4));
    expect(base.decisions.every((d) => d.source === "default")).toBe(true);

    const recovered = run([refunded, voided], { settings: noBatch(), decisions: [[refunded.orderKey, "recovered"]] });
    expect(val(recovered, "reserve").toNumber()).toBe(0);

    const voidPrepared = run([voided], { settings: noBatch(), decisions: [[voided.orderKey, "prepared"]] });
    expect(val(voidPrepared, "wastage").toFixed(4)).toBe(wb.toFixed(4));
    expect(val(voidPrepared, "grossSales").toNumber()).toBe(0);
  });
});

describe("missing costs", () => {
  it("produce visible incomplete totals instead of zero", () => {
    const unmatched: EngineOrder = { ...order([["M002", 1]]), lines: [{ lineKey: "x", posName: "Mystery Drink", qty: 1, menuCode: null }] };
    const r = run([unmatched, order([["M021", 1]])], { settings: noBatch() });
    expect(r.metrics.reserve.status).toBe("incomplete");
    expect(r.metrics.operatingResult.status).toBe("incomplete");
    expect(r.issues.some((i) => i.code === "unmatched_item")).toBe(true);
    const missing = r.consumption.filter((c) => c.incomplete);
    expect(missing.length).toBeGreaterThan(0);
    expect(r.records.filter((x) => x.incomplete).every((x) => x.amount === null || x.flags.length > 0)).toBe(true);
  });

  it("confirmed-zero overrides clear the incomplete flag without changing the source snapshot", () => {
    const water = snap.items.find((i) => /water/i.test(i.name) && i.costStatus === "missing");
    expect(water).toBeDefined();
    const fixed = applyOverrides(snap, [{ type: "item_zero", itemKey: water!.key, note: "tap water" }]);
    expect(snap.items.find((i) => i.key === water!.key)!.costStatus).toBe("missing");
    expect(fixed.items.find((i) => i.key === water!.key)!.costStatus).toBe("confirmed_zero");
  });
});

describe("range aggregation", () => {
  it("sums days and marks partial availability", () => {
    const a = run([order([["M002", 1]])], { settings: noBatch() });
    const b = run([order([["M012", 3]])], { settings: noBatch() });
    const s = aggregateRange(DATE, DATE, [
      { date: DATE, state: "live", revision: null, result: a },
      { date: "2026-09-15", state: "finalized", revision: 1, result: { ...b, date: "2026-09-15" } },
    ]);
    expect(D(s.metrics.reserve.value).eq(val(a, "reserve").plus(val(b, "reserve")))).toBe(true);
    expect(D(s.consumption.reduce((x, c) => x.plus(D(c.amount)), D(0))).toFixed(10)).toBe(D(s.metrics.reserve.value).toFixed(10));
    expect(s.finalizedDays).toBe(1);
    const op = s.waterfall[s.waterfall.length - 1];
    expect(op.value).toBe(s.metrics.operatingResult.value);
  });
});
