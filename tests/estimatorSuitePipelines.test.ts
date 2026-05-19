import { describe, expect, it } from "vitest";
import { buildEstimatorDataset } from "@/lib/estimatorSuiteDataset";
import { buildScopedEstimatorDatasets, buildScopedEstimatorPipeline, splitEstimatorCsvByScope } from "@/lib/estimatorSuitePipelines";

const header = "id,model,opName,arrayRows,arrayCols,sramKB,frequencyMHz,dataflow,dtypeBytes,m,n,k,tileM,tileN,tileK,estimatorCycles,measuredCycles,targetScope,measuredSource";

function row(i: number, scope: "full-layer" | "tile-policy") {
  const m = 128 + (i % 5) * 16;
  const n = scope === "full-layer" ? 512 + (i % 7) * 64 : 768 + (i % 7) * 64;
  const k = 256 + (i % 3) * 128;
  const tileM = scope === "full-layer" ? m : 64 + (i % 2) * 64;
  const tileN = scope === "full-layer" ? n : 128 + (i % 3) * 64;
  const tileK = scope === "full-layer" ? k : 128;
  const estimator = Math.round((2 * m * n * k) / (128 * 128) + 1000 + i * 3);
  const multiplier = scope === "full-layer" ? 0.67 + (i % 4) * 0.01 : 1.12 + (i % 5) * 0.015;
  const measured = Math.round(estimator * multiplier);
  return [
    `${scope}_${i}`,
    "vit",
    i % 2 ? "mlp_fc" : "attention_qkv",
    128,
    i % 3 ? 128 : 256,
    i % 2 ? 8192 : 16384,
    700,
    i % 2 ? "WS" : "OS",
    2,
    m,
    n,
    k,
    tileM,
    tileN,
    tileK,
    estimator,
    measured,
    scope,
    scope === "full-layer" ? "layers.cycles" : "candidate.tileExtrapolatedCycles",
  ].join(",");
}

function csv(full = 50, tile = 50) {
  return [
    header,
    ...Array.from({ length: full }, (_, i) => row(i, "full-layer")),
    ...Array.from({ length: tile }, (_, i) => row(i, "tile-policy")),
  ].join("\n");
}

describe("scoped estimator suite pipeline", () => {
  it("does not dedupe full-layer and tile-policy rows with the same hardware shape", () => {
    const shared = "same,vit,qkv,128,128,8192,700,WS,2,197,2304,384,128,256,128,50000";
    const text = [
      header,
      `${shared},31265,full-layer,layers.cycles`,
      `${shared},55026,tile-policy,candidate.tileExtrapolatedCycles`,
    ].join("\n");
    const dataset = buildEstimatorDataset([{ name: "mixed.csv", text }]);
    expect(dataset.summary.inputRows).toBe(2);
    expect(dataset.summary.mergedRows).toBe(2);
    expect(dataset.summary.targetScopes).toEqual({ "full-layer": 1, "tile-policy": 1 });
  });

  it("builds separate datasets for full-layer and tile-policy targets", () => {
    const scoped = buildScopedEstimatorDatasets([{ name: "mixed.csv", text: csv(3, 4) }]);
    expect(scoped.mergedSummary.validSamples).toBe(7);
    expect(scoped.scopes["full-layer"].summary.validSamples).toBe(3);
    expect(scoped.scopes["tile-policy"].summary.validSamples).toBe(4);
    expect(scoped.scopes["full-layer"].csv).toContain("layers.cycles");
    expect(scoped.scopes["tile-policy"].csv).toContain("candidate.tileExtrapolatedCycles");

    const split = splitEstimatorCsvByScope(scoped.mergedCsv);
    expect(split["full-layer"]).toContain("full-layer");
    expect(split["full-layer"]).not.toContain("tile-policy_0");
    expect(split["tile-policy"]).toContain("tile-policy");
  });

  it("trains and writes artifacts for each scope independently", () => {
    const pipeline = buildScopedEstimatorPipeline([{ name: "mixed.csv", text: csv(48, 48) }], {
      trees: 8,
      maxDepth: 4,
      minLeaf: 3,
      hiddenUnits: 6,
      epochs: 20,
      splitKinds: ["random"],
      maxFinalTrainSamples: 100,
      maxSplitTrainSamples: 100,
      seed: 12,
    });
    expect(pipeline.training["full-layer"].status).toBe("trained");
    expect(pipeline.training["tile-policy"].status).toBe("trained");
    expect(pipeline.training["full-layer"].model?.metadata.featureDomain?.primaryTargetScope).toBe("full-layer");
    expect(pipeline.training["tile-policy"].model?.metadata.featureDomain?.primaryTargetScope).toBe("tile-policy");
    expect(Object.keys(pipeline.files)).toContain("datasets/full-layer/samples.csv");
    expect(Object.keys(pipeline.files)).toContain("estimator-suite/tile-policy/model.json");
    expect(pipeline.combinedReportMarkdown).toContain("Scoped Estimator Suite Pipeline Report");
  });
});
