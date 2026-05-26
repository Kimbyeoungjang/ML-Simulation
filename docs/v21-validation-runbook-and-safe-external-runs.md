# v21 validation runbook and safe external runs

This hardening step connects the validation plan to concrete, artifact-safe commands.

## Problem

`validation_plan.md/json` identified what should be verified next, but the user still had to translate tasks into CLI commands. Worse, `run:scalesim` and `run:iree` generated demo artifacts unconditionally, so running a validation command against an existing job directory could silently overwrite the artifact the user meant to verify.

## Changes

- Added `src/lib/validationRunbook.ts`.
  - Converts validation tasks into command lines.
  - Separates direct external runs from manual-review steps.
  - Keeps safety notes for full-layer vs tile-policy evidence.
- Added `scripts/validation-plan.ts` and `npm run validation:plan`.
  - Reads `validation_plan.json` from a job artifact directory.
  - Writes `validation_runbook.md/json`.
- Job artifacts now include:
  - `validation_runbook.md`
  - `validation_runbook.json`
- `run:scalesim` and `run:iree` no longer overwrite existing artifacts just because they are executed.
  - Existing required input files are preserved.
  - Demo artifacts are generated only when inputs are missing or `--demo` is explicitly passed.
  - `--no-demo` fails fast if required inputs are missing.
- `run:scalesim --top-k` uses `topology_top3.csv/layout_top3.csv` for tile-policy regret checks.

## Recommended flow

```bash
npm run validation:plan -- --artifact .tileforge/jobs/<job-id>
cat .tileforge/jobs/<job-id>/validation_runbook.md
```

Then run the highest-priority command from the runbook.

For full-layer validation:

```bash
npm run run:scalesim -- --artifact .tileforge/jobs/<job-id> --require-external --no-demo
```

For top-k tile-policy validation:

```bash
npm run run:scalesim -- --artifact .tileforge/jobs/<job-id> --top-k --require-external --no-demo
```

For IREE runtime A/B validation:

```bash
npm run benchmark:iree -- --artifact .tileforge/jobs/<job-id> --repetitions=5 --min-time-sec=0.05 --correctness-checked
```

## Safety rule

Full-layer SCALE-Sim evidence may be promoted into full-layer Estimator Suite feedback. Top-k SCALE-Sim evidence is ranking/regret diagnostic data and must not be mixed into full-layer latency targets.
