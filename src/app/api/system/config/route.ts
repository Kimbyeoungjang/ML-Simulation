import { NextResponse } from "next/server";
import { upsertProjectDotEnv } from "@/server/env";
import { maxParallelJobs } from "@/server/jobStore";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ maxParallelJobs: maxParallelJobs(), envKey: "TILEFORGE_MAX_PARALLEL_JOBS" });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const raw = Number(body?.maxParallelJobs ?? body?.parallelJobs ?? body?.value);
  if (!Number.isFinite(raw)) return NextResponse.json({ error: "maxParallelJobs must be a number" }, { status: 400 });
  const value = Math.max(1, Math.min(Math.floor(raw), 32));
  process.env.TILEFORGE_MAX_PARALLEL_JOBS = String(value);
  const written = upsertProjectDotEnv({ TILEFORGE_MAX_PARALLEL_JOBS: String(value) }, process.cwd(), { overwrite: true });
  return NextResponse.json({ ok: true, maxParallelJobs: value, envPath: written.path, changed: written.changed });
}
