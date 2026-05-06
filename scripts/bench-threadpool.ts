import { cpus } from "node:os";
import { performance } from "node:perf_hooks";
import { defaultCandidates, defaultHardware, defaultShapes } from "../src/lib/defaults";
import { estimateMaybeThreaded } from "../src/server/threadedEstimate";

function expandedShapes(count: number) {
  const base = defaultShapes.length ? defaultShapes : [{ id:"m", model:"bench", opName:"matmul", m:197, n:768, k:768, dtypeBytes:2 } as any];
  return Array.from({ length: count }, (_, i) => ({ ...base[i % base.length], id: `bench_${i}`, opName: `op_${i % Math.max(1, base.length)}` }));
}

async function run(workers: number) {
  const oldWorkers = process.env.TILEFORGE_COMPUTE_WORKERS;
  const oldThreshold = process.env.TILEFORGE_THREAD_THRESHOLD;
  process.env.TILEFORGE_COMPUTE_WORKERS = String(workers);
  process.env.TILEFORGE_THREAD_THRESHOLD = "1";
  const request = { hardware: defaultHardware, shapes: expandedShapes(Number(process.env.TILEFORGE_BENCH_OPS ?? 250)), candidates: defaultCandidates, objective: "balanced" as const, maxResultsPerOp: 8 };
  const t0 = performance.now();
  const res = await estimateMaybeThreaded(request);
  const elapsedMs = performance.now() - t0;
  process.env.TILEFORGE_COMPUTE_WORKERS = oldWorkers;
  if (oldThreshold == null) delete process.env.TILEFORGE_THREAD_THRESHOLD; else process.env.TILEFORGE_THREAD_THRESHOLD = oldThreshold;
  return { workers, elapsedMs, totalCycles: res.summary.totalCycles, stats: (res as any).computePoolStats };
}

async function main(): Promise<void> {
  const single = await run(0);
  const workerCount = Number(process.env.TILEFORGE_COMPUTE_WORKERS_COMPARE ?? Math.max(2, Math.min(4, cpus().length - 1)));
  const threaded = await run(workerCount);
  console.log(JSON.stringify({ single, threaded, speedup: single.elapsedMs / Math.max(1, threaded.elapsedMs) }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
