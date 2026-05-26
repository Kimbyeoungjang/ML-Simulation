import type { SearchResponse } from "@/types/domain";
import type { PurposeGateExternalSummary, PurposeGateReport, PurposeGateStatus } from "./purposeGate";
import type { PredictionRiskIssue, PredictionRiskKind, PredictionRiskOp, PredictionRiskRegister } from "./predictionRiskRegister";
import type { IreeRuntimeDecision } from "./ireeRuntimeEvidence";

export const VALIDATION_PLAN_SCHEMA = "tileforge.validation-plan.v1" as const;

export type ValidationTaskKind =
  | "scalesim-full-layer"
  | "scalesim-top-k"
  | "iree-runtime-benchmark"
  | "estimator-suite-feedback"
  | "environment-doctor";

export type ValidationTaskPriority = "critical" | "high" | "medium" | "low";

export interface ValidationPlanTask {
  id: string;
  kind: ValidationTaskKind;
  priority: ValidationTaskPriority;
  priorityScore: number;
  targetScope: "full-layer" | "tile-policy" | "iree-runtime" | "environment" | "model-feedback";
  model?: string;
  opName?: string;
  shapeId?: string;
  reason: string;
  commandHint: string;
  artifactInputs: string[];
  expectedEvidence: string[];
  blocksPurposes: Array<"hardware-design" | "tiling-strategy" | "iree-options">;
}

export interface ValidationPlan {
  schema: typeof VALIDATION_PLAN_SCHEMA;
  generatedAt: string;
  summary: {
    taskCount: number;
    criticalTasks: number;
    highTasks: number;
    firstActions: string[];
    blockedPurposes: Array<"hardware-design" | "tiling-strategy" | "iree-options">;
  };
  tasks: ValidationPlanTask[];
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
}

function priority(score: number): ValidationTaskPriority {
  if (score >= 0.86) return "critical";
  if (score >= 0.66) return "high";
  if (score >= 0.36) return "medium";
  return "low";
}

function sanitizeId(value: string) {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 96) || "task";
}

function issueSeverity(op: PredictionRiskOp, kinds: PredictionRiskKind[]) {
  return op.issues
    .filter((issue) => kinds.includes(issue.kind))
    .reduce((max, issue) => Math.max(max, issue.severity), 0);
}

function issueEvidence(op: PredictionRiskOp, kinds?: PredictionRiskKind[]) {
  const issues = kinds?.length ? op.issues.filter((issue) => kinds.includes(issue.kind)) : op.issues;
  return issues
    .slice(0, 3)
    .map((issue) => `${issue.kind}: ${issue.evidence}`)
    .join("; ") || `riskScore=${op.riskScore.toFixed(3)}`;
}

function opTaskKey(kind: ValidationTaskKind, op: PredictionRiskOp) {
  return `${kind}:${op.shapeId}:${op.tile.tileM}x${op.tile.tileN}x${op.tile.tileK}`;
}

function taskFromRiskOp(kind: "scalesim-full-layer" | "scalesim-top-k", op: PredictionRiskOp, score: number, reason: string): ValidationPlanTask {
  const fullLayer = kind === "scalesim-full-layer";
  return {
    id: sanitizeId(`${kind}-${op.model}-${op.opName}-${op.shapeId}`),
    kind,
    priority: priority(score),
    priorityScore: clamp01(score),
    targetScope: fullLayer ? "full-layer" : "tile-policy",
    model: op.model,
    opName: op.opName,
    shapeId: op.shapeId,
    reason,
    commandHint: fullLayer
      ? "full-pipeline 또는 validate:external로 SCALE-Sim full-layer COMPUTE_REPORT를 생성한 뒤 validation_evidence.md를 확인하세요."
      : "topology_top3.csv/layout_top3.csv 기반 SCALE-Sim top-k 비교를 실행해 rank-1 regret을 확인하세요.",
    artifactInputs: fullLayer
      ? ["scalesim.cfg", "topology.csv", "layout.csv"]
      : ["scalesim.cfg", "topology_top3.csv", "layout_top3.csv", "best_tile_policy.csv"],
    expectedEvidence: fullLayer
      ? ["external_validation_report.md", "validation_evidence.md", "estimator_suite_feedback_full_layer.csv"]
      : ["scalesim_top3_summary.json", "validation_evidence.md", "estimator_suite_feedback_tile_policy.csv"],
    blocksPurposes: fullLayer ? ["hardware-design"] : ["tiling-strategy", "iree-options"],
  };
}

function statusOf(gate: PurposeGateReport | undefined, area: "hardware-design" | "tiling-strategy" | "iree-options"): PurposeGateStatus | undefined {
  return gate?.decisions.find((decision) => decision.area === area)?.status;
}

function addUnique(tasks: Map<string, ValidationPlanTask>, key: string, task: ValidationPlanTask) {
  const existing = tasks.get(key);
  if (!existing || task.priorityScore > existing.priorityScore) tasks.set(key, task);
}

export function buildValidationPlan(input: {
  response: SearchResponse;
  riskRegister: PredictionRiskRegister;
  gate?: PurposeGateReport;
  scaleSim?: PurposeGateExternalSummary;
  iree?: PurposeGateExternalSummary;
  ireeRuntime?: IreeRuntimeDecision;
  generatedAt?: string;
}): ValidationPlan {
  const tasks = new Map<string, ValidationPlanTask>();
  const fullLayerKinds: PredictionRiskKind[] = [
    "low-confidence",
    "full-layer-working-set-spill",
    "bandwidth-sensitive",
    "array-underfill",
    "estimator-suite-domain",
  ];
  const tileKinds: PredictionRiskKind[] = ["high-padding", "tile-sram-pressure", "long-reduction"];

  for (const op of input.riskRegister.ops.slice(0, 12)) {
    const fullSeverity = issueSeverity(op, fullLayerKinds);
    const tileSeverity = issueSeverity(op, tileKinds);
    if (op.riskLevel === "high" || fullSeverity >= 0.28) {
      const score = clamp01(Math.max(op.riskScore, fullSeverity));
      addUnique(
        tasks,
        opTaskKey("scalesim-full-layer", op),
        taskFromRiskOp(
          "scalesim-full-layer",
          op,
          score,
          `full-layer estimate risk: ${issueEvidence(op, fullLayerKinds)}`,
        ),
      );
    }
    if (tileSeverity >= 0.26 || op.issues.some((issue) => issue.kind === "high-padding" && issue.severity >= 0.18)) {
      const score = clamp01(Math.max(tileSeverity, op.riskScore * 0.85));
      addUnique(
        tasks,
        opTaskKey("scalesim-top-k", op),
        taskFromRiskOp(
          "scalesim-top-k",
          op,
          score,
          `tile-policy ranking risk: ${issueEvidence(op, tileKinds)}`,
        ),
      );
    }
  }

  if (!input.scaleSim?.ok && statusOf(input.gate, "hardware-design") !== "ready") {
    const score = input.scaleSim && !input.scaleSim.ok ? 0.94 : 0.72;
    addUnique(tasks, "environment-or-full-layer-scalesim", {
      id: "run-scalesim-full-layer-validation",
      kind: input.scaleSim && !input.scaleSim.ok ? "environment-doctor" : "scalesim-full-layer",
      priority: priority(score),
      priorityScore: score,
      targetScope: input.scaleSim && !input.scaleSim.ok ? "environment" : "full-layer",
      reason: input.scaleSim && !input.scaleSim.ok
        ? "SCALE-Sim execution failed, so hardware-design cannot be promoted."
        : "No full-layer SCALE-Sim ratio is available yet.",
      commandHint: input.scaleSim && !input.scaleSim.ok
        ? "npm run doctor:external 후 external_environment.md와 scalesim_summary.json의 error/log tail을 확인하세요."
        : "npm run validate:external:required 또는 full-pipeline job으로 SCALE-Sim full-layer ratio를 생성하세요.",
      artifactInputs: ["external_environment.md", "scalesim.cfg", "topology.csv", "layout.csv"],
      expectedEvidence: ["external_validation_report.md", "scalesim_summary.json", "validation_evidence.md"],
      blocksPurposes: ["hardware-design"],
    });
  }

  if (statusOf(input.gate, "tiling-strategy") !== "ready") {
    addUnique(tasks, "top-k-regret-check", {
      id: "run-scalesim-top-k-regret-check",
      kind: "scalesim-top-k",
      priority: priority(0.61),
      priorityScore: 0.61,
      targetScope: "tile-policy",
      reason: "tile-policy ranking has not been validated with top-k SCALE-Sim regret evidence.",
      commandHint: "full-pipeline job이 생성한 topology_top3.csv/layout_top3.csv로 SCALE-Sim top-k 비교를 실행하세요.",
      artifactInputs: ["topology_top3.csv", "layout_top3.csv", "best_tile_policy.csv"],
      expectedEvidence: ["scalesim_top3_summary.json", "purpose_gate.md"],
      blocksPurposes: ["tiling-strategy", "iree-options"],
    });
  }

  const ireeStatus = statusOf(input.gate, "iree-options");
  if (input.iree && !input.iree.ok) {
    addUnique(tasks, "iree-compile-environment", {
      id: "fix-iree-compile-before-runtime",
      kind: "environment-doctor",
      priority: "critical",
      priorityScore: 0.96,
      targetScope: "environment",
      reason: "IREE compile failed; compiler hints cannot be promoted to runtime candidates.",
      commandHint: "npm run doctor:external 후 iree_summary.json과 raw compile log를 확인하세요.",
      artifactInputs: ["generated.mlir", "iree-command.sh", "iree_summary.json", "external_environment.md"],
      expectedEvidence: ["iree_summary.json", "external_environment.md"],
      blocksPurposes: ["iree-options"],
    });
  } else if (input.iree?.ok && (!input.ireeRuntime || ireeStatus !== "ready")) {
    const runtimeStatus = input.ireeRuntime?.status;
    const score = runtimeStatus === "regression" || runtimeStatus === "blocked" ? 0.88 : runtimeStatus === "needs-more-runs" ? 0.7 : 0.66;
    addUnique(tasks, "iree-runtime-ab-test", {
      id: "run-iree-runtime-ab-benchmark",
      kind: "iree-runtime-benchmark",
      priority: priority(score),
      priorityScore: score,
      targetScope: "iree-runtime",
      reason: runtimeStatus
        ? `IREE runtime decision is ${runtimeStatus}; more evidence is required before promoting compiler hints.`
        : "IREE compile succeeded, but baseline/hinted runtime A-B evidence is missing.",
      commandHint: "npm run benchmark:iree -- --artifact <job-dir> --repetitions=5 --min-time-sec=0.05 --correctness-checked",
      artifactInputs: ["generated.mlir", "transform.mlir", "compiler_hints.md", "iree_benchmark_plan.md"],
      expectedEvidence: ["iree-runtime/iree_runtime_decision.md", "iree_runtime_purpose_gate.md"],
      blocksPurposes: ["iree-options"],
    });
  }

  const hasFullLayerFeedback = tasks.size === 0 && input.scaleSim?.ok;
  if (hasFullLayerFeedback || statusOf(input.gate, "hardware-design") === "ready") {
    addUnique(tasks, "feedback-readiness-check", {
      id: "review-feedback-before-estimator-suite-training",
      kind: "estimator-suite-feedback",
      priority: "low",
      priorityScore: 0.24,
      targetScope: "model-feedback",
      reason: "External evidence is available; route it through scoped feedback policy before retraining Estimator Suite.",
      commandHint: "validation_feedback_policy.md를 확인하고 hardware-design 보정에는 estimator_suite_feedback_full_layer.csv만 사용하세요.",
      artifactInputs: ["validation_evidence.md", "validation_feedback_policy.md"],
      expectedEvidence: ["estimator_suite_feedback_full_layer.csv", "estimator-suite-training-policy.md"],
      blocksPurposes: [],
    });
  }

  const sorted = [...tasks.values()].sort((a, b) => b.priorityScore - a.priorityScore || a.id.localeCompare(b.id));
  const blockedPurposes = [...new Set(sorted.flatMap((task) => task.blocksPurposes))];
  return {
    schema: VALIDATION_PLAN_SCHEMA,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    summary: {
      taskCount: sorted.length,
      criticalTasks: sorted.filter((task) => task.priority === "critical").length,
      highTasks: sorted.filter((task) => task.priority === "high").length,
      firstActions: sorted.slice(0, 5).map((task) => `${task.id}: ${task.commandHint}`),
      blockedPurposes,
    },
    tasks: sorted,
  };
}

export function validationPlanJson(plan: ValidationPlan): string {
  return JSON.stringify(plan, null, 2);
}

export function validationPlanMarkdown(plan: ValidationPlan): string {
  const lines: string[] = [];
  lines.push("# Validation Plan", "");
  lines.push("이 파일은 prediction risk register와 purpose gate를 검증 큐로 변환합니다. 실제 명령 목록은 `validation_runbook.md`를 보거나 `npm run validation:plan -- --artifact <job-dir>`로 재생성하세요. 경고를 읽는 데서 끝내지 말고, 우선순위가 높은 task부터 SCALE-Sim/IREE evidence를 생성하세요.", "");
  lines.push("## Summary", "");
  lines.push(`- task 수: ${plan.summary.taskCount}`);
  lines.push(`- critical task 수: ${plan.summary.criticalTasks}`);
  lines.push(`- high task 수: ${plan.summary.highTasks}`);
  lines.push(`- 영향을 받는 목적: ${plan.summary.blockedPurposes.join(", ") || "없음"}`, "");
  if (plan.summary.firstActions.length) {
    lines.push("## First actions", "");
    for (const action of plan.summary.firstActions) lines.push(`- ${action}`);
    lines.push("");
  }
  lines.push("## Task queue", "", "| priority | kind | target | op | reason | command/evidence |", "|---|---|---|---|---|---|");
  for (const task of plan.tasks) {
    const op = task.opName ? `${task.model}.${task.opName}<br>${task.shapeId ?? ""}` : "-";
    const evidence = `${task.commandHint}<br>expected: ${task.expectedEvidence.join(", ")}`;
    lines.push(`| ${task.priority} (${(task.priorityScore * 100).toFixed(0)}%) | ${task.kind} | ${task.targetScope} | ${op} | ${task.reason} | ${evidence} |`);
  }
  lines.push("", "## Safety rules", "");
  lines.push("- `scalesim-full-layer` task에서 얻은 evidence만 하드웨어 설계용 full-layer Estimator Suite target으로 승격하세요.");
  lines.push("- `scalesim-top-k` task는 tile-policy ranking/regret 진단용이며 full-layer latency 보정 데이터와 섞지 마세요.");
  lines.push("- `iree-runtime-benchmark` task는 correctness check 없이는 compiler hint를 ready로 승격하지 않습니다.");
  lines.push("- `environment-doctor` task가 있으면 estimator 수식보다 외부 도구 설정을 먼저 고치세요.");
  return lines.join("\n");
}
