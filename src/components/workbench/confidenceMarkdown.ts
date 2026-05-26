import type { ConfidenceAssessment } from "@/lib/confidence";

export function confidenceFromMarkdown(text: string): ConfidenceAssessment | null {
  const first = text.split(/\r?\n/).find((line) => line.includes("신뢰도:"));
  if (!first) return null;
  const pct = Number(first.match(/\((\d+(?:\.\d+)?)%\)/)?.[1]);
  const uncertainty = Number(text.match(/예상 불확실성:\s*±(\d+(?:\.\d+)?)%/)?.[1]);
  const level = first.includes("높음") ? "high" : first.includes("보통") ? "medium" : "low";
  const reasons = text
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("- "))
    .map((line) => line.replace(/^\s*-\s*/, ""));
  return {
    level,
    score: Number.isFinite(pct)
      ? Math.max(0, Math.min(1, pct / 100))
      : level === "high"
        ? 0.82
        : level === "medium"
          ? 0.6
          : 0.35,
    uncertaintyPct: Number.isFinite(uncertainty)
      ? uncertainty
      : level === "high"
        ? 12
        : level === "medium"
          ? 24
          : 40,
    reasons,
  };
}
