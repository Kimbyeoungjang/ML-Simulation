import type { SearchResponse } from "@/types/domain";
import { assessConfidence } from "./confidence";

export interface UncertaintyBand { estimate: number; lower: number; upper: number; uncertaintyPct: number; }
export function totalCycleUncertainty(response: SearchResponse): UncertaintyBand {
  const confidence = assessConfidence(response, { externalValidated: Boolean(response.artifacts.validationCsv) });
  const estimate = response.summary.totalCycles;
  const f = confidence.uncertaintyPct / 100;
  return { estimate, lower: Math.max(0, estimate * (1 - f)), upper: estimate * (1 + f), uncertaintyPct: confidence.uncertaintyPct };
}
