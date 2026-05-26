import type { ConfidenceAssessment } from "@/lib/confidence";
import type { ConfidenceSource } from "./resultsPanelTypes";

export function confidenceSourceForJobSelection({
  selectedJobConfidence,
  selectedJobConfidenceId,
  analysisJobId,
}: {
  selectedJobConfidence: ConfidenceAssessment | null | undefined;
  selectedJobConfidenceId: string;
  analysisJobId: string;
}): ConfidenceSource {
  return selectedJobConfidence && selectedJobConfidenceId === analysisJobId ? "selected-job" : "preview";
}

export function selectDisplayConfidence({
  previewConfidence,
  selectedJobConfidence,
  selectedJobConfidenceId,
  analysisJobId,
}: {
  previewConfidence: ConfidenceAssessment;
  selectedJobConfidence: ConfidenceAssessment | null | undefined;
  selectedJobConfidenceId: string;
  analysisJobId: string;
}): ConfidenceAssessment {
  return confidenceSourceForJobSelection({ selectedJobConfidence, selectedJobConfidenceId, analysisJobId }) === "selected-job"
    ? selectedJobConfidence as ConfidenceAssessment
    : previewConfidence;
}
