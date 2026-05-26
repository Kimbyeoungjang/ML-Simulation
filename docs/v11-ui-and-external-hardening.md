# v11 UI and external-run hardening

This pass focuses on the remaining structural risks after the prediction-contract
and readiness work.

## 1. Graph tab responsibility split

`GraphsTab.tsx` is now an orchestration shell. The expensive or semantically
separate graph paths live in purpose-specific panels:

- `CandidateGraphPanel.tsx`: tile-policy ranking and candidate diagnostics.
- `FullLayerComparisonPanel.tsx`: full-layer TileForge vs SCALE-Sim comparison.
- `DesignSpacePanel.tsx`: hardware/workload sweet-spot exploration and active
  validation candidates.
- `useGraphJobArtifacts.ts`: job artifact loading for `result.json` and
  `scalesim_summary.json`.

This keeps the UI aligned with the project contract: hardware design metrics,
tile-policy metrics, and design-space recommendations must not be silently mixed.

## 2. Live job event handling split

`page.tsx` no longer owns the raw `EventSource` lifecycle. The new
`useLiveJobEvents.ts` hook owns connection setup, teardown, log updates, done
handling, and disconnect messages.

This matters because live logs are operational state, not estimator state. Moving
this out of `page.tsx` reduces the risk that UI preset/input changes accidentally
break job streaming.

## 3. CWD-safe external tool commands

SCALE-Sim is intentionally executed from its output directory so older versions
that write reports to the current directory do not pollute the repository root.
That created a subtle failure mode for commands such as:

```bash
npx tsx scripts/mock-scalesim.ts
py -3 external/SCALE-Sim/scalesim/scale.py
```

Those relative script operands were resolved relative to the output directory,
not the project root. `absolutizeConfiguredToolCommand()` now converts relative
script operands to absolute paths while keeping wrapper commands such as `npx`,
`tsx`, `py -3`, and `python -m` intact.

## 4. Clean-tree behavior fixed for suffix artifacts

`check:clean` already flagged root-level `*.log` files as generated artifacts,
but `clean:generated` only removed exact paths and directory prefixes. The clean
script now also removes suffix-generated files such as `*.log`, `*.tsbuildinfo`,
and `*.vmfb` discovered in the source tree.

## Validation performed

- `npm run typecheck`
- `npm run smoke`
- `npm run test:unit`
- `npm run validate:external:mock`
- `npm run test:docs`
- `npm run test:examples`
- `npm run clean:generated`
- `npm run check:clean`
- `npm run release:zip`
