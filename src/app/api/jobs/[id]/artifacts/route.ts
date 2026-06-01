import { NextResponse } from "next/server";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { jobDir } from "@/server/workspace";
import { listJobArtifactsSqlite, sqlitePrimary } from "@/server/sqliteStore";
export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const fromDb = sqlitePrimary() ? listJobArtifactsSqlite(id) : undefined;
  if (fromDb && fromDb.length > 0) {
    return NextResponse.json({
      id,
      artifacts: fromDb.map((a) => ({
        name: a.name,
        path: a.path ?? a.name,
        size: a.size,
        url: `/api/jobs/${id}/artifact?path=${encodeURIComponent(a.path ?? a.name)}`,
      })),
      source: "sqlite",
    });
  }
  const dir = jobDir(id);
  const names = await readdir(dir);
  const internal = new Set(["job.json", "job.lock", "events.log"]);
  const artifacts = await Promise.all(names.filter((name) => !internal.has(name)).map(async name => ({ name, path: name, size: (await stat(path.join(dir, name))).size, url: `/api/jobs/${id}/artifact?path=${encodeURIComponent(name)}` })));
  return NextResponse.json({ id, artifacts, source: "filesystem" });
}
