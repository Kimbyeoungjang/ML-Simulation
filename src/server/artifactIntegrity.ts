import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { jobDir } from "./workspace";

export type ArtifactIntegrity = {
  name: string;
  path: string;
  sizeBytes: number;
  sha256: string;
  verifiedAt?: string;
  schemaVersion?: string;
};

export async function sha256File(filePath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash("sha256");
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("end", () => resolve(hash.digest("hex")));
    stream.on("error", reject);
  });
}

export async function computeArtifactIntegrity(jobId: string, name: string, schemaVersion?: string): Promise<ArtifactIntegrity> {
  const filePath = path.join(jobDir(jobId), name);
  const s = await stat(filePath);
  return { name, path: filePath, sizeBytes: s.size, sha256: await sha256File(filePath), verifiedAt: new Date().toISOString(), schemaVersion };
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

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let index = 0;
  async function worker() {
    while (index < items.length) {
      const i = index++;
      out[i] = await fn(items[i]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), items.length) }, worker));
  return out;
}

function integrityConcurrency(): number {
  const parsed = Number(process.env.TILEFORGE_ARTIFACT_HASH_CONCURRENCY ?? 8);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? Math.floor(parsed) : 8, 32));
}

function normalizeArtifactName(name: string): string {
  return name.replace(/\\/g, "/").replace(/^\/+/, "");
}

export async function computeJobIntegrityManifest(jobId: string, names: string[]) {
  const uniqueNames = Array.from(new Set(names.map(normalizeArtifactName).filter(Boolean)));
  const artifacts = await mapWithConcurrency(uniqueNames, integrityConcurrency(), (name) => computeArtifactIntegrity(jobId, name));
  return { schemaVersion: "tileforge.integrity.v1", jobId, generatedAt: new Date().toISOString(), artifacts };
}

export async function verifyJobIntegrityFromManifest(
  jobId: string,
  options: { names?: string[]; concurrency?: number } = {},
): Promise<{ ok: boolean; failures: Array<{ name: string; reason: string }>; verified: number; skipped: number }> {
  try {
    const manifestPath = path.join(jobDir(jobId), "artifact_integrity.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    const requested = options.names
      ? new Set(options.names.map(normalizeArtifactName).filter((name) => name && name !== "artifact_integrity.json"))
      : undefined;
    const manifestItems = (Array.isArray(manifest.artifacts) ? manifest.artifacts : []) as ArtifactIntegrity[];
    const items = requested
      ? manifestItems.filter((item) => requested.has(normalizeArtifactName(item.name)))
      : manifestItems;
    const failures: Array<{ name: string; reason: string }> = [];
    const results = await mapWithConcurrency(items, options.concurrency ?? integrityConcurrency(), verifyArtifactIntegrity);
    results.forEach((result, index) => {
      if (!result.ok) failures.push({ name: items[index]?.name ?? "unknown", reason: result.reason ?? "unknown integrity failure" });
    });
    const verifiedNames = new Set(items.map((item) => normalizeArtifactName(item.name)));
    const skipped = requested ? Math.max(0, requested.size - verifiedNames.size) : 0;
    return { ok: failures.length === 0, failures, verified: items.length, skipped };
  } catch (e: any) {
    return { ok: false, failures: [{ name: "artifact_integrity.json", reason: e?.message ?? String(e) }], verified: 0, skipped: 0 };
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
