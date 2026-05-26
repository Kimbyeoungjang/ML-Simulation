import { describe, expect, it } from "vitest";
import type { ValidationRunbook } from "../src/lib/validationRunbook";
import {
  buildValidationExecutionReport,
  executionPreflight,
  recordFromCommand,
  selectValidationRunbookCommands,
  validationExecutionReportMarkdown,
} from "../src/lib/validationExecutionReport";

function runbook(): ValidationRunbook {
  return {
    schema: "tileforge.validation-runbook.v1",
    generatedAt: "test",
    artifactDir: "/tmp/job",
    summary: { commandCount: 3, directCommands: 2, manualReviewCommands: 1, firstCommand: "npm run doctor:external" },
    commands: [
      {
        taskId: "doctor",
        kind: "environment-doctor",
        priority: "critical",
        safety: "read-only",
        command: "npm run doctor:external -- --require-external",
        cwd: ".",
        canExecuteDirectly: true,
        expectedEvidence: ["external_environment.md"],
        note: "doctor",
      },
      {
        taskId: "full-layer",
        kind: "scalesim-full-layer",
        priority: "high",
        safety: "external-run",
        command: "npm run run:scalesim -- --artifact /tmp/job --no-demo",
        cwd: ".",
        canExecuteDirectly: true,
        expectedEvidence: ["validation_evidence.md"],
        note: "scalesim",
      },
      {
        taskId: "feedback",
        kind: "estimator-suite-feedback",
        priority: "low",
        safety: "manual-review",
        command: "open validation_feedback_policy.md",
        cwd: ".",
        canExecuteDirectly: false,
        expectedEvidence: ["estimator_suite_feedback_full_layer.csv"],
        note: "review",
      },
    ],
  };
}

describe("validationExecutionReport", () => {
  it("plans commands in dry-run and blocks external commands without explicit permission", () => {
    const rb = runbook();
    const records = selectValidationRunbookCommands(rb, {}).map((command) => {
      const preflight = executionPreflight(command, {});
      return recordFromCommand(command, preflight.status, preflight.reason);
    });
    const report = buildValidationExecutionReport({ runbook: rb, records, opts: {} });
    expect(report.mode).toBe("dry-run");
    expect(report.summary.planned).toBe(1);
    expect(report.summary.blocked).toBe(1);
    expect(report.summary.skipped).toBe(1);
    expect(report.summary.externalBlocked).toBe(1);
    expect(validationExecutionReportMarkdown(report)).toContain("--allow-external");
  });

  it("allows external commands only when allowExternal is set", () => {
    const external = runbook().commands[1];
    expect(executionPreflight(external, { execute: true }).status).toBe("blocked");
    expect(executionPreflight(external, { execute: true, allowExternal: true }).executable).toBe(true);
  });

  it("filters commands by kind and maxCommands", () => {
    const selected = selectValidationRunbookCommands(runbook(), { kinds: ["scalesim-full-layer"], maxCommands: 1 });
    expect(selected).toHaveLength(1);
    expect(selected[0].taskId).toBe("full-layer");
  });
});
