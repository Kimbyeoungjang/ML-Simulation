import type { HardwareConfig, MatmulShape, RooflinePoint, SearchResponse, TileCandidateResult } from "@/types/domain";
function bytesMoved(shape: MatmulShape): number { const b = shape.dtypeBytes || 2; return (shape.m*shape.k + shape.k*shape.n + shape.m*shape.n) * b; }
export function computeRoofline(hw: HardwareConfig, pairs: Array<{ shape: MatmulShape; best: TileCandidateResult }>): RooflinePoint[] {
  const peakGops = (2 * hw.arrayRows * hw.arrayCols * hw.frequencyMHz) / 1000;
  const bwGBs = hw.memoryBandwidthGBs ?? 100;
  return pairs.map(({ shape, best }) => {
    const ops = 2 * shape.m * shape.n * shape.k;
    const bytes = Math.max(1, bytesMoved(shape));
    const ai = ops / bytes;
    const timeSec = best.timeUs / 1e6;
    const achieved = ops / Math.max(1e-12, timeSec) / 1e9;
    const memoryRoof = ai * bwGBs;
    return { opName: shape.opName, model: shape.model, arithmeticIntensity: ai, achievedGops: achieved, computeRoofGops: peakGops, memoryRoofGops: memoryRoof, bound: memoryRoof < peakGops ? "memory" : "compute" };
  });
}
export function rooflineMarkdown(points?: RooflinePoint[]): string {
  if (!points?.length) return "Roofline 분석 데이터가 없습니다.";
  return `# 5. Roofline 분석\n\n| 연산 | AI ops/byte | 달성 GOPS | 계산 roof | 메모리 roof | 지배 요인 |\n|---|---:|---:|---:|---:|---|\n` + points.map(p=>`| ${p.model}.${p.opName} | ${p.arithmeticIntensity.toFixed(2)} | ${p.achievedGops.toFixed(2)} | ${p.computeRoofGops.toFixed(2)} | ${p.memoryRoofGops.toFixed(2)} | ${p.bound === "memory" ? "메모리" : "계산"} |`).join("\n");
}
