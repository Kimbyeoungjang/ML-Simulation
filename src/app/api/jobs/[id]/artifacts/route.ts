import { NextResponse } from "next/server";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { jobDir } from "@/server/workspace";

const INTERNAL_JOB_FILES = new Set(["job.json", "job.json.tmp", "job.lock", "events.jsonl"]);

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const dir = jobDir(id);
  const names = await readdir(dir);
  const artifacts = [];
  for (const name of names) {
    if (INTERNAL_JOB_FILES.has(name) || name.endsWith(".tmp")) continue;
    const s = await stat(path.join(dir, name));
    if (!s.isFile()) continue;
    artifacts.push({
      name,
      size: s.size,
      url: `/api/jobs/${id}/artifact?path=${encodeURIComponent(name)}`,
    });
  }
  artifacts.sort((a, b) => a.name.localeCompare(b.name));
  return NextResponse.json({ id, artifacts });
}
