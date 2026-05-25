import type { HardwareConfig, MatmulShape, TileCandidateResult } from "@/types/domain";
export interface MemoryTrafficBreakdown { opName: string; aBytes: number; bBytes: number; cReadBytes: number; cWriteBytes: number; dramReadBytes: number; dramWriteBytes: number; sramReadBytes: number; sramWriteBytes: number; reuseNote: string; }
export function memoryTrafficFor(hw: HardwareConfig, shape: MatmulShape, tile: TileCandidateResult): MemoryTrafficBreakdown {
  const bytes = shape.dtypeBytes || hw.bytesPerElement || 2;
  const mt = Math.ceil(shape.m / tile.tileM), nt = Math.ceil(shape.n / tile.tileN), kt = Math.ceil(shape.k / tile.tileK);
  const aBytes = mt * kt * tile.tileM * tile.tileK * bytes;
  const bBytes = kt * nt * tile.tileK * tile.tileN * bytes;
  const cReadBytes = mt * nt * tile.tileM * tile.tileN * bytes;
  const cWriteBytes = cReadBytes;
  const dataflowMultiplier = hw.dataflow === "WS" ? 0.85 : hw.dataflow === "OS" ? 0.95 : 1.10;
  return { opName: shape.opName, aBytes, bBytes, cReadBytes, cWriteBytes, dramReadBytes: Math.round((aBytes+bBytes+cReadBytes)*dataflowMultiplier), dramWriteBytes: cWriteBytes, sramReadBytes: Math.round((aBytes+bBytes+cReadBytes+cWriteBytes)*Math.max(1, kt)*dataflowMultiplier), sramWriteBytes: Math.round((aBytes+bBytes+cWriteBytes)*0.5), reuseNote: hw.dataflow === "WS" ? "weight가 M tile 전반에서 재사용되는 것으로 모델링했습니다" : hw.dataflow === "OS" ? "partial sum이 더 local하게 유지되는 것으로 모델링했습니다" : "M/K tile 반복에서 input이 재사용되는 것으로 모델링했습니다" };
}
export function memoryTrafficCsv(rows: MemoryTrafficBreakdown[]): string {
  return ["연산,A_bytes,B_bytes,C_읽기_bytes,C_쓰기_bytes,DRAM_읽기_bytes,DRAM_쓰기_bytes,SRAM_읽기_bytes,SRAM_쓰기_bytes,재사용_설명", ...rows.map(r=>[r.opName,r.aBytes,r.bBytes,r.cReadBytes,r.cWriteBytes,r.dramReadBytes,r.dramWriteBytes,r.sramReadBytes,r.sramWriteBytes,`\"${r.reuseNote}\"`].join(","))].join("\n");
}
