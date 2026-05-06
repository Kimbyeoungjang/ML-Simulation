import type { SearchRequest } from "@/types/domain";
import { stableStringify } from "./hash";

export type RecomputeScope = "none" | "time-only" | "energy-only" | "validity-only" | "full-estimate";

export function classifyRecomputeScope(prev: SearchRequest, next: SearchRequest): RecomputeScope {
  if (stableStringify(prev) === stableStringify(next)) return "none";
  const stripFrequency = (r: SearchRequest) => ({ ...r, hardware: { ...r.hardware, frequencyMHz: 0 } });
  if (stableStringify(stripFrequency(prev)) === stableStringify(stripFrequency(next))) return "time-only";
  const stripEnergy = (r: SearchRequest) => ({ ...r, hardware: { ...r.hardware, energyPerMacPJ: 0, energyPerSramAccessPJ: 0, energyPerDramBytePJ: 0, staticPowerW: 0 } });
  if (stableStringify(stripEnergy(prev)) === stableStringify(stripEnergy(next))) return "energy-only";
  const stripSram = (r: SearchRequest) => ({ ...r, hardware: { ...r.hardware, sramKB: 0, doubleBuffering: false } });
  if (stableStringify(stripSram(prev)) === stableStringify(stripSram(next))) return "validity-only";
  return "full-estimate";
}
