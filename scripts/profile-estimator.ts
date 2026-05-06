import { writeFileSync, mkdirSync } from "node:fs";
import { performance } from "node:perf_hooks";
import { estimateMaybeThreaded } from "../src/server/threadedEstimate";
import { defaultCandidates, defaultHardware, defaultShapes } from "../src/lib/defaults";

async function main() {
  mkdirSync("profiles", { recursive: true });
  const shapes = Array.from({ length: Number(process.env.TILEFORGE_PROFILE_OPS ?? 500) }, (_, i) => ({ ...defaultShapes[i % defaultShapes.length], id: `op${i}`, opName: `profile_${i}` }));
  const request = { hardware: defaultHardware, shapes, candidates: defaultCandidates, objective: "balanced" as const, maxResultsPerOp: 8 };
  const started = performance.now();
  const result = await estimateMaybeThreaded(request);
  const elapsedMs = performance.now() - started;
  const out = { elapsedMs, ops: shapes.length, totalCycles: result.summary.totalCycles, computePoolStats: (result as any).computePoolStats, heap: process.memoryUsage() };
  writeFileSync("profiles/estimator-profile.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify(out, null, 2));
}
main().catch(e => { console.error(e); process.exit(1); });
