import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import type { SearchRequest, SearchResponse } from "@/types/domain";
import { hashObject } from "./hash";
import { getWorkspaceRoot } from "@/server/workspace";
import { atomicWriteFile } from "@/server/atomic";
import { assertSearchResponseInvariant } from "./invariants";

const ESTIMATOR_VERSION = "tileforge-estimator-v0.9";
export function cacheKey(req: SearchRequest) { return hashObject({ estimatorVersion: ESTIMATOR_VERSION, req }); }
function cacheDir(key: string) { return path.join(getWorkspaceRoot(), "cache", key); }
function resultPath(req: SearchRequest) { return path.join(cacheDir(cacheKey(req)), "result.json"); }

export async function readEstimateCache(req: SearchRequest): Promise<SearchResponse | undefined> {
  if (process.env.TILEFORGE_DISABLE_CACHE === "1") return undefined;
  const file = resultPath(req);
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as SearchResponse;
    assertSearchResponseInvariant(parsed);
    return parsed;
  } catch {
    // A cache hit must never break an estimate request. Remove corrupt/stale
    // entries opportunistically so future requests recompute instead of
    // repeatedly parsing the same bad file.
    await rm(file, { force: true }).catch(() => undefined);
    return undefined;
  }
}

export async function writeEstimateCache(req: SearchRequest, res: SearchResponse) {
  if (process.env.TILEFORGE_DISABLE_CACHE === "1") return;
  assertSearchResponseInvariant(res);
  await atomicWriteFile(resultPath(req), JSON.stringify(res));
}
