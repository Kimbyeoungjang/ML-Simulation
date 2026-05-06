import { describe, expect, it } from "vitest";
import fc from "fast-check";
import { estimateTile } from "@/lib/estimator";
import { conv2dToGemm } from "@/lib/conv";
import { pruneTileCandidates } from "@/lib/pruning";

const hw = { name: "prop", arrayRows: 64, arrayCols: 64, frequencyMHz: 700, sramKB: 1024, dataflow: "WS" as const, bytesPerElement: 2 };

describe("property-based estimator invariants", () => {
  it("produces finite positive metrics for positive matmul/tile dimensions", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 2048 }), fc.integer({ min: 1, max: 2048 }), fc.integer({ min: 1, max: 2048 }),
      fc.integer({ min: 1, max: 256 }), fc.integer({ min: 1, max: 256 }), fc.integer({ min: 1, max: 256 }),
      (m,n,k,tm,tn,tk) => {
        const r = estimateTile(hw, { id: "p", model: "p", opName: "matmul", m,n,k,dtypeBytes:2 }, tm,tn,tk,"balanced");
        expect(Number.isFinite(r.cycles)).toBe(true);
        expect(r.cycles).toBeGreaterThan(0);
        expect(r.utilization).toBeGreaterThanOrEqual(0);
        expect(r.utilization).toBeLessThanOrEqual(1);
        expect(r.paddingRatio).toBeGreaterThanOrEqual(0);
      }
    ), { numRuns: 100 });
  });

  it("pruning never increases candidate count", () => {
    fc.assert(fc.property(
      fc.array(fc.integer({ min: 1, max: 512 }), { minLength: 1, maxLength: 16 }),
      fc.array(fc.integer({ min: 1, max: 512 }), { minLength: 1, maxLength: 16 }),
      fc.array(fc.integer({ min: 1, max: 512 }), { minLength: 1, maxLength: 16 }),
      (tileM,tileN,tileK) => {
        const before = new Set(tileM).size * new Set(tileN).size * new Set(tileK).size;
        const shape = { id: "s", model: "p", opName: "m", m: 128, n: 128, k: 128, dtypeBytes: 2 };
        const pruned = pruneTileCandidates(hw, shape, { tileM, tileN, tileK });
        const after = pruned.evaluatedCandidates;
        expect(after).toBeLessThanOrEqual(before);
      }
    ), { numRuns: 50 });
  });

  it("conv2d to gemm produces positive M/N/K for valid conv shapes", () => {
    fc.assert(fc.property(
      fc.integer({ min: 1, max: 8 }), fc.integer({ min: 8, max: 256 }), fc.integer({ min: 8, max: 256 }), fc.integer({ min: 1, max: 256 }), fc.integer({ min: 1, max: 256 }),
      (batch,h,w,c,outC) => {
        const gemm = conv2dToGemm({ id:"c", model:"p", opName:"conv", batch, inputH:h, inputW:w, inputC:c, outputC:outC, kernelH:3, kernelW:3, strideH:1, strideW:1, padH:1, padW:1, dilationH:1, dilationW:1, dtypeBytes:2 });
        expect(gemm.m).toBeGreaterThan(0);
        expect(gemm.n).toBeGreaterThan(0);
        expect(gemm.k).toBeGreaterThan(0);
      }
    ), { numRuns: 50 });
  });
});
