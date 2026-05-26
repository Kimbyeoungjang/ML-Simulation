import type { SearchResponse } from "@/types/domain";
import type { PurposeGateReport } from "./purposeGate";

export const ARTIFACT_GUIDE_SCHEMA = "tileforge.artifact-guide.v1" as const;

type ArtifactPurpose = "start-here" | "hardware-design" | "tiling-strategy" | "iree-options" | "external-validation" | "model-trust" | "raw-export" | "debug";

type ArtifactGuideEntry = {
  name: string;
  purpose: ArtifactPurpose;
  priority: number;
  whenToOpen: string;
  trustBoundary: string;
};

const GUIDE: Record<string, Omit<ArtifactGuideEntry, "name">> = {
  "artifact_guide.md": { purpose: "start-here", priority: 0, whenToOpen: "산출물이 너무 많을 때 가장 먼저 봅니다.", trustBoundary: "navigation only" },
  "purpose_gate.md": { purpose: "start-here", priority: 1, whenToOpen: "결과를 하드웨어 설계/타일링/IREE 옵션으로 써도 되는지 판단합니다.", trustBoundary: "uses current confidence and external validation status" },
  "report.md": { purpose: "start-here", priority: 2, whenToOpen: "전체 요약, best tile, 병목, 외부 검증 반영 상태를 봅니다.", trustBoundary: "mixes estimator output and appended external validation; check sections carefully" },
  "prediction_contract.json": { purpose: "model-trust", priority: 3, whenToOpen: "full-layer와 tile-policy metric의 의미가 헷갈릴 때 봅니다.", trustBoundary: "metric semantics contract" },
  "full_layer_model_card.md": { purpose: "model-trust", priority: 4, whenToOpen: "full-layer 예측식과 보정 상수의 적용 범위를 확인합니다.", trustBoundary: "model assumptions, not external proof" },
  "prediction_risk_register.md": { purpose: "model-trust", priority: 5, whenToOpen: "어떤 op가 underfill, padding, SRAM spill, bandwidth sensitivity 때문에 먼저 검증되어야 하는지 확인합니다.", trustBoundary: "risk triage, not measured error" },
  "prediction_risk_register.json": { purpose: "model-trust", priority: 6, whenToOpen: "op별 prediction risk를 자동화 도구에서 읽습니다.", trustBoundary: "machine-readable risk triage" },
  "validation_plan.md": { purpose: "external-validation", priority: 7, whenToOpen: "risk register와 purpose gate를 실제 SCALE-Sim/IREE 검증 큐로 변환한 순서를 봅니다.", trustBoundary: "action plan; evidence is produced only after running tasks" },
  "validation_plan.json": { purpose: "external-validation", priority: 8, whenToOpen: "검증 큐를 자동화 도구에서 읽습니다.", trustBoundary: "machine-readable validation queue" },
  "validation_runbook.md": { purpose: "external-validation", priority: 9, whenToOpen: "validation_plan을 실제 실행 명령으로 변환한 runbook을 봅니다.", trustBoundary: "commands only; evidence is produced after execution" },
  "validation_execution_report.md": { purpose: "external-validation", priority: 12, whenToOpen: "validation runbook 명령을 dry-run/실행한 결과를 확인합니다.", trustBoundary: "execution log; environment-dependent evidence" },
  "validation_execution_report.json": { purpose: "external-validation", priority: 13, whenToOpen: "검증 실행 결과를 자동화 도구에서 읽습니다.", trustBoundary: "machine-readable execution log" },
  "validation_runbook.json": { purpose: "external-validation", priority: 10, whenToOpen: "검증 runbook을 자동화 도구에서 읽습니다.", trustBoundary: "machine-readable command runbook" },
  "confidence.md": { purpose: "model-trust", priority: 7, whenToOpen: "예측 신뢰도, uncertainty, 외부 검증 적용 여부를 확인합니다.", trustBoundary: "heuristic confidence" },
  "hardware_design_plan.md": { purpose: "hardware-design", priority: 10, whenToOpen: "array/SRAM/bandwidth/dataflow 설계 판단을 정리합니다.", trustBoundary: "estimate-first guidance; promote with SCALE-Sim" },
  "tiling_strategy.md": { purpose: "tiling-strategy", priority: 20, whenToOpen: "선택된 tile과 대안 후보를 비교합니다.", trustBoundary: "tile-policy ranking; not final latency" },
  "best_tile_policy.csv": { purpose: "tiling-strategy", priority: 21, whenToOpen: "후보별 score/cycles/utilization/SRAM을 표로 분석합니다.", trustBoundary: "tile-policy candidates" },
  "compiler_hints.md": { purpose: "iree-options", priority: 30, whenToOpen: "IREE lowering에 넣어볼 tile/vector hint를 봅니다.", trustBoundary: "benchmark candidate only" },
  "iree_benchmark_plan.md": { purpose: "iree-options", priority: 31, whenToOpen: "baseline vs hinted VMFB runtime A-B 실험 계획을 봅니다.", trustBoundary: "plan, not performance proof" },
  "iree-runtime/iree_runtime_decision.md": { purpose: "iree-options", priority: 32, whenToOpen: "baseline/hinted runtime 결과를 승격/보류/회귀로 해석합니다.", trustBoundary: "runtime evidence; still backend/input dependent" },
  "iree-runtime/iree_runtime_benchmark_report.md": { purpose: "iree-options", priority: 33, whenToOpen: "IREE compile과 runtime 측정 로그 요약을 확인합니다.", trustBoundary: "runtime harness output" },
  "iree_runtime_purpose_gate.md": { purpose: "iree-options", priority: 34, whenToOpen: "IREE runtime evidence가 purpose gate에 반영된 최종 상태를 확인합니다.", trustBoundary: "derived from runtime decision and current job artifacts" },
  "iree_runtime_purpose_gate.json": { purpose: "iree-options", priority: 35, whenToOpen: "IREE runtime 반영 purpose gate를 도구에서 읽습니다.", trustBoundary: "machine-readable runtime-aware gate" },
  "external_environment.md": { purpose: "external-validation", priority: 39, whenToOpen: "SCALE-Sim/IREE가 어떤 OS, command, fallback 후보, version에 의존하는지 확인합니다.", trustBoundary: "environment diagnostics, not validation result" },
  "external_environment.json": { purpose: "external-validation", priority: 39, whenToOpen: "외부 도구 환경 정보를 자동화 도구에서 읽습니다.", trustBoundary: "machine-readable environment diagnostics" },
  "external_validation_report.md": { purpose: "external-validation", priority: 40, whenToOpen: "SCALE-Sim cycle 및 IREE compile 결과를 확인합니다.", trustBoundary: "external tool output, but environment/version dependent" },
  "validation_report.md": { purpose: "external-validation", priority: 41, whenToOpen: "op별 predicted vs SCALE-Sim 비교를 봅니다.", trustBoundary: "requires matched SCALE-Sim layers" },
  "validation_report.csv": { purpose: "external-validation", priority: 42, whenToOpen: "검증 sample을 Estimator Suite 재학습용으로 내보냅니다.", trustBoundary: "full-layer validation rows only" },
  "validation_evidence.md": { purpose: "external-validation", priority: 43, whenToOpen: "SCALE-Sim row가 full-layer 학습 target인지 tile-policy 진단인지 구분합니다.", trustBoundary: "evidence ledger; separates design targets from ranking diagnostics" },
  "validation_evidence.json": { purpose: "external-validation", priority: 44, whenToOpen: "검증 evidence를 도구로 재사용하거나 자동 분석합니다.", trustBoundary: "machine-readable validation ledger" },
  "validation_feedback_policy.md": { purpose: "model-trust", priority: 45, whenToOpen: "검증 evidence를 어떤 학습 CSV로 승격할지 확인합니다.", trustBoundary: "feedback routing policy; prevents target-scope mixing" },
  "validation_feedback_policy.json": { purpose: "model-trust", priority: 46, whenToOpen: "검증 feedback routing 결과를 도구에서 읽습니다.", trustBoundary: "machine-readable feedback policy" },
  "estimator_suite_feedback_full_layer.csv": { purpose: "model-trust", priority: 47, whenToOpen: "하드웨어 설계용 full-layer Estimator Suite 재학습에 사용합니다.", trustBoundary: "design-target rows only" },
  "estimator_suite_feedback_tile_policy.csv": { purpose: "model-trust", priority: 48, whenToOpen: "tile-policy ranking/regret 진단이나 별도 ranking 모델 실험에 사용합니다.", trustBoundary: "ranking diagnostic only; not full-layer latency" },
  "estimator_suite_feedback.csv": { purpose: "model-trust", priority: 49, whenToOpen: "전체 검증 feedback을 감사하거나 수동 분석합니다.", trustBoundary: "audit export; prefer scoped CSV for training" },
  "full_layer_model_card.json": { purpose: "model-trust", priority: 50, whenToOpen: "모델 카드 정보를 도구에서 읽을 때 사용합니다.", trustBoundary: "machine-readable model assumptions" },
  "result.json": { purpose: "raw-export", priority: 60, whenToOpen: "전체 SearchResponse를 재사용하거나 디버깅합니다.", trustBoundary: "raw estimator response" },
  "policy-db.json": { purpose: "raw-export", priority: 61, whenToOpen: "정책 DB나 재사용 가능한 candidate 기록이 필요할 때 봅니다.", trustBoundary: "derived policy entries" },
  "generated.mlir": { purpose: "raw-export", priority: 70, whenToOpen: "IREE compile input을 직접 확인합니다.", trustBoundary: "generated code, not measured performance" },
  "transform.mlir": { purpose: "iree-options", priority: 71, whenToOpen: "hinted IREE compile에 넣을 transform 후보를 확인합니다.", trustBoundary: "experimental transform hint" },
  "scalesim.cfg": { purpose: "raw-export", priority: 80, whenToOpen: "SCALE-Sim 설정을 재현합니다.", trustBoundary: "external simulator input" },
  "topology.csv": { purpose: "raw-export", priority: 81, whenToOpen: "SCALE-Sim full-layer topology 입력을 확인합니다.", trustBoundary: "GEMM encoded as SCALE-Sim-compatible topology" },
  "layout.csv": { purpose: "raw-export", priority: 82, whenToOpen: "SCALE-Sim layout 입력을 확인합니다.", trustBoundary: "layout hint" },
  "external_tools.json": { purpose: "debug", priority: 90, whenToOpen: "SCALE-Sim/IREE command 설정과 version을 확인합니다.", trustBoundary: "environment snapshot" },
  "artifact_integrity.json": { purpose: "debug", priority: 91, whenToOpen: "artifact checksum과 저장 무결성을 검증합니다.", trustBoundary: "file integrity, not semantic correctness" },
};

function lookup(name: string): ArtifactGuideEntry {
  const base = GUIDE[name] ?? { purpose: "raw-export" as const, priority: 100, whenToOpen: "필요할 때 원본 산출물로 확인합니다.", trustBoundary: "auxiliary artifact" };
  return { name, ...base };
}

function byPriority(a: ArtifactGuideEntry, b: ArtifactGuideEntry): number {
  return a.priority - b.priority || a.name.localeCompare(b.name);
}

export function artifactGuideJson(input: {
  artifacts: string[];
  res?: SearchResponse;
  gate?: PurposeGateReport;
  externalApplied?: boolean;
}): string {
  const unique = [...new Set(input.artifacts)].filter(Boolean).map(lookup).sort(byPriority);
  const byPurpose = unique.reduce<Record<string, string[]>>((acc, item) => {
    (acc[item.purpose] ??= []).push(item.name);
    return acc;
  }, {});
  return JSON.stringify(
    {
      schema: ARTIFACT_GUIDE_SCHEMA,
      generatedAt: new Date().toISOString(),
      recommendedOrder: unique.slice(0, 12).map((item) => item.name),
      byPurpose,
      entries: unique,
      currentRun: input.res
        ? {
            totalCycles: input.res.summary.totalCycles,
            opCount: input.res.results.length,
            minPredictionConfidence: input.res.summary.minPredictionConfidence ?? null,
            bottleneckOp: input.res.summary.bottleneckOp,
          }
        : null,
      purposeGate: input.gate
        ? Object.fromEntries(input.gate.decisions.map((p) => [p.area, p.status]))
        : null,
      externalApplied: Boolean(input.externalApplied),
    },
    null,
    2,
  );
}

export function artifactGuideMarkdown(input: {
  artifacts: string[];
  res?: SearchResponse;
  gate?: PurposeGateReport;
  externalApplied?: boolean;
}): string {
  const entries = [...new Set(input.artifacts)].filter(Boolean).map(lookup).sort(byPriority);
  const lines: string[] = [];
  lines.push("# Artifact Guide", "");
  lines.push("산출물이 많을 때 이 파일을 먼저 보면 됩니다. TileForge 결과는 목적별로 봐야 하며, 모든 파일이 같은 수준의 근거를 의미하지 않습니다.", "");
  if (input.res) {
    lines.push("## Current run summary", "");
    lines.push(`- op 수: ${input.res.results.length}`);
    lines.push(`- estimator total cycles: ${input.res.summary.totalCycles.toLocaleString()}`);
    lines.push(`- min prediction confidence: ${(((input.res.summary.minPredictionConfidence ?? 1) * 100)).toFixed(1)}%`);
    lines.push(`- bottleneck op: ${input.res.summary.bottleneckOp}`);
    lines.push(`- external validation appended: ${input.externalApplied ? "yes" : "no"}`, "");
  }
  if (input.gate?.decisions?.length) {
    lines.push("## Purpose gate summary", "");
    lines.push("| purpose | status | next action |", "|---|---|---|");
    for (const p of input.gate.decisions) lines.push(`| ${p.area} | ${p.status} | ${(p.nextActions ?? []).join("; ") || "-"} |`);
    lines.push("");
  }
  lines.push("## Open these first", "");
  for (const name of ["purpose_gate.md", "report.md", "prediction_contract.json", "full_layer_model_card.md", "prediction_risk_register.md", "validation_plan.md", "validation_runbook.md", "validation_execution_report.md"].filter((n) => entries.some((e) => e.name === n))) {
    const item = lookup(name);
    lines.push(`- **${item.name}** — ${item.whenToOpen}`);
  }
  lines.push("", "## Purpose-based map", "");
  for (const purpose of ["hardware-design", "tiling-strategy", "iree-options", "external-validation", "model-trust", "raw-export", "debug"] as ArtifactPurpose[]) {
    const group = entries.filter((e) => e.purpose === purpose);
    if (!group.length) continue;
    lines.push(`### ${purpose}`, "");
    lines.push("| file | when to open | trust boundary |", "|---|---|---|");
    for (const item of group) lines.push(`| ${item.name} | ${item.whenToOpen} | ${item.trustBoundary} |`);
    lines.push("");
  }
  lines.push("## Safety rules", "");
  lines.push("- `tilePolicyCycles`는 타일 후보 ranking 값이며 full-layer latency가 아닙니다.");
  lines.push("- `fullLayerCycles`는 빠른 하드웨어 설계용 추정값이며 cycle-accurate simulator 결과가 아닙니다.");
  lines.push("- IREE compile 성공은 runtime 성능 향상을 의미하지 않습니다. `benchmark:iree` 실행 후에는 `iree_runtime_purpose_gate.md`에서 runtime evidence가 반영된 판단을 확인하세요.");
  lines.push("- 최종 설계 결정은 `purpose_gate.md`, `prediction_risk_register.md`, `validation_plan.md`, `validation_runbook.md`, `validation_execution_report.md`, SCALE-Sim full-layer ratio, IREE runtime A-B benchmark를 함께 보고 해야 합니다.");
  lines.push("- Estimator Suite에 재학습 데이터를 넣을 때는 `validation_feedback_policy.md`를 먼저 보고, 하드웨어 설계용이면 `estimator_suite_feedback_full_layer.csv`를 우선 사용하세요.");
  return lines.join("\n");
}
