# TileForge v0.11 portability, validation, and operational notes

This release focuses on keeping the workbench usable across Windows, macOS, Linux, Docker, and CI.

## Windows-safe commands

Use the npm scripts instead of inline environment variables whenever possible:

```powershell
npm run test:integration:mock
npm run test:integration:file-store
npm run doctor
```

For real tools in PowerShell:

```powershell
$env:TILEFORGE_IREE_COMPILE_CMD="C:\\tools\\iree\\iree-compile.exe"
$env:TILEFORGE_SCALE_SIM_CMD="python C:\\tools\\scale-sim-v2\\scale.py"
npm run test:integration:full
```

The `test:integration:mock` script uses `cross-env`, so it works on Windows and POSIX shells.

## External integration profiles

- `npm run test:integration:mock`: always uses mock SCALE-Sim and mock IREE.
- `npm run test:integration:iree`: runs only when `TILEFORGE_IREE_COMPILE_CMD` is configured; otherwise skips.
- `npm run test:integration:scalesim`: runs only when `TILEFORGE_SCALE_SIM_CMD` is configured; otherwise skips.
- `npm run test:integration:full`: requires both real tool commands.

## Bundle integrity gate

Before a job bundle ZIP is returned, TileForge now verifies `artifact_integrity.json`:

- artifact exists
- size matches
- SHA-256 matches

If verification fails, `/api/jobs/:id/bundle` returns HTTP 409 instead of serving a corrupt ZIP.

## Structured logs

Each job writes `events.ndjson` next to the human-readable `job.json` and normal logs. Each line is a JSON event:

```json
{"time":"...","level":"info","jobId":"...","stage":"estimating","message":"Running estimator"}
```

Use `/api/jobs/:id/events-log` to fetch recent structured events.

## SQLite fallback

`better-sqlite3` is optional. If it is unavailable, TileForge falls back to file-based job storage. Force this path with:

```bash
TILEFORGE_DISABLE_SQLITE=1 npm run test:integration
```

## E2E smoke test

Playwright is configured for a small smoke test:

```bash
npm run test:e2e:install
npm run test:e2e
```

This verifies that the web UI loads and exposes core controls.
