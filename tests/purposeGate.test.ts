import { describe, expect, it } from "vitest";
import {
  evaluatePurposeGate,
  purposeGateMarkdown,
} from "../src/lib/purposeGate";
import { estimateAll } from "../src/lib/estimator";
import { defaultCandidates, defaultHardware } from "../src/lib/defaults";
import type { SearchRequest } from "../src/types/domain";

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

function confidence(score: number) {
  return {
    level: score >= 0.78 ? ("high" as const) : ("medium" as const),
    score,
    reasons: [],
    uncertaintyPct: 10,
  };
}

describe("purposeGate", () => {
  it("keeps hardware design in benchmark mode without SCALE-Sim", () => {
    const response = estimateAll(request);
    const gate = evaluatePurposeGate(response, {
      confidence: confidence(0.82),
    });
    expect(
      gate.decisions.find((d) => d.area === "hardware-design")?.status,
    ).toBe("needs-benchmark");
    expect(gate.decisions.find((d) => d.area === "iree-options")?.status).toBe(
      "validate-first",
    );
  });

  it("promotes hardware and tiling when external ratios and top-k regret are stable", () => {
    const response = estimateAll(request);
    const best = response.results[0].best;
    const gate = evaluatePurposeGate(response, {
      confidence: confidence(0.9),
      scaleSim: {
        ok: true,
        skipped: false,
        tool: "scalesim",
        triedCommands: ["mock"],
        cycleRatio: 1.04,
        totalCycles: Math.round(response.summary.totalCycles * 1.04),
        candidateLayers: [
          {
            name: "matmul_r1",
            shapeId: "gemm0",
            opName: "matmul",
            rank: 1,
            cycles: best.cycles,
            tileM: best.tileM,
            tileN: best.tileN,
            tileK: best.tileK,
          },
          {
            name: "matmul_r2",
            shapeId: "gemm0",
            opName: "matmul",
            rank: 2,
            cycles: Math.round(best.cycles * 1.09),
            tileM: best.tileM,
            tileN: best.tileN,
            tileK: best.tileK,
          },
        ],
      },
      iree: {
        ok: true,
        skipped: false,
        tool: "iree",
        triedCommands: ["mock"],
        vmfbBytes: 1234,
      },
    });
    expect(
      gate.decisions.find((d) => d.area === "hardware-design")?.status,
    ).toBe("ready");
    expect(
      gate.decisions.find((d) => d.area === "tiling-strategy")?.status,
    ).toBe("ready");
    expect(gate.decisions.find((d) => d.area === "iree-options")?.status).toBe(
      "needs-benchmark",
    );
    expect(purposeGateMarkdown(gate)).toContain("runtime A-B benchmark");
  });

  it("blocks IREE option promotion when compile failed", () => {
    const response = estimateAll(request);
    const gate = evaluatePurposeGate(response, {
      confidence: confidence(0.7),
      iree: {
        ok: false,
        skipped: false,
        tool: "iree",
        triedCommands: ["bad"],
        error: "compile failed",
      },
    });
    expect(gate.decisions.find((d) => d.area === "iree-options")?.status).toBe(
      "blocked",
    );
  });
});
