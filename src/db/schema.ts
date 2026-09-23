import { boolean, date, index, integer, jsonb, numeric, pgTable, serial, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { CostingSnapshot } from "@/lib/costing/types";
import type { CostingOverride } from "@/lib/costing/snapshot";
import type { Settings } from "@/lib/settings";
import type { DayResult } from "@/lib/engine/types";
import type { ParsedLine } from "@/lib/sales/parse";
import type { Role } from "@/lib/session-token";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: text("email").notNull().unique(),
  name: text("name").notNull(),
  role: text("role").$type<Role>().notNull(),
  passwordHash: text("password_hash").notNull(),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** A costing import. `snapshot` is immutable once created; corrections create a new version. */
export const costingVersions = pgTable("costing_versions", {
  id: serial("id").primaryKey(),
  label: text("label").notNull(),
  sourceFile: text("source_file").notNull(),
  sourceSha256: text("source_sha256").notNull(),
  baseVersionId: integer("base_version_id"),
  overrides: jsonb("overrides").$type<CostingOverride[]>().notNull().default([]),
  snapshot: jsonb("snapshot").$type<CostingSnapshot>().notNull(),
  status: text("status").$type<"draft" | "active" | "archived">().notNull().default("draft"),
  effectiveFrom: date("effective_from"),
  note: text("note").notNull().default(""),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  activatedAt: timestamp("activated_at", { withTimezone: true }),
});

/** Effective-dated business settings (VAT, fees, fixed costs, Karak, packaging, defaults). */
export const settingsVersions = pgTable("settings_versions", {
  id: serial("id").primaryKey(),
  effectiveFrom: date("effective_from").notNull(),
  value: jsonb("value").$type<Settings>().notNull(),
  note: text("note").notNull().default(""),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const itemMappings = pgTable("item_mappings", {
  id: serial("id").primaryKey(),
  posKey: text("pos_key").notNull().unique(),
  posName: text("pos_name").notNull(),
  menuCode: text("menu_code"),
  ignored: boolean("ignored").notNull().default(false),
  note: text("note").notNull().default(""),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type ImportSummary = {
  orders: number;
  newOrders: number;
  duplicates: number;
  changed: number;
  outOfScope: number;
  dates: string[];
};

export const salesImports = pgTable("sales_imports", {
  id: serial("id").primaryKey(),
  fileName: text("file_name").notNull(),
  sha256: text("sha256").notNull(),
  format: text("format").notNull(),
  selectedDate: date("selected_date"),
  scope: text("scope").$type<"selected_date" | "all_dates">().notNull(),
  status: text("status").$type<"preview" | "committed" | "discarded">().notNull().default("preview"),
  parsed: jsonb("parsed").$type<unknown>(),
  summary: jsonb("summary").$type<ImportSummary>(),
  changedPolicy: text("changed_policy").$type<"keep" | "replace">(),
  createdBy: integer("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  committedAt: timestamp("committed_at", { withTimezone: true }),
});

export const orders = pgTable(
  "orders",
  {
    orderKey: text("order_key").primaryKey(),
    keySource: text("key_source").$type<"uuid" | "fingerprint">().notNull(),
    contentHash: text("content_hash").notNull(),
    importId: integer("import_id").notNull(),
    lastImportId: integer("last_import_id").notNull(),
    orderNumber: text("order_number"),
    businessDate: date("business_date").notNull(),
    submittedAt: text("submitted_at"),
    closedAt: text("closed_at"),
    spotType: text("spot_type"),
    spotLabel: text("spot_label"),
    deliveryApp: text("delivery_app"),
    servedBy: text("served_by"),
    status: text("status").notNull(),
    staffMeal: boolean("staff_meal").notNull(),
    staffMealFor: text("staff_meal_for"),
    itemsText: text("items_text").notNull(),
    totalSales: numeric("total_sales"),
    discountAmount: numeric("discount_amount"),
    subtotalAfterDiscount: numeric("subtotal_after_discount"),
    vat: numeric("vat"),
    salesAfterDiscount: numeric("sales_after_discount"),
    paid: numeric("paid"),
    refunded: numeric("refunded"),
    netReceived: numeric("net_received"),
    paymentRaw: text("payment_raw"),
    paymentMethods: jsonb("payment_methods").$type<string[]>().notNull(),
    voidReason: text("void_reason"),
    lines: jsonb("lines").$type<ParsedLine[]>().notNull(),
    raw: jsonb("raw").$type<Record<string, string | null>>().notNull(),
    sourceRow: integer("source_row").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("orders_business_date_idx").on(t.businessDate)],
);

export const orderDecisions = pgTable("order_decisions", {
  orderKey: text("order_key").primaryKey(),
  prep: text("prep").$type<"prepared" | "not_prepared" | "recovered">().notNull(),
  note: text("note").notNull().default(""),
  updatedBy: integer("updated_by"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const adjustments = pgTable(
  "adjustments",
  {
    id: serial("id").primaryKey(),
    businessDate: date("business_date").notNull(),
    type: text("type").$type<"staff_meal" | "complimentary" | "wastage" | "batch_count" | "manual_cost">().notNull(),
    menuCode: text("menu_code"),
    itemKey: text("item_key"),
    qty: numeric("qty"),
    amount: numeric("amount"),
    note: text("note").notNull().default(""),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: integer("voided_by"),
  },
  (t) => [index("adjustments_date_idx").on(t.businessDate)],
);

export const LEDGER_TYPES = [
  "opening_balance",
  "allocation",
  "purchase",
  "expense",
  "settlement",
  "owner_contribution",
  "owner_withdrawal",
  "adjustment",
  "liabilities_statement",
] as const;
export type LedgerType = (typeof LEDGER_TYPES)[number];

export const ledgerEntries = pgTable(
  "ledger_entries",
  {
    id: serial("id").primaryKey(),
    entryDate: date("entry_date").notNull(),
    type: text("type").$type<LedgerType>().notNull(),
    account: text("account").$type<"cash" | "bank" | "none">().notNull(),
    amount: numeric("amount").notNull(),
    counterparty: text("counterparty"),
    fromReserve: boolean("from_reserve").notNull().default(false),
    description: text("description").notNull().default(""),
    createdBy: integer("created_by"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    voidedAt: timestamp("voided_at", { withTimezone: true }),
    voidedBy: integer("voided_by"),
  },
  (t) => [index("ledger_date_idx").on(t.entryDate)],
);

/** A finalized day. Later corrections add a new revision; earlier ones stay as they were. */
export const dayFinalizations = pgTable(
  "day_finalizations",
  {
    id: serial("id").primaryKey(),
    businessDate: date("business_date").notNull(),
    revision: integer("revision").notNull(),
    payload: jsonb("payload").$type<DayResult>().notNull(),
    reason: text("reason").notNull().default(""),
    finalizedBy: integer("finalized_by"),
    finalizedAt: timestamp("finalized_at", { withTimezone: true }).notNull().defaultNow(),
    supersededAt: timestamp("superseded_at", { withTimezone: true }),
  },
  (t) => [uniqueIndex("day_final_rev_idx").on(t.businessDate, t.revision)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    userId: integer("user_id"),
    userName: text("user_name"),
    action: text("action").notNull(),
    entity: text("entity").notNull(),
    entityId: text("entity_id"),
    businessDate: date("business_date"),
    details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [index("audit_at_idx").on(t.at)],
);
