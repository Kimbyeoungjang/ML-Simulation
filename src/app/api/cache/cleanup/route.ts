import { NextResponse } from "next/server";
import { rm, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { workspacePaths } from "@/server/workspace";

export async function POST(req: Request) {
  const body = await req.json().catch(() => ({}));
  const olderThanDays = Number(body.olderThanDays ?? 30);
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  const root = workspacePaths().cacheRoot;
  let deleted = 0;
  try {
    for (const name of await readdir(root)) {
      const p = path.join(root, name);
      const s = await stat(p);
      if (s.mtimeMs < cutoff) { await rm(p, { recursive: true, force: true }); deleted++; }
    }
  } catch { /* cache may not exist */ }
  return NextResponse.json({ ok: true, olderThanDays, deleted });
}
