import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { jobDir } from "@/server/workspace";
export async function GET(_: Request, ctx: { params: Promise<{ id: string; name: string }> }) {
  const { id, name } = await ctx.params;
  const safe = path.basename(name);
  const data = await readFile(path.join(jobDir(id), safe), "utf8");
  return new NextResponse(data, { headers: { "content-type": "text/plain; charset=utf-8" } });
}
