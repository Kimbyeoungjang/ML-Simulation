import { describe, expect, it } from "vitest";
import {
  bestDesignRow,
  bestDesignRowsByAxis,
  bestRiskAdjustedDesignRow,
  buildDesignSpaceRows,
  buildDesignSpaceSvg,
  designAxisSummary,
  exportValidationPlanCsv,
  exportValidationPlanJson,
  validationPlanRows,
  paretoDesignRows,
  validationDesignRows,
} from "../src/lib/designSpace";
import { estimateAll } from "../src/lib/estimator";
import { trainEstimatorSuite } from "../src/lib/estimatorSuite";
import type { LearnedEstimatorSample } from "../src/lib/learnedEstimator";
import {
  defaultCandidates,
  defaultHardware,
  defaultShapes,
} from "../src/lib/defaults";

function response() {
  return estimateAll(
    {
      hardware: defaultHardware,
      shapes: defaultShapes.slice(0, 1),
      candidates: defaultCandidates,
      objective: "balanced",
    },
    { includeArtifacts: false },
  );
}

function tinySramResponse() {
  return estimateAll(
    {
      hardware: { ...defaultHardware, sramKB: 1 },
      shapes: defaultShapes.slice(0, 1),
      candidates: defaultCandidates,
      objective: "balanced",
    },
    { includeArtifacts: false },
  );
}

function learnedSample(i: number): LearnedEstimatorSample {
  const m = 128 + (i % 4) * 64;
  const n = 128 + (Math.floor(i / 4) % 4) * 64;
  const k = 128 + (Math.floor(i / 16) % 3) * 64;
  const tileM = [32, 64, 128][i % 3];
  const tileN = [32, 64, 128][Math.floor(i / 3) % 3];
  const tileK = [32, 64, 128][Math.floor(i / 9) % 3];
  const estimatorCycles = Math.max(
    1000,
    Math.round((m * n * k) / (128 * 128 * 4)) + tileM + tileN + tileK,
  );
  return {
    id: `ds${i}`,
    model: "demo",
    opName: `gemm_${i % 4}`,
    arrayRows: 128,
    arrayCols: 128,
    sramKB: 8192,
    frequencyMHz: 700,
    memoryBandwidthGBs: 128,
    dataflow: "WS",
    dtypeBytes: 2,
    m,
    n,
    k,
    tileM,
    tileN,
    tileK,
    estimatorCycles,
    measuredCycles: Math.round(
      estimatorCycles * (1.08 + (tileK > 64 ? 0.06 : 0)),
    ),
    targetScope: "full-layer",
    measuredSource: "synthetic-full-layer",
  };
}

describe("design-space sweep", () => {
  it("builds reusable consensus sweet-spot rows without UI code", () => {
    const rows = buildDesignSpaceRows(response(), null);
    expect(rows.length).toBeGreaterThan(20);
    expect(bestDesignRowsByAxis(rows).map((r) => r.axis)).toContain("array");
    expect(bestDesignRow(rows).totalCycles).toBeGreaterThan(0);
    expect(bestDesignRow(rows).agreementScore).toBeGreaterThan(0);
    expect(bestDesignRow(rows).recommendationScore).toBeGreaterThan(0);
    expect(
      rows.every((r) => r.predictionConfidence === 1 && !r.outOfDomain),
    ).toBe(true);
  });

  it("uses refined effective factors while deduplicating rounded sweep points", () => {
    const rows = buildDesignSpaceRows(response(), null);
    const arrayRows = rows.filter((r) => r.axis === "array");
    const shapeMRows = rows.filter((r) => r.axis === "shape-m");
    expect(arrayRows.length).toBeGreaterThan(8);
    expect(shapeMRows.length).toBeGreaterThan(6);
    expect(new Set(arrayRows.map((r) => r.value)).size).toBe(arrayRows.length);
    expect(shapeMRows.some((r) => r.value > 1 && r.value < 1.25)).toBe(true);
  });

  it("normalizes workload sweeps by ops per cycle instead of rewarding smaller work", () => {
    const rows = buildDesignSpaceRows(response(), null);
    const shapeMRows = rows.filter((r) => r.axis === "shape-m");
    const smallerM = shapeMRows.find((r) => r.value < 0.6);
    const baseM = shapeMRows.find((r) => Math.abs(r.value - 1) < 1e-9);
    expect(smallerM).toBeTruthy();
    expect(baseM).toBeTruthy();
    expect(smallerM!.workScale).toBeLessThan(1);
    expect(smallerM!.cycleSpeedup).toBeGreaterThan(smallerM!.speedup);
    expect(baseM!.speedup).toBeCloseTo(1, 1);
  });

  it("adds ROI-aware recommendation fields for axis summaries", () => {
    const summary = designAxisSummary(buildDesignSpaceRows(response(), null));
    expect(summary.length).toBeGreaterThan(0);
    expect(
      summary.every((r) => r.recommendationScore > 0 && r.roiScore > 0),
    ).toBe(true);
    expect(
      summary.every(
        (r) => r.uncertaintyPct >= 5 && r.riskAdjustedRecommendationScore > 0,
      ),
    ).toBe(true);
    expect(summary.some((r) => Number.isFinite(r.marginalEfficiency))).toBe(
      true,
    );
  });

  it("computes uncertainty-aware ranking and validation candidates", () => {
    const rows = buildDesignSpaceRows(response(), null);
    const riskBest = bestRiskAdjustedDesignRow(rows);
    const validation = validationDesignRows(rows, 3);
    expect(riskBest.riskAdjustedSpeedup).toBeGreaterThan(0);
    expect(riskBest.riskAdjustedRecommendationScore).toBeGreaterThan(0);
    expect(validation.length).toBe(3);
    expect(validation.every((r) => !r.isBase && r.validationPriority > 0)).toBe(
      true,
    );
    expect(new Set(validation.map((r) => r.axis)).size).toBe(validation.length);
    expect(
      rows.every((r) => r.uncertaintyPct >= 5 && r.uncertaintyPct <= 65),
    ).toBe(true);
  });

  it("exports a CSV validation plan with normalized selection scores", () => {
    const rows = buildDesignSpaceRows(response(), null);
    const csv = exportValidationPlanCsv(rows, 4);
    const lines = csv.trim().split("\n");
    expect(lines[0]).toContain("selectionScore");
    expect(lines[0]).toContain("rationale");
    expect(lines[0]).toContain("riskAdjustedRecommendationScore");
    expect(lines).toHaveLength(5);
    const scores = lines.slice(1).map((line) => Number(line.split(",")[4]));
    expect(scores.every((score) => score >= 0 && score <= 1)).toBe(true);
    expect(
      new Set(lines.slice(1).map((line) => line.split(",")[1])).size,
    ).toBeGreaterThan(1);
    expect(lines.slice(1).every((line) => line.length > 0)).toBe(true);
  });

  it("exports a structured JSON validation plan with rationale", () => {
    const rows = buildDesignSpaceRows(response(), null);
    const plan = validationPlanRows(rows, 3);
    expect(plan).toHaveLength(3);
    expect(
      plan.every((item) => item.rank > 0 && item.selectionScore >= 0),
    ).toBe(true);
    expect(plan.every((item) => item.rationale.length > 0)).toBe(true);
    const parsed = JSON.parse(exportValidationPlanJson(rows, 3));
    expect(parsed.generatedBy).toBe("tileforge-design-space");
    expect(parsed.candidates).toHaveLength(3);
    expect(parsed.candidates[0].rationale).toBeTruthy();
  });

  it("identifies non-dominated pareto candidates", () => {
    const pareto = paretoDesignRows(buildDesignSpaceRows(response(), null));
    expect(pareto.length).toBeGreaterThan(0);
    expect(pareto.every((r) => r.speedup > 0 && r.score > 0)).toBe(true);
  });

  it("keeps scores finite and positive even when SRAM overflow dominates", () => {
    const rows = buildDesignSpaceRows(tinySramResponse(), null);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => Number.isFinite(r.score) && r.score > 0)).toBe(
      true,
    );
  });

  it("dampens recommendations when learned sweeps leave the training domain", () => {
    const model = trainEstimatorSuite(
      Array.from({ length: 48 }, (_, i) => learnedSample(i)),
      {
        trees: 8,
        maxDepth: 4,
        hiddenUnits: 6,
        epochs: 20,
        splitKinds: ["random"],
        maxFinalTrainSamples: 48,
        seed: 11,
      },
    );
    const rows = buildDesignSpaceRows(response(), { model });
    const outOfDomain = rows.filter((r) => r.outOfDomain);
    expect(outOfDomain.length).toBeGreaterThan(0);
    expect(outOfDomain.some((r) => r.predictionConfidence < 0.8)).toBe(true);
    expect(
      bestDesignRowsByAxis(rows).every(
        (r) => r.predictionConfidence >= 0.25 && r.predictionConfidence <= 1,
      ),
    ).toBe(true);
    const baselineRows = rows.filter((r) => r.isBase);
    expect(baselineRows.length).toBeGreaterThan(0);
    expect(baselineRows.every((r) => Math.abs(r.speedup - 1) < 1e-9)).toBe(
      true,
    );
  });

  it("renders an SVG with consensus sweet-spot markers", () => {
    const svg = buildDesignSpaceSvg(
      buildDesignSpaceRows(response(), null),
      "score",
    );
    expect(svg).toContain("<svg");
    expect(svg).toContain("Design-space sweep");
    expect(svg).toContain("confidence-aware consensus+ROI");
    expect(svg).toContain("recommend");
    expect(svg).toContain("risk");
    expect(svg).toContain("validate");
    expect(svg).toContain("next validation candidate");
    expect(svg).toContain("#c792ea");
    expect(svg).toContain("conf");
    expect(svg).toContain("marginal knee");
    expect(svg).toContain("#ffb86b");
    expect(svg).toContain("sweet:");
  });
});
