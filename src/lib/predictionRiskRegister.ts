import type { SearchResponse, TileCandidateResult } from "@/types/domain";

export const PREDICTION_RISK_REGISTER_SCHEMA = "tileforge.prediction-risk-register.v1" as const;

export type PredictionRiskKind =
  | "low-confidence"
  | "array-underfill"
  | "high-padding"
  | "tile-sram-pressure"
  | "full-layer-working-set-spill"
  | "bandwidth-sensitive"
  | "long-reduction"
  | "estimator-suite-domain";

export interface PredictionRiskIssue {
  kind: PredictionRiskKind;
  severity: number;
  evidence: string;
  recommendation: string;
}

export interface PredictionRiskOp {
  model: string;
  opName: string;
  shapeId: string;
  m: number;
  n: number;
  k: number;
  tile: { tileM: number; tileN: number; tileK: number };
  predictionConfidence?: number;
  tileScratchBytes?: number;
  fullLayerWorkingSetBytes?: number;
  fullLayerCycles?: number;
  fullLayerStallCycles?: number;
  riskScore: number;
  riskLevel: "low" | "medium" | "high";
  issues: PredictionRiskIssue[];
}

export interface PredictionRiskRegister {
  schema: typeof PREDICTION_RISK_REGISTER_SCHEMA;
  generatedAt: string;
  summary: {
    opCount: number;
    highRiskOps: number;
    mediumRiskOps: number;
    maxRiskScore: number;
    dominantKinds: Array<{ kind: PredictionRiskKind; count: number; maxSeverity: number }>;
    recommendedScaleSimOps: Array<{ model: string; opName: string; shapeId: string; reason: string }>;
  };
  ops: PredictionRiskOp[];
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
}

function bytes(n: number | undefined) {
  if (!Number.isFinite(n)) return "n/a";
  const value = Number(n);
  if (value >= 1024 ** 3) return `${(value / 1024 ** 3).toFixed(2)} GiB`;
  if (value >= 1024 ** 2) return `${(value / 1024 ** 2).toFixed(2)} MiB`;
  if (value >= 1024) return `${(value / 1024).toFixed(2)} KiB`;
  return `${Math.round(value)} B`;
}

function riskLevel(score: number): PredictionRiskOp["riskLevel"] {
  if (score >= 0.66) return "high";
  if (score >= 0.33) return "medium";
  return "low";
}

function pushIssue(
  issues: PredictionRiskIssue[],
  kind: PredictionRiskKind,
  severity: number,
  evidence: string,
  recommendation: string,
) {
  const s = clamp01(severity);
  if (s <= 0.05) return;
  issues.push({ kind, severity: s, evidence, recommendation });
}

function estimateStallRatio(best: TileCandidateResult) {
  const stall = Number(best.fullLayerStallCycles);
  const total = Number(best.fullLayerCycles ?? best.cycles);
  if (!Number.isFinite(stall) || !Number.isFinite(total) || total <= 0) return undefined;
  return clamp01(stall / total);
}

function weightedRisk(issues: PredictionRiskIssue[]) {
  if (!issues.length) return 0;
  const max = Math.max(...issues.map((x) => x.severity));
  const averageTop3 = issues
    .map((x) => x.severity)
    .sort((a, b) => b - a)
    .slice(0, 3)
    .reduce((a, b, _i, arr) => a + b / arr.length, 0);
  return clamp01(max * 0.65 + averageTop3 * 0.35);
}

export function buildPredictionRiskRegister(
  response: SearchResponse,
  opts: { generatedAt?: string } = {},
): PredictionRiskRegister {
  const hw = response.request.hardware;
  const arrayRows = Math.max(1, hw.arrayRows);
  const arrayCols = Math.max(1, hw.arrayCols);
  const sramBytes = Math.max(1, hw.sramKB * 1024);
  const ops: PredictionRiskOp[] = [];

  for (const result of response.results) {
    const shape = result.shape;
    const best = result.best;
    const issues: PredictionRiskIssue[] = [];

    const conf = Number(best.predictionConfidence);
    if (Number.isFinite(conf)) {
      pushIssue(
        issues,
        "low-confidence",
        1 - conf,
        `predictionConfidence=${conf.toFixed(3)}`,
        "이 op를 representative SCALE-Sim full-layer sample에 포함하고, 검증 row를 full-layer feedback CSV에 누적하세요.",
      );
    }

    const mFill = Math.min(1, shape.m / arrayRows);
    const nFill = Math.min(1, shape.n / arrayCols);
    const spatialFill = clamp01(mFill * nFill);
    if (spatialFill < 0.62) {
      pushIssue(
        issues,
        "array-underfill",
        (0.62 - spatialFill) / 0.62,
        `spatial fill≈${(spatialFill * 100).toFixed(1)}% for shape M=${shape.m}, N=${shape.n} on ${arrayRows}x${arrayCols}`,
        "작은 shape 전용으로 더 작은 array 후보 또는 batching/fusion 후보를 함께 sweep하세요.",
      );
    }

    const padding = Number(best.paddingRatio);
    if (Number.isFinite(padding) && padding > 0.18) {
      pushIssue(
        issues,
        "high-padding",
        Math.min(1, padding / 0.65),
        `paddingRatio=${(padding * 100).toFixed(1)}% for tile ${best.tileM}x${best.tileN}x${best.tileK}`,
        "M/N/K 약수 기반 tile 후보와 boundary-friendly tile을 추가해 top-k 후보를 다시 비교하세요.",
      );
    }

    const scratch = Number(best.tileScratchBytes ?? best.sramBytes);
    const scratchRatio = scratch / sramBytes;
    if (Number.isFinite(scratchRatio) && scratchRatio > 0.72) {
      pushIssue(
        issues,
        "tile-sram-pressure",
        Math.min(1, (scratchRatio - 0.72) / 0.55),
        `tile scratch=${bytes(scratch)} (${(scratchRatio * 100).toFixed(1)}% of SRAM ${bytes(sramBytes)})`,
        "SRAM 여유가 작으므로 double buffering, bank conflict, layout overhead를 감안해 작은 tile 대안을 검증하세요.",
      );
    }

    const workingSet = Number(best.fullLayerSramBytes);
    const workingRatio = workingSet / sramBytes;
    if (Number.isFinite(workingRatio) && workingRatio > 1.5) {
      pushIssue(
        issues,
        "full-layer-working-set-spill",
        Math.min(1, Math.log2(workingRatio) / 6),
        `full-layer working set=${bytes(workingSet)} (${workingRatio.toFixed(2)}x SRAM ${bytes(sramBytes)})`,
        "full-layer cycle은 spill/refill heuristic에 민감합니다. SCALE-Sim full-layer 검증을 우선 실행하세요.",
      );
    }

    const stallRatio = estimateStallRatio(best);
    if (stallRatio != null && stallRatio > 0.2) {
      pushIssue(
        issues,
        "bandwidth-sensitive",
        Math.min(1, (stallRatio - 0.2) / 0.55),
        `estimated full-layer stall ratio=${(stallRatio * 100).toFixed(1)}%`,
        "memoryBandwidthGBs sweep과 SCALE-Sim bandwidth report를 함께 보고 bandwidth-bound 여부를 확인하세요.",
      );
    }

    const reductionFolds = Math.ceil(shape.k / arrayRows);
    if (reductionFolds >= 16) {
      pushIssue(
        issues,
        "long-reduction",
        Math.min(1, Math.log2(reductionFolds / 8) / 4),
        `K=${shape.k}, arrayRows=${arrayRows}, reduction folds=${reductionFolds}`,
        "긴 K reduction은 dataflow별 refill 비용에 민감합니다. WS/OS/IS 비교와 top-k 검증을 같이 수행하세요.",
      );
    }

    const domainConfidence = Number(best.learnedMetrics?.domainConfidence);
    if (Number.isFinite(domainConfidence) && domainConfidence < 0.65) {
      pushIssue(
        issues,
        "estimator-suite-domain",
        (0.65 - domainConfidence) / 0.65,
        `Estimator Suite domainConfidence=${domainConfidence.toFixed(3)}`,
        "활성 Estimator Suite가 이 domain을 충분히 보지 못했습니다. readiness와 coverage를 확인하고 해당 domain sample을 추가하세요.",
      );
    }

    const riskScore = weightedRisk(issues);
    ops.push({
      model: result.shape.model,
      opName: result.shape.opName,
      shapeId: result.shape.id,
      m: shape.m,
      n: shape.n,
      k: shape.k,
      tile: { tileM: best.tileM, tileN: best.tileN, tileK: best.tileK },
      predictionConfidence: Number.isFinite(conf) ? conf : undefined,
      tileScratchBytes: Number.isFinite(scratch) ? scratch : undefined,
      fullLayerWorkingSetBytes: Number.isFinite(workingSet) ? workingSet : undefined,
      fullLayerCycles: best.fullLayerCycles ?? best.cycles,
      fullLayerStallCycles: best.fullLayerStallCycles,
      riskScore,
      riskLevel: riskLevel(riskScore),
      issues: issues.sort((a, b) => b.severity - a.severity),
    });
  }

  const dominant = new Map<PredictionRiskKind, { count: number; maxSeverity: number }>();
  for (const op of ops) {
    const seen = new Set<PredictionRiskKind>();
    for (const issue of op.issues) {
      if (seen.has(issue.kind)) continue;
      seen.add(issue.kind);
      const current = dominant.get(issue.kind) ?? { count: 0, maxSeverity: 0 };
      current.count += 1;
      current.maxSeverity = Math.max(current.maxSeverity, issue.severity);
      dominant.set(issue.kind, current);
    }
  }

  const recommendedScaleSimOps = [...ops]
    .filter((op) => op.riskLevel === "high" || op.issues.some((x) => x.kind === "full-layer-working-set-spill" || x.kind === "bandwidth-sensitive" || x.kind === "low-confidence"))
    .sort((a, b) => b.riskScore - a.riskScore)
    .slice(0, 8)
    .map((op) => ({
      model: op.model,
      opName: op.opName,
      shapeId: op.shapeId,
      reason: op.issues[0]?.evidence ?? `riskScore=${op.riskScore.toFixed(3)}`,
    }));

  return {
    schema: PREDICTION_RISK_REGISTER_SCHEMA,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    summary: {
      opCount: ops.length,
      highRiskOps: ops.filter((op) => op.riskLevel === "high").length,
      mediumRiskOps: ops.filter((op) => op.riskLevel === "medium").length,
      maxRiskScore: ops.reduce((m, op) => Math.max(m, op.riskScore), 0),
      dominantKinds: [...dominant.entries()]
        .map(([kind, v]) => ({ kind, count: v.count, maxSeverity: v.maxSeverity }))
        .sort((a, b) => b.count - a.count || b.maxSeverity - a.maxSeverity),
      recommendedScaleSimOps,
    },
    ops: ops.sort((a, b) => b.riskScore - a.riskScore),
  };
}

export function predictionRiskRegisterJson(register: PredictionRiskRegister): string {
  return JSON.stringify(register, null, 2);
}

export function predictionRiskRegisterMarkdown(register: PredictionRiskRegister): string {
  const lines: string[] = [];
  lines.push("# Prediction Risk Register", "");
  lines.push("이 파일은 full-layer estimate가 어느 op에서 과신되기 쉬운지 정리합니다. confidence 숫자 하나가 아니라, 위험 원인을 op별로 분리해서 봅니다.", "");
  lines.push("## Summary", "");
  lines.push(`- op 수: ${register.summary.opCount}`);
  lines.push(`- high-risk op 수: ${register.summary.highRiskOps}`);
  lines.push(`- medium-risk op 수: ${register.summary.mediumRiskOps}`);
  lines.push(`- max risk score: ${(register.summary.maxRiskScore * 100).toFixed(0)}%`);
  if (register.summary.dominantKinds.length) {
    lines.push("", "## Dominant risk kinds", "", "| kind | affected ops | max severity |", "|---|---:|---:|");
    for (const item of register.summary.dominantKinds) {
      lines.push(`| ${item.kind} | ${item.count} | ${(item.maxSeverity * 100).toFixed(0)}% |`);
    }
  }
  if (register.summary.recommendedScaleSimOps.length) {
    lines.push("", "## Recommended SCALE-Sim validation samples", "", "| op | shapeId | reason |", "|---|---|---|");
    for (const item of register.summary.recommendedScaleSimOps) {
      lines.push(`| ${item.model}.${item.opName} | ${item.shapeId} | ${item.reason} |`);
    }
  }
  lines.push("", "## Highest-risk ops", "", "| op | risk | main issues | next action |", "|---|---:|---|---|");
  for (const op of register.ops.slice(0, 12)) {
    const main = op.issues.slice(0, 3).map((x) => `${x.kind}: ${x.evidence}`).join("<br>") || "-";
    const action = op.issues[0]?.recommendation ?? "추가 검증이 필요하지 않습니다.";
    lines.push(`| ${op.model}.${op.opName} | ${(op.riskScore * 100).toFixed(0)}% ${op.riskLevel} | ${main} | ${action} |`);
  }
  lines.push("", "## Interpretation", "");
  lines.push("- 이 파일은 estimator를 부정하는 것이 아니라, 어떤 op를 먼저 외부 검증해야 하는지 우선순위를 정합니다.");
  lines.push("- high-risk op가 있으면 `purpose_gate.md`에서 hardware-design을 바로 ready로 해석하기 어렵습니다.");
  lines.push("- `estimator_suite_feedback_full_layer.csv`에는 full-layer SCALE-Sim evidence만 넣고, tile-policy diagnostic과 섞지 마세요.");
  return lines.join("\n");
}
