import type { Dataflow, HardwareConfig, MatmulShape, Objective, TileCandidateResult } from "@/types/domain";
import { estimateTile } from "./estimator";

export interface LearnedEstimatorSample {
  id?: string;
  model?: string;
  opName?: string;
  arrayRows: number;
  arrayCols: number;
  sramKB: number;
  frequencyMHz: number;
  dataflow: Dataflow | string;
  dtypeBytes: number;
  m: number;
  n: number;
  k: number;
  tileM: number;
  tileN: number;
  tileK: number;
  estimatorCycles: number;
  measuredCycles: number;
  estimatorSramBytes?: number;
  measuredSramBytes?: number;
  estimatorDramBytes?: number;
  measuredDramBytes?: number;
  estimatorUtilization?: number;
  measuredUtilization?: number;
}

export interface LearnedEstimatorTreeNode {
  prediction: number;
  feature?: number;
  threshold?: number;
  left?: LearnedEstimatorTreeNode;
  right?: LearnedEstimatorTreeNode;
  count: number;
}

export interface LearnedEstimatorModel {
  kind: "tileforge-learned-estimator-v1";
  createdAt: string;
  target: "log_measured_over_estimator";
  featureNames: string[];
  featureMean: number[];
  featureStd: number[];
  trees: LearnedEstimatorTreeNode[];
  globalLogRatio: number;
  metadata: {
    samples: number;
    trainSamples: number;
    validationSamples: number;
    seed: number;
    maxDepth: number;
    minLeaf: number;
    trees: number;
  };
  validation?: LearnedEstimatorMetrics;
}

export interface LearnedEstimatorMetrics {
  samples: number;
  baselineMapePct: number;
  learnedMapePct: number;
  baselineRmsePct: number;
  learnedRmsePct: number;
  p50AbsPct: number;
  p90AbsPct: number;
  p95AbsPct: number;
}

export interface TrainLearnedEstimatorOptions {
  trees?: number;
  maxDepth?: number;
  minLeaf?: number;
  validationFraction?: number;
  seed?: number;
  progress?: (event: { stage: string; message: string; progress?: number }) => void;
}

const FEATURE_NAMES = [
  "logM", "logN", "logK", "logTM", "logTN", "logTK",
  "logArrayRows", "logArrayCols", "logSramKB", "logFrequencyMHz",
  "mModTileM", "nModTileN", "kModTileK",
  "tileMOverRows", "tileNOverCols", "tileKOverRows",
  "opsLog", "sramUseRatio", "paddingRatio", "estimatorLogCycles",
  "dataflowWS", "dataflowOS", "dataflowIS"
] as const;

function log1p(x: number) { return Math.log1p(Math.max(0, x)); }
function safeDiv(a: number, b: number) { return b === 0 ? 0 : a / b; }
function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }
function residualTarget(s: LearnedEstimatorSample) { return clamp(Math.log(s.measuredCycles / s.estimatorCycles), Math.log(0.05), Math.log(50)); }
function median(xs: number[]) { const s = xs.slice().sort((a, b) => a - b); return s.length ? s[Math.floor(s.length / 2)] : 0; }
function mean(xs: number[]) { return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0; }
function std(xs: number[], m = mean(xs)) { return Math.sqrt(mean(xs.map(x => (x - m) ** 2))) || 1; }

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

export function learnedEstimatorFeatures(s: LearnedEstimatorSample): number[] {
  const paddedM = Math.ceil(s.m / s.tileM) * s.tileM;
  const paddedN = Math.ceil(s.n / s.tileN) * s.tileN;
  const paddedK = Math.ceil(s.k / s.tileK) * s.tileK;
  const usefulOps = Math.max(1, 2 * s.m * s.n * s.k);
  const paddedOps = Math.max(1, 2 * paddedM * paddedN * paddedK);
  const bytes = s.dtypeBytes || 2;
  const sramBytes = (s.tileM * s.tileK + s.tileK * s.tileN + s.tileM * s.tileN) * bytes;
  const df = String(s.dataflow).toUpperCase();
  return [
    log1p(s.m), log1p(s.n), log1p(s.k), log1p(s.tileM), log1p(s.tileN), log1p(s.tileK),
    log1p(s.arrayRows), log1p(s.arrayCols), log1p(s.sramKB), log1p(s.frequencyMHz),
    safeDiv(s.m % s.tileM, s.tileM), safeDiv(s.n % s.tileN, s.tileN), safeDiv(s.k % s.tileK, s.tileK),
    safeDiv(s.tileM, s.arrayRows), safeDiv(s.tileN, s.arrayCols), safeDiv(s.tileK, s.arrayRows),
    log1p(usefulOps), safeDiv(sramBytes, Math.max(1, s.sramKB * 1024)), paddedOps / usefulOps - 1, log1p(s.estimatorCycles),
    df === "WS" ? 1 : 0, df === "OS" ? 1 : 0, df === "IS" ? 1 : 0
  ];
}

function normalize(xs: number[][]) {
  const cols = FEATURE_NAMES.length;
  const featureMean = Array.from({ length: cols }, (_, j) => mean(xs.map(r => r[j] ?? 0)));
  const featureStd = Array.from({ length: cols }, (_, j) => std(xs.map(r => r[j] ?? 0), featureMean[j]));
  return { featureMean, featureStd };
}
function applyNorm(x: number[], mu: number[], sigma: number[]) { return x.map((v, i) => (v - mu[i]) / sigma[i]); }

function variance(ys: number[]) {
  const m = mean(ys);
  return mean(ys.map(y => (y - m) ** 2));
}

function buildTree(xs: number[][], ys: number[], depth: number, maxDepth: number, minLeaf: number, rand: () => number): LearnedEstimatorTreeNode {
  const prediction = median(ys);
  const node: LearnedEstimatorTreeNode = { prediction, count: ys.length };
  if (depth >= maxDepth || ys.length < minLeaf * 2 || variance(ys) < 1e-10) return node;

  const featureCount = xs[0]?.length ?? 0;
  const tries = Math.max(12, Math.ceil(Math.sqrt(featureCount)) * 6);
  let best: { f: number; t: number; score: number; left: number[]; right: number[] } | undefined;

  for (let i = 0; i < tries; i++) {
    const f = Math.floor(rand() * featureCount);
    const values = xs.map(x => x[f]).filter(Number.isFinite).sort((a, b) => a - b);
    if (values.length < minLeaf * 2) continue;
    const lo = values[Math.floor(values.length * 0.1)];
    const hi = values[Math.floor(values.length * 0.9)];
    if (lo === hi) continue;
    const t = lo + rand() * (hi - lo);
    const left: number[] = [];
    const right: number[] = [];
    for (let row = 0; row < xs.length; row++) (xs[row][f] <= t ? left : right).push(row);
    if (left.length < minLeaf || right.length < minLeaf) continue;
    const leftY = left.map(ix => ys[ix]);
    const rightY = right.map(ix => ys[ix]);
    const score = leftY.length * variance(leftY) + rightY.length * variance(rightY);
    if (!best || score < best.score) best = { f, t, score, left, right };
  }

  if (!best) return node;
  node.feature = best.f;
  node.threshold = best.t;
  node.left = buildTree(best.left.map(i => xs[i]), best.left.map(i => ys[i]), depth + 1, maxDepth, minLeaf, rand);
  node.right = buildTree(best.right.map(i => xs[i]), best.right.map(i => ys[i]), depth + 1, maxDepth, minLeaf, rand);
  return node;
}

function predictTree(node: LearnedEstimatorTreeNode, x: number[]): number {
  if (node.feature === undefined || node.threshold === undefined || !node.left || !node.right) return node.prediction;
  return predictTree(x[node.feature] <= node.threshold ? node.left : node.right, x);
}

export function trainLearnedEstimator(samples: LearnedEstimatorSample[], opts: TrainLearnedEstimatorOptions = {}): LearnedEstimatorModel {
  const clean = samples.filter(s => Number.isFinite(s.measuredCycles) && s.measuredCycles > 0 && Number.isFinite(s.estimatorCycles) && s.estimatorCycles > 0);
  if (clean.length < 12) throw new Error(`Need at least 12 valid samples to train a learned estimator; got ${clean.length}`);
  const seed = opts.seed ?? 42;
  const validationFraction = clamp(opts.validationFraction ?? 0.2, 0.05, 0.5);
  const rows = shuffle(clean, seed);
  const valN = Math.max(1, Math.floor(rows.length * validationFraction));
  const validation = rows.slice(0, valN);
  const train = rows.slice(valN);
  const trainXRaw = train.map(learnedEstimatorFeatures);
  const { featureMean, featureStd } = normalize(trainXRaw);
  const trainX = trainXRaw.map(x => applyNorm(x, featureMean, featureStd));
  const trainY = train.map(residualTarget);
  const globalLogRatio = median(trainY);
  const trees = opts.trees ?? 96;
  const maxDepth = opts.maxDepth ?? 9;
  const minLeaf = opts.minLeaf ?? Math.max(4, Math.floor(Math.sqrt(train.length) / 2));
  const rand = rng(seed + 1);
  const forest: LearnedEstimatorTreeNode[] = [];
  opts.progress?.({ stage: "training-tree", message: `Tree residual 학습 시작: trees=${trees}, train=${train.length}, validation=${validation.length}`, progress: 0 });
  let lastPct = -1;
  for (let t = 0; t < trees; t++) {
    const bootX: number[][] = [];
    const bootY: number[] = [];
    for (let i = 0; i < trainX.length; i++) {
      const ix = Math.floor(rand() * trainX.length);
      bootX.push(trainX[ix]);
      bootY.push(trainY[ix]);
    }
    forest.push(buildTree(bootX, bootY, 0, maxDepth, minLeaf, rand));
    const pct = Math.floor(((t + 1) / trees) * 100);
    if (pct === 100 || pct >= lastPct + 10) {
      lastPct = pct;
      opts.progress?.({ stage: "training-tree", message: `Tree residual ${t + 1}/${trees} trees 완료 (${pct}%)`, progress: pct });
    }
  }
  const model: LearnedEstimatorModel = {
    kind: "tileforge-learned-estimator-v1",
    createdAt: new Date().toISOString(),
    target: "log_measured_over_estimator",
    featureNames: [...FEATURE_NAMES],
    featureMean,
    featureStd,
    trees: forest,
    globalLogRatio,
    metadata: { samples: clean.length, trainSamples: train.length, validationSamples: validation.length, seed, maxDepth, minLeaf, trees }
  };
  opts.progress?.({ stage: "training-tree", message: "Tree residual holdout 평가 중", progress: 100 });
  model.validation = evaluateLearnedEstimator(model, validation);
  return model;
}

export function predictCycleFactor(model: LearnedEstimatorModel, sample: LearnedEstimatorSample): number {
  const x = applyNorm(learnedEstimatorFeatures(sample), model.featureMean, model.featureStd);
  const preds = model.trees.length ? model.trees.map(tree => predictTree(tree, x)) : [model.globalLogRatio];
  const logRatio = 0.85 * mean(preds) + 0.15 * model.globalLogRatio;
  return clamp(Math.exp(logRatio), 0.05, 50);
}

export function predictLearnedCycles(model: LearnedEstimatorModel, sample: LearnedEstimatorSample): number {
  return Math.max(1, Math.round(sample.estimatorCycles * predictCycleFactor(model, sample)));
}

export function evaluateLearnedEstimator(model: LearnedEstimatorModel, samples: LearnedEstimatorSample[]): LearnedEstimatorMetrics {
  const rows = samples.filter(s => s.measuredCycles > 0 && s.estimatorCycles > 0);
  const baselineErr = rows.map(s => (s.estimatorCycles - s.measuredCycles) / s.measuredCycles);
  const learnedErr = rows.map(s => (predictLearnedCycles(model, s) - s.measuredCycles) / s.measuredCycles);
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

export function sampleFromTile(hw: HardwareConfig, shape: MatmulShape, tile: TileCandidateResult, measuredCycles: number): LearnedEstimatorSample {
  return {
    id: `${shape.id}_${tile.tileM}x${tile.tileN}x${tile.tileK}`,
    model: shape.model,
    opName: shape.opName,
    arrayRows: hw.arrayRows,
    arrayCols: hw.arrayCols,
    sramKB: hw.sramKB,
    frequencyMHz: hw.frequencyMHz,
    dataflow: hw.dataflow,
    dtypeBytes: shape.dtypeBytes || hw.bytesPerElement || 2,
    m: shape.m,
    n: shape.n,
    k: shape.k,
    tileM: tile.tileM,
    tileN: tile.tileN,
    tileK: tile.tileK,
    estimatorCycles: tile.cycles,
    measuredCycles
  };
}

export function learnedEstimateTile(model: LearnedEstimatorModel, hw: HardwareConfig, shape: MatmulShape, tileM: number, tileN: number, tileK: number, objective: Objective): TileCandidateResult {
  const base = estimateTile(hw, shape, tileM, tileN, tileK, objective);
  const sample = sampleFromTile(hw, shape, base, base.cycles);
  const cycles = predictLearnedCycles(model, sample);
  const factor = cycles / Math.max(1, base.cycles);
  return {
    ...base,
    rawCycles: base.cycles,
    cycles,
    calibrationFactor: factor,
    timeUs: cycles / Math.max(1, hw.frequencyMHz),
    explanation: `${base.explanation} 학습 estimator 보정 계수 ${factor.toFixed(3)} 적용.`
  };
}
