# v16 Results view contract hardening

## Why this pass exists

The workbench page had already been split into input, preview, job, environment, project, and Estimator Suite hooks. The remaining risk was the boundary between the page and the results panel: `ResultsPanel` still accepted a large untyped bag of props and then selected individual values internally.

That pattern was dangerous for TileForge's core purpose because the right-side result area combines several meanings:

- immediate preview estimates from the current form state,
- completed job artifacts such as `report.md` and `confidence.md`,
- external validation status and logs,
- Estimator Suite state used for graph annotations.

When all of those were passed as a flat object, it was too easy to accidentally show preview confidence beside a selected job report, or to pass a stale job artifact state into a graph that should be based on the current estimate.

## What changed

### Results view contracts

Added `src/components/workbench/resultsPanelTypes.ts` with explicit view groups:

- `ResultsTabsView`
- `ResultsEstimateView`
- `ResultsJobView`
- `ResultsReportView`
- `ResultsExternalView`
- `ResultsEstimatorSuiteView`
- `ResultsPanelProps`

`ResultsPanel` now receives these grouped contracts instead of `Record<string, any>`.

### Summary and tab content extraction

Added:

- `src/components/workbench/ResultsSummaryCards.tsx`
- `src/components/workbench/ResultsTabContent.tsx`

`ResultsPanel` now orchestrates the result context bar, tab buttons, summary cards, and tab content. The per-tab rendering logic lives in `ResultsTabContent`.

### Confidence source contract

Added `src/components/workbench/resultViewContracts.ts`.

The selected confidence source is now decided by small pure helpers:

- `confidenceSourceForJobSelection()`
- `selectDisplayConfidence()`

This makes the key invariant explicit: a selected job confidence artifact may override preview confidence only when its job id matches the currently selected analysis job.

### Tests

Added `tests/resultViewContracts.test.ts` to verify that preview confidence is not accidentally replaced by a stale job confidence artifact.

## Resulting responsibility split

After this pass:

- `page.tsx` wires high-level view groups together.
- `useWorkbenchInputs` owns input/request state.
- `useWorkbenchPreview` owns immediate estimate/confidence/uncertainty.
- `useWorkbenchJobs` owns job, report, confidence artifact, and live stream state.
- `ResultsPanel` owns result-area composition.
- `ResultsTabContent` owns tab-specific rendering.
- `resultViewContracts` owns the preview-vs-job confidence selection contract.

This keeps TileForge aligned with the intended flow:

```text
current inputs -> fast preview estimate
completed job -> report/confidence/purpose artifacts
selected result view -> explicitly chooses which source is being shown
```

## Validation

The following checks were run in this pass:

- `npm run typecheck`
- `npm run smoke`
- `npm run test:unit`

Additional release and mock-external checks should still be run before tagging a release.
