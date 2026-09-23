import { readFileSync } from "node:fs";
import path from "node:path";
import PDFDocument from "pdfkit";
import { fmtDate, fmtRange, fmtStamp } from "../dates";
import { BUCKET_LABEL, type Bucket, type Metric } from "../engine/types";
import { D, fmtAed, fmtNum, fmtPct, sum } from "../money";
import { METRIC_GROUPS, groupKeys } from "../report";
import { REPORT_STATUS_LABEL, type ReportData } from "./report";

const C = { red: "#b63a2b", cream: "#f5f0e8", creamDeep: "#e8dfd0", olive: "#6e7a3a", brown: "#311f15", dark: "#151400", soft: "#6b5d52", amber: "#b7791f" };
const STATUS_TEXT: Record<Metric["status"], string> = { confirmed: "confirmed", calculated: "calculated", estimate: "estimate", incomplete: "INCOMPLETE", unavailable: "not available" };
const STATUS_COLOR: Record<Metric["status"], string> = { confirmed: C.olive, calculated: C.soft, estimate: C.amber, incomplete: C.red, unavailable: C.soft };

const PAGE = { w: 595.28, h: 841.89, m: 36 };
const BOTTOM = PAGE.h - 48;

const REPLACE: Record<string, string> = { "≠": "vs", "→": "->", "≥": ">=", "≤": "<=", "ⓘ": "", "−": "-", "✓": "", "✗": "x", "Σ": "Sum of", "…": "..." };
const WIN_ANSI_EXTRA = new Set("€‚ƒ„…†‡ˆ‰Š‹ŒŽ‘’“”•–—˜™š›œžŸ");

/** Standard PDF fonts only cover WinAnsi; map anything else to a readable ASCII form. */
function t(s: string): string {
  let out = "";
  for (const ch of s) {
    if (ch in REPLACE) out += REPLACE[ch];
    else if (ch.charCodeAt(0) < 256 || WIN_ANSI_EXTRA.has(ch)) out += ch;
    else out += "?";
  }
  return out;
}

function money(v: string | null | undefined): string {
  return v === null || v === undefined ? "n/a" : fmtAed(v);
}

let logo: { vb: number[]; paths: string[] } | null = null;
function loadLogo() {
  if (logo) return logo;
  const svg = readFileSync(path.join(process.cwd(), "public", "rawia-logo-cream.svg"), "utf8");
  const vb = (svg.match(/viewBox="([^"]+)"/)?.[1] ?? "0 0 100 100").split(/\s+/).map(Number);
  const paths = [...svg.matchAll(/\sd="([^"]+)"/g)].map((m) => m[1]);
  logo = { vb, paths };
  return logo;
}

type Col = { label: string; w: number; align?: "left" | "right" };
type Cell = string | { text: string; color?: string; bold?: boolean };

class Doc {
  doc: PDFKit.PDFDocument;
  title: string;
  sub: string;
  constructor(title: string, sub: string) {
    this.doc = new PDFDocument({ size: "A4", margins: { top: PAGE.m, bottom: 20, left: PAGE.m, right: PAGE.m }, bufferPages: true, info: { Title: `RAWIA CAFE ${title} ${sub}`, Author: "RAWIA Financial Controller" } });
    this.title = title;
    this.sub = sub;
    this.header();
  }

  get y() {
    return this.doc.y;
  }

  header() {
    const d = this.doc;
    d.rect(0, 0, PAGE.w, 70).fill(C.red);
    const L = loadLogo();
    const h = 38;
    const s = h / L.vb[3];
    d.save();
    d.translate(PAGE.m, 16).scale(s).translate(-L.vb[0], -L.vb[1]);
    for (const p of L.paths) d.path(p).fill(C.cream);
    d.restore();
    d.fillColor(C.cream).font("Helvetica-Bold").fontSize(15).text(t(this.title.toUpperCase()), PAGE.m, 20, { width: PAGE.w - 2 * PAGE.m, align: "right" });
    d.font("Helvetica").fontSize(9).text(t(this.sub), PAGE.m, 40, { width: PAGE.w - 2 * PAGE.m, align: "right" });
    d.fillColor(C.dark);
    d.y = 86;
    d.x = PAGE.m;
  }

  newPage() {
    this.doc.addPage();
    this.header();
  }

  ensure(h: number) {
    if (this.doc.y + h > BOTTOM) this.newPage();
  }

  section(title: string, note?: string) {
    this.ensure(60);
    const d = this.doc;
    d.moveDown(0.6);
    d.fillColor(C.red).font("Helvetica-Bold").fontSize(11).text(t(title.toUpperCase()), PAGE.m, d.y, { characterSpacing: 0.5 });
    if (note) d.fillColor(C.soft).font("Helvetica").fontSize(8).text(t(note), { width: PAGE.w - 2 * PAGE.m });
    d.fillColor(C.dark).moveDown(0.3);
  }

  para(text: string, opts: { color?: string; size?: number; bold?: boolean } = {}) {
    const d = this.doc;
    d.font(opts.bold ? "Helvetica-Bold" : "Helvetica").fontSize(opts.size ?? 8.5);
    this.ensure(d.heightOfString(t(text), { width: PAGE.w - 2 * PAGE.m }) + 4);
    d.fillColor(opts.color ?? C.dark).text(t(text), PAGE.m, d.y, { width: PAGE.w - 2 * PAGE.m });
    d.fillColor(C.dark);
  }

  bullets(lines: string[]) {
    for (const l of lines) this.para(`•  ${l}`, { size: 8 });
  }

  tiles(items: { label: string; value: string; note: string; color?: string }[]) {
    const d = this.doc;
    this.ensure(70);
    const gap = 8;
    const w = (PAGE.w - 2 * PAGE.m - gap * (items.length - 1)) / items.length;
    const y = d.y + 4;
    items.forEach((it, i) => {
      const x = PAGE.m + i * (w + gap);
      d.roundedRect(x, y, w, 60, 4).fill(C.cream);
      d.fillColor(C.soft).font("Helvetica-Bold").fontSize(7).text(t(it.label.toUpperCase()), x + 8, y + 8, { width: w - 16 });
      d.fillColor(it.color ?? C.brown).font("Helvetica-Bold").fontSize(15).text(t(it.value), x + 8, y + 20, { width: w - 16 });
      d.fillColor(C.soft).font("Helvetica").fontSize(6.5).text(t(it.note), x + 8, y + 40, { width: w - 16, height: 18, ellipsis: true });
    });
    d.fillColor(C.dark);
    d.y = y + 68;
    d.x = PAGE.m;
  }

  table(cols: Col[], rows: Cell[][], opts: { foot?: Cell[]; size?: number } = {}) {
    const d = this.doc;
    const size = opts.size ?? 7.5;
    const total = cols.reduce((a, c) => a + c.w, 0);
    const scale = (PAGE.w - 2 * PAGE.m) / total;
    const widths = cols.map((c) => c.w * scale);
    const drawHead = () => {
      const y = d.y;
      d.rect(PAGE.m, y, PAGE.w - 2 * PAGE.m, size + 8).fill(C.brown);
      let x = PAGE.m;
      cols.forEach((c, i) => {
        d.fillColor(C.cream).font("Helvetica-Bold").fontSize(size).text(t(c.label), x + 3, y + 4, { width: widths[i] - 6, align: c.align ?? "left", lineBreak: false, ellipsis: true });
        x += widths[i];
      });
      d.y = y + size + 8;
    };
    const drawRow = (r: Cell[], bold: boolean, shade: boolean) => {
      d.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(size);
      const h = Math.max(...r.map((c, i) => d.heightOfString(t(typeof c === "string" ? c : c.text), { width: widths[i] - 6 }))) + 5;
      if (d.y + h > BOTTOM) {
        this.newPage();
        drawHead();
      }
      const y = d.y;
      if (shade) d.rect(PAGE.m, y, PAGE.w - 2 * PAGE.m, h).fill(C.cream);
      if (bold) d.moveTo(PAGE.m, y).lineTo(PAGE.w - PAGE.m, y).lineWidth(0.8).stroke(C.brown);
      let x = PAGE.m;
      r.forEach((c, i) => {
        const cell = typeof c === "string" ? { text: c } : c;
        d.fillColor(cell.color ?? C.dark)
          .font(cell.bold || bold ? "Helvetica-Bold" : "Helvetica")
          .fontSize(size)
          .text(t(cell.text), x + 3, y + 2.5, { width: widths[i] - 6, align: cols[i].align ?? "left" });
        x += widths[i];
      });
      d.y = y + h;
    };
    this.ensure(40);
    drawHead();
    rows.forEach((r, i) => drawRow(r, false, i % 2 === 1));
    if (opts.foot) drawRow(opts.foot, true, false);
    d.fillColor(C.dark);
    d.x = PAGE.m;
    d.moveDown(0.4);
  }

  async finish(): Promise<Buffer> {
    const d = this.doc;
    const range = d.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      d.switchToPage(i);
      d.fillColor(C.soft)
        .font("Helvetica")
        .fontSize(7)
        .text(t(`RAWIA CAFE | ${this.title} | ${this.sub} | AED unless stated otherwise`), PAGE.m, PAGE.h - 32, { width: PAGE.w - 2 * PAGE.m - 60, lineBreak: false });
      d.text(`${i + 1}/${range.count}`, PAGE.w - PAGE.m - 60, PAGE.h - 32, { width: 60, align: "right", lineBreak: false });
    }
    const chunks: Buffer[] = [];
    return new Promise((resolve, reject) => {
      d.on("data", (c: Buffer) => chunks.push(c));
      d.on("end", () => resolve(Buffer.concat(chunks)));
      d.on("error", reject);
      d.end();
    });
  }
}

function statusCell(m: { status: Metric["status"] } | undefined): Cell {
  return m ? { text: STATUS_TEXT[m.status], color: STATUS_COLOR[m.status] } : "";
}

/** Daily EOD report (from === to) or period financial summary. Figures come from the same ReportData as the screens. */
export async function renderReportPdf(r: ReportData): Promise<Buffer> {
  const single = r.from === r.to;
  const s = r.summary;
  const m = s.metrics;
  const view = single ? r.views[0] : null;
  const sub = single ? fmtDate(r.from) : fmtRange(r.from, r.to);
  const pdf = new Doc(single ? "End-of-day report" : "Financial summary", sub);
  const statusLine = single && view?.state === "finalized" ? `FINAL - revision ${view.revision}, finalized ${fmtStamp(view.finalizedAt)} by ${view.finalizedBy ?? "unknown"}` : REPORT_STATUS_LABEL[r.status];
  pdf.para(statusLine, { bold: true, color: r.status === "final" ? C.olive : C.red, size: 9 });
  pdf.para(`Period ${fmtRange(r.from, r.to)} (Asia/Dubai) · Costing ${s.costingLabels.join(", ") || "-"} · Generated ${fmtStamp(r.generatedAt)}`, { color: C.soft, size: 8 });
  if (single && view?.liveDiff) pdf.para(`Note: the live recalculation now differs from this finalized snapshot (reserve ${money(view.liveDiff.reserve)}, net sales ${money(view.liveDiff.netSales)}). Finalize a new revision to adopt it.`, { color: C.amber, size: 8 });

  if (s.daysWithData === 0) {
    pdf.section("No data");
    pdf.para("No sales have been imported for this period.");
    return pdf.finish();
  }

  const val = (k: string) => m[k]?.value ?? null;
  const inc = (k: string) => (m[k]?.status === "incomplete" ? " · INCOMPLETE" : m[k]?.status === "unavailable" ? " · not available" : "");
  pdf.tiles([
    { label: "Net sales incl. VAT", value: money(val("netSalesInclVat")), note: `After discounts and refunds${inc("netSalesInclVat")}` },
    { label: "Replenishment reserve", value: money(val("reserve")), note: `Replace stock consumed${inc("reserve")}`, color: C.red },
    { label: "Gross profit", value: money(val("grossProfit")), note: `Net sales ex VAT - sold COGS - batch${inc("grossProfit")}`, color: C.olive },
    { label: "Est. operating result", value: money(val("operatingResult")), note: `Not cash available${inc("operatingResult")}` },
  ]);

  pdf.section("Financial controller", "Each figure is listed once; its definition and formula are in the appendix.");
  for (const g of METRIC_GROUPS) {
    const rows = groupKeys(g)
      .filter(({ key }) => m[key])
      .map(({ key, mod }) => {
        const x = m[key];
        return [{ text: `${mod === "indent" ? "     " : ""}${x.label}`, bold: mod === "strong" }, { text: x.value === null ? "not available" : money(x.value), bold: mod === "strong" }, statusCell(x)] as Cell[];
      });
    pdf.table([{ label: g.title, w: 60 }, { label: "AED", w: 22, align: "right" }, { label: "Status", w: 18, align: "right" }], rows);
  }

  pdf.section("Money received", "Sales by payment method. Card and aggregator amounts are receivables until settled; missing methods stay unknown, never cash.");
  pdf.table(
    [{ label: "Method", w: 25 }, { label: "Orders", w: 10, align: "right" }, { label: "Amount", w: 18, align: "right" }, { label: "Treatment", w: 47 }],
    s.payments.map((p) => [p.method, String(p.orders), money(p.amount), p.treatment]),
  );
  pdf.table(
    [{ label: "Channel", w: 40 }, { label: "Orders", w: 15, align: "right" }, { label: "Gross", w: 22, align: "right" }, { label: "Net incl. VAT", w: 23, align: "right" }],
    s.channels.map((c) => [c.channel.replace("_", " "), String(c.orders), money(c.gross), money(c.net)]),
  );

  pdf.section(
    "Replenishment by ingredient and packaging",
    "Consumption-based reserve: money needed to replace what was used, including staff meals, complimentary items and wastage. This is not a purchase order or a stock balance.",
  );
  pdf.table(
    [{ label: "Ingredient / packaging", w: 38 }, { label: "Qty", w: 12, align: "right" }, { label: "Unit", w: 8 }, { label: "Unit cost", w: 13, align: "right" }, { label: "Sold", w: 14, align: "right" }, { label: "Other use", w: 14, align: "right" }, { label: "Reserve", w: 15, align: "right" }],
    s.consumption.map((c) => {
      const sold = D(c.byBucket.sold ?? 0);
      return [
        { text: `${c.label}${c.incomplete ? " (cost missing)" : ""}`, color: c.incomplete ? C.red : undefined },
        fmtNum(c.qty, 3),
        c.unit,
        c.unitCost === null ? "missing" : fmtNum(c.unitCost, 4),
        c.unitCost === null ? "-" : fmtAed(sold),
        c.unitCost === null ? "-" : fmtAed(D(c.amount).minus(sold)),
        c.unitCost === null ? { text: "missing", bold: true, color: C.red } : { text: fmtAed(c.amount), bold: true },
      ];
    }),
    { foot: ["Total replenishment reserve", "", "", "", "", "", { text: `${money(val("reserve"))}${inc("reserve")}`, color: m.reserve?.status === "incomplete" ? C.red : undefined }] },
  );
  if (s.karak.batches > 0 || D(s.karak.cups).gt(0))
    pdf.para(`Cane Karak: ${fmtNum(s.karak.cups)} cup(s) from ${s.karak.batches} prepared batch(es) = ${fmtAed(s.karak.cost)} (allocated to batch recipe ${fmtAed(s.karak.allocated)}, unallocated ${fmtAed(s.karak.unallocated)}). No per-cup recipe cost is added.`, { size: 8 });

  pdf.section("Replenishment funding", "How much to set aside, what it is for, and what remains.");
  pdf.table(
    [{ label: "Measure", w: 62 }, { label: "AED", w: 20, align: "right" }, { label: "Status", w: 18, align: "right" }],
    Object.values(r.funding.lines).map((l) => [l.label, l.value === null ? "not available" : money(l.value), statusCell(l)]),
  );

  pdf.section("Menu items", "Revenue ex VAT and cost of sold units; the workbook column is Menu Master cost with packaging × units sold.");
  const recon = new Map(r.recon.rows.map((x) => [x.code, x]));
  pdf.table(
    [{ label: "Item", w: 34 }, { label: "Sold", w: 8, align: "right" }, { label: "S / C / W", w: 14, align: "right" }, { label: "Revenue", w: 13, align: "right" }, { label: "Cost", w: 12, align: "right" }, { label: "Margin", w: 12, align: "right" }, { label: "%", w: 8, align: "right" }, { label: "Workbook", w: 12, align: "right" }],
    s.menuItems.map((x) => {
      const rc = x.menuCode ? recon.get(x.menuCode) : undefined;
      return [
        { text: `${x.name}${x.incomplete ? " (incomplete)" : ""}`, color: x.incomplete ? C.red : undefined },
        fmtNum(x.soldQty),
        `${fmtNum(x.staffQty)}/${fmtNum(x.compQty)}/${fmtNum(x.wasteQty)}`,
        fmtAed(x.revenueExVat),
        fmtAed(x.soldCost),
        fmtAed(x.margin),
        x.marginPct === null ? "-" : fmtPct(x.marginPct),
        rc?.workbookCost ? fmtAed(rc.workbookCost) : "-",
      ];
    }),
  );
  pdf.para(`S / C / W = staff meal / complimentary / wastage servings (not in sold-item cost). Workbook reconciliation: app ${fmtAed(r.recon.appTotal)} vs workbook ${fmtAed(r.recon.workbookTotal)}, difference ${fmtAed(r.recon.diffTotal)}.`, { size: 8, color: D(r.recon.diffTotal).abs().gte(0.01) ? C.red : C.olive });

  const buckets: Bucket[] = ["staff", "complimentary", "wastage", "refund_loss", "manual"];
  const ns = s.nonSales;
  if (ns.length) {
    pdf.section("Staff meals, complimentary and wastage", "Zero-revenue consumption: in the reserve and the operating result, not in sold-item COGS.");
    pdf.table(
      [{ label: "Use", w: 25 }, { label: "Records", w: 15, align: "right" }, { label: "Cost", w: 20, align: "right" }, { label: "Missing costs", w: 40 }],
      buckets
        .map((b) => ({ b, rows: ns.filter((x) => x.bucket === b) }))
        .filter((x) => x.rows.length)
        .map(({ b, rows }) => [BUCKET_LABEL[b], String(rows.length), fmtAed(sum(rows.map((x) => D(x.amount ?? 0)))), rows.some((x) => x.amount === null) ? { text: "yes - total incomplete", color: C.red } : "none"]),
    );
  }

  if (!single) {
    pdf.section("Daily totals");
    pdf.table(
      [{ label: "Date", w: 20 }, { label: "State", w: 16 }, { label: "Net sales", w: 16, align: "right" }, { label: "COGS", w: 16, align: "right" }, { label: "Reserve", w: 16, align: "right" }, { label: "Op. result", w: 16, align: "right" }],
      s.days.map((x) => [x.date, `${x.state === "finalized" ? `final r${x.revision}` : x.state}${x.incomplete ? " *" : ""}`, money(x.netSales), money(x.cogs), money(x.reserve), money(x.operatingResult)]),
      { foot: ["Total", "", money(val("netSales")), money(val("cogsSold")), money(val("reserve")), money(val("operatingResult"))] },
    );
    pdf.para("* incomplete: at least one cost or rate is missing on that day.", { size: 7, color: C.soft });
  }

  const issues = s.issues.filter((i) => i.severity !== "info");
  pdf.section(`Unresolved issues (${issues.length})`);
  if (!issues.length) pdf.para("None.", { color: C.olive });
  else pdf.table([{ label: "Date", w: 14 }, { label: "Severity", w: 12 }, { label: "Issue", w: 74 }], issues.map((i) => [i.date, { text: i.severity, color: i.severity === "error" ? C.red : C.amber }, i.message]));

  if (r.revisions.length) {
    pdf.section("Finalization and revision history");
    pdf.table(
      [{ label: "Date", w: 14 }, { label: "Rev", w: 6, align: "right" }, { label: "Finalized", w: 22 }, { label: "By", w: 14 }, { label: "State", w: 16 }, { label: "Reason", w: 28 }],
      r.revisions.map((x) => [x.date, String(x.revision), fmtStamp(x.finalizedAt), x.name ?? "-", x.supersededAt ? `superseded ${fmtStamp(x.supersededAt)}` : "current", x.reason]),
    );
  }

  pdf.section("Assumptions");
  for (const a of r.assumptions) {
    pdf.para(a.label, { bold: true, size: 8 });
    pdf.bullets(a.lines);
  }

  pdf.section("Appendix: metric definitions");
  pdf.table(
    [{ label: "Metric", w: 22 }, { label: "Definition", w: 42 }, { label: "Calculation", w: 36 }],
    METRIC_GROUPS.flatMap((g) => groupKeys(g))
      .filter(({ key }) => m[key])
      .map(({ key }) => [m[key].label, [m[key].definition, ...m[key].notes].join(" "), m[key].formula]),
    { size: 6.5 },
  );

  return pdf.finish();
}
