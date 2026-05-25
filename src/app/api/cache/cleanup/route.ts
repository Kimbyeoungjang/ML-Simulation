import { NextResponse } from "next/server";
import { rm, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { workspacePaths, resolveInside } from "@/server/workspace";
import { apiBodyLimitBytes, bodyLimitErrorResponse, boundedInt, readLimitedJsonBody } from "@/server/requestLimits";

export async function POST(req: Request) {
  let body: any;
  try { body = await readLimitedJsonBody(req, apiBodyLimitBytes("TILEFORGE_CLEANUP_MAX_BODY_BYTES", 64_000), {}); }
  catch (error) {
    const limit = bodyLimitErrorResponse(error);
    if (limit) return NextResponse.json(limit, { status: limit.status });
    return NextResponse.json({ error: "Invalid cleanup request" }, { status: 400 });
  }
  const olderThanDays = boundedInt(body.olderThanDays, 30, 1, 3650);
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const root = workspacePaths().cacheRoot;
  let deleted = 0;
  try {
    for (const name of await readdir(root)) {
      const p = resolveInside(root, name);
      const s = await stat(p);
      if (s.mtimeMs < cutoff) { await rm(p, { recursive: true, force: true }); deleted++; }
    }
  } catch { /* cache may not exist */ }
  return NextResponse.json({ ok: true, olderThanDays, deleted });
}
