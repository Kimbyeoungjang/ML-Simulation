import type { HardwareConfig, MatmulShape } from "@/types/domain";
export const hardwarePresets: HardwareConfig[] = [
  { name: "TPUv1-like", arrayRows: 256, arrayCols: 256, frequencyMHz: 700, sramKB: 24_000, dataflow: "WS", bytesPerElement: 2, memoryBandwidthGBs: 30, energyPerMacPJ: 1.2, energyPerSramAccessPJ: 6, energyPerDramBytePJ: 80, staticPowerW: 28, dispatchOverheadUs: 8, doubleBuffering: true },
  { name: "TPUv2-like", arrayRows: 128, arrayCols: 128, frequencyMHz: 700, sramKB: 8192, dataflow: "WS", bytesPerElement: 2, memoryBandwidthGBs: 600, energyPerMacPJ: 1.0, energyPerSramAccessPJ: 5, energyPerDramBytePJ: 60, staticPowerW: 35, dispatchOverheadUs: 5, doubleBuffering: true },
  { name: "Edge-TPU-like", arrayRows: 64, arrayCols: 64, frequencyMHz: 500, sramKB: 2048, dataflow: "WS", bytesPerElement: 1, memoryBandwidthGBs: 40, energyPerMacPJ: 0.5, energyPerSramAccessPJ: 2, energyPerDramBytePJ: 35, staticPowerW: 3, dispatchOverheadUs: 12, doubleBuffering: true },
  { name: "Academic-64x64", arrayRows: 64, arrayCols: 64, frequencyMHz: 250, sramKB: 1024, dataflow: "OS", bytesPerElement: 2, memoryBandwidthGBs: 20, energyPerMacPJ: 2.0, energyPerSramAccessPJ: 8, energyPerDramBytePJ: 120, staticPowerW: 5, dispatchOverheadUs: 15, doubleBuffering: false },
  { name: "Research-256x256", arrayRows: 256, arrayCols: 256, frequencyMHz: 800, sramKB: 16384, dataflow: "WS", bytesPerElement: 2, memoryBandwidthGBs: 900, energyPerMacPJ: 1.4, energyPerSramAccessPJ: 7, energyPerDramBytePJ: 70, staticPowerW: 55, dispatchOverheadUs: 5, doubleBuffering: true }
];
export const workloadPresets: Record<string, MatmulShape[]> = {
  "ViT-S sample": [
    { id:"vit_s_qkv", model:"vit_s", opName:"qkv_projection", m:197, n:2304, k:768, dtypeBytes:2, source:"import" },
    { id:"vit_s_attn", model:"vit_s", opName:"attention_score", m:197, n:197, k:64, dtypeBytes:2, source:"import" },
    { id:"vit_s_ffn1", model:"vit_s", opName:"ffn_expand", m:197, n:3072, k:768, dtypeBytes:2, source:"import" },
    { id:"vit_s_ffn2", model:"vit_s", opName:"ffn_project", m:197, n:768, k:3072, dtypeBytes:2, source:"import" }
  ],
  "BERT-base block": [
    { id:"bert_qkv", model:"bert_base", opName:"qkv_projection", m:384, n:2304, k:768, dtypeBytes:2, source:"import" },
    { id:"bert_attn", model:"bert_base", opName:"attention_score", m:384, n:384, k:64, dtypeBytes:2, source:"import" },
    { id:"bert_ffn1", model:"bert_base", opName:"ffn_expand", m:384, n:3072, k:768, dtypeBytes:2, source:"import" },
    { id:"bert_ffn2", model:"bert_base", opName:"ffn_project", m:384, n:768, k:3072, dtypeBytes:2, source:"import" }
  ],
  "ResNet bottleneck": [
    { id:"res_1x1_reduce", model:"resnet", opName:"conv1x1_reduce", m:3136, n:64, k:256, dtypeBytes:2, source:"conv" },
    { id:"res_3x3", model:"resnet", opName:"conv3x3", m:3136, n:64, k:576, dtypeBytes:2, source:"conv" },
    { id:"res_1x1_expand", model:"resnet", opName:"conv1x1_expand", m:3136, n:256, k:64, dtypeBytes:2, source:"conv" }
  ]
};
