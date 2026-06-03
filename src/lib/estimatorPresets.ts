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
    /**
     * Comma-separated workload-preset selector used by buildEstimatorSamplingPlan.
     * Examples: all, transformer, llm, cnn, "ViT-S encoder block".
     */
    shapeBank?: string;
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

const DEFAULT_SPLITS = "random,workload,array,dataflow,large-shape";

export const estimatorPresets: EstimatorPresetConfig[] = [
  {
    id: "smoke-128",
    name: "Smoke 128",
    description: "큐/수집/학습 흐름만 빠르게 확인하는 최소 검증 프리셋입니다. ViT/BERT/GPT 대표 shape를 조금 포함합니다.",
    planOptions: {
      mRange: "160,197,224,256,384",
      nRange: "197,384,768,1024,2304,3072",
      kRange: "64,384,768,1024,3072",
      tileMRange: "32,64,128,256",
      tileNRange: "64,128,256,512",
      tileKRange: "32,64,128,256,512",
      arrayRange: "64x64,128x128,128x256,256x128",
      sramKbRange: "4096,8192,16384",
      dataflows: "WS,OS,IS",
      maxSamples: 128,
      queueLimit: 128,
      topKPerShape: 1,
      includeCurrentShapes: true,
      shapeBank: "transformer",
    },
    trainOptions: { trees: 80, maxDepth: 8, minLeaf: 4, hiddenUnits: 24, epochs: 350, maxFinalTrainSamples: 128, splits: DEFAULT_SPLITS },
  },
  {
    id: "quick-512",
    name: "Quick 512",
    description: "512개 표본으로 파이프라인과 기본 보정 품질을 같이 확인합니다. Transformer encoder + GPT 중형 shape 중심입니다.",
    planOptions: {
      mRange: "128,160,197,224,256,384,512,1024",
      nRange: "64,128,197,384,768,1024,1536,2304,3072,4096",
      kRange: "64,128,384,768,1024,1536,3072,4096",
      tileMRange: "32,64,96,128,192,256",
      tileNRange: "32,64,128,192,256,384,512",
      tileKRange: "32,64,128,192,256,384,512",
      arrayRange: "64x64,128x128,128x256,256x128,256x256",
      sramKbRange: "2048,4096,8192,16384",
      dataflows: "WS,OS,IS",
      maxSamples: 512,
      queueLimit: 512,
      topKPerShape: 1,
      includeCurrentShapes: true,
      shapeBank: "transformer",
    },
    trainOptions: { trees: 120, maxDepth: 8, minLeaf: 4, hiddenUnits: 32, epochs: 500, maxFinalTrainSamples: 512, splits: DEFAULT_SPLITS },
  },
  {
    id: "balanced-4096",
    name: "Balanced 4096",
    description: "ViT-S에만 치우치지 않도록 ViT/BERT/GPT/ResNet 일부를 섞은 본 실험 시작 프리셋입니다.",
    planOptions: {
      mRange: "128,160,197,224,256,384,512,784,1024,3136",
      nRange: "32,64,128,197,256,384,768,1024,1536,2304,3072,4096",
      kRange: "9,27,64,128,256,384,576,768,1024,1536,3072,4096",
      tileMRange: "16,32,64,96,128,192,256,512",
      tileNRange: "32,64,128,192,256,384,512,1024",
      tileKRange: "16,32,64,128,192,256,384,512,1024",
      arrayRange: "32x32,64x64,128x128,128x256,256x128,256x256",
      sramKbRange: "1024,2048,4096,8192,16384,32768",
      dataflows: "WS,OS,IS",
      maxSamples: 4096,
      queueLimit: 4096,
      topKPerShape: 2,
      includeCurrentShapes: true,
      shapeBank: "transformer,cnn",
    },
    trainOptions: { trees: 200, maxDepth: 10, minLeaf: 4, hiddenUnits: 64, epochs: 1000, maxFinalTrainSamples: 4096, splits: DEFAULT_SPLITS },
  },
  {
    id: "transformer-encoder-8192",
    name: "Transformer Encoder 8k",
    description: "ViT-S/BERT-base/GPT-style encoder·decoder block의 attention, qkv, FFN/MLP projection을 중점적으로 학습합니다.",
    planOptions: {
      mRange: "128,160,192,197,224,256,384,512,768,1024",
      nRange: "64,128,197,384,768,1024,1536,2048,2304,3072,4096",
      kRange: "64,128,384,768,1024,1536,2048,3072,4096",
      tileMRange: "16,32,64,96,128,192,256,384,512",
      tileNRange: "32,64,128,192,256,384,512,768,1024",
      tileKRange: "32,64,128,192,256,384,512,768,1024",
      arrayRange: "64x64,128x128,128x256,256x128,256x256",
      sramKbRange: "2048,4096,8192,16384,32768",
      dataflows: "WS,OS,IS",
      maxSamples: 8192,
      queueLimit: 4096,
      topKPerShape: 2,
      includeCurrentShapes: true,
      shapeBank: "transformer",
    },
    trainOptions: { trees: 220, maxDepth: 10, minLeaf: 4, hiddenUnits: 96, epochs: 1100, maxFinalTrainSamples: 8192, splits: DEFAULT_SPLITS },
  },
  {
    id: "vit-full-8192",
    name: "ViT full-layer 8k",
    description: "ViT-S qkv/attention_score/FFN처럼 작은 attention과 큰 GEMM이 섞인 workload를 겨냥한 full-layer 학습 프리셋입니다.",
    planOptions: {
      mRange: "160,176,192,197,208,224,256",
      nRange: "64,128,197,384,768,1024,1536,2304,3072,4096",
      kRange: "64,128,384,768,1024,1536,2304,3072,4096",
      tileMRange: "16,32,64,96,128,192,256",
      tileNRange: "32,64,128,192,256,384,512,768,1024",
      tileKRange: "32,64,128,192,256,384,512,768,1024",
      arrayRange: "64x64,128x128,128x256,256x128,256x256",
      sramKbRange: "4096,8192,16384,32768",
      dataflows: "WS,OS,IS",
      maxSamples: 8192,
      queueLimit: 4096,
      topKPerShape: 2,
      includeCurrentShapes: true,
      shapeBank: "ViT-S encoder block",
    },
    trainOptions: { trees: 220, maxDepth: 10, minLeaf: 4, hiddenUnits: 96, epochs: 1100, maxFinalTrainSamples: 8192, splits: DEFAULT_SPLITS },
  },
  {
    id: "llm-projection-8192",
    name: "LLM Projection 8k",
    description: "Llama/GPT 계열의 큰 N/K projection과 decode처럼 M이 작은 regime을 학습합니다. 큐는 4096개로 제한합니다.",
    planOptions: {
      mRange: "1,2,4,8,16,32,64,128,256,512,1024",
      nRange: "1024,2048,3072,4096,5120,8192,11008,12288,15360,22016,27648",
      kRange: "64,1024,2048,3072,4096,5120,8192,11008,13824",
      tileMRange: "1,2,4,8,16,32,64,128,256",
      tileNRange: "128,256,512,768,1024,1536,2048,4096",
      tileKRange: "64,128,256,512,768,1024,1536,2048,4096",
      arrayRange: "64x64,128x128,128x256,256x128,256x256",
      sramKbRange: "4096,8192,16384,32768,65536",
      dataflows: "WS,OS,IS",
      maxSamples: 8192,
      queueLimit: 4096,
      topKPerShape: 2,
      includeCurrentShapes: true,
      shapeBank: "llm",
    },
    trainOptions: { trees: 240, maxDepth: 12, minLeaf: 4, hiddenUnits: 128, epochs: 1200, maxFinalTrainSamples: 8192, splits: DEFAULT_SPLITS },
  },
  {
    id: "cnn-resnet-4096",
    name: "CNN / ResNet 4k",
    description: "im2col로 변환된 CNN/ResNet bottleneck처럼 M은 크고 N/K가 작은 conv regime을 학습합니다.",
    planOptions: {
      mRange: "196,784,3136,12544",
      nRange: "16,32,64,128,256,512,1024",
      kRange: "9,27,64,128,256,576,1024",
      tileMRange: "32,64,128,256,512,1024",
      tileNRange: "16,32,64,128,256,512",
      tileKRange: "9,16,27,32,64,128,256,576",
      arrayRange: "32x32,64x64,128x128,128x256,256x128",
      sramKbRange: "1024,2048,4096,8192,16384",
      dataflows: "WS,OS,IS",
      maxSamples: 4096,
      queueLimit: 4096,
      topKPerShape: 2,
      includeCurrentShapes: true,
      shapeBank: "cnn",
    },
    trainOptions: { trees: 200, maxDepth: 10, minLeaf: 4, hiddenUnits: 80, epochs: 1000, maxFinalTrainSamples: 4096, splits: DEFAULT_SPLITS },
  },

  {
    id: "real-ml-lite-1024",
    name: "Real ML Lite 1k",
    description: "발표 전 빠른 학습/검증을 위한 경량 Real ML 프리셋입니다. ViT/BERT/GPT/ResNet 대표 layer만 사용하고 Llama급 초대형 projection과 synthetic cross-product shape는 제외합니다.",
    planOptions: {
      mRange: "",
      nRange: "",
      kRange: "",
      tileMRange: "1,8,16,32,64,128,256",
      tileNRange: "16,32,64,128,256,512,1024",
      tileKRange: "9,27,32,64,128,256,512,1024",
      arrayRange: "32x32,64x64,128x128,128x256,256x128",
      sramKbRange: "2048,4096,8192,16384,32768",
      dataflows: "WS,OS,IS",
      maxSamples: 1024,
      queueLimit: 1024,
      topKPerShape: 1,
      includeCurrentShapes: false,
      shapeBank: "ViT-S encoder block,BERT-base seq384 block,GPT-style medium block,ResNet bottleneck",
    },
    trainOptions: { trees: 160, maxDepth: 9, minLeaf: 4, hiddenUnits: 48, epochs: 700, maxFinalTrainSamples: 1024, splits: DEFAULT_SPLITS },
  },
  {
    id: "real-ml-lite-2048",
    name: "Real ML Lite 2k",
    description: "발표용 본실험을 위한 경량 Real ML 프리셋입니다. 실제 ML layer 기반 다양성은 유지하되, 2시간 이상 걸리는 초대형 후보가 섞이지 않도록 Llama/초대형 synthetic grid를 제외합니다.",
    planOptions: {
      mRange: "",
      nRange: "",
      kRange: "",
      tileMRange: "1,8,16,32,64,128,256,512",
      tileNRange: "16,32,64,128,256,512,1024",
      tileKRange: "9,27,32,64,128,256,512,1024",
      arrayRange: "32x32,64x64,64x128,128x64,128x128,128x256,256x128,256x256",
      sramKbRange: "1024,2048,4096,8192,16384,32768",
      dataflows: "WS,OS,IS",
      maxSamples: 2048,
      queueLimit: 2048,
      topKPerShape: 1,
      includeCurrentShapes: false,
      shapeBank: "ViT-S encoder block,BERT-base seq384 block,GPT-style medium block,ResNet bottleneck",
    },
    trainOptions: { trees: 180, maxDepth: 10, minLeaf: 4, hiddenUnits: 64, epochs: 900, maxFinalTrainSamples: 2048, splits: DEFAULT_SPLITS },
  },
  {
    id: "real-ml-mixed-16384",
    name: "Real ML Mixed 16k",
    description: "등록된 ViT/BERT/GPT/Llama/ResNet layer preset과 실제 ML shape regime을 섞는 통합 학습 프리셋입니다. 장시간 실행용이며 큐는 4096개 단위로 나눕니다.",
    planOptions: {
      mRange: "1,2,4,8,16,32,64,128,197,256,384,512,784,1024,3136,12544",
      nRange: "16,32,64,128,197,256,384,768,1024,1536,2048,2304,3072,4096,5120,8192,11008,12288,15360,22016,27648",
      kRange: "9,27,64,128,256,384,576,768,1024,1536,2048,3072,4096,5120,8192,11008,13824",
      tileMRange: "1,8,16,32,64,128,256,512",
      tileNRange: "16,32,64,128,256,512,1024,2048",
      tileKRange: "9,27,32,64,128,256,512,1024,2048",
      arrayRange: "32x32,64x64,128x128,128x256,256x128,256x256",
      sramKbRange: "1024,2048,4096,8192,16384,32768,65536",
      dataflows: "WS,OS,IS",
      maxSamples: 16384,
      queueLimit: 4096,
      topKPerShape: 2,
      includeCurrentShapes: true,
      shapeBank: "all",
    },
    trainOptions: { trees: 260, maxDepth: 12, minLeaf: 4, hiddenUnits: 160, epochs: 1400, maxFinalTrainSamples: 16384, splits: DEFAULT_SPLITS },
  },
  {
    id: "real-ml-comprehensive-32768",
    name: "Real ML Comprehensive 32k",
    description: "전체 등록 layer preset과 Transformer/LLM/CNN 범위를 모두 아우르는 최종 학습용 프리셋입니다. 한 번에 전부 큐잉하지 말고 4096~8192개씩 반복 수집하는 용도입니다.",
    planOptions: {
      mRange: "1,2,4,8,16,32,64,96,128,160,197,224,256,384,512,784,1024,2048,3136,4096,12544",
      nRange: "16,32,64,128,197,256,384,512,768,1024,1536,2048,2304,3072,4096,5120,8192,11008,12288,15360,22016,27648",
      kRange: "9,27,64,128,256,384,576,768,1024,1536,2048,2304,3072,4096,5120,8192,11008,13824",
      tileMRange: "1,8,16,32,64,128,256,512",
      tileNRange: "16,32,64,128,256,512,1024,2048",
      tileKRange: "9,27,32,64,128,256,512,1024,2048",
      arrayRange: "32x32,64x64,128x128,128x256,256x128,256x256,256x512,512x256",
      sramKbRange: "1024,2048,4096,8192,16384,32768,65536",
      dataflows: "WS,OS,IS",
      maxSamples: 32768,
      queueLimit: 4096,
      topKPerShape: 3,
      includeCurrentShapes: true,
      shapeBank: "all",
    },
    trainOptions: { trees: 320, maxDepth: 14, minLeaf: 4, hiddenUnits: 192, epochs: 1600, maxFinalTrainSamples: 32768, splits: DEFAULT_SPLITS },
  },
  {
    id: "large-50000",
    name: "Large Dataset 50k",
    description: "이미 수만 개 CSV가 모였을 때 Dataset Manager 학습에 쓰는 강한 학습 설정입니다. 큐 등록은 8192개로 제한해 OOM/파일시스템 부하를 피합니다.",
    planOptions: {
      mRange: "1,2,4,8,16,32,64,128,197,256,384,512,784,1024,2048,3136,4096,12544",
      nRange: "16,32,64,128,197,256,384,512,768,1024,1536,2048,2304,3072,4096,5120,8192,11008,12288,15360,22016,27648",
      kRange: "9,27,64,128,256,384,576,768,1024,1536,2048,2304,3072,4096,5120,8192,11008,13824",
      tileMRange: "1,8,16,32,64,128,256,512",
      tileNRange: "16,32,64,128,256,512,1024,2048",
      tileKRange: "9,27,32,64,128,256,512,1024,2048",
      arrayRange: "32x32,64x64,128x128,128x256,256x128,256x256,256x512,512x256",
      sramKbRange: "1024,2048,4096,8192,16384,32768,65536",
      dataflows: "WS,OS,IS",
      maxSamples: 50000,
      queueLimit: 8192,
      topKPerShape: 3,
      includeCurrentShapes: true,
      shapeBank: "all",
    },
    trainOptions: { trees: 360, maxDepth: 14, minLeaf: 4, hiddenUnits: 224, epochs: 1800, maxFinalTrainSamples: 50000, splits: DEFAULT_SPLITS },
  },
];

export function findEstimatorPreset(id: string): EstimatorPresetConfig | undefined {
  return estimatorPresets.find((preset) => preset.id === id);
}
