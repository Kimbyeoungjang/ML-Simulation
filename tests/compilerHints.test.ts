import { describe, expect, it } from "vitest";
import { estimateAll } from "@/lib/estimator";
import { hardwarePresets, workloadPresets } from "@/lib/presets";

describe("compiler hints artifacts", () => {
  it("separates full-layer, tile-policy, and IREE lowering-hint targets", () => {
    const res = estimateAll({
      hardware: hardwarePresets[1],
      shapes: workloadPresets["ViT-S encoder block"].slice(0, 1),
      candidates: { tileM: [32, 64, 128], tileN: [64, 128], tileK: [32, 64, 128] },
      objective: "balanced",
      maxResultsPerOp: 4,
    });
    expect(res.results[0].best.predictionTarget).toBe("full-layer");
    expect(res.results[0].best.tilePolicyCycles).toBeGreaterThan(0);
    expect(res.results[0].best.predictionConfidence).toBeGreaterThan(0);
    expect(res.artifacts.compilerHintsJson).toContain("iree-lowering-hints");
    expect(res.artifacts.compilerHintsMarkdown).toContain("compile 성공은 runtime 성능 검증이 아닙니다");
    expect(res.artifacts.predictionContractJson).toContain("full-layer cycle is not the same quantity");
    expect(res.artifacts.ireeBenchmarkPlanMarkdown).toContain("npm run benchmark:iree");
  });
});
