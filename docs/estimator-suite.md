# Estimator Suite

Estimator Suite는 TileForge analytical estimator 위에 얹는 학습형 correction layer입니다. 목적은 estimator를 대체하는 것이 아니라, SCALE-Sim/job 결과가 축적될수록 특정 하드웨어/워크로드 영역에서 예측 편향을 줄이는 것입니다.

## 구성 요소

| 구성 | 역할 |
|---|---|
| Dataset builder | job artifact, CSV, design sweep에서 sample 생성 |
| Scope splitter | `full-layer`와 `tile-policy` target 분리 |
| Feature encoder | hardware/workload/dataflow/tile feature를 학습 가능한 벡터로 변환 |
| Tabular model | baseline correction model |
| Stacking/calibration | 여러 estimator/correction의 조합 |
| Neural residual model | 선택적 residual correction 실험 |
| Readiness gate | sample 수, coverage, validation error, scope homogeneity 검사 |
| Active model registry | UI/API estimate에 적용할 model 지정 |

## 기본 workflow

```text
full-pipeline jobs 완료
  ↓
collect-jobs
  ↓
dataset 생성
  ↓
split full-layer / tile-policy
  ↓
train + validation
  ↓
readiness report
  ↓
activate
  ↓
future estimate/design-space correction
```

## UI workflow

1. Estimator Suite 패널에서 completed job을 수집합니다.
2. dataset summary를 확인합니다.
3. `dataset-and-train` 또는 `scope-pipeline`을 실행합니다.
4. 생성된 `readiness.md`를 확인합니다.
5. `activate`로 active model을 지정합니다.
6. 메인 estimate와 design-space 그래프에서 confidence/correction 적용 여부를 확인합니다.

## CLI workflow

```bash
npm run estimator:design
npm run estimator:train
npm run estimator:evaluate
npm run estimator:compare
npm run estimator:suite
```

neural residual 실험:

```bash
npm run estimator:train-neural
npm run estimator:evaluate-neural
```

## Dataset columns

대표 column:

- `targetScope`
- `measuredSource`
- `model`
- `opName`
- `m`, `n`, `k`
- `arrayRows`, `arrayCols`
- `frequencyMHz`
- `sramKB`
- `dataflow`
- `tileM`, `tileN`, `tileK`
- `predictedCycles`
- `measuredCycles`
- `utilization`
- `paddingRatio`
- `sramBytes`
- `dramBytes`

## Readiness levels

| Level | 의미 | 권장 행동 |
|---|---|---|
| `ready` | sample 수, coverage, validation error가 사용 목적에 적합 | active model 적용 가능 |
| `caution` | 일부 coverage/error 문제가 있음 | report에 한계를 표시하고 중요한 후보는 재검증 |
| `blocked` | target 혼합, sample 부족, error 과다 등으로 위험 | active model 적용 금지 권장 |

## Active model 적용 위치

- `full-layer`: hardware-design cycle, validation comparison, design-space correction
- `tile-policy`: tile ranking, top-k candidate, tiling strategy
- confidence: out-of-domain 후보 penalty와 warning에 사용

## 좋은 dataset을 만드는 법

- WS/OS/IS를 골고루 포함합니다.
- 작은 GEMM과 큰 GEMM을 모두 포함합니다.
- array 32/64/128/256 등 주요 scale을 포함합니다.
- bandwidth/SRAM 조건을 최소 2~3단계 이상 포함합니다.
- 동일 조건 반복 sample로 noise를 확인합니다.
- full-layer와 tile-policy target이 섞이지 않도록 `targetScope`를 확인합니다.

## production 해석 원칙

Estimator Suite validation MAPE가 낮더라도 domain coverage가 좁으면 하드웨어 결론에는 조심스럽게 써야 합니다. 보고서에는 다음을 함께 적습니다.

- 학습 sample 수
- target scope
- validation error
- coverage/readiness level
- out-of-domain warning 여부
- SCALE-Sim으로 재검증한 대표 후보
