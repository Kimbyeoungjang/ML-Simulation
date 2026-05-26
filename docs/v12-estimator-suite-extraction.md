# v12 Estimator Suite extraction

This hardening step focuses on the last large estimator-side risk: `src/lib/estimatorSuite.ts` had become a trainer, stacker, OOF residual calibrator, domain guard, and exported API at the same time.  That made the learned estimator difficult to audit when TileForge is used for hardware design, tiling strategy selection, and IREE option exploration.

## New module boundaries

- `src/lib/estimatorSuite.ts` now stays closer to the high-level API: train, predict, evaluate, summarize.
- `src/lib/estimatorSuiteStacking.ts` owns ensemble math: log-space prediction, metric scoring, static weights, adaptive domain weights, and analytical baseline metrics.
- `src/lib/estimatorSuiteCalibration.ts` owns post-stack cycle calibration: OOF bucket residuals, scale trend, resource-pressure trend, tiling-geometry trend, and local KNN residual correction.

## Why this matters

The Estimator Suite is allowed to improve quick estimates, but it must not hide the difference between:

1. fast analytical estimate,
2. learned ensemble correction,
3. post-stack calibration,
4. purpose-gate promotion after SCALE-Sim/IREE validation.

Separating stacking from calibration makes it easier to inspect where a cycle value changed.  If a prediction is wrong, the failure can now be isolated to base analytical input, ensemble weighting, calibration bias, or out-of-domain guard behavior.

## Regression coverage

`tests/estimatorSuiteStackingCalibration.test.ts` checks that the extracted stacker still improves a biased analytical baseline and that OOF calibration can be built and queried independently from the main trainer.
