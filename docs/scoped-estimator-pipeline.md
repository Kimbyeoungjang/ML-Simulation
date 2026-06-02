# Scoped Estimator Suite Pipeline

Estimator Suite는 SCALE-Sim/job 결과로 analytical estimator를 보정합니다. production 기준에서 가장 중요한 규칙은 **full-layer target과 tile-policy target을 절대 섞지 않는 것**입니다.

## Target scopes

| Scope | Target value | 주 사용처 | feature policy |
|---|---|---|---|
| `full-layer` | SCALE-Sim full topology `COMPUTE_REPORT.csv` layer cycle | 외부 검증, hardware design report, design-space | tileM/tileN/tileK는 bookkeeping이며 전체 GEMM shape 기준으로 canonicalize |
| `tile-policy` | tile micro-run 또는 tile-extrapolated cycle | tile ranking, top-k validation, lowering hint | tile geometry, padding, edge tile, SRAM pressure를 feature로 유지 |

## 왜 분리해야 하는가

full topology SCALE-Sim은 layer 전체의 data reuse와 systolic schedule을 봅니다. 반면 tile micro-run은 특정 tile 후보를 반복 실행하는 진단값입니다. 두 값은 fill/drain, reuse, boundary effect 때문에 다를 수 있습니다. 하나의 CSV/model에 섞어 학습하면 validation MAPE가 낮아 보여도 실제 hardware-design 결정에는 잘못된 correction이 적용될 수 있습니다.

## Dataset layout

scope pipeline은 다음 구조로 artifact를 씁니다.

```text
estimator-suite/<run-id>/
  datasets/
    merged/
      samples.csv
      report.md
      readiness.md
      readiness.json
    full-layer/
      samples.csv
      report.md
      readiness.md
      readiness.json
    tile-policy/
      samples.csv
      report.md
      readiness.md
      readiness.json
  estimator-suite/
    scoped-pipeline-report.md
    full-layer/
      model.json
      report.md
      validation.csv
      predictions.csv
      readiness.md
      readiness.json
    tile-policy/
      model.json
      report.md
      validation.csv
      predictions.csv
      readiness.md
      readiness.json
```

## API actions

```json
{ "action": "split-dataset", "files": [{ "name": "samples.csv", "text": "..." }] }
```

CSV를 정규화하고 `full-layer`, `tile-policy` dataset으로 나눕니다. training은 하지 않습니다.

```json
{ "action": "scope-pipeline", "files": [{ "name": "samples.csv", "text": "..." }] }
```

split 후 scope별로 충분한 sample이 있으면 train/evaluate/readiness report를 생성합니다.

```json
{ "action": "split-and-train", "files": [{ "name": "samples.csv", "text": "..." }] }
```

`scope-pipeline` alias입니다.

## Job sample collection

`collectEstimatorSamplesFromJobs()`는 완료된 job에서 가능한 경우 두 scope를 모두 추출합니다.

- `candidate.tileExtrapolatedCycles` → `tile-policy`
- `layers.cycles` 또는 `layers.scaleSimRawCycles` → `full-layer`

각 row에는 최소한 다음 metadata가 들어갑니다.

- `targetScope`
- `measuredSource`
- hardware config
- workload shape
- dataflow
- tile shape, tile-policy인 경우
- predicted cycles
- measured cycles
- error ratio

## Training policy

- scope별 valid sample이 너무 적으면 model training을 skip합니다.
- readiness가 blocked면 active model로 쓰지 않는 것이 원칙입니다.
- validation split은 request option의 `validationFraction`을 따릅니다.
- domain coverage가 부족한 후보에는 낮은 confidence를 부여합니다.

## Model application rule

`applyEstimatorSuiteToSearchResponse()`는 target-aware입니다.

| Active model | 적용 위치 |
|---|---|
| `full-layer` model | full-layer hardware-design cycle correction |
| `tile-policy` model | tile candidate ranking correction |
| `mixed`/legacy model | conservative mode. full-layer cycle은 analytical baseline 유지 |

## Report contract

report는 다음 세 값을 분리해 보여야 합니다.

1. **Full-layer cycle**: 하드웨어 설계/외부 검증 target
2. **Tile-policy cycle**: tile 선택/ranking target
3. **SRAM/DRAM traffic**: 병목 진단값이며 cycle과 다른 단위

## 권장 운영 방식

1. 작은 후보군으로 full-pipeline job을 여러 개 완료합니다.
2. job에서 sample을 수집합니다.
3. `split-dataset`으로 scope 분포를 확인합니다.
4. `scope-pipeline`으로 학습합니다.
5. readiness report를 확인합니다.
6. active model로 적용합니다.
7. design-space에서 low-confidence 후보는 다시 SCALE-Sim으로 검증합니다.
