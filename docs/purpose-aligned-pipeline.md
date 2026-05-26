# Purpose-aligned TileForge pipeline

TileForge의 최종 목적은 세 가지를 한 흐름으로 연결하는 것이다.

1. 빠른 full-layer estimate로 하드웨어 설계 후보를 좁힌다.
2. tile-policy score로 op별 타일링 전략과 대안 후보를 만든다.
3. IREE에는 확정 옵션이 아니라 runtime benchmark 후보를 제공한다.

## Metric contract

| 단계 | 대표 지표 | 해석 |
|---|---|---|
| 하드웨어 설계 | `summary.totalCycles`, `best.fullLayerCycles` | array/SRAM/BW/dataflow 비교용 full-layer latency |
| 타일링 전략 | `best.tilePolicyCycles`, `best.score`, Pareto set | MLIR/IREE lowering 후보 ranking |
| SRAM fit | `best.sramBytes`, `best.tileScratchBytes` | 타일 하나의 local scratch footprint |
| spill/refill 민감도 | `best.fullLayerSramBytes`, `best.fullLayerDramBytes` | full-layer working set과 traffic |
| IREE 옵션 | `compiler_hints.*`, `iree_benchmark_plan.*` | 확정 flag가 아니라 A-B benchmark 후보 |

`best.cycles`는 기존 UI 호환을 위해 full-layer hardware-design cycle을 담는다. 타일 후보 ranking 값을 보고 싶으면 반드시 `tilePolicyCycles`를 사용한다.

## New artifacts

| artifact | 용도 |
|---|---|
| `prediction_contract.json` | 각 수치의 의미를 기계적으로 고정하는 contract |
| `hardware_design_plan.md/json` | array/SRAM/BW/dataflow 설계 판단용 요약 |
| `tiling_strategy.md/json` | op별 선택 tile, score 안정성, 대안 tile 후보 |
| `compiler_hints.md/json` | IREE lowering hint bundle |
| `iree_benchmark_plan.md/json` | baseline vs hinted compile/runtime A-B test matrix |

## Validation policy

- SCALE-Sim은 cycle calibration 기준으로 사용한다.
- IREE compile 성공은 성능 검증이 아니다.
- IREE hint는 baseline과 동일 backend/CPU 조건에서 runtime median/p90을 비교한 뒤에만 default option으로 승격한다.
- Estimator Suite 학습 데이터는 `full-layer`와 `tile-policy` target을 섞지 않는다.
- confidence가 낮은 op와 전체 cycle share가 큰 bottleneck op를 우선 검증한다.

## Why SRAM is split

이전 구조에서는 `sramBytes`가 full-layer working set으로 덮일 수 있어, 타일이 실제로는 SRAM에 들어가는데도 SRAM 초과처럼 보이는 문제가 있었다. 현재는 다음처럼 분리한다.

- `sramBytes` / `tileScratchBytes`: tile-local scratch. SRAM fit 판단에 사용.
- `fullLayerSramBytes`: full operand working set. refill/spill, DRAM traffic, validation priority 판단에 사용.

이 분리는 하드웨어 설계, 타일링 전략, compiler hint를 동시에 다루는 TileForge에서 가장 중요한 contract이다.


## 2026-05 구조 보강

- `src/server/workerRunner.ts`에서 SCALE-Sim CSV parsing과 외부 검증 markdown 생성을 분리했다.
- `src/server/scaleSimReport.ts`는 `COMPUTE_REPORT.csv`, `DETAILED_ACCESS_REPORT.csv`, `BANDWIDTH_REPORT.csv`를 한 곳에서 파싱한다.
- `src/server/externalReport.ts`는 full-pipeline 완료 후 `report.md`, `external_validation_report.md`, `validation_report.*`, `confidence.md` 갱신을 전담한다.
- `scripts/benchmark-iree.ts`는 IREE compile 성공과 runtime 성능 검증을 분리한다. baseline/hinted VMFB를 같은 입력 tensor로 실행하여 transform hint를 승격할지 판단한다.

이 분리는 빠른 estimate를 제품처럼 쓰기 위한 최소 조건이다. worker는 실행 orchestration만 맡고, metric 해석과 외부 report는 독립 테스트 가능한 모듈로 유지한다.
