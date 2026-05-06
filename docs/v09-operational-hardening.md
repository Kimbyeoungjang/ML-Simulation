# TileForge v0.9 Operational Hardening

v0.9 focuses on stability, validation, and performance rather than new user-facing analysis features.

## Stability

- SQLite is now the preferred primary metadata store when `better-sqlite3` is available.
- File artifacts are still stored as ordinary files under `.tileforge/artifacts` / job directories.
- Job status, logs, stage history, artifact metadata, and cache entries are mirrored into `.tileforge/tileforge.db`.
- Artifact writes use atomic temp-file + rename semantics.
- Pipeline stages write `*.done.json` markers so retries can reuse completed stages.
- External commands run with `spawn(..., shell:false)`, allowlisted environment variables, job-local working directories, timeout, process group termination, and bounded output logs.

## Validation

- Added metamorphic tests for frequency/time and basic cycle invariants.
- Added tiny independent oracle test for matmul cycle ranking.
- Added schema validation test for generated result envelopes.
- Existing property, golden, contract, integration, and smoke tests remain part of the validation path.

## Performance

- Candidate evaluation uses streaming Top-K instead of storing the full candidate list.
- Heatmap data uses deterministic reservoir sampling.
- Candidate pruning is applied before expensive scoring.
- Equivalent shapes are cached within a single estimate run.
- `npm run bench:suite` records small/medium/large benchmark data under `benchmarks/results/latest.json`.

## Operations

Run an environment self-check:

```bash
npm run doctor
```

Run the local CI bundle:

```bash
npm run ci:local
```

Watch a running job via SSE:

```text
GET /api/jobs/<job-id>/events
```

Disable SQLite fallback for debugging:

```bash
TILEFORGE_DISABLE_SQLITE=1 npm run dev
```
