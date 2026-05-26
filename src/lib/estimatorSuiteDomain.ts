import type { LearnedEstimatorSample } from "./learnedEstimator";
import type { EstimatorSuiteModel } from "./estimatorSuiteTypes";

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function unique<T>(xs: T[]) {
  return Array.from(new Set(xs));
}

function ceilDiv(a: number, b: number) {
  return Math.max(1, Math.ceil(Math.max(1, a) / Math.max(1, b)));
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

function resourcePressure(sample: LearnedEstimatorSample) {
  const tileM = Math.max(1, Number(sample.tileM) || 1);
  const tileN = Math.max(1, Number(sample.tileN) || 1);
  const tileK = Math.max(1, Number(sample.tileK) || 1);
  const dtype = Math.max(1, Number(sample.dtypeBytes) || 1);
  const tileBytes = Math.max(1, (tileM * tileK + tileK * tileN + tileM * tileN) * dtype);
  const sramBytes = Math.max(1, (Number(sample.sramKB) || 0) * 1024);
  return Math.log(tileBytes / sramBytes);
}

function bandwidthPerMac(sample: LearnedEstimatorSample) {
  const macsPerSecond =
    Math.max(1, Number(sample.arrayRows) || 1) *
    Math.max(1, Number(sample.arrayCols) || 1) *
    Math.max(1, Number(sample.frequencyMHz) || 1) *
    1e6;
  const bandwidthBytesPerSecond = Math.max(0, Number(sample.memoryBandwidthGBs) || 0) * 1e9;
  return Math.log((bandwidthBytesPerSecond + 1) / macsPerSecond);
}

function arrayTileFit(sample: LearnedEstimatorSample) {
  const tileM = Math.max(1, Number(sample.tileM) || 1);
  const tileN = Math.max(1, Number(sample.tileN) || 1);
  const arrayRows = Math.max(1, Number(sample.arrayRows) || 1);
  const arrayCols = Math.max(1, Number(sample.arrayCols) || 1);
  const rowFit = Math.min(tileM, arrayRows) / Math.max(tileM, arrayRows);
  const colFit = Math.min(tileN, arrayCols) / Math.max(tileN, arrayCols);
  return rowFit * colFit;
}

function paddingWaste(sample: LearnedEstimatorSample) {
  const m = Math.max(1, Number(sample.m) || 1);
  const n = Math.max(1, Number(sample.n) || 1);
  const k = Math.max(1, Number(sample.k) || 1);
  const tileM = Math.max(1, Number(sample.tileM) || 1);
  const tileN = Math.max(1, Number(sample.tileN) || 1);
  const tileK = Math.max(1, Number(sample.tileK) || 1);
  const padded = ceilDiv(m, tileM) * tileM * ceilDiv(n, tileN) * tileN * ceilDiv(k, tileK) * tileK;
  return Math.log(Math.max(1, padded / Math.max(1, m * n * k)));
}

export function keyOfArray(s: LearnedEstimatorSample) {
  return `${s.arrayRows}x${s.arrayCols}`;
}

export function keyOfWorkload(s: LearnedEstimatorSample) {
  return `${s.model || "model"}/${s.opName || "op"}/${s.m}x${s.n}x${s.k}`;
}

export function keyOfDataflow(s: LearnedEstimatorSample) {
  return String(s.dataflow || "unknown").toUpperCase();
}

export function keyOfRegime(s: LearnedEstimatorSample) {
  if (resourcePressure(s) > 0.12) return "sram-spill";
  if (bandwidthPerMac(s) < -2.6) return "dram-bound";
  if (arrayTileFit(s) < 0.45) return "array-mismatch";
  if (paddingWaste(s) > Math.log(1.18)) return "edge-heavy";
  return "compute-regular";
}

export function shapeSize(s: LearnedEstimatorSample) {
  return s.m * s.n * s.k;
}

export function domainConfidenceForPrediction(
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
  if (domain.arrays?.length && !domain.arrays.includes(arrayKey)) confidence *= 0.82;
  const df = keyOfDataflow(sample);
  if (domain.dataflows?.length && !domain.dataflows.includes(df)) confidence *= 0.72;
  return clamp(confidence, model.blend?.domainGuard?.minConfidence ?? 0.35, 1);
}

export function primaryTargetScope(rows: LearnedEstimatorSample[]): "full-layer" | "tile-policy" | "mixed" {
  const counts = new Map<string, number>();
  for (const r of rows) counts.set(String(r.targetScope ?? "mixed"), (counts.get(String(r.targetScope ?? "mixed")) ?? 0) + 1);
  const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
  const top = sorted[0]?.[0];
  return top === "full-layer" || top === "tile-policy" ? top : "mixed";
}

export function trainingDomain(rows: LearnedEstimatorSample[]) {
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
    numeric: Object.fromEntries(numericKeys.map((k) => [String(k), numericRange(rows, k)])),
    arrays: unique(rows.map(keyOfArray)).sort(),
    dataflows: unique(rows.map(keyOfDataflow)).sort(),
    workloads: unique(rows.map(keyOfWorkload)).sort(),
    opNames: unique(rows.map((s) => String(s.opName || "unknown"))).sort(),
    targetScopes: unique(rows.map((s) => String(s.targetScope ?? "mixed"))).sort(),
    primaryTargetScope: primaryTargetScope(rows),
  };
}
