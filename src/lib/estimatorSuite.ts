import {
  evaluateLearnedEstimator,
  predictLearnedCycles,
  trainLearnedEstimator,
  type LearnedEstimatorMetrics,
  type LearnedEstimatorModel,
  type LearnedEstimatorSample,
  type TrainLearnedEstimatorOptions,
} from "./learnedEstimator";
import {
  evaluateNeuralResidualEstimator,
  predictNeuralCycles,
  trainNeuralResidualEstimator,
  type NeuralResidualEstimatorModel,
  type TrainNeuralResidualOptions,
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
  type MultiTargetEstimatorModel,
} from "./multiTargetEstimator";

export type EstimatorSuiteSplitKind =
  | "random"
  | "workload"
  | "array"
  | "dataflow"
  | "large-shape";
export type EstimatorSuiteModelName =
  | "analytical"
  | "tree-residual"
  | "neural-residual"
  | "direct-neural"
  | "ensemble";

export interface EstimatorSuiteWeights {
  analytical: number;
  tree: number;
  neural: number;
  directNeural?: number;
}

export interface EstimatorSuiteSplitReport {
  kind: EstimatorSuiteSplitKind;
  label: string;
  trainSamples: number;
  testSamples: number;
  baseline: LearnedEstimatorMetrics;
  tree: LearnedEstimatorMetrics;
  neural: LearnedEstimatorMetrics;
  ensemble: LearnedEstimatorMetrics;
  weights: EstimatorSuiteWeights;
  recommended: EstimatorSuiteModelName;
}

export interface EstimatorSuiteCycleCalibration {
  mode: "oof-log-residual-bucket";
  /** Multiplicative median correction in log space; applied as cycles *= exp(logBias). */
  globalLogBias: number;
  /** Safety clamp for any correction selected at prediction time. */
  clampLogBias: number;
  minBucketSamples: number;
  shrinkage: number;
  buckets: Array<{
    kind:
      | "dataflow"
      | "array"
      | "dataflow-array"
      | "regime"
      | "dataflow-regime";
    key: string;
    samples: number;
    logBias: number;
  }>;
  /**
   * v17 prediction-scale trend correction. OOF residuals often drift with
   * problem size: small GEMMs can be overhead-dominated while large GEMMs can
   * be memory/tiling dominated. This term corrects a smooth residual trend as
   * a function of log(predicted cycles), then buckets/local KNN handle the
   * categorical and nearby-shape residuals.
   */
  scaleTrend?: {
    mode: "log-predicted-cycle-trend";
    meanLogPredicted: number;
    slope: number;
    blend: number;
    validation?: LearnedEstimatorMetrics;
  };
  /**
   * v18 resource-pressure trend correction.  Residuals can drift with SRAM
   * fit, arithmetic intensity, and effective DRAM bandwidth even after the
   * generic prediction-size trend is removed.  This small ridge-linear term is
   * learned from OOF residuals and validation-gated, so it only activates when
   * it improves held-out error.
   */
  resourceTrend?: {
    mode: "resource-pressure-linear";
    featureNames: string[];
    means: number[];
    stds: number[];
    coefficients: number[];
    blend: number;
    validation?: LearnedEstimatorMetrics;
  };
  /**
   * v19 tiling-geometry trend correction.  SCALE-Sim cycle ratios often jump
   * around ceil-div tile boundaries: edge tiles, padding waste, and a high
   * number of waves can add overhead that smooth resource features miss.
   * This term learns a tiny ridge-linear correction from OOF residuals and is
   * validation-gated together with the other calibration layers.
   */
  tilingTrend?: {
    mode: "tiling-geometry-linear";
    featureNames: string[];
    means: number[];
    stds: number[];
    coefficients: number[];
    blend: number;
    validation?: LearnedEstimatorMetrics;
  };
  /**
   * v16 local correction prototypes. Each point is an out-of-fold residual, stored
   * in normalized feature space so nearby hardware/workload/tile samples can
   * correct smooth local bias that coarse dataflow/array buckets cannot capture.
   */
  local?: {
    mode: "knn-log-residual";
    featureNames: string[];
    means: number[];
    stds: number[];
    prototypes: Array<{
      features: number[];
      logResidual: number;
    }>;
    k: number;
    minNeighbors: number;
    maxDistance: number;
    blend: number;
  };
  validation?: LearnedEstimatorMetrics;
}

export interface EstimatorSuiteAdaptiveStackWeights {
  mode: "oof-domain-adaptive-stack";
  minBucketSamples: number;
  shrinkage: number;
  buckets: Array<{
    kind:
      | "dataflow"
      | "array"
      | "regime"
      | "dataflow-regime"
      | "dataflow-array";
    key: string;
    samples: number;
    weights: EstimatorSuiteWeights;
    validation: LearnedEstimatorMetrics;
  }>;
  validation?: LearnedEstimatorMetrics;
}

export interface EstimatorSuiteModel {
  kind: "tileforge-estimator-suite-v1";
  createdAt: string;
  target: "log_measured_over_estimator";
  tree: LearnedEstimatorModel;
  neural: NeuralResidualEstimatorModel;
  /** Optional v2 component: predicts log(measuredCycles) directly instead of residual. */
  directNeural?: DirectNeuralEstimatorModel;
  /** Optional v3 component: separately predicts SRAM/DRAM/utilization targets when CSV columns exist. */
  multiTarget?: MultiTargetEstimatorModel;
  weights: EstimatorSuiteWeights;
  /** Optional v2/v3 stacker: tuned on split holdouts; improves MAPE/P90 over static inverse-error weights. */
  blend?: {
    mode: "log-space-geometric";
    weights: EstimatorSuiteWeights;
    domainGuard: {
      enabled: boolean;
      minConfidence: number;
      analyticalBlendAtMinConfidence: number;
    };
    validation?: LearnedEstimatorMetrics;
    /** Optional v20 adaptive stacking: choose smoothed OOF-tuned weights for the current domain bucket. */
    adaptiveWeights?: EstimatorSuiteAdaptiveStackWeights;
  };
  /** Optional v4 post-stack calibration learned from out-of-fold split residuals. */
  calibration?: EstimatorSuiteCycleCalibration;
  recommended: EstimatorSuiteModelName;
  validationSuite: EstimatorSuiteSplitReport[];
  metadata: {
    samples: number;
    trainSamples: number;
    seed: number;
    trees: number;
    maxDepth: number;
    minLeaf: number;
    hiddenUnits: number;
    epochs: number;
    learningRate: number;
    l2: number;
    strategy:
      | "analytical_plus_residual_ensemble"
      | "hybrid_residual_and_direct_neural"
      | "multi_target_hybrid_estimator";
    /** Training-domain summary used to damp neural predictions outside the sampled space. */
    featureDomain?: {
      numeric: Record<string, { min: number; max: number }>;
      arrays: string[];
      dataflows: string[];
      workloads: string[];
      opNames: string[];
    };
  };
}

export interface TrainEstimatorSuiteOptions
  extends TrainLearnedEstimatorOptions, TrainNeuralResidualOptions {
  hiddenUnits?: number;
  epochs?: number;
  learningRate?: number;
  l2?: number;
  maxSplitTrainSamples?: number;
  maxFinalTrainSamples?: number;
  splitKinds?: EstimatorSuiteSplitKind[];
}

function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0;
}
function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}
function safeScore(m: LearnedEstimatorMetrics) {
  return Math.max(0.01, m.learnedMapePct + 0.25 * m.p90AbsPct);
}
function baselineScore(m: LearnedEstimatorMetrics) {
  return Math.max(0.01, m.baselineMapePct + 0.25 * m.baselineRmsePct);
}
function normalizeWeights(
  weights: EstimatorSuiteWeights,
  hasDirect: boolean,
): Required<EstimatorSuiteWeights> {
  const direct = hasDirect ? Math.max(0, weights.directNeural ?? 0) : 0;
  const analytical = Math.max(0, weights.analytical ?? 0);
  const tree = Math.max(0, weights.tree ?? 0);
  const neural = Math.max(0, weights.neural ?? 0);
  const sum = analytical + tree + neural + direct || 1;
  return {
    analytical: analytical / sum,
    tree: tree / sum,
    neural: neural / sum,
    directNeural: direct / sum,
  };
}

function finitePositive(x: number) {
  return Number.isFinite(x) && x > 0;
}
function logCycles(x: number) {
  return Math.log(Math.max(1, x));
}
function expCycles(x: number) {
  return Math.max(
    1,
    Math.round(Math.exp(clamp(x, Math.log(1), Math.log(1e15)))),
  );
}

interface EnsemblePredictionRow {
  sample: LearnedEstimatorSample;
  analytical: number;
  tree: number;
  neural: number;
  direct?: number;
}

function weightedLogPrediction(
  row: EnsemblePredictionRow,
  weights: EstimatorSuiteWeights,
  hasDirect: boolean,
) {
  const w = normalizeWeights(
    weights,
    hasDirect && finitePositive(row.direct ?? 0),
  );
  const directLog = finitePositive(row.direct ?? 0)
    ? logCycles(row.direct!)
    : 0;
  return expCycles(
    w.analytical * logCycles(row.analytical) +
      w.tree * logCycles(row.tree) +
      w.neural * logCycles(row.neural) +
      w.directNeural * directLog,
  );
}

function metricsFromPredictions(
  rows: LearnedEstimatorSample[],
  predictions: number[],
): LearnedEstimatorMetrics {
  const clean = rows
    .map((s, i) => ({ s, p: predictions[i] }))
    .filter(
      (r) =>
        finitePositive(r.s.measuredCycles) &&
        finitePositive(r.s.estimatorCycles) &&
        finitePositive(r.p),
    );
  const baselineErr = clean.map(
    (r) => (r.s.estimatorCycles - r.s.measuredCycles) / r.s.measuredCycles,
  );
  const predErr = clean.map(
    (r) => (r.p - r.s.measuredCycles) / r.s.measuredCycles,
  );
  const abs = predErr.map((e) => Math.abs(e)).sort((a, b) => a - b);
  const pct = (p: number) =>
    (abs[Math.min(abs.length - 1, Math.floor(abs.length * p))] ?? 0) * 100;
  return {
    samples: clean.length,
    baselineMapePct: mean(baselineErr.map((e) => Math.abs(e))) * 100,
    learnedMapePct: mean(predErr.map((e) => Math.abs(e))) * 100,
    baselineRmsePct: Math.sqrt(mean(baselineErr.map((e) => e * e))) * 100,
    learnedRmsePct: Math.sqrt(mean(predErr.map((e) => e * e))) * 100,
    p50AbsPct: pct(0.5),
    p90AbsPct: pct(0.9),
    p95AbsPct: pct(0.95),
  };
}

function metricScore(m: LearnedEstimatorMetrics) {
  return Math.max(
    0.001,
    m.learnedMapePct + 0.3 * m.p90AbsPct + 0.1 * m.learnedRmsePct,
  );
}

function evaluateStackedRows(
  rows: EnsemblePredictionRow[],
  weights: EstimatorSuiteWeights,
): LearnedEstimatorMetrics {
  const hasDirect = rows.some((r) => finitePositive(r.direct ?? 0));
  return metricsFromPredictions(
    rows.map((r) => r.sample),
    rows.map((r) => weightedLogPrediction(r, weights, hasDirect)),
  );
}

function median(xs: number[]) {
  const s = xs
    .filter(Number.isFinite)
    .slice()
    .sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : 0;
}

function percentile(xs: number[], p: number) {
  const s = xs
    .filter(Number.isFinite)
    .slice()
    .sort((a, b) => a - b);
  if (!s.length) return 0;
  return s[Math.min(s.length - 1, Math.max(0, Math.floor(s.length * p)))];
}

function variance(xs: number[]) {
  if (xs.length < 2) return 0;
  const m = mean(xs);
  return mean(xs.map((x) => (x - m) ** 2));
}

function covariance(xs: number[], ys: number[]) {
  if (xs.length !== ys.length || xs.length < 2) return 0;
  const mx = mean(xs);
  const my = mean(ys);
  return mean(xs.map((x, i) => (x - mx) * (ys[i] - my)));
}

const RESOURCE_TREND_FEATURES = [
  "logSramPressure",
  "logArithmeticIntensity",
  "logBandwidthPerMac",
] as const;

type ResourceTrendFeature = (typeof RESOURCE_TREND_FEATURES)[number];

function resourceTrendFeature(
  sample: LearnedEstimatorSample,
  name: ResourceTrendFeature,
): number {
  const m = Math.max(1, Number(sample.m) || 1);
  const n = Math.max(1, Number(sample.n) || 1);
  const k = Math.max(1, Number(sample.k) || 1);
  const tileM = Math.max(1, Number(sample.tileM) || 1);
  const tileN = Math.max(1, Number(sample.tileN) || 1);
  const tileK = Math.max(1, Number(sample.tileK) || 1);
  const dtype = Math.max(1, Number(sample.dtypeBytes) || 1);
  const tileBytes = Math.max(
    1,
    (tileM * tileK + tileK * tileN + tileM * tileN) * dtype,
  );
  const sramBytes = Math.max(1, (Number(sample.sramKB) || 0) * 1024);
  const ops = Math.max(1, 2 * m * n * k);
  const trafficBytes = Math.max(1, (m * k + k * n + m * n) * dtype);
  const macsPerSecond =
    Math.max(1, Number(sample.arrayRows) || 1) *
    Math.max(1, Number(sample.arrayCols) || 1) *
    Math.max(1, Number(sample.frequencyMHz) || 1) *
    1e6;
  const bandwidthBytesPerSecond =
    Math.max(0, Number(sample.memoryBandwidthGBs) || 0) * 1e9;
  if (name === "logSramPressure") return Math.log(tileBytes / sramBytes);
  if (name === "logArithmeticIntensity") return Math.log(ops / trafficBytes);
  return Math.log((bandwidthBytesPerSecond + 1) / macsPerSecond);
}

function solveLinearSystem(a: number[][], b: number[]): number[] | undefined {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i]]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(m[r][col]) > Math.abs(m[pivot][col])) pivot = r;
    }
    if (Math.abs(m[pivot][col]) < 1e-10) return undefined;
    [m[col], m[pivot]] = [m[pivot], m[col]];
    const div = m[col][col];
    for (let c = col; c <= n; c++) m[col][c] /= div;
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const factor = m[r][col];
      for (let c = col; c <= n; c++) m[r][c] -= factor * m[col][c];
    }
  }
  return m.map((row) => row[n]);
}

function fitResourceTrend(
  valid: Array<{ sample: LearnedEstimatorSample; logResidual: number }>,
  globalLogBias: number,
  clampLogBias: number,
): EstimatorSuiteCycleCalibration["resourceTrend"] | undefined {
  if (valid.length < 36) return undefined;
  const raw = valid.map((row) =>
    RESOURCE_TREND_FEATURES.map((name) =>
      resourceTrendFeature(row.sample, name),
    ),
  );
  const means = RESOURCE_TREND_FEATURES.map((_, j) =>
    mean(raw.map((r) => r[j])),
  );
  const stds = RESOURCE_TREND_FEATURES.map((_, j) => {
    const v = mean(raw.map((r) => (r[j] - means[j]) ** 2));
    return Math.sqrt(Math.max(1e-9, v)) || 1;
  });
  const x = raw.map((r) =>
    r.map((v, j) => clamp((v - means[j]) / Math.max(1e-9, stds[j]), -6, 6)),
  );
  const y = valid.map((row) =>
    clamp(row.logResidual - globalLogBias, -clampLogBias, clampLogBias),
  );
  const cols = RESOURCE_TREND_FEATURES.length;
  const lambda = valid.length < 120 ? 4 : 2;
  const xtx = Array.from({ length: cols }, (_, i) =>
    Array.from(
      { length: cols },
      (_, j) =>
        mean(x.map((row) => row[i] * row[j])) +
        (i === j ? lambda / valid.length : 0),
    ),
  );
  const xty = Array.from({ length: cols }, (_, i) =>
    mean(x.map((row, r) => row[i] * y[r])),
  );
  const solved = solveLinearSystem(xtx, xty);
  if (!solved) return undefined;
  const coefficients = solved.map((c) => clamp(c, -0.18, 0.18));
  if (coefficients.every((c) => Math.abs(c) < 0.004)) return undefined;
  return {
    mode: "resource-pressure-linear",
    featureNames: [...RESOURCE_TREND_FEATURES],
    means,
    stds,
    coefficients,
    blend: 0.5,
  };
}

function resourceTrendLogBias(
  resourceTrend: EstimatorSuiteCycleCalibration["resourceTrend"] | undefined,
  sample: LearnedEstimatorSample,
  clampLogBias: number,
): number {
  if (!resourceTrend) return 0;
  const raw = resourceTrend.featureNames.map((name, j) => {
    const feature = resourceTrendFeature(sample, name as ResourceTrendFeature);
    return clamp(
      (feature - (resourceTrend.means[j] ?? 0)) /
        Math.max(1e-9, resourceTrend.stds[j] ?? 1),
      -6,
      6,
    );
  });
  const correction = raw.reduce(
    (sum, x, j) => sum + x * (resourceTrend.coefficients[j] ?? 0),
    0,
  );
  return clamp(resourceTrend.blend * correction, -clampLogBias, clampLogBias);
}

const TILING_TREND_FEATURES = [
  "logPaddingWaste",
  "logTileWaves",
  "edgeTileRatio",
  "arrayTileFit",
] as const;

type TilingTrendFeature = (typeof TILING_TREND_FEATURES)[number];

function ceilDiv(a: number, b: number) {
  return Math.max(1, Math.ceil(Math.max(1, a) / Math.max(1, b)));
}

function tilingTrendFeature(
  sample: LearnedEstimatorSample,
  name: TilingTrendFeature,
): number {
  const m = Math.max(1, Number(sample.m) || 1);
  const n = Math.max(1, Number(sample.n) || 1);
  const k = Math.max(1, Number(sample.k) || 1);
  const tileM = Math.max(1, Number(sample.tileM) || 1);
  const tileN = Math.max(1, Number(sample.tileN) || 1);
  const tileK = Math.max(1, Number(sample.tileK) || 1);
  const wavesM = ceilDiv(m, tileM);
  const wavesN = ceilDiv(n, tileN);
  const wavesK = ceilDiv(k, tileK);
  const paddedOps = wavesM * tileM * wavesN * tileN * wavesK * tileK;
  const trueOps = Math.max(1, m * n * k);
  const edgeAxes =
    (m % tileM === 0 ? 0 : 1) +
    (n % tileN === 0 ? 0 : 1) +
    (k % tileK === 0 ? 0 : 1);
  if (name === "logPaddingWaste") {
    return Math.log(Math.max(1, paddedOps / trueOps));
  }
  if (name === "logTileWaves") {
    return Math.log1p(wavesM * wavesN * wavesK);
  }
  if (name === "edgeTileRatio") {
    return edgeAxes / 3;
  }
  const arrayRows = Math.max(1, Number(sample.arrayRows) || 1);
  const arrayCols = Math.max(1, Number(sample.arrayCols) || 1);
  const rowFit = Math.min(tileM, arrayRows) / Math.max(tileM, arrayRows);
  const colFit = Math.min(tileN, arrayCols) / Math.max(tileN, arrayCols);
  return rowFit * colFit;
}

function fitTilingTrend(
  valid: Array<{ sample: LearnedEstimatorSample; logResidual: number }>,
  globalLogBias: number,
  clampLogBias: number,
): EstimatorSuiteCycleCalibration["tilingTrend"] | undefined {
  if (valid.length < 36) return undefined;
  const raw = valid.map((row) =>
    TILING_TREND_FEATURES.map((name) => tilingTrendFeature(row.sample, name)),
  );
  const means = TILING_TREND_FEATURES.map((_, j) => mean(raw.map((r) => r[j])));
  const stds = TILING_TREND_FEATURES.map((_, j) => {
    const v = mean(raw.map((r) => (r[j] - means[j]) ** 2));
    return Math.sqrt(Math.max(1e-9, v)) || 1;
  });
  const x = raw.map((r) =>
    r.map((v, j) => clamp((v - means[j]) / Math.max(1e-9, stds[j]), -6, 6)),
  );
  const y = valid.map((row) =>
    clamp(row.logResidual - globalLogBias, -clampLogBias, clampLogBias),
  );
  const cols = TILING_TREND_FEATURES.length;
  const lambda = valid.length < 120 ? 4.5 : 2.5;
  const xtx = Array.from({ length: cols }, (_, i) =>
    Array.from(
      { length: cols },
      (_, j) =>
        mean(x.map((row) => row[i] * row[j])) +
        (i === j ? lambda / valid.length : 0),
    ),
  );
  const xty = Array.from({ length: cols }, (_, i) =>
    mean(x.map((row, r) => row[i] * y[r])),
  );
  const solved = solveLinearSystem(xtx, xty);
  if (!solved) return undefined;
  const coefficients = solved.map((c) => clamp(c, -0.16, 0.16));
  if (coefficients.every((c) => Math.abs(c) < 0.004)) return undefined;
  return {
    mode: "tiling-geometry-linear",
    featureNames: [...TILING_TREND_FEATURES],
    means,
    stds,
    coefficients,
    blend: 0.5,
  };
}

function tilingTrendLogBias(
  tilingTrend: EstimatorSuiteCycleCalibration["tilingTrend"] | undefined,
  sample: LearnedEstimatorSample,
  clampLogBias: number,
): number {
  if (!tilingTrend) return 0;
  const raw = tilingTrend.featureNames.map((name, j) => {
    const feature = tilingTrendFeature(sample, name as TilingTrendFeature);
    return clamp(
      (feature - (tilingTrend.means[j] ?? 0)) /
        Math.max(1e-9, tilingTrend.stds[j] ?? 1),
      -6,
      6,
    );
  });
  const correction = raw.reduce(
    (sum, x, j) => sum + x * (tilingTrend.coefficients[j] ?? 0),
    0,
  );
  return clamp(tilingTrend.blend * correction, -clampLogBias, clampLogBias);
}

function bucketKey(
  kind: "dataflow" | "array" | "dataflow-array" | "regime" | "dataflow-regime",
  sample: LearnedEstimatorSample,
) {
  if (kind === "dataflow") return keyOfDataflow(sample);
  if (kind === "array") return keyOfArray(sample);
  if (kind === "regime") return keyOfRegime(sample);
  if (kind === "dataflow-regime")
    return `${keyOfDataflow(sample)}@${keyOfRegime(sample)}`;
  return `${keyOfDataflow(sample)}@${keyOfArray(sample)}`;
}

const LOCAL_CALIBRATION_FEATURES = [
  "m",
  "n",
  "k",
  "tileM",
  "tileN",
  "tileK",
  "arrayRows",
  "arrayCols",
  "sramKB",
  "frequencyMHz",
  "memoryBandwidthGBs",
  "dtypeBytes",
  "workOps",
  "tileOps",
  "tileCoverage",
] as const;

type LocalCalibrationFeature = (typeof LOCAL_CALIBRATION_FEATURES)[number];

function safeLog1p(x: number) {
  return Math.log1p(Math.max(0, Number.isFinite(x) ? x : 0));
}

function localCalibrationFeature(
  sample: LearnedEstimatorSample,
  name: LocalCalibrationFeature,
): number {
  const m = Math.max(1, Number(sample.m) || 1);
  const n = Math.max(1, Number(sample.n) || 1);
  const k = Math.max(1, Number(sample.k) || 1);
  const tileM = Math.max(1, Number(sample.tileM) || 1);
  const tileN = Math.max(1, Number(sample.tileN) || 1);
  const tileK = Math.max(1, Number(sample.tileK) || 1);
  if (name === "workOps") return safeLog1p(m * n * k);
  if (name === "tileOps") return safeLog1p(tileM * tileN * tileK);
  if (name === "tileCoverage") return tileM / m + tileN / n + tileK / k;
  const value = Number(sample[name as keyof LearnedEstimatorSample]) || 0;
  return [
    "m",
    "n",
    "k",
    "tileM",
    "tileN",
    "tileK",
    "sramKB",
    "frequencyMHz",
    "memoryBandwidthGBs",
  ].includes(name)
    ? safeLog1p(value)
    : value;
}

function buildLocalCalibration(
  valid: Array<{ sample: LearnedEstimatorSample; logResidual: number }>,
  clampLogBias: number,
): EstimatorSuiteCycleCalibration["local"] | undefined {
  if (valid.length < 40) return undefined;
  const raw = valid.map((row) =>
    LOCAL_CALIBRATION_FEATURES.map((name) =>
      localCalibrationFeature(row.sample, name),
    ),
  );
  const means = LOCAL_CALIBRATION_FEATURES.map((_, j) =>
    mean(raw.map((r) => r[j])),
  );
  const stds = LOCAL_CALIBRATION_FEATURES.map((_, j) => {
    const variance = mean(raw.map((r) => (r[j] - means[j]) ** 2));
    return Math.sqrt(Math.max(1e-9, variance)) || 1;
  });
  const normalized = raw.map((r) =>
    r.map((x, j) => clamp((x - means[j]) / stds[j], -8, 8)),
  );
  const maxPrototypes =
    valid.length >= 1000 ? 768 : valid.length >= 300 ? 512 : 256;
  const stride = Math.max(1, Math.ceil(valid.length / maxPrototypes));
  const prototypes = valid
    .map((row, i) => ({ row, features: normalized[i], i }))
    // Deterministic ordering spreads prototypes across workload/hardware regions.
    .sort(
      (a, b) =>
        keyOfDataflow(a.row.sample).localeCompare(
          keyOfDataflow(b.row.sample),
        ) ||
        keyOfArray(a.row.sample).localeCompare(keyOfArray(b.row.sample)) ||
        keyOfWorkload(a.row.sample).localeCompare(
          keyOfWorkload(b.row.sample),
        ) ||
        a.i - b.i,
    )
    .filter((_, i) => i % stride === 0)
    .slice(0, maxPrototypes)
    .map(({ row, features }) => ({
      features,
      logResidual: clamp(row.logResidual, -clampLogBias, clampLogBias),
    }));
  if (prototypes.length < 24) return undefined;
  return {
    mode: "knn-log-residual",
    featureNames: [...LOCAL_CALIBRATION_FEATURES],
    means,
    stds,
    prototypes,
    k: Math.min(24, Math.max(8, Math.floor(Math.sqrt(prototypes.length)))),
    minNeighbors: 6,
    maxDistance: 5.5,
    blend: 0.55,
  };
}

function localCalibrationLogBias(
  local: EstimatorSuiteCycleCalibration["local"] | undefined,
  sample: LearnedEstimatorSample,
  clampLogBias: number,
): { logBias: number; confidence: number } {
  if (!local?.prototypes?.length) return { logBias: 0, confidence: 0 };
  const query = local.featureNames.map((name, j) => {
    const raw = localCalibrationFeature(
      sample,
      name as LocalCalibrationFeature,
    );
    return clamp(
      (raw - (local.means[j] ?? 0)) / Math.max(1e-9, local.stds[j] ?? 1),
      -8,
      8,
    );
  });
  const neighbors = local.prototypes
    .map((p) => {
      const dist2 =
        p.features.reduce((sum, x, j) => sum + (x - query[j]) ** 2, 0) /
        Math.max(1, query.length);
      return { p, dist: Math.sqrt(dist2) };
    })
    .sort((a, b) => a.dist - b.dist)
    .slice(0, Math.max(1, local.k));
  if (neighbors.length < local.minNeighbors)
    return { logBias: 0, confidence: 0 };
  const weighted = neighbors.reduce(
    (acc, n) => {
      const w = 1 / (0.05 + n.dist * n.dist);
      acc.sum += w * n.p.logResidual;
      acc.weight += w;
      acc.avgDist += n.dist;
      return acc;
    },
    { sum: 0, weight: 0, avgDist: 0 },
  );
  const avgDist = weighted.avgDist / neighbors.length;
  const density = clamp(1 - avgDist / Math.max(1e-6, local.maxDistance), 0, 1);
  const support = clamp(
    (neighbors.length - local.minNeighbors + 1) /
      Math.max(1, local.k - local.minNeighbors + 1),
    0,
    1,
  );
  const confidence = clamp(local.blend * density * support, 0, local.blend);
  const logBias = clamp(
    weighted.sum / Math.max(1e-9, weighted.weight),
    -clampLogBias,
    clampLogBias,
  );
  return { logBias, confidence };
}

function buildCycleCalibration(
  rows: EnsemblePredictionRow[],
  weights: EstimatorSuiteWeights,
  adaptiveWeights?: EstimatorSuiteAdaptiveStackWeights,
): EstimatorSuiteCycleCalibration | undefined {
  const valid = rows
    .map((row) => {
      const rowWeights = selectAdaptiveStackWeights(
        adaptiveWeights,
        row.sample,
        weights,
      );
      const predicted = weightedLogPrediction(
        row,
        rowWeights,
        finitePositive(row.direct ?? 0),
      );
      const measured = row.sample.measuredCycles;
      return {
        sample: row.sample,
        predicted,
        measured,
        logPredicted: logCycles(predicted),
        logResidual: Math.log(Math.max(1, measured) / Math.max(1, predicted)),
      };
    })
    .filter(
      (r) =>
        finitePositive(r.predicted) &&
        finitePositive(r.measured) &&
        Number.isFinite(r.logResidual),
    );
  if (valid.length < 12) return undefined;
  const globalLogBias = median(valid.map((r) => r.logResidual));
  const abs = valid.map((r) => Math.abs(r.logResidual));
  const clampLogBias = clamp(
    Math.max(0.08, percentile(abs, 0.9) * 1.25),
    0.08,
    0.7,
  );
  const minBucketSamples = valid.length >= 80 ? 6 : 4;
  const shrinkage = 12;
  const buckets: EstimatorSuiteCycleCalibration["buckets"] = [];
  for (const kind of [
    "dataflow",
    "array",
    "regime",
    "dataflow-regime",
    "dataflow-array",
  ] as const) {
    const groups = new Map<string, typeof valid>();
    for (const row of valid) {
      const key = bucketKey(kind, row.sample);
      const existing = groups.get(key);
      if (existing) existing.push(row);
      else groups.set(key, [row]);
    }
    for (const [key, group] of groups) {
      if (group.length < minBucketSamples) continue;
      const bucketMedian = median(group.map((r) => r.logResidual));
      const alpha = group.length / (group.length + shrinkage);
      const smoothed = (1 - alpha) * globalLogBias + alpha * bucketMedian;
      buckets.push({
        kind,
        key,
        samples: group.length,
        logBias: clamp(smoothed, -clampLogBias, clampLogBias),
      });
    }
  }
  const logPreds = valid.map((r) => r.logPredicted);
  const meanLogPredicted = mean(logPreds);
  const centeredResiduals = valid.map((r) =>
    clamp(r.logResidual - globalLogBias, -clampLogBias, clampLogBias),
  );
  const denom = Math.max(1e-9, variance(logPreds));
  const rawSlope = covariance(logPreds, centeredResiduals) / denom;
  const slope = clamp(rawSlope, -0.22, 0.22);
  const fittedResourceTrend = fitResourceTrend(
    valid,
    globalLogBias,
    clampLogBias,
  );
  const fittedTilingTrend = fitTilingTrend(valid, globalLogBias, clampLogBias);
  const local = buildLocalCalibration(valid, clampLogBias);

  const makeCalibration = (
    trendBlend: number,
    resourceBlend: number,
    tilingBlend: number,
  ): EstimatorSuiteCycleCalibration => ({
    mode: "oof-log-residual-bucket",
    globalLogBias: clamp(globalLogBias, -clampLogBias, clampLogBias),
    clampLogBias,
    minBucketSamples,
    shrinkage,
    buckets,
    scaleTrend:
      valid.length >= 24 && Math.abs(slope) >= 0.01 && trendBlend > 0
        ? {
            mode: "log-predicted-cycle-trend",
            meanLogPredicted,
            slope,
            blend: trendBlend,
          }
        : undefined,
    resourceTrend:
      fittedResourceTrend && resourceBlend > 0
        ? { ...fittedResourceTrend, blend: resourceBlend }
        : undefined,
    tilingTrend:
      fittedTilingTrend && tilingBlend > 0
        ? { ...fittedTilingTrend, blend: tilingBlend }
        : undefined,
    local,
  });

  const validationFor = (cal: EstimatorSuiteCycleCalibration) => {
    const predictions = valid.map((row) => {
      const logBias = selectCycleCalibrationLogBias(
        cal,
        row.sample,
        row.logPredicted,
      );
      return Math.max(1, Math.round(row.predicted * Math.exp(logBias)));
    });
    return metricsFromPredictions(
      valid.map((r) => r.sample),
      predictions,
    );
  };

  const trendCandidates = [0, 0.25, 0.5, 0.75, 1];
  const resourceCandidates = fittedResourceTrend ? [0, 0.25, 0.5, 0.75] : [0];
  const tilingCandidates = fittedTilingTrend ? [0, 0.25, 0.5, 0.75] : [0];
  let calibrationForValidation = makeCalibration(0, 0, 0);
  let bestValidation = validationFor(calibrationForValidation);
  let bestScore = metricScore(bestValidation);
  for (const trendBlend of trendCandidates) {
    for (const resourceBlend of resourceCandidates) {
      for (const tilingBlend of tilingCandidates) {
        if (trendBlend === 0 && resourceBlend === 0 && tilingBlend === 0)
          continue;
        const candidate = makeCalibration(
          trendBlend,
          resourceBlend,
          tilingBlend,
        );
        const metrics = validationFor(candidate);
        const score = metricScore(metrics);
        if (score < bestScore) {
          calibrationForValidation = candidate;
          bestValidation = metrics;
          bestScore = score;
        }
      }
    }
  }
  if (calibrationForValidation.scaleTrend) {
    calibrationForValidation.scaleTrend.validation = bestValidation;
  }
  if (calibrationForValidation.resourceTrend) {
    calibrationForValidation.resourceTrend.validation = bestValidation;
  }
  if (calibrationForValidation.tilingTrend) {
    calibrationForValidation.tilingTrend.validation = bestValidation;
  }
  return {
    ...calibrationForValidation,
    validation: bestValidation,
  };
}

function selectCycleCalibrationLogBias(
  calibration: EstimatorSuiteCycleCalibration | undefined,
  sample: LearnedEstimatorSample,
  logPredicted?: number,
) {
  if (!calibration) return 0;
  const candidates = [
    calibration.buckets.find(
      (b) =>
        b.kind === "dataflow-array" &&
        b.key === bucketKey("dataflow-array", sample),
    ),
    calibration.buckets.find(
      (b) =>
        b.kind === "dataflow-regime" &&
        b.key === bucketKey("dataflow-regime", sample),
    ),
    calibration.buckets.find(
      (b) => b.kind === "dataflow" && b.key === bucketKey("dataflow", sample),
    ),
    calibration.buckets.find(
      (b) => b.kind === "regime" && b.key === bucketKey("regime", sample),
    ),
    calibration.buckets.find(
      (b) => b.kind === "array" && b.key === bucketKey("array", sample),
    ),
  ].filter(Boolean) as EstimatorSuiteCycleCalibration["buckets"];
  const specificity: Record<string, number> = {
    "dataflow-array": 5,
    "dataflow-regime": 4,
    dataflow: 3,
    regime: 2,
    array: 1,
  };
  const bucket = candidates.sort(
    (a, b) =>
      (specificity[b.kind] ?? 0) - (specificity[a.kind] ?? 0) ||
      b.samples - a.samples,
  )[0];
  const bucketBias = bucket ? bucket.logBias : calibration.globalLogBias;
  const trend = calibration.scaleTrend
    ? calibration.scaleTrend.blend *
      calibration.scaleTrend.slope *
      ((logPredicted ?? logCycles(sample.estimatorCycles)) -
        calibration.scaleTrend.meanLogPredicted)
    : 0;
  const resource = resourceTrendLogBias(
    calibration.resourceTrend,
    sample,
    calibration.clampLogBias,
  );
  const tiling = tilingTrendLogBias(
    calibration.tilingTrend,
    sample,
    calibration.clampLogBias,
  );
  const trendBias = clamp(
    bucketBias + trend + resource + tiling,
    -calibration.clampLogBias,
    calibration.clampLogBias,
  );
  const local = localCalibrationLogBias(
    calibration.local,
    sample,
    calibration.clampLogBias,
  );
  const blended =
    (1 - local.confidence) * trendBias + local.confidence * local.logBias;
  return clamp(blended, -calibration.clampLogBias, calibration.clampLogBias);
}

export function estimatorSuiteCalibrationFactor(
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
  return Math.exp(
    selectCycleCalibrationLogBias(
      model.calibration,
      sample,
      logCycles(stacked),
    ),
  );
}

function simplexGrid(hasDirect: boolean, step = 0.05): EstimatorSuiteWeights[] {
  const ticks = Math.round(1 / step);
  const out: EstimatorSuiteWeights[] = [];
  for (let a = 0; a <= ticks; a++) {
    for (let t = 0; t <= ticks - a; t++) {
      for (let n = 0; n <= ticks - a - t; n++) {
        const d = ticks - a - t - n;
        if (!hasDirect && d !== 0) continue;
        out.push({
          analytical: a / ticks,
          tree: t / ticks,
          neural: n / ticks,
          directNeural: hasDirect ? d / ticks : 0,
        });
      }
    }
  }
  return out;
}

function optimizeStackedWeights(
  rows: EnsemblePredictionRow[],
  fallback: EstimatorSuiteWeights,
): { weights: EstimatorSuiteWeights; metrics: LearnedEstimatorMetrics } {
  if (rows.length < 8)
    return { weights: fallback, metrics: evaluateStackedRows(rows, fallback) };
  const hasDirect = rows.some((r) => finitePositive(r.direct ?? 0));
  const candidates = [
    fallback,
    weightsFromMetrics(
      evaluateAnalyticalEstimator(rows.map((r) => r.sample)),
      evaluateStackedRows(rows, {
        analytical: 0,
        tree: 1,
        neural: 0,
        directNeural: 0,
      }),
      evaluateStackedRows(rows, {
        analytical: 0,
        tree: 0,
        neural: 1,
        directNeural: 0,
      }),
      hasDirect
        ? evaluateStackedRows(rows, {
            analytical: 0,
            tree: 0,
            neural: 0,
            directNeural: 1,
          })
        : undefined,
    ),
    ...simplexGrid(hasDirect, 0.05),
  ];
  let bestWeights = normalizeWeights(fallback, hasDirect);
  let bestMetrics = evaluateStackedRows(rows, bestWeights);
  let bestScore = metricScore(bestMetrics);
  for (const c of candidates) {
    const w = normalizeWeights(c, hasDirect);
    // Keep a small analytical anchor unless the holdout overwhelmingly says otherwise.
    const anchored =
      rows.length < 80
        ? normalizeWeights(
            { ...w, analytical: Math.max(w.analytical, 0.05) },
            hasDirect,
          )
        : w;
    const m = evaluateStackedRows(rows, anchored);
    const score = metricScore(m);
    if (score < bestScore) {
      bestScore = score;
      bestWeights = anchored;
      bestMetrics = m;
    }
  }
  return { weights: bestWeights, metrics: bestMetrics };
}

function blendEstimatorSuiteWeights(
  globalWeights: EstimatorSuiteWeights,
  localWeights: EstimatorSuiteWeights,
  alpha: number,
  hasDirect: boolean,
): EstimatorSuiteWeights {
  const g = normalizeWeights(globalWeights, hasDirect);
  const l = normalizeWeights(localWeights, hasDirect);
  const a = clamp(alpha, 0, 1);
  return normalizeWeights(
    {
      analytical: (1 - a) * g.analytical + a * l.analytical,
      tree: (1 - a) * g.tree + a * l.tree,
      neural: (1 - a) * g.neural + a * l.neural,
      directNeural: (1 - a) * (g.directNeural ?? 0) + a * (l.directNeural ?? 0),
    },
    hasDirect,
  );
}

function evaluateAdaptiveStackRows(
  rows: EnsemblePredictionRow[],
  globalWeights: EstimatorSuiteWeights,
  adaptiveWeights: EstimatorSuiteAdaptiveStackWeights | undefined,
): LearnedEstimatorMetrics {
  return metricsFromPredictions(
    rows.map((r) => r.sample),
    rows.map((r) =>
      weightedLogPrediction(
        r,
        selectAdaptiveStackWeights(adaptiveWeights, r.sample, globalWeights),
        finitePositive(r.direct ?? 0),
      ),
    ),
  );
}

function buildAdaptiveStackWeights(
  rows: EnsemblePredictionRow[],
  globalWeights: EstimatorSuiteWeights,
): EstimatorSuiteAdaptiveStackWeights | undefined {
  if (rows.length < 48) return undefined;
  const hasDirect = rows.some((r) => finitePositive(r.direct ?? 0));
  const minBucketSamples = rows.length >= 180 ? 12 : 8;
  const shrinkage = rows.length >= 240 ? 28 : 18;
  const buckets: EstimatorSuiteAdaptiveStackWeights["buckets"] = [];
  const globalMetrics = evaluateStackedRows(rows, globalWeights);
  const globalScore = metricScore(globalMetrics);
  for (const kind of [
    "regime",
    "dataflow",
    "array",
    "dataflow-regime",
    "dataflow-array",
  ] as const) {
    const groups = new Map<string, EnsemblePredictionRow[]>();
    for (const row of rows) {
      const key = bucketKey(kind, row.sample);
      const existing = groups.get(key);
      if (existing) existing.push(row);
      else groups.set(key, [row]);
    }
    for (const [key, group] of groups) {
      if (group.length < minBucketSamples) continue;
      const local = optimizeStackedWeights(group, globalWeights);
      const localScore = metricScore(local.metrics);
      const globalOnGroup = evaluateStackedRows(group, globalWeights);
      const globalGroupScore = metricScore(globalOnGroup);
      // Keep domain-specific weights only when OOF rows indicate a real local winner.
      if (localScore > globalGroupScore * 0.995) continue;
      const improvement = clamp(
        (globalGroupScore - localScore) / Math.max(1e-9, globalGroupScore),
        0,
        1,
      );
      const support = group.length / (group.length + shrinkage);
      const alpha = clamp(
        0.2 + 0.8 * support * Math.sqrt(improvement),
        0.05,
        0.75,
      );
      buckets.push({
        kind,
        key,
        samples: group.length,
        weights: blendEstimatorSuiteWeights(
          globalWeights,
          local.weights,
          alpha,
          hasDirect,
        ),
        validation: local.metrics,
      });
    }
  }
  if (!buckets.length) return undefined;
  const adaptive = {
    mode: "oof-domain-adaptive-stack" as const,
    minBucketSamples,
    shrinkage,
    buckets,
  };
  const validation = evaluateAdaptiveStackRows(rows, globalWeights, adaptive);
  if (metricScore(validation) > globalScore * 0.997) return undefined;
  return { ...adaptive, validation };
}

function selectAdaptiveStackWeights(
  adaptiveWeights: EstimatorSuiteAdaptiveStackWeights | undefined,
  sample: LearnedEstimatorSample,
  globalWeights: EstimatorSuiteWeights,
): EstimatorSuiteWeights {
  if (!adaptiveWeights?.buckets?.length) return globalWeights;
  const candidates = [
    adaptiveWeights.buckets.find(
      (b) =>
        b.kind === "dataflow-array" &&
        b.key === bucketKey("dataflow-array", sample),
    ),
    adaptiveWeights.buckets.find(
      (b) =>
        b.kind === "dataflow-regime" &&
        b.key === bucketKey("dataflow-regime", sample),
    ),
    adaptiveWeights.buckets.find(
      (b) => b.kind === "dataflow" && b.key === bucketKey("dataflow", sample),
    ),
    adaptiveWeights.buckets.find(
      (b) => b.kind === "regime" && b.key === bucketKey("regime", sample),
    ),
    adaptiveWeights.buckets.find(
      (b) => b.kind === "array" && b.key === bucketKey("array", sample),
    ),
  ].filter(Boolean) as EstimatorSuiteAdaptiveStackWeights["buckets"];
  const specificity: Record<string, number> = {
    "dataflow-array": 5,
    "dataflow-regime": 4,
    dataflow: 3,
    regime: 2,
    array: 1,
  };
  const bucket = candidates.sort(
    (a, b) =>
      (specificity[b.kind] ?? 0) - (specificity[a.kind] ?? 0) ||
      b.samples - a.samples,
  )[0];
  return bucket?.weights ?? globalWeights;
}

function averageWeights(
  weights: EstimatorSuiteWeights[],
  hasDirect: boolean,
): EstimatorSuiteWeights {
  if (!weights.length)
    return {
      analytical: 0.1,
      tree: 0.45,
      neural: 0.3,
      directNeural: hasDirect ? 0.15 : 0,
    };
  const sum = weights.reduce(
    (acc, w) => {
      const n = normalizeWeights(w, hasDirect);
      acc.analytical += n.analytical;
      acc.tree += n.tree;
      acc.neural += n.neural;
      acc.directNeural = (acc.directNeural ?? 0) + n.directNeural;
      return acc;
    },
    {
      analytical: 0,
      tree: 0,
      neural: 0,
      directNeural: 0,
    } as Required<EstimatorSuiteWeights>,
  );
  return normalizeWeights(
    {
      analytical: sum.analytical / weights.length,
      tree: sum.tree / weights.length,
      neural: sum.neural / weights.length,
      directNeural: (sum.directNeural ?? 0) / weights.length,
    },
    hasDirect,
  );
}

function domainConfidenceForPrediction(
  model: EstimatorSuiteModel,
  sample: LearnedEstimatorSample,
) {
  const domain = model.metadata?.featureDomain;
  if (!domain) return 0.8;
  let confidence = 1;
  const keys: (keyof LearnedEstimatorSample)[] = [
    "m",
    "n",
    "k",
    "tileM",
    "tileN",
    "tileK",
    "arrayRows",
    "arrayCols",
    "sramKB",
    "frequencyMHz",
    "memoryBandwidthGBs",
  ];
  for (const key of keys) {
    const range = domain.numeric?.[String(key)];
    const value = Number(sample[key]);
    if (!range || !Number.isFinite(value)) continue;
    const span = Math.max(1, range.max - range.min);
    if (value < range.min || value > range.max) {
      const dist = value < range.min ? range.min - value : value - range.max;
      confidence *= 1 - Math.min(0.3, 0.1 + 0.2 * Math.min(1, dist / span));
    }
  }
  const arrayKey = keyOfArray(sample);
  if (domain.arrays?.length && !domain.arrays.includes(arrayKey))
    confidence *= 0.82;
  const df = keyOfDataflow(sample);
  if (domain.dataflows?.length && !domain.dataflows.includes(df))
    confidence *= 0.72;
  return clamp(confidence, model.blend?.domainGuard?.minConfidence ?? 0.35, 1);
}

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
function keyOfArray(s: LearnedEstimatorSample) {
  return `${s.arrayRows}x${s.arrayCols}`;
}
function keyOfWorkload(s: LearnedEstimatorSample) {
  return `${s.model || "model"}/${s.opName || "op"}/${s.m}x${s.n}x${s.k}`;
}
function keyOfDataflow(s: LearnedEstimatorSample) {
  return String(s.dataflow || "unknown").toUpperCase();
}
function keyOfRegime(s: LearnedEstimatorSample) {
  const sramPressure = resourceTrendFeature(s, "logSramPressure");
  const bandwidthPerMac = resourceTrendFeature(s, "logBandwidthPerMac");
  const fit = tilingTrendFeature(s, "arrayTileFit");
  const padding = tilingTrendFeature(s, "logPaddingWaste");
  if (sramPressure > 0.12) return "sram-spill";
  if (bandwidthPerMac < -2.6) return "dram-bound";
  if (fit < 0.45) return "array-mismatch";
  if (padding > Math.log(1.18)) return "edge-heavy";
  return "compute-regular";
}
function shapeSize(s: LearnedEstimatorSample) {
  return s.m * s.n * s.k;
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

export function evaluateAnalyticalEstimator(
  samples: LearnedEstimatorSample[],
): LearnedEstimatorMetrics {
  const rows = cleanSamples(samples);
  const errors = rows.map(
    (s) => (s.estimatorCycles - s.measuredCycles) / s.measuredCycles,
  );
  const abs = errors.map((e) => Math.abs(e)).sort((a, b) => a - b);
  const pct = (p: number) =>
    (abs[Math.min(abs.length - 1, Math.floor(abs.length * p))] ?? 0) * 100;
  const mape = mean(abs) * 100;
  const rmse = Math.sqrt(mean(errors.map((e) => e * e))) * 100;
  return {
    samples: rows.length,
    baselineMapePct: mape,
    learnedMapePct: mape,
    baselineRmsePct: rmse,
    learnedRmsePct: rmse,
    p50AbsPct: pct(0.5),
    p90AbsPct: pct(0.9),
    p95AbsPct: pct(0.95),
  };
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

export function weightsFromMetrics(
  baseline: LearnedEstimatorMetrics,
  tree: LearnedEstimatorMetrics,
  neural: LearnedEstimatorMetrics,
  direct?: LearnedEstimatorMetrics,
): EstimatorSuiteWeights {
  const aScore = baselineScore(baseline);
  const tScore = safeScore(tree);
  const nScore = safeScore(neural);
  const dScore = direct ? safeScore(direct) : undefined;
  const invA = 0.1 / (aScore * aScore);
  const invT = 1 / (tScore * tScore);
  const invN = 1 / (nScore * nScore);
  const invD = dScore ? 1.2 / (dScore * dScore) : 0;
  const sum = invA + invT + invN + invD || 1;
  return {
    analytical: invA / sum,
    tree: invT / sum,
    neural: invN / sum,
    directNeural: invD / sum,
  };
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

function numericRange(
  rows: LearnedEstimatorSample[],
  key: keyof LearnedEstimatorSample,
) {
  const values = rows
    .map((r) => Number(r[key]))
    .filter((v) => Number.isFinite(v));
  if (!values.length) return { min: 0, max: 0 };
  return { min: Math.min(...values), max: Math.max(...values) };
}

function trainingDomain(rows: LearnedEstimatorSample[]) {
  const numericKeys: (keyof LearnedEstimatorSample)[] = [
    "m",
    "n",
    "k",
    "tileM",
    "tileN",
    "tileK",
    "arrayRows",
    "arrayCols",
    "sramKB",
    "frequencyMHz",
    "memoryBandwidthGBs",
    "dispatchOverheadUs",
    "estimatorCycles",
  ];
  return {
    numeric: Object.fromEntries(
      numericKeys.map((k) => [String(k), numericRange(rows, k)]),
    ),
    arrays: unique(rows.map(keyOfArray)).sort(),
    dataflows: unique(rows.map(keyOfDataflow)).sort(),
    workloads: unique(rows.map(keyOfWorkload)).sort(),
    opNames: unique(rows.map((s) => String(s.opName || "unknown"))).sort(),
  };
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
