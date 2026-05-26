import { NextResponse } from "next/server";
import { deleteJob, listJobs } from "@/server/jobStore";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const olderThanDays = Number(body.olderThanDays ?? 30);
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
