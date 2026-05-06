# Stability and Performance Notes for v0.9

TileForge v0.9 turns the previous stability work into a more operational model:

- SQLite is the preferred metadata store, with file fallback.
- Artifacts are written atomically.
- Job stages are tracked in both metadata and `*.done.json` markers for resumable retries.
- Candidate search uses streaming Top-K, deterministic reservoir sampling, pre-pruning, and shape-level cache reuse.
- External commands use `spawn` without a shell, an allowlisted environment, job-local working directories, output limits, and timeout-based process-tree termination.
- `npm run doctor` checks local readiness.
- CI now includes metamorphic, oracle, schema, contract, property, integration, smoke, and benchmark checks.
