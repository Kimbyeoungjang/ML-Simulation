import { describe, expect, it } from "vitest";
import { defaultHardware } from "../src/lib/defaults";
import { buildEstimatorSamplingPlan, isHeavyScaleSimPlanRow, parseArrayRange, parsePlanRange, requestFromPlanRow } from "../src/lib/estimatorSamplingPlan";
import { estimatorPresets } from "../src/lib/estimatorPresets";
import type { SearchRequest } from "../src/types/domain";

describe("estimator sampling plan", () => {
  it("parses colon ranges and array lists", () => {
    expect(parsePlanRange("64:256:64")).toEqual([64, 128, 192, 256]);
    expect(parsePlanRange("256:128:64")).toEqual([128, 192, 256]);
    expect(parseArrayRange("64x64,128x256", 32, 32)).toEqual([{ rows: 64, cols: 64 }, { rows: 128, cols: 256 }]);
  });

  it("builds bounded SCALE-Sim sampling rows", () => {
    const request: SearchRequest = {
      hardware: defaultHardware,
      shapes: [{ id: "base", model: "demo", opName: "gemm", m: 64, n: 64, k: 64, dtypeBytes: 2 }],
      candidates: { tileM: [16, 32], tileN: [16, 32], tileK: [16, 32] },
      objective: "balanced",
      maxResultsPerOp: 2,
    };
    const plan = buildEstimatorSamplingPlan(request, {
      mRange: "64:128:64",
      nRange: "64:128:64",
      kRange: "64:128:64",
      arrayRange: "32x32,64x64",
      sramKbRange: "1024,2048",
      dataflows: "WS,OS",
      tileMRange: "16,32",
      tileNRange: "16,32",
      tileKRange: "16,32",
      topKPerShape: 1,
      maxSamples: 10,
    });
    expect(plan.rows).toHaveLength(10);
    expect(plan.csv).toContain("measuredCycles");
    expect(plan.csv).toContain("scaleSimRunName");
    expect(new Set(plan.rows.map((r) => r.id)).size).toBe(plan.rows.length);
  });
  it("keeps early bounded samples balanced across WS/OS/IS", () => {
    const request: SearchRequest = {
      hardware: defaultHardware,
      shapes: [{ id: "base", model: "demo", opName: "gemm", m: 64, n: 64, k: 64, dtypeBytes: 2 }],
      candidates: { tileM: [16, 32], tileN: [16, 32], tileK: [16, 32] },
      objective: "balanced",
      maxResultsPerOp: 2,
    };
    const plan = buildEstimatorSamplingPlan(request, {
      mRange: "64:512:64",
      nRange: "64:512:64",
      kRange: "64:512:64",
      dataflows: "WS,OS,IS",
      tileMRange: "16,32",
      tileNRange: "16,32",
      tileKRange: "16,32",
      topKPerShape: 1,
      maxSamples: 12,
      includeCurrentShapes: false,
    });
    expect(plan.rows).toHaveLength(12);
    expect(new Set(plan.rows.map((r) => r.dataflow))).toEqual(new Set(["WS", "OS", "IS"]));
    expect(plan.rows.slice(0, 3).map((r) => r.dataflow).sort()).toEqual(["IS", "OS", "WS"]);
  });

  it("builds lite real-ML presets without synthetic or Llama-scale rows", () => {
    const request: SearchRequest = {
      hardware: defaultHardware,
      shapes: [{ id: "base", model: "demo", opName: "gemm", m: 64, n: 64, k: 64, dtypeBytes: 2 }],
      candidates: { tileM: [16, 32], tileN: [16, 32], tileK: [16, 32] },
      objective: "balanced",
      maxResultsPerOp: 2,
    };
    const preset = estimatorPresets.find((p) => p.id === "real-ml-lite-1024");
    expect(preset).toBeTruthy();
    const plan = buildEstimatorSamplingPlan(request, preset!.planOptions);
    expect(plan.rows).toHaveLength(1024);
    expect(plan.rows.some((row) => /llama/i.test(`${row.model} ${row.opName}`))).toBe(false);
    expect(plan.rows.some((row) => row.model === "sampling_plan")).toBe(false);
    expect(Math.max(...plan.rows.map((row) => row.n))).toBeLessThanOrEqual(4096);
    expect(Math.max(...plan.rows.map((row) => row.k))).toBeLessThanOrEqual(4096);
  });

  it("routes heavy SCALE-Sim rows to tile-policy mode", () => {
    const request: SearchRequest = {
      hardware: defaultHardware,
      shapes: [{ id: "base", model: "demo", opName: "gemm", m: 64, n: 64, k: 64, dtypeBytes: 2 }],
      candidates: { tileM: [16], tileN: [16], tileK: [16] },
      objective: "balanced",
    };
    const row = {
      id: "heavy",
      model: "llama",
      opName: "gate_up_projection",
      arrayRows: 128,
      arrayCols: 128,
      sramKB: 8192,
      frequencyMHz: 700,
      memoryBandwidthGBs: "",
      dispatchOverheadUs: "",
      dataflow: "WS" as const,
      dtypeBytes: 2,
      m: 128,
      n: 22016,
      k: 4096,
      tileM: 128,
      tileN: 512,
      tileK: 512,
      estimatorCycles: 1,
      measuredCycles: "",
      scaleSimRunName: "heavy",
    };
    expect(isHeavyScaleSimPlanRow(row)).toBe(true);
    expect(requestFromPlanRow(request, row).scaleSim?.measurementMode).toBe("tile-policy");
  });

});
