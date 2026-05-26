import { describe, expect, it } from "vitest";
import { estimateAll } from "../src/lib/estimator";
import { defaultCandidates, defaultHardware } from "../src/lib/defaults";
import { buildPredictionRiskRegister } from "../src/lib/predictionRiskRegister";
import { evaluatePurposeGate } from "../src/lib/purposeGate";
import { buildValidationPlan, validationPlanMarkdown } from "../src/lib/validationPlan";
import type { SearchRequest } from "../src/types/domain";

function confidence(score: number) {
  return {
    level: score >= 0.78 ? ("high" as const) : ("medium" as const),
    score,
    reasons: [],
    uncertaintyPct: 10,
  };
}

describe("validationPlan", () => {
  it("turns risky full-layer predictions into SCALE-Sim validation tasks", () => {
    const request: SearchRequest = {
      hardware: {
        name: "risk-plan",
        arrayRows: 512,
        arrayCols: 512,
        frequencyMHz: 700,
        sramKB: 64,
        dataflow: "WS",
        bytesPerElement: 2,
        memoryBandwidthGBs: 8,
      },
      shapes: [
        { id: "tiny", model: "risk", opName: "tiny_underfill", m: 8, n: 8, k: 8192, dtypeBytes: 2 },
        { id: "spill", model: "risk", opName: "spill_big", m: 1024, n: 1024, k: 4096, dtypeBytes: 2 },
      ],
      candidates: { tileM: [8, 64], tileN: [8, 64], tileK: [256] },
      objective: "balanced",
      maxResultsPerOp: 4,
    };
    const response = estimateAll(request);
    const riskRegister = buildPredictionRiskRegister(response, { generatedAt: "test" });
    const gate = evaluatePurposeGate(response, { confidence: confidence(0.9), riskRegister });
    const plan = buildValidationPlan({ response, riskRegister, gate, generatedAt: "test" });

    expect(plan.schema).toBe("tileforge.validation-plan.v1");
    expect(plan.tasks.some((task) => task.kind === "scalesim-full-layer")).toBe(true);
    expect(plan.summary.blockedPurposes).toContain("hardware-design");
    expect(validationPlanMarkdown(plan)).toContain("Validation Plan");
  });

  it("adds IREE runtime benchmark task when compile succeeded but runtime evidence is missing", () => {
    const request: SearchRequest = {
      hardware: defaultHardware,
      shapes: [{ id: "gemm0", model: "demo", opName: "matmul", m: 256, n: 256, k: 256, dtypeBytes: 2 }],
      candidates: defaultCandidates,
      objective: "balanced",
      maxResultsPerOp: 4,
    };
    const response = estimateAll(request);
    const riskRegister = buildPredictionRiskRegister(response, { generatedAt: "test" });
    const best = response.results[0].best;
    const scaleSim = {
      ok: true,
      skipped: false,
      tool: "scalesim" as const,
      triedCommands: ["mock"],
      cycleRatio: 1.03,
      totalCycles: Math.round(response.summary.totalCycles * 1.03),
      candidateLayers: [
        { name: "r1", shapeId: "gemm0", opName: "matmul", rank: 1, cycles: best.cycles },
        { name: "r2", shapeId: "gemm0", opName: "matmul", rank: 2, cycles: Math.round(best.cycles * 1.05) },
      ],
    };
    const iree = {
      ok: true,
      skipped: false,
      tool: "iree" as const,
      triedCommands: ["mock"],
      vmfbBytes: 1234,
    };
    const gate = evaluatePurposeGate(response, { confidence: confidence(0.92), scaleSim, iree, riskRegister });
    const plan = buildValidationPlan({ response, riskRegister, gate, scaleSim, iree, generatedAt: "test" });

    expect(plan.tasks.some((task) => task.kind === "iree-runtime-benchmark")).toBe(true);
    expect(plan.summary.blockedPurposes).toContain("iree-options");
  });

  it("routes external tool failures to environment doctor tasks", () => {
    const request: SearchRequest = {
      hardware: defaultHardware,
      shapes: [{ id: "gemm0", model: "demo", opName: "matmul", m: 128, n: 128, k: 128, dtypeBytes: 2 }],
      candidates: defaultCandidates,
      objective: "balanced",
      maxResultsPerOp: 4,
    };
    const response = estimateAll(request);
    const riskRegister = buildPredictionRiskRegister(response, { generatedAt: "test" });
    const scaleSim = {
      ok: false,
      skipped: false,
      tool: "scalesim" as const,
      triedCommands: ["bad"],
      error: "python not found",
    };
    const gate = evaluatePurposeGate(response, { confidence: confidence(0.75), scaleSim, riskRegister });
    const plan = buildValidationPlan({ response, riskRegister, gate, scaleSim, generatedAt: "test" });

    expect(plan.tasks[0].kind).toBe("environment-doctor");
    expect(plan.tasks[0].artifactInputs).toContain("external_environment.md");
  });
});
