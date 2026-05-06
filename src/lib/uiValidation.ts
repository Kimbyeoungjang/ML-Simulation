import type { SearchRequest } from "@/types/domain";
import { parseSearchRequest, estimateCandidateCount } from "./validation";

export type UiValidationResult = { ok: true; candidateCount: number; warnings: string[] } | { ok: false; errors: string[] };

export function validateSearchRequestForUi(value: unknown): UiValidationResult {
  try {
    const parsed = parseSearchRequest(value);
    const candidateCount = estimateCandidateCount(parsed.shapes, parsed.candidates);
    const warnings: string[] = [];
    if (candidateCount > 100_000) warnings.push(`Large sweep: ${candidateCount.toLocaleString()} candidates. Consider pruning or background jobs.`);
    if (parsed.hardware.sramKB < 64) warnings.push("Very small local SRAM; many realistic tiles may be invalid.");
    return { ok: true, candidateCount, warnings };
  } catch (error: any) {
    return { ok: false, errors: [error?.message ?? String(error)] };
  }
}

export function summarizeRequestForUi(request: SearchRequest) {
  return {
    shapes: request.shapes.length,
    candidateCount: estimateCandidateCount(request.shapes, request.candidates),
    dataflow: request.hardware.dataflow,
    array: `${request.hardware.arrayRows}x${request.hardware.arrayCols}`
  };
}
