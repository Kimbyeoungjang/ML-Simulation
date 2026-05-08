import { NextResponse } from "next/server";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { jobDir } from "@/server/workspace";
import { createZip } from "@/lib/zip";
import { quotaConfig } from "@/lib/quotas";
import { verifyJobIntegrityFromManifest } from "@/server/artifactIntegrity";

async function collectFiles(root: string, dir = root, prefix = ""): Promise<Array<{ name: string; data: Buffer }>> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: Array<{ name: string; data: Buffer }> = [];
  for (const entry of entries) {
    if (entry.name.endsWith(".tmp") || entry.name === "job.lock") continue;
    const full = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await collectFiles(root, full, rel));
    else if (entry.isFile()) out.push({ name: rel, data: await readFile(full) });
  }
  return out;
}

function parseSelectedPaths(req: Request): string[] | undefined {
  const url = new URL(req.url);
  const raw = url.searchParams.get("paths");
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) return parsed.map((x) => String(x)).filter(Boolean);
  } catch {
    return raw.split(",").map((x) => x.trim()).filter(Boolean);
  }
  return undefined;
}

async function collectSelectedFiles(root: string, selected: string[]): Promise<Array<{ name: string; data: Buffer }>> {
  const out: Array<{ name: string; data: Buffer }> = [];
  const resolvedRoot = path.resolve(root);
  for (const relRaw of selected) {
    const rel = relRaw.replace(/\\/g, "/");
    if (rel.includes("..")) continue;
    const target = path.resolve(resolvedRoot, rel);
    if (!target.startsWith(resolvedRoot + path.sep) && target !== resolvedRoot) continue;
    const st = await stat(target).catch(() => null);
    if (!st) continue;
    if (st.isDirectory()) out.push(...await collectFiles(resolvedRoot, target, rel));
    else if (st.isFile()) out.push({ name: rel, data: await readFile(target) });
  }
  return out;
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const integrity = await verifyJobIntegrityFromManifest(id);
  if (!integrity.ok) {
    return NextResponse.json({ error: "Artifact integrity check failed", code: "ARTIFACT_INTEGRITY_FAILED", failures: integrity.failures }, { status: 409 });
  }
  const dir = jobDir(id);
  const selected = parseSelectedPaths(req);
  const items = selected?.length ? await collectSelectedFiles(dir, selected) : await collectFiles(dir);
  if (!items.length) {
    return NextResponse.json({ error: "No artifacts selected or found", code: "NO_ARTIFACTS" }, { status: 404 });
  }
  const files: Record<string, Buffer> = {};
  const maxBytes = quotaConfig().maxBundleMB * 1024 * 1024;
  let totalBytes = 0;
  for (const item of items) {
    totalBytes += item.data.length;
    if (totalBytes > maxBytes) {
      return NextResponse.json({ error: "Bundle too large", code: "BUNDLE_TOO_LARGE", totalBytes, maxBytes }, { status: 413 });
    }
    files[item.name] = item.data;
  }
  const zip = createZip(files);
  const suffix = selected?.length ? "selected" : "all";
  const body = new Blob([zip as unknown as BlobPart], { type: "application/zip" });
  return new NextResponse(body, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename=tileforge-${id}-${suffix}.zip` } });
}
