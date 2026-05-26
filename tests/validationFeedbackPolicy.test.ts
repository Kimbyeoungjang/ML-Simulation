import { describe, expect, it } from "vitest";
import { estimateAll } from "../src/lib/estimator";
import { defaultCandidates, defaultHardware } from "../src/lib/defaults";
import { buildValidationEvidenceBundle, estimatorSuiteFeedbackCsvForScope } from "../src/server/validationEvidence";
import { buildValidationFeedbackPolicyReport, validationFeedbackPolicyMarkdown } from "../src/server/validationFeedbackPolicy";
import type { SearchRequest } from "../src/types/domain";
import type { ExternalRunSummary } from "../src/server/externalRunTypes";

const request: SearchRequest = {
  hardware: { ...defaultHardware, arrayRows: 64, arrayCols: 64, sramKB: 512, dataflow: "WS" },
  shapes: [{ id: "gemm0", model: "demo", opName: "matmul0", m: 128, n: 256, k: 64, dtypeBytes: 2 }],
  candidates: defaultCandidates,
  objective: "balanced",
  maxResultsPerOp: 4,
};

describe("validation feedback policy", () => {
  it("routes full-layer targets and tile-policy diagnostics to separate CSVs", () => {
    const response = estimateAll(request);
    const best = response.results[0].best;
    const scale: ExternalRunSummary = {
      ok: true,
      skipped: false,
      tool: "scalesim",
      triedCommands: ["mock"],
      layers: [{ name: "matmul0", cycles: Math.round(best.cycles * 1.05) }],
      candidateLayers: [{ name: "matmul0_rank1", shapeId: "gemm0", rank: 1, cycles: Math.round((best.tilePolicyCycles ?? best.cycles) * 1.02), predictedCycles: best.tilePolicyCycles ?? best.cycles }],
    };
    const bundle = buildValidationEvidenceBundle(response, scale, { jobId: "job-policy" });
    const report = buildValidationFeedbackPolicyReport(bundle);
    expect(report.counts.fullLayerDesignTargets).toBe(1);
    expect(report.counts.tilePolicyDiagnostics).toBe(1);
    expect(report.recommendedFiles.hardwareDesignTraining).toBe("estimator_suite_feedback_full_layer.csv");
    expect(validationFeedbackPolicyMarkdown(report)).toContain("estimator_suite_feedback_full_layer.csv");

    const full = estimatorSuiteFeedbackCsvForScope(bundle, "full-layer");
    const tile = estimatorSuiteFeedbackCsvForScope(bundle, "tile-policy");
    expect(full).toContain("full-layer");
    expect(full).not.toContain("tile-policy");
    expect(tile).toContain("tile-policy");
    expect(tile).not.toContain("full-layer");
  });
});
