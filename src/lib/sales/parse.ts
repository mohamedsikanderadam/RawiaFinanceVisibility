import { createHash } from "node:crypto";
import Papa from "papaparse";
import { loadWorkbook, type CellValue } from "../costing/grid";
import { DUBAI_OFFSET } from "../dates";

export type PaymentMethod = "cash" | "card" | "other";

export type ParsedLine = {
  lineNo: number;
  posName: string;
  qty: number;
  rawText: string;
  lineKey: string;
};

export type ParsedOrder = {
  orderKey: string;
  keySource: "uuid" | "fingerprint";
  orderUuid: string | null;
  orderNumber: string | null;
  businessDate: string;
  submittedAt: string | null;
  closedAt: string | null;
  spotType: string | null;
  spotLabel: string | null;
  deliveryApp: string | null;
  orderReference: string | null;
  servedBy: string | null;
  status: string;
  staffMeal: boolean;
  staffMealFor: string | null;
  itemsText: string;
  itemCount: number | null;
  totalSales: string | null;
  discountPct: string | null;
  discountAmount: string | null;
  subtotalAfterDiscount: string | null;
  vat: string | null;
  salesAfterDiscount: string | null;
  paid: string | null;
  refunded: string | null;
  netReceived: string | null;
  paymentRaw: string | null;
  paymentMethods: string[];
  voidReason: string | null;
  lines: ParsedLine[];
  sourceRow: number;
  /** Row of an earlier identical order in the same file. */
  repeatOf?: number;
  raw: Record<string, string | null>;
  warnings: string[];
};

export type SalesParseResult = {
  fileName: string;
  sha256: string;
  format: "csv" | "xlsx";
  sheetName: string | null;
  headerRow: number;
  columns: Record<string, string>;
  missingColumns: string[];
  orders: ParsedOrder[];
  skipped: { row: number; reason: string }[];
  dateNotes: string[];
  errors: string[];
};

const COLS = {
  orderNumber: /^order\s*(number|no|#)$/,
  date: /^(business\s*)?date$/,
  time: /^time$/,
  submittedAt: /^(submitted|created|opened)\s*(at|time)?$/,
  closedAt: /^closed\s*(at|time)?$/,
  spotType: /^(spot|order|service)\s*type$|^channel$/,
  spotLabel: /^spot\s*label$|^table$/,
  deliveryApp: /^delivery\s*app$|^aggregator$/,
  orderReference: /^order\s*reference$/,
  servedBy: /^served\s*by$|^cashier$/,
  status: /^(order\s*)?status$/,
  staffMeal: /^staff\s*meal$/,
  staffMealFor: /^staff\s*meal\s*for$/,
  items: /^items?$/,
  itemCount: /^item\s*count$/,
  totalSales: /^total\s*sales/,
  discountPct: /^discount\s*%$/,
  discountAmount: /^discount\s*amount/,
  subtotalAfterDiscount: /^subtotal\s*after\s*discount/,
  vat: /^vat/,
  salesAfterDiscount: /^sales\s*after\s*discount/,
  paymentMethod: /^payment\s*(method|type)s?$/,
  paid: /^paid/,
  refunded: /^refunded/,
  netReceived: /^net\s*received/,
  voidReason: /^void\s*reason$/,
  orderUuid: /^order\s*(uuid|id)$|^uuid$/,
} as const;
type ColKey = keyof typeof COLS;
const REQUIRED: ColKey[] = ["date", "items", "totalSales"];

function norm(h: unknown): string {
  return String(h ?? "")
    .replace(/^\uFEFF/, "")
    .toLowerCase()
    .replace(/\(aed\)/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function mapHeader(row: unknown[]): Partial<Record<ColKey, number>> {
  const out: Partial<Record<ColKey, number>> = {};
  row.forEach((h, i) => {
    const n = norm(h);
    if (!n) return;
    for (const k of Object.keys(COLS) as ColKey[]) {
      if (out[k] === undefined && COLS[k].test(n)) {
        out[k] = i;
        break;
      }
    }
  });
  return out;
}

type DateParts = { y: number; m: number; d: number; hh: number; mi: number; ss: number; kind: "iso" | "slash" | "excel" };

function pad(n: number, w = 2) {
  return String(n).padStart(w, "0");
}

function parseTextDate(s: string, dayFirst: boolean): DateParts | null {
  const t = s.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) return { y: +m[1], m: +m[2], d: +m[3], hh: +(m[4] ?? 0), mi: +(m[5] ?? 0), ss: +(m[6] ?? 0), kind: "iso" };
  m = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})(?:[ T](\d{1,2}):(\d{2})(?::(\d{2}))?)?/);
  if (m) {
    const a = +m[1];
    const b = +m[2];
    const y = m[3].length === 2 ? 2000 + +m[3] : +m[3];
    const [d, mo] = dayFirst ? [a, b] : [b, a];
    return { y, m: mo, d, hh: +(m[4] ?? 0), mi: +(m[5] ?? 0), ss: +(m[6] ?? 0), kind: "slash" };
  }
  return null;
}

function fromDateObj(v: Date): DateParts {
  return { y: v.getUTCFullYear(), m: v.getUTCMonth() + 1, d: v.getUTCDate(), hh: v.getUTCHours(), mi: v.getUTCMinutes(), ss: v.getUTCSeconds(), kind: "excel" };
}

function valid(p: DateParts | null): p is DateParts {
  return !!p && p.m >= 1 && p.m <= 12 && p.d >= 1 && p.d <= 31 && p.y > 2000;
}

function isoDate(p: DateParts) {
  return `${p.y}-${pad(p.m)}-${pad(p.d)}`;
}

function isoStamp(p: DateParts) {
  return `${isoDate(p)}T${pad(p.hh)}:${pad(p.mi)}:${pad(p.ss)}${DUBAI_OFFSET}`;
}

function cellStr(v: CellValue | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  const s = String(v).trim();
  return s === "" ? null : s;
}

function money(v: CellValue | undefined): string | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return String(v);
  const s = String(v).replace(/[,\s]|AED/gi, "");
  if (s === "") return null;
  return Number.isFinite(Number(s)) ? s : null;
}

export function parseItems(text: string): { posName: string; qty: number; rawText: string }[] {
  const parts = text
    .split(/,\s*(?=\d+(?:\.\d+)?\s*[x×]\s)/i)
    .map((p) => p.trim())
    .filter(Boolean);
  return parts.map((p) => {
    const m = p.match(/^(\d+(?:\.\d+)?)\s*[x×]\s*(.+)$/i);
    return m ? { posName: m[2].trim(), qty: Number(m[1]), rawText: p } : { posName: p, qty: 1, rawText: p };
  });
}

function sha(s: string) {
  return createHash("sha256").update(s).digest("hex");
}

export function parseSalesRows(rows: CellValue[][], meta: { fileName: string; sha256: string; format: "csv" | "xlsx"; sheetName: string | null }): SalesParseResult {
  const result: SalesParseResult = { ...meta, headerRow: 0, columns: {}, missingColumns: [], orders: [], skipped: [], dateNotes: [], errors: [] };
  let headerIdx = -1;
  let cols: Partial<Record<ColKey, number>> = {};
  for (let i = 0; i < Math.min(rows.length, 15); i++) {
    const c = mapHeader(rows[i]);
    if (REQUIRED.every((k) => c[k] !== undefined)) {
      headerIdx = i;
      cols = c;
      break;
    }
  }
  if (headerIdx < 0) {
    result.errors.push(`Could not find a header row with Date, Items and Total Sales columns.`);
    return result;
  }
  result.headerRow = headerIdx + 1;
  const header = rows[headerIdx].map((h) => String(h ?? "").replace(/^\uFEFF/, "").trim());
  for (const k of Object.keys(cols) as ColKey[]) result.columns[k] = header[cols[k]!];
  result.missingColumns = (Object.keys(COLS) as ColKey[]).filter((k) => cols[k] === undefined);

  const get = (r: CellValue[], k: ColKey): CellValue | undefined => (cols[k] === undefined ? undefined : r[cols[k]!]);
  const body = rows.slice(headerIdx + 1);

  // Decide DD/MM vs MM/DD from unambiguous text values, then detect Excel auto-conversion.
  let dayFirstVotes = 0;
  let monthFirstVotes = 0;
  let dateObjs = 0;
  let dateObjsDayOver12 = 0;
  for (const r of body) {
    for (const k of ["date", "submittedAt", "closedAt"] as ColKey[]) {
      const v = get(r, k);
      if (typeof v === "string") {
        const m = v.trim().match(/^(\d{1,2})[/.-](\d{1,2})[/.-]\d{2,4}/);
        if (m) {
          if (+m[1] > 12) dayFirstVotes++;
          if (+m[2] > 12) monthFirstVotes++;
        }
      } else if (v instanceof Date && k === "date") {
        dateObjs++;
        if (v.getUTCDate() > 12) dateObjsDayOver12++;
      }
    }
  }
  const dayFirst = monthFirstVotes > dayFirstVotes ? false : true;
  const swapExcelDates = dayFirst && dayFirstVotes > 0 && dateObjs > 0 && dateObjsDayOver12 === 0;
  if (monthFirstVotes > 0 && dayFirstVotes > 0) result.dateNotes.push("File mixes DD/MM and MM/DD text dates; interpreted by majority as " + (dayFirst ? "DD/MM" : "MM/DD") + ".");
  else if (dayFirstVotes > 0) result.dateNotes.push("Text dates are DD/MM/YYYY.");
  if (swapExcelDates) {
    result.dateNotes.push(
      `${dateObjs} date cells were stored by Excel as real dates, all with day ≤ 12, while the text dates are DD/MM. ` +
        `These were auto-converted from DD/MM text, so day and month were swapped back (e.g. Excel 2026-07-09 → 7 Sep 2026).`,
    );
  }

  const toParts = (v: CellValue | undefined, time?: CellValue): DateParts | null => {
    let p: DateParts | null = null;
    if (v instanceof Date) {
      p = fromDateObj(v);
      if (swapExcelDates && p.d <= 12) p = { ...p, m: p.d, d: p.m };
    } else if (typeof v === "number" && v > 20000 && v < 80000) {
      const ms = Math.round((v - 25569) * 86400000);
      p = fromDateObj(new Date(ms));
    } else if (typeof v === "string") p = parseTextDate(v, dayFirst);
    if (!valid(p)) return null;
    if (time !== undefined && time !== null && p.hh === 0 && p.mi === 0) {
      if (time instanceof Date) p = { ...p, hh: time.getUTCHours(), mi: time.getUTCMinutes(), ss: time.getUTCSeconds() };
      else if (typeof time === "string") {
        const tm = time.match(/(\d{1,2}):(\d{2})(?::(\d{2}))?/);
        if (tm) p = { ...p, hh: +tm[1], mi: +tm[2], ss: +(tm[3] ?? 0) };
      }
    }
    return p;
  };

  body.forEach((r, i) => {
    const rowNo = headerIdx + 2 + i;
    const nonEmpty = r.some((v) => cellStr(v) !== null);
    if (!nonEmpty) return;
    const orderNo = cellStr(get(r, "orderNumber"));
    if (orderNo && /^total/i.test(orderNo)) {
      result.skipped.push({ row: rowNo, reason: "Totals row" });
      return;
    }
    const itemsText = cellStr(get(r, "items"));
    const dateP = toParts(get(r, "date"));
    const submittedP = toParts(get(r, "submittedAt")) ?? (dateP ? toParts(get(r, "date"), get(r, "time")) : null);
    if (!itemsText) {
      result.skipped.push({ row: rowNo, reason: "No items" });
      return;
    }
    const bd = dateP ?? submittedP;
    if (!bd) {
      result.skipped.push({ row: rowNo, reason: `Unreadable date "${cellStr(get(r, "date")) ?? ""}"` });
      return;
    }
    const warnings: string[] = [];
    if (dateP && submittedP && isoDate(dateP) !== isoDate(submittedP)) warnings.push(`Date column ${isoDate(dateP)} differs from Submitted At ${isoDate(submittedP)}; using the Date column.`);
    const closedP = toParts(get(r, "closedAt"));
    const uuid = cellStr(get(r, "orderUuid"));
    const raw: Record<string, string | null> = {};
    header.forEach((h, idx) => {
      if (h) raw[h] = cellStr(r[idx]);
    });
    const payRaw = cellStr(get(r, "paymentMethod"));
    const payments = payRaw
      ? payRaw
          .toLowerCase()
          .split(/[,/+&]/)
          .map((s) => s.trim())
          .filter(Boolean)
      : [];
    const totalSales = money(get(r, "totalSales"));
    const status = (cellStr(get(r, "status")) ?? "unknown").toLowerCase();
    const businessDate = isoDate(bd);
    const orderKey = uuid ?? `fp:${sha([orderNo, businessDate, submittedP ? isoStamp(submittedP) : "", itemsText, totalSales].join("|")).slice(0, 32)}`;
    const items = parseItems(itemsText);
    const itemCount = money(get(r, "itemCount"));
    const qtySum = items.reduce((a, b) => a + b.qty, 0);
    if (itemCount !== null && Number(itemCount) !== qtySum) warnings.push(`Item Count ${itemCount} differs from the ${qtySum} items listed.`);
    if (!uuid) warnings.push("No Order UUID; duplicate detection uses a fingerprint of order number, time, items and total.");
    const staffRaw = (cellStr(get(r, "staffMeal")) ?? "").toLowerCase();
    const spotType = cellStr(get(r, "spotType"))?.toLowerCase() ?? null;

    result.orders.push({
      orderKey,
      keySource: uuid ? "uuid" : "fingerprint",
      orderUuid: uuid,
      orderNumber: orderNo,
      businessDate,
      submittedAt: submittedP ? isoStamp(submittedP) : null,
      closedAt: closedP ? isoStamp(closedP) : null,
      spotType,
      spotLabel: cellStr(get(r, "spotLabel")),
      deliveryApp: cellStr(get(r, "deliveryApp")),
      orderReference: cellStr(get(r, "orderReference")),
      servedBy: cellStr(get(r, "servedBy")),
      status,
      staffMeal: ["yes", "true", "1", "y"].includes(staffRaw) || spotType === "staff_meal",
      staffMealFor: cellStr(get(r, "staffMealFor")),
      itemsText,
      itemCount: itemCount === null ? null : Number(itemCount),
      totalSales,
      discountPct: money(get(r, "discountPct")),
      discountAmount: money(get(r, "discountAmount")),
      subtotalAfterDiscount: money(get(r, "subtotalAfterDiscount")),
      vat: money(get(r, "vat")),
      salesAfterDiscount: money(get(r, "salesAfterDiscount")),
      paid: money(get(r, "paid")),
      refunded: money(get(r, "refunded")),
      netReceived: money(get(r, "netReceived")),
      paymentRaw: payRaw,
      paymentMethods: payments,
      voidReason: cellStr(get(r, "voidReason")),
      lines: items.map((it, n) => ({ ...it, lineNo: n + 1, lineKey: `${orderKey}#${n + 1}` })),
      sourceRow: rowNo,
      raw,
      warnings,
    });
  });

  const seen = new Map<string, { row: number; n: number }>();
  for (const o of result.orders) {
    const prev = seen.get(o.orderKey);
    if (!prev) {
      seen.set(o.orderKey, { row: o.sourceRow, n: 1 });
      continue;
    }
    prev.n += 1;
    if (o.keySource === "uuid") {
      o.repeatOf = prev.row;
      o.warnings.push(`Same Order UUID appears again in this file (row ${prev.row}); only the first copy is imported.`);
    } else {
      o.orderKey = `${o.orderKey}~${prev.n}`;
      o.lines = o.lines.map((l) => ({ ...l, lineKey: `${o.orderKey}#${l.lineNo}` }));
      o.repeatOf = prev.row;
      o.warnings.push(`Identical to row ${prev.row} (no Order UUID). Review whether this is a separate sale before importing it.`);
    }
  }
  return result;
}

export async function parseSalesFile(buffer: Buffer, fileName: string): Promise<SalesParseResult> {
  const sha256 = createHash("sha256").update(buffer).digest("hex");
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xlsm")) {
    const sheets = await loadWorkbook(buffer);
    let best: SalesParseResult | null = null;
    for (const s of sheets) {
      const rows: CellValue[][] = [];
      for (let r = 1; r <= s.rowCount; r++) {
        const row: CellValue[] = [];
        for (let c = 1; c <= s.colCount; c++) row.push(s.cell(r, c).v);
        rows.push(row);
      }
      const res = parseSalesRows(rows, { fileName, sha256, format: "xlsx", sheetName: s.name });
      if (res.errors.length === 0 && (!best || res.orders.length > best.orders.length)) best = res;
    }
    return best ?? { fileName, sha256, format: "xlsx", sheetName: null, headerRow: 0, columns: {}, missingColumns: [], orders: [], skipped: [], dateNotes: [], errors: ["No sheet with Date, Items and Total Sales columns was found."] };
  }
  const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
  const parsed = Papa.parse<string[]>(text, { skipEmptyLines: false });
  return parseSalesRows(parsed.data as CellValue[][], { fileName, sha256, format: "csv", sheetName: null });
}
