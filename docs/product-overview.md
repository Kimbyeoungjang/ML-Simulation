# Product Overview

## 한 줄 설명

TileForge는 TPU-like systolic array에서 GEMM/Conv workload의 실행 특성을 예측하고, 타일링/하드웨어 설계 후보를 비교하며, SCALE-Sim/IREE로 검증 가능한 artifact를 생성하는 로컬 웹 워크벤치입니다.

## 왜 필요한가

딥러닝 모델의 핵심 연산은 대부분 GEMM 또는 Conv2D입니다. TPU, NPU, AI accelerator는 이런 연산을 systolic array, 온칩 SRAM, 고정 dataflow, compiler lowering 정책으로 빠르게 처리합니다. 하지만 하드웨어 설계 변수와 workload shape가 조금만 바뀌어도 cycle, utilization, SRAM pressure, DRAM traffic이 크게 달라집니다.

TileForge는 이 문제를 다음 방식으로 해결합니다.

1. 빠른 analytical estimator로 많은 tile/hardware 후보를 평가합니다.
2. 후보별 병목, roofline, energy, memory traffic을 함께 보여줍니다.
3. 필요한 후보는 SCALE-Sim full topology 또는 top-k micro-run으로 검증합니다.
4. generated MLIR/IREE compile 산출물을 만들어 compiler-lowering 가능성을 확인합니다.
5. job artifact와 Markdown report를 남겨 발표/보고서/재현에 사용할 수 있게 합니다.
6. SCALE-Sim 결과가 모이면 Estimator Suite로 correction model을 학습해 이후 예측을 보정합니다.

## 대상 사용자

| 사용자 | TileForge에서 얻는 것 |
|---|---|
| 하드웨어 설계 학습자 | array 크기, SRAM, bandwidth, dataflow 변화가 성능에 미치는 영향 |
| compiler/lowering 실험자 | tile 후보, MLIR artifact, IREE compile 가능성 |
| 캡스톤/연구 프로젝트 | 예측 과정, 검증 과정, 보고서, 그래프, 논문 근거 |
| 모델 최적화 실험자 | workload shape별 병목과 tile ranking |

## 사용 가능한 곳

- TPU/NPU 구조 수업 또는 발표 자료
- systolic array 설계 탐색
- GEMM/Conv tiling 정책 비교
- dataflow WS/OS/IS 비교
- SCALE-Sim 기반 validation dataset 수집
- IREE/MLIR lowering hint 실험의 출발점
- 특정 workload가 compute-bound인지 memory-bound인지 설명하는 roofline 보조 자료

## 현재 production 범위

TileForge가 안정적으로 다루는 범위는 다음과 같습니다.

- GEMM `C[M,N] = A[M,K] × B[K,N]`
- Conv2D → im2col GEMM 변환
- WS/OS/IS dataflow 비교
- array rows/cols, frequency, SRAM, bandwidth sweep
- tileM/tileN/tileK 후보 탐색
- analytical full-layer cycle과 tile-policy cycle 분리
- SCALE-Sim config/topology/layout 생성과 실행
- IREE compile용 MLIR/transform artifact 생성
- job queue, worker, artifact integrity, Markdown report
- Estimator Suite dataset split/train/evaluate/activate

## 명확한 한계

- TileForge estimator는 실제 silicon timing이 아닙니다. 중요한 결론은 SCALE-Sim, TPU benchmark, 또는 실제 하드웨어 측정으로 검증해야 합니다.
- IREE compile 성공은 VMFB 생성 가능성을 뜻하며, runtime cycle 측정값과 동일하지 않습니다.
- full-layer cycle과 tile-policy cycle은 목적이 다릅니다. 하드웨어 검증에는 full-layer 값을 사용하고, tile ranking에는 tile-policy 값을 사용합니다.
- SCALE-Sim fork/버전/layout 정책이 바뀌면 기존 calibration profile을 다시 만들어야 합니다.
- energy 수치는 모델 기반 추정입니다. 공정/전압/실제 SRAM macro가 확정된 전력 분석은 아닙니다.

## 최종 발표에서 강조할 메시지

TileForge는 단순히 하나의 cycle 값을 계산하는 프로그램이 아니라, **하드웨어 구조 → 타일링 정책 → 외부 검증 → 학습형 보정 → 보고서 artifact**로 이어지는 설계 탐색 파이프라인입니다. 예측값 자체보다도, 어떤 가정으로 예측했는지와 외부 도구로 얼마나 검증되었는지를 함께 보여주는 것이 핵심입니다.
