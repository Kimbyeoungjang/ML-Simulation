import path from "node:path";
import { appendFile, mkdir } from "node:fs/promises";
import { jobDir } from "./workspace";
import { nowIso } from "@/lib/determinism";
import { readTextTail } from "./fileTail";

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
    const safeLimit = Math.min(Math.max(Math.floor(limit), 1), 5000);
    const tail = await readTextTail(path.join(jobDir(jobId), "events.ndjson"), Math.max(64_000, safeLimit * 1200));
    const lines = tail.text.trim().split(/\n+/).slice(-safeLimit);
    const events: StructuredJobEvent[] = [];
    for (const line of lines) {
      try { events.push(JSON.parse(line)); } catch { /* ignore partial tail line */ }
    }
    return events;
  } catch {
    return [];
  }
}
