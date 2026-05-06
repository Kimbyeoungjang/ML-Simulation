import type { HardwareConfig, MatmulShape, TileCandidates } from "@/types/domain";
export const defaultHardware: HardwareConfig = { name: "TPUv2-like 128x128", arrayRows: 128, arrayCols: 128, frequencyMHz: 700, sramKB: 8192, dataflow: "WS", bytesPerElement: 2 };
export const defaultShapes: MatmulShape[] = [
  { id: "vit_attn_qkv", model: "vit-s", opName: "attention_qkv", m: 197, n: 2304, k: 384, dtypeBytes: 2, source: "manual" },
  { id: "vit_mlp_fc1", model: "vit-s", opName: "mlp_fc1", m: 197, n: 1536, k: 384, dtypeBytes: 2, source: "manual" },
  { id: "vit_mlp_fc2", model: "vit-s", opName: "mlp_fc2", m: 197, n: 384, k: 1536, dtypeBytes: 2, source: "manual" }
];
export const defaultCandidates: TileCandidates = { tileM: [16, 32, 64, 128], tileN: [32, 64, 128, 256], tileK: [32, 64, 128, 256] };
export const defaultArraySweep = [ { rows: 32, cols: 32 }, { rows: 64, cols: 64 }, { rows: 128, cols: 128 }, { rows: 128, cols: 256 }, { rows: 256, cols: 128 }, { rows: 256, cols: 256 } ];
