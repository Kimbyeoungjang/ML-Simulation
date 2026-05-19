import { describe, expect, it } from "vitest";
import { estimateFullLayerCycles } from "@/lib/fullLayerEstimator";
import type { HardwareConfig, MatmulShape } from "@/types/domain";

const hw: HardwareConfig = {
  name: "TPUv2-like 128x128",
  arrayRows: 128,
  arrayCols: 128,
  frequencyMHz: 700,
  sramKB: 8192,
  dataflow: "WS",
  bytesPerElement: 2,
};
const scale = { bandwidth: 128, ifmapSRAMBankBandwidth: 10, filterSRAMBankBandwidth: 10 };

describe("full-layer estimator", () => {
  it("matches SCALE-Sim whole-topology compute path for the ViT-S sample", () => {
    const shape: MatmulShape = { id: "qkv", model: "vit-s", opName: "attention_qkv", m: 197, n: 2304, k: 384, dtypeBytes: 2 };
    const estimate = estimateFullLayerCycles(hw, shape, scale);
    // SCALE-Sim full topology in the attached run: 31,265 cycles.
    expect(Math.abs(estimate.cycles - 31265) / 31265).toBeLessThan(0.01);
    expect(estimate.formula).toContain("WS");
  });

  it("is intentionally lower than naive tile micro-run extrapolation for padded ViT shapes", () => {
    const shape: MatmulShape = { id: "fc1", model: "vit-s", opName: "mlp_fc1", m: 197, n: 1536, k: 384, dtypeBytes: 2 };
    const estimate = estimateFullLayerCycles(hw, shape, scale);
    expect(estimate.cycles).toBeLessThan(36648);
    expect(Math.abs(estimate.cycles - 20843) / 20843).toBeLessThan(0.01);
  });

  it("accounts for full-layer SRAM partition stalls in transformer projection shapes", () => {
    const bert: MatmulShape = { id: "bert_qkv", model: "bert", opName: "qkv_projection", m: 384, n: 2304, k: 768, dtypeBytes: 2 };
    const ws = estimateFullLayerCycles({ ...hw, dataflow: "WS", memoryBandwidthGBs: 600 }, bert, scale);
    const os = estimateFullLayerCycles({ ...hw, dataflow: "OS", memoryBandwidthGBs: 600 }, bert, scale);
    const is = estimateFullLayerCycles({ ...hw, dataflow: "IS", memoryBandwidthGBs: 600 }, bert, scale);
    expect(Math.abs(ws.cycles - 157392) / 157392).toBeLessThan(0.02);
    expect(Math.abs(os.cycles - 151807) / 151807).toBeLessThan(0.02);
    expect(Math.abs(is.cycles - 1538018) / 1538018).toBeLessThan(0.03);
  });
});
