import type { ArraySweepRequest, ArraySweepResult, HardwareConfig, HeatmapPoint, MatmulShape, Objective, OpSearchResult, ScaleSimOverrides, SearchRequest, SearchResponse, TileCandidateResult, TileCandidates } from "@/types/domain";
import { ceilDiv, clamp, mean } from "./math";
import { generateArtifacts } from "./mlir";
import { generateReportMarkdown } from "./report";
import { applyCalibration, calibrationFactor } from "./calibration";
import { analyzeBottlenecks } from "./bottleneck";
import { computeRoofline } from "./roofline";
import { computeEnergy } from "./energy";
import { Reservoir, TopK } from "./topk";
import { pruneTileCandidates } from "./pruning";
import { hashObject } from "./hash";
import { assertSearchResponseInvariant, assertTileCandidateInvariant, runInvariant } from "./invariants";

export function estimateAll(req: SearchRequest, options: { includeArtifacts?: boolean } = {}): SearchResponse {
  const cache = new Map<string, OpSearchResult>();
  const results = req.shapes.map(shape => {
    const key = hashObject({ shape: { m: shape.m, n: shape.n, k: shape.k, dtypeBytes: shape.dtypeBytes }, hardware: req.hardware, candidates: req.candidates, objective: req.objective, max: req.maxResultsPerOp ?? 32, calibration: req.calibration, scaleSim: req.scaleSim });
    const hit = cache.get(key);
    if (hit) return { ...hit, shape, best: { ...hit.best, shapeId: shape.id, model: shape.model, opName: shape.opName }, candidates: hit.candidates.map(c => ({ ...c, shapeId: shape.id, model: shape.model, opName: shape.opName })) };
    const out = estimateForShape(req.hardware, shape, req.candidates, req.objective, req.maxResultsPerOp ?? 32, req.calibration, req.scaleSim);
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
    bottleneckOp: bests.slice().sort((a,b)=>b.cycles-a.cycles)[0]?.opName ?? "none"
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

export function estimateForShape(hw: HardwareConfig, shape: MatmulShape, cand: TileCandidates, objective: Objective, maxResults: number, calibration = undefined as SearchRequest["calibration"], scaleSim?: ScaleSimOverrides): OpSearchResult {
  const baseCalibrationFactor = calibrationFactor(calibration, hw, shape);
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
    const rawEstimate = estimateTile(hw, shape, tm, tn, tk, objective, scaleSim);
    const factor = calibration ? calibrationFactor(calibration, hw, shape, rawEstimate) : baseCalibrationFactor;
    const estimated = applyCalibration(rawEstimate, factor);
    runInvariant("tile candidate", () => assertTileCandidateInvariant(estimated));
    top.push(estimated);
    paretoPool.push(estimated);
    reservoir.push({ tileM: estimated.tileM, tileN: estimated.tileN, tileK: estimated.tileK, cycles: estimated.cycles, utilization: estimated.utilization, sramBytes: estimated.sramBytes, paddingRatio: estimated.paddingRatio, score: estimated.score, predictedSramAccessBytes: estimated.predictedSramAccessBytes, predictedDramAccessBytes: estimated.predictedDramAccessBytes, sramPressure: estimated.sramPressure, memoryBoundRatio: estimated.memoryBoundRatio });
  }

  const sorted = top.toSorted();
  if (!sorted.length) throw new Error(`No tile candidates generated for ${shape.opName}`);
  const pareto = markPareto(paretoPool.toSorted()).sort(compareCandidates);
  const best = sorted[0];
  for (const c of sorted) c.isPareto = pareto.some(p => p.tileM === c.tileM && p.tileN === c.tileN && p.tileK === c.tileK);
  return { shape, best, candidates: sorted, pareto, heatmap: reservoir.toArray() };
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
  const paddingRatio = paddedOps / Math.max(1, usefulOps) - 1;
  const activeRows = Math.min(tileM, hw.arrayRows), activeCols = Math.min(tileN, hw.arrayCols);
  const spatialUtil = (activeRows * activeCols) / Math.max(1, hw.arrayRows * hw.arrayCols);
  const ifmapBytes = tileM * tileK * bytes;
  const filterBytes = tileK * tileN * bytes;
  const ofmapBytes = tileM * tileN * bytes;
  const sramBytes = ifmapBytes + filterBytes + ofmapBytes;
  const boundaryUtil = usefulOps / Math.max(1, paddedOps);
  const scaleCycles = estimateScaleSimLikeCycles(hw, shape, tileM, tileN, tileK, scaleSim);
  const limits = scaleSimMemoryLimits(hw, scaleSim);
  const ifmapPressure = ifmapBytes / Math.max(1, limits.ifmapBytes);
  const filterPressure = filterBytes / Math.max(1, limits.filterBytes);
  const ofmapPressure = ofmapBytes / Math.max(1, limits.ofmapBytes);
  const sramPressure = Math.max(ifmapPressure, filterPressure, ofmapPressure, sramBytes / Math.max(1, limits.totalBytes));
  const predictedSramAccessBytes = scaleCycles.sramAccessElements * bytes;
  const predictedDramAccessBytes = scaleCycles.dramAccessElements * bytes;
  const memoryPenalty = sramPressure > 1
    ? Math.ceil((sramPressure - 1) * (32 + 8 * scaleCycles.memoryBoundRatio))
    : sramPressure > 0.85
      ? Math.ceil((sramPressure - 0.85) * (10 + 4 * scaleCycles.memoryBoundRatio))
      : 0;
  const cycles = Math.ceil(scaleCycles.cycles + memoryPenalty * Math.max(1, mTiles * nTiles));
  const utilization = clamp(spatialUtil * boundaryUtil * scaleCycles.computeUtil, 0, 1);
  const trafficPressure = scaleCycles.sramAccessElements / Math.max(1, shape.m * shape.n + shape.m * shape.k + shape.k * shape.n);
  const boundaryPenalty = (mTiles * nTiles * kTiles) * (1 - boundaryUtil) + Math.max(0, sramPressure - 1) * 10 + Math.max(0, trafficPressure - 4) * 0.15;
  const idealComputeCycles = Math.max(1, Math.ceil((shape.m * shape.n * shape.k) / Math.max(1, hw.arrayRows * hw.arrayCols)));
  const normalizedCycles = cycles / idealComputeCycles;
  const sramPenalty = Math.max(0, sramPressure - 0.92) + Math.max(0, scaleCycles.memoryBoundRatio - 1) * 0.35 + Math.max(0, trafficPressure - 4) * 0.015;
  const utilPenalty = 1 - utilization;
  const score = scoreFor(objective, normalizedCycles, utilPenalty, paddingRatio, sramPenalty, boundaryPenalty, candidatesPreference(tileM, tileN, tileK, hw));
  const warnings: string[] = [];
  if (ifmapPressure > 1) warnings.push("IFMAP SRAM 용량 초과");
  if (filterPressure > 1) warnings.push("FILTER SRAM 용량 초과");
  if (ofmapPressure > 1) warnings.push("OFMAP SRAM 용량 초과");
  if (sramBytes > limits.totalBytes) warnings.push("총 SRAM 용량 초과");
  if (utilization < 0.45) warnings.push("PE 사용률 낮음");
  if (paddingRatio > 0.4) warnings.push("패딩 오버헤드 높음");
  if (scaleCycles.memoryBoundRatio > 1.25) warnings.push("메모리 bandwidth 병목 가능성");
  if (trafficPressure > 6) warnings.push("SRAM 접근량이 커서 data movement 비용이 큼");
  const timeUs = cycles / Math.max(1, hw.frequencyMHz);
  return {
    shapeId: shape.id, model: shape.model, opName: shape.opName,
    tileM, tileN, tileK, cycles, timeUs, utilization, paddingRatio, sramBytes,
    ifmapBytes, filterBytes, ofmapBytes, predictedSramAccessBytes, predictedDramAccessBytes,
    sramPressure, memoryBoundRatio: scaleCycles.memoryBoundRatio,
    boundaryPenalty, score, isPareto: false, warnings,
    explanation: explainTile(hw, shape, tileM, tileN, tileK, utilization, paddingRatio, sramBytes, cycles, warnings, { ifmapBytes, filterBytes, ofmapBytes, limits, memoryBoundRatio: scaleCycles.memoryBoundRatio, predictedSramAccessBytes, predictedDramAccessBytes })
  };
}

function scaleSimMemoryLimits(hw: HardwareConfig, scaleSim?: ScaleSimOverrides) {
  const fallback = Math.max(1, hw.sramKB * 1024);
  const split = Math.max(1, Math.floor(fallback / 3));
  const ifmapBytes = Math.max(1, (scaleSim?.ifmapSramKB ?? split / 1024) * 1024);
  const filterBytes = Math.max(1, (scaleSim?.filterSramKB ?? split / 1024) * 1024);
  const ofmapBytes = Math.max(1, (scaleSim?.ofmapSramKB ?? split / 1024) * 1024);
  return { ifmapBytes, filterBytes, ofmapBytes, totalBytes: ifmapBytes + filterBytes + ofmapBytes };
}

function scaleSimBandwidths(hw: HardwareConfig, scaleSim?: ScaleSimOverrides) {
  const bytes = Math.max(1, hw.bytesPerElement || 2);
  const hwElementsPerCycle = hw.memoryBandwidthGBs ? Math.max(1, (hw.memoryBandwidthGBs * 1000) / Math.max(1, hw.frequencyMHz) / bytes) : 128;
  const bankScale = (banks?: number, ports?: number) => Math.max(1, (banks ?? 1) * (ports ?? 1));
  const ifmap = (scaleSim?.ifmapSRAMBankBandwidth ?? 10) * bankScale(scaleSim?.ifmapSRAMBankNum, scaleSim?.ifmapSRAMBankPort);
  const filter = (scaleSim?.filterSRAMBankBandwidth ?? 10) * bankScale(scaleSim?.filterSRAMBankNum, scaleSim?.filterSRAMBankPort);
  const dram = scaleSim?.dramBandwidth ?? scaleSim?.bandwidth ?? hwElementsPerCycle;
  return { ifmap: Math.max(1, ifmap), filter: Math.max(1, filter), ofmap: Math.max(1, dram), dram: Math.max(1, dram) };
}

function estimateScaleSimLikeCycles(hw: HardwareConfig, shape: MatmulShape, tileM: number, tileN: number, tileK: number, scaleSim?: ScaleSimOverrides) {
  const ar = Math.max(1, hw.arrayRows), ac = Math.max(1, hw.arrayCols);
  const tm = Math.max(1, tileM), tn = Math.max(1, tileN), tk = Math.max(1, tileK);
  const mTiles = ceilDiv(shape.m, tm), nTiles = ceilDiv(shape.n, tn), kTiles = ceilDiv(shape.k, tk);
  const tileRepeats = Math.max(1, mTiles * nTiles * kTiles);
  const bw = scaleSimBandwidths(hw, scaleSim);
  const ifmapTile = tm * tk;
  const filterTile = tk * tn;
  const ofmapTile = tm * tn;
  const ifmapTraffic = tileRepeats * ifmapTile;
  const filterTraffic = tileRepeats * filterTile;
  const ofmapTraffic = tileRepeats * ofmapTile;
  const partialOfmapTraffic = Math.max(0, kTiles - 1) * mTiles * nTiles * ofmapTile;
  const dramRefillTraffic = Math.max(1, mTiles * kTiles) * ifmapTile + Math.max(1, nTiles * kTiles) * filterTile + Math.max(1, mTiles * nTiles) * ofmapTile;
  let analyticComputeCycles = 0, computeUtil = 1, reuseIfmap = 1, reuseFilter = 1, reuseOfmap = 1;

  if (hw.dataflow === "OS") {
    const rowFolds = ceilDiv(tm, ar), colFolds = ceilDiv(tn, ac), perFold = tk + ar + ac - 2;
    analyticComputeCycles = tileRepeats * rowFolds * colFolds * perFold;
    computeUtil = (Math.min(tm, ar) * Math.min(tn, ac) * tk) / Math.max(1, ar * ac * perFold);
    reuseOfmap = Math.max(1, kTiles);
  } else if (hw.dataflow === "IS") {
    const rowFolds = ceilDiv(tk, ar), colFolds = ceilDiv(tm, ac), perFold = tn + 2 * ar + ac - 3;
    analyticComputeCycles = tileRepeats * rowFolds * colFolds * perFold;
    computeUtil = (Math.min(tk, ar) * Math.min(tm, ac) * tn) / Math.max(1, ar * ac * perFold);
    reuseIfmap = Math.max(1, nTiles);
  } else {
    const rowFolds = ceilDiv(tk, ar), colFolds = ceilDiv(tn, ac), perFold = tm + 2 * ar + ac - 3;
    analyticComputeCycles = tileRepeats * rowFolds * colFolds * perFold;
    computeUtil = (Math.min(tk, ar) * Math.min(tn, ac) * tm) / Math.max(1, ar * ac * perFold);
    reuseFilter = Math.max(1, mTiles);
  }

  const sramAccessElements = Math.max(1,
    Math.ceil((ifmapTraffic / reuseIfmap) + (filterTraffic / reuseFilter) + (ofmapTraffic / reuseOfmap) + partialOfmapTraffic)
  );
  const dramAccessElements = Math.max(1, Math.ceil(dramRefillTraffic + partialOfmapTraffic));
  const memoryCycles = Math.max((ifmapTraffic / reuseIfmap) / bw.ifmap, (filterTraffic / reuseFilter) / bw.filter, ((ofmapTraffic / reuseOfmap) + partialOfmapTraffic) / bw.ofmap, dramAccessElements / bw.dram);

  const analyticPerTile = analyticComputeCycles / tileRepeats;
  const scaleLikePerTile = estimateScaleSimPerTile(hw, tm, tn, tk);
  const scaleLikeComputeCycles = Math.max(analyticComputeCycles, scaleLikePerTile * tileRepeats);
  const overlap = (hw.doubleBuffering ? 0.62 : 0.34) * Math.min(scaleLikeComputeCycles, memoryCycles);
  const cycles = Math.max(1, Math.ceil(scaleLikeComputeCycles + Math.max(0, memoryCycles - overlap)));
  const computeCycles = Math.max(1, Math.max(analyticComputeCycles, analyticPerTile * tileRepeats));
  return { cycles, computeCycles, computeUtil: clamp(computeUtil, 0.02, 1), memoryCycles: Math.max(0, memoryCycles), memoryBoundRatio: memoryCycles / Math.max(1, computeCycles), sramAccessElements, dramAccessElements };
}

function estimateScaleSimPerTile(hw: HardwareConfig, tm: number, tn: number, tk: number): number {
  const ar = Math.max(1, hw.arrayRows);
  const ac = Math.max(1, hw.arrayCols);
  const nFold = Math.max(1, tn / ac);
  const kFold = Math.max(1, tk / ar);
  const arrayScale = Math.max(0.25, Math.sqrt(ar * ac) / 128);
  if (hw.dataflow === "OS") {
    const kTerm = 380 * arrayScale + 13.8 * tk;
    return Math.max(1, Math.ceil(kTerm * nFold));
  }
  if (hw.dataflow === "IS") {
    const nTerm = tn <= ac ? 1 : 1.833;
    return Math.max(1, Math.ceil(2275 * arrayScale * nTerm * kFold));
  }
  const nTerm = tn <= ac ? 1 : (tk < ar ? 1 + 0.28 * (nFold - 1) : nFold);
  return Math.max(1, Math.ceil(2275 * arrayScale * nTerm * kFold));
}

function candidatesPreference(tm:number, tn:number, tk:number, hw: HardwareConfig) { return Math.abs(tm-hw.arrayRows)/Math.max(1,hw.arrayRows)*0.04 + Math.abs(tn-hw.arrayCols)/Math.max(1,hw.arrayCols)*0.04 + (tk<32?0.03:0); }
function scoreFor(obj: Objective, cycles: number, utilPenalty: number, pad: number, sram: number, boundary: number, pref: number): number {
  if (obj === "cycles") return cycles * 2.4 + sram * 35 + boundary * 0.004 + pref;
  if (obj === "utilization") return utilPenalty * 9 + cycles * 0.25 + pad * 1.5 + sram * 30 + pref;
  if (obj === "hardware-design") return cycles * 1.35 + utilPenalty * 3 + pad * 2 + sram * 45 + boundary * 0.01 + pref;
  if (obj === "pareto") return cycles * 1.5 + utilPenalty * 2.5 + pad * 1.25 + sram * 35 + boundary * 0.006 + pref;
  return cycles * 2.0 + utilPenalty * 1.2 + pad * 1.2 + sram * 30 + boundary * 0.005 + pref;
}
function markPareto(cs: TileCandidateResult[]): TileCandidateResult[] {
  return cs.filter(a => !cs.some(b => b !== a && b.cycles <= a.cycles && b.sramBytes <= a.sramBytes && b.paddingRatio <= a.paddingRatio && b.utilization >= a.utilization && (b.cycles < a.cycles || b.sramBytes < a.sramBytes || b.paddingRatio < a.paddingRatio || b.utilization > a.utilization)));
}
function explainTile(hw: HardwareConfig, shape: MatmulShape, tm:number, tn:number, tk:number, util:number, pad:number, sram:number, cycles:number, warnings:string[], memory?: { ifmapBytes: number; filterBytes: number; ofmapBytes: number; limits: ReturnType<typeof scaleSimMemoryLimits>; memoryBoundRatio: number; predictedSramAccessBytes?: number; predictedDramAccessBytes?: number }): string {
  const reasons = [`${shape.opName}: ${tm}x${tn}x${tk} 타일을 선택함`];
  reasons.push(`${hw.arrayRows}x${hw.arrayCols} 배열에서 PE 사용률 ${(util*100).toFixed(1)}%`);
  reasons.push(`패딩 오버헤드 ${(pad*100).toFixed(1)}%`);
  reasons.push(`SRAM 사용량 ${(sram/1024).toFixed(1)} KiB / ${((memory?.limits.totalBytes ?? hw.sramKB*1024)/1024).toFixed(1)} KiB`);
  if (memory) reasons.push(`SRAM 분해 IFMAP/FILTER/OFMAP=${(memory.ifmapBytes/1024).toFixed(1)}/${(memory.filterBytes/1024).toFixed(1)}/${(memory.ofmapBytes/1024).toFixed(1)} KiB, SRAM 접근량≈${((memory.predictedSramAccessBytes ?? 0)/1024).toFixed(1)} KiB, DRAM 접근량≈${((memory.predictedDramAccessBytes ?? 0)/1024).toFixed(1)} KiB, memory/compute=${memory.memoryBoundRatio.toFixed(2)}`);
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
