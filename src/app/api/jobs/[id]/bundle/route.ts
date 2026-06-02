import { NextResponse } from "next/server";
import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { jobDir } from "@/server/workspace";
import { createZip } from "@/lib/zip";
import { quotaConfig } from "@/lib/quotas";
import { verifyJobIntegrityFromManifest } from "@/server/artifactIntegrity";

const SKIP_BUNDLE_FILES = new Set(["job.lock"]);

type FilePlan = { name: string; file: string; size: number };

function maxBundleFiles(): number {
  const parsed = Number(process.env.TILEFORGE_MAX_BUNDLE_FILES ?? 20000);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? Math.floor(parsed) : 20000, 200000));
}

async function collectFilePlans(root: string, dir = root, prefix = ""): Promise<FilePlan[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const out: FilePlan[] = [];
  for (const entry of entries) {
    if (entry.name.endsWith(".tmp") || SKIP_BUNDLE_FILES.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...await collectFilePlans(root, full, rel));
    else if (entry.isFile()) {
      const s = await stat(full).catch(() => null);
      if (s?.isFile()) out.push({ name: rel, file: full, size: s.size });
    }
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

async function parseSelectedPathsFromBody(req: Request): Promise<string[] | undefined> {
  const body = await req.json().catch(() => ({}));
  const raw = body?.paths;
  if (!Array.isArray(raw)) return undefined;
  return raw.map((x) => String(x)).filter(Boolean);
}

function normalizeSelectedPath(raw: string): string | undefined {
  const rel = raw.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!rel || rel.split("/").some((part) => part === ".." || part === "")) return undefined;
  return rel;
}

async function collectSelectedFilePlans(root: string, selected: string[]): Promise<FilePlan[]> {
  const out: FilePlan[] = [];
  const resolvedRoot = path.resolve(root);
  for (const relRaw of selected) {
    const rel = normalizeSelectedPath(relRaw);
    if (!rel) continue;
    const target = path.resolve(resolvedRoot, rel);
    if (!target.startsWith(resolvedRoot + path.sep) && target !== resolvedRoot) continue;
    const st = await stat(target).catch(() => null);
    if (!st) continue;
    if (st.isDirectory()) out.push(...await collectFilePlans(resolvedRoot, target, rel));
    else if (st.isFile()) out.push({ name: rel, file: target, size: st.size });
  }
  return out;
}

function validatePlan(plan: FilePlan[]) {
  const maxBytes = quotaConfig().maxBundleMB * 1024 * 1024;
  const maxFiles = maxBundleFiles();
  let totalBytes = 0;
  for (const item of plan) totalBytes += item.size;
  if (plan.length > maxFiles) {
    return { ok: false as const, response: NextResponse.json({ error: "Bundle has too many files", code: "BUNDLE_TOO_MANY_FILES", files: plan.length, maxFiles }, { status: 413 }) };
  }
  if (totalBytes > maxBytes) {
    return { ok: false as const, response: NextResponse.json({ error: "Bundle too large", code: "BUNDLE_TOO_LARGE", totalBytes, maxBytes }, { status: 413 }) };
  }
  return { ok: true as const, totalBytes };
}

async function readPlannedFiles(plan: FilePlan[]): Promise<Record<string, Buffer>> {
  const files: Record<string, Buffer> = {};
  for (const item of plan) files[item.name] = await readFile(item.file);
  return files;
}

async function bundleResponse(id: string, selected: string[] | undefined) {
  const dir = jobDir(id);
  const plan = selected?.length ? await collectSelectedFilePlans(dir, selected) : await collectFilePlans(dir);
  if (!plan.length) {
    return NextResponse.json({ error: "No artifacts selected or found", code: "NO_ARTIFACTS" }, { status: 404 });
  }
  const validation = validatePlan(plan);
  if (!validation.ok) return validation.response;

  // Full bundle verification can hash many files. For selected downloads, verify
  // only known selected artifacts; unknown log/internal files are path-checked and
  // included without forcing a full manifest scan.
  const verifyNames = selected?.length ? plan.map((item) => item.name) : undefined;
  const integrity = await verifyJobIntegrityFromManifest(id, { names: verifyNames });
  if (!integrity.ok) {
    return NextResponse.json({ error: "Artifact integrity check failed", code: "ARTIFACT_INTEGRITY_FAILED", failures: integrity.failures }, { status: 409 });
  }

  const zip = createZip(await readPlannedFiles(plan));
  const suffix = selected?.length ? "selected" : "all";
  const body = new Blob([zip as unknown as BlobPart], { type: "application/zip" });
  return new NextResponse(body, {
    headers: {
      "content-type": "application/zip",
      "content-length": String(zip.length),
      "content-disposition": `attachment; filename=tileforge-${id}-${suffix}.zip`,
      "x-tileforge-bundle-files": String(plan.length),
      "x-tileforge-bundle-source-bytes": String(validation.totalBytes),
      "x-tileforge-integrity-verified": String(integrity.verified),
      "x-tileforge-integrity-skipped": String(integrity.skipped),
    },
  });
}

export async function GET(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return bundleResponse(id, parseSelectedPaths(req));
}

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  return bundleResponse(id, await parseSelectedPathsFromBody(req));
}
