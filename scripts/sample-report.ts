import "dotenv/config";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/** Imports the bundled sample sales file (deduplicated, safe to re-run) and writes the daily PDF and Excel reports to docs/sample. */
async function main() {
  const file = process.argv[2] ?? "tests/fixtures/order-history-2026-09-14.csv";
  const date = process.argv[3] ?? "2026-09-14";
  const { createPreview, getPreview, commitImport } = await import("../src/lib/server/sales");
  const { loadReport } = await import("../src/lib/server/report");
  const { renderReportPdf } = await import("../src/lib/server/pdf");
  const { renderReportXlsx } = await import("../src/lib/server/xlsx");

  const id = await createPreview(readFileSync(file), path.basename(file), date, "selected_date", null);
  const p = await getPreview(id);
  console.log("Import preview:", p?.preview.byClass);
  console.log("Committed:", await commitImport(id, { changedPolicy: "keep", includePossible: [] }, null));

  const data = await loadReport(date, date);
  const out = path.resolve("docs/sample");
  mkdirSync(out, { recursive: true });
  const pdf = path.join(out, `RAWIA_End_of_Day_${date}.pdf`);
  const xlsx = path.join(out, `RAWIA_Daily_Breakdown_${date}.xlsx`);
  writeFileSync(pdf, await renderReportPdf(data));
  writeFileSync(xlsx, await renderReportXlsx(data, "full"));
  const m = data.summary.metrics;
  console.log(`Status ${data.status}; net sales ${m.netSales?.value}; reserve ${m.reserve?.value} (${m.reserve?.status}); operating result ${m.operatingResult?.value}`);
  console.log(`Wrote ${pdf}\nWrote ${xlsx}`);
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
