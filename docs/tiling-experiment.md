# TileForge tiling experiment scripts

이 문서는 estimator가 고른 tile 후보를 기준으로 `no_tiling`, `baseline_tiling`, `recommended_tiling` 세 전략을 비교하는 실험 스크립트 사용법을 정리한다.

## 1. SCALE-Sim 실험

```bash
npm run experiment:scalesim -- \
  --input .tileforge/jobs/<job-id>/result.json \
  --targets tpu-v2,tpu-v6e \
  --out .tileforge/experiments/tiling-demo \
  --require-external
```

입력 파일은 다음 중 하나를 받을 수 있다.

- TileForge `result.json`
- TileForge project JSON
- `shapes` 배열이 들어 있는 JSON
- `M,N,K` 컬럼이 들어 있는 CSV

전략 정의는 다음과 같다.

| strategy | 의미 |
|---|---|
| `no_tiling` | 전체 `M x N x K` matmul을 하나의 layer로 실행 |
| `baseline_tiling` | target MXU 크기에 맞춘 일반적인 array-aligned tile 사용. 기본값은 `arrayRows x arrayCols x arrayRows` |
| `recommended_tiling` | TileForge estimator가 고른 tile 사용 |

출력 파일은 다음과 같다.

| 파일 | 내용 |
|---|---|
| `experiment_plan.json` | SCALE-Sim 실험 계획 |
| `tpu_plan.json` | 실제 TPU 벤치마크 입력 계획 |
| `results.csv` | shape별, strategy별 SCALE-Sim 결과 |
| `totals.csv` | target/strategy별 합산 결과 |
| `total_cycles.svg` | 발표용 총 cycle 비교 그래프 |
| `scalesim-artifacts/` | 각 tile unit별 SCALE-Sim config/topology/report/log |

추천 tile을 입력 `result.json`에서 그대로 쓰고 싶다면 다음 옵션을 사용한다.

```bash
npm run experiment:scalesim -- \
  --input .tileforge/jobs/<job-id>/result.json \
  --recommended-source input
```

target별로 다시 추천하게 하려면 기본값인 `--recommended-source per-target`을 사용한다.

SCALE-Sim 없이 계획 파일만 만들고 싶다면 다음처럼 실행한다.

```bash
npm run experiment:scalesim -- \
  --input examples/shapes.csv \
  --targets tpu-v6e \
  --dry-run
```

## 2. 실제 TPU 실험

먼저 SCALE-Sim 스크립트 또는 dry-run으로 `tpu_plan.json`을 만든다.

```bash
npm run experiment:scalesim -- \
  --input .tileforge/jobs/<job-id>/result.json \
  --targets tpu-v6e \
  --out .tileforge/experiments/tiling-tpu \
  --dry-run
```

그 다음 Cloud TPU VM에서 JAX 환경을 준비한 뒤 실행한다.

```bash
python scripts/tpu_matmul_bench.py \
  --plan .tileforge/experiments/tiling-tpu/tpu_plan.json \
  --target tpu-v6e \
  --out .tileforge/experiments/tpu-run \
  --warmup 2 \
  --iterations 10 \
  --dtype bf16
```

출력 파일은 다음과 같다.

| 파일 | 내용 |
|---|---|
| `metadata.json` | TPU backend, devices, 실행 옵션 |
| `tpu_results.csv` | shape별, strategy별 latency / TFLOP/s |
| `tpu_totals.csv` | target/strategy별 합산 latency와 no-tiling 대비 speedup |
| `tpu_total_latency.svg` | 발표용 총 latency 비교 그래프 |

## 3. 주의점

실제 TPU 스크립트는 JAX로 blockwise matmul을 만들어 tile 크기 차이를 강제로 반영한다. 따라서 XLA가 내부적으로 선택하는 완전한 compiler-level tiling과 1:1로 같지는 않다. 이 실험의 목적은 TileForge가 추천한 tile shape가 `no_tiling` 및 단순 baseline 대비 더 좋은 block decomposition을 만드는지 비교하는 것이다.

큰 shape에서 tile 수가 많으면 컴파일 시간이 길어질 수 있다. 먼저 `--limit`, `--strategy`, `--max-elements`를 작게 두고 smoke test를 수행한 뒤 전체 실험으로 확장하는 것이 좋다.
