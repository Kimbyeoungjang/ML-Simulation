import { NextResponse } from "next/server";
import { readdir, readFile, stat } from "node:fs/promises";
import { assertSafeJobId, isPublicArtifactPath, jobArtifactPath, jobDir, resolveInside } from "@/server/workspace";
import { createZip } from "@/lib/zip";
import { quotaConfig } from "@/lib/quotas";
import { verifyJobIntegrityFromManifest } from "@/server/artifactIntegrity";
import { boundedInt, boundedStringArray } from "@/server/requestLimits";

type FileRef = { name: string; path: string; size: number };

function maxBundleFiles(): number {
  return boundedInt(process.env.TILEFORGE_MAX_BUNDLE_FILES, 500, 1, 5000);
}

async function collectFileRefs(root: string, dir = root, prefix = "", depth = 4, limit = maxBundleFiles()): Promise<FileRef[]> {
  if (depth < 0 || limit <= 0) return [];
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: FileRef[] = [];
  for (const entry of entries) {
    if (out.length >= limit) break;
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (!isPublicArtifactPath(rel)) continue;
    const full = resolveInside(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...await collectFileRefs(root, full, rel, depth - 1, limit - out.length));
      continue;
    }
    if (!entry.isFile()) continue;
    const s = await stat(full).catch(() => null);
    if (!s?.isFile()) continue;
    out.push({ name: rel, path: full, size: s.size });
  }
  return out;
}

function parseSelectedPaths(req: Request): string[] | undefined {
  const url = new URL(req.url);
  const raw = url.searchParams.get("paths");
  if (!raw) return undefined;
  try {
    const parsed = JSON.parse(raw);
    return boundedStringArray(parsed, [], maxBundleFiles(), 300);
  } catch {
    return boundedStringArray(raw.split(","), [], maxBundleFiles(), 300);
  }
}

async function collectSelectedFileRefs(id: string, root: string, selected: string[]): Promise<FileRef[]> {
  const out: FileRef[] = [];
  const maxFiles = maxBundleFiles();
  for (const relRaw of selected) {
    if (out.length >= maxFiles) break;
    const rel = relRaw.replace(/\\/g, "/");
    let target: string;
    try { if (!isPublicArtifactPath(rel)) continue; target = jobArtifactPath(id, rel); } catch { continue; }
    const st = await stat(target).catch(() => null);
    if (!st) continue;
    if (st.isDirectory()) out.push(...await collectFileRefs(root, target, rel, 4, maxFiles - out.length));
    else if (st.isFile()) out.push({ name: rel, path: target, size: st.size });
  }
  return out;
}

async function readBundleFiles(refs: FileRef[], maxBytes: number): Promise<{ files?: Record<string, Buffer>; totalBytes: number; error?: string }> {
  let totalBytes = 0;
  for (const ref of refs) {
    totalBytes += ref.size;
    if (totalBytes > maxBytes) return { totalBytes, error: "BUNDLE_TOO_LARGE" };
  }
  const files: Record<string, Buffer> = {};
  for (const ref of refs) files[ref.name] = await readFile(ref.path);
  return { files, totalBytes };
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try { assertSafeJobId(id); } catch { return NextResponse.json({ error: "invalid job id" }, { status: 400 }); }
  const integrity = await verifyJobIntegrityFromManifest(id);
  if (!integrity.ok) {
    return NextResponse.json({ error: "Artifact integrity check failed", code: "ARTIFACT_INTEGRITY_FAILED", failures: integrity.failures }, { status: 409 });
  }
  const dir = jobDir(id);
  const selected = parseSelectedPaths(req);
  const refs = selected?.length ? await collectSelectedFileRefs(id, dir, selected) : await collectFileRefs(dir);
  if (!refs.length) {
    return NextResponse.json({ error: "No artifacts selected or found", code: "NO_ARTIFACTS" }, { status: 404 });
  }
  const maxBytes = quotaConfig().maxBundleMB * 1024 * 1024;
  const readResult = await readBundleFiles(refs, maxBytes);
  if (readResult.error === "BUNDLE_TOO_LARGE") {
    return NextResponse.json({ error: "Bundle too large", code: "BUNDLE_TOO_LARGE", totalBytes: readResult.totalBytes, maxBytes }, { status: 413 });
  }
  const zip = createZip(readResult.files ?? {});
  const suffix = selected?.length ? "selected" : "all";
  const body = new Blob([zip as unknown as BlobPart], { type: "application/zip" });
  return new NextResponse(body, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename=tileforge-${id}-${suffix}.zip` } });
}

export const __bundleRouteForTests = { parseSelectedPaths, collectFileRefs, collectSelectedFileRefs, maxBundleFiles };
