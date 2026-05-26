import { NextResponse } from "next/server";
import { createJob, listJobsPaged } from "@/server/jobStore";
import { formatZodError, parseJobKind, parseSearchRequest } from "@/lib/validation";
import { getExternalToolsStatus } from "@/server/externalStatus";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
  const cursor = url.searchParams.get("cursor") ?? undefined;
  const status = url.searchParams.get("status") as any;
  const since = url.searchParams.get("since") ?? undefined;
  const dashboard = url.searchParams.get("dashboard") === "1" || url.searchParams.get("view") === "dashboard";
  const page = url.searchParams.get("page") ? Number(url.searchParams.get("page")) : undefined;
  const includeExternal = url.searchParams.get("external") === "1";
  const payload = await listJobsPaged({ limit, cursor, status, since, dashboard, page });
  return NextResponse.json({ ...payload, externalTools: includeExternal ? await getExternalToolsStatus() : undefined });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const request = parseSearchRequest(body.request ?? body);
    const job = await createJob(parseJobKind(body.kind), request, body.name);
    return NextResponse.json(job);
  } catch (error: any) {
    const detail = formatZodError(error);
    const quota = String(error?.message ?? "").startsWith("JOB_QUOTA_EXCEEDED");
    return NextResponse.json({ error: quota ? "Job quota exceeded" : "Invalid job request", code: quota ? "JOB_QUOTA_EXCEEDED" : "VALIDATION_ERROR", detail }, { status: quota ? 429 : 400 });
  }
}
