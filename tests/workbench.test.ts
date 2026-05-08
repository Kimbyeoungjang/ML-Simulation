import { describe, expect, it } from "vitest";
import { estimateAll } from "@/lib/estimator";
import { hardwarePresets, workloadPresets } from "@/lib/presets";

describe("workbench analyses", () => {
  it("produces bottleneck, roofline, energy, and paper artifacts", () => {
    const res = estimateAll({
      hardware: hardwarePresets[1],
      shapes: workloadPresets["ViT-S encoder block"],
      candidates: { tileM: [32,64,128], tileN: [64,128], tileK: [32,64,128] },
      objective: "balanced",
      maxResultsPerOp: 8
    });
    expect(res.bottlenecks?.topOps.length).toBeGreaterThan(0);
    expect(res.roofline?.length).toBe(res.results.length);
    expect(res.energy?.totalEnergyUJ).toBeGreaterThan(0);
    expect(res.artifacts.latexTable).toContain("\\begin{tabular}");
    expect(res.artifacts.ireeCommand).toContain("iree-compile");
  });
});
