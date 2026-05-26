import { predictLearnedCycles, type LearnedEstimatorSample } from "./learnedEstimator";
import { predictNeuralCycles } from "./neuralResidualEstimator";
import { predictDirectNeuralCycles } from "./directNeuralEstimator";
import type { EstimatorSuiteAdaptiveStackWeights, EstimatorSuiteCycleCalibration, EstimatorSuiteModel, EstimatorSuiteWeights } from "./estimatorSuiteTypes";
import { clamp, covariance, mean, median, percentile, solveLinearSystem, variance } from "./estimatorSuiteMath";
import { keyOfArray, keyOfDataflow, keyOfWorkload } from "./estimatorSuiteDomain";
import { bucketKey, type EnsemblePredictionRow, finitePositive, logCycles, metricScore, metricsFromPredictions, selectAdaptiveStackWeights, weightedLogPrediction } from "./estimatorSuiteStacking";

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

export function buildCycleCalibration(
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

export function selectCycleCalibrationLogBias(
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
