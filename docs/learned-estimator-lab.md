# Learned Estimator Lab

TileForge의 기본 estimator는 빠르게 후보 타일을 비교하기 위한 분석식 모델이다. TPU류 systolic array를 실제로 설계하거나 논문/보고서에 사용할 정도로 신뢰도를 높이려면, 많은 SCALE-Sim 시뮬레이션 결과를 학습 데이터로 축적하고 estimator의 오차 구조를 비선형 모델로 보정하는 과정이 필요하다.

이 문서는 그 과정을 보조하는 `estimator-lab` 툴의 사용법과 설계 의도를 정리한다.

## 목표

`estimator-lab`은 단순 선형 회귀 계수 하나를 맞추는 도구가 아니다. 다음 흐름을 지원한다.

1. 다양한 GEMM shape, array 크기, SRAM 용량, dataflow, tile 크기를 포함하는 실험 설계 CSV를 생성한다.
2. 각 행을 SCALE-Sim으로 실행한 뒤 `measuredCycles`를 채운다.
3. TileForge 기본 estimator의 예측값과 SCALE-Sim 측정값 사이의 `log(measured / estimator)` 잔차를 학습한다.
4. bagged randomized regression tree ensemble로 비선형 보정 모델을 만든다.
5. validation MAPE/RMSE와 P50/P90/P95 오차를 보고서로 남긴다.

## 빠른 사용법

### 1. 실험 설계 CSV 생성

```bash
npm run estimator:design -- \
  --out profiles/estimator-lab/design.csv \
  --arrays 32x32,64x64,128x128,128x256,256x128,256x256 \
  --sram-kb 2048,4096,8192,16384 \
  --dataflows WS,OS,IS \
  --shape-limit 256 \
  --topk 8
```

생성된 CSV에는 `estimatorCycles`가 이미 채워져 있고, `measuredCycles`는 비워져 있다. 각 행을 SCALE-Sim으로 실행한 뒤 `measuredCycles`에 `COMPUTE_REPORT.csv`의 total cycle 값을 넣으면 학습 데이터가 된다.

### 2. 학습

```bash
npm run estimator:train -- \
  --input profiles/estimator-lab/results.csv \
  --out profiles/learned-estimator-model.json \
  --report profiles/learned-estimator-report.md \
  --trees 128 \
  --max-depth 10 \
  --min-leaf 4
```

결과물:

- `profiles/learned-estimator-model.json`: 재사용 가능한 학습 모델
- `profiles/learned-estimator-report.md`: baseline estimator 대비 learned estimator 오차 비교

### 3. 평가 및 예측 CSV 생성

```bash
npm run estimator:evaluate -- \
  --input profiles/estimator-lab/results.csv \
  --model profiles/learned-estimator-model.json \
  --predictions \
  --out profiles/estimator-lab/predictions.csv
```

## 입력 CSV 컬럼

필수 컬럼은 다음과 같다.

| 컬럼 | 의미 |
|---|---|
| `m`, `n`, `k` | GEMM shape |
| `tileM`, `tileN`, `tileK` | Tile 크기 |
| `arrayRows`, `arrayCols` | Systolic array 크기 |
| `sramKB` | SRAM 용량 |
| `frequencyMHz` | 동작 주파수 |
| `dataflow` | `WS`, `OS`, `IS` |
| `dtypeBytes` | 원소 byte 수 |
| `estimatorCycles` | TileForge 기본 estimator 예측 cycle |
| `measuredCycles` | SCALE-Sim 측정 cycle |

호환을 위해 `scaleSimCycles`, `scalesimCycles`, `totalCycles`, `predictedCycles`, `tileforgeCycles` 같은 별칭도 일부 허용한다.

## 모델 구조

학습 대상은 cycle 자체가 아니라 다음 잔차다.

```text
log(measuredCycles / estimatorCycles)
```

이렇게 하면 기존 estimator의 물리적 구조는 유지하면서, SCALE-Sim에서 반복적으로 관찰되는 비선형 오차만 보정할 수 있다. 특히 다음과 같은 패턴을 학습하기 쉽다.

- dataflow별 오차 차이
- tile shape와 array shape의 불일치
- SRAM 사용률이 높을 때의 stall 증가
- padding/boundary tile로 인한 과대 또는 과소 예측
- 작은 tile과 큰 tile에서 다른 cycle ratio

## 코드에서 사용하기

```ts
import modelJson from "../profiles/learned-estimator-model.json";
import { learnedEstimateTile } from "@/lib/learnedEstimator";

const tile = learnedEstimateTile(
  modelJson,
  hardware,
  shape,
  128,
  128,
  64,
  "balanced"
);
```

반환되는 `TileCandidateResult`에는 다음 정보가 추가된다.

- `rawCycles`: 기본 estimator cycle
- `cycles`: 학습 모델 보정 후 cycle
- `calibrationFactor`: `cycles / rawCycles`

## 권장 실험 전략

처음부터 모든 조합을 무작정 돌리기보다 다음 순서가 효율적이다.

1. 각 array/dataflow별 top-k 후보만 먼저 실행한다.
2. 오차가 큰 영역의 shape와 tile을 추가로 oversampling한다.
3. validation P90 오차가 큰 경우 `shape-limit`, `arrays`, `sram-kb`, `topk`를 늘린다.
4. SCALE-Sim 버전, layout 정책, SRAM/DRAM bandwidth 정책이 바뀌면 모델을 새로 학습한다.

## 주의점

학습 모델은 SCALE-Sim 결과를 맞추는 보정기다. 따라서 SCALE-Sim 설정이 실제 하드웨어 가정과 다르면 learned estimator도 같은 방향으로 편향된다. 최종 논문/보고서에는 학습 데이터 범위, validation split, MAPE/RMSE, P90/P95 오차를 함께 제시하는 것이 좋다.

## Tree residual과 Neural residual 비교

딥러닝 방식이 실제로 더 좋은지 확인하기 위해 같은 CSV에서 두 모델을 동시에 학습/평가할 수 있다.

```bash
npm run estimator:compare -- \
  --input profiles/estimator-lab/results.csv \
  --out-dir profiles/estimator-lab \
  --trees 128 \
  --max-depth 10 \
  --hidden 16 \
  --epochs 700
```

생성물:

- `profiles/estimator-lab/tree-residual-model.json`
- `profiles/estimator-lab/neural-residual-model.json`
- `profiles/estimator-lab/estimator-comparison-report.md`
- `profiles/estimator-lab/estimator-comparison-predictions.csv`

비교 기준은 평균 오차만 보지 않고 P90 tail error도 함께 반영한다. 평균 MAPE만 낮고 일부 shape에서 크게 틀리는 모델은 estimator로 쓰기 위험하기 때문이다.

## Neural residual estimator 단독 학습

```bash
npm run estimator:train-neural -- \
  --input profiles/estimator-lab/results.csv \
  --out profiles/neural-residual-estimator-model.json \
  --report profiles/neural-residual-estimator-report.md \
  --hidden 16 \
  --epochs 700 \
  --learning-rate 0.015
```

평가:

```bash
npm run estimator:evaluate-neural -- \
  --input profiles/estimator-lab/results.csv \
  --model profiles/neural-residual-estimator-model.json \
  --predictions \
  --out profiles/estimator-lab/neural-predictions.csv
```

## 언제 어떤 모델을 쓸까?

| 상황 | 추천 |
|---|---|
| 샘플이 수백~수천 개 | Tree residual 기본값 |
| workload가 GEMM 일부 형태에 치우침 | Tree residual 기본값 |
| 수만 개 이상 SCALE-Sim 결과가 있음 | Neural residual도 비교 |
| 모델 전체 graph 단위 예측이 필요함 | 이후 GNN/Transformer 계열 별도 연구 |
| 논문/보고서에서 설명 가능성이 중요함 | Tree residual 또는 tree+neural 비교표 |

현재 TileForge 단계에서는 tree residual을 기본 estimator로 쓰고, neural residual은 비교 실험 및 확장 가능성 제시용으로 두는 구성이 가장 안전하다.
