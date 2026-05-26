# v13 Workbench State Hardening

This patch continues the purpose-aligned hardening work by reducing the remaining client-side orchestration risk.

## Why this change exists

TileForge's final workflow is:

1. fast analytical estimate,
2. hardware-design decision support,
3. tiling-strategy narrowing,
4. IREE compiler-option candidate generation,
5. SCALE-Sim/IREE runtime validation before promotion.

The core estimator had already been split into analytical, suite stacking/calibration, purpose gates, and external validation. The remaining weakness was that the main workbench page still owned too much UI and job state, which made it easy for report selection, job polling, live logs, and status refresh behavior to drift from the prediction contract.

## Changes

- Added `src/components/workbench/useWorkbenchJobs.ts`.
  - Owns job list polling.
  - Owns system-status refresh.
  - Owns report auto-follow/manual-selection behavior.
  - Owns selected job confidence parsing.
  - Owns live job event wiring through `useLiveJobEvents`.
  - Owns delete/cancel/watch/bulk job actions.
  - Owns queue creation across selected dataflows.

- Split Estimator Suite UI sections:
  - `EstimatorSuitePresetPanel.tsx`
  - `EstimatorSuiteModelPanel.tsx`

## Effect

The workbench page is now closer to a composition layer:

- input state,
- preview estimate,
- derived confidence/uncertainty,
- high-level panels.

Job operations no longer live inline with hardware/workload input logic. This makes it safer to continue adding validation behavior without accidentally changing estimate semantics.

## Remaining known limitations

`InputSettingsPanel.tsx` and the remaining body of `EstimatorSuitePanel.tsx` are still large. They are now less risky than before because job lifecycle state has been extracted, but future work should continue splitting:

- `EstimatorSamplingPlanPanel.tsx`,
- `EstimatorDatasetPanel.tsx`,
- `EstimatorTrainingOptionsPanel.tsx`,
- `useWorkbenchPresets.ts`,
- `useWorkbenchProject.ts`.
