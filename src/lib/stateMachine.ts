import type { JobStage, JobStatus } from "@/types/job";

export type JobState = `${JobStatus}:${JobStage | "none"}`;

const terminal: JobStatus[] = ["succeeded", "succeeded_with_warnings", "failed", "cancelled", "skipped_external_tool"];

export function isTerminalStatus(status: JobStatus) { return terminal.includes(status); }

export function canTransition(from: JobStatus, to: JobStatus): boolean {
  if (from === to) return true;
  if (from === "queued") return ["running", "cancelled", "failed"].includes(to);
  if (from === "running") return ["succeeded", "succeeded_with_warnings", "failed", "cancelled", "queued", "skipped_external_tool"].includes(to);
  if (from === "failed") return to === "queued";
  if (from === "skipped_external_tool") return to === "queued";
  return false;
}

export function assertTransition(from: JobStatus, to: JobStatus) {
  if (!canTransition(from, to)) throw new Error(`Invalid job transition: ${from} -> ${to}`);
}
