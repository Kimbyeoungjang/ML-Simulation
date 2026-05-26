import type { ValidationPlan, ValidationTaskKind, ValidationTaskPriority, ValidationPlanTask } from "./validationPlan";

export const VALIDATION_RUNBOOK_SCHEMA = "tileforge.validation-runbook.v1" as const;

export type ValidationRunbookCommandSafety = "read-only" | "external-run" | "manual-review";

export interface ValidationRunbookCommand {
  taskId: string;
  kind: ValidationTaskKind;
  priority: ValidationTaskPriority;
  safety: ValidationRunbookCommandSafety;
  command: string;
  cwd: string;
  canExecuteDirectly: boolean;
  expectedEvidence: string[];
  note: string;
}

export interface ValidationRunbook {
  schema: typeof VALIDATION_RUNBOOK_SCHEMA;
  generatedAt: string;
  artifactDir: string;
  summary: {
    commandCount: number;
    directCommands: number;
    manualReviewCommands: number;
    firstCommand: string | null;
  };
  commands: ValidationRunbookCommand[];
}

function shellQuote(value: string): string {
  if (!value) return '""';
  if (/^[a-zA-Z0-9_./:=@%+,-]+$/.test(value)) return value;
  return `"${value.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

function defaultCommand(task: ValidationPlanTask, artifactDir: string): Omit<ValidationRunbookCommand, "taskId" | "kind" | "priority" | "expectedEvidence"> {
  const artifact = shellQuote(artifactDir);
  switch (task.kind) {
    case "environment-doctor":
      return {
        safety: "read-only",
        command: "npm run doctor:external -- --require-external",
        cwd: ".",
        canExecuteDirectly: true,
        note: "외부 도구가 실행 가능한지 먼저 확인합니다. 이 단계가 실패하면 estimator 문제가 아니라 환경 문제일 가능성이 큽니다.",
      };
    case "scalesim-full-layer":
      return {
        safety: "external-run",
        command: `npm run run:scalesim -- --artifact ${artifact} --out ${shellQuote(`${artifactDir}/scalesim`)} --require-external --no-demo`,
        cwd: ".",
        canExecuteDirectly: true,
        note: "기존 job artifact를 덮어쓰지 않도록 --no-demo를 사용합니다. full-layer COMPUTE_REPORT를 만든 뒤 validation_evidence를 갱신하세요.",
      };
    case "scalesim-top-k":
      return {
        safety: "external-run",
        command: `npm run run:scalesim -- --artifact ${artifact} --out ${shellQuote(`${artifactDir}/scalesim-topk`)} --top-k --require-external --no-demo`,
        cwd: ".",
        canExecuteDirectly: true,
        note: "top-k tile 후보의 ranking/regret 진단용입니다. 이 결과를 full-layer latency target과 섞지 마세요.",
      };
    case "iree-runtime-benchmark":
      return {
        safety: "external-run",
        command: `npm run benchmark:iree -- --artifact ${artifact} --repetitions=5 --min-time-sec=0.05 --correctness-checked`,
        cwd: ".",
        canExecuteDirectly: true,
        note: "baseline/hinted runtime A-B benchmark입니다. correctness가 확인되지 않으면 speedup이 있어도 ready로 승격하지 않습니다.",
      };
    case "estimator-suite-feedback":
      return {
        safety: "manual-review",
        command: `open ${shellQuote(`${artifactDir}/validation_feedback_policy.md`)} && use ${shellQuote(`${artifactDir}/estimator_suite_feedback_full_layer.csv`)} for full-layer training only`,
        cwd: ".",
        canExecuteDirectly: false,
        note: "재학습 전 full-layer/design-target row와 tile-policy/ranking-diagnostic row가 섞이지 않았는지 수동 확인하세요.",
      };
    default:
      return {
        safety: "manual-review",
        command: task.commandHint,
        cwd: ".",
        canExecuteDirectly: false,
        note: "자동 명령으로 변환되지 않은 task입니다. validation_plan.md의 command hint를 확인하세요.",
      };
  }
}

export function buildValidationRunbook(input: {
  plan: ValidationPlan;
  artifactDir: string;
  generatedAt?: string;
  maxCommands?: number;
}): ValidationRunbook {
  const maxCommands = input.maxCommands ?? input.plan.tasks.length;
  const commands = input.plan.tasks.slice(0, maxCommands).map((task) => {
    const base = defaultCommand(task, input.artifactDir);
    return {
      taskId: task.id,
      kind: task.kind,
      priority: task.priority,
      expectedEvidence: task.expectedEvidence,
      ...base,
    } satisfies ValidationRunbookCommand;
  });
  return {
    schema: VALIDATION_RUNBOOK_SCHEMA,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    artifactDir: input.artifactDir,
    summary: {
      commandCount: commands.length,
      directCommands: commands.filter((command) => command.canExecuteDirectly).length,
      manualReviewCommands: commands.filter((command) => !command.canExecuteDirectly).length,
      firstCommand: commands.find((command) => command.canExecuteDirectly)?.command ?? null,
    },
    commands,
  };
}

export function validationRunbookJson(runbook: ValidationRunbook): string {
  return JSON.stringify(runbook, null, 2);
}

export function validationRunbookMarkdown(runbook: ValidationRunbook): string {
  const lines: string[] = [];
  lines.push("# Validation Runbook", "");
  lines.push("이 파일은 validation_plan.json을 실제 실행 가능한 명령 목록으로 변환합니다. 중요한 점은 기존 job artifact를 검증할 때 데모 artifact를 덮어쓰지 않도록 `--no-demo`가 붙는다는 것입니다.", "");
  lines.push("## Summary", "");
  lines.push(`- artifactDir: ${runbook.artifactDir}`);
  lines.push(`- command 수: ${runbook.summary.commandCount}`);
  lines.push(`- 직접 실행 가능: ${runbook.summary.directCommands}`);
  lines.push(`- 수동 확인 필요: ${runbook.summary.manualReviewCommands}`);
  if (runbook.summary.firstCommand) lines.push(`- 첫 실행 권장 명령: \`${runbook.summary.firstCommand}\``);
  lines.push("", "## Commands", "");
  for (const [index, command] of runbook.commands.entries()) {
    lines.push(`### ${index + 1}. ${command.taskId}`);
    lines.push(`- priority: ${command.priority}`);
    lines.push(`- kind: ${command.kind}`);
    lines.push(`- safety: ${command.safety}`);
    lines.push(`- 직접 실행 가능: ${command.canExecuteDirectly ? "예" : "아니오"}`);
    lines.push(`- note: ${command.note}`);
    lines.push(`- expected evidence: ${command.expectedEvidence.join(", ") || "n/a"}`);
    lines.push("", "```bash", command.command, "```", "");
  }
  lines.push("## Safety rules", "");
  lines.push("- `run:scalesim`과 `run:iree`는 기존 artifact가 있으면 더 이상 데모 입력을 덮어쓰지 않습니다. `--demo`를 명시할 때만 강제로 데모를 재생성합니다.");
  lines.push("- `scalesim-top-k` 결과는 tile-policy ranking 진단용입니다. full-layer Estimator Suite target과 섞지 마세요.");
  lines.push("- IREE speedup은 correctness 확인과 반복 측정이 없으면 최종 옵션으로 승격하지 마세요.");
  return lines.join("\n");
}
