# TileForge tiling experiment scripts

이 문서는 estimator가 고른 tile 후보를 기준으로 `no_tiling`, `baseline_tiling`, `recommended_tiling`, `oracle_tiling` 네 전략을 비교하는 실험 스크립트 사용법을 정리한다.

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
| `no_tiling` | 전체 `M x N x K` matmul을 하나의 SCALE-Sim layer로 실행. SRAM 초과 여부는 `sram_feasible`로 따로 표시된다. |
| `baseline_tiling` | target MXU와 shape를 함께 고려한 단순 규칙 기반 baseline. 작은 N/K 차원은 억지로 128/256까지 키우지 않고 shape에 맞춰 clamp한다. |
| `recommended_tiling` | target-aware 후보군을 만들고 estimator가 고른 tile. TPU v2와 v6e에서 서로 다른 추천 tile이 나올 수 있다. |
| `oracle_tiling` | target-aware 후보군 중 estimator 상위 K개를 실제 SCALE-Sim으로 모두 실행한 뒤 cycle이 가장 낮은 tile을 선택한 upper-bound 기준. |

기본값은 `oracle_tiling`까지 포함한다. 실행 시간이 부담되면 다음처럼 oracle을 끌 수 있다.

```bash
npm run experiment:scalesim -- \
  --input .tileforge/jobs/<job-id>/result.json \
  --targets tpu-v2,tpu-v6e \
  --out .tileforge/experiments/tiling-demo \
  --no-oracle \
  --require-external
```

oracle 후보 수는 기본 8개다. 더 정밀하게 보려면 늘리고, 빠르게 보려면 줄인다.

```bash
npm run experiment:scalesim -- \
  --input .tileforge/jobs/<job-id>/result.json \
  --targets tpu-v6e \
  --oracle-top-k 16 \
  --out .tileforge/experiments/tiling-v6e-oracle \
  --require-external
```

출력 파일은 다음과 같다.

| 파일 | 내용 |
|---|---|
| `experiment_plan.json` | SCALE-Sim 실험 계획과 target별 hardware preset |
| `tpu_plan.json` | 실제 TPU 벤치마크 입력 계획 |
| `results.csv` | shape별, strategy별 SCALE-Sim 결과. `sram_feasible`, `sram_fit_ratio`, `candidate_count` 포함 |
| `totals.csv` | target/strategy별 합산 결과 |
| `total_cycles.svg` | 발표용 총 cycle 비교 그래프 |
| `scalesim-artifacts/` | 각 tile unit별 SCALE-Sim config/topology/report/log |

추천 tile을 입력 `result.json`에서 그대로 쓰고 싶다면 다음 옵션을 사용한다.

```bash
npm run experiment:scalesim -- \
  --input .tileforge/jobs/<job-id>/result.json \
  --recommended-source input
```

하지만 v2 결과를 v6e에도 그대로 쓰는 문제를 피하려면 기본값인 `--recommended-source per-target`을 유지하는 것이 좋다.

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

## 3. 해석 기준

`oracle_tiling`은 실제 시스템이 즉시 사용할 수 있는 값이라기보다, 후보군 안에서 SCALE-Sim으로 확인 가능한 상한선이다. 발표에서는 다음 메시지로 해석하는 것이 좋다.

> baseline은 단순 규칙 기반 타일링이고, recommended는 estimator가 빠르게 고른 후보이며, oracle은 같은 후보군을 실제 SCALE-Sim으로 전부 검증했을 때의 최선값이다. TileForge의 목표는 oracle에 가까운 tile을 훨씬 적은 비용으로 찾는 것이다.

`no_tiling`은 실제 TPU/XLA의 내부 tiling을 완전히 끈다는 뜻이 아니라, 전체 GEMM을 하나의 SCALE-Sim layer로 넣은 비교군이다. 따라서 SRAM을 초과하는 경우에는 `sram_feasible=false`를 확인하고 발표 그래프에서 별도 표시하는 것이 좋다.

## 4. 주의점

실제 TPU 스크립트는 JAX로 blockwise matmul을 만들어 tile 크기 차이를 강제로 반영한다. 따라서 XLA가 내부적으로 선택하는 완전한 compiler-level tiling과 1:1로 같지는 않다. 이 실험의 목적은 TileForge가 추천한 tile shape가 `no_tiling` 및 단순 baseline 대비 더 좋은 block decomposition을 만드는지 비교하는 것이다.

큰 shape에서 tile 수가 많으면 컴파일 시간이 길어질 수 있다. 먼저 `--limit`, `--strategy`, `--oracle-top-k`, `--max-elements`를 작게 두고 smoke test를 수행한 뒤 전체 실험으로 확장하는 것이 좋다.
