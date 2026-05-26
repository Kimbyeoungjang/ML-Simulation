# Estimator Suite readiness gates

TileForge uses the Estimator Suite as a correction layer on top of the fast analytical estimate.  A low validation MAPE is not enough by itself: the dataset must also be wide enough for the decision being made.

This document defines the deployment gates added to the scoped Estimator Suite pipeline.

## Why this exists

The project has three different downstream decisions:

1. hardware design comparison,
2. tiling strategy selection,
3. IREE lowering-hint benchmarking.

These decisions tolerate different risks.  A small local calibration set can be useful for one known accelerator and one workload, but it should not silently drive hardware search or dataflow comparison.  The readiness report prevents that by labeling a dataset/model as `ready`, `caution`, or `blocked`.

## Generated artifacts

The scoped training pipeline now emits readiness artifacts next to each dataset and trained scope:

```text
datasets/merged/readiness.md
datasets/merged/readiness.json
datasets/full-layer/readiness.md
datasets/full-layer/readiness.json
datasets/tile-policy/readiness.md
datasets/tile-policy/readiness.json
estimator-suite/full-layer/readiness.md
estimator-suite/full-layer/readiness.json
estimator-suite/tile-policy/readiness.md
estimator-suite/tile-policy/readiness.json
```

`datasets/*/readiness.*` evaluates whether the dataset is suitable for training.  `estimator-suite/*/readiness.*` additionally includes held-out model error when a model was trained.

## Gates

| Gate | Purpose |
|---|---|
| `sample-count` | Blocks tiny datasets and warns when the training set is below the deployment recommendation. |
| `target-scope-contract` | Requires explicit `targetScope=full-layer` or `targetScope=tile-policy`. |
| `scope-homogeneity` | Prevents full-layer and tile-policy targets from being trained as one deployed model. |
| `hardware-coverage` | Warns when array coverage is too narrow for hardware design ranking. |
| `dataflow-coverage` | Warns when WS/OS/IS comparison would be extrapolation. |
| `workload-diversity` | Warns when the model is only a calibration set for one workload family. |
| `heldout-error` | Compares learned MAPE/P90 against the analytical baseline when a model is present. |

## How to interpret the levels

- `ready`: usable as a default correction layer for the same decision type.
- `caution`: usable, but the UI/report should keep the analytical baseline visible and require SCALE-Sim/IREE validation for top candidates.
- `blocked`: do not deploy this model for automatic ranking; collect more explicit samples or split the target scope.

## Practical rule

For the final TileForge workflow, prefer this policy:

```text
hardware design: full-layer readiness should be ready or caution with external validation required
tile strategy: tile-policy readiness can be caution if the current workload is close to the calibration set
IREE options: compiler hints are always benchmark candidates, never final flags
```
