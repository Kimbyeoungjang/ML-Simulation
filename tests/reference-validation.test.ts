import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { estimateAll } from "../src/lib/estimator";
import { buildValidationReport, parseValidationCsv } from "../src/lib/verification";
import type { SearchRequest } from "../src/types/domain";

describe("reference validation dataset", () => {
  it("stays within the checked-in error budget", async () => {
    const req = JSON.parse(await readFile("tests/fixtures/reference/workload.json", "utf8")) as SearchRequest;
    const measurements = parseValidationCsv(await readFile("tests/fixtures/reference/vit_boundary_measurements.csv", "utf8"));
    const budget = JSON.parse(await readFile("tests/fixtures/reference/error_budget.json", "utf8"));
    const report = buildValidationReport(estimateAll(req), measurements);
    const mape = report.meanAbsCalibratedErrorPct ?? report.meanAbsEstimatorErrorPct ?? Infinity;
    expect(mape).toBeLessThanOrEqual(budget.maxMapePct);
    const ranking = report.ranking ?? {};
    expect(ranking.top3Recall ?? 0).toBeGreaterThanOrEqual(budget.minTop3Recall);
    expect(ranking.medianRegret ?? Infinity).toBeLessThanOrEqual(budget.maxMedianRegret);
  });
});
