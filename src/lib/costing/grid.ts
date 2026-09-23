import ExcelJS from "exceljs";

export type CellValue = string | number | boolean | Date | null;
export type CellData = { v: CellValue; f: string | null; error: string | null };

export type SheetGrid = {
  name: string;
  state: string;
  rowCount: number;
  colCount: number;
  cell(row: number, col: number): CellData;
};

const EMPTY: CellData = { v: null, f: null, error: null };

function toCellData(cell: ExcelJS.Cell): CellData {
  const raw = cell.value;
  if (raw === null || raw === undefined) return EMPTY;
  if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") return { v: raw, f: null, error: null };
  if (raw instanceof Date) return { v: raw, f: null, error: null };
  if (typeof raw === "object") {
    if ("formula" in raw || "sharedFormula" in raw) {
      const result = (raw as ExcelJS.CellFormulaValue).result;
      const formula = cell.formula ?? null;
      if (result && typeof result === "object" && "error" in result) return { v: null, f: formula, error: String(result.error) };
      if (typeof result === "string" && result.startsWith("#")) return { v: null, f: formula, error: result };
      return { v: (result as CellValue) ?? null, f: formula, error: null };
    }
    if ("richText" in raw) return { v: raw.richText.map((t) => t.text).join(""), f: null, error: null };
    if ("error" in raw) return { v: null, f: null, error: String(raw.error) };
    if ("text" in raw) return { v: String((raw as { text: unknown }).text), f: null, error: null };
  }
  return { v: String(raw), f: null, error: null };
}

export async function loadWorkbook(buffer: ArrayBuffer | Buffer): Promise<SheetGrid[]> {
  const wb = new ExcelJS.Workbook();
  // exceljs' type for load() lags behind Node's Buffer generics.
  await wb.xlsx.load(buffer as unknown as ArrayBuffer);
  return wb.worksheets.map((ws) => ({
    name: ws.name,
    state: ws.state,
    rowCount: ws.rowCount,
    colCount: ws.columnCount,
    cell: (row: number, col: number) => toCellData(ws.getCell(row, col)),
  }));
}

export function colLetter(col: number): string {
  let s = "";
  let n = col;
  while (n > 0) {
    const m = (n - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}

export function colIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

export function addr(sheet: string, row: number, col: number): string {
  return `${sheet}!${colLetter(col)}${row}`;
}

export function text(c: CellData): string | null {
  if (c.v === null || c.v === undefined) return null;
  if (c.v instanceof Date) return c.v.toISOString();
  const s = String(c.v).trim();
  return s === "" ? null : s;
}

/** Numeric value of a cell; `invalid` is true when the cell holds non-numeric text. */
export function num(c: CellData): { value: number | null; invalid: boolean } {
  if (c.error) return { value: null, invalid: true };
  if (typeof c.v === "number") return { value: Number.isFinite(c.v) ? c.v : null, invalid: !Number.isFinite(c.v) };
  if (typeof c.v === "string") {
    const s = c.v.trim();
    if (s === "") return { value: null, invalid: true };
    const n = Number(s.replace(/,/g, ""));
    return Number.isFinite(n) ? { value: n, invalid: false } : { value: null, invalid: true };
  }
  return { value: null, invalid: false };
}

export type FormulaRef = { sheet: string | null; col: string; row: number };

/** Extracts A1-style single-cell references (ignores whole-column ranges like $J:$J). */
export function formulaRefs(formula: string): FormulaRef[] {
  const out: FormulaRef[] = [];
  const re = /(?:(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!)?\$?([A-Z]{1,3})\$?(\d+)(?![\d(A-Za-z])/g;
  for (const m of formula.matchAll(re)) {
    const sheet = m[1] ? m[1].replace(/''/g, "'") : m[2] ?? null;
    out.push({ sheet, col: m[3], row: Number(m[4]) });
  }
  return out;
}

export function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export function nameVariants(s: string): string[] {
  const full = normName(s);
  const noParens = normName(s.replace(/\(.*?\)|\[.*?\]/g, " "));
  const beforeParen = normName(s.split(/[([]/)[0]);
  return [...new Set([full, noParens, beforeParen].filter(Boolean))];
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  const dp = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let prev = dp[0];
    dp[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = dp[j];
      dp[j] = Math.min(dp[j] + 1, dp[j - 1] + 1, prev + (a[i - 1] === b[j - 1] ? 0 : 1));
      prev = tmp;
    }
  }
  return dp[b.length];
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .replace(/\(.*?\)/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

/** Finds a header row by label patterns within the first rows of a sheet. */
export function findHeader<K extends string>(
  sheet: SheetGrid,
  spec: Record<K, RegExp>,
  required: NoInfer<K>[],
  maxRow = 15,
): { row: number; cols: Partial<Record<K, number>> } | null {
  for (let r = 1; r <= Math.min(maxRow, sheet.rowCount); r++) {
    const cols: Partial<Record<K, number>> = {};
    for (let c = 1; c <= Math.max(sheet.colCount, 30); c++) {
      const t = text(sheet.cell(r, c));
      if (!t) continue;
      for (const key of Object.keys(spec) as K[]) {
        if (cols[key] === undefined && spec[key].test(t)) {
          cols[key] = c;
          break;
        }
      }
    }
    if (required.every((k) => cols[k] !== undefined)) return { row: r, cols };
  }
  return null;
}
