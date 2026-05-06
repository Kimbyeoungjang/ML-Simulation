# Troubleshooting

## `npm run dev` starts UI but jobs do not finish

Check `.tileforge_jobs/<job-id>/job.json` and `logs` in the job API response.

## IREE or SCALE-Sim stages are skipped

Set `TILEFORGE_IREE_COMPILE_CMD` or `TILEFORGE_SCALE_SIM_CMD`. Skipping is intentional when tools are not configured.

## A job remains running forever

TileForge writes `job.lock` files. Stale locks are recovered after the configured timeout. You can also delete `.tileforge_jobs` during development.

## Validation errors

API routes return structured `detail` messages from the shared Zod schema. Check positive integer dimensions, non-empty tile candidates, and SRAM/tile sizes.
