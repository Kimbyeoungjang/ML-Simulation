import { describe, expect, it } from "vitest";
import type { LearnedEstimatorSample } from "../src/lib/learnedEstimator";
import { applyEstimatorSuiteTrainingPolicy, estimatorSuiteTrainingPolicyMarkdown } from "../src/lib/estimatorSuiteTrainingPolicy";

function sample(id: string, targetScope: LearnedEstimatorSample["targetScope"]): LearnedEstimatorSample {
  return {
    id,
    model: "demo",
    opName: id,
    arrayRows: 64,
    arrayCols: 64,
    sramKB: 512,
    frequencyMHz: 700,
    dataflow: "WS",
    dtypeBytes: 2,
    m: 128,
    n: 128,
    k: 64,
    tileM: targetScope === "full-layer" ? 128 : 64,
    tileN: targetScope === "full-layer" ? 128 : 64,
    tileK: targetScope === "full-layer" ? 64 : 32,
    estimatorCycles: 1000,
    measuredCycles: 1100,
    targetScope,
  };
}

describe("Estimator Suite training policy", () => {
  it("auto mode prefers full-layer rows and excludes tile-policy diagnostics", () => {
    const samples = [sample("full0", "full-layer"), sample("tile0", "tile-policy"), sample("legacy0", "mixed")];
    const result = applyEstimatorSuiteTrainingPolicy(samples, { targetScope: "auto" });
    expect(result.effectiveScope).toBe("full-layer");
    expect(result.selectedSamples).toBe(1);
    expect(result.samples[0].targetScope).toBe("full-layer");
    expect(result.excludedSamples).toBe(2);
    expect(result.warnings.join("\n")).toContain("tile-policy diagnostic");
  });

  it("can explicitly select tile-policy rows for ranking experiments", () => {
    const result = applyEstimatorSuiteTrainingPolicy([sample("full0", "full-layer"), sample("tile0", "tile-policy")], { targetScope: "tile-policy" });
    expect(result.effectiveScope).toBe("tile-policy");
    expect(result.selectedSamples).toBe(1);
    expect(result.samples[0].targetScope).toBe("tile-policy");
  });

  it("keeps legacy mixed-only datasets for backwards compatibility", () => {
    const result = applyEstimatorSuiteTrainingPolicy([sample("legacy0", "mixed"), sample("legacy1", undefined)], { targetScope: "auto" });
    expect(result.effectiveScope).toBe("mixed");
    expect(result.selectedSamples).toBe(2);
    expect(estimatorSuiteTrainingPolicyMarkdown(result)).toContain("legacy mixed dataset");
  });
});
