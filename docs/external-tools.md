# External Tools

External tools are optional.

```bash
export TILEFORGE_SCALE_SIM_CMD="/path/to/scalesim-wrapper"
export TILEFORGE_IREE_COMPILE_CMD="/path/to/iree-compile"
```

For CI or local smoke testing, use the included mocks:

```bash
export TILEFORGE_SCALE_SIM_CMD="npx tsx scripts/mock-scalesim.ts"
export TILEFORGE_IREE_COMPILE_CMD="npx tsx scripts/mock-iree-compile.ts"
npm run worker:once
```

If these variables are not set, TileForge marks the stage as skipped and still emits analytic artifacts.
