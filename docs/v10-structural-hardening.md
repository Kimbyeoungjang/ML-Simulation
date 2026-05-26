# v10 Structural hardening notes

This pass focuses on reducing hidden coupling after the purpose-aligned pipeline changes.
TileForge's final goal is not just to make a single cycle number look accurate; it is to make a fast estimate useful for three separate decisions:

1. hardware design exploration,
2. tile strategy selection,
3. IREE lowering-option benchmarking.

## What changed

### Design-space scoring is no longer mixed into sweep construction

`src/lib/designSpace.ts` now keeps the sweep construction path: request mutation, analytical/full-layer estimation, and SVG construction.
The recommendation, uncertainty, Pareto, and active-validation selection logic moved to `src/lib/designSpaceScoring.ts`.
The shared row contract moved to `src/lib/designSpaceTypes.ts`.

This makes it harder to accidentally change the sweep grid while tuning the recommendation score, or to change the active-learning selection policy while modifying SVG rendering.

### Estimator Suite domain logic is isolated

`src/lib/estimatorSuiteDomain.ts` now owns the domain keys used by training splits, feature-domain metadata, prediction confidence, and bottleneck-regime naming.
The training body in `src/lib/estimatorSuite.ts` still owns the ensemble/calibration algorithms, but no longer hides the definition of "same array", "same workload", or "out of training domain" inside one large file.

This matters because TileForge should damp learned corrections outside the training envelope rather than silently over-trusting them for hardware design decisions.

### Graph controls are isolated from graph data preparation

`src/components/workbench/GraphControls.tsx` now owns graph-mode and zoom controls.
`GraphsTab.tsx` still needs further extraction, but it no longer mixes mode-control UI with the data preparation and table rendering logic in the same JSX block.

### Confidence markdown parsing is isolated

`src/components/workbench/confidenceMarkdown.ts` now parses generated confidence markdown back into UI state.
This reduces coupling in `src/app/page.tsx` and makes the parser easier to test or replace later.

## Remaining risks

`src/lib/estimatorSuite.ts`, `src/components/workbench/GraphsTab.tsx`, and `src/app/page.tsx` are still large. The next sensible split is:

- move Estimator Suite calibration internals into `estimatorSuiteCalibration.ts`,
- move candidate graph SVG/table logic into `CandidateGraphPanel.tsx`,
- move full-layer comparison graph logic into `FullLayerComparisonPanel.tsx`,
- move job polling and SSE handling out of `page.tsx` into a dedicated hook.

The current pass deliberately stops before those larger moves because they touch many runtime paths. The important improvement here is that domain/risk/scoring contracts are now named modules instead of implicit sections inside large files.
