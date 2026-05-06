import { describe, expect, it } from "vitest";
import { pruneTileCandidates } from "../src/lib/pruning";
import { buildRobustPolicy } from "../src/lib/clustering";
import { compareDataflows } from "../src/lib/dataflow";
import { estimateAll } from "../src/lib/estimator";
import { defaultHardware, defaultCandidates, defaultShapes } from "../src/lib/defaults";

describe("v0.6 workbench features", () => {
  it("prunes invalid or low-quality candidates", () => {
    const report = pruneTileCandidates(defaultHardware, defaultShapes[0], { tileM: [8, 64], tileN: [8, 64], tileK: [7, 64] });
    expect(report.totalCandidates).toBe(8);
    expect(report.prunedCandidates).toBeGreaterThan(0);
  });
  it("builds robust policy and dataflow comparison", () => {
    const res = estimateAll({ hardware: defaultHardware, shapes: defaultShapes, candidates: defaultCandidates, objective: "balanced" });
    const robust = buildRobustPolicy(res);
    expect(robust.clusters.length).toBeGreaterThan(0);
    const dfs = compareDataflows(defaultHardware, defaultShapes, defaultCandidates, "balanced");
    expect(dfs.map(d => d.dataflow).sort()).toEqual(["IS","OS","WS"]);
  });
});
