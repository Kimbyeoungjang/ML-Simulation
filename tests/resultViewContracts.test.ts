import { describe, expect, it } from "vitest";
import { confidenceSourceForJobSelection, selectDisplayConfidence } from "@/components/workbench/resultViewContracts";
import type { ConfidenceAssessment } from "@/lib/confidence";

const preview: ConfidenceAssessment = { level: "medium", score: 0.6, reasons: ["preview"], uncertaintyPct: 20 };
const selected: ConfidenceAssessment = { level: "high", score: 0.9, reasons: ["job"], uncertaintyPct: 8 };

describe("result view confidence contract", () => {
  it("uses selected job confidence only when it belongs to the currently selected job", () => {
    expect(confidenceSourceForJobSelection({
      selectedJobConfidence: selected,
      selectedJobConfidenceId: "job-a",
      analysisJobId: "job-a",
    })).toBe("selected-job");

    expect(selectDisplayConfidence({
      previewConfidence: preview,
      selectedJobConfidence: selected,
      selectedJobConfidenceId: "job-a",
      analysisJobId: "job-a",
    })).toBe(selected);
  });

  it("falls back to preview confidence when no matching job artifact is selected", () => {
    expect(confidenceSourceForJobSelection({
      selectedJobConfidence: selected,
      selectedJobConfidenceId: "job-a",
      analysisJobId: "job-b",
    })).toBe("preview");

    expect(selectDisplayConfidence({
      previewConfidence: preview,
      selectedJobConfidence: selected,
      selectedJobConfidenceId: "job-a",
      analysisJobId: "job-b",
    })).toBe(preview);
  });
});
