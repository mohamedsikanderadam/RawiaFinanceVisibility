import ExcelJS from "exceljs";
import { fmtRange, fmtStamp } from "../dates";
import { BUCKETS, BUCKET_LABEL, type Bucket } from "../engine/types";
import { D } from "../money";
import { METRIC_GROUPS, groupKeys, type ReportKind } from "../report";
import { ordersBetween } from "./day";
import { REPORT_STATUS_LABEL, type ReportData } from "./report";

export type XlsxKind = ReportKind | "full";

const RED = "FFB63A2B";
const CREAM = "FFF5F0E8";
const BROWN = "FF311F15";
const AED = "#,##0.00";

type V = string | number | null;

/** Decimal strings become numbers for Excel; full precision stays in the "exact" columns where it matters. */
function n(v: string | null | undefined): number | null {
  return v === null || v === undefined ? null : D(v).toNumber();
}

function sheet(wb: ExcelJS.Workbook, name: string, cols: { header: string; width: number; money?: boolean; exact?: boolean }[], rows: V[][], opts: { total?: V[] } = {}) {
  const ws = wb.addWorksheet(name, { views: [{ state: "frozen", ySplit: 1 }] });
  ws.columns = cols.map((c) => ({ header: c.header, width: c.width, style: c.money ? { numFmt: AED } : c.exact ? { numFmt: "0.00000####" } : {} }));
  const head = ws.getRow(1);
  head.font = { bold: true, color: { argb: CREAM } };
  head.fill = { type: "pattern", pattern: "solid", fgColor: { argb: BROWN } };
  for (const r of rows) ws.addRow(r);
  if (opts.total) {
    const row = ws.addRow(opts.total);
    row.font = { bold: true };
    row.border = { top: { style: "thin" } };
  }
  ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: cols.length } };
  return ws;
}

function infoSheet(wb: ExcelJS.Workbook, r: ReportData, title: string) {
  const ws = wb.addWorksheet("Report info");
  ws.columns = [{ width: 34 }, { width: 110 }];
  const t = ws.addRow([`RAWIA CAFE – ${title}`]);
  t.font = { bold: true, size: 14, color: { argb: RED } };
  const add = (k: string, v: string) => {
    const row = ws.addRow([k, v]);
    row.getCell(1).font = { bold: true };
    row.getCell(2).alignment = { wrapText: true, vertical: "top" };
  };
  add("Period", `${fmtRange(r.from, r.to)} (${r.from} to ${r.to}, Asia/Dubai)`);
  add("Status", REPORT_STATUS_LABEL[r.status]);
  add("Days with sales / finalized", `${r.summary.daysWithData} / ${r.summary.finalizedDays}`);
  add("Costing version(s)", r.summary.costingLabels.join(", ") || "—");
  add("Generated", fmtStamp(r.generatedAt));
  add("Currency", "AED. Amounts are rounded to 2 decimals for display; calculations keep full precision.");
  add("Reserve vs purchasing", "Replenishment reserve is money needed to replace stock consumed. It is not a purchase order or a stock balance.");
  ws.addRow([]);
  ws.addRow(["Assumptions"]).font = { bold: true, color: { argb: RED } };
  for (const a of r.assumptions) {
    add(a.label, a.lines.join("\n"));
  }
  ws.addRow([]);
  const issues = r.summary.issues.filter((i) => i.severity !== "info");
  ws.addRow([`Unresolved issues (${issues.length})`]).font = { bold: true, color: { argb: RED } };
  for (const i of issues) add(`${i.date} ${i.severity}`, i.message);
  if (r.revisions.length) {
    ws.addRow([]);
    ws.addRow(["Finalization history"]).font = { bold: true, color: { argb: RED } };
    for (const x of r.revisions) add(`${x.date} revision ${x.revision}`, `${fmtStamp(x.finalizedAt)} by ${x.name ?? "?"} – ${x.supersededAt ? `superseded ${fmtStamp(x.supersededAt)}` : "current"} – ${x.reason}`);
  }
}

function summarySheets(wb: ExcelJS.Workbook, r: ReportData) {
  const m = r.summary.metrics;
  const rows: V[][] = [];
  for (const g of METRIC_GROUPS) {
    for (const { key } of groupKeys(g)) {
      const x = m[key];
      if (!x) continue;
      rows.push([g.title, x.label, n(x.value), x.value, x.status, x.definition, x.formula, x.notes.join(" ")]);
    }
  }
  sheet(
    wb,
    "Summary",
    [
      { header: "Group", width: 30 },
      { header: "Metric", width: 34 },
      { header: "AED", width: 14, money: true },
      { header: "Exact value", width: 22 },
      { header: "Status", width: 12 },
      { header: "Definition", width: 60 },
      { header: "Calculation", width: 60 },
      { header: "Notes", width: 50 },
    ],
    rows,
  );
  sheet(
    wb,
    "Waterfall",
    [
      { header: "Step", width: 30 },
      { header: "Type", width: 10 },
      { header: "AED", width: 14, money: true },
      { header: "Status", width: 12 },
    ],
    r.summary.waterfall.map((w) => [w.label, w.kind, n(w.kind === "minus" ? D(w.value).neg().toString() : w.value), w.status]),
  );
  sheet(
    wb,
    "Funding",
    [
      { header: "Measure", width: 40 },
      { header: "AED", width: 14, money: true },
      { header: "Status", width: 12 },
      { header: "Definition", width: 80 },
    ],
    Object.values(r.funding.lines).map((l) => [l.label, n(l.value), l.status, [l.definition, ...l.notes].join(" ")]),
  );
  sheet(
    wb,
    "Payments & channels",
    [
      { header: "Type", width: 10 },
      { header: "Name", width: 22 },
      { header: "Orders", width: 10 },
      { header: "Amount / gross", width: 16, money: true },
      { header: "Net incl. VAT", width: 16, money: true },
      { header: "Treatment", width: 70 },
    ],
    [...r.summary.payments.map((p) => ["payment", p.method, p.orders, n(p.amount), null, p.treatment] as V[]), ...r.summary.channels.map((c) => ["channel", c.channel, c.orders, n(c.gross), n(c.net), ""] as V[])],
  );
  sheet(
    wb,
    "Daily",
    [
      { header: "Date", width: 12 },
      { header: "State", width: 12 },
      { header: "Revision", width: 9 },
      { header: "Costing", width: 30 },
      { header: "Net sales", width: 14, money: true },
      { header: "COGS sold", width: 14, money: true },
      { header: "Reserve", width: 14, money: true },
      { header: "Est. operating result", width: 18, money: true },
      { header: "Incomplete", width: 11 },
    ],
    r.summary.days.map((d) => [d.date, d.state, d.revision, d.costingLabel, n(d.netSales), n(d.cogs), n(d.reserve), n(d.operatingResult), d.incomplete ? "yes" : ""]),
    { total: ["Total", "", null, "", n(m.netSales?.value), n(m.cogsSold?.value), n(m.reserve?.value), n(m.operatingResult?.value), m.reserve?.status === "incomplete" ? "yes" : ""] },
  );
}

function replenishmentSheets(wb: ExcelJS.Workbook, r: ReportData) {
  const used = BUCKETS.filter((b) => r.summary.consumption.some((c) => c.byBucket[b]));
  sheet(
    wb,
    "Replenishment",
    [
      { header: "Ingredient / packaging", width: 36 },
      { header: "Item key", width: 18 },
      { header: "Type", width: 12 },
      { header: "Qty consumed", width: 14, exact: true },
      { header: "Unit", width: 8 },
      { header: "Unit cost", width: 14, exact: true },
      ...used.map((b) => ({ header: BUCKET_LABEL[b], width: 14, money: true })),
      { header: "Reserve AED", width: 14, money: true },
      { header: "Reserve exact", width: 22 },
      { header: "Cost status", width: 14 },
    ],
    r.summary.consumption.map((c) => [c.label, c.itemKey, c.kind, n(c.qty), c.unit, n(c.unitCost), ...used.map((b) => n(c.byBucket[b] ?? null)), n(c.amount), c.amount, c.incomplete ? "MISSING COST" : "ok"]),
    { total: ["Total replenishment reserve", "", "", null, "", null, ...used.map((b) => n(r.summary.consumption.reduce((a, c) => a.plus(c.byBucket[b] ?? 0), D(0)).toString())), n(r.summary.metrics.reserve?.value), r.summary.metrics.reserve?.value ?? "", r.summary.metrics.reserve?.status ?? ""] },
  );
  lineageSheet(
    wb,
    "Lineage",
    r.views.flatMap((v) => (v.result?.records ?? []).map((x) => ({ ...x, date: v.date }))),
  );
}

function lineageSheet(wb: ExcelJS.Workbook, name: string, rows: (ReportData["summary"]["nonSales"][number])[]) {
  sheet(
    wb,
    name,
    [
      { header: "Date", width: 12 },
      { header: "Source", width: 12 },
      { header: "Order #", width: 10 },
      { header: "Order / line key", width: 40 },
      { header: "Adjustment", width: 11 },
      { header: "POS item", width: 30 },
      { header: "Menu code", width: 12 },
      { header: "Use", width: 16 },
      { header: "Ingredient / packaging", width: 34 },
      { header: "Servings", width: 10, exact: true },
      { header: "Qty", width: 12, exact: true },
      { header: "Unit", width: 8 },
      { header: "Unit cost", width: 12, exact: true },
      { header: "Amount", width: 12, money: true },
      { header: "Recipe path", width: 60 },
    ],
    rows.map((x) => [
      x.date,
      x.origin.type,
      x.origin.orderNumber ?? null,
      x.origin.lineKey ?? x.origin.orderKey ?? null,
      x.origin.adjustmentId ?? null,
      x.origin.posName ?? null,
      x.origin.menuCode ?? null,
      BUCKET_LABEL[x.bucket],
      x.label,
      n(x.origin.servings),
      n(x.qty),
      x.unit,
      n(x.unitCost),
      x.amount === null ? "MISSING" : n(x.amount),
      x.path.join(" > "),
    ]),
  );
}

function menuSheet(wb: ExcelJS.Workbook, r: ReportData) {
  const recon = new Map(r.recon.rows.map((x) => [x.code, x]));
  sheet(
    wb,
    "Menu margins",
    [
      { header: "Menu item", width: 36 },
      { header: "Code", width: 10 },
      { header: "Sold", width: 8 },
      { header: "Staff", width: 8 },
      { header: "Complimentary", width: 13 },
      { header: "Wastage", width: 9 },
      { header: "Revenue ex VAT", width: 15, money: true },
      { header: "Cost of sold", width: 14, money: true },
      { header: "Margin", width: 14, money: true },
      { header: "Margin %", width: 10 },
      { header: "Workbook cost", width: 14, money: true },
      { header: "Difference", width: 13, money: true },
      { header: "Incomplete", width: 11 },
      { header: "Reconciliation note", width: 50 },
    ],
    r.summary.menuItems.map((x) => {
      const rc = x.menuCode ? recon.get(x.menuCode) : undefined;
      return [x.name, x.menuCode, n(x.soldQty), n(x.staffQty), n(x.compQty), n(x.wasteQty), n(x.revenueExVat), n(x.soldCost), n(x.margin), x.marginPct === null ? null : D(x.marginPct).toDecimalPlaces(2).toNumber(), n(rc?.workbookCost), n(rc?.diff), x.incomplete ? "yes" : "", rc?.note ?? ""];
    }),
    { total: ["Comparable total", "", null, null, null, null, null, n(r.recon.appTotal), null, null, n(r.recon.workbookTotal), n(r.recon.diffTotal), "", ""] },
  );
}

function nonSalesSheet(wb: ExcelJS.Workbook, r: ReportData, bucket: Bucket | null) {
  lineageSheet(
    wb,
    "Staff, comp, wastage",
    r.summary.nonSales.filter((x) => !bucket || x.bucket === bucket),
  );
}

function issuesSheet(wb: ExcelJS.Workbook, r: ReportData) {
  sheet(
    wb,
    "Issues",
    [
      { header: "Date", width: 12 },
      { header: "Severity", width: 10 },
      { header: "Code", width: 20 },
      { header: "Issue", width: 100 },
    ],
    r.summary.issues.map((i) => [i.date, i.severity, i.code, i.message]),
  );
}

async function ordersSheet(wb: ExcelJS.Workbook, r: ReportData) {
  const orders = await ordersBetween(r.from, r.to);
  sheet(
    wb,
    "Orders",
    [
      { header: "Business date", width: 12 },
      { header: "Order #", width: 9 },
      { header: "Order key", width: 40 },
      { header: "Key source", width: 11 },
      { header: "Submitted", width: 20 },
      { header: "Status", width: 10 },
      { header: "Channel", width: 14 },
      { header: "Staff meal", width: 10 },
      { header: "Items", width: 50 },
      { header: "Total sales", width: 12, money: true },
      { header: "Discount", width: 12, money: true },
      { header: "VAT", width: 10, money: true },
      { header: "Sales after discount", width: 14, money: true },
      { header: "Paid", width: 12, money: true },
      { header: "Refunded", width: 12, money: true },
      { header: "Payment", width: 20 },
      { header: "Import #", width: 9 },
    ],
    orders.map((o) => [o.businessDate, o.orderNumber, o.orderKey, o.keySource, o.submittedAt, o.status, o.deliveryApp ?? o.spotType, o.staffMeal ? "yes" : "", o.itemsText, n(o.totalSales), n(o.discountAmount), n(o.vat), n(o.salesAfterDiscount), n(o.paid), n(o.refunded), o.paymentRaw ?? "(missing)", o.lastImportId]),
  );
}

const TITLES: Record<XlsxKind, string> = {
  summary: "Financial summary",
  replenishment: "Ingredient replenishment",
  menu: "Menu-item margins",
  nonsales: "Staff meals, complimentary and wastage",
  issues: "Unresolved issues",
  full: "Full period workbook",
};

export async function renderReportXlsx(r: ReportData, kind: XlsxKind, bucket: Bucket | null = null): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "RAWIA Financial Controller";
  wb.created = new Date(r.generatedAt);
  infoSheet(wb, r, TITLES[kind]);
  if (kind === "summary" || kind === "full") summarySheets(wb, r);
  if (kind === "replenishment" || kind === "full") replenishmentSheets(wb, r);
  if (kind === "menu" || kind === "full") menuSheet(wb, r);
  if (kind === "nonsales" || kind === "full") nonSalesSheet(wb, r, bucket);
  if (kind === "issues" || kind === "full") issuesSheet(wb, r);
  if (kind === "full") await ordersSheet(wb, r);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

export const XLSX_TITLES = TITLES;
