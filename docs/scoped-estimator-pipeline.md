# Scoped Estimator Suite Pipeline

TileForge now treats full-layer SCALE-Sim targets and tile-policy micro-run targets as two separate training problems instead of mixing them into one CSV/model.

## Target scopes

| Scope | Target value | Main use | Feature policy |
|---|---|---|---|
| `full-layer` | SCALE-Sim full topology `COMPUTE_REPORT.csv` layer cycle | external validation, full workload cycle reports | `tileM/tileN/tileK` are bookkeeping; learned features canonicalize them to the full GEMM shape |
| `tile-policy` | tile micro-run cycle extrapolated by tile count | tile ranking, design-space sweet spot, active validation planning | tile geometry, padding, edge tiles, SRAM pressure, and tile-to-array fit remain active features |

This separation avoids comparing a tile micro-run extrapolation target against a full topology SCALE-Sim target. The two numbers can differ substantially because micro-runs repeat pipeline fill/drain and may miss full-layer overlap/reuse effects.

## Dataset layout

The scoped pipeline writes artifacts in this layout:

```text
estimator-suite/<run-id>/
  datasets/
    merged/
      samples.csv
      report.md
    full-layer/
      samples.csv
      report.md
    tile-policy/
      samples.csv
      report.md
  estimator-suite/
    scoped-pipeline-report.md
    full-layer/
      model.json
      report.md
      validation.csv
      predictions.csv
    tile-policy/
      model.json
      report.md
      validation.csv
      predictions.csv
```

If a scope has fewer than 40 valid samples, the pipeline still writes its dataset/report but skips model training for that scope.

## API actions

The Estimator Suite endpoint supports two scoped actions:

```json
{ "action": "split-dataset", "files": [{ "name": "samples.csv", "text": "..." }] }
```

This only normalizes and splits the uploaded CSV into `full-layer` and `tile-policy` datasets.

```json
{ "action": "scope-pipeline", "files": [{ "name": "samples.csv", "text": "..." }] }
```

This splits, trains one estimator suite per scope when enough samples exist, and writes separate evaluation reports.

`split-and-train` is accepted as an alias for `scope-pipeline`.

## Job sample collection

`collectEstimatorSamplesFromJobs()` now emits both target scopes when both measurements are available:

- `candidate.tileExtrapolatedCycles` becomes a `tile-policy` row.
- `layers.cycles` or `layers.scaleSimRawCycles` becomes a `full-layer` row.

Rows include `targetScope` and `measuredSource` so later training and evaluation can keep the two targets separate.

## Hardware-design estimator contract

TileForge now uses **full-layer cycles** as the primary quantity for hardware-design reports, roofline/energy summaries, and external SCALE-Sim validation. Tile micro-run extrapolation remains available, but only as a tile-policy ranking signal.

The full-layer analytical baseline is implemented in `src/lib/fullLayerEstimator.ts`. For a WS GEMM it uses the same whole-topology systolic shape that SCALE-Sim's normal `COMPUTE_REPORT.csv` path follows:

```text
ceil(K / arrayRows) * ceil(N / arrayCols) * (M + 2*arrayRows + arrayCols - 3)
```

For the attached ViT-S sample this predicts:

| Op | Full-layer estimator | SCALE-Sim full topology | Error |
|---|---:|---:|---:|
| attention_qkv | 31,212 | 31,265 | -0.17% |
| mlp_fc1 | 20,808 | 20,843 | -0.17% |
| mlp_fc2 | 20,808 | 20,843 | -0.17% |

This fixes the earlier failure mode where a tile-policy learned model produced roughly 112k cycles and was compared against a 72,951-cycle full-layer SCALE-Sim run. The correct comparison is full-layer-to-full-layer; tile-policy costs are shown separately.

## Model application rule

`applyEstimatorSuiteToSearchResponse()` is target-aware:

- `full-layer` model: may correct the full-layer hardware-design cycle.
- `tile-policy` model: may rank/correct tile candidates, but must not overwrite full-layer cycle.
- `mixed` or legacy model: treated conservatively; used only as tile-policy/ranking help, while full-layer cycle falls back to the full-layer analytical baseline.

The report now prints both values:

```text
Full-layer cycle: hardware-design / SCALE-Sim validation target
Tile-policy cycle: tile ranking / MLIR lowering candidate score
```

This keeps the project aligned with the final goal: predicting accelerator-level cycle behavior for hardware design, while still using tile-policy estimation to choose a good implementation policy.

## Report and graph contract update

The main report now starts with an interpretation guide that separates three quantities:

1. **Full-layer hardware-design cycle** — the representative cycle used for SCALE-Sim full-topology validation and hardware design.
2. **Tile-policy cycle** — the ranking cost for choosing tileM/tileN/tileK candidates.
3. **SRAM/DRAM access** — full-layer traffic diagnostics, not cycle-equivalent values.

The optimal tile table reports both `Tile SRAM KiB` and `Layer footprint KiB`. This avoids the earlier ambiguity where a tile scratchpad footprint and a whole-layer working-set footprint were shown under one `SRAM KiB` heading.

For external validation, the top-k micro-run diagnostic table labels the predicted value as `TileForge tile-policy cycle` rather than `TileForge full-layer cycle`. Full-layer accuracy is evaluated only against the normal SCALE-Sim full topology rows.
