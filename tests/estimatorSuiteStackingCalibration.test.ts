import { describe, expect, it } from "vitest";
import type { LearnedEstimatorSample } from "../src/lib/learnedEstimator";
import {
  buildAdaptiveStackWeights,
  evaluateStackedRows,
  selectAdaptiveStackWeights,
  weightedLogPrediction,
  type EnsemblePredictionRow,
} from "../src/lib/estimatorSuiteStacking";
import {
  buildCycleCalibration,
  selectCycleCalibrationLogBias,
} from "../src/lib/estimatorSuiteCalibration";

function sample(i: number, measuredScale = 1.2): LearnedEstimatorSample {
  return {
    id: `s${i}`,
    model: i % 2 ? "bert" : "vit",
    opName: `matmul_${i % 4}`,
    arrayRows: i % 3 === 0 ? 128 : 64,
    arrayCols: i % 3 === 0 ? 128 : 64,
    sramKB: i % 2 ? 4096 : 2048,
    frequencyMHz: 700,
    memoryBandwidthGBs: 128,
    dataflow: i % 2 ? "WS" : "OS",
    dtypeBytes: 2,
    m: 128 + i * 8,
    n: 256 + i * 4,
    k: 192 + i * 6,
    tileM: 64,
    tileN: 64,
    tileK: 32,
    estimatorCycles: 100_000 + i * 4_000,
    measuredCycles: Math.round((100_000 + i * 4_000) * measuredScale),
    targetScope: "full-layer",
  };
}

function row(i: number, measuredScale = 1.2): EnsemblePredictionRow {
  const s = sample(i, measuredScale);
  return {
    sample: s,
    analytical: s.estimatorCycles,
    tree: Math.round(s.estimatorCycles * 1.08),
    neural: Math.round(s.estimatorCycles * 1.1),
    direct: Math.round(s.estimatorCycles * 1.12),
  };
}

describe("estimator suite stacking/calibration modules", () => {
  it("keeps stack prediction and metrics usable after extraction", () => {
    const rows = Array.from({ length: 12 }, (_, i) => row(i));
    const weights = { analytical: 0.1, tree: 0.35, neural: 0.35, directNeural: 0.2 };
    const predicted = weightedLogPrediction(rows[0], weights, true);
    expect(predicted).toBeGreaterThan(rows[0].analytical);
    const metrics = evaluateStackedRows(rows, weights);
    expect(metrics.samples).toBe(12);
    expect(metrics.learnedMapePct).toBeLessThan(metrics.baselineMapePct);
  });

  it("builds OOF calibration separately from the main trainer", () => {
    const rows = Array.from({ length: 18 }, (_, i) => row(i, 1.35));
    const weights = { analytical: 0.05, tree: 0.35, neural: 0.4, directNeural: 0.2 };
    const adaptive = buildAdaptiveStackWeights(rows, weights);
    const selected = selectAdaptiveStackWeights(adaptive, rows[0].sample, weights);
    expect(selected.analytical + selected.tree + selected.neural + (selected.directNeural ?? 0)).toBeGreaterThan(0.99);

    const calibration = buildCycleCalibration(rows, weights, adaptive);
    expect(calibration?.mode).toBe("oof-log-residual-bucket");
    const bias = selectCycleCalibrationLogBias(
      calibration,
      rows[0].sample,
      Math.log(rows[0].sample.estimatorCycles),
    );
    expect(bias).toBeGreaterThan(0);
  });
});
