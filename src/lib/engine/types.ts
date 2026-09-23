import type { ConsumptionKind, LineFlag } from "../costing/expand";
import type { PrepState } from "../settings";

export type Bucket = "sold" | "staff" | "complimentary" | "wastage" | "refund_loss" | "batch" | "manual";
export const BUCKETS: Bucket[] = ["sold", "staff", "complimentary", "wastage", "refund_loss", "batch", "manual"];
export const BUCKET_LABEL: Record<Bucket, string> = {
  sold: "Sold items",
  staff: "Staff meals",
  complimentary: "Complimentary",
  wastage: "Wastage",
  refund_loss: "Refunded but prepared",
  batch: "Daily batches",
  manual: "Manual adjustments",
};

export type EngineLine = {
  lineKey: string;
  posName: string;
  qty: number;
  menuCode: string | null;
};

export type EngineOrder = {
  orderKey: string;
  orderNumber: string | null;
  businessDate: string;
  submittedAt: string | null;
  spotType: string | null;
  deliveryApp: string | null;
  status: string;
  staffMeal: boolean;
  staffMealFor: string | null;
  totalSales: string | null;
  discountAmount: string | null;
  subtotalAfterDiscount: string | null;
  vat: string | null;
  salesAfterDiscount: string | null;
  paid: string | null;
  refunded: string | null;
  netReceived: string | null;
  paymentMethods: string[];
  lines: EngineLine[];
};

export type AdjustmentType = "staff_meal" | "complimentary" | "wastage" | "batch_count" | "manual_cost";

export type EngineAdjustment = {
  id: number;
  businessDate: string;
  type: AdjustmentType;
  menuCode: string | null;
  itemKey: string | null;
  qty: string | null;
  amount: string | null;
  note: string;
};

/** Serialized decimal (full precision). */
export type Num = string;

export type ConsumptionRecord = {
  itemKey: string;
  label: string;
  kind: ConsumptionKind;
  unit: string;
  qty: Num;
  unitCost: Num | null;
  amount: Num | null;
  incomplete: boolean;
  flags: LineFlag[];
  bucket: Bucket;
  origin: {
    type: "order" | "adjustment" | "batch";
    orderKey?: string;
    orderNumber?: string | null;
    lineKey?: string;
    adjustmentId?: number;
    posName?: string;
    menuCode?: string | null;
    servings: Num;
  };
  path: string[];
};

export type Issue = { severity: "error" | "warning" | "info"; code: string; message: string; ref?: string };

export type Metric = {
  key: string;
  label: string;
  value: Num | null;
  status: "confirmed" | "calculated" | "estimate" | "incomplete" | "unavailable";
  definition: string;
  formula: string;
  notes: string[];
};

export type ConsumptionRow = {
  itemKey: string;
  label: string;
  kind: ConsumptionKind;
  unit: string;
  qty: Num;
  unitCost: Num | null;
  amount: Num;
  incomplete: boolean;
  flags: LineFlag[];
  byBucket: Partial<Record<Bucket, Num>>;
};

export type MenuRow = {
  key: string;
  menuCode: string | null;
  name: string;
  soldQty: Num;
  staffQty: Num;
  compQty: Num;
  wasteQty: Num;
  revenueExVat: Num;
  soldCost: Num;
  margin: Num;
  marginPct: Num | null;
  incomplete: boolean;
};

export type DayResult = {
  date: string;
  costingVersionId: number;
  costingLabel: string;
  settingsVersionId: number;
  counts: {
    orders: number;
    included: number;
    voided: number;
    refunded: number;
    open: number;
    staffOrders: number;
    compOrders: number;
    units: Num;
    karakCups: Num;
  };
  metrics: Record<string, Metric>;
  payments: { method: string; orders: number; amount: Num; treatment: string }[];
  channels: { channel: string; orders: number; gross: Num; net: Num }[];
  feesByApp: { app: string; orders: number; base: Num; ratePct: number | null; amount: Num | null; confirmed: boolean }[];
  fixed: { name: string; monthly: number | null; daily: Num | null; included: boolean; note: string }[];
  karak: { menuCode: string; batches: number; source: "default" | "adjusted" | "no_sales"; cups: Num; cost: Num; allocated: Num; unallocated: Num };
  consumption: ConsumptionRow[];
  menuItems: MenuRow[];
  records: ConsumptionRecord[];
  unmatched: { posName: string; qty: Num; orders: number }[];
  decisions: { orderKey: string; orderNumber: string | null; status: string; prep: PrepState; source: "default" | "recorded" }[];
  issues: Issue[];
};
