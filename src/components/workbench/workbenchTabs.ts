export type Tab =
  | "policy"
  | "bottleneck"
  | "roofline"
  | "energy"
  | "array"
  | "iree"
  | "exports"
  | "graphs"
  | "tpu"
  | "report"
  | "jobs"
  | "status";
export type InputTab =
  | "hardware"
  | "tiling"
  | "workload"
  | "run"
  | "tools"
  | "settings";

export const tabLabels: Record<Tab, string> = {
  policy: "타일 후보",
  bottleneck: "병목",
  roofline: "Roofline",
  energy: "에너지",
  array: "배열 탐색",
  iree: "컴파일",
  exports: "파일",
  graphs: "그래프",
  tpu: "TPU 비교",
  report: "보고서",
  jobs: "작업 큐",
  status: "시스템",
};

export const inputTabLabels: Record<InputTab, string> = {
  hardware: "하드웨어",
  tiling: "타일링",
  workload: "워크로드",
  run: "실행",
  tools: "도구",
  settings: "설정",
};

export const inputTabTips: Record<InputTab, string> = {
  hardware: "가속기 크기, 클럭, SRAM/DRAM, dataflow를 정합니다.",
  tiling: "타일 후보와 ranking 기준을 정합니다. 하드웨어 성능 예측과 tile 선택을 분리해 봅니다.",
  workload: "GEMM 목록을 직접 만들거나 CSV/ONNX/Conv2D에서 가져옵니다.",
  run: "현재 설정으로 SCALE-Sim/IREE 검증 작업을 큐에 넣고 실행 상태를 확인합니다.",
  tools: "프리셋과 프로젝트 파일을 관리합니다. 학습기는 별도 페이지에서 다룹니다.",
  settings: "외부 도구 명령, 작업 폴더, 병렬 작업 수 같은 .env 값을 확인하고 바꿉니다.",
};

export const envSettingKeys = [
  "TILEFORGE_SCALE_SIM_CMD",
  "TILEFORGE_IREE_COMPILE_CMD",
  "TILEFORGE_MAX_PARALLEL_JOBS",
  "TILEFORGE_WORKSPACE_DIR",
  "TILEFORGE_JOB_STORE",
  "TILEFORGE_CACHE_DIR",
  "TILEFORGE_EXTERNAL_TIMEOUT_MS",
  "TILEFORGE_ENABLE_TPU_WEB_RUN",
  "TILEFORGE_TPU_WEB_TIMEOUT_MS",
];

export const tabTips: Record<Tab, string> = {
  policy: "연산별 추천 tile과 하드웨어 설계용 cycle을 확인합니다.",
  bottleneck: "전체 cycle을 크게 만드는 연산과 병목 원인을 빠르게 찾습니다.",
  roofline: "연산 집약도 기준으로 compute-bound인지 memory-bound인지 봅니다.",
  energy: "MAC, SRAM, DRAM 접근량으로 대략적인 에너지와 EDP를 계산합니다.",
  array: "여러 systolic array 크기를 같은 workload로 비교합니다.",
  iree: "MLIR/IREE 관련 산출물과 컴파일 명령을 확인합니다.",
  exports: "SCALE-Sim, MLIR, SVG, CSV, manifest 파일을 내려받습니다.",
  graphs: "cycle, memory, mapping, stall, sweet spot을 시각적으로 확인합니다.",
  tpu: "현재 예측값을 실제 TPU JAX microbenchmark 측정 CSV와 비교합니다.",
  report: "핵심 결과만 정리한 Markdown 보고서를 확인합니다.",
  jobs: "검증 작업 큐, 진행 상태, 로그, artifact를 관리합니다.",
  status: "서버, 워커, 저장소, 외부 도구 상태를 점검합니다.",
};

