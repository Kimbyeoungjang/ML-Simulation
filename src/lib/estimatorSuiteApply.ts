import type { SearchRequest, SearchResponse, TileCandidateResult } from "@/types/domain";
import { predictEstimatorSuiteCycles, predictEstimatorSuiteMetrics, type EstimatorSuiteModel, type EstimatorSuiteModelName } from "./estimatorSuite";
import type { LearnedEstimatorSample } from "./learnedEstimator";
import { mean } from "./math";
import { generateReportMarkdown } from "./report";
import { analyzeBottlenecks } from "./bottleneck";
import { computeRoofline } from "./roofline";
import { computeEnergy } from "./energy";

export interface EstimatorSuiteApplicationSummary {
  applied: boolean;
  modelKind?: EstimatorSuiteModel["kind"];
  recommended?: EstimatorSuiteModelName;
  weights?: EstimatorSuiteModel["weights"];
  modelSamples?: number;
  adjustedCandidates: number;
  totalAnalyticalCycles: number;
  totalLearnedCycles: number;
  averageCycleFactor: number;
  totalWeightedCycleFactor: number;
  minDomainConfidence: number;
  warnings: string[];
}

export interface SearchResponseWithEstimatorSuite extends SearchResponse {
  estimatorSuite?: EstimatorSuiteApplicationSummary;
}

function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }


function domainConfidence(model: EstimatorSuiteModel, sample: LearnedEstimatorSample): { confidence: number; warnings: string[] } {
  const domain = model.metadata?.featureDomain;
  if (!domain) return { confidence: 0.75, warnings: ["모델에 학습 범위 metadata가 없어 neural 예측을 일부 완화했습니다."] };
  const warnings: string[] = [];
  let confidence = 1;
  for (const key of ["m", "n", "k", "tileM", "tileN", "tileK", "arrayRows", "arrayCols", "sramKB"] as const) {
    const range = domain.numeric?.[key];
    const value = Number(sample[key]);
    if (!range || !Number.isFinite(value)) continue;
    const span = Math.max(1, range.max - range.min);
    if (value < range.min || value > range.max) {
      const dist = value < range.min ? range.min - value : value - range.max;
      const penalty = Math.min(0.35, 0.15 + 0.20 * Math.min(1, dist / span));
      confidence *= (1 - penalty);
      warnings.push(`${key}=${value}가 학습 범위 [${range.min}, ${range.max}] 밖입니다.`);
    }
  }
  const arrayKey = `${sample.arrayRows}x${sample.arrayCols}`;
  if (Array.isArray(domain.arrays) && domain.arrays.length && !domain.arrays.includes(arrayKey)) {
    confidence *= 0.75;
    warnings.push(`array ${arrayKey}는 학습 데이터에 없었습니다.`);
  }
  const df = String(sample.dataflow || "unknown").toUpperCase();
  if (Array.isArray(domain.dataflows) && domain.dataflows.length && !domain.dataflows.includes(df)) {
    confidence *= 0.65;
    warnings.push(`dataflow ${df}는 학습 데이터에 없었습니다.`);
  }
  if (Array.isArray(domain.opNames) && domain.opNames.length && sample.opName && !domain.opNames.includes(String(sample.opName))) {
    confidence *= 0.85;
    warnings.push(`opName ${sample.opName}는 학습 데이터에 없었습니다.`);
  }
  return { confidence: clamp(confidence, 0.25, 1), warnings };
}

function modelTargetScope(model: EstimatorSuiteModel): "full-layer" | "tile-policy" | "mixed" {
  const scope = model.metadata?.featureDomain?.primaryTargetScope;
  return scope === "full-layer" || scope === "tile-policy" ? scope : "mixed";
}

function candidateToSample(req: SearchRequest, candidate: TileCandidateResult, model?: EstimatorSuiteModel): LearnedEstimatorSample {
  const shape = req.shapes.find(s => s.id === candidate.shapeId) ?? req.shapes.find(s => s.model === candidate.model && s.opName === candidate.opName) ?? req.shapes[0];
  const baseCycles = candidate.rawCycles && candidate.rawCycles > 0 ? candidate.rawCycles : candidate.cycles;
  return {
    id: `${shape?.id ?? candidate.shapeId}:${candidate.tileM}x${candidate.tileN}x${candidate.tileK}`,
    model: candidate.model || shape?.model,
    opName: candidate.opName || shape?.opName,
    arrayRows: req.hardware.arrayRows,
    arrayCols: req.hardware.arrayCols,
    sramKB: req.hardware.sramKB,
    frequencyMHz: req.hardware.frequencyMHz,
    memoryBandwidthGBs: req.hardware.memoryBandwidthGBs ?? 0,
    dispatchOverheadUs: req.hardware.dispatchOverheadUs ?? 0,
    dataflow: req.hardware.dataflow,
    dtypeBytes: shape?.dtypeBytes ?? req.hardware.bytesPerElement ?? 2,
    m: shape?.m ?? 1,
    n: shape?.n ?? 1,
    k: shape?.k ?? 1,
    tileM: candidate.tileM,
    tileN: candidate.tileN,
    tileK: candidate.tileK,
    estimatorCycles: Math.max(1, baseCycles),
    measuredCycles: Math.max(1, baseCycles),
    targetScope: model ? modelTargetScope(model) : "mixed",
    measuredSource: "prediction",
  };
}

function adjustCandidate(req: SearchRequest, model: EstimatorSuiteModel, candidate: TileCandidateResult): TileCandidateResult {
  const rawCycles = candidate.rawCycles && candidate.rawCycles > 0 ? candidate.rawCycles : candidate.cycles;
  const sample = candidateToSample(req, { ...candidate, cycles: rawCycles, rawCycles }, model);
  const rawLearnedCycles = clamp(predictEstimatorSuiteCycles(model, sample), 1, rawCycles * 100);
  const domain = domainConfidence(model, sample);
  const learnedCycles = clamp(rawCycles * (1 - domain.confidence) + rawLearnedCycles * domain.confidence, 1, rawCycles * 100);
  const learnedMetrics = predictEstimatorSuiteMetrics(model, sample);
  const factor = learnedCycles / Math.max(1, rawCycles);
  const cycles = Math.max(1, Math.round(learnedCycles));
  const timeUs = cycles / Math.max(1, req.hardware.frequencyMHz);
  const utilization = Number.isFinite(learnedMetrics.utilization) ? clamp(Number(learnedMetrics.utilization), 0, 1) : (Number(candidate.utilization) || 0);
  const paddingRatio = Number(candidate.paddingRatio) || 0;
  const sramBytes = Number.isFinite(learnedMetrics.sramBytes) ? Math.max(0, Math.round(Number(learnedMetrics.sramBytes))) : (Number(candidate.sramBytes) || 0);
  const score = cycles / 1e6 + (1 - utilization) * 5 + paddingRatio * 3 + Math.max(0, sramBytes - req.hardware.sramKB * 1024) / Math.max(1, req.hardware.sramKB * 1024);
  const warnings = Array.isArray(candidate.warnings) ? [...candidate.warnings] : [];
  if (factor > 1.5) warnings.push(`Learned estimator 보정 큼: ×${factor.toFixed(2)}`);
  if (domain.confidence < 0.8) warnings.push(`학습 범위 밖 입력으로 neural 예측을 완화했습니다(confidence=${domain.confidence.toFixed(2)}).`);
  for (const w of domain.warnings.slice(0, 3)) warnings.push(w);
  return {
    ...candidate,
    rawCycles,
    calibrationFactor: candidate.calibrationFactor,
    cycles,
    timeUs,
    score,
    learnedMetrics: { ...learnedMetrics, utilization, domainConfidence: domain.confidence },
    warnings: Array.from(new Set(warnings)),
    explanation: `${candidate.explanation} Learned estimator suite가 analytical ${rawCycles.toLocaleString()} cycles를 ${cycles.toLocaleString()} cycles로 보정했습니다(×${factor.toFixed(3)}).`,
  };
}

function compareAdjustedCandidates(a: TileCandidateResult, b: TileCandidateResult) {
  return a.score - b.score
    || a.cycles - b.cycles
    || b.utilization - a.utilization
    || a.sramBytes - b.sramBytes
    || (b.tileM * b.tileN * b.tileK) - (a.tileM * a.tileN * a.tileK)
    || b.tileM - a.tileM
    || b.tileN - a.tileN
    || b.tileK - a.tileK;
}

export function applyEstimatorSuiteToSearchResponse(response: SearchResponse, model?: EstimatorSuiteModel | null): SearchResponseWithEstimatorSuite {
  if (!model || model.kind !== "tileforge-estimator-suite-v1") {
    return { ...response, estimatorSuite: { applied: false, adjustedCandidates: 0, totalAnalyticalCycles: response.summary.totalCycles, totalLearnedCycles: response.summary.totalCycles, averageCycleFactor: 1, totalWeightedCycleFactor: 1, minDomainConfidence: 1, warnings: ["활성 Estimator Suite 모델이 없습니다."] } };
  }
  const request = response.request;
  const warnings: string[] = [];
  const results = response.results.map(result => {
    const adjustedCandidates = result.candidates.map(c => adjustCandidate(request, model, c)).sort(compareAdjustedCandidates);
    const best = adjustedCandidates[0] ?? adjustCandidate(request, model, result.best);
    const pareto = result.pareto.map(c => adjustCandidate(request, model, c)).sort(compareAdjustedCandidates);
    const heatmap = result.heatmap.map(h => {
      const candidate = result.candidates.find(c => c.tileM === h.tileM && c.tileN === h.tileN && c.tileK === h.tileK) ?? h;
      const adjusted = adjustCandidate(request, model, candidate as TileCandidateResult);
      return {
        ...h,
        rawCycles: adjusted.rawCycles,
        cycles: adjusted.cycles,
        timeUs: adjusted.timeUs,
        score: adjusted.score,
        warnings: adjusted.warnings,
      };
    });
    return { ...result, best, candidates: adjustedCandidates, pareto, heatmap };
  });
  const bests = results.map(r => r.best);
  const analyticalTotal = response.results.reduce((sum, r) => sum + Math.max(1, r.best.rawCycles ?? r.best.cycles), 0);
  const learnedTotal = bests.reduce((sum, b) => sum + b.cycles, 0);
  const factors = bests.map(b => b.cycles / Math.max(1, b.rawCycles ?? b.cycles));
  const confidences = bests.map(b => Number((b as any).learnedMetrics?.domainConfidence)).filter(v => Number.isFinite(v));
  const summary = {
    totalCycles: learnedTotal,
    totalTimeUs: bests.reduce((a, b) => a + b.timeUs, 0),
    meanUtilization: mean(bests.map(b => b.utilization)),
    meanPaddingRatio: mean(bests.map(b => b.paddingRatio)),
    maxSramBytes: Math.max(...bests.map(b => b.sramBytes), 0),
    bottleneckOp: bests.slice().sort((a, b) => b.cycles - a.cycles)[0]?.opName ?? "none",
  };
  if (model.metadata.samples < 40) warnings.push("모델 학습 sample이 적어 예측 신뢰도가 낮을 수 있습니다.");
  const estimatorSuite: EstimatorSuiteApplicationSummary = {
    applied: true,
    modelKind: model.kind,
    recommended: model.recommended,
    weights: model.weights,
    modelSamples: model.metadata.samples,
    adjustedCandidates: response.results.reduce((sum, r) => sum + r.candidates.length, 0),
    totalAnalyticalCycles: analyticalTotal,
    totalLearnedCycles: learnedTotal,
    averageCycleFactor: mean(factors),
    totalWeightedCycleFactor: learnedTotal / Math.max(1, analyticalTotal),
    minDomainConfidence: confidences.length ? Math.min(...confidences) : 1,
    warnings,
  };
  const pairs = results.map(r => ({ shape: r.shape, best: r.best }));
  const updated: SearchResponseWithEstimatorSuite = {
    ...response,
    results,
    summary,
    bottlenecks: analyzeBottlenecks({ request, results, summary }),
    roofline: computeRoofline(request.hardware, pairs),
    energy: computeEnergy(request.hardware, pairs),
    estimatorSuite,
  };
  // `estimateAll` creates artifacts before this learned correction is applied.
  // Regenerate report.md here so the web preview and full-pipeline artifacts do
  // not say "Learned Estimator Suite: 미적용" while the cycles were actually
  // adjusted.
  updated.artifacts = {
    ...updated.artifacts,
    reportMarkdown: generateReportMarkdown(updated),
  };
  return updated;
}
