import { describe, expect, it } from "vitest";
import { compareResidualEstimators, predictNeuralCycles, trainNeuralResidualEstimator } from "@/lib/neuralResidualEstimator";
import type { LearnedEstimatorSample } from "@/lib/learnedEstimator";

function sample(i: number): LearnedEstimatorSample {
  const m = [64, 128, 197, 256, 384, 512][i % 6];
  const n = [64, 128, 256, 384, 768][Math.floor(i / 2) % 5];
  const k = [64, 128, 256, 512][Math.floor(i / 3) % 4];
  const tileM = [32, 64, 128][i % 3];
  const tileN = [32, 64, 128][Math.floor(i / 2) % 3];
  const tileK = [32, 64][Math.floor(i / 4) % 2];
  const arrayRows = i % 2 ? 64 : 32;
  const arrayCols = i % 3 ? 64 : 32;
  const dataflow = i % 3 === 0 ? "WS" : i % 3 === 1 ? "OS" : "IS";
  const estimatorCycles = Math.max(1, Math.round((m * n * k) / (arrayRows * arrayCols * 8)) + tileM + tileN + tileK);
  const measuredFactor = 1.1 + (dataflow === "OS" ? 0.16 : 0) + (m % tileM ? 0.08 : 0) + (tileK > 32 ? 0.04 : 0);
  return {
    id: `s${i}`,
    model: "test",
    opName: `gemm_${i}`,
    arrayRows,
    arrayCols,
    sramKB: i % 2 ? 4096 : 2048,
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
    measuredCycles: Math.round(estimatorCycles * measuredFactor)
  };
}

describe("neural residual estimator", () => {
  it("trains a residual model that improves over the analytical baseline on synthetic data", () => {
    const samples = Array.from({ length: 90 }, (_, i) => sample(i));
    const model = trainNeuralResidualEstimator(samples, { hiddenUnits: 8, epochs: 80, learningRate: 0.02, seed: 7 });
    const metrics = model.validation;
    expect(metrics?.samples).toBeGreaterThan(0);
    expect(metrics?.learnedMapePct ?? Number.POSITIVE_INFINITY).toBeLessThan(metrics?.baselineMapePct ?? 0);
    expect(predictNeuralCycles(model, samples[0])).toBeGreaterThan(0);
  });

  it("compares tree and neural residual estimators and returns a recommendation", () => {
    const samples = Array.from({ length: 90 }, (_, i) => sample(i));
    const result = compareResidualEstimators(samples, { trees: 8, maxDepth: 4, hiddenUnits: 8, epochs: 40, seed: 11 });
    expect(["tree-residual", "neural-residual"]).toContain(result.recommendation);
    expect(result.treeMetrics.learnedMapePct).toBeLessThan(result.treeMetrics.baselineMapePct);
  });
});
