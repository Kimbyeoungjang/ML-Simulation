import { describe, expect, it } from "vitest";
import { buildValidationRunbook, validationRunbookMarkdown } from "../src/lib/validationRunbook";
import type { ValidationPlan } from "../src/lib/validationPlan";

function plan(tasks: ValidationPlan["tasks"]): ValidationPlan {
  return {
    schema: "tileforge.validation-plan.v1",
    generatedAt: "test",
    summary: {
      taskCount: tasks.length,
      criticalTasks: 0,
      highTasks: 0,
      firstActions: [],
      blockedPurposes: [],
    },
    tasks,
  };
}

describe("validationRunbook", () => {
  it("turns validation plan tasks into concrete no-demo commands", () => {
    const runbook = buildValidationRunbook({
      artifactDir: "/tmp/job with space",
      generatedAt: "test",
      plan: plan([
        {
          id: "full-layer",
          kind: "scalesim-full-layer",
          priority: "high",
          priorityScore: 0.8,
          targetScope: "full-layer",
          reason: "risk",
          commandHint: "hint",
          artifactInputs: ["topology.csv"],
          expectedEvidence: ["validation_evidence.md"],
          blocksPurposes: ["hardware-design"],
        },
        {
          id: "runtime",
          kind: "iree-runtime-benchmark",
          priority: "medium",
          priorityScore: 0.5,
          targetScope: "iree-runtime",
          reason: "runtime missing",
          commandHint: "hint",
          artifactInputs: ["generated.mlir"],
          expectedEvidence: ["iree_runtime_decision.md"],
          blocksPurposes: ["iree-options"],
        },
      ]),
    });

    expect(runbook.schema).toBe("tileforge.validation-runbook.v1");
    expect(runbook.commands[0].command).toContain("npm run run:scalesim");
    expect(runbook.commands[0].command).toContain("--no-demo");
    expect(runbook.commands[0].command).toContain('"/tmp/job with space"');
    expect(runbook.commands[1].command).toContain("npm run benchmark:iree");
    expect(runbook.summary.firstCommand).toContain("run:scalesim");
    expect(validationRunbookMarkdown(runbook)).toContain("Validation Runbook");
  });

  it("marks feedback tasks as manual review", () => {
    const runbook = buildValidationRunbook({
      artifactDir: "/tmp/job",
      plan: plan([
        {
          id: "feedback",
          kind: "estimator-suite-feedback",
          priority: "low",
          priorityScore: 0.1,
          targetScope: "model-feedback",
          reason: "feedback",
          commandHint: "review",
          artifactInputs: ["validation_feedback_policy.md"],
          expectedEvidence: ["estimator_suite_feedback_full_layer.csv"],
          blocksPurposes: [],
        },
      ]),
    });
    expect(runbook.commands[0].canExecuteDirectly).toBe(false);
    expect(runbook.commands[0].safety).toBe("manual-review");
  });
});
