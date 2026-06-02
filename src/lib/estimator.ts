import type { ArraySweepRequest, ArraySweepResult, HardwareConfig, HeatmapPoint, MatmulShape, Objective, OpSearchResult, ScaleSimOverrides, SearchRequest, SearchResponse, TileCandidateResult, TileCandidates } from "@/types/domain";
import { ceilDiv, clamp, mean } from "./math";
import { generateArtifacts } from "./mlir";
import { generateReportMarkdown } from "./report";
import { analyzeBottlenecks } from "./bottleneck";
import { computeRoofline } from "./roofline";
import { computeEnergy } from "./energy";
import { Reservoir, TopK } from "./topk";
import { pruneTileCandidates } from "./pruning";
import { hashObject } from "./hash";
import { assertSearchResponseInvariant, assertTileCandidateInvariant, runInvariant } from "./invariants";
import { estimateFullLayerCycles } from "./fullLayerEstimator";

export function estimateAll(req: SearchRequest, options: { includeArtifacts?: boolean } = {}): SearchResponse {
  const cache = new Map<string, OpSearchResult>();
  const results = req.shapes.map(shape => {
    const key = hashObject({ shape: { m: shape.m, n: shape.n, k: shape.k, dtypeBytes: shape.dtypeBytes }, hardware: req.hardware, candidates: req.candidates, objective: req.objective, max: req.maxResultsPerOp ?? 32, scaleSim: req.scaleSim });
    const hit = cache.get(key);
    if (hit) return { ...hit, shape, best: { ...hit.best, shapeId: shape.id, model: shape.model, opName: shape.opName }, candidates: hit.candidates.map(c => ({ ...c, shapeId: shape.id, model: shape.model, opName: shape.opName })) };
    const out = estimateForShape(req.hardware, shape, req.candidates, req.objective, req.maxResultsPerOp ?? 32, req.scaleSim);
    cache.set(key, out);
    return out;
  });
  const bests = results.map(r => r.best);
  const summary = {
    totalCycles: bests.reduce((a,b)=>a+b.cycles,0),
    totalTimeUs: bests.reduce((a,b)=>a+b.timeUs,0),
    meanUtilization: mean(bests.map(b=>b.utilization)),
    meanPaddingRatio: mean(bests.map(b=>b.paddingRatio)),
    maxSramBytes: Math.max(...bests.map(b=>b.sramBytes), 0),
    bottleneckOp: bests.slice().sort((a,b)=>b.cycles-a.cycles)[0]?.opName ?? "none",
    totalTilePolicyCycles: bests.reduce((a,b)=>a+Math.max(1, b.tilePolicyCycles ?? b.cycles),0),
    maxTileScratchBytes: Math.max(...bests.map(b=>b.tileScratchBytes ?? b.sramBytes), 0),
    maxFullLayerSramBytes: Math.max(...bests.map(b=>b.fullLayerSramBytes ?? b.sramBytes), 0),
    minPredictionConfidence: Math.min(...bests.map(b=>b.predictionConfidence ?? 1), 1),
  };
  const designAdvice = makeDesignAdvice(req.hardware, bests);
  const pairs = results.map(r => ({ shape: r.shape, best: r.best }));
  const bottlenecks = analyzeBottlenecks({ request: req, results, summary });
  const roofline = computeRoofline(req.hardware, pairs);
  const energy = computeEnergy(req.hardware, pairs);
  const partial = { request: req, results, summary, artifacts: {} as any, designAdvice, bottlenecks, roofline, energy };
  const includeArtifacts = options.includeArtifacts ?? true;
  const artifacts = includeArtifacts ? generateArtifacts(partial) : emptyArtifacts();
  if (includeArtifacts) artifacts.reportMarkdown = generateReportMarkdown({ ...partial, artifacts });
  const response = { ...partial, artifacts };
  runInvariant("search response", () => assertSearchResponseInvariant(response));
  return response;
}

function emptyArtifacts(): SearchResponse["artifacts"] {
  return {
    policyCsv: "",
    mlir: "",
    transformDialect: "",
    reportMarkdown: "",
    scaleSimConfig: "",
    scaleSimTopology: "",
    scaleSimLayout: "",
    scaleSimTopkTopology: "",
    scaleSimTopkLayout: "",
    projectJson: "{}"
  };
}

export function estimateForShape(hw: HardwareConfig, shape: MatmulShape, cand: TileCandidates, objective: Objective, maxResults: number, scaleSim?: ScaleSimOverrides): OpSearchResult {
  const maxKeep = Math.max(1, maxResults);
  const top = new TopK<TileCandidateResult>(maxKeep, compareCandidates);
  const paretoPool = new TopK<TileCandidateResult>(Math.max(maxKeep * 4, 64), compareCandidates);
  const heatmapMax = Number(process.env.TILEFORGE_HEATMAP_MAX_POINTS ?? 20000);
  const reservoir = new Reservoir<HeatmapPoint>(heatmapMax);
  const strictPruned = pruneTileCandidates(hw, shape, cand, { requireSramFit: false });
  const pruned = strictPruned.kept.length
    ? strictPruned
    : pruneTileCandidates(hw, shape, cand, {
        requireSramFit: false,
        maxPaddingRatio: Number.POSITIVE_INFINITY,
        minSpatialUtilization: 0,
        tileKAlignment: 1,
        maxTileToArrayRatio: Number.POSITIVE_INFINITY
      });

  for (const kept of pruned.kept) {
    const tm = kept.tileM, tn = kept.tileN, tk = kept.tileK;
    const estimated = estimateTile(hw, shape, tm, tn, tk, objective, scaleSim);
    runInvariant("tile candidate", () => assertTileCandidateInvariant(estimated));
    top.push(estimated);
    paretoPool.push(estimated);
    reservoir.push({ tileM: estimated.tileM, tileN: estimated.tileN, tileK: estimated.tileK, cycles: estimated.cycles, utilization: estimated.utilization, sramBytes: estimated.sramBytes, paddingRatio: estimated.paddingRatio, score: estimated.score });
  }

  const sorted = top.toSorted();
  if (!sorted.length) throw new Error(`No tile candidates generated for ${shape.opName}`);
  const pareto = markPareto(paretoPool.toSorted()).sort(compareCandidates);
  const best = toHardwareDesignBest(hw, shape, sorted[0], scaleSim);
  for (const c of sorted) c.isPareto = pareto.some(p => p.tileM === c.tileM && p.tileN === c.tileN && p.tileK === c.tileK);
  return { shape, best, candidates: sorted, pareto, heatmap: reservoir.toArray() };
}

function mappingEfficiencyPercent(hw: HardwareConfig, shape: MatmulShape) {
  const ar = Math.max(1, Number(hw.arrayRows || 1));
  const ac = Math.max(1, Number(hw.arrayCols || 1));
  const kFit = Math.min(1, Math.max(1, Number(shape.k || 1)) / ar);
  const nFit = Math.min(1, Math.max(1, Number(shape.n || 1)) / ac);
  return (hw.dataflow === "OS" ? nFit : kFit) * 100;
}

function toHardwareDesignBest(hw: HardwareConfig, shape: MatmulShape, candidate: TileCandidateResult, scaleSim?: ScaleSimOverrides): TileCandidateResult {
  const full = estimateFullLayerCycles(hw, shape, scaleSim);
  const tilePolicyCycles = candidate.tilePolicyCycles ?? candidate.cycles;
  const tilePolicyRawCycles = candidate.tilePolicyRawCycles ?? candidate.rawCycles ?? candidate.cycles;
  const tileScratchBytes = candidate.tileScratchBytes ?? candidate.sramBytes;
  const cycles = Math.max(1, Math.round(full.cycles));
  const warnings = Array.isArray(candidate.warnings) ? [...candidate.warnings] : [];
  if (full.stallCycles > Math.max(1024, full.computeCycles * 0.08)) {
    warnings.push(`full-layer stall ${Math.round(full.stallCycles).toLocaleString()} cycles 예측`);
  }
  return {
    ...candidate,
    tilePolicyCycles,
    tilePolicyRawCycles,
    tileScratchBytes,
    fullLayerRawCycles: full.cycles,
    fullLayerCycles: cycles,
    fullLayerComputeCycles: full.computeCycles,
    fullLayerStallCycles: full.stallCycles,
    fullLayerMappingEfficiency: mappingEfficiencyPercent(hw, shape),
    fullLayerSramBytes: full.sramBytes,
    fullLayerDramBytes: full.dramBytes,
    predictionConfidence: candidate.predictionConfidence ?? 1,
    predictionNotes: candidate.predictionNotes ?? [],
    predictionTarget: "full-layer",
    rawCycles: full.cycles,
    cycles,
    timeUs: cycles / Math.max(1, hw.frequencyMHz),
    utilization: full.utilization,
    sramBytes: tileScratchBytes,
    warnings: Array.from(new Set(warnings)),
    explanation: `${candidate.explanation} Hardware-design cycle은 full-layer systolic model(${full.formula}) 기준 ${cycles.toLocaleString()} cycles입니다. Tile-policy cost ${Math.round(tilePolicyCycles).toLocaleString()} cycles는 후보 ranking 참고값입니다.`,
  };
}

function compareCandidates(a: TileCandidateResult, b: TileCandidateResult): number {
  return a.score - b.score
    || a.cycles - b.cycles
    || b.utilization - a.utilization
    || a.sramBytes - b.sramBytes
    || (b.tileM * b.tileN * b.tileK) - (a.tileM * a.tileN * a.tileK)
    || b.tileM - a.tileM
    || b.tileN - a.tileN
    || b.tileK - a.tileK;
}


export function estimateTile(hw: HardwareConfig, shape: MatmulShape, tileM: number, tileN: number, tileK: number, objective: Objective, scaleSim?: ScaleSimOverrides): TileCandidateResult {
  const bytes = shape.dtypeBytes || hw.bytesPerElement || 2;
  const mTiles = ceilDiv(shape.m, tileM), nTiles = ceilDiv(shape.n, tileN), kTiles = ceilDiv(shape.k, tileK);
  const paddedM = mTiles * tileM, paddedN = nTiles * tileN, paddedK = kTiles * tileK;
  const usefulOps = 2 * shape.m * shape.n * shape.k;
  const paddedOps = 2 * paddedM * paddedN * paddedK;
  const paddingRatio = paddedOps / usefulOps - 1;
  const activeRows = Math.min(tileM, hw.arrayRows), activeCols = Math.min(tileN, hw.arrayCols);
  const spatialUtil = (activeRows * activeCols) / (hw.arrayRows * hw.arrayCols);
  const sramBytes = (tileM * tileK + tileK * tileN + tileM * tileN) * bytes;
  const boundaryUtil = usefulOps / paddedOps;
  const scaleCycles = estimateScaleSimLikeCycles(hw, shape, tileM, tileN, tileK, scaleSim);
  const memoryPressure = sramBytes / Math.max(1, hw.sramKB * 1024);
  const memoryPenalty = memoryPressure > 0.75 ? Math.ceil((memoryPressure - 0.75) * 32) : 0;
  const cycles = Math.ceil(scaleCycles.cycles + memoryPenalty * Math.max(1, mTiles * nTiles));
  const utilization = clamp(spatialUtil * boundaryUtil * scaleCycles.computeUtil, 0, 1);
  const sramLimit = hw.sramKB * 1024;
  const boundaryPenalty = (mTiles * nTiles * kTiles) * (1 - boundaryUtil) + Math.max(0, sramBytes - sramLimit) / Math.max(1, sramLimit) * 10;
  const normalizedCycles = cycles / 1e6;
  const sramPenalty = Math.max(0, sramBytes - sramLimit) / Math.max(1, sramLimit);
  const utilPenalty = 1 - utilization;
  const score = scoreFor(objective, normalizedCycles, utilPenalty, paddingRatio, sramPenalty, boundaryPenalty, candidatesPreference(tileM, tileN, tileK, hw));
  const warnings: string[] = [];
  if (sramBytes > sramLimit) warnings.push("SRAM 용량 초과");
  if (utilization < 0.45) warnings.push("PE 사용률 낮음");
  if (paddingRatio > 0.4) warnings.push("패딩 오버헤드 높음");
  const timeUs = cycles / Math.max(1, hw.frequencyMHz);
  return { shapeId: shape.id, model: shape.model, opName: shape.opName, tileM, tileN, tileK, cycles, timeUs, utilization, paddingRatio, sramBytes, boundaryPenalty, score, isPareto: false, warnings, explanation: explainTile(hw, shape, tileM, tileN, tileK, utilization, paddingRatio, sramBytes, cycles, warnings) };
}
function scaleSimBandwidths(hw: HardwareConfig, scaleSim?: ScaleSimOverrides) {
  const bytes = Math.max(1, hw.bytesPerElement || 2);
  const hwElementsPerCycle = hw.memoryBandwidthGBs
    ? Math.max(1, (hw.memoryBandwidthGBs * 1000) / Math.max(1, hw.frequencyMHz) / bytes)
    : 128;
  const ifmap = scaleSim?.ifmapSRAMBankBandwidth ?? 10;
  const filter = scaleSim?.filterSRAMBankBandwidth ?? 10;
  const ofmap = scaleSim?.dramBandwidth ?? scaleSim?.bandwidth ?? hwElementsPerCycle;
  return { ifmap: Math.max(1, ifmap), filter: Math.max(1, filter), ofmap: Math.max(1, ofmap) };
}

function estimateScaleSimLikeCycles(hw: HardwareConfig, shape: MatmulShape, tileM: number, tileN: number, tileK: number, scaleSim?: ScaleSimOverrides) {
  const ar = Math.max(1, hw.arrayRows);
  const ac = Math.max(1, hw.arrayCols);
  const tm = Math.max(1, tileM);
  const tn = Math.max(1, tileN);
  const tk = Math.max(1, tileK);
  const mTiles = ceilDiv(shape.m, tm);
  const nTiles = ceilDiv(shape.n, tn);
  const kTiles = ceilDiv(shape.k, tk);
  const tileRepeats = Math.max(1, mTiles * nTiles * kTiles);
  const bw = scaleSimBandwidths(hw, scaleSim);
  let computeCycles = 0;
  let stallCycles = 0;
  let computeUtil = 1;
  if (hw.dataflow === "OS") {
    const rowFolds = ceilDiv(tm, ar);
    const colFolds = ceilDiv(tn, ac);
    const perFold = tk + ar + ac - 2;
    computeCycles = tileRepeats * rowFolds * colFolds * perFold;
    stallCycles = 0;
    computeUtil = (Math.min(tm, ar) * Math.min(tn, ac) * tk) / Math.max(1, ar * ac * perFold);
  } else if (hw.dataflow === "IS") {
    const rowFolds = ceilDiv(tk, ar);
    const colFolds = ceilDiv(tm, ac);
    const perFold = tn + 2 * ar + ac - 3;
    computeCycles = tileRepeats * rowFolds * colFolds * perFold;
    const smallTile = tk * tn <= ar * ac * 2;
    const ifmapTraffic = tileRepeats * tm * tk;
    const filterTraffic = tileRepeats * tk * tn;
    const ofmapTraffic = tileRepeats * tm * tn;
    stallCycles = smallTile ? 0 : 1.20 * filterTraffic / bw.filter + 0.10 * ifmapTraffic / bw.ifmap + 0.08 * ofmapTraffic / bw.ofmap;
    computeUtil = (Math.min(tk, ar) * Math.min(tm, ac) * tn) / Math.max(1, ar * ac * perFold);
  } else {
    const rowFolds = ceilDiv(tk, ar);
    const colFolds = ceilDiv(tn, ac);
    const perFold = tm + 2 * ar + ac - 3;
    computeCycles = tileRepeats * rowFolds * colFolds * perFold;
    const smallTile = tk * tn <= ar * ac * 2;
    const ifmapTraffic = tileRepeats * tm * tk;
    const filterTraffic = Math.max(1, nTiles * kTiles) * tk * tn;
    const ofmapTraffic = tileRepeats * tm * tn;
    stallCycles = smallTile ? 0 : 0.45 * filterTraffic / bw.filter + 0.08 * ifmapTraffic / bw.ifmap + 0.05 * ofmapTraffic / bw.ofmap;
    computeUtil = (Math.min(tk, ar) * Math.min(tn, ac) * tm) / Math.max(1, ar * ac * perFold);
  }
  const prefetchOverlap = Math.min(stallCycles * 0.12, computeCycles * 0.08);
  const cycles = Math.max(1, Math.ceil(computeCycles + Math.max(0, stallCycles - prefetchOverlap)));
  return { cycles, computeCycles: Math.max(1, computeCycles), computeUtil: clamp(computeUtil, 0.02, 1) };
}
function candidatesPreference(tm:number, tn:number, tk:number, hw: HardwareConfig) { return Math.abs(tm-hw.arrayRows)/hw.arrayRows*0.04 + Math.abs(tn-hw.arrayCols)/hw.arrayCols*0.04 + (tk<32?0.03:0); }
function scoreFor(obj: Objective, cycles: number, utilPenalty: number, pad: number, sram: number, boundary: number, pref: number): number {
  if (obj === "cycles") return cycles + sram * 100;
  if (obj === "utilization") return utilPenalty * 10 + pad + sram * 100 + pref;
  if (obj === "hardware-design") return cycles * 0.45 + utilPenalty * 5 + pad * 4 + sram * 100 + boundary * 0.02 + pref;
  if (obj === "pareto") return cycles * 0.5 + utilPenalty * 4 + pad * 2 + sram * 80 + pref;
  return cycles * 0.65 + utilPenalty * 3 + pad * 2.5 + sram * 100 + boundary * 0.015 + pref;
}
function markPareto(cs: TileCandidateResult[]): TileCandidateResult[] {
  return cs.filter(a => !cs.some(b => b !== a && b.cycles <= a.cycles && b.sramBytes <= a.sramBytes && b.paddingRatio <= a.paddingRatio && b.utilization >= a.utilization && (b.cycles < a.cycles || b.sramBytes < a.sramBytes || b.paddingRatio < a.paddingRatio || b.utilization > a.utilization)));
}
function explainTile(hw: HardwareConfig, shape: MatmulShape, tm:number, tn:number, tk:number, util:number, pad:number, sram:number, cycles:number, warnings:string[]): string {
  const reasons = [`${shape.opName}: ${tm}x${tn}x${tk} 타일을 선택함`];
  reasons.push(`${hw.arrayRows}x${hw.arrayCols} 배열에서 PE 사용률 ${(util*100).toFixed(1)}%`);
  reasons.push(`패딩 오버헤드 ${(pad*100).toFixed(1)}%`);
  reasons.push(`SRAM 사용량 ${(sram/1024).toFixed(1)} KiB / ${hw.sramKB} KiB`);
  reasons.push(`예상 사이클 ${cycles.toLocaleString()}`);
  if (shape.n % tn === 0) reasons.push(`tileN이 N=${shape.n}을 나누어 경계 타일 낭비가 줄어듦`);
  if (shape.m % tm !== 0) reasons.push(`M=${shape.m}이 tileM으로 나누어떨어지지 않아 경계 패딩이 남음`);
  if (warnings.length) reasons.push(`주의: ${warnings.join("; ")}`);
  return reasons.join(". ") + ".";
}
export function makeDesignAdvice(hw: HardwareConfig, bests: TileCandidateResult[]): string[] {
  const advice: string[] = [];
  const avgUtil = mean(bests.map(b=>b.utilization));
  const avgPad = mean(bests.map(b=>b.paddingRatio));
  const maxSram = Math.max(...bests.map(b=>b.sramBytes), 0);
  if (avgUtil < 0.55) advice.push(`평균 PE 사용률이 ${(avgUtil*100).toFixed(1)}%입니다. 더 작은 배열, 비대칭 배열, 또는 M/N 차원과 더 잘 맞는 shape 구성을 검토하세요.`);
  if (avgPad > 0.25) advice.push(`평균 패딩 오버헤드가 ${(avgPad*100).toFixed(1)}%입니다. 타일 후보를 더 추가하거나 주요 M/N/K 차원을 나누어떨어지게 하는 타일 크기를 우선 검토하세요.`);
  if (maxSram > hw.sramKB*1024) advice.push(`최소 하나 이상의 최적 타일이 SRAM 용량을 초과합니다. tileK/tileN을 줄이거나 로컬 SRAM을 늘리는 방안을 검토하세요.`);
  if (hw.arrayRows === hw.arrayCols && bests.some(b=>b.tileM !== b.tileN)) advice.push(`최적 타일이 비대칭인 경우가 많습니다. ${hw.arrayRows}x${hw.arrayCols*2} 또는 ${hw.arrayRows*2}x${hw.arrayCols} 같은 직사각형 배열 sweep을 검토하세요.`);
  if (!advice.length) advice.push("현재 하드웨어와 타일 후보는 이 workload에 비교적 균형적입니다. 다음 단계로 SCALE-Sim 및 IREE benchmark로 검증하세요.");
  return advice;
}
export function sweepArrays(req: ArraySweepRequest): ArraySweepResult[] {
  return req.arrays.map(a => {
    const hardware = { ...req.baseHardware, arrayRows: a.rows, arrayCols: a.cols, name: `${a.rows}x${a.cols}` };
    const res = estimateAll({ hardware, shapes: req.shapes, candidates: req.candidates, objective: req.objective });
    const score = res.summary.totalCycles / 1e6 + (1-res.summary.meanUtilization)*5 + res.summary.meanPaddingRatio*3;
    return { arrayRows: a.rows, arrayCols: a.cols, totalCycles: res.summary.totalCycles, meanUtilization: res.summary.meanUtilization, maxSramBytes: res.summary.maxSramBytes, score, advice: res.designAdvice };
  }).sort((a,b)=>a.score-b.score);
}
