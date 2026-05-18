import { evaluateDirectNeuralEstimator, predictDirectNeuralCycles, trainDirectNeuralEstimator, type DirectNeuralEstimatorModel, type TrainDirectNeuralOptions } from "./directNeuralEstimator";
import type { LearnedEstimatorMetrics, LearnedEstimatorSample } from "./learnedEstimator";

export type MultiTargetName = "sramBytes" | "dramBytes" | "utilizationPct";

export interface MultiTargetEstimatorTargetModel {
  target: MultiTargetName;
  model: DirectNeuralEstimatorModel;
  samples: number;
  metric: LearnedEstimatorMetrics;
  sourceColumns: { measured: string[]; estimator: string[] };
}

export interface MultiTargetEstimatorModel {
  kind: "tileforge-multi-target-estimator-v1";
  createdAt: string;
  targets: Partial<Record<MultiTargetName, MultiTargetEstimatorTargetModel>>;
  metadata: {
    samples: number;
    minSamples: number;
    note: string;
  };
}

export interface MultiTargetPrediction {
  sramBytes?: number;
  dramBytes?: number;
  utilization?: number;
  availableTargets: MultiTargetName[];
}

function isFinitePositive(x: unknown): x is number {
  return typeof x === "number" && Number.isFinite(x) && x > 0;
}

function utilizationToPct(v: number | undefined): number | undefined {
  if (!Number.isFinite(v)) return undefined;
  const n = Number(v);
  if (n <= 0) return undefined;
  return n <= 1 ? n * 100 : n;
}

function metricPair(sample: LearnedEstimatorSample, target: MultiTargetName): { estimator?: number; measured?: number } {
  if (target === "sramBytes") return { estimator: sample.estimatorSramBytes, measured: sample.measuredSramBytes };
  if (target === "dramBytes") return { estimator: sample.estimatorDramBytes, measured: sample.measuredDramBytes };
  return { estimator: utilizationToPct(sample.estimatorUtilization), measured: utilizationToPct(sample.measuredUtilization) };
}

function sourceColumns(target: MultiTargetName) {
  if (target === "sramBytes") return { measured: ["measuredSramBytes", "scaleSimSramBytes", "sramAccessBytes"], estimator: ["estimatorSramBytes", "predictedSramBytes", "sramBytes"] };
  if (target === "dramBytes") return { measured: ["measuredDramBytes", "scaleSimDramBytes", "dramAccessBytes"], estimator: ["estimatorDramBytes", "predictedDramBytes", "dramBytes"] };
  return { measured: ["measuredUtilization", "scaleSimUtilization", "actualUtilization"], estimator: ["estimatorUtilization", "predictedUtilization", "utilization"] };
}

function targetSamples(samples: LearnedEstimatorSample[], target: MultiTargetName): LearnedEstimatorSample[] {
  return samples.flatMap((s) => {
    const pair = metricPair(s, target);
    if (!isFinitePositive(pair.measured)) return [];
    const estimatorTarget = isFinitePositive(pair.estimator) ? pair.estimator : pair.measured;
    return [{ ...s, estimatorCycles: Math.max(1, s.estimatorCycles), measuredCycles: Math.max(1, pair.measured), metricEstimatorTarget: estimatorTarget } as LearnedEstimatorSample];
  });
}

export function trainMultiTargetEstimator(samples: LearnedEstimatorSample[], opts: TrainDirectNeuralOptions & { minSamples?: number } = {}): MultiTargetEstimatorModel {
  const minSamples = opts.minSamples ?? 40;
  const targets: Partial<Record<MultiTargetName, MultiTargetEstimatorTargetModel>> = {};
  for (const target of ["sramBytes", "dramBytes", "utilizationPct"] as const) {
    const rows = targetSamples(samples, target);
    if (rows.length < minSamples) continue;
    const model = trainDirectNeuralEstimator(rows, { ...opts, seed: (opts.seed ?? 42) + (target === "sramBytes" ? 1001 : target === "dramBytes" ? 2001 : 3001), progress: (e) => opts.progress?.({ ...e, message: `[multi-target:${target}] ${e.message}` }) });
    const metric = evaluateDirectNeuralEstimator(model, rows);
    targets[target] = { target, model, samples: rows.length, metric, sourceColumns: sourceColumns(target) };
  }
  return {
    kind: "tileforge-multi-target-estimator-v1",
    createdAt: new Date().toISOString(),
    targets,
    metadata: {
      samples: samples.length,
      minSamples,
      note: "Cycle과 별도로 SRAM/DRAM/utilization을 각각 직접 학습합니다. 대상 컬럼이 없는 metric은 학습하지 않습니다."
    }
  };
}

export function hasMultiTargetModels(model?: MultiTargetEstimatorModel): boolean {
  return !!model && Object.keys(model.targets ?? {}).length > 0;
}

export function predictMultiTargetMetrics(model: MultiTargetEstimatorModel | undefined, sample: LearnedEstimatorSample): MultiTargetPrediction {
  const availableTargets = Object.keys(model?.targets ?? {}) as MultiTargetName[];
  const out: MultiTargetPrediction = { availableTargets };
  const sram = model?.targets.sramBytes;
  if (sram) out.sramBytes = predictDirectNeuralCycles(sram.model, sample);
  const dram = model?.targets.dramBytes;
  if (dram) out.dramBytes = predictDirectNeuralCycles(dram.model, sample);
  const util = model?.targets.utilizationPct;
  if (util) out.utilization = Math.max(0, Math.min(1, predictDirectNeuralCycles(util.model, sample) / 100));
  return out;
}

export function multiTargetSummaryRows(model?: MultiTargetEstimatorModel) {
  return (Object.values(model?.targets ?? {}) as MultiTargetEstimatorTargetModel[]).map(t => ({
    target: t.target,
    samples: t.samples,
    mapePct: t.metric.learnedMapePct,
    p90AbsPct: t.metric.p90AbsPct
  }));
}
