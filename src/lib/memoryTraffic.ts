import type { HardwareConfig, MatmulShape, TileCandidateResult } from "@/types/domain";
import { ceilDiv } from "./math";

export interface MemoryTrafficBreakdown {
  opName: string;
  aBytes: number;
  bBytes: number;
  cReadBytes: number;
  cWriteBytes: number;
  dramReadBytes: number;
  dramWriteBytes: number;
  sramReadBytes: number;
  sramWriteBytes: number;
  reuseNote: string;
}

/**
 * SCALE-Sim-style full-layer traffic approximation.
 *
 * Older TileForge reports used tile micro-run repetition to estimate SRAM/DRAM
 * access, which made the SRAM/DRAM graphs look wrong once the main cycle target
 * moved to full-layer hardware-design cycles.  This function now estimates the
 * same full-layer quantity as the SCALE-Sim topology path: access counts are
 * expressed in bytes and account for systolic folds/reuse instead of naively
 * multiplying a single tile by tile-count.
 */
export function memoryTrafficFor(
  hw: HardwareConfig,
  shape: MatmulShape,
  tile: TileCandidateResult,
): MemoryTrafficBreakdown {
  const bytes = Math.max(1, shape.dtypeBytes || hw.bytesPerElement || 2);
  const m = Math.max(1, Math.round(shape.m));
  const n = Math.max(1, Math.round(shape.n));
  const k = Math.max(1, Math.round(shape.k));
  const ar = Math.max(1, Math.round(hw.arrayRows));
  const ac = Math.max(1, Math.round(hw.arrayCols));

  const aElems = m * k;
  const bElems = k * n;
  const cElems = m * n;
  const rowFolds = ceilDiv(k, ar);
  const colFolds = ceilDiv(n, ac);
  const mFolds = ceilDiv(m, ac);

  let sramA = aElems;
  let sramB = bElems;
  let sramC = cElems;
  let dramA = aElems;
  let dramB = bElems;
  let dramC = cElems;
  let note = "full-layer systolic reuse 기준으로 access를 근사했습니다";

  if (hw.dataflow === "WS") {
    // Weight-stationary: weights are loaded once per K/N fold, while ifmap and
    // ofmap streams are replayed across N/K folds respectively. This matches
    // the full-topology SCALE-Sim access pattern for the ViT-S validation case.
    sramA = aElems * colFolds;
    sramB = bElems;
    sramC = cElems * rowFolds;
    dramA = aElems;
    dramB = bElems;
    dramC = cElems * rowFolds;
    note = "WS full-layer: ifmap은 N fold, ofmap은 K fold 기준으로 재사용/반복됩니다";
  } else if (hw.dataflow === "OS") {
    const mArrayFolds = ceilDiv(m, ar);
    sramA = aElems * colFolds;
    sramB = bElems * mArrayFolds;
    sramC = cElems;
    dramA = aElems;
    dramB = bElems;
    dramC = cElems;
    note = "OS full-layer: output stationary reuse를 기준으로 access를 근사했습니다";
  } else {
    sramA = aElems;
    sramB = bElems * mFolds;
    sramC = cElems * rowFolds;
    dramA = aElems;
    dramB = bElems;
    dramC = cElems * Math.max(1, rowFolds);
    note = "IS full-layer: input stationary reuse를 기준으로 access를 근사했습니다";
  }

  return {
    opName: shape.opName,
    aBytes: aElems * bytes,
    bBytes: bElems * bytes,
    cReadBytes: cElems * bytes,
    cWriteBytes: cElems * bytes,
    dramReadBytes: (dramA + dramB) * bytes,
    dramWriteBytes: dramC * bytes,
    sramReadBytes: (sramA + sramB) * bytes,
    sramWriteBytes: sramC * bytes,
    reuseNote: `${note}; 선택 tile=${tile.tileM}x${tile.tileN}x${tile.tileK}는 ranking에는 쓰이지만 이 access는 full-layer 기준입니다`,
  };
}

export function memoryTrafficCsv(rows: MemoryTrafficBreakdown[]): string {
  return [
    "연산,A_bytes,B_bytes,C_읽기_bytes,C_쓰기_bytes,DRAM_읽기_bytes,DRAM_쓰기_bytes,SRAM_읽기_bytes,SRAM_쓰기_bytes,재사용_설명",
    ...rows.map((r) =>
      [
        r.opName,
        r.aBytes,
        r.bBytes,
        r.cReadBytes,
        r.cWriteBytes,
        r.dramReadBytes,
        r.dramWriteBytes,
        r.sramReadBytes,
        r.sramWriteBytes,
        `"${r.reuseNote}"`,
      ].join(","),
    ),
  ].join("\n");
}
