import { NextResponse } from "next/server";
import { createJob, deleteJob, listJobsPaged, requestCancel } from "@/server/jobStore";
import { formatZodError, parseJobKind, parseSearchRequest } from "@/lib/validation";
import { getExternalToolsStatus } from "@/server/externalStatus";

type JobsGetCache = { key: string; expiresAt: number; payload: any };
let jobsGetCache: JobsGetCache | undefined;
const jobsGetInflight = new Map<string, Promise<any>>();

function jobsGetCacheMs(): number {
  const parsed = Number(process.env.TILEFORGE_JOBS_API_CACHE_MS ?? 2000);
  return Math.max(0, Math.min(Number.isFinite(parsed) ? parsed : 2000, 30000));
}

function stableJobsQueryKey(url: URL): string {
  const params = new URLSearchParams(url.searchParams);
  // UI cache busters should not defeat server-side single-flight protection.
  params.delete("t");
  return params.toString();
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const cacheKey = stableJobsQueryKey(url);
  const ttl = jobsGetCacheMs();
  const now = Date.now();
  if (ttl > 0 && jobsGetCache?.key === cacheKey && jobsGetCache.expiresAt > now) {
    return NextResponse.json({ ...jobsGetCache.payload, cached: true });
  }
  const existing = jobsGetInflight.get(cacheKey);
  if (existing) {
    const payload = await existing;
    return NextResponse.json({ ...payload, coalesced: true });
  }

  const work = (async () => {
    const limit = url.searchParams.get("limit") ? Number(url.searchParams.get("limit")) : undefined;
    const cursor = url.searchParams.get("cursor") ?? undefined;
    const status = url.searchParams.get("status") as any;
    const since = url.searchParams.get("since") ?? undefined;
    const dashboard = url.searchParams.get("dashboard") === "1" || url.searchParams.get("view") === "dashboard";
    const page = url.searchParams.get("page") ? Number(url.searchParams.get("page")) : undefined;
    const includeExternal = url.searchParams.get("external") === "1";
    const payload = await listJobsPaged({ limit, cursor, status, since, dashboard, page });
    const out = { ...payload, externalTools: includeExternal ? await getExternalToolsStatus() : undefined };
    if (ttl > 0) jobsGetCache = { key: cacheKey, expiresAt: Date.now() + ttl, payload: out };
    return out;
  })();
  jobsGetInflight.set(cacheKey, work);
  try {
    return NextResponse.json(await work);
  } finally {
    jobsGetInflight.delete(cacheKey);
  }
}


async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

function parseIds(body: any): string[] {
  const ids = (Array.isArray(body?.ids) ? body.ids : [])
    .map((x: unknown) => String(x).trim())
    .filter((x: string) => x.length > 0);
  return Array.from(new Set<string>(ids)).slice(0, 20_000);
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const request = parseSearchRequest(body.request ?? body);
    const job = await createJob(parseJobKind(body.kind), request, body.name);
    jobsGetCache = undefined;
    return NextResponse.json(job);
  } catch (error: any) {
    const detail = formatZodError(error);
    const quota = String(error?.message ?? "").startsWith("JOB_QUOTA_EXCEEDED");
    return NextResponse.json({ error: quota ? "Job quota exceeded" : "Invalid job request", code: quota ? "JOB_QUOTA_EXCEEDED" : "VALIDATION_ERROR", detail }, { status: quota ? 429 : 400 });
  }
}


export async function DELETE(req: Request) {
  const body = await req.json().catch(() => ({}));
  const ids = parseIds(body);
  if (!ids.length) return NextResponse.json({ error: "ids array is required" }, { status: 400 });
  let ok = 0;
  const failures: Array<{ id: string; error: string }> = [];
  await mapWithConcurrency(ids, 16, async (id) => {
    try {
      await deleteJob(id);
      ok += 1;
    } catch (error: any) {
      failures.push({ id, error: error?.message ?? String(error) });
    }
  });
  jobsGetCache = undefined;
  return NextResponse.json({ ok: failures.length === 0, requested: ids.length, deleted: ok, failures });
}

export async function PATCH(req: Request) {
  const body = await req.json().catch(() => ({}));
  const ids = parseIds(body);
  if (body.action !== "cancel") return NextResponse.json({ error: "Unsupported action" }, { status: 400 });
  if (!ids.length) return NextResponse.json({ error: "ids array is required" }, { status: 400 });
  let ok = 0;
  const failures: Array<{ id: string; error: string }> = [];
  await mapWithConcurrency(ids, 16, async (id) => {
    try {
      await requestCancel(id);
      ok += 1;
    } catch (error: any) {
      failures.push({ id, error: error?.message ?? String(error) });
    }
  });
  jobsGetCache = undefined;
  return NextResponse.json({ ok: failures.length === 0, requested: ids.length, cancelled: ok, failures });
}
