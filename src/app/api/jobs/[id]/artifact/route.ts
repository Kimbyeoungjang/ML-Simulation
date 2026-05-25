import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { jobDir } from "@/server/workspace";

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const url = new URL(req.url);
  const artifactPath = url.searchParams.get("path");
  if (!artifactPath) {
    return NextResponse.json({ error: "path query parameter is required" }, { status: 400 });
  }
  const root = path.resolve(jobDir(id));
  const target = path.resolve(root, artifactPath);
  if (!target.startsWith(root + path.sep) && target !== root) {
    return NextResponse.json({ error: "invalid artifact path" }, { status: 400 });
  }
  const data = await readFile(target);
  const headers: Record<string, string> = { "content-type": "text/plain; charset=utf-8" };
  if (url.searchParams.get("download") === "1") {
    headers["content-disposition"] = `attachment; filename="${encodeURIComponent(path.basename(artifactPath))}"`;
  }
  return new NextResponse(data, { headers });
}
