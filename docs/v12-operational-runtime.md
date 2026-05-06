# TileForge Workbench v0.12 operational runtime improvements

v0.12 focuses on long-running reliability and measurable performance behavior.

## Main additions

- `packageManager` is pinned in `package.json` for reproducible installs.
- Compute estimation can use the new clustered estimate path when `TILEFORGE_COMPUTE_WORKERS` or a large candidate threshold is configured.
- `/api/system/status` reports job counts, cache/job disk usage, configured external tools, quotas, Node version, and workspace paths.
- Job artifacts include `confidence.md` and `uncertainty.json` so reports show estimator confidence and uncertainty, not just single-point cycle estimates.
- Bundle generation enforces `TILEFORGE_MAX_BUNDLE_MB` and returns `BUNDLE_TOO_LARGE` before building oversized archives.
- `events.ndjson` remains the structured event log; `src/lib/errorTaxonomy.ts` standardizes recoverable error codes and hints.
- Profiling and soak commands were added for performance and long-running stability checks.

## Useful commands

```bash
npm run profile:estimator
npm run soak:worker
npm run jobs:stats
npm run cache:stats
```

For larger estimate experiments:

```bash
TILEFORGE_COMPUTE_WORKERS=8 npm run profile:estimator
```

For bundle safety:

```bash
TILEFORGE_MAX_BUNDLE_MB=500 npm run dev
```

## Confidence model

The confidence score is a conservative heuristic based on:

- whether external validation is available,
- calibration sample count,
- mean padding overhead,
- mean utilization,
- selected-tile warnings,
- extrapolation-heavy shapes.

The generated uncertainty interval is intended for honest reporting. It is not a replacement for SCALE-Sim/IREE validation.
