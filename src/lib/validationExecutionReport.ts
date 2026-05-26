import type { ValidationRunbook, ValidationRunbookCommand, ValidationRunbookCommandSafety } from "./validationRunbook";

export const VALIDATION_EXECUTION_REPORT_SCHEMA = "tileforge.validation-execution-report.v1" as const;

export type ValidationExecutionStatus = "planned" | "skipped" | "passed" | "failed" | "blocked";

export interface ValidationExecutionOptions {
  execute?: boolean;
  allowExternal?: boolean;
  allowReadOnly?: boolean;
  kinds?: string[];
  maxCommands?: number;
  stopOnFailure?: boolean;
  generatedAt?: string;
}

export interface ValidationExecutionRecord {
  taskId: string;
  kind: string;
  priority: string;
  safety: ValidationRunbookCommandSafety;
  command: string;
  cwd: string;
  status: ValidationExecutionStatus;
  exitCode?: number | null;
  durationMs?: number;
  reason: string;
  expectedEvidence: string[];
  stdoutTail?: string;
  stderrTail?: string;
}

export interface ValidationExecutionReport {
  schema: typeof VALIDATION_EXECUTION_REPORT_SCHEMA;
  generatedAt: string;
  artifactDir: string;
  mode: "dry-run" | "execute";
  options: {
    allowExternal: boolean;
    allowReadOnly: boolean;
    stopOnFailure: boolean;
    kinds: string[];
    maxCommands?: number;
  };
  summary: {
    totalCommands: number;
    planned: number;
    skipped: number;
    passed: number;
    failed: number;
    blocked: number;
    externalBlocked: number;
    firstFailureTaskId?: string;
  };
  records: ValidationExecutionRecord[];
}

function matchesKind(command: ValidationRunbookCommand, kinds: string[]): boolean {
  return !kinds.length || kinds.includes(command.kind);
}

export function selectValidationRunbookCommands(
  runbook: ValidationRunbook,
  opts: ValidationExecutionOptions = {},
): ValidationRunbookCommand[] {
  const kinds = opts.kinds ?? [];
  const max = Number.isFinite(opts.maxCommands) ? Math.max(0, Number(opts.maxCommands)) : undefined;
  const selected = runbook.commands.filter((command) => matchesKind(command, kinds));
  return typeof max === "number" ? selected.slice(0, max) : selected;
}

export function executionPreflight(
  command: ValidationRunbookCommand,
  opts: ValidationExecutionOptions = {},
): { status: ValidationExecutionStatus; reason: string; executable: boolean } {
  if (!command.canExecuteDirectly) {
    return { status: "skipped", reason: "manual-review task; not executable by validation:execute", executable: false };
  }
  if (command.safety === "external-run" && !opts.allowExternal) {
    return { status: "blocked", reason: "external-run command requires --allow-external", executable: false };
  }
  if (command.safety === "read-only" && opts.allowReadOnly === false) {
    return { status: "blocked", reason: "read-only command disabled by options", executable: false };
  }
  if (!opts.execute) {
    return { status: "planned", reason: "dry-run; pass --execute to run", executable: false };
  }
  return { status: "planned", reason: "ready to execute", executable: true };
}

function tail(text: string | undefined, max = 4000): string | undefined {
  if (!text) return undefined;
  return text.length > max ? text.slice(-max) : text;
}

export function recordFromCommand(
  command: ValidationRunbookCommand,
  status: ValidationExecutionStatus,
  reason: string,
  extra: Partial<Pick<ValidationExecutionRecord, "exitCode" | "durationMs" | "stdoutTail" | "stderrTail">> = {},
): ValidationExecutionRecord {
  return {
    taskId: command.taskId,
    kind: command.kind,
    priority: command.priority,
    safety: command.safety,
    command: command.command,
    cwd: command.cwd,
    status,
    reason,
    expectedEvidence: command.expectedEvidence,
    exitCode: extra.exitCode,
    durationMs: extra.durationMs,
    stdoutTail: tail(extra.stdoutTail),
    stderrTail: tail(extra.stderrTail),
  };
}

export function buildValidationExecutionReport(input: {
  runbook: ValidationRunbook;
  records: ValidationExecutionRecord[];
  opts?: ValidationExecutionOptions;
}): ValidationExecutionReport {
  const opts = input.opts ?? {};
  const counts = (status: ValidationExecutionStatus) => input.records.filter((r) => r.status === status).length;
  const firstFailure = input.records.find((r) => r.status === "failed" || r.status === "blocked");
  return {
    schema: VALIDATION_EXECUTION_REPORT_SCHEMA,
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    artifactDir: input.runbook.artifactDir,
    mode: opts.execute ? "execute" : "dry-run",
    options: {
      allowExternal: Boolean(opts.allowExternal),
      allowReadOnly: opts.allowReadOnly !== false,
      stopOnFailure: opts.stopOnFailure !== false,
      kinds: opts.kinds ?? [],
      maxCommands: opts.maxCommands,
    },
    summary: {
      totalCommands: input.records.length,
      planned: counts("planned"),
      skipped: counts("skipped"),
      passed: counts("passed"),
      failed: counts("failed"),
      blocked: counts("blocked"),
      externalBlocked: input.records.filter((r) => r.status === "blocked" && r.safety === "external-run").length,
      firstFailureTaskId: firstFailure?.taskId,
    },
    records: input.records,
  };
}

export function validationExecutionReportJson(report: ValidationExecutionReport): string {
  return JSON.stringify(report, null, 2);
}

export function validationExecutionReportMarkdown(report: ValidationExecutionReport): string {
  const lines: string[] = [];
  lines.push("# Validation Execution Report", "");
  lines.push("이 파일은 validation_runbook.md의 명령을 실제로 실행했는지, 또는 dry-run으로 계획만 세웠는지 기록합니다.", "");
  lines.push("## Summary", "");
  lines.push(`- mode: ${report.mode}`);
  lines.push(`- artifactDir: ${report.artifactDir}`);
  lines.push(`- total commands: ${report.summary.totalCommands}`);
  lines.push(`- planned: ${report.summary.planned}`);
  lines.push(`- skipped: ${report.summary.skipped}`);
  lines.push(`- passed: ${report.summary.passed}`);
  lines.push(`- failed: ${report.summary.failed}`);
  lines.push(`- blocked: ${report.summary.blocked}`);
  if (report.summary.firstFailureTaskId) lines.push(`- first failure/block: ${report.summary.firstFailureTaskId}`);
  lines.push("", "## Options", "");
  lines.push(`- allowExternal: ${report.options.allowExternal}`);
  lines.push(`- allowReadOnly: ${report.options.allowReadOnly}`);
  lines.push(`- stopOnFailure: ${report.options.stopOnFailure}`);
  lines.push(`- kind filter: ${report.options.kinds.length ? report.options.kinds.join(", ") : "all"}`);
  lines.push("", "## Records", "");
  lines.push("| task | kind | safety | status | reason |", "|---|---|---|---|---|");
  for (const record of report.records) {
    lines.push(`| ${record.taskId} | ${record.kind} | ${record.safety} | ${record.status} | ${record.reason.replace(/\|/g, "/")} |`);
  }
  lines.push("", "## Commands", "");
  for (const [index, record] of report.records.entries()) {
    lines.push(`### ${index + 1}. ${record.taskId}`);
    lines.push(`- status: ${record.status}`);
    lines.push(`- reason: ${record.reason}`);
    if (typeof record.exitCode !== "undefined") lines.push(`- exitCode: ${record.exitCode}`);
    if (typeof record.durationMs !== "undefined") lines.push(`- durationMs: ${record.durationMs}`);
    lines.push("", "```bash", record.command, "```", "");
    if (record.stderrTail) lines.push("stderr tail:", "```text", record.stderrTail, "```", "");
    if (record.stdoutTail) lines.push("stdout tail:", "```text", record.stdoutTail, "```", "");
  }
  lines.push("## Safety rules", "");
  lines.push("- 기본값은 dry-run입니다. 실제 실행은 `--execute`가 필요합니다.");
  lines.push("- SCALE-Sim/IREE처럼 외부 도구를 실행하는 명령은 `--allow-external` 없이는 실행하지 않고 blocked로 기록합니다.");
  lines.push("- 실패한 task가 있으면 기본적으로 뒤 task를 실행하지 않습니다. 필요하면 `--no-stop-on-failure`를 사용하세요.");
  return lines.join("\n");
}
