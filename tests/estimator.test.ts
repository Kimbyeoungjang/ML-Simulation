import { describe, expect, it } from "vitest";
import { estimateAll, sweepArrays } from "../src/lib/estimator";
import { conv2dToGemm } from "../src/lib/conv";
import { defaultCandidates, defaultHardware, defaultShapes } from "../src/lib/defaults";

describe("TileForge estimator", () => {
  it("selects a best tile for every op", () => {
    const res = estimateAll({ hardware: defaultHardware, shapes: defaultShapes, candidates: defaultCandidates, objective: "balanced" });
    expect(res.results).toHaveLength(defaultShapes.length);
    expect(res.results[0].best.cycles).toBeGreaterThan(0);
    expect(res.artifacts.policyCsv).toContain("tile_m");
    expect(res.artifacts.reportMarkdown).toContain("TileForge 분석 보고서");
  });
  it("converts Conv2D to GEMM", () => {
    const g = conv2dToGemm({ id:"c", model:"m", opName:"conv", batch:1, inputH:224, inputW:224, inputC:3, outputC:64, kernelH:7, kernelW:7, strideH:2, strideW:2, padH:3, padW:3, dilationH:1, dilationW:1, dtypeBytes:2 });
    expect(g.m).toBe(112 * 112);
    expect(g.n).toBe(64);
    expect(g.k).toBe(147);
  });
  it("sweeps arrays", () => {
    const rows = sweepArrays({ baseHardware: defaultHardware, shapes: defaultShapes, candidates: defaultCandidates, arrays:[{rows:64,cols:64},{rows:128,cols:128}], objective:"balanced" });
    expect(rows).toHaveLength(2);
    expect(rows[0].score).toBeLessThanOrEqual(rows[1].score + 1e12);
  });
});
