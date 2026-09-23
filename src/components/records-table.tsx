import Link from "next/link";
import { BUCKET_LABEL, type ConsumptionRecord } from "@/lib/engine/types";
import { fmtNum } from "@/lib/money";
import { Empty, Money, StatusBadge } from "./ui";

export function RecordsTable({ rows, showItem, showMenu }: { rows: (ConsumptionRecord & { date: string })[]; showItem?: boolean; showMenu?: boolean }) {
  if (!rows.length) return <Empty>No records.</Empty>;
  return (
    <div className="overflow-x-auto">
      <table className="data">
        <thead>
          <tr>
            <th>Date</th>
            <th>Source</th>
            {showMenu && <th>Menu item (POS)</th>}
            {showItem && <th>Ingredient / packaging</th>}
            <th>Use</th>
            <th className="r">Servings</th>
            <th className="r">Qty</th>
            <th>Unit</th>
            <th className="r">Unit cost</th>
            <th className="r">Amount</th>
            <th>Recipe path</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              <td className="whitespace-nowrap">
                <Link className="underline" href={`/day/${r.date}`}>
                  {r.date}
                </Link>
              </td>
              <td className="whitespace-nowrap">{r.origin.type === "order" ? `Order #${r.origin.orderNumber ?? "?"}` : r.origin.type === "adjustment" ? `Adjustment ${r.origin.adjustmentId}` : "Daily batch"}</td>
              {showMenu && <td>{r.origin.posName ?? r.origin.menuCode ?? "—"}</td>}
              {showItem && (
                <td>
                  {r.label}
                  {r.incomplete && <StatusBadge status="incomplete" className="ml-1" />}
                </td>
              )}
              <td className="whitespace-nowrap">{BUCKET_LABEL[r.bucket]}</td>
              <td className="r">{fmtNum(r.origin.servings, 2)}</td>
              <td className="r">{fmtNum(r.qty, 3)}</td>
              <td>{r.unit}</td>
              <td className="r">{r.unitCost === null ? "—" : fmtNum(r.unitCost, 5)}</td>
              <td className="r">{r.amount === null ? <span className="text-red">Missing</span> : <Money v={r.amount} />}</td>
              <td className="text-xs text-ink-soft">{r.path.join(" › ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
