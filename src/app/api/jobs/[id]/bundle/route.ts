import { NextResponse } from "next/server";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { jobDir } from "@/server/workspace";
import { createZip } from "@/lib/zip";
import { quotaConfig } from "@/lib/quotas";
import { verifyJobIntegrityFromManifest } from "@/server/artifactIntegrity";

export async function GET(_: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const integrity = await verifyJobIntegrityFromManifest(id);
  if (!integrity.ok) {
    return NextResponse.json({ error: "Artifact integrity check failed", code: "ARTIFACT_INTEGRITY_FAILED", failures: integrity.failures }, { status: 409 });
  }
  const dir = jobDir(id);
  const names = await readdir(dir);
  const files: Record<string, Buffer> = {};
  const maxBytes = quotaConfig().maxBundleMB * 1024 * 1024;
  let totalBytes = 0;
  for (const name of names) {
    if (name.endsWith(".tmp") || name === "job.lock") continue;
    const data = await readFile(path.join(dir, name));
    totalBytes += data.length;
    if (totalBytes > maxBytes) {
      return NextResponse.json({ error: "Bundle too large", code: "BUNDLE_TOO_LARGE", totalBytes, maxBytes }, { status: 413 });
    }
    files[name] = data;
  }
  const zip = createZip(files);
  const body = new Blob([zip as unknown as BlobPart], { type: "application/zip" });
  return new NextResponse(body, { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename=tileforge-${id}.zip` } });
}
