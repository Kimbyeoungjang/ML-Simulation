import type { LearnedEstimatorMetrics, LearnedEstimatorSample } from "./learnedEstimator";
import type { EstimatorSuiteAdaptiveStackWeights, EstimatorSuiteWeights } from "./estimatorSuiteTypes";
import { clamp, mean } from "./estimatorSuiteMath";
import { keyOfArray, keyOfDataflow, keyOfRegime } from "./estimatorSuiteDomain";

export function safeScore(m: LearnedEstimatorMetrics) {
  return Math.max(0.01, m.learnedMapePct + 0.25 * m.p90AbsPct);
}
export function baselineScore(m: LearnedEstimatorMetrics) {
  return Math.max(0.01, m.baselineMapePct + 0.25 * m.baselineRmsePct);
}
export function normalizeWeights(
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

export function finitePositive(x: number) {
  return Number.isFinite(x) && x > 0;
}
export function logCycles(x: number) {
  return Math.log(Math.max(1, x));
}
export function expCycles(x: number) {
  return Math.max(
    1,
    Math.round(Math.exp(clamp(x, Math.log(1), Math.log(1e15)))),
  );
}

export interface EnsemblePredictionRow {
  sample: LearnedEstimatorSample;
  analytical: number;
  tree: number;
  neural: number;
  direct?: number;
}

export function weightedLogPrediction(
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

export function metricsFromPredictions(
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

export function metricScore(m: LearnedEstimatorMetrics) {
  return Math.max(
    0.001,
    m.learnedMapePct + 0.3 * m.p90AbsPct + 0.1 * m.learnedRmsePct,
  );
}

export function evaluateStackedRows(
  rows: EnsemblePredictionRow[],
  weights: EstimatorSuiteWeights,
): LearnedEstimatorMetrics {
  const hasDirect = rows.some((r) => finitePositive(r.direct ?? 0));
  return metricsFromPredictions(
    rows.map((r) => r.sample),
    rows.map((r) => weightedLogPrediction(r, weights, hasDirect)),
  );
}

export function bucketKey(
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

export function evaluateAnalyticalEstimator(
  samples: LearnedEstimatorSample[],
): LearnedEstimatorMetrics {
  const rows = samples.filter(
    (s) =>
      Number.isFinite(s.estimatorCycles) &&
      Number.isFinite(s.measuredCycles) &&
      s.estimatorCycles > 0 &&
      s.measuredCycles > 0,
  );
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

export function optimizeStackedWeights(
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

export function evaluateAdaptiveStackRows(
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

export function buildAdaptiveStackWeights(
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

export function selectAdaptiveStackWeights(
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

export function averageWeights(
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
