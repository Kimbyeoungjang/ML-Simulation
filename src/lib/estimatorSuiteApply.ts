import type { SearchRequest, SearchResponse, TileCandidateResult } from "@/types/domain";
import { predictEstimatorSuiteCycles, type EstimatorSuiteModel, type EstimatorSuiteModelName } from "./estimatorSuite";
import type { LearnedEstimatorSample } from "./learnedEstimator";
import { mean } from "./math";
import { generateReportMarkdown } from "./report";

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
  warnings: string[];
}

export interface SearchResponseWithEstimatorSuite extends SearchResponse {
  estimatorSuite?: EstimatorSuiteApplicationSummary;
}

function clamp(x: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, x)); }

function candidateToSample(req: SearchRequest, candidate: TileCandidateResult): LearnedEstimatorSample {
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
  };
}

function adjustCandidate(req: SearchRequest, model: EstimatorSuiteModel, candidate: TileCandidateResult): TileCandidateResult {
  const rawCycles = candidate.rawCycles && candidate.rawCycles > 0 ? candidate.rawCycles : candidate.cycles;
  const sample = candidateToSample(req, { ...candidate, cycles: rawCycles, rawCycles });
  const learnedCycles = clamp(predictEstimatorSuiteCycles(model, sample), 1, rawCycles * 100);
  const factor = learnedCycles / Math.max(1, rawCycles);
  const cycles = Math.max(1, Math.round(learnedCycles));
  const timeUs = cycles / Math.max(1, req.hardware.frequencyMHz);
  const score = cycles / 1e6 + (1 - candidate.utilization) * 5 + candidate.paddingRatio * 3 + Math.max(0, candidate.sramBytes - req.hardware.sramKB * 1024) / Math.max(1, req.hardware.sramKB * 1024);
  const warnings = [...candidate.warnings];
  if (factor > 1.5) warnings.push(`Learned estimator 보정 큼: ×${factor.toFixed(2)}`);
  return {
    ...candidate,
    rawCycles,
    calibrationFactor: candidate.calibrationFactor,
    cycles,
    timeUs,
    score,
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
    return { ...response, estimatorSuite: { applied: false, adjustedCandidates: 0, totalAnalyticalCycles: response.summary.totalCycles, totalLearnedCycles: response.summary.totalCycles, averageCycleFactor: 1, warnings: ["활성 Estimator Suite 모델이 없습니다."] } };
  }
  const request = response.request;
  const warnings: string[] = [];
  const results = response.results.map(result => {
    const adjustedCandidates = result.candidates.map(c => adjustCandidate(request, model, c)).sort(compareAdjustedCandidates);
    const best = adjustedCandidates[0] ?? adjustCandidate(request, model, result.best);
    const pareto = result.pareto.map(c => adjustCandidate(request, model, c)).sort(compareAdjustedCandidates);
    const heatmap = result.heatmap.map(h => {
      const candidate = result.candidates.find(c => c.tileM === h.tileM && c.tileN === h.tileN && c.tileK === h.tileK);
      if (!candidate) return h;
      const adjusted = adjustCandidate(request, model, candidate);
      return { ...h, cycles: adjusted.cycles, score: adjusted.score };
    });
    return { ...result, best, candidates: adjustedCandidates, pareto, heatmap };
  });
  const bests = results.map(r => r.best);
  const analyticalTotal = response.results.reduce((sum, r) => sum + Math.max(1, r.best.rawCycles ?? r.best.cycles), 0);
  const learnedTotal = bests.reduce((sum, b) => sum + b.cycles, 0);
  const factors = bests.map(b => b.cycles / Math.max(1, b.rawCycles ?? b.cycles));
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
    warnings,
  };
  const updated: SearchResponseWithEstimatorSuite = { ...response, results, summary, estimatorSuite };
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
