import { NextResponse } from "next/server";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { jobDir } from "@/server/workspace";
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const dir = jobDir(id);
  const names = await readdir(dir);
  const artifacts = await Promise.all(names.map(async name => ({ name, size: (await stat(path.join(dir, name))).size, url: `/api/jobs/${id}/artifacts/${encodeURIComponent(name)}` })));
  return NextResponse.json({ id, artifacts });
}
