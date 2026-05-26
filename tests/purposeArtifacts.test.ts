import { describe, expect, it } from "vitest";
import { estimateAll } from "@/lib/estimator";
import { hardwarePresets, workloadPresets } from "@/lib/presets";

describe("purpose-aligned prediction artifacts", () => {
  it("separates hardware design, tiling strategy, and IREE benchmark artifacts", () => {
    const res = estimateAll({
      hardware: hardwarePresets[1],
      shapes: workloadPresets["ViT-S encoder block"].slice(0, 2),
      candidates: { tileM: [32, 64, 128], tileN: [64, 128], tileK: [32, 64, 128] },
      objective: "balanced",
      maxResultsPerOp: 5,
    });

    expect(res.summary.maxTileScratchBytes).toBeGreaterThan(0);
    expect(res.summary.maxFullLayerSramBytes).toBeGreaterThanOrEqual(res.summary.maxTileScratchBytes ?? 0);
    expect(res.results[0].best.sramBytes).toBe(res.results[0].best.tileScratchBytes);
    expect(res.results[0].best.fullLayerSramBytes).toBeGreaterThan(0);

    expect(res.artifacts.predictionContractJson).toContain("tileforge.prediction-contract.v2");
    expect(res.artifacts.hardwareDesignPlanMarkdown).toContain("Hardware Design Plan");
    expect(res.artifacts.tilingStrategyMarkdown).toContain("Tiling Strategy");
    expect(res.artifacts.ireeBenchmarkPlanMarkdown).toContain("IREE Benchmark Plan");
    expect(res.artifacts.ireeBenchmarkPlanJson).toContain("baseline");
    expect(res.artifacts.policyCsv).toContain("tile_scratch_bytes");
    expect(res.artifacts.policyCsv).toContain("full_layer_working_set_bytes");
  });
});
