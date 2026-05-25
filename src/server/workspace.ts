import path from "node:path";
import { mkdir } from "node:fs/promises";

const JOB_ID_RE = /^[A-Za-z0-9_-]{3,80}$/;
const INTERNAL_ARTIFACT_NAMES = new Set(["job.json", "job.lock", "events.ndjson"]);

export function getWorkspaceRoot() {
  return process.env.TILEFORGE_WORKSPACE_ROOT
    ? path.resolve(process.env.TILEFORGE_WORKSPACE_ROOT)
    : path.join(process.cwd(), ".tileforge");
}

export function getJobRoot() {
  return process.env.TILEFORGE_JOB_ROOT
    ? path.resolve(process.env.TILEFORGE_JOB_ROOT)
    : path.join(getWorkspaceRoot(), "jobs");
}

export const jobRoot = getJobRoot();

export async function ensureWorkspaceRoot() {
  await mkdir(getWorkspaceRoot(), { recursive: true });
}

export async function ensureJobRoot() {
  await ensureWorkspaceRoot();
  await mkdir(getJobRoot(), { recursive: true });
}

export function isSafeJobId(id: string): boolean {
  return JOB_ID_RE.test(id) && !id.includes("..") && !id.includes("/") && !id.includes("\\");
}

export function assertSafeJobId(id: string): string {
  if (!isSafeJobId(id)) throw new Error(`Invalid job id: ${id}`);
  return id;
}

export function resolveInside(root: string, ...segments: string[]): string {
  const resolvedRoot = path.resolve(root);
  const target = path.resolve(resolvedRoot, ...segments);
  if (target !== resolvedRoot && !target.startsWith(resolvedRoot + path.sep)) {
    throw new Error("Path escapes workspace root");
  }
  return target;
}

export function jobDir(id: string) {
  return resolveInside(getJobRoot(), assertSafeJobId(id));
}

export function normalizeArtifactPath(artifactPath: string): string {
  const normalized = artifactPath.replace(/\\/g, "/").replace(/^\.\//, "");
  const parts = normalized.split("/");
  if (
    !normalized ||
    normalized.startsWith("/") ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error("Invalid artifact path");
  }
  return parts.join("/");
}

export function isPublicArtifactPath(artifactPath: string): boolean {
  let normalized: string;
  try { normalized = normalizeArtifactPath(artifactPath); }
  catch { return false; }
  const parts = normalized.split("/");
  return parts.every((part) =>
    !INTERNAL_ARTIFACT_NAMES.has(part) &&
    !part.endsWith(".tmp") &&
    !part.startsWith(".")
  );
}

export function assertPublicArtifactPath(artifactPath: string): string {
  const normalized = normalizeArtifactPath(artifactPath);
  if (!isPublicArtifactPath(normalized)) throw new Error("Internal artifact path is not downloadable");
  return normalized;
}

export function jobArtifactPath(id: string, artifactPath: string) {
  return resolveInside(jobDir(id), assertPublicArtifactPath(artifactPath));
}

export function workspacePaths() {
  const workspaceRoot = getWorkspaceRoot();
  return {
    workspaceRoot,
    jobRoot: getJobRoot(),
    cacheRoot: path.join(workspaceRoot, "cache"),
    artifactRoot: path.join(workspaceRoot, "artifacts"),
    dbPath: path.join(workspaceRoot, "tileforge.db")
  };
}
