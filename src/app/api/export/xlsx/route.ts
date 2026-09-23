import { BUCKETS, type Bucket } from "@/lib/engine/types";
import { REPORTS } from "@/lib/report";
import { XLSX, download, guarded, rangeParams } from "@/lib/server/http";
import { loadReport } from "@/lib/server/report";
import { renderReportXlsx, type XlsxKind } from "@/lib/server/xlsx";

const KINDS: string[] = [...REPORTS.map((r) => r.kind), "full"];

export async function GET(req: Request) {
  return guarded("view_finance", async () => {
    const url = new URL(req.url);
    const { from, to } = rangeParams(url);
    const report = url.searchParams.get("report") ?? "full";
    if (!KINDS.includes(report)) throw new Error(`Unknown report "${report}".`);
    const b = url.searchParams.get("bucket");
    const bucket = b && (BUCKETS as string[]).includes(b) ? (b as Bucket) : null;
    const data = await loadReport(from, to);
    const span = from === to ? from : `${from}_to_${to}`;
    return download(await renderReportXlsx(data, report as XlsxKind, bucket), `RAWIA_${report}_${span}_${data.status}.xlsx`, XLSX);
  });
}
