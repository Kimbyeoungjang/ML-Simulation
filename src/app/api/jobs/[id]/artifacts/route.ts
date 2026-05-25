import { NextResponse } from "next/server";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { assertSafeJobId, isPublicArtifactPath, jobDir, resolveInside } from "@/server/workspace";

type ArtifactListItem = {
  name: string;
  size: number;
  updatedAt: string;
  url: string;
  legacyUrl: string;
};

async function collectArtifacts(id: string, root: string, dir = root, prefix = "", depth = 4): Promise<ArtifactListItem[]> {
  if (depth < 0) return [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const artifacts: ArtifactListItem[] = [];
  for (const entry of entries) {
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!isPublicArtifactPath(rel)) continue;
    const full = resolveInside(dir, entry.name);
    if (entry.isDirectory()) {
      artifacts.push(...await collectArtifacts(id, root, full, rel, depth - 1));
      continue;
    }
    if (!entry.isFile()) continue;
    try {
      const st = await stat(full);
      if (!st.isFile()) continue;
      artifacts.push({
        name: rel,
        size: st.size,
        updatedAt: st.mtime.toISOString(),
        url: `/api/jobs/${encodeURIComponent(id)}/artifact?path=${encodeURIComponent(rel)}`,
        legacyUrl: `/api/jobs/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(path.basename(rel))}`,
      });
    } catch {}
  }
  return artifacts;
}

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try { assertSafeJobId(id); } catch { return NextResponse.json({ error: "invalid job id" }, { status: 400 }); }
  const dir = jobDir(id);
  const artifacts = (await collectArtifacts(id, dir)).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 500);
  return NextResponse.json({ id, artifacts });
}
