# v22 Prediction Risk and Environment Hardening

This patch addresses two remaining trust gaps:

1. A full-layer estimate could still look numerically confident even when one or more ops are outside the stable region of the analytical model.
2. External validation could fail because of OS/path/tool configuration issues, but the job artifacts did not expose enough environment context to debug the failure quickly.

## Prediction Risk Register

New artifacts:

- `prediction_risk_register.md`
- `prediction_risk_register.json`

The risk register is not a new estimator. It is a triage layer that records which ops should be validated first with SCALE-Sim.

Per-op risks include:

- `low-confidence`
- `array-underfill`
- `high-padding`
- `tile-sram-pressure`
- `full-layer-working-set-spill`
- `bandwidth-sensitive`
- `long-reduction`
- `estimator-suite-domain`

The register lists high-risk ops and recommended SCALE-Sim validation samples. `purpose_gate.md` now receives this risk register and prevents hardware-design from being promoted too aggressively when the run has extreme unvalidated risk.

## External Environment Report

New artifacts:

- `external_environment.md`
- `external_environment.json`

The environment report records:

- Node/platform/architecture information
- configured SCALE-Sim/IREE commands
- resolved fallback command candidates
- observed tool versions when available
- environment-specific risk notes
- next actions for reproducible validation

This does not prove that external validation is correct. It makes the validation environment auditable and easier to debug.

## Artifact Guide updates

`artifact_guide.md` now directs users to:

- `prediction_risk_register.md` when deciding which ops need SCALE-Sim first
- `external_environment.md` when external validation behaves differently across machines

## Safety rule

A high confidence score is not enough. For hardware-design decisions, check:

1. `purpose_gate.md`
2. `prediction_risk_register.md`
3. `full_layer_model_card.md`
4. `external_validation_report.md`
5. `validation_evidence.md`

The estimate is still a fast design-space narrowing tool, not a cycle-accurate simulator.
