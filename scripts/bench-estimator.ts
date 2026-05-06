import { performance } from "node:perf_hooks";
import { estimateAll } from "@/lib/estimator";
import { defaultHardware, defaultShapes } from "@/lib/defaults";

const candidates = {
  tileM: Array.from({ length: 24 }, (_, i) => (i + 1) * 16),
  tileN: Array.from({ length: 24 }, (_, i) => (i + 1) * 16),
  tileK: Array.from({ length: 16 }, (_, i) => (i + 1) * 16)
};
const shapes = Array.from({ length: 40 }, (_, i) => ({ ...defaultShapes[i % defaultShapes.length], id: `bench_${i}`, opName: `bench_${i}` }));
const totalCandidates = candidates.tileM.length * candidates.tileN.length * candidates.tileK.length * shapes.length;
const t0 = performance.now();
const res = estimateAll({ hardware: defaultHardware, shapes, candidates, objective: "balanced", maxResultsPerOp: 10 });
const elapsed = performance.now() - t0;
console.log(JSON.stringify({ totalCandidates, elapsedMs: Math.round(elapsed), candidatesPerSecond: Math.round(totalCandidates / (elapsed / 1000)), totalCycles: res.summary.totalCycles, heatmapPoints: res.results.reduce((a,r)=>a+r.heatmap.length,0) }, null, 2));
