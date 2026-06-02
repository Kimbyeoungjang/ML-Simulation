import { NextResponse } from "next/server";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { jobDir } from "@/server/workspace";

const INTERNAL_JOB_FILES = new Set(["job.json", "job.json.tmp", "job.lock", "events.jsonl", "events.ndjson"]);

type ArtifactNameIndex = { expiresAt: number; names: string[] };
const artifactIndexCache = new Map<string, ArtifactNameIndex>();
const artifactIndexInflight = new Map<string, Promise<string[]>>();

function cacheMs(): number {
  const parsed = Number(process.env.TILEFORGE_ARTIFACT_LIST_CACHE_MS ?? 5000);
  return Math.max(0, Math.min(Number.isFinite(parsed) ? parsed : 5000, 60000));
}

function parsePositiveInt(value: string | null, fallback: number, max: number): number {
  const parsed = Number(value ?? fallback);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(1, Math.min(Math.floor(parsed), max));
}

async function artifactNamesForJob(id: string, dir: string): Promise<string[]> {
  const ttl = cacheMs();
  const now = Date.now();
  const cached = artifactIndexCache.get(id);
  if (ttl > 0 && cached && cached.expiresAt > now) return cached.names;
  const existing = artifactIndexInflight.get(id);
  if (existing) return existing;
  const work = (async () => {
    const names = (await readdir(dir, { withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => entry.name)
      .filter((name) => !INTERNAL_JOB_FILES.has(name) && !name.endsWith(".tmp"))
      .sort((a, b) => a.localeCompare(b));
    if (ttl > 0) artifactIndexCache.set(id, { names, expiresAt: Date.now() + ttl });
    return names;
  })();
  artifactIndexInflight.set(id, work);
  try {
    return await work;
  } finally {
    artifactIndexInflight.delete(id);
  }
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const dir = jobDir(id);
  const page = parsePositiveInt(url.searchParams.get("page"), 1, 100_000);
  const limitParam = url.searchParams.get("limit");
  const limit = limitParam ? parsePositiveInt(limitParam, 200, 1000) : undefined;
  const includeSize = url.searchParams.get("includeSize") === "1" || url.searchParams.get("size") === "1";
  const names = await artifactNamesForJob(id, dir);
  const total = names.length;
  const start = limit ? (page - 1) * limit : 0;
  const picked = limit ? names.slice(start, start + limit) : names;
  const artifacts = [];
  for (const name of picked) {
    if (!includeSize) {
      artifacts.push({
        name,
        url: `/api/jobs/${id}/artifact?path=${encodeURIComponent(name)}`,
      });
      continue;
    }
    const s = await stat(path.join(dir, name)).catch(() => null);
    if (!s?.isFile()) continue;
    artifacts.push({
      name,
      size: s.size,
      url: `/api/jobs/${id}/artifact?path=${encodeURIComponent(name)}`,
    });
  }
  return NextResponse.json({
    id,
    artifacts,
    total,
    page,
    pageSize: limit ?? total,
    totalPages: limit ? Math.max(1, Math.ceil(total / limit)) : 1,
    hasMore: limit ? start + picked.length < total : false,
    cached: artifactIndexCache.has(id),
  });
}
