import { evaluateLearnedEstimator, learnedEstimatorFeatures, predictLearnedCycles, trainLearnedEstimator, type LearnedEstimatorMetrics, type LearnedEstimatorModel, type LearnedEstimatorSample } from "./learnedEstimator";

export interface NeuralResidualEstimatorModel {
  kind: "tileforge-neural-residual-estimator-v1";
  createdAt: string;
  target: "log_measured_over_estimator";
  featureMean: number[];
  featureStd: number[];
  hiddenUnits: number;
  w1: number[][];
  b1: number[];
  w2: number[];
  b2: number;
  globalLogRatio: number;
  metadata: {
    samples: number;
    trainSamples: number;
    validationSamples: number;
    seed: number;
    epochs: number;
    learningRate: number;
    l2: number;
  };
  validation?: LearnedEstimatorMetrics;
}

export interface TrainNeuralResidualOptions {
  hiddenUnits?: number;
  epochs?: number;
  learningRate?: number;
  l2?: number;
  validationFraction?: number;
  seed?: number;
}

export interface EstimatorComparisonResult {
  recommendation: "tree-residual" | "neural-residual";
  reason: string;
  samples: number;
  tree: LearnedEstimatorModel;
  neural: NeuralResidualEstimatorModel;
  baselineMetrics: LearnedEstimatorMetrics;
  treeMetrics: LearnedEstimatorMetrics;
  neuralMetrics: LearnedEstimatorMetrics;
}

function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function std(xs: number[], m = mean(xs)) { return Math.sqrt(mean(xs.map(x => (x - m) ** 2))) || 1; }
function median(xs: number[]) { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; }
function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }
function residualTarget(s: LearnedEstimatorSample) { return clamp(Math.log(s.measuredCycles / s.estimatorCycles), Math.log(0.05), Math.log(50)); }

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

function normalizeStats(xs: number[][]) {
  const cols = xs[0]?.length ?? 0;
  const featureMean = Array.from({ length: cols }, (_, j) => mean(xs.map(r => r[j] ?? 0)));
  const featureStd = Array.from({ length: cols }, (_, j) => std(xs.map(r => r[j] ?? 0), featureMean[j]));
  return { featureMean, featureStd };
}

function applyNorm(x: number[], mu: number[], sigma: number[]) { return x.map((v, i) => (v - mu[i]) / (sigma[i] || 1)); }
function tanh(x: number) { return Math.tanh(clamp(x, -20, 20)); }

function forward(model: NeuralResidualEstimatorModel, x: number[]) {
  const hidden = model.w1.map((row, i) => tanh(row.reduce((sum, w, j) => sum + w * x[j], model.b1[i] ?? 0)));
  const raw = hidden.reduce((sum, h, i) => sum + h * (model.w2[i] ?? 0), model.b2);
  return { hidden, y: raw };
}

export function trainNeuralResidualEstimator(samples: LearnedEstimatorSample[], opts: TrainNeuralResidualOptions = {}): NeuralResidualEstimatorModel {
  const clean = samples.filter(s => Number.isFinite(s.measuredCycles) && s.measuredCycles > 0 && Number.isFinite(s.estimatorCycles) && s.estimatorCycles > 0);
  if (clean.length < 24) throw new Error(`Need at least 24 valid samples to train neural residual estimator; got ${clean.length}`);

  const seed = opts.seed ?? 42;
  const validationFraction = clamp(opts.validationFraction ?? 0.2, 0.05, 0.5);
  const rows = shuffle(clean, seed);
  const valN = Math.max(1, Math.floor(rows.length * validationFraction));
  const validation = rows.slice(0, valN);
  const train = rows.slice(valN);
  const trainXRaw = train.map(learnedEstimatorFeatures);
  const { featureMean, featureStd } = normalizeStats(trainXRaw);
  const trainX = trainXRaw.map(x => applyNorm(x, featureMean, featureStd));
  const trainY = train.map(residualTarget);
  const globalLogRatio = median(trainY);

  const rand = rng(seed + 17);
  const inputDim = trainX[0]?.length ?? 0;
  const hiddenUnits = opts.hiddenUnits ?? Math.min(32, Math.max(8, Math.ceil(Math.sqrt(inputDim * Math.max(8, train.length / 8)))));
  const scale = 1 / Math.sqrt(Math.max(1, inputDim));
  const w1 = Array.from({ length: hiddenUnits }, () => Array.from({ length: inputDim }, () => (rand() * 2 - 1) * scale));
  const b1 = Array.from({ length: hiddenUnits }, () => 0);
  const w2 = Array.from({ length: hiddenUnits }, () => (rand() * 2 - 1) / Math.sqrt(hiddenUnits));
  let b2 = globalLogRatio;
  const epochs = opts.epochs ?? 700;
  const lr0 = opts.learningRate ?? 0.015;
  const l2 = opts.l2 ?? 1e-4;

  for (let epoch = 0; epoch < epochs; epoch++) {
    const order = shuffle(trainX.map((_, i) => i), seed + epoch + 1000);
    const lr = lr0 / Math.sqrt(1 + epoch / 80);
    for (const ix of order) {
      const x = trainX[ix];
      const target = trainY[ix];
      const hidden = w1.map((row, i) => tanh(row.reduce((sum, w, j) => sum + w * x[j], b1[i] ?? 0)));
      const pred = hidden.reduce((sum, h, i) => sum + h * w2[i], b2);
      const gradY = clamp(pred - target, -5, 5);
      for (let h = 0; h < hiddenUnits; h++) {
        const oldW2 = w2[h];
        w2[h] -= lr * (gradY * hidden[h] + l2 * w2[h]);
        const gradH = gradY * oldW2 * (1 - hidden[h] * hidden[h]);
        b1[h] -= lr * gradH;
        for (let j = 0; j < inputDim; j++) w1[h][j] -= lr * (gradH * x[j] + l2 * w1[h][j]);
      }
      b2 -= lr * gradY;
    }
  }

  const model: NeuralResidualEstimatorModel = {
    kind: "tileforge-neural-residual-estimator-v1",
    createdAt: new Date().toISOString(),
    target: "log_measured_over_estimator",
    featureMean,
    featureStd,
    hiddenUnits,
    w1,
    b1,
    w2,
    b2,
    globalLogRatio,
    metadata: { samples: clean.length, trainSamples: train.length, validationSamples: validation.length, seed, epochs, learningRate: lr0, l2 }
  };
  model.validation = evaluateNeuralResidualEstimator(model, validation);
  return model;
}

export function predictNeuralCycleFactor(model: NeuralResidualEstimatorModel, sample: LearnedEstimatorSample): number {
  const x = applyNorm(learnedEstimatorFeatures(sample), model.featureMean, model.featureStd);
  const logRatio = 0.9 * forward(model, x).y + 0.1 * model.globalLogRatio;
  return clamp(Math.exp(logRatio), 0.05, 50);
}

export function predictNeuralCycles(model: NeuralResidualEstimatorModel, sample: LearnedEstimatorSample): number {
  return Math.max(1, Math.round(sample.estimatorCycles * predictNeuralCycleFactor(model, sample)));
}

export function evaluateNeuralResidualEstimator(model: NeuralResidualEstimatorModel, samples: LearnedEstimatorSample[]): LearnedEstimatorMetrics {
  const rows = samples.filter(s => s.measuredCycles > 0 && s.estimatorCycles > 0);
  const baselineErr = rows.map(s => (s.estimatorCycles - s.measuredCycles) / s.measuredCycles);
  const learnedErr = rows.map(s => (predictNeuralCycles(model, s) - s.measuredCycles) / s.measuredCycles);
  const abs = learnedErr.map(e => Math.abs(e)).sort((a, b) => a - b);
  const pct = (p: number) => (abs[Math.min(abs.length - 1, Math.floor(abs.length * p))] ?? 0) * 100;
  return {
    samples: rows.length,
    baselineMapePct: mean(baselineErr.map(e => Math.abs(e))) * 100,
    learnedMapePct: mean(learnedErr.map(e => Math.abs(e))) * 100,
    baselineRmsePct: Math.sqrt(mean(baselineErr.map(e => e * e))) * 100,
    learnedRmsePct: Math.sqrt(mean(learnedErr.map(e => e * e))) * 100,
    p50AbsPct: pct(0.50),
    p90AbsPct: pct(0.90),
    p95AbsPct: pct(0.95)
  };
}

export function compareResidualEstimators(samples: LearnedEstimatorSample[], opts: TrainNeuralResidualOptions & { trees?: number; maxDepth?: number; minLeaf?: number } = {}): EstimatorComparisonResult {
  const clean = samples.filter(s => Number.isFinite(s.measuredCycles) && s.measuredCycles > 0 && Number.isFinite(s.estimatorCycles) && s.estimatorCycles > 0);
  if (clean.length < 40) throw new Error(`Need at least 40 valid samples to compare residual estimators; got ${clean.length}`);
  const seed = opts.seed ?? 42;
  const validationFraction = clamp(opts.validationFraction ?? 0.2, 0.05, 0.5);
  const rows = shuffle(clean, seed + 9001);
  const testN = Math.max(8, Math.floor(rows.length * validationFraction));
  const testRows = rows.slice(0, testN);
  const trainRows = rows.slice(testN);
  const tree = trainLearnedEstimator(trainRows, {
    trees: opts.trees ?? 128,
    maxDepth: opts.maxDepth ?? 10,
    minLeaf: opts.minLeaf ?? 4,
    seed,
    validationFraction
  });
  const neural = trainNeuralResidualEstimator(trainRows, { ...opts, seed, validationFraction });
  const treeMetrics = evaluateLearnedEstimator(tree, testRows);
  const neuralMetrics = evaluateNeuralResidualEstimator(neural, testRows);
  const baselineMetrics = {
    ...treeMetrics,
    learnedMapePct: treeMetrics.baselineMapePct,
    learnedRmsePct: treeMetrics.baselineRmsePct,
    p50AbsPct: treeMetrics.baselineMapePct,
    p90AbsPct: treeMetrics.baselineMapePct,
    p95AbsPct: treeMetrics.baselineMapePct
  };
  const treeScore = treeMetrics.learnedMapePct + 0.25 * treeMetrics.p90AbsPct;
  const neuralScore = neuralMetrics.learnedMapePct + 0.25 * neuralMetrics.p90AbsPct;
  const recommendation = neuralScore + 0.5 < treeScore ? "neural-residual" : "tree-residual";
  const reason = recommendation === "tree-residual"
    ? "tree residual model has equal or better holdout robustness and is easier to explain/debug for current SCALE-Sim datasets"
    : "neural residual model is clearly better on mean and tail holdout error for this dataset; keep it as an optional advanced estimator";
  return { recommendation, reason, samples: clean.length, tree, neural, baselineMetrics, treeMetrics, neuralMetrics };
}

export function predictionRowsForComparison(samples: LearnedEstimatorSample[], tree: LearnedEstimatorModel, neural: NeuralResidualEstimatorModel) {
  return samples.map(s => {
    const treeCycles = predictLearnedCycles(tree, s);
    const neuralCycles = predictNeuralCycles(neural, s);
    return {
      ...s,
      baselineAbsPct: Math.abs((s.estimatorCycles - s.measuredCycles) / s.measuredCycles) * 100,
      treeCycles,
      treeAbsPct: Math.abs((treeCycles - s.measuredCycles) / s.measuredCycles) * 100,
      neuralCycles,
      neuralAbsPct: Math.abs((neuralCycles - s.measuredCycles) / s.measuredCycles) * 100
    };
  });
}
