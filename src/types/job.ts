import type { SearchRequest } from "./domain";
export type JobKind = "estimate" | "scalesim" | "iree-compile" | "full-pipeline";
export type JobStatus = "queued" | "running" | "succeeded" | "succeeded_with_warnings" | "failed" | "cancelled" | "skipped_external_tool";
export type JobStage = "created" | "validated" | "queued" | "extracting-shapes" | "estimating" | "generating-artifacts" | "running-scalesim" | "running-iree" | "generating-report" | "done" | "cancelled" | "retrying" | "external-skipped";
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
  stageHistory?: Array<{ stage: JobStage; status: "pending" | "running" | "done" | "failed" | "skipped"; at: string; detail?: string }>;
}
