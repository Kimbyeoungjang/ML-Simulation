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

## v14 prediction-quality updates

The Estimator Suite prediction path now uses a holdout-tuned stacked ensemble instead of only static inverse-error weights.

- **Log-space geometric blending** combines analytical, tree residual, neural residual, and direct-neural predictions in log-cycle space. This usually reduces relative-error bias when SCALE-Sim ratios span multiple orders of magnitude.
- **Split-level weight search** optimizes ensemble weights on validation splits with a MAPE + P90 + RMSE score, so the selected blend is less sensitive to one lucky model on random validation.
- **Final blend stabilization** averages split-optimized weights with metric-derived weights and a final train-domain optimization pass. This keeps the model robust on small datasets while still using measured performance when enough samples exist.
- **Domain guard** records the training domain and damps learned predictions toward the analytical baseline for unseen array sizes, dataflows, or out-of-range M/N/K/tile/SRAM/frequency values.

## v15 prediction-calibration updates

The suite now adds a post-stack **out-of-fold log-residual calibration** layer. During the split validation loop, TileForge stores predictions for samples that were not used to train that split model. It then estimates robust median corrections for the global dataset and for dataflow / array / dataflow-array buckets. At inference time, the selected correction is applied multiplicatively in log-cycle space before the domain guard.

This improves accuracy when SCALE-Sim has a systematic offset that the individual residual models do not fully remove, for example OS dataflow being consistently slower than WS, or one TPU array size having a stable ratio difference. Bucket corrections are smoothed toward the global median and clamped, so small or noisy buckets cannot dominate the prediction. The web Estimator Suite panel and generated report show the calibration mode, global correction, bucket count, and clamp.

## v17 prediction-scale trend calibration

OOF residuals can drift with the predicted cycle scale. In practice, small GEMMs may be dominated by launch, padding, or tiling overhead, while large GEMMs may be dominated by SRAM/DRAM pressure. A single global or bucket median cannot fully correct that smooth size-dependent bias.

The suite now fits a guarded log-residual trend against `log(predicted cycles)` from out-of-fold predictions. The trend is centered around the OOF mean, slope-clamped, and validation-gated over several blend strengths. At inference time the selected trend is added before local KNN blending and then clamped by the same robust residual bound. This improves calibration when SCALE-Sim/measurement ratios change systematically from small to large workloads without letting an unstable slope dominate.

The Estimator Suite panel and generated report now show whether trend calibration is active, its blend, and its slope.

## v16 local residual calibration

Bucket calibration is intentionally coarse. It cannot distinguish, for example, a 384×384×512 GEMM with a large `tileK` from a smaller GEMM that happens to use the same dataflow and array size. v16 therefore adds a local KNN-style residual calibration table built from the same out-of-fold residuals.

The local table stores a bounded number of normalized prototypes using workload size, tile size, array size, SRAM, clock, DRAM bandwidth, dtype, and derived operation/tile-coverage features. At prediction time, nearby prototypes produce a small log-residual correction that is blended with the safer bucket/global correction. The blend is distance- and support-weighted, then clamped by the same robust residual limit. This targets smooth local bias without allowing one noisy neighbor to dominate.

For best accuracy, include validation samples from the exact hardware region being optimized: array size, SRAM capacity, DRAM bandwidth, dataflow, and representative M/N/K ranges. Local calibration becomes more useful once the dataset has dozens to hundreds of samples around each region of interest.

## v18 resource-pressure trend calibration

The cycle calibration stack now includes a validation-gated **resource-pressure trend** learned from out-of-fold residuals.  The feature set is intentionally small and hardware-aware: SRAM tile pressure, arithmetic intensity, and effective bandwidth per MAC.  These terms target residual drift that is common in SCALE-Sim comparisons when a candidate is near an SRAM capacity boundary or when DRAM bandwidth changes faster than array compute throughput.

The correction is ridge-linear, coefficient-clamped, and selected only when the OOF validation score improves.  It is applied after global/dataflow/array buckets and prediction-size trend, then blended with local KNN residual calibration.  Reports and the Estimator Suite panel show `resource=<blend>` when this guard is active.

## v19 tiling-geometry trend calibration

The calibration stack now also checks for **tiling-geometry residual drift**.  Some SCALE-Sim discrepancies are not explained by array size, SRAM pressure, or DRAM bandwidth alone: they appear when M/N/K are not cleanly divisible by tile sizes, when many edge tiles are generated, or when the selected tile shape does not fit the systolic array geometry well.  These cases can produce stable measured/predicted cycle ratio changes even inside the same dataflow and hardware bucket.

v19 fits a small ridge-linear correction from out-of-fold residuals using four geometry-aware features: padding waste from ceil-div tiling, total tile-wave count, edge-tile ratio, and tile-to-array fit.  The correction is coefficient-clamped and selected through the same OOF validation gate as prediction-scale and resource-pressure trends, so it is only enabled when it improves held-out error.  It is applied before local KNN blending and is shown in reports and the Estimator Suite panel as `tiling=<blend>`.

For better accuracy around sweep sweet spots, include samples near tile-boundary cases as well as perfectly aligned M/N/K values.  This gives the geometry calibration enough information to distinguish a true hardware improvement from a cycle change caused by padding or edge-tile overhead.


## v20 domain-adaptive stacking

The suite now adds an optional **domain-adaptive stacking** layer before cycle calibration.  A single global ensemble weight can be too blunt when the best predictor changes by region: for example, the analytical baseline may be very accurate for one dataflow, while the tree residual or direct neural model may be better for another array/dataflow combination.

During split validation, TileForge reuses out-of-fold predictions to tune non-negative ensemble weights for dataflow, array, and dataflow-array buckets.  A bucket is kept only when it improves the OOF validation score over the global stack.  The selected local weights are then smoothed back toward the global weights with support-based shrinkage, so small buckets cannot overfit the final prediction.  At inference time the most specific available bucket weights are used first, then the usual OOF residual calibration, resource/tiling trends, local KNN residual correction, and domain guard are applied.

This tends to improve prediction accuracy when different hardware/dataflow regions have different error modes.  It is especially useful for mixed WS/OS/IS datasets, array-size sweeps, and datasets that combine small exploratory GEMMs with larger model-derived GEMMs.

## v21 bottleneck-regime calibration

The OOF residual bucket layer now includes **bottleneck-regime buckets** in addition to dataflow, array, and dataflow-array buckets.  The regime key is derived from the same hardware-aware features already used by the resource and tiling calibrators: SRAM tile pressure, effective bandwidth per MAC, tile-to-array fit, and padding waste.  Samples are grouped into coarse regimes such as `sram-spill`, `dram-bound`, `array-mismatch`, `edge-heavy`, and `compute-regular`.

This helps when two samples share the same dataflow or array size but fail for different reasons.  For example, an OS 64×64 run that is SRAM-spill limited should not necessarily reuse the same residual median as an OS 64×64 run that is compute-regular.  At prediction time TileForge prefers the most specific correction in this order: dataflow-array, dataflow-regime, dataflow, regime, array, and then global.  Bucket medians are still support-smoothed and clamped, so the regime layer cannot override the model unless enough OOF evidence exists.

Generated reports and the Estimator Suite panel now show the total calibration bucket count and how many of those buckets are regime-aware.  For best results, include a small number of SCALE-Sim samples around SRAM capacity boundaries, low-bandwidth DRAM settings, mismatched tile/array shapes, and aligned compute-regular cases.

## v22 regime-adaptive stacking

Domain-adaptive stacking now also considers the predicted bottleneck regime.  Earlier versions could choose different ensemble weights for dataflow, array, and dataflow-array buckets, but the same dataflow/array combination can behave very differently when it is SRAM-spill limited, DRAM-bound, edge-heavy, or compute-regular.

v22 extends the OOF weight search to `regime` and `dataflow-regime` buckets.  The same validation gate, minimum-sample check, and support-based shrinkage are used, so a regime-specific stack is kept only when holdout predictions show a real improvement over the global stack.  At inference time TileForge now chooses weights in this order: `dataflow-array → dataflow-regime → dataflow → regime → array → global`.

This improves prediction accuracy for hardware sweeps where increasing SRAM, DRAM bandwidth, or array size moves the same workload across bottleneck regimes.  In those cases, the best blend of analytical, tree residual, neural residual, and direct-neural predictors can change before the residual calibration layer is applied.
