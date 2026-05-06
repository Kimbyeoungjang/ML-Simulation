import type { SearchRequest } from "@/types/domain";
import { estimateAll } from "./estimator";

export interface MetamorphicCheck { name: string; passed: boolean; detail: string; }

export function runMetamorphicChecks(req: SearchRequest): MetamorphicCheck[] {
  const base = estimateAll(req);
  const doubledFrequency = estimateAll({ ...req, hardware: { ...req.hardware, frequencyMHz: req.hardware.frequencyMHz * 2 } });
  const timeRatio = doubledFrequency.summary.totalTimeUs / Math.max(1e-9, base.summary.totalTimeUs);
  const moreSram = estimateAll({ ...req, hardware: { ...req.hardware, sramKB: req.hardware.sramKB * 2 } });
  return [
    { name: "frequency_doubles_time_halves", passed: timeRatio > 0.45 && timeRatio < 0.55, detail: `time ratio ${timeRatio.toFixed(3)}` },
    { name: "increasing_sram_does_not_increase_max_sram", passed: moreSram.summary.maxSramBytes === base.summary.maxSramBytes, detail: `base ${base.summary.maxSramBytes}, more ${moreSram.summary.maxSramBytes}` },
    { name: "total_cycles_positive", passed: base.summary.totalCycles > 0, detail: `${base.summary.totalCycles}` }
  ];
}
