import { mkdirSync, writeFileSync } from "node:fs";
import { performance, monitorEventLoopDelay } from "node:perf_hooks";
import { estimateMaybeThreaded } from "../src/server/threadedEstimate";
import { defaultCandidates, defaultHardware, defaultShapes } from "../src/lib/defaults";
import { createJob, deleteJob } from "../src/server/jobStore";
import { runJob } from "../src/server/workerRunner";

async function main() {
  mkdirSync("reports", { recursive: true });
  const iterations = Number(process.env.TILEFORGE_SOAK_ITERATIONS ?? 100);
  const fullPipelineEvery = Number(process.env.TILEFORGE_SOAK_FULL_PIPELINE_EVERY ?? 10);
  const samples: any[] = [];
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  const started = performance.now();
  let failed = 0;
  for (let i = 0; i < iterations; i++) {
    try {
      const shapes = defaultShapes.map(s => ({ ...s, id: `${s.id}_${i}`, opName: `${s.opName}_${i % 5}` }));
      const req = { hardware: defaultHardware, shapes, candidates: defaultCandidates, objective: "balanced" as const, maxResultsPerOp: 8 };
      await estimateMaybeThreaded(req);
      if (fullPipelineEvery > 0 && (i + 1) % fullPipelineEvery === 0) {
        const job = await createJob("full-pipeline", req);
        await runJob(job);
        if (process.env.TILEFORGE_SOAK_KEEP_JOBS !== "1") await deleteJob(job.id);
      }
    } catch (error: any) {
      failed++;
      samples.push({ iteration: i + 1, error: error?.message ?? String(error) });
    }
    if (global.gc) global.gc();
    const mem = process.memoryUsage();
    samples.push({ iteration: i + 1, elapsedMs: performance.now() - started, memory: mem, eventLoopDelayMeanMs: delay.mean / 1e6, eventLoopDelayP99Ms: delay.percentile(99) / 1e6 });
  }
  delay.disable();
  const first = samples.find(s => s.memory)?.memory.heapUsed ?? 0;
  const last = samples.filter(s => s.memory).at(-1)?.memory.heapUsed ?? 0;
  const report = { iterations, failed, heapGrowthBytes: last - first, firstHeapBytes: first, lastHeapBytes: last, rssBytes: samples.filter(s=>s.memory).at(-1)?.memory.rss, eventLoopDelayMeanMs: delay.mean / 1e6, eventLoopDelayP99Ms: delay.percentile(99) / 1e6, samples };
  writeFileSync("reports/soak-worker.json", JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ iterations, failed, heapGrowthBytes: report.heapGrowthBytes, lastHeapMB: last/1024/1024, eventLoopDelayP99Ms: report.eventLoopDelayP99Ms }, null, 2));
  const maxGrowth = Number(process.env.TILEFORGE_SOAK_MAX_HEAP_GROWTH_MB ?? 512) * 1024 * 1024;
  if (failed || report.heapGrowthBytes > maxGrowth) process.exit(1);
}
main().catch(e => { console.error(e); process.exit(1); });
