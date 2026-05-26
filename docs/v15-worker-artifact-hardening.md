# v15 Worker and Artifact Hardening

TileForge is intended to make fast estimates useful for three different downstream decisions:

1. hardware design exploration,
2. tiling strategy selection,
3. IREE compiler-option benchmarking.

The previous hardening passes separated most UI and estimator responsibilities, but the worker still mixed two large concerns into `workerRunner.ts`:

- the general full-pipeline job state machine, and
- Estimator Suite training / dataset ingestion / artifact writing.

It also kept the base job artifact writer in the worker, which made the worker harder to audit for cancellation, retry, and artifact-integrity behavior.

## Changes

### Worker orchestration

`src/server/workerRunner.ts` is now a smaller orchestration module.  It handles lock acquisition, retry handling, stage transitions, estimator execution, and calls out to dedicated modules for specialized work.

New modules:

- `src/server/estimatorSuiteTrainingRunner.ts`
  - Estimator Suite training job execution
  - CSV parsing
  - dataset-manager artifact generation
  - training progress reporting
  - model activation

- `src/server/jobArtifactWriter.ts`
  - core job artifact materialization
  - confidence / uncertainty / purpose-gate artifact writing
  - artifact-integrity manifest writing
  - SQLite artifact indexing

- `src/server/jobExecutionGuards.ts`
  - cancellation guard
  - per-stage timeout wrapper

- `src/server/pathSafety.ts`
  - safe path resolution for job-local uploaded dataset files

This keeps the worker focused on the job state machine rather than artifact details.

### Safe job-local file resolution

Estimator Suite training jobs can reference uploaded CSV files through job-local paths.  The previous implementation relied on `startsWith(localDir)` after `path.resolve`, which can be fooled by sibling paths sharing the same prefix, for example:

```text
/tmp/job
/tmp/job-evil/data.csv
```

The new `resolveInsideRoot()` helper uses `path.relative()` and rejects parent traversal or sibling-prefix escapes.  This matters because Estimator Suite dataset ingestion should only read files that belong to the job artifact directory.

### Test coverage

A new test file was added:

- `tests/pathSafety.test.ts`

It checks:

- valid nested files are accepted,
- `../` traversal is rejected,
- sibling-prefix paths such as `../job-evil/data.csv` are rejected.

## Why this matters for the final goal

Fast estimates are only useful when the surrounding pipeline is trustworthy.  Hardware-design decisions and IREE optimization hints should not depend on a worker that has hidden file-resolution edge cases or tangled artifact-writing behavior.

This pass does not change the estimator math.  It improves the execution envelope around the estimator so the generated reports, confidence files, purpose gates, and training artifacts are easier to trust and maintain.
