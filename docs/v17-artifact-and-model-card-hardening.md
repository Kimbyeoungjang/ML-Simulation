# v17 Artifact and Model-Card Hardening

This hardening pass addresses the remaining trust and usability issues around TileForge artifacts and the full-layer analytical model.

## Why

TileForge intentionally produces several different classes of outputs:

- fast preview estimates,
- hardware-design full-layer cycle estimates,
- tile-policy ranking metrics,
- IREE compiler hint candidates,
- SCALE-Sim/IREE validation artifacts,
- raw reproducibility files.

Those artifacts are useful, but without a clear reading order users can easily treat every file as having the same level of proof. That is incorrect. In particular, `tilePolicyCycles` is not full-layer latency, and IREE compile success is not runtime performance validation.

The full-layer model also uses calibrated spill heuristics. Those constants must be visible and documented, not hidden inside the estimator implementation.

## Changes

### Artifact guide

Each job now emits:

- `artifact_guide.md`
- `artifact_guide.json`

The guide groups artifacts by purpose:

- `start-here`
- `hardware-design`
- `tiling-strategy`
- `iree-options`
- `external-validation`
- `model-trust`
- `raw-export`
- `debug`

It also repeats the most important safety rules:

- use `fullLayerCycles` for hardware-design comparison,
- use `tilePolicyCycles` and `score` for tiling strategy ranking,
- do not promote IREE hints without runtime A-B benchmark evidence,
- use `purpose_gate.md` before treating an estimate as design guidance.

### Full-layer model card

Each job now emits:

- `full_layer_model_card.md`
- `full_layer_model_card.json`

The model card records:

- target and non-goals of the full-layer model,
- WS/OS/IS primary equations,
- spill calibration constants,
- current run summary,
- lowest-confidence operations,
- out-of-scope warnings,
- promotion path from estimate to external validation.

### Calibration constants moved to a model-card module

The spill constants now live in `src/lib/fullLayerModelCard.ts`, and `fullLayerEstimator.ts` imports them from there. This makes calibration provenance part of the public estimator contract rather than an implementation detail.

## Result

This pass does not make the estimator magically more accurate. It makes the system more honest and easier to use:

1. users know which artifact to open first,
2. users can see why full-layer estimates are approximate,
3. calibration constants are explicit,
4. the path from quick estimate to external validation is visible in every job artifact directory.
