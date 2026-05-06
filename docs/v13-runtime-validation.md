# TileForge Workbench v0.13 runtime validation improvements

v0.13 focuses on portability, long-running stability, and performance verification.

## Install reproducibility

The repository pins `packageManager` and `engines.node` in `package.json`. Generate and commit a real lockfile in a networked environment:

```bash
npm install --package-lock-only
npm ci
```

Use `npm ci` in CI and release checks.

## Windows/PowerShell

Most environment-variable scripts use `cross-env`. For manual PowerShell runs:

```powershell
$env:TILEFORGE_IREE_COMPILE_CMD="C:\tools\iree\iree-compile.exe"
$env:TILEFORGE_SCALE_SIM_CMD="python C:\tools\scale-sim-v2\scale.py"
npm run test:integration:full
```

`npm run test:windows-scripts` checks that cross-platform scripts remain portable.

## Worker-thread performance path

Large clustered workloads can use worker threads:

```bash
TILEFORGE_COMPUTE_WORKERS=8 TILEFORGE_THREAD_THRESHOLD=50000 npm run bench:threadpool
```

Small workloads stay single-threaded to avoid worker startup overhead.

## Soak testing

Long-running stability is checked with:

```bash
npm run soak:worker
```

The report records heap growth, RSS, failed jobs, and event-loop delay in `reports/soak-worker.json`.

## Artifact integrity gate

Job completion verifies required artifacts and checksums. Bundle download also gates on `artifact_integrity.json`.

## Job pagination and cleanup

Use paginated APIs:

```text
GET /api/jobs?limit=50&cursor=<last-job-id>&status=failed
DELETE /api/jobs/<job-id>
```

CLI cleanup:

```bash
npm run jobs:cleanup -- --older-than-days=30
```

## Confidence and uncertainty

Confidence now incorporates validation ranking metrics when available: Top-3 recall and median regret adjust both confidence and uncertainty.
