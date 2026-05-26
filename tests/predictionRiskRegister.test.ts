import { describe, expect, it } from "vitest";
import { estimateAll } from "../src/lib/estimator";
import { buildPredictionRiskRegister, predictionRiskRegisterMarkdown } from "../src/lib/predictionRiskRegister";
import { evaluatePurposeGate } from "../src/lib/purposeGate";
import type { SearchRequest } from "../src/types/domain";

function confidence(score: number) {
  return {
    level: score >= 0.78 ? ("high" as const) : ("medium" as const),
    score,
    reasons: [],
    uncertaintyPct: 10,
  };
}

describe("predictionRiskRegister", () => {
  it("identifies risky ops and recommends SCALE-Sim validation samples", () => {
    const request: SearchRequest = {
      hardware: {
        name: "large-array-small-sram",
        arrayRows: 256,
        arrayCols: 256,
        frequencyMHz: 700,
        sramKB: 128,
        dataflow: "WS",
        bytesPerElement: 2,
        memoryBandwidthGBs: 16,
      },
      shapes: [
        { id: "tiny", model: "risk", opName: "tiny_underfill", m: 16, n: 16, k: 4096, dtypeBytes: 2 },
        { id: "spill", model: "risk", opName: "spill_big", m: 1024, n: 1024, k: 4096, dtypeBytes: 2 },
      ],
      candidates: { tileM: [16, 64], tileN: [16, 64], tileK: [64, 256] },
      objective: "balanced",
      maxResultsPerOp: 4,
    };
    const response = estimateAll(request);
    const register = buildPredictionRiskRegister(response, { generatedAt: "test" });
    expect(register.schema).toBe("tileforge.prediction-risk-register.v1");
    expect(register.summary.highRiskOps + register.summary.mediumRiskOps).toBeGreaterThan(0);
    expect(register.summary.dominantKinds.map((x) => x.kind)).toContain("array-underfill");
    expect(register.summary.recommendedScaleSimOps.length).toBeGreaterThan(0);
    const md = predictionRiskRegisterMarkdown(register);
    expect(md).toContain("Prediction Risk Register");
    expect(md).toContain("Recommended SCALE-Sim validation samples");
  });

  it("keeps hardware design from ready when risk register has extreme unvalidated risk", () => {
    const request: SearchRequest = {
      hardware: {
        name: "extreme-risk",
        arrayRows: 512,
        arrayCols: 512,
        frequencyMHz: 700,
        sramKB: 64,
        dataflow: "WS",
        bytesPerElement: 2,
        memoryBandwidthGBs: 8,
      },
      shapes: [
        { id: "tiny", model: "risk", opName: "tiny", m: 8, n: 8, k: 8192, dtypeBytes: 2 },
      ],
      candidates: { tileM: [8], tileN: [8], tileK: [256] },
      objective: "balanced",
      maxResultsPerOp: 1,
    };
    const response = estimateAll(request);
    const riskRegister = buildPredictionRiskRegister(response, { generatedAt: "test" });
    const gate = evaluatePurposeGate(response, {
      confidence: confidence(0.95),
      riskRegister,
      scaleSim: {
        ok: true,
        skipped: false,
        tool: "scalesim",
        triedCommands: ["mock"],
        cycleRatio: 1.03,
        totalCycles: Math.round(response.summary.totalCycles * 1.03),
      },
    });
    const hardware = gate.decisions.find((d) => d.area === "hardware-design");
    expect(hardware?.status).not.toBe("ready");
    expect(hardware?.reasons.join("\n")).toContain("prediction risk register");
  });
});
