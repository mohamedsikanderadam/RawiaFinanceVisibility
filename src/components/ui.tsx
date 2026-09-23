import Link from "next/link";
import type { Metric } from "@/lib/engine/types";
import { fmtAed } from "@/lib/money";

export type Status = Metric["status"];

const STATUS_STYLE: Record<Status, { cls: string; label: string; hint: string }> = {
  confirmed: { cls: "bg-olive-soft text-olive", label: "Confirmed", hint: "Taken directly from the POS or recorded entries." },
  calculated: { cls: "bg-cream text-brown", label: "Calculated", hint: "Calculated from confirmed inputs and the costing version." },
  estimate: { cls: "bg-amber-soft text-amber", label: "Estimate", hint: "Depends on unconfirmed rates, allocations or assumptions." },
  incomplete: { cls: "bg-red/10 text-red", label: "Incomplete", hint: "Some inputs are missing, so the true figure differs." },
  unavailable: { cls: "bg-dark/10 text-ink-soft", label: "Not available", hint: "The data needed for this figure is missing." },
};

export function StatusBadge({ status, className = "" }: { status: Status; className?: string }) {
  const s = STATUS_STYLE[status];
  return (
    <span title={s.hint} className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${s.cls} ${className}`}>
      {s.label}
    </span>
  );
}

export function Card({ title, action, children, className = "", id }: { title?: React.ReactNode; action?: React.ReactNode; children: React.ReactNode; className?: string; id?: string }) {
  return (
    <section id={id} className={`card ${className}`}>
      {(title || action) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-cream-deep px-4 py-3">
          <h2 className="text-sm font-bold text-brown">{title}</h2>
          {action}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Money({ v, sign, className = "" }: { v: string | null | undefined; sign?: boolean; className?: string }) {
  return <span className={`num whitespace-nowrap ${className}`}>{fmtAed(v ?? null, { sign })}</span>;
}

export function MetricCard({ m, tone = "brown", href, sub }: { m: Metric | undefined; tone?: "red" | "olive" | "brown"; href?: string; sub?: React.ReactNode }) {
  if (!m) return null;
  const color = tone === "red" ? "text-red" : tone === "olive" ? "text-olive" : "text-brown";
  const body = (
    <div className="card h-full p-4 transition hover:ring-olive/40">
      <div className="flex items-start justify-between gap-2">
        <div className="text-xs font-semibold uppercase tracking-wide text-ink-soft">{m.label}</div>
        <StatusBadge status={m.status} />
      </div>
      <div className={`mt-2 text-2xl font-extrabold ${color}`}>
        {m.value === null ? <span className="text-ink-soft">Not available</span> : <Money v={m.value} />}
      </div>
      {sub && <div className="mt-1 text-xs text-ink-soft">{sub}</div>}
      <p className="mt-2 line-clamp-2 text-xs text-ink-soft" title={`${m.definition}\n\nFormula: ${m.formula}`}>
        {m.definition}
      </p>
    </div>
  );
  return href ? (
    <Link href={href} className="block h-full">
      {body}
    </Link>
  ) : (
    body
  );
}

/** Metric table row that exposes the definition and formula. */
export function MetricRow({ m, indent, strong }: { m: Metric | undefined; indent?: boolean; strong?: boolean }) {
  if (!m) return null;
  return (
    <tr>
      <td className={indent ? "pl-8" : ""}>
        <details>
          <summary className={`cursor-pointer list-none ${strong ? "font-bold" : ""}`}>
            {m.label} <span className="text-[10px] text-ink-soft">ⓘ</span>
          </summary>
          <div className="mt-1 max-w-xl text-xs text-ink-soft">
            <p>{m.definition}</p>
            <p className="mt-1 font-mono text-[11px]">= {m.formula}</p>
            {m.notes.map((n) => (
              <p key={n} className="mt-1 text-red">
                {n}
              </p>
            ))}
          </div>
        </details>
      </td>
      <td className="r">
        {m.value === null ? <span className="text-ink-soft">Not available</span> : <Money v={m.value} className={strong ? "font-bold" : ""} />}
      </td>
      <td className="w-28 text-right">
        <StatusBadge status={m.status} />
      </td>
    </tr>
  );
}

export function Alert({ tone, children }: { tone: "error" | "warning" | "info" | "ok"; children: React.ReactNode }) {
  const cls = {
    error: "border-red/30 bg-red/5 text-red-deep",
    warning: "border-amber/30 bg-amber-soft/60 text-brown",
    info: "border-cream-deep bg-cream text-brown",
    ok: "border-olive/30 bg-olive-soft/60 text-brown",
  }[tone];
  return <div className={`rounded-lg border px-3 py-2 text-sm ${cls}`}>{children}</div>;
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="rounded-lg border border-dashed border-cream-deep p-6 text-center text-sm text-ink-soft">{children}</div>;
}

export function PageHeader({ title, sub, actions }: { title: React.ReactNode; sub?: React.ReactNode; actions?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl font-extrabold text-brown">{title}</h1>
        {sub && <div className="mt-1 text-sm text-ink-soft">{sub}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function DayStateBadge({ state, revision }: { state: "no_data" | "live" | "finalized"; revision: number | null }) {
  if (state === "finalized") return <span className="rounded-full bg-olive px-2 py-0.5 text-[10px] font-bold uppercase text-cream">Finalized r{revision}</span>;
  if (state === "live") return <span className="rounded-full bg-amber-soft px-2 py-0.5 text-[10px] font-bold uppercase text-amber">Open{revision ? ` (r${revision} superseded)` : ""}</span>;
  return <span className="rounded-full bg-dark/10 px-2 py-0.5 text-[10px] font-bold uppercase text-ink-soft">No data</span>;
}
