import path from "node:path";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { jobDir } from "./workspace";
import { nowIso } from "@/lib/determinism";

export type StructuredJobEvent = {
  time: string;
  level: "debug" | "info" | "warn" | "error";
  jobId: string;
  stage?: string;
  code?: string;
  message: string;
  data?: unknown;
};

function sanitize(value: string) {
  return value.replace(/[\r\n]+/g, " ").slice(0, 20_000);
}

export async function appendJobEvent(jobId: string, event: Omit<StructuredJobEvent, "time" | "jobId">) {
  const dir = jobDir(jobId);
  await mkdir(dir, { recursive: true });
  const record: StructuredJobEvent = {
    time: nowIso(),
    jobId,
    ...event,
    message: sanitize(event.message)
  };
  await appendFile(path.join(dir, "events.ndjson"), JSON.stringify(record) + "\n", "utf8");
}

export async function readJobEvents(jobId: string, limit = 500): Promise<StructuredJobEvent[]> {
  try {
    const text = await readFile(path.join(jobDir(jobId), "events.ndjson"), "utf8");
    return text.trim().split(/\n+/).slice(-limit).map(line => JSON.parse(line));
  } catch {
    return [];
  }
}
