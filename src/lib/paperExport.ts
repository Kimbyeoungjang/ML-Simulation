import type { SearchResponse } from "@/types/domain";
export function latexPolicyTable(res: SearchResponse): string {
  const rows = res.results.map(r => `${r.shape.model.replaceAll("_","\\_")} & ${r.shape.opName.replaceAll("_","\\_")} & ${r.shape.m}$\\times$${r.shape.n}$\\times$${r.shape.k} & ${r.best.tileM}$\\times$${r.best.tileN}$\\times$${r.best.tileK} & ${(r.best.utilization*100).toFixed(1)}\\% & ${r.best.cycles.toLocaleString()} \\\\`).join("\n");
  return `\\begin{tabular}{llllrr}\n\\toprule\n모델 & 연산 & GEMM & 타일 & 사용률 & 사이클 \\\\ \n\\midrule\n${rows}\n\\bottomrule\n\\end{tabular}`;
}
export function summarySvg(res: SearchResponse): string {
  const w=900,h=280,pad=40; const bests=res.results.map(r=>r.best); const max=Math.max(...bests.map(b=>b.cycles),1); const bars=bests.slice(0,10).map((b,i)=>{ const bw=60, gap=20; const x=pad+i*(bw+gap); const bh=(h-90)*b.cycles/max; const y=h-50-bh; return `<rect x="${x}" y="${y}" width="${bw}" height="${bh}" rx="6"/><text x="${x}" y="${h-28}" font-size="10" transform="rotate(30 ${x} ${h-28})">${b.opName}</text>`; }).join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"><style>rect{fill:#4f46e5}text{font-family:Arial,sans-serif;fill:#111}</style><text x="${pad}" y="24" font-size="18">TileForge 병목 요약</text><text x="${pad}" y="44" font-size="12">전체 사이클: ${res.summary.totalCycles.toLocaleString()}</text>${bars}</svg>`;
}
