import { learnedEstimatorFeatures, type LearnedEstimatorMetrics, type LearnedEstimatorSample } from "./learnedEstimator";

export interface DirectNeuralEstimatorModel {
  kind: "tileforge-direct-neural-estimator-v1";
  createdAt: string;
  target: "log_measured_cycles";
  featureMean: number[];
  featureStd: number[];
  hiddenUnits: number;
  w1: number[][];
  b1: number[];
  w2: number[];
  b2: number;
  globalLogCycles: number;
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

export interface TrainDirectNeuralOptions {
  hiddenUnits?: number;
  epochs?: number;
  learningRate?: number;
  l2?: number;
  validationFraction?: number;
  seed?: number;
  progress?: (event: { stage: string; message: string; progress?: number }) => void;
}

function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function std(xs: number[], m = mean(xs)) { return Math.sqrt(mean(xs.map(x => (x - m) ** 2))) || 1; }
function median(xs: number[]) { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; }
function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }
function target(s: LearnedEstimatorSample) { return clamp(Math.log(Math.max(1, s.measuredCycles)), Math.log(1), Math.log(1e15)); }
function rng(seed: number) { let s = seed >>> 0; return () => { s = (1664525 * s + 1013904223) >>> 0; return s / 0x100000000; }; }
function shuffle<T>(items: T[], seed: number): T[] { const rand = rng(seed); const out = items.slice(); for (let i = out.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [out[i], out[j]] = [out[j], out[i]]; } return out; }
function normalizeStats(xs: number[][]) { const cols = xs[0]?.length ?? 0; const featureMean = Array.from({ length: cols }, (_, j) => mean(xs.map(r => r[j] ?? 0))); const featureStd = Array.from({ length: cols }, (_, j) => std(xs.map(r => r[j] ?? 0), featureMean[j])); return { featureMean, featureStd }; }
function applyNorm(x: number[], mu: number[], sigma: number[]) { return mu.map((m, i) => ((x[i] ?? 0) - m) / (sigma[i] || 1)); }
function tanh(x: number) { return Math.tanh(clamp(x, -20, 20)); }
function forward(model: DirectNeuralEstimatorModel, x: number[]) { const hidden = model.w1.map((row, i) => tanh(row.reduce((sum, w, j) => sum + w * x[j], model.b1[i] ?? 0))); const y = hidden.reduce((sum, h, i) => sum + h * (model.w2[i] ?? 0), model.b2); return { hidden, y }; }

export function trainDirectNeuralEstimator(samples: LearnedEstimatorSample[], opts: TrainDirectNeuralOptions = {}): DirectNeuralEstimatorModel {
  const clean = samples.filter(s => Number.isFinite(s.measuredCycles) && s.measuredCycles > 0 && Number.isFinite(s.estimatorCycles) && s.estimatorCycles > 0);
  if (clean.length < 24) throw new Error(`Need at least 24 valid samples to train direct neural estimator; got ${clean.length}`);
  const seed = opts.seed ?? 42;
  const validationFraction = clamp(opts.validationFraction ?? 0.2, 0.05, 0.5);
  const rows = shuffle(clean, seed + 701);
  const valN = Math.max(1, Math.floor(rows.length * validationFraction));
  const validation = rows.slice(0, valN);
  const train = rows.slice(valN);
  const trainXRaw = train.map(learnedEstimatorFeatures);
  const { featureMean, featureStd } = normalizeStats(trainXRaw);
  const trainX = trainXRaw.map(x => applyNorm(x, featureMean, featureStd));
  const trainY = train.map(target);
  const globalLogCycles = median(trainY);
  const rand = rng(seed + 1701);
  const inputDim = trainX[0]?.length ?? 0;
  const hiddenUnits = opts.hiddenUnits ?? Math.min(128, Math.max(16, Math.ceil(Math.sqrt(inputDim * Math.max(16, train.length / 4)))));
  const scale = 1 / Math.sqrt(Math.max(1, inputDim));
  const w1 = Array.from({ length: hiddenUnits }, () => Array.from({ length: inputDim }, () => (rand() * 2 - 1) * scale));
  const b1 = Array.from({ length: hiddenUnits }, () => 0);
  const w2 = Array.from({ length: hiddenUnits }, () => (rand() * 2 - 1) / Math.sqrt(hiddenUnits));
  let b2 = globalLogCycles;
  const epochs = opts.epochs ?? 700;
  const lr0 = opts.learningRate ?? 0.01;
  const l2 = opts.l2 ?? 1e-4;
  opts.progress?.({ stage: "training-neural", message: `Direct Neural cycle 학습 시작: hidden=${hiddenUnits}, epochs=${epochs}, train=${train.length}, validation=${validation.length}`, progress: 0 });
  let lastEpochPct = -1;
  for (let epoch = 0; epoch < epochs; epoch++) {
    const order = shuffle(trainX.map((_, i) => i), seed + epoch + 7100);
    const lr = lr0 / Math.sqrt(1 + epoch / 80);
    for (const ix of order) {
      const x = trainX[ix];
      const y = trainY[ix];
      const hidden = w1.map((row, i) => tanh(row.reduce((sum, w, j) => sum + w * x[j], b1[i] ?? 0)));
      const pred = hidden.reduce((sum, h, i) => sum + h * w2[i], b2);
      const gradY = clamp(pred - y, -5, 5);
      for (let h = 0; h < hiddenUnits; h++) {
        const oldW2 = w2[h];
        w2[h] -= lr * (gradY * hidden[h] + l2 * w2[h]);
        const gradH = gradY * oldW2 * (1 - hidden[h] * hidden[h]);
        b1[h] -= lr * gradH;
        for (let j = 0; j < inputDim; j++) w1[h][j] -= lr * (gradH * x[j] + l2 * w1[h][j]);
      }
      b2 -= lr * gradY;
    }
    const pct = Math.floor(((epoch + 1) / epochs) * 100);
    if (pct === 100 || pct >= lastEpochPct + 10) {
      lastEpochPct = pct;
      opts.progress?.({ stage: "training-neural", message: `Direct Neural epoch ${epoch + 1}/${epochs} 완료 (${pct}%)`, progress: pct });
    }
  }
  const model: DirectNeuralEstimatorModel = { kind: "tileforge-direct-neural-estimator-v1", createdAt: new Date().toISOString(), target: "log_measured_cycles", featureMean, featureStd, hiddenUnits, w1, b1, w2, b2, globalLogCycles, metadata: { samples: clean.length, trainSamples: train.length, validationSamples: validation.length, seed, epochs, learningRate: lr0, l2 } };
  model.validation = evaluateDirectNeuralEstimator(model, validation);
  return model;
}

export function predictDirectNeuralCycles(model: DirectNeuralEstimatorModel, sample: LearnedEstimatorSample): number {
  const x = applyNorm(learnedEstimatorFeatures(sample), model.featureMean, model.featureStd);
  const logCycles = 0.92 * forward(model, x).y + 0.08 * model.globalLogCycles;
  return Math.max(1, Math.round(Math.exp(clamp(logCycles, Math.log(1), Math.log(1e15)))));
}

export function evaluateDirectNeuralEstimator(model: DirectNeuralEstimatorModel, samples: LearnedEstimatorSample[]): LearnedEstimatorMetrics {
  const rows = samples.filter(s => s.measuredCycles > 0 && s.estimatorCycles > 0);
  const baselineErr = rows.map(s => (s.estimatorCycles - s.measuredCycles) / s.measuredCycles);
  const learnedErr = rows.map(s => (predictDirectNeuralCycles(model, s) - s.measuredCycles) / s.measuredCycles);
  const abs = learnedErr.map(e => Math.abs(e)).sort((a, b) => a - b);
  const pct = (p: number) => (abs[Math.min(abs.length - 1, Math.floor(abs.length * p))] ?? 0) * 100;
  return { samples: rows.length, baselineMapePct: mean(baselineErr.map(e => Math.abs(e))) * 100, learnedMapePct: mean(learnedErr.map(e => Math.abs(e))) * 100, baselineRmsePct: Math.sqrt(mean(baselineErr.map(e => e * e))) * 100, learnedRmsePct: Math.sqrt(mean(learnedErr.map(e => e * e))) * 100, p50AbsPct: pct(0.5), p90AbsPct: pct(0.9), p95AbsPct: pct(0.95) };
}
