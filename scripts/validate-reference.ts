import { readFile } from "node:fs/promises";
import { estimateAll } from "../src/lib/estimator";
import { buildValidationReport, parseValidationCsv } from "../src/lib/verification";
import type { SearchRequest } from "../src/types/domain";

async function main(): Promise<void> {
  const workloadPath = process.argv[2] ?? "tests/fixtures/reference/workload.json";
  const measurementsPath = process.argv[3] ?? "tests/fixtures/reference/vit_boundary_measurements.csv";
  const budgetPath = process.argv[4] ?? "tests/fixtures/reference/error_budget.json";

  const request = JSON.parse(await readFile(workloadPath, "utf8")) as SearchRequest;
  const measurements = parseValidationCsv(await readFile(measurementsPath, "utf8"));
  const budget = JSON.parse(await readFile(budgetPath, "utf8"));
  const report = buildValidationReport(estimateAll(request), measurements);
  const mape = report.meanAbsCalibratedErrorPct ?? report.meanAbsEstimatorErrorPct ?? Infinity;
  const ranking = report.ranking ?? {};
  const top3 = ranking.top3Recall ?? 0;
  const regret = ranking.medianRegret ?? Infinity;
  console.log(report.markdown);
  const failures: string[] = [];
  if (mape > budget.maxMapePct) failures.push(`MAPE ${mape.toFixed(2)}% exceeds budget ${budget.maxMapePct}%`);
  if (top3 < budget.minTop3Recall) failures.push(`Top-3 recall ${top3.toFixed(3)} below budget ${budget.minTop3Recall}`);
  if (regret > budget.maxMedianRegret) failures.push(`Median regret ${regret.toFixed(3)} exceeds budget ${budget.maxMedianRegret}`);
  if (failures.length) {
    console.error("Reference 검증 실패:\n" + failures.join("\n"));
    process.exit(1);
  }
  console.log("Reference 검증 통과.");
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
