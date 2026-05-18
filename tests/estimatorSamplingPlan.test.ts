import { describe, expect, it } from "vitest";
import { defaultHardware } from "../src/lib/defaults";
import { buildEstimatorSamplingPlan, parseArrayRange, parsePlanRange } from "../src/lib/estimatorSamplingPlan";
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
});
