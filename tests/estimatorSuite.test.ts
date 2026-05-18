import { describe, expect, it } from "vitest";
import { estimatorSuitePredictionRows, evaluateEstimatorSuite, predictEstimatorSuiteCycles, trainEstimatorSuite, weightsFromMetrics } from "@/lib/estimatorSuite";
import type { LearnedEstimatorSample } from "@/lib/learnedEstimator";

function sample(i: number): LearnedEstimatorSample {
  const m = [64, 96, 128, 197, 256, 384, 512, 768][i % 8];
  const n = [64, 128, 192, 256, 384, 768][Math.floor(i / 2) % 6];
  const k = [64, 128, 256, 384, 512][Math.floor(i / 3) % 5];
  const tileM = [32, 64, 128][i % 3];
  const tileN = [32, 64, 128][Math.floor(i / 2) % 3];
  const tileK = [32, 64, 128][Math.floor(i / 5) % 3];
  const arrayRows = [32, 64, 128][Math.floor(i / 7) % 3];
  const arrayCols = [32, 64, 128][Math.floor(i / 11) % 3];
  const dataflow = i % 3 === 0 ? "WS" : i % 3 === 1 ? "OS" : "IS";
  const estimatorCycles = Math.max(1, Math.round((m * n * k) / (arrayRows * arrayCols * 6)) + tileM + tileN + tileK);
  const factor = 1.05
    + (dataflow === "OS" ? 0.18 : dataflow === "IS" ? 0.08 : 0)
    + (m % tileM ? 0.07 : 0)
    + (n % tileN ? 0.05 : 0)
    + (tileK > 64 ? 0.04 : 0)
    + (arrayRows === 128 && arrayCols === 128 ? -0.03 : 0);
  return {
    id: `s${i}`,
    model: `model_${i % 5}`,
    opName: `gemm_${i % 17}`,
    arrayRows,
    arrayCols,
    sramKB: [2048, 4096, 8192][i % 3],
    frequencyMHz: 700,
    dataflow,
    dtypeBytes: 2,
    m,
    n,
    k,
    tileM,
    tileN,
    tileK,
    estimatorCycles,
    measuredCycles: Math.round(estimatorCycles * factor)
  };
}

describe("estimator suite", () => {
  it("trains tree, neural, and ensemble models with holdout validation", () => {
    const samples = Array.from({ length: 180 }, (_, i) => sample(i));
    const model = trainEstimatorSuite(samples, {
      trees: 16,
      maxDepth: 5,
      minLeaf: 3,
      hiddenUnits: 10,
      epochs: 60,
      maxSplitTrainSamples: 90,
      maxFinalTrainSamples: 100,
      splitKinds: ["random", "array", "dataflow"],
      seed: 123
    });
    expect(model.kind).toBe("tileforge-estimator-suite-v1");
    expect(model.validationSuite.length).toBeGreaterThan(0);
    expect(model.metadata.samples).toBe(180);
    expect(model.metadata.trainSamples).toBe(100);
    expect(model.weights.analytical + model.weights.tree + model.weights.neural + (model.weights.directNeural ?? 0)).toBeCloseTo(1, 6);
    expect(["analytical", "tree-residual", "neural-residual", "ensemble"]).toContain(model.recommended);
    expect(predictEstimatorSuiteCycles(model, samples[0])).toBeGreaterThan(0);
    const metrics = evaluateEstimatorSuite(model, samples.slice(0, 40));
    expect(metrics.learnedMapePct).toBeLessThan(metrics.baselineMapePct);
    expect(estimatorSuitePredictionRows(samples.slice(0, 3), model)).toHaveLength(3);
  });

  it("rejects undersized datasets instead of producing a misleading suite", () => {
    expect(() => trainEstimatorSuite(Array.from({ length: 20 }, (_, i) => sample(i)))).toThrow(/at least 40 valid samples/);
  });

  it("keeps ensemble weights normalized and favors the lower-error residual model", () => {
    const base = { samples: 20, baselineMapePct: 25, learnedMapePct: 25, baselineRmsePct: 25, learnedRmsePct: 25, p50AbsPct: 25, p90AbsPct: 40, p95AbsPct: 45 };
    const goodTree = { samples: 20, baselineMapePct: 25, learnedMapePct: 2, baselineRmsePct: 25, learnedRmsePct: 3, p50AbsPct: 1, p90AbsPct: 4, p95AbsPct: 5 };
    const weakNeural = { samples: 20, baselineMapePct: 25, learnedMapePct: 10, baselineRmsePct: 25, learnedRmsePct: 12, p50AbsPct: 8, p90AbsPct: 16, p95AbsPct: 20 };
    const w = weightsFromMetrics(base, goodTree, weakNeural);
    expect(w.analytical + w.tree + w.neural).toBeCloseTo(1, 8);
    expect(w.tree).toBeGreaterThan(w.neural);
    expect(w.tree).toBeGreaterThan(w.analytical);
  });

});
