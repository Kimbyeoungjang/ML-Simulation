# v21 Validation Plan Hardening

TileForge v17 could report risky predictions through `prediction_risk_register.md`, but that still left a manual gap: users had to decide which SCALE-Sim/IREE validation to run first. v21 adds an explicit validation queue.

## New artifacts

- `validation_plan.md`
- `validation_plan.json`

The plan converts prediction risk and purpose gate status into actionable tasks:

| task kind | meaning | target scope |
|---|---|---|
| `scalesim-full-layer` | validate full-layer cycles for hardware design | `full-layer` |
| `scalesim-top-k` | validate tile-policy ranking/regret | `tile-policy` |
| `iree-runtime-benchmark` | compare baseline vs hinted VMFB runtime | `iree-runtime` |
| `environment-doctor` | fix external tool environment before trusting validation | `environment` |
| `estimator-suite-feedback` | route validated evidence into scoped training data | `model-feedback` |

## Why this matters

The validation plan prevents three common mistakes:

1. Treating every high-risk warning as equally urgent.
2. Mixing full-layer SCALE-Sim evidence with tile-policy top-k diagnostics.
3. Promoting IREE compiler hints after compile success without runtime evidence.

## Interpretation rule

Use the queue in this order:

1. Run any `environment-doctor` task first.
2. Run high-priority `scalesim-full-layer` tasks before using results for hardware design.
3. Run `scalesim-top-k` tasks before treating tile ranking as stable.
4. Run `iree-runtime-benchmark` with correctness checking before promoting compiler hints.
5. Use `estimator-suite-feedback` only after reading `validation_feedback_policy.md`.

## Trust boundary

`validation_plan.md` is an action plan, not measurement evidence. The evidence is created only after the listed SCALE-Sim/IREE tasks are actually executed.
