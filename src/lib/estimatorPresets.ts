export interface EstimatorPresetConfig {
  id: string;
  name: string;
  description: string;
  planOptions: {
    mRange: string;
    nRange: string;
    kRange: string;
    tileMRange: string;
    tileNRange: string;
    tileKRange: string;
    arrayRange: string;
    sramKbRange: string;
    dataflows: string;
    maxSamples: number;
    queueLimit: number;
    topKPerShape: number;
    includeCurrentShapes: boolean;
  };
  trainOptions: {
    trees: number;
    maxDepth: number;
    minLeaf: number;
    hiddenUnits: number;
    epochs: number;
    maxFinalTrainSamples: number;
    splits: string;
  };
}

export const estimatorPresets: EstimatorPresetConfig[] = [
  {
    id: "smoke-128",
    name: "Smoke 128",
    description: "큐/수집/학습 흐름을 빠르게 확인하는 최소 검증 프리셋입니다.",
    planOptions: {
      mRange: "160:224:32",
      nRange: "384:2304:384",
      kRange: "384:1536:384",
      tileMRange: "64,128,256",
      tileNRange: "128,256,512",
      tileKRange: "128,256,512",
      arrayRange: "128x128,128x256,256x128",
      sramKbRange: "8192,16384",
      dataflows: "WS,OS,IS",
      maxSamples: 128,
      queueLimit: 128,
      topKPerShape: 1,
      includeCurrentShapes: true,
    },
    trainOptions: { trees: 80, maxDepth: 8, minLeaf: 4, hiddenUnits: 24, epochs: 350, maxFinalTrainSamples: 128, splits: "random,workload,array,dataflow,large-shape" },
  },
  {
    id: "quick-512",
    name: "Quick 512",
    description: "512개 표본으로 파이프라인과 기본 보정 품질을 같이 확인하는 추천 테스트 프리셋입니다.",
    planOptions: {
      mRange: "160:224:32",
      nRange: "384:2304:384",
      kRange: "384:1536:384",
      tileMRange: "64,128,256",
      tileNRange: "128,256,512",
      tileKRange: "128,256,512",
      arrayRange: "128x128,128x256,256x128",
      sramKbRange: "8192,16384",
      dataflows: "WS,OS,IS",
      maxSamples: 512,
      queueLimit: 512,
      topKPerShape: 1,
      includeCurrentShapes: true,
    },
    trainOptions: { trees: 120, maxDepth: 8, minLeaf: 4, hiddenUnits: 32, epochs: 500, maxFinalTrainSamples: 512, splits: "random,workload,array,dataflow,large-shape" },
  },
  {
    id: "balanced-4096",
    name: "Balanced 4096",
    description: "ViT-S 주변의 M/N/K, tile, array, SRAM, WS/OS/IS를 균형 있게 섞는 본 실험 시작 프리셋입니다.",
    planOptions: {
      mRange: "128:256:32",
      nRange: "384:2304:192",
      kRange: "128:1536:128",
      tileMRange: "32,64,96,128,192,256",
      tileNRange: "64,128,192,256,384,512",
      tileKRange: "64,128,192,256,384,512",
      arrayRange: "64x64,128x128,128x256,256x128,256x256",
      sramKbRange: "2048,4096,8192,16384",
      dataflows: "WS,OS,IS",
      maxSamples: 4096,
      queueLimit: 4096,
      topKPerShape: 1,
      includeCurrentShapes: true,
    },
    trainOptions: { trees: 200, maxDepth: 10, minLeaf: 4, hiddenUnits: 64, epochs: 1000, maxFinalTrainSamples: 4096, splits: "random,workload,array,dataflow,large-shape" },
  },

  {
    id: "vit-full-8192",
    name: "ViT full-layer 8k",
    description: "qkv/attention_score/FFN처럼 작은 attention과 큰 GEMM이 섞인 workload를 겨냥한 full-layer 학습 프리셋입니다.",
    planOptions: {
      mRange: "160:224:16",
      nRange: "128:3072:128",
      kRange: "64:3072:128",
      tileMRange: "32,64,96,128,192,256",
      tileNRange: "32,64,128,192,256,384,512",
      tileKRange: "32,64,128,192,256,384,512",
      arrayRange: "64x64,128x128,128x256,256x128,256x256",
      sramKbRange: "4096,8192,16384",
      dataflows: "WS,OS,IS",
      maxSamples: 8192,
      queueLimit: 8192,
      topKPerShape: 1,
      includeCurrentShapes: true,
    },
    trainOptions: { trees: 220, maxDepth: 10, minLeaf: 4, hiddenUnits: 96, epochs: 1100, maxFinalTrainSamples: 8192, splits: "random,workload,array,dataflow,large-shape" },
  },
  {
    id: "large-50000",
    name: "Large Dataset 50k",
    description: "이미 수만 개 CSV가 있을 때 Dataset Manager 학습에 쓰는 강한 학습 설정 프리셋입니다.",
    planOptions: {
      mRange: "64:2048:64",
      nRange: "256:4096:256",
      kRange: "128:4096:128",
      tileMRange: "32,64,128,256,512",
      tileNRange: "64,128,256,512,1024",
      tileKRange: "64,128,256,512,1024",
      arrayRange: "64x64,128x128,128x256,256x128,256x256",
      sramKbRange: "2048,4096,8192,16384,32768",
      dataflows: "WS,OS,IS",
      maxSamples: 50000,
      queueLimit: 50000,
      topKPerShape: 1,
      includeCurrentShapes: true,
    },
    trainOptions: { trees: 240, maxDepth: 12, minLeaf: 4, hiddenUnits: 128, epochs: 1200, maxFinalTrainSamples: 50000, splits: "random,workload,array,dataflow,large-shape" },
  },
];

export function findEstimatorPreset(id: string): EstimatorPresetConfig | undefined {
  return estimatorPresets.find((preset) => preset.id === id);
}
