import { describe, expect, it } from "vitest";
import { predictMultiTargetMetrics, trainMultiTargetEstimator } from "@/lib/multiTargetEstimator";
import type { LearnedEstimatorSample } from "@/lib/learnedEstimator";

function sample(i: number): LearnedEstimatorSample {
  const m = 128 + (i % 4) * 32;
  const n = 384 + (i % 6) * 128;
  const k = 256 + (i % 5) * 128;
  const tileM = [64, 128, 256][i % 3];
  const tileN = [128, 256, 512][i % 3];
  const tileK = [64, 128, 256][(i + 1) % 3];
  const ops = m * n * k;
  return {
    id: `s${i}`,
    model: "vit-s",
    opName: `op${i % 3}`,
    arrayRows: 128,
    arrayCols: i % 2 ? 256 : 128,
    sramKB: i % 2 ? 8192 : 4096,
    frequencyMHz: 700,
    dataflow: ["WS", "OS", "IS"][i % 3],
    dtypeBytes: 2,
    m, n, k, tileM, tileN, tileK,
    estimatorCycles: Math.max(1, Math.round(ops / 16384)),
    measuredCycles: Math.max(1, Math.round(ops / 15000)),
    estimatorSramBytes: tileM * tileN * 2,
    measuredSramBytes: tileM * tileN * 2 * (1.1 + (i % 3) * 0.1),
    estimatorDramBytes: (m * k + k * n + m * n) * 2,
    measuredDramBytes: (m * k + k * n + m * n) * 2 * (0.8 + (i % 4) * 0.05),
    estimatorUtilization: 0.2 + (i % 4) * 0.04,
    measuredUtilization: 0.22 + (i % 4) * 0.03,
  };
}

describe("multi-target estimator", () => {
  it("trains separate SRAM/DRAM/utilization predictors when columns exist", () => {
    const samples = Array.from({ length: 72 }, (_, i) => sample(i));
    const model = trainMultiTargetEstimator(samples, { epochs: 40, hiddenUnits: 12, minSamples: 40, seed: 7 });
    expect(model.kind).toBe("tileforge-multi-target-estimator-v1");
    expect(model.targets.sramBytes?.samples).toBeGreaterThanOrEqual(40);
    expect(model.targets.dramBytes?.samples).toBeGreaterThanOrEqual(40);
    expect(model.targets.utilizationPct?.samples).toBeGreaterThanOrEqual(40);
    const pred = predictMultiTargetMetrics(model, sample(80));
    expect(pred.sramBytes).toBeGreaterThan(0);
    expect(pred.dramBytes).toBeGreaterThan(0);
    expect(pred.utilization).toBeGreaterThan(0);
    expect(pred.utilization).toBeLessThanOrEqual(1);
  });
});
