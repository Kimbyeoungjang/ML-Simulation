# v14 Workbench Component Hardening

This hardening pass addresses the remaining UI-side structural risk after the earlier worker, estimator-suite, graph, and purpose-gate refactors.

## Problem

The workbench page still owned too many independent concerns:

- preview input state
- job/report/status polling
- live job streaming
- project save/load
- `.env` editing
- user presets
- estimator-suite model activation
- estimator-suite sampling and dataset actions

That made it too easy for the preview estimate, selected job report, active learned model, and persisted presets to drift out of sync.

## Changes

### Workbench state hooks

New hooks isolate stateful workflows:

- `useWorkbenchJobs.ts` keeps the queue/report/live-job lifecycle.
- `useEstimatorSuiteWorkbench.ts` keeps estimator-suite CSV, options, active model, model listing, sampling, dataset import, and training actions.
- `useWorkbenchPresets.ts` keeps hardware/workload/custom/estimator presets and their server persistence.
- `useEnvSettings.ts` keeps `.env` read/write state.
- `useProjectIO.ts` keeps project save/load/apply state.

`src/app/page.tsx` is now mostly orchestration: input state, preview estimate, and panel composition.

### Estimator Suite UI components

`EstimatorSuitePanel.tsx` was split into smaller purpose-specific panels:

- `EstimatorSuiteSamplingPlanPanel.tsx`
- `EstimatorDatasetPanel.tsx`
- `EstimatorTrainingSettingsPanel.tsx`
- `EstimatorSuiteRunActions.tsx`

The Estimator Suite UI now follows the same mental model as the pipeline:

1. choose/apply presets,
2. select active model,
3. generate sampling plan,
4. import/merge dataset,
5. train/evaluate model,
6. inspect/download artifacts.

## Size impact

Representative file sizes after this pass:

- `src/app/page.tsx`: 970 lines -> 397 lines
- `src/components/workbench/EstimatorSuitePanel.tsx`: 584 lines -> 163 lines

The goal was not just fewer lines. The goal was to keep hardware-design preview state separate from job-backed validation state and learned-estimator state.

## Validation

Validated commands:

- `npm run typecheck`
- `npm run smoke`
- `npm run test:unit`
- `npm run validate:external:mock`
- `npm run test:docs`
- `npm run test:examples`
- `npm run test:windows-scripts`

Actual SCALE-Sim/IREE binaries were not executed in this environment; the mock external pipeline was used.
