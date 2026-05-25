import type { SearchRequest, SearchResponse } from "@/types/domain";
import type { RankingMetrics } from "./verification";

export type ConfidenceLevel = "high" | "medium" | "low";
export interface ConfidenceAssessment {
  level: ConfidenceLevel;
  score: number;
  reasons: string[];
  uncertaintyPct: number;
  validationMetrics?: RankingMetrics;
}

export function assessConfidence(response: SearchResponse, opts: { externalValidated?: boolean; estimatorSuiteSamples?: number; validationMetrics?: RankingMetrics; externalCycleRatio?: number } = {}): ConfidenceAssessment {
  let score = 0.75;
  const reasons: string[] = [];
  const req: SearchRequest = response.request;
  const avgPadding = response.summary.meanPaddingRatio;
  const avgUtil = response.summary.meanUtilization;
  const warnings = response.results.flatMap(r => r.best.warnings);

  if (opts.externalValidated) { score += 0.12; reasons.push("SCALE-Sim/IREE 외부 검증 결과를 사용할 수 있습니다."); }
  else { score -= 0.12; reasons.push("아직 SCALE-Sim/IREE 외부 검증 결과가 반영되지 않아 estimator 단독 결과입니다."); }

  if (opts.externalCycleRatio && Number.isFinite(opts.externalCycleRatio)) {
    const ratio = opts.externalCycleRatio;
    const err = Math.abs(ratio - 1);
    if (err <= 0.15) { score += 0.10; reasons.push(`SCALE-Sim 대비 전체 cycle 오차가 낮습니다 (비율 ${ratio.toFixed(3)}배).`); }
    else if (err <= 0.35) { score += 0.03; reasons.push(`SCALE-Sim 대비 전체 cycle 차이가 보통 수준입니다 (비율 ${ratio.toFixed(3)}배).`); }
    else { score -= 0.12; reasons.push(`SCALE-Sim 대비 전체 cycle 차이가 큽니다 (비율 ${ratio.toFixed(3)}배). Estimator Suite 학습 데이터 보강을 권장합니다.`); }
  }

  const metrics = opts.validationMetrics;
  if (metrics?.top3Recall != null) {
    if (metrics.top3Recall >= 0.9) { score += 0.10; reasons.push(`검증 Top-3 recall이 높습니다 (${(metrics.top3Recall * 100).toFixed(1)}%).`); }
    else if (metrics.top3Recall < 0.7) { score -= 0.12; reasons.push(`검증 Top-3 recall이 낮습니다 (${(metrics.top3Recall * 100).toFixed(1)}%).`); }
  }
  if (metrics?.medianRegret != null) {
    if (metrics.medianRegret <= 1.05) { score += 0.08; reasons.push(`중앙 regret이 낮습니다 (${metrics.medianRegret.toFixed(3)}).`); }
    else if (metrics.medianRegret > 1.2) { score -= 0.12; reasons.push(`중앙 regret이 높습니다 (${metrics.medianRegret.toFixed(3)}).`); }
  }

  const estimatorSuiteSamples = opts.estimatorSuiteSamples ?? 0;
  if (estimatorSuiteSamples >= 20) { score += 0.10; reasons.push(`Estimator Suite sample이 ${estimatorSuiteSamples}개 있습니다.`); }
  else if (estimatorSuiteSamples > 0) { score += 0.03; reasons.push(`Estimator Suite sample이 ${estimatorSuiteSamples}개뿐입니다.`); }
  else { score -= 0.08; reasons.push("활성 Estimator Suite가 적용되지 않았습니다."); }

  if (avgPadding > 0.35) { score -= 0.12; reasons.push(`평균 패딩이 높습니다 (${(avgPadding * 100).toFixed(1)}%).`); }
  if (avgUtil < 0.5) { score -= 0.10; reasons.push(`평균 PE 사용률이 낮습니다 (${(avgUtil * 100).toFixed(1)}%).`); }
  if (warnings.length > response.results.length) { score -= 0.08; reasons.push("선택된 여러 타일에서 경고가 발생했습니다."); }
  if (req.shapes.some(s => s.m <= 1 || s.n <= 1 || s.k <= 1)) { score -= 0.06; reasons.push("매우 작거나 동적 shape에 가까운 입력은 extrapolation 의존도가 높습니다."); }
  if (req.hardware.arrayRows * req.hardware.arrayCols >= 256 * 256) { score -= 0.03; reasons.push("매우 큰 배열은 외부 검증이 필요할 수 있습니다."); }

  score = Math.max(0, Math.min(1, score));
  const level: ConfidenceLevel = score >= 0.78 ? "high" : score >= 0.52 ? "medium" : "low";
  const uncertaintyPct = estimateUncertaintyPct(score, avgPadding, avgUtil, estimatorSuiteSamples, opts.externalValidated ?? false, metrics, opts.externalCycleRatio);
  return { level, score, reasons, uncertaintyPct, validationMetrics: metrics };
}

export function estimateUncertaintyPct(score: number, padding: number, util: number, estimatorSuiteSamples: number, externalValidated: boolean, metrics?: RankingMetrics, externalCycleRatio?: number): number {
  let pct = 8 + (1 - score) * 30 + Math.min(20, padding * 25) + Math.max(0, 0.55 - util) * 20;
  if (!externalValidated) pct += 8;
  if (externalValidated && externalCycleRatio && Number.isFinite(externalCycleRatio)) pct += Math.min(18, Math.abs(externalCycleRatio - 1) * 28);
  if (estimatorSuiteSamples === 0) pct += 6;
  if (metrics?.medianRegret != null) pct += Math.max(0, metrics.medianRegret - 1.05) * 30;
  if (metrics?.top3Recall != null && metrics.top3Recall < 0.85) pct += (0.85 - metrics.top3Recall) * 20;
  return Math.max(5, Math.min(60, pct));
}

export function confidenceMarkdown(assessment: ConfidenceAssessment): string {
  const lines = [`${assessment.level === "high" ? "신뢰도: 높음" : assessment.level === "medium" ? "신뢰도: 보통" : "신뢰도: 낮음"} (${(assessment.score * 100).toFixed(0)}%)`, `예상 불확실성: ±${assessment.uncertaintyPct.toFixed(1)}%`, ""];
  if (assessment.validationMetrics) {
    lines.push("검증 지표:");
    lines.push(`- Top-3 recall: ${assessment.validationMetrics.top3Recall != null ? (assessment.validationMetrics.top3Recall * 100).toFixed(1) + "%" : "해당 없음"}`);
    lines.push(`- 중앙 regret: ${assessment.validationMetrics.medianRegret?.toFixed(3) ?? "해당 없음"}`);
    lines.push("");
  }
  lines.push(...assessment.reasons.map(r => `- ${r}`));
  return lines.join("\n");
}
