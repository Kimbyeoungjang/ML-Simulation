# v15 Workbench final responsibility hardening

This pass addresses the last major UI-side responsibility leaks left after the v14/v9 refactors.

## What changed

### `page.tsx` no longer owns all input state

The main page previously kept hardware, dataflow, workload, tile candidates, SCALE-Sim overrides, CSV import, ONNX import, Conv2D conversion, and manual-shape insertion in the same file that also assembled jobs, reports, presets, and Estimator Suite state.

That state now lives in:

- `src/components/workbench/useWorkbenchInputs.ts`
- `src/components/workbench/useWorkbenchPreview.ts`

This makes the page a composition layer: it wires the input hook, preview estimate hook, job hook, preset hook, environment hook, project hook, and result panels together.

### Preview estimate has a separate hook

`useWorkbenchPreview()` owns the immediate in-browser estimate:

- analytical estimate
- active Estimator Suite application
- preview confidence
- total-cycle uncertainty
- array sweep

This keeps preview semantics separate from completed job artifacts such as `report.md`, `confidence.md`, and `purpose_gate.md`.

### External log UI no longer lives inside report/status tabs

`JobExternalLogs`, raw-log status detection, and byte formatting moved to:

- `src/components/workbench/externalLogPanel.tsx`

`reportStatusTabs.tsx` now focuses on report selection, external status cards, resource monitor, and system-status rendering.

## Why this matters

TileForge uses the same screen for three different activities:

1. fast preview estimation,
2. queued SCALE-Sim/IREE validation,
3. learned Estimator Suite training/application.

Keeping input state, preview estimates, completed job reports, and external raw logs in separate modules reduces the risk that UI changes accidentally mix those meanings.

## Remaining known limits

The next high-value target is `ResultsPanel.tsx`, whose props are still too broad. The preferred next step is to replace the current large prop pass-through with typed groups:

- `estimateView`
- `jobView`
- `estimatorSuiteView`
- `statusView`
