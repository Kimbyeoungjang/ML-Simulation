import type { HardwareConfig, MatmulShape } from "@/types/domain";

// 공개 사양을 참고한 탐색용 근사 프리셋입니다.
// 실제 하드웨어와 1:1로 일치한다고 단정하지 말고, 빠른 설계 sweep의 출발점으로 사용하세요.
export const hardwarePresets: HardwareConfig[] = [
  { name: "TPUv1-like 256x256", arrayRows: 256, arrayCols: 256, frequencyMHz: 700, sramKB: 24_000, dataflow: "WS", bytesPerElement: 2, memoryBandwidthGBs: 30, energyPerMacPJ: 1.2, energyPerSramAccessPJ: 6, energyPerDramBytePJ: 80, staticPowerW: 28, dispatchOverheadUs: 8, doubleBuffering: true },
  { name: "TPUv2-like 128x128", arrayRows: 128, arrayCols: 128, frequencyMHz: 700, sramKB: 8192, dataflow: "WS", bytesPerElement: 2, memoryBandwidthGBs: 600, energyPerMacPJ: 1.0, energyPerSramAccessPJ: 5, energyPerDramBytePJ: 60, staticPowerW: 35, dispatchOverheadUs: 5, doubleBuffering: true },
  { name: "TPUv3-like 128x128", arrayRows: 128, arrayCols: 128, frequencyMHz: 940, sramKB: 16384, dataflow: "WS", bytesPerElement: 2, memoryBandwidthGBs: 900, energyPerMacPJ: 0.9, energyPerSramAccessPJ: 4.5, energyPerDramBytePJ: 55, staticPowerW: 55, dispatchOverheadUs: 4, doubleBuffering: true },
  { name: "TPUv4-like 128x128", arrayRows: 128, arrayCols: 128, frequencyMHz: 1050, sramKB: 32768, dataflow: "WS", bytesPerElement: 2, memoryBandwidthGBs: 1200, energyPerMacPJ: 0.75, energyPerSramAccessPJ: 4, energyPerDramBytePJ: 45, staticPowerW: 70, dispatchOverheadUs: 3, doubleBuffering: true },
  { name: "Edge-TPU-like 64x64", arrayRows: 64, arrayCols: 64, frequencyMHz: 500, sramKB: 2048, dataflow: "WS", bytesPerElement: 1, memoryBandwidthGBs: 40, energyPerMacPJ: 0.5, energyPerSramAccessPJ: 2, energyPerDramBytePJ: 35, staticPowerW: 3, dispatchOverheadUs: 12, doubleBuffering: true },
  { name: "NPU-small 32x32", arrayRows: 32, arrayCols: 32, frequencyMHz: 800, sramKB: 1024, dataflow: "OS", bytesPerElement: 1, memoryBandwidthGBs: 25, energyPerMacPJ: 0.45, energyPerSramAccessPJ: 2.5, energyPerDramBytePJ: 40, staticPowerW: 2, dispatchOverheadUs: 10, doubleBuffering: true },
  { name: "Academic-64x64 OS", arrayRows: 64, arrayCols: 64, frequencyMHz: 250, sramKB: 1024, dataflow: "OS", bytesPerElement: 2, memoryBandwidthGBs: 20, energyPerMacPJ: 2.0, energyPerSramAccessPJ: 8, energyPerDramBytePJ: 120, staticPowerW: 5, dispatchOverheadUs: 15, doubleBuffering: false },
  { name: "Research-256x256 WS", arrayRows: 256, arrayCols: 256, frequencyMHz: 800, sramKB: 16384, dataflow: "WS", bytesPerElement: 2, memoryBandwidthGBs: 900, energyPerMacPJ: 1.4, energyPerSramAccessPJ: 7, energyPerDramBytePJ: 70, staticPowerW: 55, dispatchOverheadUs: 5, doubleBuffering: true }
];

export const workloadPresets: Record<string, MatmulShape[]> = {
  "ViT-S encoder block": [
    { id:"vit_s_qkv", model:"vit_s", opName:"qkv_projection", m:197, n:2304, k:768, dtypeBytes:2, source:"import" },
    { id:"vit_s_attn", model:"vit_s", opName:"attention_score", m:197, n:197, k:64, dtypeBytes:2, source:"import" },
    { id:"vit_s_ffn1", model:"vit_s", opName:"ffn_expand", m:197, n:3072, k:768, dtypeBytes:2, source:"import" },
    { id:"vit_s_ffn2", model:"vit_s", opName:"ffn_project", m:197, n:768, k:3072, dtypeBytes:2, source:"import" }
  ],
  "BERT-base seq384 block": [
    { id:"bert_qkv", model:"bert_base", opName:"qkv_projection", m:384, n:2304, k:768, dtypeBytes:2, source:"import" },
    { id:"bert_attn", model:"bert_base", opName:"attention_score", m:384, n:384, k:64, dtypeBytes:2, source:"import" },
    { id:"bert_ffn1", model:"bert_base", opName:"ffn_expand", m:384, n:3072, k:768, dtypeBytes:2, source:"import" },
    { id:"bert_ffn2", model:"bert_base", opName:"ffn_project", m:384, n:768, k:3072, dtypeBytes:2, source:"import" }
  ],
  "Llama-7B decode/proj sample": [
    { id:"llama7b_qkv", model:"llama7b", opName:"qkv_projection", m:128, n:12288, k:4096, dtypeBytes:2, source:"import" },
    { id:"llama7b_o", model:"llama7b", opName:"out_projection", m:128, n:4096, k:4096, dtypeBytes:2, source:"import" },
    { id:"llama7b_gate_up", model:"llama7b", opName:"gate_up_projection", m:128, n:22016, k:4096, dtypeBytes:2, source:"import" },
    { id:"llama7b_down", model:"llama7b", opName:"down_projection", m:128, n:4096, k:11008, dtypeBytes:2, source:"import" }
  ],
  "Llama-13B decode/proj sample": [
    { id:"llama13b_qkv", model:"llama13b", opName:"qkv_projection", m:128, n:15360, k:5120, dtypeBytes:2, source:"import" },
    { id:"llama13b_o", model:"llama13b", opName:"out_projection", m:128, n:5120, k:5120, dtypeBytes:2, source:"import" },
    { id:"llama13b_gate_up", model:"llama13b", opName:"gate_up_projection", m:128, n:27648, k:5120, dtypeBytes:2, source:"import" },
    { id:"llama13b_down", model:"llama13b", opName:"down_projection", m:128, n:5120, k:13824, dtypeBytes:2, source:"import" }
  ],
  "GPT-style medium block": [
    { id:"gpt_qkv", model:"gpt_medium", opName:"qkv_projection", m:1024, n:3072, k:1024, dtypeBytes:2, source:"import" },
    { id:"gpt_attn", model:"gpt_medium", opName:"attention_score", m:1024, n:1024, k:64, dtypeBytes:2, source:"import" },
    { id:"gpt_mlp1", model:"gpt_medium", opName:"mlp_expand", m:1024, n:4096, k:1024, dtypeBytes:2, source:"import" },
    { id:"gpt_mlp2", model:"gpt_medium", opName:"mlp_project", m:1024, n:1024, k:4096, dtypeBytes:2, source:"import" }
  ],
  "ResNet bottleneck": [
    { id:"res_1x1_reduce", model:"resnet", opName:"conv1x1_reduce", m:3136, n:64, k:256, dtypeBytes:2, source:"conv" },
    { id:"res_3x3", model:"resnet", opName:"conv3x3", m:3136, n:64, k:576, dtypeBytes:2, source:"conv" },
    { id:"res_1x1_expand", model:"resnet", opName:"conv1x1_expand", m:3136, n:256, k:64, dtypeBytes:2, source:"conv" }
  ]
};
