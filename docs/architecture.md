# TileForge Architecture

TileForge is split into four layers:

1. **Web UI**: Next.js app for entering hardware/workload/tile settings.
2. **Core estimator**: pure TypeScript modules under `src/lib`.
3. **API routes**: validation, job creation, artifact download, dry-run endpoints.
4. **Worker**: file-backed queue processor for long-running SCALE-Sim/IREE jobs.

The core path must work without external tools. External tools are treated as optional runners and produce `*_skipped.txt` artifacts when not configured.
