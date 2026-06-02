# Glossary

| 용어 | 의미 |
|---|---|
| GEMM | General Matrix Multiplication. `C[M,N] = A[M,K] × B[K,N]`. |
| Conv2D im2col | convolution을 GEMM 형태로 펼치는 변환. |
| Systolic array | PE가 격자처럼 연결되어 데이터가 규칙적으로 흐르며 MAC을 수행하는 구조. |
| PE | Processing Element. systolic array의 개별 MAC 처리 단위. |
| Dataflow | array 내부에서 어떤 operand를 중심으로 재사용할지 정하는 방식. WS/OS/IS가 있음. |
| WS | Weight Stationary. weight를 PE에 오래 유지하는 dataflow. |
| OS | Output Stationary. partial sum/output을 PE에 오래 유지하는 dataflow. |
| IS | Input Stationary. input activation을 PE에 오래 유지하는 dataflow. |
| M/N/K | GEMM 차원. M은 row/batch-token, N은 output column, K는 reduction dimension. |
| tileM/N/K | GEMM을 나눠 계산할 tile 크기. |
| Full-layer cycle | 전체 layer/topology를 대상으로 한 hardware-design cycle. |
| Tile-policy cycle | tile 후보 ranking을 위한 cost/cycle. |
| Utilization | 유효 MAC이 array capacity를 채우는 비율. |
| Padding ratio | tile 경계 때문에 padded MAC이 생기는 비율. |
| SRAM footprint | 온칩 메모리에 필요한 working set 또는 tile scratch 크기. |
| DRAM traffic | 외부 메모리에서 읽고 쓰는 byte 수. |
| Roofline | arithmetic intensity와 compute/memory roof를 비교하는 성능 모델. |
| Arithmetic intensity | 연산량을 memory traffic으로 나눈 값. 보통 ops/byte. |
| SCALE-Sim | systolic array DNN accelerator simulator. TileForge의 외부 validation backend. |
| IREE | MLIR 기반 compiler/runtime. TileForge에서는 compile 가능성 검증에 사용. |
| MLIR | 여러 abstraction level의 compiler IR infrastructure. |
| VMFB | IREE compile 결과 binary module. |
| Estimator Suite | SCALE-Sim/job sample로 analytical estimator를 보정하는 학습형 pipeline. |
| Readiness gate | 학습 dataset/model이 production decision에 적합한지 평가하는 gate. |
| Prediction confidence | training domain과 안정성 기준으로 계산한 예측 신뢰도. |
| Pareto candidate | 다른 후보에게 모든 지표에서 지배되지 않는 후보. |
| Sweet spot | 성능, 비용, 안정성을 함께 봤을 때 추천되는 설계 지점. |
| Artifact | job 실행 결과로 저장되는 report/csv/json/mlir/log/svg 등 파일. |
| Manifest | artifact 목록과 metadata를 기록한 파일. |
| Integrity manifest | artifact size와 SHA-256 checksum을 기록한 파일. |
