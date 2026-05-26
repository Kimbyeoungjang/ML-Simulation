import type { SearchResponse, TileCandidateResult } from "@/types/domain";

function fmt(n: number, digits = 0) { return digits ? n.toFixed(digits) : Math.round(n).toLocaleString(); }
function pct(n: number, digits = 1) { return `${(n * 100).toFixed(digits)}%`; }
function tileId(c: TileCandidateResult) { return `${c.tileM}x${c.tileN}x${c.tileK}`; }
function scoreMargin(best: TileCandidateResult, alt?: TileCandidateResult) {
  if (!alt) return Number.POSITIVE_INFINITY;
  return (alt.score - best.score) / Math.max(1e-9, Math.abs(best.score));
}

export interface TilingStrategyOp {
  op: string;
  shape: string;
  selectedTile: string;
  score: number;
  scoreMarginToNext: number;
  tilePolicyCycles: number;
  fullLayerCycles: number;
  tileScratchBytes: number;
  utilization: number;
  paddingRatio: number;
  stability: "stable" | "competitive" | "fragile";
  rationale: string[];
  benchmarkAlternatives: Array<{ tile: string; score: number; tilePolicyCycles: number; scratchBytes: number; reason: string }>;
}

export interface TilingStrategyReport {
  schema: "tileforge.tiling-strategy.v1";
  generatedAt: string;
  metric: "tile-policy-score";
  caution: string;
  ops: TilingStrategyOp[];
}

function stability(best: TileCandidateResult, alt?: TileCandidateResult): TilingStrategyOp["stability"] {
  const margin = scoreMargin(best, alt);
  if (margin > 0.15) return "stable";
  if (margin > 0.04) return "competitive";
  return "fragile";
}

function alternatives(best: TileCandidateResult, candidates: TileCandidateResult[]) {
  const seen = new Set([tileId(best)]);
  const alts: TilingStrategyOp["benchmarkAlternatives"] = [];
  for (const c of candidates) {
    const id = tileId(c);
    if (seen.has(id)) continue;
    seen.add(id);
    const rel = (c.score - best.score) / Math.max(1e-9, Math.abs(best.score));
    const differentK = c.tileK !== best.tileK;
    const lessScratch = (c.tileScratchBytes ?? c.sramBytes) < (best.tileScratchBytes ?? best.sramBytes) * 0.75;
    const higherUtil = c.utilization > best.utilization + 0.05;
    if (alts.length < 4 && (rel < 0.30 || differentK || lessScratch || higherUtil)) {
      const reason = lessScratch ? "SRAM 여유 대안" : higherUtil ? "PE 사용률 대안" : differentK ? "reduction tile 비교 대안" : "score 근접 대안";
      alts.push({ tile: id, score: c.score, tilePolicyCycles: c.tilePolicyCycles ?? c.cycles, scratchBytes: c.tileScratchBytes ?? c.sramBytes, reason });
    }
    if (alts.length >= 4) break;
  }
  return alts;
}

export function buildTilingStrategyReport(res: SearchResponse): TilingStrategyReport {
  return {
    schema: "tileforge.tiling-strategy.v1",
    generatedAt: new Date().toISOString(),
    metric: "tile-policy-score",
    caution: "tile-policy score는 lowering 후보 ranking용입니다. full-layer latency나 SCALE-Sim full topology cycle과 직접 비교하지 마세요.",
    ops: res.results.map(r => {
      const best = r.best;
      const second = r.candidates.find(c => tileId(c) !== tileId(best));
      const margin = scoreMargin(best, second);
      const rat: string[] = [];
      rat.push(`tile-policy ${fmt(best.tilePolicyCycles ?? best.cycles)} cycles, score ${best.score.toFixed(4)}`);
      rat.push(`tile scratch ${fmt((best.tileScratchBytes ?? best.sramBytes) / 1024, 1)} KiB, padding ${pct(best.paddingRatio)}`);
      if (margin < 0.04) rat.push("2순위 후보와 score 차이가 작아 IREE benchmark에서 순위가 바뀔 수 있습니다");
      if ((best.tileScratchBytes ?? best.sramBytes) > res.request.hardware.sramKB * 1024) rat.push("타일 scratch가 SRAM보다 커서 tile 축소가 필요합니다");
      for (const w of best.warnings.slice(0, 2)) rat.push(`warning: ${w}`);
      return {
        op: `${r.shape.model}.${r.shape.opName}`,
        shape: `${r.shape.m}x${r.shape.n}x${r.shape.k}`,
        selectedTile: tileId(best),
        score: best.score,
        scoreMarginToNext: Number.isFinite(margin) ? margin : 1,
        tilePolicyCycles: best.tilePolicyCycles ?? best.cycles,
        fullLayerCycles: best.fullLayerCycles ?? best.cycles,
        tileScratchBytes: best.tileScratchBytes ?? best.sramBytes,
        utilization: best.utilization,
        paddingRatio: best.paddingRatio,
        stability: stability(best, second),
        rationale: rat,
        benchmarkAlternatives: alternatives(best, r.candidates),
      };
    }),
  };
}

export function tilingStrategyMarkdown(report: TilingStrategyReport): string {
  const lines: string[] = [];
  lines.push("# Tiling Strategy", "");
  lines.push(report.caution, "");
  lines.push("| op | shape | selected tile | stability | tile-policy cycles | full-layer cycles | util | padding | alternatives |", "|---|---:|---:|---|---:|---:|---:|---:|---|");
  for (const op of report.ops) {
    const alts = op.benchmarkAlternatives.map(a => `${a.tile}(${a.reason})`).join("<br>") || "-";
    lines.push(`| ${op.op} | ${op.shape} | ${op.selectedTile} | ${op.stability} | ${fmt(op.tilePolicyCycles)} | ${fmt(op.fullLayerCycles)} | ${pct(op.utilization)} | ${pct(op.paddingRatio)} | ${alts} |`);
  }
  lines.push("", "## Per-op rationale", "");
  for (const op of report.ops) {
    lines.push(`### ${op.op}`, "");
    for (const r of op.rationale) lines.push(`- ${r}`);
    if (op.benchmarkAlternatives.length) {
      lines.push("- IREE benchmark 대안:");
      for (const alt of op.benchmarkAlternatives) lines.push(`  - ${alt.tile}: ${alt.reason}, score=${alt.score.toFixed(4)}, tile-policy=${fmt(alt.tilePolicyCycles)} cycles`);
    }
    lines.push("");
  }
  return lines.join("\n");
}
