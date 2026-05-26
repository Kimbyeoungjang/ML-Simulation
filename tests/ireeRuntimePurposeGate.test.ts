import { describe, expect, it } from "vitest";
import { estimateAll } from "@/lib/estimator";
import { buildIreeRuntimeDecision } from "@/lib/ireeRuntimeEvidence";
import { evaluatePurposeGate } from "@/lib/purposeGate";
import { defaultCandidates, defaultHardware } from "@/lib/defaults";
import type { SearchRequest } from "@/types/domain";

const request: SearchRequest = {
  hardware: defaultHardware,
  shapes: [
    {
      id: "gemm0",
      model: "demo",
      opName: "matmul",
      m: 256,
      n: 256,
      k: 256,
      dtypeBytes: 2,
    },
  ],
  candidates: defaultCandidates,
  objective: "balanced",
  maxResultsPerOp: 8,
};

const confidence = {
  level: "high" as const,
  score: 0.9,
  reasons: [],
  uncertaintyPct: 8,
};

function readyScaleAndIree(response: ReturnType<typeof estimateAll>) {
  const best = response.results[0].best;
  return {
    scaleSim: {
      ok: true,
      skipped: false,
      tool: "scalesim" as const,
      triedCommands: ["mock"],
      cycleRatio: 1.04,
      totalCycles: Math.round(response.summary.totalCycles * 1.04),
      candidateLayers: [
        { name: "matmul_r1", shapeId: "gemm0", opName: "matmul", rank: 1, cycles: best.cycles },
        { name: "matmul_r2", shapeId: "gemm0", opName: "matmul", rank: 2, cycles: Math.round(best.cycles * 1.07) },
      ],
    },
    iree: {
      ok: true,
      skipped: false,
      tool: "iree" as const,
      triedCommands: ["mock"],
      vmfbBytes: 4096,
    },
  };
}

describe("purposeGate with IREE runtime evidence", () => {
  it("promotes IREE options only when runtime speedup and correctness are both present", () => {
    const response = estimateAll(request);
    const runtime = buildIreeRuntimeDecision({
      runs: [
        { variant: "baseline", function: "matmul", runtime: { medianMs: 10 } },
        { variant: "hinted", function: "matmul", runtime: { medianMs: 8 } },
      ],
    }, { correctness: "checked" });
    const gate = evaluatePurposeGate(response, { confidence, ...readyScaleAndIree(response), ireeRuntime: runtime });
    const iree = gate.decisions.find((d) => d.area === "iree-options");
    expect(iree?.status).toBe("ready");
    expect(gate.summary.ireeRuntimeStatus).toBe("promote-candidate");
    expect(gate.summary.ireeRuntimeCorrectness).toBe("checked");
  });

  it("keeps IREE options in benchmark mode when speedup lacks correctness", () => {
    const response = estimateAll(request);
    const runtime = buildIreeRuntimeDecision({
      runs: [
        { variant: "baseline", function: "matmul", runtime: { medianMs: 10 } },
        { variant: "hinted", function: "matmul", runtime: { medianMs: 8 } },
      ],
    });
    const gate = evaluatePurposeGate(response, { confidence, ...readyScaleAndIree(response), ireeRuntime: runtime });
    expect(gate.decisions.find((d) => d.area === "iree-options")?.status).toBe("needs-benchmark");
    expect(gate.decisions.find((d) => d.area === "iree-options")?.nextActions.join(" ")).toContain("correctness");
  });

  it("blocks or validates first when hinted runtime regresses", () => {
    const response = estimateAll(request);
    const runtime = buildIreeRuntimeDecision({
      runs: [
        { variant: "baseline", function: "matmul", runtime: { medianMs: 10 } },
        { variant: "hinted", function: "matmul", runtime: { medianMs: 12 } },
      ],
    }, { correctness: "checked" });
    const gate = evaluatePurposeGate(response, { confidence, ...readyScaleAndIree(response), ireeRuntime: runtime });
    const iree = gate.decisions.find((d) => d.area === "iree-options");
    expect(iree?.status).toBe("validate-first");
    expect(iree?.nextActions.join(" ")).toContain("baseline");
  });
});
