import {
  evaluateLearnedEstimator,
  predictLearnedCycles,
  trainLearnedEstimator,
  type LearnedEstimatorMetrics,
  type LearnedEstimatorModel,
  type LearnedEstimatorSample,
} from "./learnedEstimator";
import {
  evaluateNeuralResidualEstimator,
  predictNeuralCycles,
  trainNeuralResidualEstimator,
  type NeuralResidualEstimatorModel,
} from "./neuralResidualEstimator";
import {
  evaluateDirectNeuralEstimator,
  predictDirectNeuralCycles,
  trainDirectNeuralEstimator,
  type DirectNeuralEstimatorModel,
} from "./directNeuralEstimator";
import {
  predictMultiTargetMetrics,
  trainMultiTargetEstimator,
} from "./multiTargetEstimator";
import { mean } from "./estimatorSuiteMath";
import {
  domainConfidenceForPrediction,
  keyOfArray,
  keyOfDataflow,
  keyOfWorkload,
  shapeSize,
  trainingDomain,
} from "./estimatorSuiteDomain";

import {
  averageWeights,
  baselineScore,
  buildAdaptiveStackWeights,
  evaluateAnalyticalEstimator,
  evaluateStackedRows,
  expCycles,
  finitePositive,
  logCycles,
  metricScore,
  metricsFromPredictions,
  normalizeWeights,
  optimizeStackedWeights,
  safeScore,
  selectAdaptiveStackWeights,
  weightedLogPrediction,
  weightsFromMetrics,
  type EnsemblePredictionRow,
} from "./estimatorSuiteStacking";
import {
  buildCycleCalibration,
  estimatorSuiteCalibrationFactor,
  selectCycleCalibrationLogBias,
} from "./estimatorSuiteCalibration";
export { evaluateAnalyticalEstimator, weightsFromMetrics } from "./estimatorSuiteStacking";
export { estimatorSuiteCalibrationFactor } from "./estimatorSuiteCalibration";


import type {
  EstimatorSuiteSplitKind,
  EstimatorSuiteModelName,
  EstimatorSuiteWeights,
  EstimatorSuiteSplitReport,
  EstimatorSuiteCycleCalibration,
  EstimatorSuiteAdaptiveStackWeights,
  EstimatorSuiteModel,
  TrainEstimatorSuiteOptions
} from "./estimatorSuiteTypes";
export type {
  EstimatorSuiteSplitKind,
  EstimatorSuiteModelName,
  EstimatorSuiteWeights,
  EstimatorSuiteSplitReport,
  EstimatorSuiteCycleCalibration,
  EstimatorSuiteAdaptiveStackWeights,
  EstimatorSuiteModel,
  TrainEstimatorSuiteOptions
} from "./estimatorSuiteTypes";


function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (1664525 * s + 1013904223) >>> 0;
    return s / 0x100000000;
  };
}

function shuffle<T>(items: T[], seed: number): T[] {
  const rand = rng(seed);
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function unique<T>(xs: T[]) {
  return Array.from(new Set(xs));
}
function cleanSamples(samples: LearnedEstimatorSample[]) {
  return samples.filter(
    (s) =>
      Number.isFinite(s.measuredCycles) &&
      s.measuredCycles > 0 &&
      Number.isFinite(s.estimatorCycles) &&
      s.estimatorCycles > 0,
  );
}

function downsample<T>(
  items: T[],
  maxSamples: number | undefined,
  seed: number,
) {
  if (!maxSamples || items.length <= maxSamples) return items;
  return shuffle(items, seed).slice(0, maxSamples);
}

export function predictEstimatorSuiteCycles(
  model: EstimatorSuiteModel,
  sample: LearnedEstimatorSample,
): number {
  const row: EnsemblePredictionRow = {
    sample,
    analytical: sample.estimatorCycles,
    tree: predictLearnedCycles(model.tree, sample),
    neural: predictNeuralCycles(model.neural, sample),
    direct: model.directNeural
      ? predictDirectNeuralCycles(model.directNeural, sample)
      : undefined,
  };
  const weights = selectAdaptiveStackWeights(
    model.blend?.adaptiveWeights,
    sample,
    model.blend?.weights ?? model.weights,
  );
  const stacked = weightedLogPrediction(row, weights, !!model.directNeural);
  const stackedLog = logCycles(stacked);
  const calibrated = expCycles(
    stackedLog +
      selectCycleCalibrationLogBias(model.calibration, sample, stackedLog),
  );
  const guard = model.blend?.domainGuard;
  if (!guard?.enabled) return calibrated;
  const confidence = domainConfidenceForPrediction(model, sample);
  const learnedWeight = confidence;
  const analyticalWeight =
    (1 - confidence) * guard.analyticalBlendAtMinConfidence;
  const norm = learnedWeight + analyticalWeight || 1;
  return expCycles(
    (learnedWeight / norm) * logCycles(calibrated) +
      (analyticalWeight / norm) * logCycles(row.analytical),
  );
}

export function predictEstimatorSuiteMetrics(
  model: EstimatorSuiteModel,
  sample: LearnedEstimatorSample,
) {
  return predictMultiTargetMetrics(model.multiTarget, sample);
}

export function evaluateEstimatorSuite(
  model: EstimatorSuiteModel,
  samples: LearnedEstimatorSample[],
): LearnedEstimatorMetrics {
  const rows = cleanSamples(samples);
  const baselineErr = rows.map(
    (s) => (s.estimatorCycles - s.measuredCycles) / s.measuredCycles,
  );
  const ensembleErr = rows.map(
    (s) =>
      (predictEstimatorSuiteCycles(model, s) - s.measuredCycles) /
      s.measuredCycles,
  );
  const abs = ensembleErr.map((e) => Math.abs(e)).sort((a, b) => a - b);
  const pct = (p: number) =>
    (abs[Math.min(abs.length - 1, Math.floor(abs.length * p))] ?? 0) * 100;
  return {
    samples: rows.length,
    baselineMapePct: mean(baselineErr.map((e) => Math.abs(e))) * 100,
    learnedMapePct: mean(ensembleErr.map((e) => Math.abs(e))) * 100,
    baselineRmsePct: Math.sqrt(mean(baselineErr.map((e) => e * e))) * 100,
    learnedRmsePct: Math.sqrt(mean(ensembleErr.map((e) => e * e))) * 100,
    p50AbsPct: pct(0.5),
    p90AbsPct: pct(0.9),
    p95AbsPct: pct(0.95),
  };
}

function predictionRows(
  samples: LearnedEstimatorSample[],
  tree: LearnedEstimatorModel,
  neural: NeuralResidualEstimatorModel,
  direct?: DirectNeuralEstimatorModel,
): EnsemblePredictionRow[] {
  return cleanSamples(samples).map((sample) => ({
    sample,
    analytical: sample.estimatorCycles,
    tree: predictLearnedCycles(tree, sample),
    neural: predictNeuralCycles(neural, sample),
    direct: direct ? predictDirectNeuralCycles(direct, sample) : undefined,
  }));
}

function evaluateWeightedEnsemble(
  samples: LearnedEstimatorSample[],
  tree: LearnedEstimatorModel,
  neural: NeuralResidualEstimatorModel,
  weights: EstimatorSuiteWeights,
  direct?: DirectNeuralEstimatorModel,
): LearnedEstimatorMetrics {
  return evaluateStackedRows(
    predictionRows(samples, tree, neural, direct),
    weights,
  );
}

function recommendModel(
  baseline: LearnedEstimatorMetrics,
  tree: LearnedEstimatorMetrics,
  neural: LearnedEstimatorMetrics,
  ensemble: LearnedEstimatorMetrics,
  direct?: LearnedEstimatorMetrics,
): EstimatorSuiteModelName {
  const scores: Array<[EstimatorSuiteModelName, number]> = [
    ["analytical", baselineScore(baseline)],
    ["tree-residual", safeScore(tree)],
    ["neural-residual", safeScore(neural)],
    ["ensemble", safeScore(ensemble)],
  ];
  if (direct) scores.push(["direct-neural", safeScore(direct)]);
  scores.sort((a, b) => a[1] - b[1]);
  return scores[0][0];
}

function makeSplit(
  samples: LearnedEstimatorSample[],
  kind: EstimatorSuiteSplitKind,
  seed: number,
):
  | {
      label: string;
      train: LearnedEstimatorSample[];
      test: LearnedEstimatorSample[];
    }
  | undefined {
  const rows = cleanSamples(samples);
  if (rows.length < 40) return undefined;
  if (kind === "random") {
    const shuffled = shuffle(rows, seed);
    const testN = Math.max(8, Math.floor(rows.length * 0.2));
    return {
      label: "random 80/20 holdout",
      test: shuffled.slice(0, testN),
      train: shuffled.slice(testN),
    };
  }
  if (kind === "workload") {
    const keys = shuffle(unique(rows.map(keyOfWorkload)), seed + 1);
    if (keys.length < 4) return undefined;
    const holdout = new Set(
      keys.slice(0, Math.max(1, Math.floor(keys.length * 0.2))),
    );
    return {
      label: "unseen workload/op holdout",
      test: rows.filter((s) => holdout.has(keyOfWorkload(s))),
      train: rows.filter((s) => !holdout.has(keyOfWorkload(s))),
    };
  }
  if (kind === "array") {
    const keys = shuffle(unique(rows.map(keyOfArray)), seed + 2);
    if (keys.length < 3) return undefined;
    const holdout = new Set(keys.slice(0, 1));
    return {
      label: `unseen array holdout (${Array.from(holdout).join(", ")})`,
      test: rows.filter((s) => holdout.has(keyOfArray(s))),
      train: rows.filter((s) => !holdout.has(keyOfArray(s))),
    };
  }
  if (kind === "dataflow") {
    const keys = shuffle(unique(rows.map(keyOfDataflow)), seed + 3);
    if (keys.length < 3) return undefined;
    const holdout = new Set(keys.slice(0, 1));
    return {
      label: `unseen dataflow holdout (${Array.from(holdout).join(", ")})`,
      test: rows.filter((s) => holdout.has(keyOfDataflow(s))),
      train: rows.filter((s) => !holdout.has(keyOfDataflow(s))),
    };
  }
  const sorted = rows.slice().sort((a, b) => shapeSize(a) - shapeSize(b));
  const cutoff = Math.floor(sorted.length * 0.8);
  return {
    label: "large-shape extrapolation holdout",
    train: sorted.slice(0, cutoff),
    test: sorted.slice(cutoff),
  };
}

function splitIsUsable(split: {
  train: LearnedEstimatorSample[];
  test: LearnedEstimatorSample[];
}) {
  return split.train.length >= 32 && split.test.length >= 8;
}

export function trainEstimatorSuite(
  samples: LearnedEstimatorSample[],
  opts: TrainEstimatorSuiteOptions = {},
): EstimatorSuiteModel {
  const clean = cleanSamples(samples);
  if (clean.length < 40)
    throw new Error(
      `Need at least 40 valid samples to train estimator suite; got ${clean.length}`,
    );
  const seed = opts.seed ?? 42;
  const trees = opts.trees ?? 160;
  const maxDepth = opts.maxDepth ?? 10;
  const minLeaf =
    opts.minLeaf ?? Math.max(4, Math.floor(Math.sqrt(clean.length) / 8));
  const hiddenUnits = opts.hiddenUnits ?? 64;
  const epochs = opts.epochs ?? 900;
  const learningRate = opts.learningRate ?? 0.01;
  const l2 = opts.l2 ?? 0.0001;
  const splitKinds = opts.splitKinds ?? [
    "random",
    "workload",
    "array",
    "dataflow",
    "large-shape",
  ];

  const validationSuite: EstimatorSuiteSplitReport[] = [];
  const outOfFoldRows: EnsemblePredictionRow[] = [];
  opts.progress?.({
    stage: "validating",
    message: `Estimator Suite 학습 시작: valid samples=${clean.length}, splits=${splitKinds.join(",")}`,
    progress: 5,
  });
  for (let i = 0; i < splitKinds.length; i++) {
    const split = makeSplit(clean, splitKinds[i], seed + i * 101);
    if (!split || !splitIsUsable(split)) {
      opts.progress?.({
        stage: "validating",
        message: `${splitKinds[i]} split 건너뜀: train/test sample 부족`,
        progress: 10 + i * 8,
      });
      continue;
    }
    const trainRows = downsample(
      split.train,
      opts.maxSplitTrainSamples,
      seed + i * 997,
    );
    opts.progress?.({
      stage: "validating",
      message: `${splitKinds[i]} split 준비: train=${trainRows.length}, test=${split.test.length}`,
      progress: 10 + i * 8,
    });
    const tree = trainLearnedEstimator(trainRows, {
      trees: Math.max(24, Math.floor(trees / 2)),
      maxDepth,
      minLeaf,
      seed: seed + i * 11,
      validationFraction: 0.15,
      progress: (e) =>
        opts.progress?.({
          ...e,
          message: `[${splitKinds[i]}] ${e.message}`,
          progress: 10 + i * 8 + Math.min(3, (e.progress ?? 0) * 0.03),
        }),
    });
    const neural = trainNeuralResidualEstimator(trainRows, {
      hiddenUnits,
      epochs: Math.max(80, Math.floor(epochs / 2)),
      learningRate,
      l2,
      seed: seed + i * 13,
      validationFraction: 0.15,
      progress: (e) =>
        opts.progress?.({
          ...e,
          message: `[${splitKinds[i]}] ${e.message}`,
          progress: 13 + i * 8 + Math.min(2, (e.progress ?? 0) * 0.02),
        }),
    });
    const directNeural = trainDirectNeuralEstimator(trainRows, {
      hiddenUnits,
      epochs: Math.max(80, Math.floor(epochs / 2)),
      learningRate,
      l2,
      seed: seed + i * 17,
      validationFraction: 0.15,
      progress: (e) =>
        opts.progress?.({
          ...e,
          message: `[${splitKinds[i]}] ${e.message}`,
          progress: 15 + i * 8 + Math.min(2, (e.progress ?? 0) * 0.02),
        }),
    });
    const baseline = evaluateAnalyticalEstimator(split.test);
    const treeMetrics = evaluateLearnedEstimator(tree, split.test);
    const neuralMetrics = evaluateNeuralResidualEstimator(neural, split.test);
    const directMetrics = evaluateDirectNeuralEstimator(
      directNeural,
      split.test,
    );
    const metricWeights = weightsFromMetrics(
      baseline,
      treeMetrics,
      neuralMetrics,
      directMetrics,
    );
    const splitPredictionRows = predictionRows(
      split.test,
      tree,
      neural,
      directNeural,
    );
    const optimized = optimizeStackedWeights(
      splitPredictionRows,
      metricWeights,
    );
    outOfFoldRows.push(...splitPredictionRows);
    const weights = optimized.weights;
    const ensembleMetrics = optimized.metrics;
    const recommended = recommendModel(
      baseline,
      treeMetrics,
      neuralMetrics,
      ensembleMetrics,
      directMetrics,
    );
    opts.progress?.({
      stage: "validating",
      message: `${splitKinds[i]} split 평가 완료: analytical MAPE=${baseline.learnedMapePct.toFixed(2)}%, tree=${treeMetrics.learnedMapePct.toFixed(2)}%, residual-neural=${neuralMetrics.learnedMapePct.toFixed(2)}%, direct-neural=${directMetrics.learnedMapePct.toFixed(2)}%, stacked-ensemble=${ensembleMetrics.learnedMapePct.toFixed(2)}%, 추천=${recommended}`,
      progress: 16 + i * 8,
    });
    validationSuite.push({
      kind: splitKinds[i],
      label: split.label,
      trainSamples: trainRows.length,
      testSamples: split.test.length,
      baseline,
      tree: treeMetrics,
      neural: neuralMetrics,
      ensemble: ensembleMetrics,
      weights,
      recommended,
    });
  }

  const finalTrainRows = downsample(
    clean,
    opts.maxFinalTrainSamples ?? 20000,
    seed + 404,
  );
  opts.progress?.({
    stage: "training-tree",
    message: `최종 Tree residual 학습 시작: train=${finalTrainRows.length}, trees=${trees}, maxDepth=${maxDepth}`,
    progress: 58,
  });
  const tree = trainLearnedEstimator(finalTrainRows, {
    trees,
    maxDepth,
    minLeaf,
    seed,
    validationFraction: opts.validationFraction ?? 0.2,
    progress: (e) =>
      opts.progress?.({
        ...e,
        progress: 58 + Math.min(16, (e.progress ?? 0) * 0.16),
      }),
  });
  opts.progress?.({
    stage: "training-neural",
    message: `최종 Neural residual 학습 시작: train=${finalTrainRows.length}, hidden=${hiddenUnits}, epochs=${epochs}`,
    progress: 74,
  });
  const neural = trainNeuralResidualEstimator(finalTrainRows, {
    hiddenUnits,
    epochs,
    learningRate,
    l2,
    seed,
    validationFraction: opts.validationFraction ?? 0.2,
    progress: (e) =>
      opts.progress?.({
        ...e,
        progress: 74 + Math.min(8, (e.progress ?? 0) * 0.08),
      }),
  });
  opts.progress?.({
    stage: "training-neural",
    message: `최종 Direct Neural cycle 학습 시작: train=${finalTrainRows.length}, hidden=${hiddenUnits}, epochs=${epochs}`,
    progress: 82,
  });
  const directNeural = trainDirectNeuralEstimator(finalTrainRows, {
    hiddenUnits,
    epochs,
    learningRate,
    l2,
    seed: seed + 17,
    validationFraction: opts.validationFraction ?? 0.2,
    progress: (e) =>
      opts.progress?.({
        ...e,
        progress: 82 + Math.min(8, (e.progress ?? 0) * 0.08),
      }),
  });
  opts.progress?.({
    stage: "training-neural",
    message: "Multi-target SRAM/DRAM/utilization 학습 준비 중",
    progress: 90,
  });
  const multiTarget = trainMultiTargetEstimator(finalTrainRows, {
    hiddenUnits: Math.max(16, Math.floor(hiddenUnits / 2)),
    epochs: Math.max(120, Math.floor(epochs / 2)),
    learningRate,
    l2,
    seed: seed + 29,
    minSamples: 40,
    validationFraction: opts.validationFraction ?? 0.2,
    progress: (e) =>
      opts.progress?.({
        ...e,
        progress: 90 + Math.min(4, (e.progress ?? 0) * 0.04),
      }),
  });
  const avg = (
    pick: (r: EstimatorSuiteSplitReport) => LearnedEstimatorMetrics,
  ) => {
    const ms = validationSuite.map(pick);
    if (!ms.length) return undefined;
    return {
      samples: Math.round(mean(ms.map((m) => m.samples))),
      baselineMapePct: mean(ms.map((m) => m.baselineMapePct)),
      learnedMapePct: mean(ms.map((m) => m.learnedMapePct)),
      baselineRmsePct: mean(ms.map((m) => m.baselineRmsePct)),
      learnedRmsePct: mean(ms.map((m) => m.learnedRmsePct)),
      p50AbsPct: mean(ms.map((m) => m.p50AbsPct)),
      p90AbsPct: mean(ms.map((m) => m.p90AbsPct)),
      p95AbsPct: mean(ms.map((m) => m.p95AbsPct)),
    } satisfies LearnedEstimatorMetrics;
  };
  const baselineAvg =
    avg((r) => r.baseline) ?? evaluateAnalyticalEstimator(clean);
  const treeAvg = avg((r) => r.tree) ?? evaluateLearnedEstimator(tree, clean);
  const neuralAvg =
    avg((r) => r.neural) ?? evaluateNeuralResidualEstimator(neural, clean);
  const directAvg = evaluateDirectNeuralEstimator(directNeural, clean);
  opts.progress?.({
    stage: "validating",
    message: "최종 ensemble weight 계산 중",
    progress: 92,
  });
  const metricWeights = weightsFromMetrics(
    baselineAvg,
    treeAvg,
    neuralAvg,
    directAvg,
  );
  const splitOptimizedWeights = validationSuite.map((r) => r.weights);
  const hasDirect = !!directNeural;
  const finalStackRows = predictionRows(
    finalTrainRows,
    tree,
    neural,
    directNeural,
  );
  const averagedWeights = averageWeights(splitOptimizedWeights, hasDirect);
  const finalOptimized = optimizeStackedWeights(
    finalStackRows,
    averagedWeights,
  );
  const weights = normalizeWeights(
    {
      analytical:
        0.35 * metricWeights.analytical +
        0.45 * averagedWeights.analytical +
        0.2 * finalOptimized.weights.analytical,
      tree:
        0.35 * metricWeights.tree +
        0.45 * averagedWeights.tree +
        0.2 * finalOptimized.weights.tree,
      neural:
        0.35 * metricWeights.neural +
        0.45 * averagedWeights.neural +
        0.2 * finalOptimized.weights.neural,
      directNeural:
        0.35 * (metricWeights.directNeural ?? 0) +
        0.45 * (averagedWeights.directNeural ?? 0) +
        0.2 * (finalOptimized.weights.directNeural ?? 0),
    },
    hasDirect,
  );
  const calibrationRows = outOfFoldRows.length ? outOfFoldRows : finalStackRows;
  const adaptiveWeights = buildAdaptiveStackWeights(calibrationRows, weights);
  const calibration = buildCycleCalibration(
    calibrationRows,
    weights,
    adaptiveWeights,
  );
  const blendValidation =
    calibration?.validation ??
    adaptiveWeights?.validation ??
    avg((r) => r.ensemble) ??
    finalOptimized.metrics;
  const blend = {
    mode: "log-space-geometric" as const,
    weights,
    adaptiveWeights,
    domainGuard: {
      enabled: true,
      minConfidence: 0.35,
      analyticalBlendAtMinConfidence: 0.7,
    },
    validation: blendValidation,
  };
  const pseudoModel = {
    kind: "tileforge-estimator-suite-v1",
    createdAt: new Date().toISOString(),
    target: "log_measured_over_estimator",
    tree,
    neural,
    directNeural,
    multiTarget,
    weights,
    blend,
    calibration,
    recommended: "ensemble",
    validationSuite,
    metadata: {
      samples: clean.length,
      trainSamples: finalTrainRows.length,
      seed,
      trees,
      maxDepth,
      minLeaf,
      hiddenUnits,
      epochs,
      learningRate,
      l2,
      strategy: "multi_target_hybrid_estimator",
      featureDomain: trainingDomain(clean),
    },
  } as EstimatorSuiteModel;
  const ensembleAvg =
    blend.validation ?? evaluateEstimatorSuite(pseudoModel, clean);
  const recommended = recommendModel(
    baselineAvg,
    treeAvg,
    neuralAvg,
    ensembleAvg,
    directAvg,
  );
  opts.progress?.({
    stage: "validating",
    message: `Estimator Suite 완료: log-stack weights analytical=${weights.analytical.toFixed(3)}, tree=${weights.tree.toFixed(3)}, neural=${weights.neural.toFixed(3)}, direct=${(weights.directNeural ?? 0).toFixed(3)}, adaptive=${adaptiveWeights?.buckets.length ?? 0}, 추천=${recommended}`,
    progress: 98,
  });
  return { ...pseudoModel, recommended };
}

export function estimatorSuitePredictionRows(
  samples: LearnedEstimatorSample[],
  model: EstimatorSuiteModel,
) {
  return cleanSamples(samples).map((s) => {
    const treeCycles = predictLearnedCycles(model.tree, s);
    const neuralCycles = predictNeuralCycles(model.neural, s);
    const directNeuralCycles = model.directNeural
      ? predictDirectNeuralCycles(model.directNeural, s)
      : undefined;
    const ensembleCycles = predictEstimatorSuiteCycles(model, s);
    return {
      ...s,
      analyticalCycles: s.estimatorCycles,
      treeCycles,
      neuralCycles,
      directNeuralCycles,
      ensembleCycles,
      ensembleMode: model.blend?.mode ?? "linear-legacy",
      calibrationFactor: estimatorSuiteCalibrationFactor(model, s),
      predictedSramBytes: predictEstimatorSuiteMetrics(model, s).sramBytes,
      predictedDramBytes: predictEstimatorSuiteMetrics(model, s).dramBytes,
      predictedUtilization: predictEstimatorSuiteMetrics(model, s).utilization,
      analyticalAbsPct:
        Math.abs((s.estimatorCycles - s.measuredCycles) / s.measuredCycles) *
        100,
      treeAbsPct:
        Math.abs((treeCycles - s.measuredCycles) / s.measuredCycles) * 100,
      neuralAbsPct:
        Math.abs((neuralCycles - s.measuredCycles) / s.measuredCycles) * 100,
      directNeuralAbsPct:
        directNeuralCycles === undefined
          ? undefined
          : Math.abs(
              (directNeuralCycles - s.measuredCycles) / s.measuredCycles,
            ) * 100,
      ensembleAbsPct:
        Math.abs((ensembleCycles - s.measuredCycles) / s.measuredCycles) * 100,
    };
  });
}

export function summarizeSuiteValidation(model: EstimatorSuiteModel) {
  return model.validationSuite.map((r) => ({
    split: r.kind,
    label: r.label,
    trainSamples: r.trainSamples,
    testSamples: r.testSamples,
    baselineMapePct: r.baseline.learnedMapePct,
    treeMapePct: r.tree.learnedMapePct,
    neuralMapePct: r.neural.learnedMapePct,
    ensembleMapePct: r.ensemble.learnedMapePct,
    baselineP90Pct: r.baseline.p90AbsPct,
    treeP90Pct: r.tree.p90AbsPct,
    neuralP90Pct: r.neural.p90AbsPct,
    ensembleP90Pct: r.ensemble.p90AbsPct,
    recommended: r.recommended,
    analyticalWeight: r.weights.analytical,
    treeWeight: r.weights.tree,
    neuralWeight: r.weights.neural,
    directNeuralWeight: r.weights.directNeural ?? 0,
  }));
}
