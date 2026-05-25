import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { assertSafeJobId, assertPublicArtifactPath, jobArtifactPath, jobDir } from "./workspace";

export type ArtifactIntegrity = {
  name: string;
  path: string;
  sizeBytes: number;
  sha256: string;
  verifiedAt?: string;
  schemaVersion?: string;
};

export async function sha256File(filePath: string): Promise<string> {
  const hash = createHash("sha256");
  await new Promise<void>((resolve, reject) => {
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", resolve);
  });
  return hash.digest("hex");
}

export async function computeArtifactIntegrity(jobId: string, name: string, schemaVersion?: string): Promise<ArtifactIntegrity> {
  assertSafeJobId(jobId);
  const safeName = assertPublicArtifactPath(name);
  const filePath = jobArtifactPath(jobId, safeName);
  const s = await stat(filePath);
  return { name: safeName, path: filePath, sizeBytes: s.size, sha256: await sha256File(filePath), verifiedAt: new Date().toISOString(), schemaVersion };
}

export async function verifyArtifactIntegrity(record: ArtifactIntegrity): Promise<{ ok: boolean; reason?: string }> {
  try {
    const s = await stat(record.path);
    if (s.size !== record.sizeBytes) return { ok: false, reason: `size mismatch: expected ${record.sizeBytes}, got ${s.size}` };
    const digest = await sha256File(record.path);
    if (digest !== record.sha256) return { ok: false, reason: `sha256 mismatch for ${record.name}` };
    return { ok: true };
  } catch (e: any) {
    return { ok: false, reason: e?.message ?? String(e) };
  }
}

export async function computeJobIntegrityManifest(jobId: string, names: string[]) {
  const artifacts: ArtifactIntegrity[] = [];
  for (const name of names) artifacts.push(await computeArtifactIntegrity(jobId, name));
  return { schemaVersion: "tileforge.integrity.v1", jobId, generatedAt: new Date().toISOString(), artifacts };
}


export async function verifyJobIntegrityFromManifest(jobId: string): Promise<{ ok: boolean; failures: Array<{ name: string; reason: string }> }> {
  try {
    assertSafeJobId(jobId);
    const manifestPath = path.join(jobDir(jobId), "artifact_integrity.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const failures: Array<{ name: string; reason: string }> = [];
    for (const item of manifest.artifacts ?? []) {
      const name = String(item?.name ?? "");
      try {
        const safeName = assertPublicArtifactPath(name);
        const filePath = jobArtifactPath(jobId, safeName);
        const result = await verifyArtifactIntegrity({
          name: safeName,
          path: filePath,
          sizeBytes: Number(item?.sizeBytes),
          sha256: String(item?.sha256 ?? ""),
          schemaVersion: item?.schemaVersion,
          verifiedAt: item?.verifiedAt,
        });
        if (!result.ok) failures.push({ name: safeName, reason: result.reason ?? "unknown integrity failure" });
      } catch (error: any) {
        failures.push({ name: name || "<missing>", reason: error?.message ?? String(error) });
      }
    }
    return { ok: failures.length === 0, failures };
  } catch (e: any) {
    return { ok: false, failures: [{ name: "artifact_integrity.json", reason: e?.message ?? String(e) }] };
  }
}


export const REQUIRED_JOB_ARTIFACTS = [
  "result.json",
  "manifest.json",
  "report.md",
  "best_tile_policy.csv",
  "artifact_integrity.json"
];

export async function verifyRequiredArtifacts(jobId: string): Promise<{ ok: boolean; missing: string[]; integrityFailures: Array<{ name: string; reason: string }> }> {
  const missing: string[] = [];
  for (const name of REQUIRED_JOB_ARTIFACTS) {
    try { await stat(path.join(jobDir(jobId), name)); } catch { missing.push(name); }
  }
  const integrity = await verifyJobIntegrityFromManifest(jobId);
  return { ok: missing.length === 0 && integrity.ok, missing, integrityFailures: integrity.failures };
}
