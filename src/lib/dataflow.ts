import type { Dataflow, HardwareConfig, MatmulShape, Objective, TileCandidates } from "@/types/domain";
import { estimateAll } from "./estimator";
export interface DataflowComparisonRow { dataflow: Dataflow; bestTileSummary: string; totalCycles: number; meanUtilization: number; maxSramBytes: number; totalEnergyUJ?: number; comment: string; }
export function compareDataflows(hw: HardwareConfig, shapes: MatmulShape[], candidates: TileCandidates, objective: Objective): DataflowComparisonRow[] {
  return (["WS","OS","IS"] as Dataflow[]).map(dataflow => {
    const res = estimateAll({ hardware: { ...hw, dataflow }, shapes, candidates, objective, maxResultsPerOp: 8 }, { includeArtifacts: false });
    const common = new Map<string, number>();
    for (const r of res.results) { const key = `${r.best.tileM}x${r.best.tileN}x${r.best.tileK}`; common.set(key, (common.get(key) ?? 0) + 1); }
    const bestTileSummary = [...common.entries()].sort((a,b)=>b[1]-a[1])[0]?.[0] ?? "혼합";
    const comment = dataflow === "WS" ? "weight reuse와 GEMM 중심 FFN layer에 유리한 경우가 많습니다" : dataflow === "OS" ? "누산이 많은 shape에서 output locality를 개선할 수 있습니다" : "input activation reuse가 지배적인 경우 유용하지만 traffic이 커질 수 있습니다";
    return { dataflow, bestTileSummary, totalCycles: res.summary.totalCycles, meanUtilization: res.summary.meanUtilization, maxSramBytes: res.summary.maxSramBytes, totalEnergyUJ: res.energy?.totalEnergyUJ, comment };
  }).sort((a,b)=>a.totalCycles-b.totalCycles);
}
export function dataflowComparisonCsv(rows: DataflowComparisonRow[]): string {
  return ["데이터플로우,대표_타일,전체_사이클,평균_PE_사용률,최대_SRAM_bytes,전체_에너지_uJ,설명", ...rows.map(r=>[r.dataflow,r.bestTileSummary,r.totalCycles,r.meanUtilization.toFixed(4),r.maxSramBytes,r.totalEnergyUJ?.toFixed(4),`\"${r.comment}\"`].join(","))].join("\n");
}
