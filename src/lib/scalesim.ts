export interface ParsedScaleSimComputeRow { layer: string; totalCycles?: number; overallUtil?: number; mappingEfficiency?: number; raw: Record<string,string>; }
export function parseScaleSimComputeReport(csv: string): ParsedScaleSimComputeRow[] {
  const lines = csv.split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const header = lines[0].split(",").map(h=>h.trim());
  return lines.slice(1).map(line => {
    const cells = line.split(",").map(c=>c.trim());
    const raw: Record<string,string> = {};
    header.forEach((h,i)=>raw[h]=cells[i] ?? "");
    const getNum = (...names: string[]) => {
      for (const n of names) { const hit = header.find(h => h.toLowerCase() === n.toLowerCase()); if (hit && Number.isFinite(Number(raw[hit]))) return Number(raw[hit]); }
      return undefined;
    };
    return { layer: raw[header[0]] ?? "unknown", totalCycles: getNum("Total Cycles", "Cycles"), overallUtil: getNum("Overall Util %", "Compute Util %"), mappingEfficiency: getNum("Mapping Efficiency %"), raw };
  });
}
