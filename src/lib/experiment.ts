import type { ExperimentComparison, HardwareConfig, SearchRequest } from "@/types/domain";
import { estimateAll } from "./estimator";
export function compareExperiments(base: SearchRequest, hardwares: HardwareConfig[]): ExperimentComparison[] {
  return hardwares.map(hw => {
    const res = estimateAll({ ...base, hardware: hw }, { includeArtifacts: false });
    return { name: hw.name, hardware: hw, totalCycles: res.summary.totalCycles, meanUtilization: res.summary.meanUtilization, maxSramBytes: res.summary.maxSramBytes, totalEnergyUJ: res.energy?.totalEnergyUJ, bottleneckOp: res.summary.bottleneckOp };
  }).sort((a,b)=>a.totalCycles-b.totalCycles);
}
export function comparisonCsv(rows: ExperimentComparison[]): string {
  return ["이름,배열,데이터플로우,전체_사이클,평균_PE_사용률,최대_SRAM_bytes,전체_에너지_uJ,병목_연산", ...rows.map(r=>`${r.name},${r.hardware.arrayRows}x${r.hardware.arrayCols},${r.hardware.dataflow},${r.totalCycles},${r.meanUtilization},${r.maxSramBytes},${r.totalEnergyUJ ?? ""},${r.bottleneckOp}`)].join("\n");
}
