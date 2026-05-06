import type { HardwareConfig, MatmulShape, TileCandidates } from "@/types/domain";

export interface PruneRuleConfig {
  maxPaddingRatio?: number;
  minSpatialUtilization?: number;
  requireSramFit?: boolean;
  requireDoubleBufferFit?: boolean;
  tileKAlignment?: number;
  maxTileToArrayRatio?: number;
}
export interface PrunedCandidate { tileM: number; tileN: number; tileK: number; reasons: string[]; }
export interface PruneReport { totalCandidates: number; evaluatedCandidates: number; prunedCandidates: number; kept: PrunedCandidate[]; pruned: PrunedCandidate[]; rules: Required<PruneRuleConfig>; }

const defaults: Required<PruneRuleConfig> = {
  maxPaddingRatio: 0.65,
  minSpatialUtilization: 0.20,
  requireSramFit: true,
  requireDoubleBufferFit: false,
  tileKAlignment: 8,
  maxTileToArrayRatio: 4
};

export function pruneTileCandidates(hw: HardwareConfig, shape: MatmulShape, candidates: TileCandidates, config: PruneRuleConfig = {}): PruneReport {
  const rules = { ...defaults, ...config };
  const kept: PrunedCandidate[] = [];
  const pruned: PrunedCandidate[] = [];
  const bytes = shape.dtypeBytes || hw.bytesPerElement || 2;
  for (const tileM of candidates.tileM) for (const tileN of candidates.tileN) for (const tileK of candidates.tileK) {
    const reasons: string[] = [];
    const paddedM = Math.ceil(shape.m / tileM) * tileM;
    const paddedN = Math.ceil(shape.n / tileN) * tileN;
    const paddedK = Math.ceil(shape.k / tileK) * tileK;
    const paddingRatio = (paddedM * paddedN * paddedK) / Math.max(1, shape.m * shape.n * shape.k) - 1;
    const spatialUtil = Math.min(tileM, hw.arrayRows) * Math.min(tileN, hw.arrayCols) / Math.max(1, hw.arrayRows * hw.arrayCols);
    const sramBytes = (tileM * tileK + tileK * tileN + tileM * tileN) * bytes;
    const sramLimit = hw.sramKB * 1024;
    if (paddingRatio > rules.maxPaddingRatio) reasons.push(`패딩 ${(paddingRatio * 100).toFixed(1)}% > ${(rules.maxPaddingRatio * 100).toFixed(0)}%`);
    if (spatialUtil < rules.minSpatialUtilization) reasons.push(`공간 사용률 ${(spatialUtil * 100).toFixed(1)}% < ${(rules.minSpatialUtilization * 100).toFixed(0)}%`);
    if (rules.requireSramFit && sramBytes > sramLimit) reasons.push(`SRAM ${(sramBytes / 1024).toFixed(1)} KiB > ${hw.sramKB} KiB`);
    if (rules.requireDoubleBufferFit && 2 * sramBytes > sramLimit) reasons.push(`double-buffer SRAM ${(2 * sramBytes / 1024).toFixed(1)} KiB > ${hw.sramKB} KiB`);
    if (rules.tileKAlignment > 1 && tileK % rules.tileKAlignment !== 0) reasons.push(`tileK가 ${rules.tileKAlignment}에 정렬되지 않음`);
    if (tileM > hw.arrayRows * rules.maxTileToArrayRatio) reasons.push(`tileM이 배열 row 수에 비해 너무 큼`);
    if (tileN > hw.arrayCols * rules.maxTileToArrayRatio) reasons.push(`tileN이 배열 column 수에 비해 너무 큼`);
    const item = { tileM, tileN, tileK, reasons };
    if (reasons.length) pruned.push(item); else kept.push(item);
  }
  return { totalCandidates: kept.length + pruned.length, evaluatedCandidates: kept.length, prunedCandidates: pruned.length, kept, pruned, rules };
}

export function compactPruneReport(report: PruneReport): string {
  const topReasons = new Map<string, number>();
  for (const p of report.pruned) for (const r of p.reasons) topReasons.set(r, (topReasons.get(r) ?? 0) + 1);
  const reasons = [...topReasons.entries()].sort((a,b)=>b[1]-a[1]).slice(0, 5).map(([r,n])=>`- ${r}: ${n}`).join("\n");
  return `Candidates: ${report.totalCandidates}\nEvaluated: ${report.evaluatedCandidates}\nPruned: ${report.prunedCandidates}\n${reasons}`;
}
