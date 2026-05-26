import { describe, expect, it } from "vitest";
import { artifactGuideJson, artifactGuideMarkdown } from "../src/lib/artifactGuide";
import { fullLayerModelCardJson, fullLayerModelCardMarkdown, SPILL_CALIBRATION } from "../src/lib/fullLayerModelCard";
import { estimateAll } from "../src/lib/estimator";
import { defaultCandidates, defaultHardware } from "../src/lib/defaults";
import type { SearchRequest } from "../src/types/domain";

const request: SearchRequest = {
  hardware: defaultHardware,
  shapes: [
    { id: "gemm0", model: "demo", opName: "matmul", m: 128, n: 256, k: 64, dtypeBytes: 2 },
  ],
  candidates: defaultCandidates,
  objective: "balanced",
  maxResultsPerOp: 4,
};

describe("artifact guide and full-layer model card", () => {
  it("separates start-here, design, tiling, IREE, and validation artifacts", () => {
    const response = estimateAll(request);
    const artifacts = [
      "report.md",
      "purpose_gate.md",
      "hardware_design_plan.md",
      "tiling_strategy.md",
      "compiler_hints.md",
      "external_validation_report.md",
      "full_layer_model_card.md",
      "best_tile_policy.csv",
    ];
    const parsed = JSON.parse(artifactGuideJson({ artifacts, res: response }));
    expect(parsed.schema).toBe("tileforge.artifact-guide.v1");
    expect(parsed.byPurpose["hardware-design"]).toContain("hardware_design_plan.md");
    expect(parsed.byPurpose["tiling-strategy"]).toContain("tiling_strategy.md");
    expect(parsed.byPurpose["iree-options"]).toContain("compiler_hints.md");
    expect(parsed.byPurpose["external-validation"]).toContain("external_validation_report.md");

    const md = artifactGuideMarkdown({ artifacts, res: response });
    expect(md).toContain("tilePolicyCycles");
    expect(md).toContain("fullLayerCycles");
  });

  it("documents full-layer calibration constants and interpretation boundaries", () => {
    const response = estimateAll(request);
    const parsed = JSON.parse(fullLayerModelCardJson(response));
    expect(parsed.spillCalibration.wsFilterSpillScale).toBe(SPILL_CALIBRATION.wsFilterSpillScale);
    expect(parsed.nonGoals).toContain("cycle-accurate TPU simulation");
    expect(parsed.runSummary.totalCycles).toBe(response.summary.totalCycles);

    const md = fullLayerModelCardMarkdown(response);
    expect(md).toContain("Full-layer Model Card");
    expect(md).toContain("Spill calibration constants");
    expect(md).toContain("SCALE-Sim 검증을 우선");
  });
});
