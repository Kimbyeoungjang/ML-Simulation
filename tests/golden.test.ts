import { describe, expect, it } from "vitest";
import { estimateAll } from "@/lib/estimator";
import { defaultCandidates, defaultHardware, defaultShapes } from "@/lib/defaults";

describe("golden artifact contracts", () => {
  const response = estimateAll({ hardware: defaultHardware, shapes: defaultShapes, candidates: defaultCandidates, objective: "balanced" });
  it("keeps core best policy fields stable", () => {
    const header = response.artifacts.policyCsv.split("\n")[0];
    expect(header).toContain("모델(model)");
    expect(header).toContain("tileM");
    expect(response.results).toHaveLength(defaultShapes.length);
    expect(response.results[0].best.tileM).toBeGreaterThan(0);
  });
  it("generates mandatory research artifacts", () => {
    expect(response.artifacts.reportMarkdown).toContain("TileForge");
    expect(response.artifacts.mlir).toContain("linalg.matmul");
    expect(response.artifacts.transformDialect).toContain("transform");
    expect(response.artifacts.scaleSimTopology).toContain("Layer");
  });
});
