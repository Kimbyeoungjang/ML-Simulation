import path from "node:path";
import { appendFile, mkdir, open, stat } from "node:fs/promises";
import { jobDir } from "./workspace";
import { nowIso } from "@/lib/determinism";
import { boundedInt } from "./requestLimits";

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

function intLimit(value: number, fallback: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(Math.floor(value), max));
}

function eventDataMaxBytes(): number {
  return boundedInt(process.env.TILEFORGE_EVENT_DATA_MAX_BYTES, 50_000, 1_024, 1_000_000);
}

function eventTailBytes(): number {
  return boundedInt(process.env.TILEFORGE_EVENT_TAIL_BYTES, 2_000_000, 64_000, 20_000_000);
}

function safeEventData(data: unknown): unknown {
  if (data === undefined) return undefined;
  const maxBytes = eventDataMaxBytes();
  try {
    const json = JSON.stringify(data);
    if (json === undefined) return undefined;
    const bytes = Buffer.byteLength(json, "utf8");
    if (bytes <= maxBytes) return data;
    return {
      truncated: true,
      bytes,
      maxBytes,
      preview: json.slice(0, Math.min(2_000, maxBytes))
    };
  } catch (error: any) {
    return {
      unserializable: true,
      reason: error?.message ?? String(error)
    };
  }
}

async function readTailText(filePath: string, maxBytes: number): Promise<string> {
  const s = await stat(filePath);
  if (!s.isFile()) return "";
  const start = Math.max(0, s.size - maxBytes);
  const length = s.size - start;
  if (length <= 0) return "";
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    const { bytesRead } = await handle.read(buffer, 0, length, start);
    let text = buffer.subarray(0, bytesRead).toString("utf8");
    if (start > 0) {
      const firstNewline = text.indexOf("\n");
      text = firstNewline >= 0 ? text.slice(firstNewline + 1) : "";
    }
    return text;
  } finally {
    await handle.close();
  }
}

export async function appendJobEvent(jobId: string, event: Omit<StructuredJobEvent, "time" | "jobId">) {
  const dir = jobDir(jobId);
  await mkdir(dir, { recursive: true });
  const record: StructuredJobEvent = {
    time: nowIso(),
    jobId,
    ...event,
    message: sanitize(event.message),
    data: safeEventData(event.data)
  };
  await appendFile(path.join(dir, "events.ndjson"), JSON.stringify(record) + "\n", "utf8");
}

export async function readJobEvents(jobId: string, limit = 500): Promise<StructuredJobEvent[]> {
  const safeLimit = intLimit(limit, 500, 1, 5000);
  try {
    const text = await readTailText(path.join(jobDir(jobId), "events.ndjson"), eventTailBytes());
    const events: StructuredJobEvent[] = [];
    for (const line of text.trim().split(/\n+/).slice(-safeLimit * 2)) {
      if (!line.trim()) continue;
      try {
        const parsed = JSON.parse(line) as StructuredJobEvent;
        if (parsed && typeof parsed.message === "string" && typeof parsed.time === "string") events.push(parsed);
      } catch {}
    }
    return events.slice(-safeLimit);
  } catch {
    return [];
  }
}

export const __eventsLogForTests = { safeEventData, readTailText };
