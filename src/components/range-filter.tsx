import Link from "next/link";
import type { ResolvedRange } from "@/lib/server/range";

const PRESETS = [
  { key: "today", label: "Today" },
  { key: "yesterday", label: "Yesterday" },
  { key: "week", label: "This week" },
  { key: "month", label: "This month" },
] as const;

/** Plain GET links/forms so filters work without client JavaScript and are shareable. */
export function RangeFilter({ r, base, extra = {} }: { r: ResolvedRange; base: string; extra?: Record<string, string> }) {
  const keep = new URLSearchParams(extra).toString();
  const hidden = Object.entries(extra).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />);
  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex overflow-hidden rounded-lg ring-1 ring-cream-deep">
        {PRESETS.map((p) => (
          <Link
            key={p.key}
            href={`${base}?${keep ? `${keep}&` : ""}preset=${p.key}&date=${r.anchor}`}
            className={`px-3 py-1.5 text-xs font-semibold ${r.preset === p.key ? "bg-brown text-cream" : "bg-white text-brown hover:bg-cream"}`}
          >
            {p.label}
          </Link>
        ))}
      </div>
      <form method="get" action={base} className="flex flex-wrap items-center gap-1 text-xs">
        {hidden}
        <input type="hidden" name="preset" value={r.preset === "custom" ? "today" : r.preset} />
        <label className="sr-only" htmlFor="anchor">
          Reference date
        </label>
        <input id="anchor" type="date" name="date" defaultValue={r.anchor} className="input w-auto py-1 text-xs" />
        <button className="btn btn-ghost btn-sm">Go</button>
      </form>
      <form method="get" action={base} className="flex flex-wrap items-center gap-1 text-xs">
        {hidden}
        <input type="hidden" name="preset" value="custom" />
        <input type="date" name="from" aria-label="From" defaultValue={r.from} className="input w-auto py-1 text-xs" />
        <span>–</span>
        <input type="date" name="to" aria-label="To" defaultValue={r.to} className="input w-auto py-1 text-xs" />
        <button className={`btn btn-sm ${r.preset === "custom" ? "btn-olive" : "btn-ghost"}`}>Custom</button>
      </form>
    </div>
  );
}
