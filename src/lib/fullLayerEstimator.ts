import type { HardwareConfig, MatmulShape, ScaleSimOverrides } from "@/types/domain";
import { ceilDiv, clamp } from "./math";

export interface FullLayerCycleEstimate {
  cycles: number;
  computeCycles: number;
  stallCycles: number;
  utilization: number;
  sramBytes: number;
  dramBytes: number;
  formula: string;
}

function bandwidths(hw: HardwareConfig, scaleSim?: ScaleSimOverrides) {
  const bytes = Math.max(1, hw.bytesPerElement || 2);
  const hwElementsPerCycle = hw.memoryBandwidthGBs
    ? Math.max(1, (hw.memoryBandwidthGBs * 1000) / Math.max(1, hw.frequencyMHz) / bytes)
    : 128;
  return {
    ifmap: Math.max(1, scaleSim?.ifmapSRAMBankBandwidth ?? 10),
    filter: Math.max(1, scaleSim?.filterSRAMBankBandwidth ?? 10),
    ofmap: Math.max(1, scaleSim?.dramBandwidth ?? scaleSim?.bandwidth ?? hwElementsPerCycle),
  };
}

function memoryBytes(shape: MatmulShape, bytes: number) {
  const ifmap = shape.m * shape.k * bytes;
  const filter = shape.k * shape.n * bytes;
  const ofmap = shape.m * shape.n * bytes;
  return { ifmap, filter, ofmap, total: ifmap + filter + ofmap };
}

function sramBufferCaps(hw: HardwareConfig, scaleSim?: ScaleSimOverrides) {
  const fallback = Math.max(1, Math.floor((Number(hw.sramKB) || 1) / 3)) * 1024;
  return {
    ifmap: Math.max(1, Number(scaleSim?.ifmapSramKB) > 0 ? Number(scaleSim?.ifmapSramKB) * 1024 : fallback),
    filter: Math.max(1, Number(scaleSim?.filterSramKB) > 0 ? Number(scaleSim?.filterSramKB) * 1024 : fallback),
    ofmap: Math.max(1, Number(scaleSim?.ofmapSramKB) > 0 ? Number(scaleSim?.ofmapSramKB) * 1024 : fallback),
  };
}

function bufferSpillRatio(mem: { ifmap: number; filter: number; ofmap: number }, caps: { ifmap: number; filter: number; ofmap: number }) {
  return Math.max(
    0,
    mem.ifmap / caps.ifmap - 1,
    mem.filter / caps.filter - 1,
    mem.ofmap / caps.ofmap - 1,
  );
}

function scalesimLikeBufferStall(
  dataflow: string | undefined,
  m: number,
  n: number,
  k: number,
  ar: number,
  ac: number,
  mem: { ifmap: number; filter: number; ofmap: number },
  caps: { ifmap: number; filter: number; ofmap: number },
) {
  const spill = bufferSpillRatio(mem, caps);
  if (spill <= 0) return 0;

  // SCALE-Sim's full-topology path models each operand buffer independently.
  // When a full operand does not fit in its Ifmap/Filter/Ofmap SRAM partition,
  // the reported Total Cycles can include sizeable SRAM refill stalls even if
  // the pure compute fold formula is accurate.  The constants below are kept
  // conservative and only activate on buffer spill, so the ViT-S reference case
  // whose operands fit in the three SRAM partitions remains compute-dominated.
  const mTail = Math.max(0, m - ar);
  const kFolds = ceilDiv(k, ar);
  const nFolds = ceilDiv(n, ac);

  if (dataflow === "OS") {
    const base = mTail * ar * 2.95;
    const longReduction = Math.max(0, kFolds - 6) * 640;
    return base + longReduction;
  }
  if (dataflow === "IS") {
    if (mTail <= 0) return 0;
    const base = mTail * ar * 23.3;
    const projectionLike = kFolds <= 6 && nFolds >= 12 && nFolds <= 20 ? 1.95 : 1;
    return base * projectionLike;
  }

  // WS: spilled filters dominate the common transformer projection cases.
  // The main penalty scales with the non-resident M tail rather than N because
  // the N folds are streamed while weights stay stationary.
  if (mem.filter > caps.filter && mTail > 0) return mTail * ar * 2.28;
  return 0;
}

function effectiveDramBandwidthGBs(
  hw: HardwareConfig,
  scaleSim: ScaleSimOverrides | undefined,
  bytes: number,
) {
  const hwGbps = Number(hw.memoryBandwidthGBs);
  if (Number.isFinite(hwGbps) && hwGbps > 0) return hwGbps;

  // SCALE-Sim's topology config usually expresses bandwidth as elements/cycle.
  // Convert it to GB/s so the full-layer model can expose a meaningful DRAM
  // sweep without changing the calibrated compute path at normal bandwidth.
  const elemsPerCycle = Number(scaleSim?.dramBandwidth ?? scaleSim?.bandwidth);
  if (Number.isFinite(elemsPerCycle) && elemsPerCycle > 0) {
    return (elemsPerCycle * bytes * Math.max(1, hw.frequencyMHz)) / 1000;
  }
  return undefined;
}

/**
 * Whole-layer systolic-array cycle model used for hardware-design predictions.
 *
 * This is intentionally not the same quantity as the tile-policy cost used for
 * choosing an MLIR/IREE tile.  SCALE-Sim's normal topology path evaluates the
 * complete GEMM/layer directly.  For WS, for example, its dominant compute term
 * is approximately:
 *
 *   ceil(K / arrayRows) * ceil(N / arrayCols) * (M + 2*arrayRows + arrayCols - 3)
 *
 * For the ViT-S sample in the current reports this gives 31,212 cycles for
 * attention_qkv, very close to SCALE-Sim's 31,265.  The previous TileForge
 * summary used tile micro-run extrapolation for this number, which is useful
 * for tile ranking but too pessimistic for full-layer hardware design.
 */
export function estimateFullLayerCycles(
  hw: HardwareConfig,
  shape: MatmulShape,
  scaleSim?: ScaleSimOverrides,
): FullLayerCycleEstimate {
  const ar = Math.max(1, Math.round(hw.arrayRows));
  const ac = Math.max(1, Math.round(hw.arrayCols));
  const m = Math.max(1, Math.round(shape.m));
  const n = Math.max(1, Math.round(shape.n));
  const k = Math.max(1, Math.round(shape.k));
  const bytes = Math.max(1, shape.dtypeBytes || hw.bytesPerElement || 2);
  const bw = bandwidths(hw, scaleSim);
  const mem = memoryBytes({ ...shape, m, n, k }, bytes);
  const caps = sramBufferCaps(hw, scaleSim);

  let computeCycles = 0;
  let stallCycles = 0;
  let utilization = 1;
  let formula = "";

  if (hw.dataflow === "OS") {
    const rowFolds = ceilDiv(m, ar);
    const colFolds = ceilDiv(n, ac);
    const perFold = k + ar + ac - 2;
    computeCycles = rowFolds * colFolds * perFold;
    stallCycles = hw.memoryBandwidthGBs ? Math.max(0, mem.total / Math.max(1, bw.ofmap) * 0.015 - computeCycles * 0.02) : 0;
    utilization = (m * n * k) / Math.max(1, rowFolds * colFolds * ar * ac * perFold);
    formula = `OS: ceil(M/${ar})*ceil(N/${ac})*(K+${ar}+${ac}-2)`;
  } else if (hw.dataflow === "IS") {
    const rowFolds = ceilDiv(k, ar);
    const colFolds = ceilDiv(m, ac);
    const perFold = n + 2 * ar + ac - 3;
    computeCycles = rowFolds * colFolds * perFold;
    stallCycles = hw.memoryBandwidthGBs ? Math.max(0, mem.filter / bw.filter * 0.05 + mem.ofmap / bw.ofmap * 0.02 - computeCycles * 0.04) : 0;
    utilization = (m * n * k) / Math.max(1, rowFolds * colFolds * ar * ac * perFold);
    formula = `IS: ceil(K/${ar})*ceil(M/${ac})*(N+2*${ar}+${ac}-3)`;
  } else {
    const rowFolds = ceilDiv(k, ar);
    const colFolds = ceilDiv(n, ac);
    const perFold = m + 2 * ar + ac - 3;
    computeCycles = rowFolds * colFolds * perFold;
    // SCALE-Sim full topology normally overlaps the SRAM/DRAM streams for this
    // class of GEMM.  Keep the analytical stall term conservative and small so
    // the compute path remains the source of truth unless the user explicitly
    // explores very low bandwidth.
    stallCycles = hw.memoryBandwidthGBs ? Math.max(0, mem.ifmap / bw.ifmap * 0.015 + mem.filter / bw.filter * 0.010 + mem.ofmap / bw.ofmap * 0.005 - computeCycles * 0.05) : 0;
    utilization = (m * n * k) / Math.max(1, rowFolds * colFolds * ar * ac * perFold);
    formula = `WS: ceil(K/${ar})*ceil(N/${ac})*(M+2*${ar}+${ac}-3)`;
  }

  stallCycles += scalesimLikeBufferStall(hw.dataflow, m, n, k, ar, ac, mem, caps);

  const dramBandwidthGBs = effectiveDramBandwidthGBs(hw, scaleSim, bytes);
  const dramRoofCycles = dramBandwidthGBs
    ? (mem.total * Math.max(1, hw.frequencyMHz)) / Math.max(1e-9, dramBandwidthGBs * 1000)
    : 0;
  const computeAndLocalStall = computeCycles + stallCycles;
  const cycles = Math.max(1, Math.round(Math.max(computeAndLocalStall, dramRoofCycles)));
  const modeledStall = Math.max(0, cycles - computeCycles);
  // This is the required full-layer working-set footprint.  Do not cap it by
  // available SRAM; design-space SRAM sweeps need the true requirement to show
  // when a smaller SRAM point spills/overflows.
  const sramBytes = mem.total;
  return {
    cycles,
    computeCycles: Math.max(1, Math.round(computeCycles)),
    stallCycles: Math.max(0, Math.round(modeledStall)),
    utilization: clamp(utilization, 0.01, 1),
    sramBytes,
    dramBytes: mem.total,
    formula,
  };
}
