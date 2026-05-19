import { describe, expect, it } from "vitest";
import {
  estimatorSuiteCalibrationFactor,
  estimatorSuitePredictionRows,
  evaluateEstimatorSuite,
  predictEstimatorSuiteCycles,
  trainEstimatorSuite,
  weightsFromMetrics,
} from "@/lib/estimatorSuite";
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
  const estimatorCycles = Math.max(
    1,
    Math.round((m * n * k) / (arrayRows * arrayCols * 6)) +
      tileM +
      tileN +
      tileK,
  );
  const factor =
    1.05 +
    (dataflow === "OS" ? 0.18 : dataflow === "IS" ? 0.08 : 0) +
    (m % tileM ? 0.07 : 0) +
    (n % tileN ? 0.05 : 0) +
    (tileK > 64 ? 0.04 : 0) +
    (arrayRows === 128 && arrayCols === 128 ? -0.03 : 0);
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
    measuredCycles: Math.round(estimatorCycles * factor),
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
      seed: 123,
    });
    expect(model.kind).toBe("tileforge-estimator-suite-v1");
    expect(model.validationSuite.length).toBeGreaterThan(0);
    expect(model.metadata.samples).toBe(180);
    expect(model.metadata.trainSamples).toBe(100);
    expect(
      model.weights.analytical +
        model.weights.tree +
        model.weights.neural +
        (model.weights.directNeural ?? 0),
    ).toBeCloseTo(1, 6);
    expect(model.calibration?.mode).toBe("oof-log-residual-bucket");
    expect(model.calibration?.local?.mode).toBe("knn-log-residual");
    expect(model.calibration?.local?.prototypes.length).toBeGreaterThan(0);
    expect(
      model.calibration?.validation?.learnedMapePct,
    ).toBeGreaterThanOrEqual(0);
    expect([
      "analytical",
      "tree-residual",
      "neural-residual",
      "ensemble",
    ]).toContain(model.recommended);
    expect(predictEstimatorSuiteCycles(model, samples[0])).toBeGreaterThan(0);
    const metrics = evaluateEstimatorSuite(model, samples.slice(0, 40));
    expect(metrics.learnedMapePct).toBeLessThan(metrics.baselineMapePct);
    expect(
      estimatorSuitePredictionRows(samples.slice(0, 3), model),
    ).toHaveLength(3);
  });

  it("learns a robust out-of-fold cycle calibration for systematic bias", () => {
    const samples = Array.from({ length: 150 }, (_, i) => {
      const s = sample(i);
      const groupBias =
        s.dataflow === "OS" ? 1.28 : s.dataflow === "IS" ? 1.16 : 1.08;
      return {
        ...s,
        measuredCycles: Math.round(s.estimatorCycles * groupBias),
      };
    });
    const model = trainEstimatorSuite(samples, {
      trees: 12,
      maxDepth: 4,
      minLeaf: 3,
      hiddenUnits: 8,
      epochs: 40,
      maxSplitTrainSamples: 80,
      maxFinalTrainSamples: 90,
      splitKinds: ["random", "dataflow"],
      seed: 99,
    });
    expect(model.calibration).toBeTruthy();
    expect(model.calibration!.buckets.length).toBeGreaterThan(0);
    expect(model.calibration!.local?.prototypes.length ?? 0).toBeGreaterThan(0);
    const factor = estimatorSuiteCalibrationFactor(
      model,
      samples.find((s) => s.dataflow === "OS")!,
    );
    expect(Number.isFinite(factor)).toBe(true);
    expect(factor).toBeGreaterThan(0.8);
    expect(factor).toBeLessThan(1.6);
    const rows = estimatorSuitePredictionRows(samples.slice(0, 6), model);
    expect(rows[0].calibrationFactor).toBeGreaterThan(0);
  });

  it("uses local OOF residual prototypes to capture smooth shape-specific bias", () => {
    const samples = Array.from({ length: 180 }, (_, i) => {
      const s = sample(i);
      const localBias = s.m >= 384 && s.tileK >= 64 ? 1.32 : 1.04;
      return {
        ...s,
        measuredCycles: Math.round(s.estimatorCycles * localBias),
      };
    });
    const model = trainEstimatorSuite(samples, {
      trees: 12,
      maxDepth: 4,
      minLeaf: 3,
      hiddenUnits: 8,
      epochs: 40,
      maxSplitTrainSamples: 90,
      maxFinalTrainSamples: 100,
      splitKinds: ["random", "workload"],
      seed: 202,
    });
    expect(model.calibration?.local?.mode).toBe("knn-log-residual");
    const high = samples.find((s) => s.m >= 384 && s.tileK >= 64)!;
    const low = samples.find((s) => s.m < 384 && s.tileK < 64)!;
    expect(estimatorSuiteCalibrationFactor(model, high)).toBeGreaterThan(
      estimatorSuiteCalibrationFactor(model, low),
    );
  });

  it("adds prediction-scale trend calibration for size-dependent residual drift", () => {
    const samples = Array.from({ length: 180 }, (_, i) => {
      const s = sample(i);
      const rank = Math.log(Math.max(1, s.estimatorCycles));
      const trendBias = 0.78 + 0.055 * rank;
      return {
        ...s,
        measuredCycles: Math.round(s.estimatorCycles * trendBias),
      };
    });
    const model = trainEstimatorSuite(samples, {
      trees: 10,
      maxDepth: 3,
      minLeaf: 6,
      hiddenUnits: 6,
      epochs: 25,
      maxSplitTrainSamples: 70,
      maxFinalTrainSamples: 80,
      splitKinds: ["random", "large-shape"],
      seed: 707,
    });
    expect(model.calibration?.scaleTrend?.mode).toBe(
      "log-predicted-cycle-trend",
    );
    expect(Math.abs(model.calibration!.scaleTrend!.slope)).toBeGreaterThan(
      0.005,
    );
    const sorted = samples
      .slice()
      .sort((a, b) => a.estimatorCycles - b.estimatorCycles);
    const small = sorted[0];
    const large = sorted[sorted.length - 1];
    expect(estimatorSuiteCalibrationFactor(model, large)).toBeGreaterThan(
      estimatorSuiteCalibrationFactor(model, small),
    );
  });

  it("adds resource-pressure calibration for SRAM and bandwidth dependent residuals", () => {
    const samples = Array.from({ length: 192 }, (_, i) => {
      const s = sample(i);
      const sramKB = [512, 1024, 2048, 8192][i % 4];
      const memoryBandwidthGBs = [80, 160, 320, 640][Math.floor(i / 4) % 4];
      const tileBytes =
        (s.tileM * s.tileK + s.tileK * s.tileN + s.tileM * s.tileN) *
        s.dtypeBytes;
      const pressure = Math.log(tileBytes / Math.max(1, sramKB * 1024));
      const bandwidthPenalty = memoryBandwidthGBs <= 160 ? 0.18 : -0.04;
      const resourceBias =
        1.18 + 0.28 * Math.max(-0.7, pressure) + bandwidthPenalty;
      return {
        ...s,
        sramKB,
        memoryBandwidthGBs,
        measuredCycles: Math.round(s.estimatorCycles * resourceBias),
      };
    });
    const model = trainEstimatorSuite(samples, {
      trees: 10,
      maxDepth: 3,
      minLeaf: 8,
      hiddenUnits: 6,
      epochs: 25,
      maxSplitTrainSamples: 80,
      maxFinalTrainSamples: 90,
      splitKinds: ["random", "array"],
      seed: 909,
    });
    expect(model.calibration?.resourceTrend?.mode).toBe(
      "resource-pressure-linear",
    );
    const highPressure = samples.find(
      (s) => s.sramKB === 512 && s.memoryBandwidthGBs === 80,
    )!;
    const lowPressure = samples.find(
      (s) => s.sramKB === 8192 && s.memoryBandwidthGBs === 640,
    )!;
    expect(
      estimatorSuiteCalibrationFactor(model, highPressure),
    ).toBeGreaterThan(estimatorSuiteCalibrationFactor(model, lowPressure));
  });

  it("adds tiling-geometry calibration for edge-tile and padding residuals", () => {
    const samples = Array.from({ length: 216 }, (_, i) => {
      const s = sample(i);
      const m = [95, 96, 127, 128, 191, 192][i % 6];
      const n = [127, 128, 255, 256, 383, 384][Math.floor(i / 3) % 6];
      const k = [63, 64, 95, 96, 127, 128][Math.floor(i / 5) % 6];
      const tileM = [32, 64][Math.floor(i / 7) % 2];
      const tileN = [32, 64][Math.floor(i / 11) % 2];
      const tileK = [32, 64][Math.floor(i / 13) % 2];
      const edgeAxes =
        (m % tileM === 0 ? 0 : 1) +
        (n % tileN === 0 ? 0 : 1) +
        (k % tileK === 0 ? 0 : 1);
      const waves =
        Math.ceil(m / tileM) * Math.ceil(n / tileN) * Math.ceil(k / tileK);
      const padded =
        Math.ceil(m / tileM) *
        tileM *
        Math.ceil(n / tileN) *
        tileN *
        Math.ceil(k / tileK) *
        tileK;
      const waste = Math.log(padded / Math.max(1, m * n * k));
      const geometryBias =
        1.02 + 0.13 * edgeAxes + 0.18 * waste + 0.006 * Math.log1p(waves);
      return {
        ...s,
        m,
        n,
        k,
        tileM,
        tileN,
        tileK,
        estimatorCycles: Math.max(
          1,
          Math.round((m * n * k) / (s.arrayRows * s.arrayCols * 5)),
        ),
        measuredCycles: Math.max(
          1,
          Math.round(
            ((m * n * k) / (s.arrayRows * s.arrayCols * 5)) * geometryBias,
          ),
        ),
      };
    });
    const model = trainEstimatorSuite(samples, {
      trees: 10,
      maxDepth: 3,
      minLeaf: 8,
      hiddenUnits: 6,
      epochs: 25,
      maxSplitTrainSamples: 85,
      maxFinalTrainSamples: 95,
      splitKinds: ["random", "large-shape"],
      seed: 1001,
    });
    expect(model.calibration?.tilingTrend?.mode).toBe("tiling-geometry-linear");
    const edgeHeavy = samples.find(
      (s) => s.m % s.tileM !== 0 && s.n % s.tileN !== 0 && s.k % s.tileK !== 0,
    )!;
    const aligned = samples.find(
      (s) => s.m % s.tileM === 0 && s.n % s.tileN === 0 && s.k % s.tileK === 0,
    )!;
    expect(estimatorSuiteCalibrationFactor(model, edgeHeavy)).toBeGreaterThan(
      estimatorSuiteCalibrationFactor(model, aligned),
    );
  });

  it("adds domain-adaptive ensemble weights when predictor quality differs by dataflow", () => {
    const samples = Array.from({ length: 180 }, (_, i) => {
      const s = sample(i);
      const groupBias =
        s.dataflow === "OS"
          ? s.m > 250
            ? 1.75
            : 1.4
          : s.dataflow === "IS"
            ? 1.1
            : 0.98;
      return {
        ...s,
        measuredCycles: Math.round(s.estimatorCycles * groupBias),
      };
    });
    const model = trainEstimatorSuite(samples, {
      trees: 12,
      maxDepth: 4,
      minLeaf: 3,
      hiddenUnits: 8,
      epochs: 40,
      maxSplitTrainSamples: 90,
      maxFinalTrainSamples: 100,
      splitKinds: ["random", "dataflow", "array"],
      seed: 321,
    });
    expect(model.blend?.adaptiveWeights?.mode).toBe(
      "oof-domain-adaptive-stack",
    );
    expect(model.blend!.adaptiveWeights!.buckets.length).toBeGreaterThan(0);
    const wsBucket = model.blend!.adaptiveWeights!.buckets.find(
      (b) => b.kind === "dataflow" && b.key === "WS",
    );
    expect(wsBucket?.weights.analytical ?? 0).toBeGreaterThan(
      model.blend!.weights.analytical,
    );
  });

  it("adds bottleneck-regime residual buckets for SRAM/DRAM/edge regimes", () => {
    const samples = Array.from({ length: 180 }, (_, i) => {
      const base = sample(i);
      const regimePatch =
        i % 4 === 0
          ? {
              sramKB: 64,
              memoryBandwidthGBs: 600,
              tileM: 128,
              tileN: 128,
              tileK: 128,
            }
          : i % 4 === 1
            ? {
                sramKB: 8192,
                memoryBandwidthGBs: 8,
                tileM: 64,
                tileN: 64,
                tileK: 64,
              }
            : i % 4 === 2
              ? {
                  sramKB: 4096,
                  memoryBandwidthGBs: 600,
                  tileM: 96,
                  tileN: 96,
                  tileK: 96,
                }
              : {
                  sramKB: 8192,
                  memoryBandwidthGBs: 600,
                  tileM: 64,
                  tileN: 64,
                  tileK: 64,
                };
      const patched = { ...base, ...regimePatch };
      const bottleneckBias =
        i % 4 === 0 ? 1.42 : i % 4 === 1 ? 1.3 : i % 4 === 2 ? 1.18 : 1.02;
      return {
        ...patched,
        measuredCycles: Math.round(patched.estimatorCycles * bottleneckBias),
      };
    });
    const model = trainEstimatorSuite(samples, {
      trees: 12,
      maxDepth: 4,
      minLeaf: 5,
      hiddenUnits: 8,
      epochs: 35,
      maxSplitTrainSamples: 90,
      maxFinalTrainSamples: 100,
      splitKinds: ["random", "large-shape"],
      seed: 303,
    });
    expect(
      model.calibration?.buckets.some(
        (b) => b.kind === "regime" || b.kind === "dataflow-regime",
      ),
    ).toBe(true);
    expect(
      model.blend?.adaptiveWeights?.buckets.some(
        (b) => b.kind === "regime" || b.kind === "dataflow-regime",
      ),
    ).toBe(true);
    const sramSpill = samples.find((_, i) => i % 4 === 0)!;
    const regular = samples.find((_, i) => i % 4 === 3)!;
    expect(estimatorSuiteCalibrationFactor(model, sramSpill)).toBeGreaterThan(
      estimatorSuiteCalibrationFactor(model, regular),
    );
  });

  it("rejects undersized datasets instead of producing a misleading suite", () => {
    expect(() =>
      trainEstimatorSuite(Array.from({ length: 20 }, (_, i) => sample(i))),
    ).toThrow(/at least 40 valid samples/);
  });

  it("keeps ensemble weights normalized and favors the lower-error residual model", () => {
    const base = {
      samples: 20,
      baselineMapePct: 25,
      learnedMapePct: 25,
      baselineRmsePct: 25,
      learnedRmsePct: 25,
      p50AbsPct: 25,
      p90AbsPct: 40,
      p95AbsPct: 45,
    };
    const goodTree = {
      samples: 20,
      baselineMapePct: 25,
      learnedMapePct: 2,
      baselineRmsePct: 25,
      learnedRmsePct: 3,
      p50AbsPct: 1,
      p90AbsPct: 4,
      p95AbsPct: 5,
    };
    const weakNeural = {
      samples: 20,
      baselineMapePct: 25,
      learnedMapePct: 10,
      baselineRmsePct: 25,
      learnedRmsePct: 12,
      p50AbsPct: 8,
      p90AbsPct: 16,
      p95AbsPct: 20,
    };
    const w = weightsFromMetrics(base, goodTree, weakNeural);
    expect(w.analytical + w.tree + w.neural).toBeCloseTo(1, 8);
    expect(w.tree).toBeGreaterThan(w.neural);
    expect(w.tree).toBeGreaterThan(w.analytical);
  });
});
