import { readFile, writeFile, mkdir } from "node:fs/promises";
import { defaultCandidates, defaultHardware, defaultShapes } from "../src/lib/defaults";
import { runEstimatorBenchmark } from "../src/lib/benchmarkSuite";
import type { SearchRequest } from "../src/types/domain";

async function main(): Promise<void> {
  const workloads: [string, SearchRequest][] = [
    ["small", { hardware: defaultHardware, shapes: defaultShapes.slice(0, 1), candidates: defaultCandidates, objective: "balanced" }],
    ["medium", { hardware: defaultHardware, shapes: Array.from({ length: 100 }, (_, i) => ({ ...defaultShapes[i % defaultShapes.length], id: `m${i}`, opName: `op_${i}` })), candidates: defaultCandidates, objective: "balanced" }],
    ["large", { hardware: { ...defaultHardware, sramKB: 4096 }, shapes: Array.from({ length: 1000 }, (_, i) => ({ ...defaultShapes[i % defaultShapes.length], id: `l${i}`, opName: `large_${i}` })), candidates: { tileM: [16,32,48,64,96,128,192,256], tileN: [16,32,64,128,256], tileK: [16,32,64,128,256] }, objective: "balanced" }]
  ];
  const results = workloads.map(([name, w]) => runEstimatorBenchmark(name, w));
  await mkdir("benchmarks/results", { recursive: true });
  await writeFile("benchmarks/results/latest.json", JSON.stringify({ createdAt: new Date().toISOString(), results }, null, 2));
  console.table(results);
  try {
    const baseline = JSON.parse(await readFile("benchmarks/baselines.json", "utf8"));
    const warnings: string[] = [];
    for (const r of results) {
      const max = baseline[r.name]?.maxMs;
      if (typeof max === "number" && r.runtimeMs > max) warnings.push(`${r.name}: ${r.runtimeMs.toFixed(1)} ms exceeds baseline ${max} ms`);
    }
    if (warnings.length) {
      console.warn("Performance baseline warning:\n" + warnings.join("\n"));
      if (process.env.TILEFORGE_FAIL_ON_BENCH_REGRESSION === "1") process.exit(1);
    }
  } catch {}
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
