# Design-space Sweet Spot

Design-space 그래프는 현재 workload를 기준으로 하드웨어/워크로드 축을 sweep하면서 어느 지점이 성능, 비용, 안정성 측면에서 좋은지 찾는 도구입니다.

## Sweep 축

| 축 | 의미 | 비용 proxy |
|---|---|---|
| `array` | systolic array rows/cols scale | `factor^2` |
| `frequency` | clock/frequency scale | `factor^1.35` |
| `sram` | on-chip SRAM capacity scale | `factor^0.86` |
| `dram` | DRAM/global memory bandwidth scale | `factor^1.12` |
| `shape-m` | workload M scale | `1` |
| `shape-n` | workload N scale | `1` |
| `shape-k` | workload K scale | `1` |

하드웨어 축은 같은 workload를 유지하므로 cycle 감소를 직접 비교할 수 있습니다. workload 축은 연산량 자체가 바뀌므로 총 cycle 대신 `ops/cycle` 정규화를 사용합니다.

## 주요 지표

```text
ops = 2 × M × N × K
Norm speedup = (ops / cycles) / (baselineOps / baselineCycles)
TOPS = ops / seconds / 1e12
```

Score는 성능 향상, utilization, SRAM overflow, hardware cost를 함께 반영합니다.

```text
score = max(1e-9,
        normSpeedup / (1 + 0.42 × hardwareCostGrowth)
        + 0.08 × meanUtilization
        - 0.25 × sramOverflowRatio)
```

## Consensus + ROI

```text
Consensus = min(normSpeedupWithinAxis,
                normThroughputWithinAxis,
                normScoreWithinAxis)
ExpansionPenalty = 1 + 0.35 × max(0, cost - 1)
                   + 0.15 × max(0, workScale - 1)
ROI = Consensus / ExpansionPenalty
Recommendation = 0.68 × Consensus + 0.32 × ROI
```

Consensus가 높다는 것은 speedup, throughput, score가 동시에 좋은 지점이라는 뜻입니다. ROI는 하드웨어를 크게 키우는 것만으로 항상 좋아 보이는 문제를 완화합니다.

## Marginal knee

인접 sweep point 사이에서 marginal efficiency를 계산합니다.

```text
MarginalEfficiency = Δ(normSpeedup) / Δ(cost or workScale)
```

초기 marginal efficiency 대비 35% 이하로 내려가는 첫 지점을 knee로 표시합니다. 이 지점은 강제 최적값이 아니라 성능 증가가 둔화되는 위치입니다.

## Pareto 후보

어떤 후보가 다른 후보보다 다음 조건을 모두 만족하면서 하나 이상 더 좋으면 지배한다고 봅니다.

- speedup 높음
- throughput 높음
- score 높음
- cost 낮음

지배되지 않는 후보가 Pareto 후보입니다. Pareto 후보 수가 많으면 trade-off가 큰 탐색 공간이라는 뜻입니다.

## Uncertainty-aware recommendation

Estimator Suite active model이 있을 때 각 design point는 `predictionConfidence`를 가집니다. training domain 밖 후보는 다음 방식으로 보수적으로 처리됩니다.

```text
DesignUncertaintyPct = f(predictionConfidence,
                         lowUtilization,
                         sramOverflow,
                         hardware/workload expansion,
                         outOfDomain)
RiskAdjustedSpeedup = NormSpeedup / (1 + DesignUncertaintyPct / 100)
RiskAdjustedRecommendation = Recommendation × uncertaintyPenalty
```

UI는 원래 recommendation과 risk-adjusted recommendation을 함께 보여줍니다.

## Effective factor

작은 array나 odd M/N/K에서는 요청 factor와 실제 정수 rounding 후 factor가 다를 수 있습니다. TileForge는 그래프에 실제 rounded ratio인 effective factor를 표시하고, rounding으로 중복되는 point는 제거합니다.

## Baseline normalization

Estimator Suite가 active이면 baseline도 같은 correction path로 다시 평가합니다. 이렇게 해야 `×1` baseline이 항상 `1.0×` 근처에 유지되고, analytical baseline과 learned sweep이 섞이는 bias를 줄일 수 있습니다.

## 사용 팁

- hardware decision은 `risk-adjusted recommendation`과 SCALE-Sim 재검증 후보를 함께 보세요.
- workload scale 비교에서는 total cycle만 보지 말고 `Norm speedup`을 보세요.
- out-of-domain `*` 표시가 많은 sweep은 학습 dataset을 확장한 뒤 다시 보세요.
- 최종 발표에서는 sweet spot 후보 1개와 Pareto 후보 몇 개를 함께 제시하면 설계 trade-off 설명이 쉬워집니다.

## 관련 테스트

```bash
npm run test:unit -- tests/designSpace.test.ts
```

전체 확인:

```bash
npm run test:all
```
