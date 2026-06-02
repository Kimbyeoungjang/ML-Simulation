# Purpose-aligned Pipeline

TileForge의 최종 목적은 “TPU-like systolic array에서 어떤 하드웨어 구조와 타일 정책이 특정 딥러닝 workload에 적합한지 설명하고 검증하는 것”입니다. 따라서 pipeline도 단일 cycle 계산기가 아니라 목적별 증거를 생산하도록 설계되어 있습니다.

## 목적 1: 하드웨어 설계 탐색

필요한 질문:

- array를 키우면 실제로 빨라지는가?
- SRAM을 늘리는 것이 cycle 감소에 도움이 되는가?
- bandwidth가 병목인가?
- WS/OS/IS 중 어떤 dataflow가 workload에 맞는가?

TileForge 대응:

- full-layer cycle baseline
- array sweep
- design-space sweet spot
- roofline/memory traffic
- SCALE-Sim full topology validation
- hardware design plan artifact

## 목적 2: 타일링 정책 선택

필요한 질문:

- 어떤 tileM/N/K가 utilization과 SRAM fit을 동시에 만족하는가?
- padding 낭비가 큰 후보는 무엇인가?
- top-k tile 후보가 왜 선택되었는가?

TileForge 대응:

- tile-policy cycle
- Top-K/Pareto candidate
- tile scratch SRAM
- padding/utilization score
- tiling strategy artifact
- tile schedule SVG

## 목적 3: 외부 검증과 신뢰도 확보

필요한 질문:

- estimator가 SCALE-Sim과 얼마나 다른가?
- IREE compile은 가능한가?
- 결과가 재현 가능한 artifact로 남는가?

TileForge 대응:

- SCALE-Sim cfg/topology/layout 자동 생성
- IREE MLIR/transform/command 자동 생성
- external validation report
- raw log 보관
- artifact integrity manifest
- prediction contract

## 목적 4: 반복 실험으로 예측 개선

필요한 질문:

- 특정 환경에서 estimator가 항상 낙관적인가?
- sample이 쌓이면 보정할 수 있는가?
- 학습 model이 적용 가능한 범위는 어디까지인가?

TileForge 대응:

- job sample collection
- scoped dataset split
- Estimator Suite training
- readiness gate
- prediction confidence
- active validation plan

## 최종 보고서에서의 구성 제안

1. **문제 정의**: systolic array DSE와 GEMM/Conv tiling 문제
2. **TileForge 목적**: 빠른 예측 + 외부 검증 + artifact 생성
3. **프로그램 구조**: UI/API/lib/worker/external tools
4. **파이프라인**: input → estimator → job queue → SCALE-Sim/IREE → report
5. **예측 방법**: full-layer estimator, tile-policy estimator, roofline/energy/memory model
6. **검증 방법**: SCALE-Sim, IREE, Estimator Suite readiness
7. **결과 해석**: full-layer cycle과 tile-policy cycle 분리
8. **한계와 향후 연구**: 실제 TPU runtime, 더 넓은 dataset, compiler lowering 측정

## 핵심 메시지

TileForge의 장점은 “가장 정확한 단일 simulator”가 되는 것이 아니라, 설계 탐색 과정에서 **빠른 후보 생성, 명시적 가정, 외부 검증, 학습형 보정, 재현 가능한 artifact**를 하나의 workflow로 묶는 것입니다.
