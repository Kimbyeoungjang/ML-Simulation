import type { SearchRequest } from "./domain";
export type JobKind = "estimate" | "scalesim" | "iree-compile" | "full-pipeline" | "estimator-suite-train";
export type JobStatus = "queued" | "running" | "succeeded" | "succeeded_with_warnings" | "failed" | "cancelled" | "skipped_external_tool";
export type JobStage = "created" | "validated" | "queued" | "extracting-shapes" | "estimating" | "generating-artifacts" | "running-scalesim" | "running-iree" | "generating-report" | "preparing-dataset" | "training-tree" | "training-neural" | "validating" | "writing-artifacts" | "done" | "cancelled" | "retrying" | "external-skipped";
export interface JobRecord {
  id: string;
  kind: JobKind;
  name?: string;
  requestHash?: string;
  status: JobStatus;
  stage?: JobStage;
  progress?: number;
  cancelRequested?: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  attempts?: number;
  maxAttempts?: number;
  timeoutMs?: number;
  request: SearchRequest;
  logs: string[];
  artifacts: string[];
  warnings?: string[];
  error?: string;
  estimatorSuite?: {
    mode?: "csv" | "dataset";
    csvText?: string;
    csvPath?: string;
    files?: Array<{ name: string; text: string }>;
    filePaths?: Array<{ name: string; path: string }>;
    options?: Record<string, unknown>;
    dedupe?: boolean;
    activate?: boolean;
  };
  stageHistory?: Array<{ stage: JobStage; status: "pending" | "running" | "done" | "failed" | "skipped"; at: string; detail?: string }>;
}

export interface JobListItem {
  id: string;
  kind: JobKind;
  name?: string;
  requestHash?: string;
  status: JobStatus;
  stage?: JobStage;
  progress?: number;
  cancelRequested?: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
  attempts?: number;
  maxAttempts?: number;
  artifactCount?: number;
  hasArtifacts?: boolean;
  hasReport?: boolean;
  /**
   * Small preview only. Large artifact lists are fetched lazily from
   * /api/jobs/:id/artifacts when the user selects a job.
   */
  artifacts?: string[];
  warningsCount?: number;
  logsCount?: number;
  error?: string;
}
