import type { MatmulShape, SearchResponse, TileCandidateResult } from "@/types/domain";

export interface ShapeCluster { id: string; label: string; shapes: MatmulShape[]; representative: { m: number; n: number; k: number }; recommendedTile?: { tileM: number; tileN: number; tileK: number }; }
export interface RobustPolicy { globalTile: { tileM: number; tileN: number; tileK: number; score: number }; clusters: ShapeCluster[]; markdown: string; csv: string; }
function bucket(v: number): string { if (v <= 128) return "소형"; if (v <= 512) return "중형"; if (v <= 2048) return "대형"; return "초대형"; }
function median(xs: number[]): number { const s = xs.slice().sort((a,b)=>a-b); return s[Math.floor(s.length/2)] ?? 0; }
export function clusterShapes(shapes: MatmulShape[]): ShapeCluster[] {
  const groups = new Map<string, MatmulShape[]>();
  for (const s of shapes) { const key = `M:${bucket(s.m)} N:${bucket(s.n)} K:${bucket(s.k)}`; groups.set(key, [...(groups.get(key) ?? []), s]); }
  return [...groups.entries()].map(([label, ss], i) => ({ id: `cluster_${i+1}`, label, shapes: ss, representative: { m: median(ss.map(s=>s.m)), n: median(ss.map(s=>s.n)), k: median(ss.map(s=>s.k)) } }));
}
export function buildRobustPolicy(response: SearchResponse): RobustPolicy {
  const tileScores = new Map<string, { tileM:number; tileN:number; tileK:number; score:number; count:number }>();
  for (const r of response.results) for (const c of [r.best, ...r.pareto.slice(0, 5)]) {
    const key = `${c.tileM}x${c.tileN}x${c.tileK}`;
    const current = tileScores.get(key) ?? { tileM: c.tileM, tileN: c.tileN, tileK: c.tileK, score: 0, count: 0 };
    current.score += c.score; current.count += 1; tileScores.set(key, current);
  }
  const global = [...tileScores.values()].map(t=>({ ...t, score: t.score / Math.max(1, t.count) - 0.05 * t.count })).sort((a,b)=>a.score-b.score)[0] ?? { tileM:0,tileN:0,tileK:0,score:0 };
  const clusters = clusterShapes(response.request.shapes);
  for (const cl of clusters) {
    const shapeIds = new Set(cl.shapes.map(s=>s.id));
    const members = response.results.filter(r=>shapeIds.has(r.shape.id));
    const scores = new Map<string, { tileM:number; tileN:number; tileK:number; score:number; count:number }>();
    for (const r of members) for (const c of [r.best, ...r.pareto.slice(0, 3)]) {
      const key = `${c.tileM}x${c.tileN}x${c.tileK}`; const cur = scores.get(key) ?? { tileM:c.tileM,tileN:c.tileN,tileK:c.tileK,score:0,count:0 }; cur.score += c.score; cur.count++; scores.set(key, cur);
    }
    const best = [...scores.values()].map(t=>({ ...t, score:t.score/Math.max(1,t.count)})).sort((a,b)=>a.score-b.score)[0];
    if (best) cl.recommendedTile = { tileM: best.tileM, tileN: best.tileN, tileK: best.tileK };
  }
  const csv = ["클러스터,shape_버킷,연산_수,대표_M,대표_N,대표_K,타일_M,타일_N,타일_K", ...clusters.map(c=>[c.id,c.label,c.shapes.length,c.representative.m,c.representative.n,c.representative.k,c.recommendedTile?.tileM,c.recommendedTile?.tileN,c.recommendedTile?.tileK].join(","))].join("\n");
  const markdown = [`# 강건한 타일 정책`, "", `전역 강건 타일: ${global.tileM}x${global.tileN}x${global.tileK}`, "", "| 클러스터 | Shape 버킷 | 연산 수 | 대표 M/N/K | 권장 타일 |", "|---|---|---:|---:|---|", ...clusters.map(c=>`| ${c.id} | ${c.label} | ${c.shapes.length} | ${c.representative.m}/${c.representative.n}/${c.representative.k} | ${c.recommendedTile ? `${c.recommendedTile.tileM}x${c.recommendedTile.tileN}x${c.recommendedTile.tileK}` : "해당 없음"} |`)].join("\n");
  return { globalTile: global, clusters, markdown, csv };
}
