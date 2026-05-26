import { describe, expect, it } from "vitest";
import { estimateAll } from "../src/lib/estimator";
import { parseEstimatorCsv, sampleFromEstimatorRow } from "../src/lib/estimatorSuiteArtifacts";
import { defaultCandidates, defaultHardware } from "../src/lib/defaults";
import {
  buildValidationEvidenceBundle,
  estimatorSuiteFeedbackCsv,
  estimatorSuiteFeedbackCsvForScope,
  validationEvidenceMarkdown,
} from "../src/server/validationEvidence";
import type { SearchRequest } from "../src/types/domain";
import type { ExternalRunSummary } from "../src/server/externalRunTypes";

const request: SearchRequest = {
  hardware: { ...defaultHardware, arrayRows: 64, arrayCols: 64, sramKB: 512, dataflow: "WS" },
  shapes: [
    { id: "gemm0", model: "demo", opName: "matmul0", m: 128, n: 256, k: 64, dtypeBytes: 2 },
  ],
  candidates: defaultCandidates,
  objective: "balanced",
  maxResultsPerOp: 4,
};

describe("validation evidence feedback loop", () => {
  it("separates matched full-layer evidence from tile-policy diagnostics", () => {
    const response = estimateAll(request);
    const best = response.results[0].best;
    const scale: ExternalRunSummary = {
      ok: true,
      skipped: false,
      tool: "scalesim",
      triedCommands: ["mock"],
      totalCycles: Math.round(response.summary.totalCycles * 1.1),
      cycleRatio: 1.1,
      layers: [
        { name: "matmul0", cycles: Math.round(best.cycles * 1.1), overallUtil: 71.2, sramAccesses: 123, dramAccesses: 45 },
      ],
      candidateLayers: [
        {
          name: "matmul0_rank1",
          shapeId: "gemm0",
          opName: "matmul0",
          rank: 1,
          cycles: 10,
          tileExtrapolatedCycles: Math.round((best.tilePolicyCycles ?? best.cycles) * 1.03),
          predictedCycles: best.tilePolicyCycles ?? best.cycles,
          tileM: best.tileM,
          tileN: best.tileN,
          tileK: best.tileK,
        },
      ],
    };
    const bundle = buildValidationEvidenceBundle(response, scale, { jobId: "job-1", generatedAt: "2026-05-26T00:00:00.000Z" });
    expect(bundle.schema).toBe("tileforge.validation-evidence.v1");
    expect(bundle.summary.fullLayerMatched).toBe(1);
    expect(bundle.summary.tilePolicyDiagnostics).toBe(1);
    expect(bundle.rows.find((r) => r.targetScope === "full-layer")?.reliability).toBe("design-target");
    expect(bundle.rows.find((r) => r.targetScope === "tile-policy")?.reliability).toBe("ranking-diagnostic");

    const md = validationEvidenceMarkdown(bundle);
    expect(md).toContain("Validation Evidence Ledger");
    expect(md).toContain("섞지 마세요");
  });

  it("exports Estimator Suite feedback with explicit targetScope metadata", () => {
    const response = estimateAll(request);
    const best = response.results[0].best;
    const scale: ExternalRunSummary = {
      ok: true,
      skipped: false,
      tool: "scalesim",
      triedCommands: ["mock"],
      layers: [{ name: "matmul0", cycles: Math.round(best.cycles * 0.9) }],
    };
    const bundle = buildValidationEvidenceBundle(response, scale, { jobId: "job-2" });
    const csv = estimatorSuiteFeedbackCsv(bundle);
    const fullLayerCsv = estimatorSuiteFeedbackCsvForScope(bundle, "full-layer");
    const tilePolicyCsv = estimatorSuiteFeedbackCsvForScope(bundle, "tile-policy");
    expect(csv).toContain("targetScope");
    expect(csv).toContain("full-layer");
    expect(csv).toContain("scalesim-compute-report");
    expect(fullLayerCsv).toContain("design-target");
    expect(tilePolicyCsv).toBe("");

    const rows = parseEstimatorCsv(fullLayerCsv);
    const sample = sampleFromEstimatorRow(rows[0]);
    expect(sample?.targetScope).toBe("full-layer");
    expect(sample?.measuredSource).toBe("scalesim-compute-report");
    expect(sample?.tileM).toBe(request.shapes[0].m);
  });
});
