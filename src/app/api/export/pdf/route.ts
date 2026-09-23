import { PDF, download, guarded, rangeParams } from "@/lib/server/http";
import { renderReportPdf } from "@/lib/server/pdf";
import { loadReport } from "@/lib/server/report";

export async function GET(req: Request) {
  return guarded("view_finance", async () => {
    const { from, to } = rangeParams(new URL(req.url));
    const data = await loadReport(from, to);
    const name = from === to ? `RAWIA_End_of_Day_${from}` : `RAWIA_Financial_Summary_${from}_to_${to}`;
    return download(await renderReportPdf(data), `${name}_${data.status}.pdf`, PDF);
  });
}
