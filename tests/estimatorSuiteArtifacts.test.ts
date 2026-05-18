import { describe, expect, it } from "vitest";
import { defaultCandidates, defaultHardware, defaultShapes } from "@/lib/defaults";
import { buildEstimatorSuiteArtifacts, designEstimatorSuiteCsv, parseEstimatorSamplesCsv } from "@/lib/estimatorSuiteArtifacts";
import { trainEstimatorSuite } from "@/lib/estimatorSuite";
import type { LearnedEstimatorSample } from "@/lib/learnedEstimator";

function sample(i: number): LearnedEstimatorSample {
  const m = [64, 128, 256, 384, 512][i % 5];
  const n = [64, 128, 256, 768][Math.floor(i / 2) % 4];
  const k = [64, 128, 384, 768][Math.floor(i / 3) % 4];
  const tileM = [32, 64, 128][i % 3];
  const tileN = [32, 64, 128][Math.floor(i / 2) % 3];
  const tileK = [32, 64, 128][Math.floor(i / 5) % 3];
  const arrayRows = [64, 128][Math.floor(i / 7) % 2];
  const arrayCols = [64, 128][Math.floor(i / 11) % 2];
  const estimatorCycles = Math.max(10, Math.round((m * n * k) / (arrayRows * arrayCols * 4)));
  const factor = 1.0 + (i % 3) * 0.08 + (tileK > 64 ? 0.04 : 0);
  return {
    id: `s${i}`,
    model: `m${i % 4}`,
    opName: `op${i % 9}`,
    arrayRows,
    arrayCols,
    sramKB: 4096,
    frequencyMHz: 700,
    dataflow: i % 2 ? "OS" : "WS",
    dtypeBytes: 2,
    m,
    n,
    k,
    tileM,
    tileN,
    tileK,
    estimatorCycles,
    measuredCycles: Math.round(estimatorCycles * factor),
  };
}

describe("estimator suite web artifacts", () => {
  it("generates a measuredCycles-ready design CSV from a SearchRequest", () => {
    const csv = designEstimatorSuiteCsv({
      hardware: defaultHardware,
      shapes: defaultShapes.slice(0, 2),
      candidates: defaultCandidates,
      objective: "balanced",
      maxResultsPerOp: 2,
    });
    expect(csv).toContain("measuredCycles");
    expect(csv.split(/\r?\n/).filter(Boolean)).toHaveLength(5);
  });

  it("parses estimator CSV aliases used by CLI and web UI", () => {
    const csv = "id,model,op_name,arrayRows,arrayCols,sramKB,frequencyMHz,dataflow,dtype_bytes,m,n,k,tile_m,tile_n,tile_k,predicted_cycles,measured_cycles\n" +
      "a,vit,qkv,128,128,4096,700,WS,2,384,768,768,128,128,64,1000,1200\n";
    const samples = parseEstimatorSamplesCsv(csv);
    expect(samples).toHaveLength(1);
    expect(samples[0].opName).toBe("qkv");
    expect(samples[0].estimatorCycles).toBe(1000);
    expect(samples[0].measuredCycles).toBe(1200);
  });

  it("builds downloadable suite artifacts", () => {
    const samples = Array.from({ length: 80 }, (_, i) => sample(i));
    const model = trainEstimatorSuite(samples, { trees: 10, maxDepth: 4, hiddenUnits: 8, epochs: 35, splitKinds: ["random"], maxFinalTrainSamples: 60 });
    const artifacts = buildEstimatorSuiteArtifacts(model, samples);
    expect(artifacts.modelJson).toContain("tileforge-estimator-suite-v1");
    expect(artifacts.reportMarkdown).toContain("TileForge Web Estimator Suite Report");
    expect(artifacts.validationCsv).toContain("ensembleMapePct");
    expect(artifacts.predictionsCsv).toContain("ensembleCycles");
  });
});
