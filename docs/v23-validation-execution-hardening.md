# v23 Validation Execution Hardening

TileForge already generated `validation_plan.md` and `validation_runbook.md`, but the user still had to copy commands manually. This patch adds a guarded execution layer.

## Added files

- `src/lib/validationExecutionReport.ts`
- `scripts/validation-execute.ts`
- `tests/validationExecutionReport.test.ts`

## New command

```bash
npm run validation:execute -- --artifact <job-dir>
```

By default this is a dry-run. It reads `validation_runbook.json`, applies the same safety boundary as the runbook, and writes:

- `validation_execution_report.md`
- `validation_execution_report.json`

## Safety model

- Dry-run is the default.
- Actual execution requires `--execute`.
- SCALE-Sim/IREE runtime commands have safety `external-run` and also require `--allow-external`.
- Manual review tasks remain skipped and are not executed.
- On failure/block, later commands are skipped by default unless `--no-stop-on-failure` is used.

Example:

```bash
npm run validation:execute -- --artifact .tileforge_jobs/<job-id>

npm run validation:execute -- \
  --artifact .tileforge_jobs/<job-id> \
  --execute \
  --allow-external \
  --kind scalesim-full-layer
```

## Why this matters

This prevents a common mistake: treating a generated validation runbook as if it had already been executed. The new execution report records what was merely planned, what was skipped, what was blocked by safety policy, and what actually passed or failed.
