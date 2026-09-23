import type { CostingSnapshot } from "../costing/types";
import { D, ZERO, sum } from "../money";
import type { MenuRow } from "./types";

export type SoldReconciliation = {
  code: string;
  name: string;
  qty: string;
  appCost: string;
  workbookCost: string | null;
  diff: string | null;
  incomplete: boolean;
  note: string;
};

/** Compares the app's sold-item cost with Menu Master "cost incl. packaging" × quantity sold. */
export function reconcileSold(menuItems: MenuRow[], snap: CostingSnapshot, karakCode: string): { rows: SoldReconciliation[]; appTotal: string; workbookTotal: string; diffTotal: string; comparable: number } {
  const byCode = new Map(snap.menu.map((m) => [m.code, m]));
  const rows: SoldReconciliation[] = [];
  for (const r of menuItems) {
    if (!r.menuCode || D(r.soldQty).isZero()) continue;
    const m = byCode.get(r.menuCode);
    const wb = m?.workbook.costWithPackaging ?? null;
    const workbookCost = wb === null ? null : D(wb).times(D(r.soldQty));
    let note = "";
    if (r.menuCode === karakCode) note = "Karak: app charges the daily batch separately, so only per-cup packaging is costed per item.";
    else if (wb === null) note = "Workbook has no menu cost for this item.";
    else if (m?.costMode === "total_only") note = "Workbook gives a total cost only; ingredient allocation unavailable.";
    rows.push({
      code: r.menuCode,
      name: r.name,
      qty: r.soldQty,
      appCost: r.soldCost,
      workbookCost: workbookCost?.toString() ?? null,
      diff: workbookCost ? D(r.soldCost).minus(workbookCost).toString() : null,
      incomplete: r.incomplete,
      note,
    });
  }
  const comparable = rows.filter((r) => r.workbookCost !== null && r.code !== karakCode);
  const appTotal = sum(comparable.map((r) => D(r.appCost)));
  const workbookTotal = sum(comparable.map((r) => D(r.workbookCost ?? ZERO)));
  rows.sort((a, b) => D(b.diff ?? 0).abs().comparedTo(D(a.diff ?? 0).abs()));
  return { rows, appTotal: appTotal.toString(), workbookTotal: workbookTotal.toString(), diffTotal: appTotal.minus(workbookTotal).toString(), comparable: comparable.length };
}
