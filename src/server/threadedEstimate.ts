import type { SearchRequest, SearchResponse } from "@/types/domain";
import { estimateAll } from "@/lib/estimator";
import { estimateWithClusterPool } from "./computePool";

export async function estimateMaybeThreaded(req: SearchRequest): Promise<SearchResponse> {
  const combos = req.shapes.length * req.candidates.tileM.length * req.candidates.tileN.length * req.candidates.tileK.length;
  const threshold = Number(process.env.TILEFORGE_THREAD_THRESHOLD ?? 50000);
  const workers = Number(process.env.TILEFORGE_COMPUTE_WORKERS ?? 0);
  if (workers > 0 || combos >= threshold) return await estimateWithClusterPool(req);
  return estimateAll(req);
}
