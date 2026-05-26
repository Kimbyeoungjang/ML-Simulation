import type { ValidationEvidenceBundle } from "./validationEvidence";

export const VALIDATION_FEEDBACK_POLICY_SCHEMA = "tileforge.validation-feedback-policy.v1" as const;

export interface ValidationFeedbackPolicyReport {
  schema: typeof VALIDATION_FEEDBACK_POLICY_SCHEMA;
  generatedAt: string;
  jobId?: string;
  counts: {
    totalEvidenceRows: number;
    fullLayerDesignTargets: number;
    tilePolicyDiagnostics: number;
    unmatchedRows: number;
    feedbackAllRows: number;
    feedbackFullLayerRows: number;
    feedbackTilePolicyRows: number;
  };
  recommendedFiles: {
    hardwareDesignTraining?: string;
    tilePolicyDiagnostics?: string;
    auditLedger: string;
  };
  warnings: string[];
}

export function buildValidationFeedbackPolicyReport(bundle: ValidationEvidenceBundle): ValidationFeedbackPolicyReport {
  const fullLayerDesignTargets = bundle.rows.filter((r) => r.targetScope === "full-layer" && r.reliability === "design-target" && (r.measuredCycles ?? 0) > 0).length;
  const tilePolicyDiagnostics = bundle.rows.filter((r) => r.targetScope === "tile-policy" && r.reliability === "ranking-diagnostic" && (r.measuredCycles ?? 0) > 0).length;
  const unmatchedRows = bundle.rows.filter((r) => r.reliability === "unmatched" || !(r.measuredCycles && r.measuredCycles > 0)).length;
  const warnings: string[] = [];
  if (!fullLayerDesignTargets) warnings.push("full-layer design-target row가 없습니다. 하드웨어 설계용 Estimator Suite 재학습에는 사용할 수 없습니다.");
  if (tilePolicyDiagnostics) warnings.push("tile-policy diagnostic row가 있습니다. full-layer training CSV와 자동 분리했습니다.");
  if (unmatchedRows) warnings.push(`unmatched/missing row ${unmatchedRows.toLocaleString()}개는 학습 CSV에서 제외했습니다.`);

  return {
    schema: VALIDATION_FEEDBACK_POLICY_SCHEMA,
    generatedAt: new Date().toISOString(),
    jobId: bundle.jobId,
    counts: {
      totalEvidenceRows: bundle.rows.length,
      fullLayerDesignTargets,
      tilePolicyDiagnostics,
      unmatchedRows,
      feedbackAllRows: fullLayerDesignTargets + tilePolicyDiagnostics,
      feedbackFullLayerRows: fullLayerDesignTargets,
      feedbackTilePolicyRows: tilePolicyDiagnostics,
    },
    recommendedFiles: {
      hardwareDesignTraining: fullLayerDesignTargets ? "estimator_suite_feedback_full_layer.csv" : undefined,
      tilePolicyDiagnostics: tilePolicyDiagnostics ? "estimator_suite_feedback_tile_policy.csv" : undefined,
      auditLedger: "validation_evidence.md",
    },
    warnings,
  };
}

export function validationFeedbackPolicyJson(report: ValidationFeedbackPolicyReport): string {
  return JSON.stringify(report, null, 2);
}

export function validationFeedbackPolicyMarkdown(report: ValidationFeedbackPolicyReport): string {
  const lines: string[] = [];
  lines.push("# Validation Feedback Policy", "");
  lines.push("이 파일은 SCALE-Sim 검증 evidence를 Estimator Suite 재학습 데이터로 되돌릴 때 어떤 CSV를 사용해야 하는지 정리합니다. 목표는 full-layer 하드웨어 설계 target과 tile-policy ranking diagnostic을 조용히 섞지 않는 것입니다.", "");
  lines.push("## Summary", "");
  lines.push("| item | value |", "|---|---:|");
  lines.push(`| total evidence rows | ${report.counts.totalEvidenceRows.toLocaleString()} |`);
  lines.push(`| full-layer design targets | ${report.counts.fullLayerDesignTargets.toLocaleString()} |`);
  lines.push(`| tile-policy diagnostics | ${report.counts.tilePolicyDiagnostics.toLocaleString()} |`);
  lines.push(`| unmatched / missing rows | ${report.counts.unmatchedRows.toLocaleString()} |`);
  lines.push("", "## Recommended files", "");
  lines.push("| purpose | file |", "|---|---|");
  lines.push(`| hardware-design Estimator Suite training | ${report.recommendedFiles.hardwareDesignTraining ?? "n/a"} |`);
  lines.push(`| tile-policy ranking diagnostics | ${report.recommendedFiles.tilePolicyDiagnostics ?? "n/a"} |`);
  lines.push(`| audit ledger | ${report.recommendedFiles.auditLedger} |`);
  lines.push("", "## Warnings", "");
  if (report.warnings.length) for (const warning of report.warnings) lines.push(`- ${warning}`);
  else lines.push("없음");
  lines.push("", "## Rules", "");
  lines.push("- 하드웨어 설계용 보정 모델은 `estimator_suite_feedback_full_layer.csv`를 우선 사용하세요.");
  lines.push("- `estimator_suite_feedback.csv`는 전체 evidence export이므로 감사/분석용입니다. 학습 기본값으로 쓰지 마세요.");
  lines.push("- `estimator_suite_feedback_tile_policy.csv`는 ranking/regret 진단용입니다. full-layer cycle target과 섞지 마세요.");
  return lines.join("\n");
}
