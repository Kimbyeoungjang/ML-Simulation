import type { MatmulShape } from "@/types/domain";
export function parseShapesCsv(text: string): MatmulShape[] {
  const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  if (!lines.length) return [];
  const header = lines[0].split(",").map(h=>h.trim().toLowerCase());
  const idx = (name: string) => header.indexOf(name);
  const required = ["m","n","k"];
  for (const r of required) if (idx(r) < 0) throw new Error(`CSV missing column: ${r}`);
  return lines.slice(1).map((line, i) => {
    const cells = line.split(",").map(c=>c.trim());
    const num = (name: string, fallback?: number) => { const j = idx(name); const v = j >= 0 ? Number(cells[j]) : fallback; if (!Number.isFinite(v)) throw new Error(`Invalid ${name} at CSV row ${i+2}`); return v as number; };
    const str = (name: string, fallback: string) => { const j = idx(name); return j >= 0 && cells[j] ? cells[j] : fallback; };
    return { id: str("id", `csv_${i}`), model: str("model", "csv-model"), opName: str("op_name", str("opname", `op_${i}`)), m: num("m"), n: num("n"), k: num("k"), dtypeBytes: num("dtype_bytes", 2), source: "csv" };
  });
}
export function shapesToCsv(shapes: MatmulShape[]): string {
  return ["id,model,op_name,m,n,k,dtype_bytes,source", ...shapes.map(s => [s.id,s.model,s.opName,s.m,s.n,s.k,s.dtypeBytes,s.source ?? "manual"].join(","))].join("\n");
}
