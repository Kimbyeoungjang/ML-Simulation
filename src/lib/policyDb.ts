import type { SearchResponse } from "@/types/domain";
export interface PolicyDbEntry { key: string; model: string; opName: string; m: number; n: number; k: number; array: string; tile: string; cycles: number; utilization: number; createdAt: string; }
export function responseToPolicyEntries(res: SearchResponse): PolicyDbEntry[] {
  const h = res.request.hardware;
  return res.results.map(r => ({ key: `${r.shape.m}x${r.shape.n}x${r.shape.k}@${h.arrayRows}x${h.arrayCols}`, model: r.shape.model, opName: r.shape.opName, m: r.shape.m, n: r.shape.n, k: r.shape.k, array: `${h.arrayRows}x${h.arrayCols}`, tile: `${r.best.tileM}x${r.best.tileN}x${r.best.tileK}`, cycles: r.best.cycles, utilization: r.best.utilization, createdAt: new Date().toISOString() }));
}
export function mergePolicyDb(oldEntries: PolicyDbEntry[], newEntries: PolicyDbEntry[]): PolicyDbEntry[] {
  const map = new Map<string, PolicyDbEntry>();
  for (const e of oldEntries) map.set(`${e.key}:${e.opName}`, e);
  for (const e of newEntries) {
    const k = `${e.key}:${e.opName}`;
    const old = map.get(k);
    if (!old || e.cycles < old.cycles) map.set(k, e);
  }
  return [...map.values()].sort((a,b)=>a.key.localeCompare(b.key));
}
