# TileForge Estimator Suite

`estimator:suite`는 수만 개 SCALE-Sim/IREE 시뮬레이션 결과를 사용할 때를 위한 고정밀 estimator 학습 파이프라인이다. 기존 analytical estimator를 baseline으로 두고, Tree residual 모델과 Neural residual 모델이 각각 `log(measuredCycles / estimatorCycles)`를 학습한 뒤, holdout validation 성능을 기준으로 ensemble weight를 정한다.

## 왜 residual을 학습하는가?

Cycle을 직접 예측하면 workload 크기와 tile 크기 때문에 target scale이 지나치게 커진다. 대신 다음 값을 학습한다.

```text
residual = log(measuredCycles / estimatorCycles)
correctedCycles = estimatorCycles * exp(residual)
```

이 방식은 기존 analytical estimator의 물리적 의미를 유지하면서, SCALE-Sim 결과에서 드러나는 SRAM pressure, padding, dataflow, array shape별 오차 패턴만 학습한다.

## 전체 흐름

```bash
npm run estimator:design -- \
  --out profiles/estimator-lab/design.csv \
  --arrays 32x32,64x64,128x128,256x256 \
  --sram-kb 2048,4096,8192,16384 \
  --dataflows WS,OS,IS \
  --shape-limit 1000 \
  --topk 8
```

`design.csv`의 각 행을 SCALE-Sim/IREE로 실행한 뒤 `measuredCycles`를 채운다.

```bash
npm run estimator:suite -- \
  --input profiles/estimator-lab/results.csv \
  --out-dir profiles/estimator-lab \
  --trees 160 \
  --max-depth 10 \
  --hidden 64 \
  --epochs 900 \
  --splits random,workload,array,dataflow,large-shape
```

## 생성 파일

```text
profiles/estimator-lab/estimator-suite-model.json
profiles/estimator-lab/suite-tree-residual-model.json
profiles/estimator-lab/suite-neural-residual-model.json
profiles/estimator-lab/estimator-suite-report.md
profiles/estimator-lab/estimator-suite-validation.csv
profiles/estimator-lab/estimator-suite-predictions.csv
```

## 검증 split

| Split | 의미 |
|---|---|
| `random` | 전체 fitting 성능 확인 |
| `workload` | 보지 못한 workload/layer에 대한 일반화 확인 |
| `array` | 보지 못한 systolic array shape 일반화 확인 |
| `dataflow` | 보지 못한 WS/OS/IS dataflow 일반화 확인 |
| `large-shape` | 작은 shape로 학습 후 큰 shape extrapolation 확인 |

논문/보고서에는 random split만 제시하지 말고, workload/array/dataflow/large-shape holdout을 함께 제시하는 편이 좋다. random split만 좋으면 단순 interpolation일 수 있고, holdout split에서도 좋아야 실제 estimator로 신뢰할 수 있다.

## 권장 모델 선택 기준

- 데이터가 수천 개 이하이면 `tree-residual`이 기본값으로 안정적이다.
- 데이터가 수만 개 이상이고 workload 종류가 다양하면 `neural-residual`이 충분히 경쟁 가능하다.
- 실제 사용에서는 `ensemble`을 기본 후보로 두고, validation report에서 MAPE/P90이 더 나쁜 경우 Tree 또는 Neural 단독으로 바꾸는 방식을 권장한다.

## 수만 개 데이터용 권장 설정

```bash
npm run estimator:suite -- \
  --input profiles/estimator-lab/results.csv \
  --out-dir profiles/estimator-lab \
  --trees 240 \
  --max-depth 12 \
  --min-leaf 8 \
  --hidden 128 \
  --epochs 1200 \
  --learning-rate 0.008 \
  --max-split-train 30000
```

`--max-split-train`은 holdout validation을 여러 번 돌릴 때 학습 비용이 너무 커지는 것을 막기 위한 제한이다. 최종 모델은 전체 데이터를 사용해서 다시 학습된다.
