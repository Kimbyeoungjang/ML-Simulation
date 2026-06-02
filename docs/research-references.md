# Research References

이 문서는 TileForge 보고서/발표에서 배경 이론과 관련 연구를 설명할 때 사용할 논문과 공식 문서 목록입니다.

## 핵심 논문

### 1. Tensor Processing Unit

**N. P. Jouppi et al., “In-Datacenter Performance Analysis of a Tensor Processing Unit,” ISCA 2017.**

- URL: https://arxiv.org/abs/1704.04760
- 왜 중요한가: TPU v1의 systolic matrix multiply unit, on-chip memory, deterministic execution, datacenter inference 성능을 설명하는 대표 논문입니다.
- TileForge와의 연결: TileForge의 TPU-like array, GEMM 중심 workload, hardware-design cycle 비교의 배경입니다.

### 2. SCALE-Sim

**A. Samajdar, Y. Zhu, P. Whatmough, M. Mattina, T. Krishna, “SCALE-Sim: Systolic CNN Accelerator Simulator,” arXiv 2018 / ISPASS 관련 연구.**

- URL: https://arxiv.org/abs/1811.02883
- 공식 프로젝트: https://scalesim-project.github.io/about.html
- 왜 중요한가: configurable systolic array 기반 DNN accelerator simulator로, dataflow/bandwidth/aspect ratio 등의 design-space 탐색에 사용됩니다.
- TileForge와의 연결: TileForge full-pipeline의 외부 validation backend입니다.

### 3. SCALE-Sim v3

**R. Raj et al., “SCALE-Sim v3: A Modular Cycle-Accurate Systolic Accelerator Simulator for end-to-end System Analysis,” ISPASS 2025.**

- 공식 publications: https://scalesim-project.github.io/publication.html
- 왜 중요한가: SCALE-Sim 계열이 end-to-end system analysis와 modular simulator 방향으로 확장되고 있음을 보여줍니다.
- TileForge와의 연결: future work에서 더 최신 simulator/backend로 확장할 근거가 됩니다.

### 4. MLIR

**C. Lattner et al., “MLIR: A Compiler Infrastructure for the End of Moore’s Law,” arXiv 2020.**

- URL: https://arxiv.org/abs/2002.11054
- Google Research page: https://research.google/pubs/mlir-primer-a-compiler-infrastructure-for-the-end-of-moores-law/
- 왜 중요한가: 여러 abstraction level의 IR과 heterogeneous hardware compiler infrastructure를 설명합니다.
- TileForge와의 연결: generated MLIR, transform dialect, IREE compile stage의 이론적 배경입니다.

### 5. IREE

**IREE official documentation and repository.**

- 공식 문서: https://iree.dev/
- GitHub: https://github.com/iree-org/iree
- 왜 중요한가: IREE는 MLIR 기반 end-to-end compiler/runtime으로 ML model을 다양한 target에 lower합니다.
- TileForge와의 연결: TileForge는 generated MLIR이 IREE compile pipeline을 통과하는지 검증합니다.

### 6. Roofline model

**S. Williams, A. Waterman, D. Patterson, “Roofline: An Insightful Visual Performance Model for Multicore Architectures,” Communications of the ACM, 2009.**

- DOI page: https://dl.acm.org/doi/10.1145/1498765.1498785
- PDF mirror: https://people.eecs.berkeley.edu/~kubitron/cs252/handouts/papers/RooflineVyNoYellow.pdf
- 왜 중요한가: arithmetic intensity와 compute/memory roof를 이용해 bottleneck을 직관적으로 설명합니다.
- TileForge와의 연결: roofline tab과 memory-bound/compute-bound 해석의 배경입니다.

### 7. Systolic arrays

**H. T. Kung and C. E. Leiserson, “Systolic Arrays for VLSI,” 1979.**

- PDF: https://www.eecs.harvard.edu/htk/static/files/1978-cmu-cs-report-kung-leiserson.pdf
- 왜 중요한가: systolic architecture의 원형 개념과 데이터가 규칙적으로 흐르는 processor array를 설명합니다.
- TileForge와의 연결: arrayRows/arrayCols, dataflow, pipeline fill/drain cycle 해석의 배경입니다.

## 공식 문서

| 항목 | 링크 | TileForge에서 쓰는 부분 |
|---|---|---|
| SCALE-Sim project | https://scalesim-project.github.io/about.html | simulator 개념, DNN layer 지원, design-space 탐색 |
| ARM SCALE-Sim repository | https://github.com/ARM-software/SCALE-Sim | 원본 SCALE-Sim 계열 참고 |
| IREE docs | https://iree.dev/ | compiler/runtime 설치와 개념 |
| IREE GitHub | https://github.com/iree-org/iree | package/tooling 참고 |
| MLIR paper | https://arxiv.org/abs/2002.11054 | compiler infrastructure 배경 |
| TPU paper | https://arxiv.org/abs/1704.04760 | TPU-like accelerator 배경 |

## 보고서에 넣기 좋은 문장 예시

- “TileForge는 TPU 논문에서 대표적으로 설명된 matrix multiply 중심 accelerator 구조를 교육/설계 탐색 수준에서 재현해 보기 위한 워크벤치이다.”
- “SCALE-Sim은 systolic array 기반 DNN accelerator의 cycle과 memory behavior를 검증하는 외부 reference simulator로 사용된다.”
- “MLIR/IREE stage는 예측 cycle을 직접 제공하기보다, TileForge가 생성한 연산 표현이 실제 compiler pipeline을 통과할 수 있는지 확인하는 역할을 한다.”
- “Roofline 분석은 cycle ranking만으로는 보이지 않는 compute-bound/memory-bound 병목을 설명하기 위해 사용된다.”

## 읽는 순서 추천

1. Jouppi et al. TPU paper — 왜 systolic array accelerator가 중요한지
2. Kung & Leiserson — systolic array의 원리
3. SCALE-Sim paper — systolic accelerator simulator와 DSE 방법
4. Roofline paper — memory/compute 병목 해석
5. MLIR paper — compiler IR 기반 lowering 배경
6. IREE docs — MLIR 기반 compiler/runtime 실무 연결

## 향후 확장 참고

- 더 넓은 실제 accelerator benchmark dataset 수집
- IREE runtime benchmark와 cycle model 연결
- SCALE-Sim v3 또는 다른 modular accelerator simulator backend 추가
- dataflow별 실제 SRAM bank conflict 모델 강화
- ONNX/MLIR graph-level fusion과 scheduling 반영
