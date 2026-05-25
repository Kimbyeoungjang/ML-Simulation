import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { SearchRequest, SearchResponse } from "@/types/domain";
import { hashObject } from "./hash";
import { getWorkspaceRoot } from "@/server/workspace";

const ESTIMATOR_VERSION = "tileforge-estimator-v0.9";
export function cacheKey(req: SearchRequest) { return hashObject({ estimatorVersion: ESTIMATOR_VERSION, req }); }
function cacheDir(key: string) { return path.join(getWorkspaceRoot(), "cache", key); }
export async function readEstimateCache(req: SearchRequest): Promise<SearchResponse | undefined> {
  if (process.env.TILEFORGE_DISABLE_CACHE === "1") return undefined;
  try { return JSON.parse(await readFile(path.join(cacheDir(cacheKey(req)), "result.json"), "utf8")); } catch { return undefined; }
}
export async function writeEstimateCache(req: SearchRequest, res: SearchResponse) {
  if (process.env.TILEFORGE_DISABLE_CACHE === "1") return;
  const dir = cacheDir(cacheKey(req));
  await mkdir(dir, { recursive: true });
  const tmp = path.join(dir, "result.json.tmp");
  await writeFile(tmp, JSON.stringify(res), "utf8");
  await rename(tmp, path.join(dir, "result.json"));
}
