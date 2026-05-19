# Design-space sweet spot 그래프

그래프 탭의 `Design-space sweet spot` 모드는 현재 요청을 baseline으로 두고 하드웨어와 workload 축을 빠르게 sweep한다. 활성 Estimator Suite 모델이 있으면 각 sweep point의 analytical 결과를 ensemble 모델로 보정한 뒤 그래프를 만든다.

## Sweep 축

| 축 | 의미 | 비용 proxy |
|---|---|---|
| `array` | TPU/systolic array row/col 동시 스케일 | `factor^2` |
| `frequency` | clock/frequency 스케일 | `factor^1.35` |
| `sram` | on-chip SRAM capacity 스케일 | `factor^0.86` |
| `dram` | DRAM/global memory bandwidth 스케일 | `factor^1.12` |
| `shape-m/n/k` | 고정 하드웨어에서 workload M/N/K 스케일 | `1` |

하드웨어 축은 같은 workload를 유지하므로 cycle 감소를 직접 비교해도 된다. 반면 M/N/K 축은 연산량 자체가 바뀌기 때문에 총 cycle만 비교하면 작은 workload가 무조건 좋아 보인다. 그래서 workload 축은 `ops/cycle` 기준으로 정규화한다.

## 주요 지표

```text
ops = 2 * M * N * K
Norm speedup = (ops / cycles) / (baselineOps / baselineCycles)
TOPS = ops / seconds / 1e12
score = max(1e-9,
        normSpeedup / (1 + 0.42 * hardwareCostGrowth)
        + 0.08 * meanUtilization
        - 0.25 * sramOverflowRatio)
```

`score`는 SRAM overflow penalty가 매우 큰 비정상 후보에서도 0 이하로 내려가지 않게 floor를 둔다. 이렇게 하면 SVG 정규화와 Pareto 계산이 항상 안정적으로 동작한다.

`cycleSpeedup = baselineCycles / cycles`도 내부적으로 유지하지만, workload scale이 1이 아닐 때는 주 지표로 쓰지 않는다.

## Consensus + ROI sweet spot

각 축에서 speedup, throughput, score를 각각 0~1로 정규화한 뒤 다음 값을 계산한다.

```text
Consensus = min(normSpeedupWithinAxis, normThroughputWithinAxis, normScoreWithinAxis)
ExpansionPenalty = 1 + 0.35 * max(0, cost - 1) + 0.15 * max(0, workScale - 1)
ROI = Consensus / ExpansionPenalty
Recommendation = 0.68 * Consensus + 0.32 * ROI
```

따라서 consensus가 높다는 것은 한 지점이 단일 지표만 좋은 것이 아니라, 성능 향상·처리량·비용 보정 점수가 동시에 높은 위치라는 뜻이다. 다만 하드웨어를 크게 키우면 대부분의 성능 지표가 계속 증가할 수 있으므로, 최종 추천은 ROI를 함께 고려한다. SVG의 초록 점선은 각 축에서 `Recommendation`이 가장 높은 후보를 표시한다.

## Marginal knee

각 축의 인접 sweep point 사이에서 다음 값을 계산한다.

```text
MarginalEfficiency = Δ(normSpeedup) / Δ(cost or workScale)
```

첫 양수 marginal efficiency 대비 35% 이하로 내려가는 첫 지점을 `knee`로 표시한다. 완만하게 둔화되어 고정 임계값을 지나지 않는 경우에는 정규화된 `cost/workScale`-`speedup` 곡선에서 시작점과 끝점을 잇는 직선 대비 가장 크게 위로 벗어나는 interior point를 fallback elbow로 표시한다. 이 값은 강제 최적값은 아니고, 성능 증가가 둔화되기 시작하는 위치를 빠르게 확인하기 위한 보조 신호다.

## Pareto 후보

`paretoDesignRows()`는 다음 조건을 기준으로 지배되지 않는 후보를 남긴다.

- speedup, throughput, score는 클수록 좋다.
- cost는 작을수록 좋다.
- 어떤 후보가 위 조건을 모두 만족하면서 하나 이상 더 좋으면 다른 후보를 지배한다.

UI 요약 카드의 `Pareto 후보` 수는 탐색 공간이 얼마나 trade-off가 큰지 빠르게 확인하는 용도다.

## 테스트

관련 테스트는 `tests/designSpace.test.ts`에 있다.

```bash
npm run typecheck
npm run test:unit
```

현재 테스트는 다음을 검증한다.

1. UI와 분리된 design-space row 생성
2. workload sweep에서 총 cycle 대신 ops/cycle 정규화 사용
3. Pareto 후보 계산
4. SVG에 consensus + ROI sweet spot marker 출력
5. ROI-aware recommendation score와 marginal knee 필드 출력
6. SRAM overflow가 큰 후보에서도 score가 finite/positive인지 확인
7. SVG 범례와 실제 knee marker 렌더링 확인

## 성능 메모

Design-space 그래프는 수치 요약만 필요하므로 `estimateAll(..., { includeArtifacts: false })`로 MLIR/report artifact 생성을 건너뛴다. 또한 sweep cache key에서 shape id를 제외해 같은 M/N/K/하드웨어 조합을 여러 축에서 다시 평가하지 않는다. `factor=1` workload baseline은 shape id를 새로 만들지 않아 M/N/K baseline 평가가 캐시에 재사용된다.

## Prediction confidence guard

When an Estimator Suite model is active, every design-space point now carries a `predictionConfidence` value from the learned model domain guard. Points outside the training domain are still plotted, but their ROI and final recommendation score are damped. This prevents extrapolated options such as unseen TPU array sizes, dataflows, or workload scales from being recommended only because their learned prediction is optimistic. Analytical-only sweeps use 100% confidence.

The UI exposes this as a `Prediction confidence` summary card and a `Conf.` column in the axis table. Rows marked with `*` are outside the learned training domain and should be validated with SCALE-Sim before treating them as final hardware choices.


## Adaptive refinement and effective factors

The first implementation used only a small fixed factor set such as `0.5, 0.75, 1, 1.25, ...`. That made the graph fast, but it could miss the actual knee between two coarse points. The sweep now adds geometric midpoints between neighboring seed factors. For example, the interval from `1` to `1.25` also evaluates approximately `1.12`. This gives the sweet-spot and marginal-knee detectors a denser curve without turning the UI into an exhaustive search.

Rounded hardware and workload dimensions are reported with their **effective factor** rather than the requested factor. For example, if a shape dimension cannot become exactly `0.5x` after integer rounding, the graph uses the actual rounded ratio. Duplicate points produced by rounding are removed per axis before recommendation scores are attached. This keeps SVG paths and axis tables stable on very small arrays, SRAM sizes, or odd M/N/K dimensions.

## Baseline normalization with active Estimator Suite

When an Estimator Suite is active, the sweep baseline is now re-evaluated through the same `estimateAll → applyEstimatorSuiteToSearchResponse` path as every other sweep point. Earlier versions normalized speedup against the raw source summary, which could be analytical while the sweep rows were ensemble-adjusted. That mismatch made the `×1` baseline row drift away from `1.0×` speedup and biased consensus/ROI scores. The baseline is still cached, so this correctness fix does not add repeated estimator work.

## Uncertainty-aware recommendation and active validation

The design-space ranking now keeps three related scores instead of a single point estimate.

```text
DesignUncertaintyPct = f(predictionConfidence,
                         lowUtilization,
                         sramOverflow,
                         hardware/workload expansion,
                         out-of-domain flag)
RiskAdjustedSpeedup = NormSpeedup / (1 + DesignUncertaintyPct / 100)
RiskAdjustedRecommendation = Recommendation * uncertaintyPenalty
```

This is intentionally conservative. If two candidates have similar predicted performance, the UI can now prefer the candidate whose prediction is more stable and better covered by the Estimator Suite training domain. The summary cards show both the original consensus/ROI recommendation and the risk-adjusted recommendation, so aggressive and conservative choices can be compared side by side.

The same uncertainty signal is also used for an active-learning style validation queue:

```text
ValidationPriority = uncertainty
                   + recommendation potential
                   + out-of-domain penalty
                   + SRAM overflow risk
                   + marginal-knee bonus
```

The `다음 SCALE-Sim 검증 추천 후보` table lists the points that are most useful to validate next. In practice, running SCALE-Sim on the top few rows and adding those measurements to the training CSV should improve the estimator faster than validating random sweep points, because the selected points are near interesting trade-offs or weakly covered regions of the model domain.

## Diverse validation batch selection

The active-validation queue now uses a diversified greedy selector instead of a plain top-`k` sort. The scoring still starts from `ValidationPriority`, but it also gives small bonuses to Pareto candidates and marginal-knee points because those rows are most likely to change the final design recommendation after SCALE-Sim validation.

The selector then chooses at most one high-value candidate per axis in the first pass before filling any remaining slots. This prevents a validation batch from being dominated by several nearly identical array or SRAM points. A second pass avoids geometrically adjacent duplicates on the same axis when alternatives exist, and a final fallback fills the requested limit if the design space is too small.

The SVG marks these next-validation candidates with purple triangles, while the orange diamonds remain marginal-knee markers. A good workflow is now:

```text
1. Inspect the risk-adjusted sweet spot.
2. Run SCALE-Sim for the purple validation candidates.
3. Add the measured rows to the Estimator Suite training CSV.
4. Retrain and regenerate the design-space graph.
```

This keeps the validation budget spread across array, clock, memory, and workload-scaling uncertainties instead of overfitting the next calibration step to a single sweep axis.

## Validation-plan CSV export

The active-validation table can now be exported as `design-space-validation-plan.csv`. The export includes the diversified rank, axis, effective factor, normalized `selectionScore`, uncertainty, confidence, risk-adjusted speedup, SRAM overflow ratio, and utilization. This makes the next SCALE-Sim batch reproducible: save the CSV, run the listed candidates externally, append the measured rows to the Estimator Suite training data, and retrain.

`selectionScore` is normalized to `[0, 1]` before ranking. Earlier ranking logic mixed `validationPriority` with an unbounded recommendation value, which could overemphasize one score term after future tuning. The normalized score keeps active-learning batches stable while preserving the Pareto, knee, out-of-domain, and risk-adjusted recommendation bonuses.

## Validation-plan JSON and rationale

The validation plan is now available in both CSV and JSON. The JSON export is intended for scripts that automatically launch the next SCALE-Sim batch, while the CSV remains convenient for manual inspection. Each row includes a short `rationale` field such as `high uncertainty`, `low domain confidence`, `near marginal knee`, or `SRAM pressure`.

This small explanation layer is useful for experiment tracking: when a candidate is later added to the training set, the report can show why it was selected rather than only its rank. It also helps detect bad active-learning batches quickly. For example, if every candidate is selected only for low utilization, the sweep probably needs broader memory or array coverage before retraining.
