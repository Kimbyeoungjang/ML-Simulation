import { parentPort, workerData } from "node:worker_threads";
import type { HardwareConfig, MatmulShape, Objective, SearchRequest, TileCandidates } from "../types/domain";
import { estimateForShape } from "../lib/estimator";

export interface EstimateWorkerTask {
  taskId: number;
  shape: MatmulShape;
  hardware: HardwareConfig;
  candidates: TileCandidates;
  objective: Objective;
  maxResultsPerOp: number;
  calibration?: SearchRequest["calibration"];
}

async function main() {
  const task = workerData as EstimateWorkerTask;
  const result = estimateForShape(task.hardware, task.shape, task.candidates, task.objective, task.maxResultsPerOp, task.calibration);
  parentPort?.postMessage({ taskId: task.taskId, ok: true, result });
}

main().catch((error) => {
  parentPort?.postMessage({ taskId: (workerData as EstimateWorkerTask)?.taskId ?? -1, ok: false, error: error instanceof Error ? error.message : String(error) });
});
