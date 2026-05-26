import path from "node:path";
import { mkdir } from "node:fs/promises";
export function getWorkspaceRoot() { return process.env.TILEFORGE_WORKSPACE_ROOT ? path.resolve(process.env.TILEFORGE_WORKSPACE_ROOT) : path.join(process.cwd(), ".tileforge"); }
export function getJobRoot() { return process.env.TILEFORGE_JOB_ROOT ? path.resolve(process.env.TILEFORGE_JOB_ROOT) : path.join(getWorkspaceRoot(), "jobs"); }
export const jobRoot = getJobRoot();
export async function ensureWorkspaceRoot() { await mkdir(getWorkspaceRoot(), { recursive: true }); }
export async function ensureJobRoot() { await ensureWorkspaceRoot(); await mkdir(getJobRoot(), { recursive: true }); }
export function jobDir(id: string) { return path.join(getJobRoot(), id); }
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
