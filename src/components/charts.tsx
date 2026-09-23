"use client";

import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const C = { red: "#b63a2b", cream: "#f5f0e8", olive: "#6e7a3a", brown: "#311f15", dark: "#151400", amber: "#b7791f", grey: "#a39b8f" };
const PALETTE = [C.red, C.olive, C.brown, C.amber, C.grey, "#8e2a1f", "#9aa65a", "#6b4a36"];

const aed = (v: unknown) => `AED ${Number(v ?? 0).toLocaleString("en-AE", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export type TrendPoint = { date: string; label: string; netSales: number | null; reserve: number | null; operatingResult: number | null; incomplete: boolean; state: string };

export function TrendChart({ data }: { data: TrendPoint[] }) {
  const router = useRouter();
  return (
    <div className="h-72 w-full">
      <ResponsiveContainer>
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, left: 0, bottom: 0 }}
          onClick={(s) => {
            const i = s?.activeIndex;
            const p = typeof i === "number" ? data[i] : typeof i === "string" ? data[Number(i)] : undefined;
            if (p && p.state !== "no_data") router.push(`/day/${p.date}`);
          }}
        >
          <CartesianGrid strokeDasharray="3 3" stroke="#eadfcf" />
          <XAxis dataKey="label" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} width={60} />
          <Tooltip formatter={(v) => aed(v)} />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          <Bar dataKey="netSales" name="Net sales (ex VAT)" fill={C.olive} radius={[4, 4, 0, 0]} cursor="pointer" />
          <Bar dataKey="reserve" name="Replenishment reserve" fill={C.red} radius={[4, 4, 0, 0]} cursor="pointer" />
          <Line dataKey="operatingResult" name="Est. operating result" stroke={C.brown} strokeWidth={2} dot={{ r: 3 }} connectNulls />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

export type WaterfallDatum = { label: string; value: number; kind: "total" | "minus"; status: string };

function waterfallBars(steps: WaterfallDatum[]) {
  const out = [];
  let running = 0;
  for (const s of steps) {
    if (s.kind === "total") {
      running = s.value;
      out.push({ label: s.label, base: Math.min(0, s.value), bar: Math.abs(s.value), value: s.value, kind: s.kind, status: s.status });
      continue;
    }
    const top = running;
    running -= s.value;
    out.push({ label: s.label, base: Math.min(top, running), bar: Math.abs(s.value), value: -s.value, kind: s.kind, status: s.status });
  }
  return out;
}

export function WaterfallChart({ steps }: { steps: WaterfallDatum[] }) {
  const data = waterfallBars(steps);
  return (
    <div className="h-80 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 40 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#eadfcf" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} angle={-35} textAnchor="end" interval={0} height={60} />
          <YAxis tick={{ fontSize: 11 }} width={60} />
          <Tooltip formatter={(_v, _n, p) => [`${aed(p.payload.value)}${p.payload.status === "incomplete" || p.payload.status === "unavailable" ? ` (${p.payload.status})` : ""}`, p.payload.label]} />
          <Bar dataKey="base" stackId="w" fill="transparent" />
          <Bar dataKey="bar" stackId="w" radius={[3, 3, 0, 0]}>
            {data.map((d) => (
              <Cell key={d.label} fill={d.kind === "total" ? (d.value >= 0 ? C.olive : C.red) : d.status === "incomplete" || d.status === "unavailable" ? C.grey : C.red} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function Donut({ data }: { data: { name: string; value: number }[] }) {
  const shown = data.filter((d) => d.value > 0);
  if (!shown.length) return <p className="text-sm text-ink-soft">No amounts.</p>;
  return (
    <div className="h-56 w-full">
      <ResponsiveContainer>
        <PieChart>
          <Pie data={shown} dataKey="value" nameKey="name" innerRadius="55%" outerRadius="85%" paddingAngle={2}>
            {shown.map((d, i) => (
              <Cell key={d.name} fill={PALETTE[i % PALETTE.length]} />
            ))}
          </Pie>
          <Tooltip formatter={(v) => aed(v)} />
          <Legend wrapperStyle={{ fontSize: 11 }} />
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}
