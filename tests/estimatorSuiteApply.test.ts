import { describe, expect, it } from "vitest";
import { estimateAll } from "@/lib/estimator";
import { trainEstimatorSuite } from "@/lib/estimatorSuite";
import { applyEstimatorSuiteToSearchResponse } from "@/lib/estimatorSuiteApply";
import { defaultCandidates, defaultHardware } from "@/lib/defaults";
import type { LearnedEstimatorSample } from "@/lib/learnedEstimator";
import type { MatmulShape } from "@/types/domain";

function sample(i: number): LearnedEstimatorSample {
  const m = 64 + (i % 8) * 64;
  const n = 64 + (Math.floor(i / 8) % 8) * 64;
  const k = 64 + (Math.floor(i / 64) % 4) * 64;
  const tileM = [16, 32, 64, 128][i % 4];
  const tileN = [16, 32, 64, 128][Math.floor(i / 4) % 4];
  const tileK = [16, 32, 64][Math.floor(i / 16) % 3];
  const estimatorCycles = Math.max(1000, Math.round((m * n * k) / Math.max(1, tileM * tileN) + tileK * 10));
  const measuredCycles = Math.round(estimatorCycles * (1.15 + (tileK > 32 ? 0.08 : 0) + (tileM !== tileN ? 0.04 : 0)));
  return { id: `s${i}`, model: "demo", opName: `op${i % 5}`, arrayRows: 128, arrayCols: 128, sramKB: 4096, frequencyMHz: 700, dataflow: "WS", dtypeBytes: 2, m, n, k, tileM, tileN, tileK, estimatorCycles, measuredCycles };
}

describe("estimator suite application", () => {
  it("adjusts response cycles and preserves analytical rawCycles", () => {
    const samples = Array.from({ length: 96 }, (_, i) => sample(i));
    const model = trainEstimatorSuite(samples, { trees: 24, maxDepth: 6, hiddenUnits: 12, epochs: 80, splitKinds: ["random"], seed: 7 });
    const shape: MatmulShape = { id: "m0", model: "demo", opName: "matmul", m: 256, n: 256, k: 256, dtypeBytes: 2 };
    const base = estimateAll({ hardware: defaultHardware, shapes: [shape], candidates: defaultCandidates, objective: "cycles", maxResultsPerOp: 6 });
    const adjusted = applyEstimatorSuiteToSearchResponse(base, model);
    expect(adjusted.estimatorSuite?.applied).toBe(true);
    expect(adjusted.results[0].best.rawCycles).toBeGreaterThan(0);
    expect(adjusted.summary.totalCycles).toBe(adjusted.results[0].best.cycles);
    expect(adjusted.estimatorSuite?.totalAnalyticalCycles).toBeGreaterThan(0);
    expect(adjusted.artifacts.reportMarkdown).toContain("Learned Estimator Suite: 적용됨");
    expect(adjusted.artifacts.reportMarkdown).not.toContain("Learned Estimator Suite: 미적용");
  });
});
