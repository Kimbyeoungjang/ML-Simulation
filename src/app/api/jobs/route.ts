import { NextResponse } from "next/server";
import { createJob, listJobsPaged } from "@/server/jobStore";
import type { JobStatus } from "@/types/job";
import { formatZodError, parseJobKind, parseSearchRequest } from "@/lib/validation";
import { getExternalToolsStatus } from "@/server/externalStatus";
import { apiBodyLimitBytes, bodyLimitErrorResponse, readLimitedJsonBody } from "@/server/requestLimits";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const rawLimit = Number(url.searchParams.get("limit") ?? "");
  const limit = Number.isFinite(rawLimit) && rawLimit > 0 ? Math.min(Math.floor(rawLimit), 200) : undefined;
  const cursor = url.searchParams.get("cursor") || undefined;
  const rawStatus = url.searchParams.get("status");
  const allowedStatuses = new Set<JobStatus>(["queued", "running", "succeeded", "succeeded_with_warnings", "failed", "cancelled", "skipped_external_tool"]);
  const status = rawStatus && allowedStatuses.has(rawStatus as JobStatus) ? rawStatus as JobStatus : undefined;
  const rawSince = url.searchParams.get("since") || undefined;
  const since = rawSince && Number.isFinite(Date.parse(rawSince)) ? rawSince : undefined;
  return NextResponse.json({ ...(await listJobsPaged({ limit, cursor, status, since })), externalTools: await getExternalToolsStatus() });
}

export async function POST(req: Request) {
  try {
    const body = await readLimitedJsonBody<any>(req, apiBodyLimitBytes("TILEFORGE_JOB_REQUEST_MAX_BODY_BYTES", 4_000_000));
    const request = parseSearchRequest(body.request ?? body);
    const job = await createJob(parseJobKind(body.kind), request, body.name);
    return NextResponse.json(job);
  } catch (error: any) {
    const tooLarge = bodyLimitErrorResponse(error);
    if (tooLarge) return NextResponse.json(tooLarge, { status: tooLarge.status });
    const detail = formatZodError(error);
    const quota = String(error?.message ?? "").startsWith("JOB_QUOTA_EXCEEDED");
    return NextResponse.json({ error: quota ? "Job quota exceeded" : "Invalid job request", code: quota ? "JOB_QUOTA_EXCEEDED" : "VALIDATION_ERROR", detail }, { status: quota ? 429 : 400 });
  }
}
