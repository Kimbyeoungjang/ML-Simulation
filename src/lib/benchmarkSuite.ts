import type { SearchRequest } from "@/types/domain";
import { estimateAll } from "./estimator";

export interface BenchmarkResult { name: string; runtimeMs: number; ops: number; candidateUpperBound: number; totalCycles: number; }

export function candidateUpperBound(req: SearchRequest) {
  return req.shapes.length * req.candidates.tileM.length * req.candidates.tileN.length * req.candidates.tileK.length;
}

export function runEstimatorBenchmark(name: string, req: SearchRequest): BenchmarkResult {
  const t0 = performance.now();
  const result = estimateAll(req);
  const runtimeMs = performance.now() - t0;
  return { name, runtimeMs, ops: req.shapes.length, candidateUpperBound: candidateUpperBound(req), totalCycles: result.summary.totalCycles };
}
