export const TIMEZONE = "Asia/Dubai";
/** Asia/Dubai has no daylight saving; UTC+04:00 all year. */
export const DUBAI_OFFSET = "+04:00";

const dateFmt = new Intl.DateTimeFormat("en-CA", { timeZone: TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" });

export function dubaiToday(now: Date = new Date()): string {
  return dateFmt.format(now);
}

export function isIsoDate(s: string | null | undefined): s is string {
  return !!s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(`${s}T00:00:00Z`));
}

export function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; d <= to && out.length < 1000; d = addDays(d, 1)) out.push(d);
  return out;
}

export function daysInMonth(iso: string): number {
  const [y, m] = iso.split("-").map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

export type RangePreset = "today" | "yesterday" | "week" | "month" | "custom";

/** Week = Monday–Sunday containing the anchor date; month = calendar month to date. */
export function presetRange(preset: RangePreset, anchor: string, custom?: { from?: string; to?: string }): { from: string; to: string } {
  switch (preset) {
    case "yesterday": {
      const y = addDays(anchor, -1);
      return { from: y, to: y };
    }
    case "week": {
      const dow = new Date(`${anchor}T00:00:00Z`).getUTCDay();
      const monday = addDays(anchor, -((dow + 6) % 7));
      return { from: monday, to: anchor };
    }
    case "month":
      return { from: `${anchor.slice(0, 7)}-01`, to: anchor };
    case "custom": {
      const from = isIsoDate(custom?.from) ? custom!.from! : anchor;
      const to = isIsoDate(custom?.to) ? custom!.to! : from;
      return from <= to ? { from, to } : { from: to, to: from };
    }
    default:
      return { from: anchor, to: anchor };
  }
}

export function fmtDate(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

export function fmtRange(from: string, to: string): string {
  return from === to ? fmtDate(from) : `${fmtDate(from)} – ${fmtDate(to)}`;
}

export function fmtStamp(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  return d.toLocaleString("en-GB", { timeZone: TIMEZONE, day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}
