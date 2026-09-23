import { createHash } from "node:crypto";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { parseSalesFile, type ParsedOrder, type SalesParseResult } from "../sales/parse";
import { mappingKey, matchPosName, type MappingMatch } from "../sales/mapping";
import { D, sum } from "../money";
import { channelOf } from "../settings";
import { audit, type Actor } from "./audit";
import { costingFor } from "./costing";

export type OrderClass = "new" | "duplicate" | "changed" | "out_of_scope" | "in_file_repeat" | "possible_duplicate";

export type PreviewOrder = {
  orderKey: string;
  orderNumber: string | null;
  businessDate: string;
  submittedAt: string | null;
  status: string;
  channel: string;
  staffMeal: boolean;
  itemsText: string;
  totalSales: string | null;
  discountAmount: string | null;
  salesAfterDiscount: string | null;
  refunded: string | null;
  paymentRaw: string | null;
  cls: OrderClass;
  note: string;
  sourceRow: number;
  warnings: string[];
};

export type PreviewItem = { posName: string; qty: number; orders: number; match: MappingMatch; menuName: string | null; costIncomplete: boolean; costNote: string };

export type ImportPreview = {
  importId: number;
  fileName: string;
  format: string;
  sheetName: string | null;
  selectedDate: string | null;
  scope: "selected_date" | "all_dates";
  errors: string[];
  missingColumns: string[];
  dateNotes: string[];
  skipped: { row: number; reason: string }[];
  dates: { date: string; orders: number; inScope: boolean; finalized: boolean }[];
  totals: { orders: number; units: number; totalSales: string; discounts: string; salesAfterDiscount: string; refunds: string; vat: string };
  byClass: Record<OrderClass, number>;
  payments: { method: string; orders: number; amount: string }[];
  channels: { channel: string; orders: number; amount: string }[];
  items: PreviewItem[];
  orders: PreviewOrder[];
  costingLabel: string | null;
  costingIssues: string[];
};

type StoredParsed = { result: SalesParseResult; classes: Record<string, { cls: OrderClass; note: string }> };

export function contentHash(o: ParsedOrder): string {
  const payload = [
    o.businessDate,
    o.status,
    o.staffMeal,
    o.itemsText,
    o.totalSales,
    o.discountAmount,
    o.subtotalAfterDiscount,
    o.vat,
    o.salesAfterDiscount,
    o.paid,
    o.refunded,
    o.netReceived,
    o.paymentRaw,
    o.voidReason,
    o.deliveryApp,
    o.spotType,
  ];
  return createHash("sha256").update(JSON.stringify(payload)).digest("hex");
}

export async function savedMappings(): Promise<Map<string, { menuCode: string | null; ignored: boolean }>> {
  const rows = await db.select().from(schema.itemMappings);
  return new Map(rows.map((r) => [r.posKey, { menuCode: r.menuCode, ignored: r.ignored }]));
}

export async function finalizedDates(dates: string[]): Promise<Set<string>> {
  if (!dates.length) return new Set();
  const rows = await db
    .select({ d: schema.dayFinalizations.businessDate })
    .from(schema.dayFinalizations)
    .where(and(inArray(schema.dayFinalizations.businessDate, dates), isNull(schema.dayFinalizations.supersededAt)));
  return new Set(rows.map((r) => r.d));
}

async function classify(res: SalesParseResult, selectedDate: string | null, scope: "selected_date" | "all_dates") {
  const keys = res.orders.map((o) => o.orderKey);
  const existing = keys.length
    ? await db
        .select({ orderKey: schema.orders.orderKey, contentHash: schema.orders.contentHash, importId: schema.orders.importId })
        .from(schema.orders)
        .where(inArray(schema.orders.orderKey, keys))
    : [];
  const byKey = new Map(existing.map((e) => [e.orderKey, e]));
  const fpDates = [...new Set(res.orders.filter((o) => o.keySource === "fingerprint").map((o) => o.businessDate))];
  const sameDay = fpDates.length
    ? await db
        .select({ orderKey: schema.orders.orderKey, orderNumber: schema.orders.orderNumber, businessDate: schema.orders.businessDate, itemsText: schema.orders.itemsText, totalSales: schema.orders.totalSales })
        .from(schema.orders)
        .where(inArray(schema.orders.businessDate, fpDates))
    : [];
  const classes: Record<string, { cls: OrderClass; note: string }> = {};
  for (const o of res.orders) {
    let c: { cls: OrderClass; note: string };
    const ex = byKey.get(o.orderKey);
    if (scope === "selected_date" && selectedDate && o.businessDate !== selectedDate) c = { cls: "out_of_scope", note: `Business date ${o.businessDate} is outside the selected date.` };
    else if (o.repeatOf !== undefined && o.keySource === "uuid") c = { cls: "in_file_repeat", note: `Repeat of row ${o.repeatOf}; skipped.` };
    else if (ex && ex.contentHash === contentHash(o)) c = { cls: "duplicate", note: `Already imported (import #${ex.importId}); skipped.` };
    else if (ex) c = { cls: "changed", note: `Already imported (import #${ex.importId}) with different values, e.g. a later refund or void.` };
    else if (o.repeatOf !== undefined) c = { cls: "possible_duplicate", note: `Identical to row ${o.repeatOf} of this file and has no Order UUID. Excluded unless you include it.` };
    else {
      const twin =
        o.keySource === "fingerprint"
          ? sameDay.find((s) => s.businessDate === o.businessDate && ((o.orderNumber && s.orderNumber === o.orderNumber) || (s.itemsText === o.itemsText && s.totalSales !== null && o.totalSales !== null && D(s.totalSales).eq(D(o.totalSales)))))
          : undefined;
      c = twin
        ? { cls: "possible_duplicate", note: `Looks like an already-imported order on ${o.businessDate} (${twin.orderNumber ? `order #${twin.orderNumber}` : "same items and total"}) but the time or details differ. Excluded unless you include it.` }
        : { cls: "new", note: "" };
    }
    classes[o.orderKey + "@" + o.sourceRow] = c;
  }
  return classes;
}

function k(o: ParsedOrder) {
  return o.orderKey + "@" + o.sourceRow;
}

export async function createPreview(buffer: Buffer, fileName: string, selectedDate: string | null, scope: "selected_date" | "all_dates", actor: Actor): Promise<number> {
  const result = await parseSalesFile(buffer, fileName);
  const classes = await classify(result, selectedDate, scope);
  const stored: StoredParsed = { result, classes };
  const [row] = await db
    .insert(schema.salesImports)
    .values({ fileName, sha256: result.sha256, format: result.format, selectedDate, scope, parsed: stored, createdBy: actor?.id ?? null })
    .returning({ id: schema.salesImports.id });
  await audit(actor, "import.preview", "sales_import", row.id, { fileName, sha256: result.sha256, orders: result.orders.length, errors: result.errors }, selectedDate);
  return row.id;
}

export async function getPreview(importId: number): Promise<{ preview: ImportPreview; status: string } | null> {
  const rows = await db.select().from(schema.salesImports).where(eq(schema.salesImports.id, importId)).limit(1);
  const imp = rows[0];
  if (!imp || !imp.parsed) return null;
  const { result, classes } = imp.parsed as StoredParsed;
  const refDate = imp.selectedDate ?? result.orders[0]?.businessDate ?? null;
  const costing = refDate ? await costingFor(refDate) : null;
  const saved = await savedMappings();
  const counted = result.orders.filter((o) => classes[k(o)]?.cls !== "out_of_scope");
  const dateCounts = new Map<string, number>();
  for (const o of result.orders) dateCounts.set(o.businessDate, (dateCounts.get(o.businessDate) ?? 0) + 1);
  const fin = await finalizedDates([...dateCounts.keys()]);

  const payments = new Map<string, { orders: number; amount: ReturnType<typeof D> }>();
  const channels = new Map<string, { orders: number; amount: ReturnType<typeof D> }>();
  const items = new Map<string, { qty: number; orders: number }>();
  for (const o of counted) {
    const pm = o.paymentMethods.length === 0 ? "unknown (blank)" : o.paymentMethods.length > 1 ? `split: ${o.paymentMethods.join(" + ")}` : o.paymentMethods[0];
    const p = payments.get(pm) ?? { orders: 0, amount: D(0) };
    p.orders += 1;
    p.amount = p.amount.plus(D(o.salesAfterDiscount));
    payments.set(pm, p);
    const ch = o.deliveryApp ? `delivery: ${o.deliveryApp}` : channelOf(o);
    const c = channels.get(ch) ?? { orders: 0, amount: D(0) };
    c.orders += 1;
    c.amount = c.amount.plus(D(o.salesAfterDiscount));
    channels.set(ch, c);
    for (const l of o.lines) {
      const it = items.get(l.posName) ?? { qty: 0, orders: 0 };
      it.qty += l.qty;
      it.orders += 1;
      items.set(l.posName, it);
    }
  }
  const snap = costing?.snapshot ?? null;
  const previewItems: PreviewItem[] = [...items].map(([posName, v]) => {
    const match: MappingMatch = snap ? matchPosName(posName, snap, saved) : { menuCode: null, how: "none", candidates: [] };
    const m = snap && match.menuCode ? snap.menu.find((x) => x.code === match.menuCode) : undefined;
    const menuIssues = snap && m ? snap.issues.filter((i) => i.menuCode === m.code && i.severity === "error") : [];
    return {
      posName,
      qty: v.qty,
      orders: v.orders,
      match,
      menuName: m?.name ?? null,
      costIncomplete: !m || menuIssues.length > 0 || m.costMode === "no_recipe",
      costNote: !m ? (match.how === "ignored" ? "Ignored (no stock consumption)" : "Not mapped") : m.costMode === "no_recipe" ? "No recipe in workbook" : m.costMode === "total_only" ? "Total cost only; ingredient allocation unavailable" : menuIssues.map((i) => i.message).join(" "),
    };
  });
  previewItems.sort((a, b) => Number(!!a.match.menuCode) - Number(!!b.match.menuCode) || b.qty - a.qty);

  const byClass = { new: 0, duplicate: 0, changed: 0, out_of_scope: 0, in_file_repeat: 0, possible_duplicate: 0 } as Record<OrderClass, number>;
  for (const o of result.orders) byClass[classes[k(o)]?.cls ?? "new"] += 1;

  const preview: ImportPreview = {
    importId,
    fileName: imp.fileName,
    format: imp.format,
    sheetName: result.sheetName,
    selectedDate: imp.selectedDate,
    scope: imp.scope,
    errors: result.errors,
    missingColumns: result.missingColumns,
    dateNotes: result.dateNotes,
    skipped: result.skipped,
    dates: [...dateCounts].sort().map(([date, n]) => ({ date, orders: n, inScope: imp.scope === "all_dates" || date === imp.selectedDate, finalized: fin.has(date) })),
    totals: {
      orders: counted.length,
      units: counted.reduce((a, o) => a + o.lines.reduce((b, l) => b + l.qty, 0), 0),
      totalSales: sum(counted.map((o) => D(o.totalSales))).toString(),
      discounts: sum(counted.map((o) => D(o.totalSales).minus(D(o.salesAfterDiscount)))).toString(),
      salesAfterDiscount: sum(counted.map((o) => D(o.salesAfterDiscount))).toString(),
      refunds: sum(counted.map((o) => D(o.refunded))).toString(),
      vat: sum(counted.map((o) => D(o.vat))).toString(),
    },
    byClass,
    payments: [...payments].map(([method, v]) => ({ method, orders: v.orders, amount: v.amount.toString() })),
    channels: [...channels].map(([channel, v]) => ({ channel, orders: v.orders, amount: v.amount.toString() })),
    items: previewItems,
    orders: result.orders.map((o) => ({
      orderKey: o.orderKey,
      orderNumber: o.orderNumber,
      businessDate: o.businessDate,
      submittedAt: o.submittedAt,
      status: o.status,
      channel: o.deliveryApp ? `delivery: ${o.deliveryApp}` : channelOf(o),
      staffMeal: o.staffMeal,
      itemsText: o.itemsText,
      totalSales: o.totalSales,
      discountAmount: o.discountAmount,
      salesAfterDiscount: o.salesAfterDiscount,
      refunded: o.refunded,
      paymentRaw: o.paymentRaw,
      cls: classes[k(o)]?.cls ?? "new",
      note: classes[k(o)]?.note ?? "",
      sourceRow: o.sourceRow,
      warnings: o.warnings,
    })),
    costingLabel: costing?.label ?? null,
    costingIssues: costing ? [] : ["No active costing version. Import and activate the costing workbook before confirming sales."],
  };
  return { preview, status: imp.status };
}

function orderValues(o: ParsedOrder, importId: number) {
  return {
    orderKey: o.orderKey,
    keySource: o.keySource,
    contentHash: contentHash(o),
    importId,
    lastImportId: importId,
    orderNumber: o.orderNumber,
    businessDate: o.businessDate,
    submittedAt: o.submittedAt,
    closedAt: o.closedAt,
    spotType: o.spotType,
    spotLabel: o.spotLabel,
    deliveryApp: o.deliveryApp,
    servedBy: o.servedBy,
    status: o.status,
    staffMeal: o.staffMeal,
    staffMealFor: o.staffMealFor,
    itemsText: o.itemsText,
    totalSales: o.totalSales,
    discountAmount: o.discountAmount,
    subtotalAfterDiscount: o.subtotalAfterDiscount,
    vat: o.vat,
    salesAfterDiscount: o.salesAfterDiscount,
    paid: o.paid,
    refunded: o.refunded,
    netReceived: o.netReceived,
    paymentRaw: o.paymentRaw,
    paymentMethods: o.paymentMethods,
    voidReason: o.voidReason,
    lines: o.lines,
    raw: o.raw,
    sourceRow: o.sourceRow,
  };
}

export type CommitOptions = { changedPolicy: "keep" | "replace"; includePossible: string[] };

export async function commitImport(importId: number, opts: CommitOptions, actor: Actor): Promise<{ inserted: number; replaced: number; skipped: number; dates: string[] }> {
  return db.transaction(async (tx) => {
    const rows = await tx.select().from(schema.salesImports).where(eq(schema.salesImports.id, importId)).for("update").limit(1);
    const imp = rows[0];
    if (!imp || !imp.parsed) throw new Error("Import not found.");
    if (imp.status !== "preview") throw new Error(`Import already ${imp.status}.`);
    const { result } = imp.parsed as StoredParsed;
    if (result.errors.length) throw new Error(`File has errors: ${result.errors.join("; ")}`);
    const classes = await classify(result, imp.selectedDate, imp.scope);
    const include = new Set(opts.includePossible);
    let inserted = 0;
    let replaced = 0;
    let skipped = 0;
    const dates = new Set<string>();
    for (const o of result.orders) {
      const c = classes[k(o)]?.cls ?? "new";
      if (c === "new" || (c === "possible_duplicate" && include.has(o.orderKey))) {
        await tx.insert(schema.orders).values(orderValues(o, importId)).onConflictDoNothing();
        inserted += 1;
        dates.add(o.businessDate);
      } else if (c === "changed" && opts.changedPolicy === "replace") {
        const rest: Partial<ReturnType<typeof orderValues>> = orderValues(o, importId);
        delete rest.importId;
        await tx.update(schema.orders).set({ ...rest, updatedAt: new Date() }).where(eq(schema.orders.orderKey, o.orderKey));
        replaced += 1;
        dates.add(o.businessDate);
      } else skipped += 1;
    }
    const summary = { orders: result.orders.length, newOrders: inserted, duplicates: Object.values(classes).filter((c) => c.cls === "duplicate").length, changed: replaced, outOfScope: Object.values(classes).filter((c) => c.cls === "out_of_scope").length, dates: [...dates].sort() };
    await tx.update(schema.salesImports).set({ status: "committed", committedAt: new Date(), summary, changedPolicy: opts.changedPolicy }).where(eq(schema.salesImports.id, importId));
    await audit(actor, "import.commit", "sales_import", importId, { fileName: imp.fileName, inserted, replaced, skipped, includedPossible: [...include], dates: summary.dates }, imp.selectedDate, tx);
    return { inserted, replaced, skipped, dates: summary.dates };
  });
}

export async function discardImport(importId: number, actor: Actor): Promise<void> {
  await db.update(schema.salesImports).set({ status: "discarded" }).where(and(eq(schema.salesImports.id, importId), eq(schema.salesImports.status, "preview")));
  await audit(actor, "import.discard", "sales_import", importId);
}

export async function saveMapping(posName: string, menuCode: string | null, ignored: boolean, note: string, actor: Actor): Promise<void> {
  const posKey = mappingKey(posName);
  await db
    .insert(schema.itemMappings)
    .values({ posKey, posName, menuCode, ignored, note, updatedBy: actor?.id ?? null })
    .onConflictDoUpdate({ target: schema.itemMappings.posKey, set: { menuCode, ignored, note, posName, updatedBy: actor?.id ?? null, updatedAt: new Date() } });
  await audit(actor, "mapping.save", "item_mapping", posKey, { posName, menuCode, ignored, note });
}

export async function deleteMapping(posName: string, actor: Actor): Promise<void> {
  const posKey = mappingKey(posName);
  await db.delete(schema.itemMappings).where(eq(schema.itemMappings.posKey, posKey));
  await audit(actor, "mapping.delete", "item_mapping", posKey, { posName });
}

export async function listImports() {
  return db
    .select({
      id: schema.salesImports.id,
      fileName: schema.salesImports.fileName,
      sha256: schema.salesImports.sha256,
      selectedDate: schema.salesImports.selectedDate,
      scope: schema.salesImports.scope,
      status: schema.salesImports.status,
      summary: schema.salesImports.summary,
      createdAt: schema.salesImports.createdAt,
      committedAt: schema.salesImports.committedAt,
    })
    .from(schema.salesImports)
    .orderBy(schema.salesImports.id);
}
