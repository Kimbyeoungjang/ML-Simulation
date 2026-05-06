import { describe, expect, it } from "vitest";
import { estimateForShape } from "@/lib/estimator";
import type { HardwareConfig, MatmulShape, TileCandidates } from "@/types/domain";

function independentTinyCycles(hw: HardwareConfig, shape: MatmulShape, tileM: number, tileN: number, tileK: number) {
  const mTiles = Math.ceil(shape.m / tileM);
  const nTiles = Math.ceil(shape.n / tileN);
  const kTiles = Math.ceil(shape.k / tileK);
  const activeRows = Math.min(tileM, hw.arrayRows);
  const activeCols = Math.min(tileN, hw.arrayCols);
  const startup = hw.arrayRows + hw.arrayCols + tileK;
  const tileCompute = Math.ceil((tileM * tileN * tileK) / Math.max(1, activeRows * activeCols));
  return Math.ceil(mTiles * nTiles * kTiles * (tileCompute + startup));
}

describe("independent tiny oracle", () => {
  it("selects the same best tile as a separately implemented formula on tiny WS matmul", () => {
    const hw: HardwareConfig = { name: "tiny", arrayRows: 4, arrayCols: 4, frequencyMHz: 1000, sramKB: 64, dataflow: "WS", bytesPerElement: 2 };
    const shape: MatmulShape = { id: "s", model: "tiny", opName: "mm", m: 8, n: 8, k: 8, dtypeBytes: 2 };
    const cand: TileCandidates = { tileM: [2,4,8], tileN: [2,4,8], tileK: [2,4,8] };
    const result = estimateForShape(hw, shape, cand, "cycles", 8);
    let best = { tileM: 0, tileN: 0, tileK: 0, cycles: Infinity };
    for (const tileM of cand.tileM) for (const tileN of cand.tileN) for (const tileK of cand.tileK) {
      const cycles = independentTinyCycles(hw, shape, tileM, tileN, tileK);
      if (cycles < best.cycles) best = { tileM, tileN, tileK, cycles };
    }
    expect([result.best.tileM, result.best.tileN, result.best.tileK]).toEqual([best.tileM, best.tileN, best.tileK]);
  });
});
