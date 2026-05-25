import { NextResponse } from "next/server";
import { deleteJob, listJobs } from "@/server/jobStore";
import { apiBodyLimitBytes, bodyLimitErrorResponse, readLimitedJsonBody } from "@/server/requestLimits";

function daysValue(value: unknown): number {
  const parsed = Number(value ?? 30);
  if (!Number.isFinite(parsed)) return 30;
  return Math.max(1, Math.min(Math.floor(parsed), 3650));
}

export async function POST(req: Request) {
  let body: any;
  try { body = await readLimitedJsonBody(req, apiBodyLimitBytes("TILEFORGE_CLEANUP_MAX_BODY_BYTES", 64_000), {}); }
  catch (error) {
    const limit = bodyLimitErrorResponse(error);
    if (limit) return NextResponse.json(limit, { status: limit.status });
    return NextResponse.json({ error: "Invalid cleanup request" }, { status: 400 });
  }
  const olderThanDays = daysValue(body.olderThanDays);
  const keepRunning = body.keepRunning !== false;
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  let deleted = 0;
  for (const job of await listJobs()) {
    if (keepRunning && (job.status === "queued" || job.status === "running")) continue;
    const ts = Date.parse(job.finishedAt ?? job.updatedAt ?? job.createdAt);
    if (Number.isFinite(ts) && ts < cutoff) { await deleteJob(job.id); deleted++; }
  }
  return NextResponse.json({ ok: true, olderThanDays, deleted });
}
