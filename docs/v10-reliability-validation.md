# TileForge v0.10 Reliability, Validation, and Performance Plan

v0.10 focuses on long-running experiment reliability rather than new UI features.

## Added hardening

- SQLite migration table and versioned migrations.
- Atomic artifact writes with fsync + rename.
- Artifact integrity manifest with SHA-256 and size metadata.
- Release check command that chains doctor, typecheck, tests, smoke, reference validation, benchmarks, and build.
- Cache inspection and age-based cleanup commands.
- Reference validation dataset with an explicit error budget.
- Memory benchmark for repeated estimator execution.
- Documentation command smoke test.

## Recommended validation flow

```bash
npm install
npm run doctor
npm run release:check
```

For mock external tool validation:

```bash
npm run test:integration:mock
```

For reference accuracy validation:

```bash
npm run validate:reference
```

## Artifact integrity

Each worker job writes `artifact_integrity.json` containing `sizeBytes` and `sha256` for generated artifacts. Verify a job with:

```bash
npm run verify:artifacts -- <job-id>
```

## Cache maintenance

```bash
npm run cache:stats
npm run cache:clean -- --max-age-days=30
```

## Release criteria

A release should pass:

- `doctor`
- `typecheck`
- all unit/property/metamorphic/oracle/contract/schema/integrity/reference tests
- `smoke`
- `validate:reference`
- `bench:suite`
- `build`
