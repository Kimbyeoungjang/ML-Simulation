import { describe, expect, it } from "vitest";
import { learnedEstimatorFeatures, type LearnedEstimatorSample } from "@/lib/learnedEstimator";
import { buildEstimatorDataset } from "@/lib/estimatorSuiteDataset";

const base: LearnedEstimatorSample = {
  id: "s",
  model: "vit",
  opName: "op",
  arrayRows: 128,
  arrayCols: 128,
  sramKB: 8192,
  frequencyMHz: 700,
  dataflow: "WS",
  dtypeBytes: 2,
  m: 197,
  n: 2304,
  k: 384,
  tileM: 64,
  tileN: 128,
  tileK: 64,
  estimatorCycles: 50000,
  measuredCycles: 33000,
};

describe("estimator target scope", () => {
  it("canonicalizes tile geometry for full-layer SCALE-Sim targets", () => {
    const fullA = learnedEstimatorFeatures({ ...base, tileM: 64, tileN: 128, tileK: 64, targetScope: "full-layer" });
    const fullB = learnedEstimatorFeatures({ ...base, tileM: 128, tileN: 256, tileK: 128, targetScope: "full-layer" });
    const tile = learnedEstimatorFeatures({ ...base, tileM: 128, tileN: 256, tileK: 128, targetScope: "tile-policy" });
    expect(fullA).toEqual(fullB);
    expect(tile).not.toEqual(fullA);
    expect(fullA.at(-2)).toBe(1);
    expect(tile.at(-1)).toBe(1);
  });

  it("summarizes mixed full-layer and tile-policy datasets", () => {
    const csv = [
      "id,model,opName,arrayRows,arrayCols,sramKB,frequencyMHz,dataflow,dtypeBytes,m,n,k,tileM,tileN,tileK,estimatorCycles,measuredCycles,targetScope",
      "a,vit,op,128,128,8192,700,WS,2,197,2304,384,128,256,128,50000,31265,full-layer",
      "b,vit,op,128,128,8192,700,WS,2,197,2304,384,128,256,128,50000,55026,tile-policy",
    ].join("\n");
    const dataset = buildEstimatorDataset([{ name: "mixed.csv", text: csv }]);
    expect(dataset.summary.targetScopes["full-layer"]).toBe(1);
    expect(dataset.summary.targetScopes["tile-policy"]).toBe(1);
    expect(dataset.summary.warnings.join("\n")).toContain("full-layer와 tile-policy");
  });
});
