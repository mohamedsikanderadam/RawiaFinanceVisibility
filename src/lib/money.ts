import Decimal from "decimal.js";

Decimal.set({ precision: 40, rounding: Decimal.ROUND_HALF_UP });

export { Decimal };
export type Dec = Decimal;

export const ZERO = new Decimal(0);

export function D(v: Decimal.Value | null | undefined): Decimal {
  if (v === null || v === undefined || v === "") return ZERO;
  return new Decimal(v);
}

export function sum(values: Iterable<Decimal>): Decimal {
  let t = ZERO;
  for (const v of values) t = t.plus(v);
  return t;
}

/** Full-precision string used for persistence (never rounded). */
export function exact(v: Decimal): string {
  return v.toString();
}

export function round2(v: Decimal.Value): number {
  return new Decimal(v).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
}

const aed = new Intl.NumberFormat("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function fmtAed(v: Decimal.Value | null | undefined, opts: { sign?: boolean } = {}): string {
  if (v === null || v === undefined) return "—";
  const n = round2(v);
  const s = aed.format(Math.abs(n));
  const neg = n < 0 ? "−" : opts.sign && n > 0 ? "+" : "";
  return `${neg}AED ${s}`;
}

export function fmtNum(v: Decimal.Value | null | undefined, dp = 2): string {
  if (v === null || v === undefined) return "—";
  const d = new Decimal(v);
  return new Intl.NumberFormat("en-AE", { minimumFractionDigits: 0, maximumFractionDigits: dp }).format(d.toNumber());
}

export function fmtPct(v: Decimal.Value | null | undefined, dp = 1): string {
  if (v === null || v === undefined) return "—";
  return `${new Decimal(v).times(100).toDecimalPlaces(dp).toNumber().toFixed(dp)}%`;
}
