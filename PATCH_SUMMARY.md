# Patch summary: v19 validation runbook and artifact-safe external commands

## Main changes

- Added `validation_runbook.md/json` artifacts.
- Added `src/lib/validationRunbook.ts` and `npm run validation:plan`.
- Converted validation plan tasks into concrete commands for:
  - full-layer SCALE-Sim validation
  - top-k tile-policy SCALE-Sim regret checks
  - IREE runtime A/B benchmark
  - environment doctor checks
  - Estimator Suite feedback review
- Hardened `run:scalesim` and `run:iree` so existing job artifacts are not silently overwritten by demo artifact generation.
- Added `run:scalesim --top-k` for top-k tile-policy diagnostics.
- Updated artifact guide and validation plan text to point users to the runbook.

## Tests run

- `npm run typecheck`
- `npm run smoke`
- `npm run test:unit`
- `npm run validate:external:mock`

Actual SCALE-Sim/IREE binaries were not executed in this environment; mock external validation was used.

## v20 / v23 validation execution hardening

- Added guarded `validation:execute` CLI.
- Added `validation_execution_report.md/json` to distinguish dry-run planning from actual validation execution.
- External SCALE-Sim/IREE commands are blocked unless both `--execute` and `--allow-external` are provided.
- Added unit coverage for dry-run, kind filtering, external-run safety, and markdown output.
