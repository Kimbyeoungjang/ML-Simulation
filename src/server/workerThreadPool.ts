import os from "node:os";
import { Worker } from "node:worker_threads";
import { fileURLToPath, pathToFileURL } from "node:url";
import path from "node:path";
import type { HardwareConfig, MatmulShape, Objective, OpSearchResult, SearchRequest, TileCandidates } from "@/types/domain";
import { estimateForShape } from "@/lib/estimator";

export interface EstimateTask {
  taskId: number;
  shape: MatmulShape;
}

export interface ThreadPoolOptions {
  hardware: HardwareConfig;
  candidates: TileCandidates;
  objective: Objective;
  maxResultsPerOp: number;
  calibration?: SearchRequest["calibration"];
  scaleSim?: SearchRequest["scaleSim"];
  workers?: number;
}

function defaultWorkerCount(requested?: number): number {
  const cpu = os.cpus()?.length || 1;
  const envWorkers = Number(process.env.TILEFORGE_COMPUTE_WORKERS ?? 0);
  const fallback = Math.max(1, cpu - 1);
  const desired = requested ?? (envWorkers || fallback);
  return Math.max(1, Math.min(desired, cpu));
}

function workerModulePath(): URL {
  // tsx can execute TS workers during development. If this path fails in a bundled/runtime
  // environment, callers fall back to deterministic single-thread execution.
  const here = path.dirname(fileURLToPath(import.meta.url));
  return pathToFileURL(path.join(here, "estimateWorkerThread.ts"));
}

export async function estimateClustersWithWorkerThreads(tasks: EstimateTask[], opts: ThreadPoolOptions): Promise<Map<number, OpSearchResult>> {
  const workerCount = Math.min(defaultWorkerCount(opts.workers), tasks.length);
  if (workerCount <= 1 || process.env.TILEFORGE_DISABLE_WORKER_THREADS === "1") {
    return estimateClustersSynchronously(tasks, opts);
  }

  const results = new Map<number, OpSearchResult>();
  let next = 0;
  let active = 0;
  let failed = false;

  return await new Promise<Map<number, OpSearchResult>>((resolve, reject) => {
    const startNext = () => {
      if (failed) return;
      if (next >= tasks.length && active === 0) return resolve(results);
      while (active < workerCount && next < tasks.length) {
        const task = tasks[next++];
        active++;
        const worker = new Worker(workerModulePath(), {
          workerData: {
            taskId: task.taskId,
            shape: task.shape,
            hardware: opts.hardware,
            candidates: opts.candidates,
            objective: opts.objective,
            maxResultsPerOp: opts.maxResultsPerOp,
            calibration: opts.calibration,
            scaleSim: opts.scaleSim
          },
          execArgv: ["--import", "tsx", "-r", "tsconfig-paths/register"]
        });
        worker.once("message", (message: any) => {
          active--;
          worker.terminate().catch(() => undefined);
          if (!message?.ok) {
            failed = true;
            return reject(new Error(message?.error ?? "estimate worker failed"));
          }
          results.set(message.taskId, message.result);
          startNext();
        });
        worker.once("error", (error) => {
          active--;
          worker.terminate().catch(() => undefined);
          failed = true;
          reject(error);
        });
        worker.once("exit", (code) => {
          if (code !== 0 && !failed && !results.has(task.taskId)) {
            active--;
            failed = true;
            reject(new Error(`estimate worker exited with code ${code}`));
          }
        });
      }
    };
    startNext();
  });
}

export function estimateClustersSynchronously(tasks: EstimateTask[], opts: ThreadPoolOptions): Map<number, OpSearchResult> {
  const out = new Map<number, OpSearchResult>();
  for (const task of tasks) out.set(task.taskId, estimateForShape(opts.hardware, task.shape, opts.candidates, opts.objective, opts.maxResultsPerOp, opts.calibration, opts.scaleSim));
  return out;
}
