import os from "node:os";
import type { MatmulShape, OpSearchResult, SearchRequest, SearchResponse } from "@/types/domain";
import { estimateForShape } from "@/lib/estimator";
import { hashObject } from "@/lib/hash";
import { mean } from "@/lib/math";
import { generateArtifacts } from "@/lib/mlir";
import { generateReportMarkdown } from "@/lib/report";
import { makeDesignAdvice } from "@/lib/estimator";
import { analyzeBottlenecks } from "@/lib/bottleneck";
import { computeRoofline } from "@/lib/roofline";
import { computeEnergy } from "@/lib/energy";
import { assertSearchResponseInvariant, runInvariant } from "@/lib/invariants";
import { estimateClustersWithWorkerThreads } from "./workerThreadPool";

export interface ComputePoolStats {
  enabled: boolean;
  workers: number;
  uniqueShapeKeys: number;
  totalOps: number;
  mode: "single" | "clustered" | "worker_threads" | "fallback_single";
  candidateCombos: number;
  fallbackReason?: string;
}

function shapeKey(req: SearchRequest, shape: MatmulShape) {
  return hashObject({ m: shape.m, n: shape.n, k: shape.k, dtypeBytes: shape.dtypeBytes, hardware: req.hardware, candidates: req.candidates, objective: req.objective });
}

function materializeResponse(req: SearchRequest, clusterResults: Map<string, OpSearchResult>, stats: ComputePoolStats): SearchResponse & { computePoolStats?: ComputePoolStats } {
  const results = req.shapes.map(shape => {
    const hit = clusterResults.get(shapeKey(req, shape));
    if (!hit) throw new Error(`Missing cluster estimate for ${shape.opName}`);
    return {
      ...hit,
      shape,
      best: { ...hit.best, shapeId: shape.id, model: shape.model, opName: shape.opName },
      candidates: hit.candidates.map(c => ({ ...c, shapeId: shape.id, model: shape.model, opName: shape.opName }))
    };
  });

  const bests = results.map(r => r.best);
  const summary = {
    totalCycles: bests.reduce((a,b)=>a+b.cycles,0),
    totalTimeUs: bests.reduce((a,b)=>a+b.timeUs,0),
    meanUtilization: mean(bests.map(b=>b.utilization)),
    meanPaddingRatio: mean(bests.map(b=>b.paddingRatio)),
    maxSramBytes: Math.max(...bests.map(b=>b.sramBytes), 0),
    bottleneckOp: bests.slice().sort((a,b)=>b.cycles-a.cycles)[0]?.opName ?? "none"
  };
  const pairs = results.map(r => ({ shape: r.shape, best: r.best }));
  const designAdvice = makeDesignAdvice(req.hardware, bests);
  const bottlenecks = analyzeBottlenecks({ request: req, results, summary });
  const roofline = computeRoofline(req.hardware, pairs);
  const energy = computeEnergy(req.hardware, pairs);
  const partial = { request: req, results, summary, artifacts: {} as any, designAdvice, bottlenecks, roofline, energy };
  const artifacts = generateArtifacts(partial);
  artifacts.reportMarkdown = generateReportMarkdown({ ...partial, artifacts });
  const response = { ...partial, artifacts, computePoolStats: stats };
  runInvariant("search response", () => assertSearchResponseInvariant(response));
  return response;
}

export async function estimateWithClusterPool(req: SearchRequest): Promise<SearchResponse & { computePoolStats?: ComputePoolStats }> {
  const requestedWorkers = Math.max(0, Math.min(Number(process.env.TILEFORGE_COMPUTE_WORKERS ?? 0), os.cpus().length || 1));
  const candidateCombos = req.shapes.length * req.candidates.tileM.length * req.candidates.tileN.length * req.candidates.tileK.length;
  const clusters = new Map<string, MatmulShape[]>();
  for (const shape of req.shapes) {
    const key = shapeKey(req, shape);
    const arr = clusters.get(key) ?? [];
    arr.push(shape);
    clusters.set(key, arr);
  }

  const representatives = Array.from(clusters.entries()).map(([key, shapes], taskId) => ({ key, taskId, shape: shapes[0] }));
  const clusterResults = new Map<string, OpSearchResult>();
  const shouldUseThreads = requestedWorkers > 0 && candidateCombos >= Number(process.env.TILEFORGE_THREAD_THRESHOLD ?? 50000) && representatives.length > 1;

  if (shouldUseThreads) {
    try {
      const taskResults = await estimateClustersWithWorkerThreads(representatives.map(({ taskId, shape }) => ({ taskId, shape })), {
        hardware: req.hardware,
        candidates: req.candidates,
        objective: req.objective,
        maxResultsPerOp: req.maxResultsPerOp ?? 32,
        workers: requestedWorkers
      });
      for (const { key, taskId } of representatives) clusterResults.set(key, taskResults.get(taskId)!);
      return materializeResponse(req, clusterResults, { enabled: true, workers: requestedWorkers, uniqueShapeKeys: clusters.size, totalOps: req.shapes.length, mode: "worker_threads", candidateCombos });
    } catch (error: any) {
      for (const { key, shape } of representatives) clusterResults.set(key, estimateForShape(req.hardware, shape, req.candidates, req.objective, req.maxResultsPerOp ?? 32));
      return materializeResponse(req, clusterResults, { enabled: false, workers: 0, uniqueShapeKeys: clusters.size, totalOps: req.shapes.length, mode: "fallback_single", candidateCombos, fallbackReason: error?.message ?? String(error) });
    }
  }

  for (const { key, shape } of representatives) clusterResults.set(key, estimateForShape(req.hardware, shape, req.candidates, req.objective, req.maxResultsPerOp ?? 32));
  return materializeResponse(req, clusterResults, { enabled: requestedWorkers > 0, workers: requestedWorkers, uniqueShapeKeys: clusters.size, totalOps: req.shapes.length, mode: clusters.size < req.shapes.length ? "clustered" : "single", candidateCombos });
}
