import { describe, expect, it } from "vitest";
import { assessEstimatorSuiteReadiness, estimatorSuiteReadinessMarkdown } from "@/lib/estimatorSuiteReadiness";
import { buildScopedEstimatorPipeline } from "@/lib/estimatorSuitePipelines";
import type { LearnedEstimatorSample } from "@/lib/learnedEstimator";

function sample(i: number, overrides: Partial<LearnedEstimatorSample> = {}): LearnedEstimatorSample {
  return {
    id: `s${i}`,
    model: `model_${i % 10}`,
    opName: `op_${i % 4}`,
    arrayRows: i % 3 === 0 ? 64 : i % 3 === 1 ? 128 : 256,
    arrayCols: i % 3 === 0 ? 64 : i % 3 === 1 ? 128 : 256,
    sramKB: i % 2 ? 8192 : 16384,
    frequencyMHz: 700,
    memoryBandwidthGBs: 1200,
    dataflow: i % 3 === 0 ? "WS" : i % 3 === 1 ? "OS" : "IS",
    dtypeBytes: 2,
    m: 128 + (i % 5) * 32,
    n: 512 + (i % 7) * 64,
    k: 256 + (i % 3) * 128,
    tileM: 64,
    tileN: 128,
    tileK: 128,
    estimatorCycles: 10000 + i * 31,
    measuredCycles: Math.round((10000 + i * 31) * (0.95 + (i % 5) * 0.02)),
    targetScope: "full-layer",
    measuredSource: "layers.cycles",
    ...overrides,
  };
}

const header = "id,model,opName,arrayRows,arrayCols,sramKB,frequencyMHz,dataflow,dtypeBytes,m,n,k,tileM,tileN,tileK,estimatorCycles,measuredCycles,targetScope,measuredSource";
function csv(scope: "full-layer" | "tile-policy", count: number) {
  return [
    header,
    ...Array.from({ length: count }, (_, i) => {
      const s = sample(i, {
        targetScope: scope,
        measuredSource: scope === "full-layer" ? "layers.cycles" : "candidate.tileExtrapolatedCycles",
        tileM: scope === "full-layer" ? 128 + (i % 5) * 32 : 64,
        tileN: scope === "full-layer" ? 512 + (i % 7) * 64 : 128,
        tileK: scope === "full-layer" ? 256 + (i % 3) * 128 : 128,
      });
      return [
        `${scope}_${i}`,
        s.model,
        s.opName,
        s.arrayRows,
        s.arrayCols,
        s.sramKB,
        s.frequencyMHz,
        s.dataflow,
        s.dtypeBytes,
        s.m,
        s.n,
        s.k,
        s.tileM,
        s.tileN,
        s.tileK,
        s.estimatorCycles,
        s.measuredCycles,
        s.targetScope,
        s.measuredSource,
      ].join(",");
    }),
  ].join("\n");
}

describe("Estimator Suite readiness gates", () => {
  it("blocks underspecified calibration sets", () => {
    const report = assessEstimatorSuiteReadiness(
      Array.from({ length: 12 }, (_, i) => sample(i, { targetScope: "mixed", dataflow: "WS", arrayRows: 128, arrayCols: 128, model: "one" })),
      { scope: "legacy", minSamples: 40, requireExplicitScope: true, requireMultipleArrays: true, requireMultipleDataflows: true },
    );
    expect(report.level).toBe("blocked");
    expect(report.gates.some((g) => g.name === "target-scope-contract" && g.status === "fail")).toBe(true);
    expect(report.actions.join(" ")).toContain("targetScope");
    expect(estimatorSuiteReadinessMarkdown(report)).toContain("Estimator Suite Readiness");
  });

  it("passes broad explicit datasets", () => {
    const report = assessEstimatorSuiteReadiness(Array.from({ length: 220 }, (_, i) => sample(i)), {
      scope: "full-layer",
      minSamples: 40,
      recommendedSamples: 160,
      requireExplicitScope: true,
      requireMultipleArrays: true,
      requireMultipleDataflows: true,
    });
    expect(report.level).toBe("ready");
    expect(report.score).toBeGreaterThan(0.8);
  });

  it("writes readiness artifacts from the scoped pipeline", () => {
    const pipeline = buildScopedEstimatorPipeline(
      [
        { name: "full.csv", text: csv("full-layer", 6) },
        { name: "tile.csv", text: csv("tile-policy", 5) },
      ],
      { minSamplesPerScope: 40 },
    );
    expect(pipeline.files["datasets/merged/readiness.md"]).toContain("Estimator Suite Readiness");
    expect(pipeline.files["datasets/full-layer/readiness.json"]).toContain("hardware-coverage");
    expect(pipeline.combinedReportMarkdown).toContain("Merged readiness");
  });
});
