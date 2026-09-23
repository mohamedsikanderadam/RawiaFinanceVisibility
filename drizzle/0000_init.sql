CREATE TABLE "adjustments" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_date" date NOT NULL,
	"type" text NOT NULL,
	"menu_code" text,
	"item_key" text,
	"qty" numeric,
	"amount" numeric,
	"note" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" integer
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" serial PRIMARY KEY NOT NULL,
	"at" timestamp with time zone DEFAULT now() NOT NULL,
	"user_id" integer,
	"user_name" text,
	"action" text NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text,
	"business_date" date,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "costing_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"source_file" text NOT NULL,
	"source_sha256" text NOT NULL,
	"base_version_id" integer,
	"overrides" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"snapshot" jsonb NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"effective_from" date,
	"note" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"activated_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "day_finalizations" (
	"id" serial PRIMARY KEY NOT NULL,
	"business_date" date NOT NULL,
	"revision" integer NOT NULL,
	"payload" jsonb NOT NULL,
	"reason" text DEFAULT '' NOT NULL,
	"finalized_by" integer,
	"finalized_at" timestamp with time zone DEFAULT now() NOT NULL,
	"superseded_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "item_mappings" (
	"id" serial PRIMARY KEY NOT NULL,
	"pos_key" text NOT NULL,
	"pos_name" text NOT NULL,
	"menu_code" text,
	"ignored" boolean DEFAULT false NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "item_mappings_pos_key_unique" UNIQUE("pos_key")
);
--> statement-breakpoint
CREATE TABLE "ledger_entries" (
	"id" serial PRIMARY KEY NOT NULL,
	"entry_date" date NOT NULL,
	"type" text NOT NULL,
	"account" text NOT NULL,
	"amount" numeric NOT NULL,
	"counterparty" text,
	"from_reserve" boolean DEFAULT false NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"voided_at" timestamp with time zone,
	"voided_by" integer
);
--> statement-breakpoint
CREATE TABLE "order_decisions" (
	"order_key" text PRIMARY KEY NOT NULL,
	"prep" text NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"updated_by" integer,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "orders" (
	"order_key" text PRIMARY KEY NOT NULL,
	"key_source" text NOT NULL,
	"content_hash" text NOT NULL,
	"import_id" integer NOT NULL,
	"last_import_id" integer NOT NULL,
	"order_number" text,
	"business_date" date NOT NULL,
	"submitted_at" text,
	"closed_at" text,
	"spot_type" text,
	"spot_label" text,
	"delivery_app" text,
	"served_by" text,
	"status" text NOT NULL,
	"staff_meal" boolean NOT NULL,
	"staff_meal_for" text,
	"items_text" text NOT NULL,
	"total_sales" numeric,
	"discount_amount" numeric,
	"subtotal_after_discount" numeric,
	"vat" numeric,
	"sales_after_discount" numeric,
	"paid" numeric,
	"refunded" numeric,
	"net_received" numeric,
	"payment_raw" text,
	"payment_methods" jsonb NOT NULL,
	"void_reason" text,
	"lines" jsonb NOT NULL,
	"raw" jsonb NOT NULL,
	"source_row" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sales_imports" (
	"id" serial PRIMARY KEY NOT NULL,
	"file_name" text NOT NULL,
	"sha256" text NOT NULL,
	"format" text NOT NULL,
	"selected_date" date,
	"scope" text NOT NULL,
	"status" text DEFAULT 'preview' NOT NULL,
	"parsed" jsonb,
	"summary" jsonb,
	"changed_policy" text,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"committed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "settings_versions" (
	"id" serial PRIMARY KEY NOT NULL,
	"effective_from" date NOT NULL,
	"value" jsonb NOT NULL,
	"note" text DEFAULT '' NOT NULL,
	"created_by" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" serial PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"password_hash" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE INDEX "adjustments_date_idx" ON "adjustments" USING btree ("business_date");--> statement-breakpoint
CREATE INDEX "audit_at_idx" ON "audit_log" USING btree ("at");--> statement-breakpoint
CREATE UNIQUE INDEX "day_final_rev_idx" ON "day_finalizations" USING btree ("business_date","revision");--> statement-breakpoint
CREATE INDEX "ledger_date_idx" ON "ledger_entries" USING btree ("entry_date");--> statement-breakpoint
CREATE INDEX "orders_business_date_idx" ON "orders" USING btree ("business_date");