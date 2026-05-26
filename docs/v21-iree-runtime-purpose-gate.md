# v21 IREE Runtime Purpose Gate Integration

TileForge now treats IREE runtime benchmark results as first-class evidence for the `iree-options` purpose gate.

Before this change, `npm run benchmark:iree` produced `iree-runtime/iree_runtime_decision.md/json`, but the main job-level `purpose_gate.md` still reflected only compile success. That could leave users with two disconnected conclusions:

- `purpose_gate.md`: IREE compile succeeded, but runtime benchmark is still required.
- `iree_runtime_decision.md`: hinted VMFB improved, regressed, or needs more runs.

This patch connects those two layers.

## New behavior

After `npm run benchmark:iree -- --artifact <job-dir>` finishes, the script now attempts to read:

- `result.json`
- `scalesim_summary.json`
- `iree_summary.json`
- `iree-runtime/iree_runtime_decision.json`

If enough context is available, it refreshes:

- `purpose_gate.md`
- `purpose_gate.json`
- `iree_runtime_purpose_gate.md`
- `iree_runtime_purpose_gate.json`
- `artifact_guide.md`
- `artifact_guide.json`

The refreshed gate includes:

- `ireeRuntimeStatus`
- `ireeRuntimeMedianSpeedup`
- `ireeRuntimeCorrectness`

## Promotion rules

A hinted IREE option is not promoted just because it compiles.

The `iree-options` gate is promoted to `ready` only when runtime evidence is strong enough. In practice this means:

- baseline and hinted runtime runs are both parseable,
- hinted median runtime improves over baseline,
- correctness is checked,
- tiling strategy is not obviously unstable.

If runtime speedup exists but correctness is not checked, the gate remains `needs-benchmark`.

If hinted runtime regresses, the gate becomes `validate-first` and recommends keeping baseline lowering or trying another tile candidate.

If runtime execution fails or correctness mismatches, the gate becomes `blocked`.

## Why this matters

IREE compile success is only a compileability signal. It is not performance evidence.

This change prevents a workflow where users see an IREE hint, run a benchmark separately, but then keep reading the older purpose gate that still lacks runtime evidence. The job folder now has a runtime-aware gate after benchmarking.

## Trust boundary

The runtime-aware gate is still backend/input dependent. A `ready` IREE option means the hint is a candidate for broader promotion, not a universal compiler default.
