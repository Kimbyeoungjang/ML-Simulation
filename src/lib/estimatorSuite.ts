import { evaluateLearnedEstimator, predictLearnedCycles, trainLearnedEstimator, type LearnedEstimatorMetrics, type LearnedEstimatorModel, type LearnedEstimatorSample, type TrainLearnedEstimatorOptions } from "./learnedEstimator";
import { evaluateNeuralResidualEstimator, predictNeuralCycles, trainNeuralResidualEstimator, type NeuralResidualEstimatorModel, type TrainNeuralResidualOptions } from "./neuralResidualEstimator";
import { evaluateDirectNeuralEstimator, predictDirectNeuralCycles, trainDirectNeuralEstimator, type DirectNeuralEstimatorModel } from "./directNeuralEstimator";

export type EstimatorSuiteSplitKind = "random" | "workload" | "array" | "dataflow" | "large-shape";
export type EstimatorSuiteModelName = "analytical" | "tree-residual" | "neural-residual" | "ensemble";

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

export interface EstimatorSuiteModel {
  kind: "tileforge-estimator-suite-v1";
  createdAt: string;
  target: "log_measured_over_estimator";
  tree: LearnedEstimatorModel;
  neural: NeuralResidualEstimatorModel;
  /** Optional v2 component: predicts log(measuredCycles) directly instead of residual. */
  directNeural?: DirectNeuralEstimatorModel;
  weights: EstimatorSuiteWeights;
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
    strategy: "analytical_plus_residual_ensemble" | "hybrid_residual_and_direct_neural";
  };
}

export interface TrainEstimatorSuiteOptions extends TrainLearnedEstimatorOptions, TrainNeuralResidualOptions {
  hiddenUnits?: number;
  epochs?: number;
  learningRate?: number;
  l2?: number;
  maxSplitTrainSamples?: number;
  maxFinalTrainSamples?: number;
  splitKinds?: EstimatorSuiteSplitKind[];
}

function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }
function safeScore(m: LearnedEstimatorMetrics) { return Math.max(0.01, m.learnedMapePct + 0.25 * m.p90AbsPct); }
function baselineScore(m: LearnedEstimatorMetrics) { return Math.max(0.01, m.baselineMapePct + 0.25 * m.baselineRmsePct); }
function normalizeWeights(weights: EstimatorSuiteWeights, hasDirect: boolean): Required<EstimatorSuiteWeights> {
  const direct = hasDirect ? Math.max(0, weights.directNeural ?? 0) : 0;
  const analytical = Math.max(0, weights.analytical ?? 0);
  const tree = Math.max(0, weights.tree ?? 0);
  const neural = Math.max(0, weights.neural ?? 0);
  const sum = analytical + tree + neural + direct || 1;
  return { analytical: analytical / sum, tree: tree / sum, neural: neural / sum, directNeural: direct / sum };
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

function unique<T>(xs: T[]) { return Array.from(new Set(xs)); }
function keyOfArray(s: LearnedEstimatorSample) { return `${s.arrayRows}x${s.arrayCols}`; }
function keyOfWorkload(s: LearnedEstimatorSample) { return `${s.model || "model"}/${s.opName || "op"}/${s.m}x${s.n}x${s.k}`; }
function keyOfDataflow(s: LearnedEstimatorSample) { return String(s.dataflow || "unknown").toUpperCase(); }
function shapeSize(s: LearnedEstimatorSample) { return s.m * s.n * s.k; }

function cleanSamples(samples: LearnedEstimatorSample[]) {
  return samples.filter(s => Number.isFinite(s.measuredCycles) && s.measuredCycles > 0 && Number.isFinite(s.estimatorCycles) && s.estimatorCycles > 0);
}

function downsample<T>(items: T[], maxSamples: number | undefined, seed: number) {
  if (!maxSamples || items.length <= maxSamples) return items;
  return shuffle(items, seed).slice(0, maxSamples);
}

export function evaluateAnalyticalEstimator(samples: LearnedEstimatorSample[]): LearnedEstimatorMetrics {
  const rows = cleanSamples(samples);
  const errors = rows.map(s => (s.estimatorCycles - s.measuredCycles) / s.measuredCycles);
  const abs = errors.map(e => Math.abs(e)).sort((a, b) => a - b);
  const pct = (p: number) => (abs[Math.min(abs.length - 1, Math.floor(abs.length * p))] ?? 0) * 100;
  const mape = mean(abs) * 100;
  const rmse = Math.sqrt(mean(errors.map(e => e * e))) * 100;
  return { samples: rows.length, baselineMapePct: mape, learnedMapePct: mape, baselineRmsePct: rmse, learnedRmsePct: rmse, p50AbsPct: pct(0.5), p90AbsPct: pct(0.9), p95AbsPct: pct(0.95) };
}

export function predictEstimatorSuiteCycles(model: EstimatorSuiteModel, sample: LearnedEstimatorSample): number {
  const analytical = sample.estimatorCycles;
  const tree = predictLearnedCycles(model.tree, sample);
  const neural = predictNeuralCycles(model.neural, sample);
  const direct = model.directNeural ? predictDirectNeuralCycles(model.directNeural, sample) : 0;
  const weights = normalizeWeights(model.weights, !!model.directNeural);
  const y = weights.analytical * analytical + weights.tree * tree + weights.neural * neural + (weights.directNeural ?? 0) * direct;
  return Math.max(1, Math.round(y));
}

export function evaluateEstimatorSuite(model: EstimatorSuiteModel, samples: LearnedEstimatorSample[]): LearnedEstimatorMetrics {
  const rows = cleanSamples(samples);
  const baselineErr = rows.map(s => (s.estimatorCycles - s.measuredCycles) / s.measuredCycles);
  const ensembleErr = rows.map(s => (predictEstimatorSuiteCycles(model, s) - s.measuredCycles) / s.measuredCycles);
  const abs = ensembleErr.map(e => Math.abs(e)).sort((a, b) => a - b);
  const pct = (p: number) => (abs[Math.min(abs.length - 1, Math.floor(abs.length * p))] ?? 0) * 100;
  return {
    samples: rows.length,
    baselineMapePct: mean(baselineErr.map(e => Math.abs(e))) * 100,
    learnedMapePct: mean(ensembleErr.map(e => Math.abs(e))) * 100,
    baselineRmsePct: Math.sqrt(mean(baselineErr.map(e => e * e))) * 100,
    learnedRmsePct: Math.sqrt(mean(ensembleErr.map(e => e * e))) * 100,
    p50AbsPct: pct(0.50),
    p90AbsPct: pct(0.90),
    p95AbsPct: pct(0.95)
  };
}

function evaluateWeightedEnsemble(samples: LearnedEstimatorSample[], tree: LearnedEstimatorModel, neural: NeuralResidualEstimatorModel, weights: EstimatorSuiteWeights, direct?: DirectNeuralEstimatorModel): LearnedEstimatorMetrics {
  const rows = cleanSamples(samples);
  const normalized = normalizeWeights(weights, !!direct);
  const baselineErr = rows.map(s => (s.estimatorCycles - s.measuredCycles) / s.measuredCycles);
  const ensembleErr = rows.map(s => {
    const pred = normalized.analytical * s.estimatorCycles
      + normalized.tree * predictLearnedCycles(tree, s)
      + normalized.neural * predictNeuralCycles(neural, s)
      + normalized.directNeural * (direct ? predictDirectNeuralCycles(direct, s) : 0);
    return (Math.max(1, Math.round(pred)) - s.measuredCycles) / s.measuredCycles;
  });
  const abs = ensembleErr.map(e => Math.abs(e)).sort((a, b) => a - b);
  const pct = (p: number) => (abs[Math.min(abs.length - 1, Math.floor(abs.length * p))] ?? 0) * 100;
  return {
    samples: rows.length,
    baselineMapePct: mean(baselineErr.map(e => Math.abs(e))) * 100,
    learnedMapePct: mean(ensembleErr.map(e => Math.abs(e))) * 100,
    baselineRmsePct: Math.sqrt(mean(baselineErr.map(e => e * e))) * 100,
    learnedRmsePct: Math.sqrt(mean(ensembleErr.map(e => e * e))) * 100,
    p50AbsPct: pct(0.50),
    p90AbsPct: pct(0.90),
    p95AbsPct: pct(0.95)
  };
}

export function weightsFromMetrics(baseline: LearnedEstimatorMetrics, tree: LearnedEstimatorMetrics, neural: LearnedEstimatorMetrics, direct?: LearnedEstimatorMetrics): EstimatorSuiteWeights {
  const aScore = baselineScore(baseline);
  const tScore = safeScore(tree);
  const nScore = safeScore(neural);
  const dScore = direct ? safeScore(direct) : undefined;
  const invA = 0.10 / (aScore * aScore);
  const invT = 1 / (tScore * tScore);
  const invN = 1 / (nScore * nScore);
  const invD = dScore ? 1.2 / (dScore * dScore) : 0;
  const sum = invA + invT + invN + invD || 1;
  return { analytical: invA / sum, tree: invT / sum, neural: invN / sum, directNeural: invD / sum };
}

function recommendModel(baseline: LearnedEstimatorMetrics, tree: LearnedEstimatorMetrics, neural: LearnedEstimatorMetrics, ensemble: LearnedEstimatorMetrics): EstimatorSuiteModelName {
  const scores: Array<[EstimatorSuiteModelName, number]> = [
    ["analytical", baselineScore(baseline)],
    ["tree-residual", safeScore(tree)],
    ["neural-residual", safeScore(neural)],
    ["ensemble", safeScore(ensemble)]
  ];
  scores.sort((a, b) => a[1] - b[1]);
  return scores[0][0];
}

function makeSplit(samples: LearnedEstimatorSample[], kind: EstimatorSuiteSplitKind, seed: number): { label: string; train: LearnedEstimatorSample[]; test: LearnedEstimatorSample[] } | undefined {
  const rows = cleanSamples(samples);
  if (rows.length < 40) return undefined;
  if (kind === "random") {
    const shuffled = shuffle(rows, seed);
    const testN = Math.max(8, Math.floor(rows.length * 0.2));
    return { label: "random 80/20 holdout", test: shuffled.slice(0, testN), train: shuffled.slice(testN) };
  }
  if (kind === "workload") {
    const keys = shuffle(unique(rows.map(keyOfWorkload)), seed + 1);
    if (keys.length < 4) return undefined;
    const holdout = new Set(keys.slice(0, Math.max(1, Math.floor(keys.length * 0.2))));
    return { label: "unseen workload/op holdout", test: rows.filter(s => holdout.has(keyOfWorkload(s))), train: rows.filter(s => !holdout.has(keyOfWorkload(s))) };
  }
  if (kind === "array") {
    const keys = shuffle(unique(rows.map(keyOfArray)), seed + 2);
    if (keys.length < 3) return undefined;
    const holdout = new Set(keys.slice(0, 1));
    return { label: `unseen array holdout (${Array.from(holdout).join(", ")})`, test: rows.filter(s => holdout.has(keyOfArray(s))), train: rows.filter(s => !holdout.has(keyOfArray(s))) };
  }
  if (kind === "dataflow") {
    const keys = shuffle(unique(rows.map(keyOfDataflow)), seed + 3);
    if (keys.length < 3) return undefined;
    const holdout = new Set(keys.slice(0, 1));
    return { label: `unseen dataflow holdout (${Array.from(holdout).join(", ")})`, test: rows.filter(s => holdout.has(keyOfDataflow(s))), train: rows.filter(s => !holdout.has(keyOfDataflow(s))) };
  }
  const sorted = rows.slice().sort((a, b) => shapeSize(a) - shapeSize(b));
  const cutoff = Math.floor(sorted.length * 0.8);
  return { label: "large-shape extrapolation holdout", train: sorted.slice(0, cutoff), test: sorted.slice(cutoff) };
}

function splitIsUsable(split: { train: LearnedEstimatorSample[]; test: LearnedEstimatorSample[] }) {
  return split.train.length >= 32 && split.test.length >= 8;
}

export function trainEstimatorSuite(samples: LearnedEstimatorSample[], opts: TrainEstimatorSuiteOptions = {}): EstimatorSuiteModel {
  const clean = cleanSamples(samples);
  if (clean.length < 40) throw new Error(`Need at least 40 valid samples to train estimator suite; got ${clean.length}`);
  const seed = opts.seed ?? 42;
  const trees = opts.trees ?? 160;
  const maxDepth = opts.maxDepth ?? 10;
  const minLeaf = opts.minLeaf ?? Math.max(4, Math.floor(Math.sqrt(clean.length) / 8));
  const hiddenUnits = opts.hiddenUnits ?? 64;
  const epochs = opts.epochs ?? 900;
  const learningRate = opts.learningRate ?? 0.01;
  const l2 = opts.l2 ?? 0.0001;
  const splitKinds = opts.splitKinds ?? ["random", "workload", "array", "dataflow", "large-shape"];

  const validationSuite: EstimatorSuiteSplitReport[] = [];
  opts.progress?.({ stage: "validating", message: `Estimator Suite 학습 시작: valid samples=${clean.length}, splits=${splitKinds.join(",")}`, progress: 5 });
  for (let i = 0; i < splitKinds.length; i++) {
    const split = makeSplit(clean, splitKinds[i], seed + i * 101);
    if (!split || !splitIsUsable(split)) {
      opts.progress?.({ stage: "validating", message: `${splitKinds[i]} split 건너뜀: train/test sample 부족`, progress: 10 + i * 8 });
      continue;
    }
    const trainRows = downsample(split.train, opts.maxSplitTrainSamples, seed + i * 997);
    opts.progress?.({ stage: "validating", message: `${splitKinds[i]} split 준비: train=${trainRows.length}, test=${split.test.length}`, progress: 10 + i * 8 });
    const tree = trainLearnedEstimator(trainRows, { trees: Math.max(24, Math.floor(trees / 2)), maxDepth, minLeaf, seed: seed + i * 11, validationFraction: 0.15, progress: (e) => opts.progress?.({ ...e, message: `[${splitKinds[i]}] ${e.message}`, progress: 10 + i * 8 + Math.min(3, (e.progress ?? 0) * 0.03) }) });
    const neural = trainNeuralResidualEstimator(trainRows, { hiddenUnits, epochs: Math.max(80, Math.floor(epochs / 2)), learningRate, l2, seed: seed + i * 13, validationFraction: 0.15, progress: (e) => opts.progress?.({ ...e, message: `[${splitKinds[i]}] ${e.message}`, progress: 13 + i * 8 + Math.min(2, (e.progress ?? 0) * 0.02) }) });
    const directNeural = trainDirectNeuralEstimator(trainRows, { hiddenUnits, epochs: Math.max(80, Math.floor(epochs / 2)), learningRate, l2, seed: seed + i * 17, validationFraction: 0.15, progress: (e) => opts.progress?.({ ...e, message: `[${splitKinds[i]}] ${e.message}`, progress: 15 + i * 8 + Math.min(2, (e.progress ?? 0) * 0.02) }) });
    const baseline = evaluateAnalyticalEstimator(split.test);
    const treeMetrics = evaluateLearnedEstimator(tree, split.test);
    const neuralMetrics = evaluateNeuralResidualEstimator(neural, split.test);
    const directMetrics = evaluateDirectNeuralEstimator(directNeural, split.test);
    const weights = weightsFromMetrics(baseline, treeMetrics, neuralMetrics, directMetrics);
    const ensembleMetrics = evaluateWeightedEnsemble(split.test, tree, neural, weights, directNeural);
    const recommended = recommendModel(baseline, treeMetrics, neuralMetrics, ensembleMetrics);
    opts.progress?.({ stage: "validating", message: `${splitKinds[i]} split 평가 완료: analytical MAPE=${baseline.learnedMapePct.toFixed(2)}%, tree=${treeMetrics.learnedMapePct.toFixed(2)}%, residual-neural=${neuralMetrics.learnedMapePct.toFixed(2)}%, direct-neural=${directMetrics.learnedMapePct.toFixed(2)}%, ensemble=${ensembleMetrics.learnedMapePct.toFixed(2)}%, 추천=${recommended}`, progress: 16 + i * 8 });
    validationSuite.push({ kind: splitKinds[i], label: split.label, trainSamples: trainRows.length, testSamples: split.test.length, baseline, tree: treeMetrics, neural: neuralMetrics, ensemble: ensembleMetrics, weights, recommended });
  }

  const finalTrainRows = downsample(clean, opts.maxFinalTrainSamples ?? 20000, seed + 404);
  opts.progress?.({ stage: "training-tree", message: `최종 Tree residual 학습 시작: train=${finalTrainRows.length}, trees=${trees}, maxDepth=${maxDepth}`, progress: 58 });
  const tree = trainLearnedEstimator(finalTrainRows, { trees, maxDepth, minLeaf, seed, validationFraction: opts.validationFraction ?? 0.2, progress: (e) => opts.progress?.({ ...e, progress: 58 + Math.min(16, (e.progress ?? 0) * 0.16) }) });
  opts.progress?.({ stage: "training-neural", message: `최종 Neural residual 학습 시작: train=${finalTrainRows.length}, hidden=${hiddenUnits}, epochs=${epochs}`, progress: 74 });
  const neural = trainNeuralResidualEstimator(finalTrainRows, { hiddenUnits, epochs, learningRate, l2, seed, validationFraction: opts.validationFraction ?? 0.2, progress: (e) => opts.progress?.({ ...e, progress: 74 + Math.min(8, (e.progress ?? 0) * 0.08) }) });
  opts.progress?.({ stage: "training-neural", message: `최종 Direct Neural cycle 학습 시작: train=${finalTrainRows.length}, hidden=${hiddenUnits}, epochs=${epochs}`, progress: 82 });
  const directNeural = trainDirectNeuralEstimator(finalTrainRows, { hiddenUnits, epochs, learningRate, l2, seed: seed + 17, validationFraction: opts.validationFraction ?? 0.2, progress: (e) => opts.progress?.({ ...e, progress: 82 + Math.min(8, (e.progress ?? 0) * 0.08) }) });
  const avg = (pick: (r: EstimatorSuiteSplitReport) => LearnedEstimatorMetrics) => {
    const ms = validationSuite.map(pick);
    if (!ms.length) return undefined;
    return {
      samples: Math.round(mean(ms.map(m => m.samples))),
      baselineMapePct: mean(ms.map(m => m.baselineMapePct)),
      learnedMapePct: mean(ms.map(m => m.learnedMapePct)),
      baselineRmsePct: mean(ms.map(m => m.baselineRmsePct)),
      learnedRmsePct: mean(ms.map(m => m.learnedRmsePct)),
      p50AbsPct: mean(ms.map(m => m.p50AbsPct)),
      p90AbsPct: mean(ms.map(m => m.p90AbsPct)),
      p95AbsPct: mean(ms.map(m => m.p95AbsPct))
    } satisfies LearnedEstimatorMetrics;
  };
  const baselineAvg = avg(r => r.baseline) ?? evaluateAnalyticalEstimator(clean);
  const treeAvg = avg(r => r.tree) ?? evaluateLearnedEstimator(tree, clean);
  const neuralAvg = avg(r => r.neural) ?? evaluateNeuralResidualEstimator(neural, clean);
  const directAvg = evaluateDirectNeuralEstimator(directNeural, clean);
  opts.progress?.({ stage: "validating", message: "최종 ensemble weight 계산 중", progress: 92 });
  const weights = weightsFromMetrics(baselineAvg, treeAvg, neuralAvg, directAvg);
  const pseudoModel = { kind: "tileforge-estimator-suite-v1", createdAt: new Date().toISOString(), target: "log_measured_over_estimator", tree, neural, directNeural, weights, recommended: "ensemble", validationSuite, metadata: { samples: clean.length, trainSamples: finalTrainRows.length, seed, trees, maxDepth, minLeaf, hiddenUnits, epochs, learningRate, l2, strategy: "hybrid_residual_and_direct_neural" } } as EstimatorSuiteModel;
  const ensembleAvg = avg(r => r.ensemble) ?? evaluateEstimatorSuite(pseudoModel, clean);
  const recommended = recommendModel(baselineAvg, treeAvg, neuralAvg, ensembleAvg);
  opts.progress?.({ stage: "validating", message: `Estimator Suite 완료: weights analytical=${weights.analytical.toFixed(3)}, tree=${weights.tree.toFixed(3)}, neural=${weights.neural.toFixed(3)}, 추천=${recommended}`, progress: 98 });
  return { ...pseudoModel, recommended };
}

export function estimatorSuitePredictionRows(samples: LearnedEstimatorSample[], model: EstimatorSuiteModel) {
  return cleanSamples(samples).map(s => {
    const treeCycles = predictLearnedCycles(model.tree, s);
    const neuralCycles = predictNeuralCycles(model.neural, s);
    const directNeuralCycles = model.directNeural ? predictDirectNeuralCycles(model.directNeural, s) : undefined;
    const ensembleCycles = predictEstimatorSuiteCycles(model, s);
    return {
      ...s,
      analyticalCycles: s.estimatorCycles,
      treeCycles,
      neuralCycles,
      directNeuralCycles,
      ensembleCycles,
      analyticalAbsPct: Math.abs((s.estimatorCycles - s.measuredCycles) / s.measuredCycles) * 100,
      treeAbsPct: Math.abs((treeCycles - s.measuredCycles) / s.measuredCycles) * 100,
      neuralAbsPct: Math.abs((neuralCycles - s.measuredCycles) / s.measuredCycles) * 100,
      directNeuralAbsPct: directNeuralCycles === undefined ? undefined : Math.abs((directNeuralCycles - s.measuredCycles) / s.measuredCycles) * 100,
      ensembleAbsPct: Math.abs((ensembleCycles - s.measuredCycles) / s.measuredCycles) * 100
    };
  });
}

export function summarizeSuiteValidation(model: EstimatorSuiteModel) {
  return model.validationSuite.map(r => ({
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
    directNeuralWeight: r.weights.directNeural ?? 0
  }));
}
