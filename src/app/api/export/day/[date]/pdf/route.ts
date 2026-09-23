import { isIsoDate } from "@/lib/dates";
import { PDF, download, guarded } from "@/lib/server/http";
import { renderReportPdf } from "@/lib/server/pdf";
import { loadReport } from "@/lib/server/report";

export async function GET(req: Request, ctx: { params: Promise<{ date: string }> }) {
  return guarded("view_finance", async () => {
    const { date } = await ctx.params;
    if (!isIsoDate(date)) throw new Error("Invalid date.");
    const url = new URL(req.url);
    const rev = url.searchParams.get("rev");
    const revision = rev && /^\d+$/.test(rev) ? Number(rev) : undefined;
    const live = url.searchParams.get("live") === "1";
    const data = await loadReport(date, date, { revision, live });
    const v = data.views[0];
    const tag = v?.state === "finalized" ? `final-r${v.revision}` : "provisional";
    return download(await renderReportPdf(data), `RAWIA_End_of_Day_${date}_${tag}.pdf`, PDF);
  });
}
