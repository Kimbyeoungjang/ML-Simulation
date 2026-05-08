import type { CalibrationProfile, CalibrationSample, Dataflow, HardwareConfig, MatmulShape, TileCandidateResult } from "@/types/domain";

function median(xs: number[]): number {
  const ys = xs.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!ys.length) return 1;
  const mid = Math.floor(ys.length / 2);
  return ys.length % 2 ? ys[mid] : (ys[mid-1] + ys[mid]) / 2;
}
function keyArray(r?: number, c?: number) { return r && c ? `${r}x${c}` : undefined; }
function keyOp(model?: string, opName?: string) { return model && opName ? `${model}/${opName}` : opName; }
function clampFactor(x: number) { return Math.max(0.05, Math.min(50, x)); }
function parseNum(v?: string): number | undefined {
  if (v === undefined || v === "") return undefined;
  const n = Number(String(v).replace(/[% ,]/g, ""));
  return Number.isFinite(n) ? n : undefined;
}
function bucketTileK(v?: number) { if (!v) return undefined; return v <= 16 ? "<=16" : v <= 32 ? "17-32" : v <= 64 ? "33-64" : v <= 128 ? "65-128" : ">128"; }
function bucketTileArea(m?: number, n?: number) { if (!m || !n) return undefined; const a=m*n; return a <= 1024 ? "<=1k" : a <= 4096 ? "1k-4k" : a <= 16384 ? "4k-16k" : ">16k"; }
function bucketPressure(v?: number) { if (v === undefined || !Number.isFinite(v)) return undefined; return v <= 0.5 ? "<=0.50" : v <= 0.75 ? "0.50-0.75" : v <= 1 ? "0.75-1.00" : v <= 1.5 ? "1.00-1.50" : ">1.50"; }
function bucketPadding(v?: number) { if (v === undefined || !Number.isFinite(v)) return undefined; return v <= 0.02 ? "<=2%" : v <= 0.1 ? "2-10%" : v <= 0.25 ? "10-25%" : ">25%"; }
function bucketMemory(v?: number) { if (v === undefined || !Number.isFinite(v)) return undefined; return v <= 0.75 ? "compute" : v <= 1.25 ? "balanced" : v <= 2 ? "memory" : "strong-memory"; }
function factorsByBucket(samples: CalibrationSample[], bucket: (s: CalibrationSample) => string | undefined): Record<string, number> {
  const groups = new Map<string, number[]>();
  for (const s of samples) {
    const k = bucket(s);
    if (!k) continue;
    const xs = groups.get(k) ?? [];
    xs.push(s.factor);
    groups.set(k, xs);
  }
  return Object.fromEntries([...groups.entries()].map(([k,v]) => [k, median(v)]));
}

export function parseMeasurementCsv(text: string, frequencyMHz = 1000): CalibrationProfile {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("measurement CSV needs a header and at least one row");
  const headers = lines[0].split(",").map(h=>h.trim());
  const idx = (names: string[]) => headers.findIndex(h => names.includes(h.toLowerCase()));
  const col = {
    model: idx(["model"]), opName: idx(["op","op_name","opname"]), array: idx(["array"]),
    arrayRows: idx(["array_rows","arrayrows","rows"]), arrayCols: idx(["array_cols","arraycols","cols"]), dataflow: idx(["dataflow"]),
    tileM: idx(["tile_m","tilem"]), tileN: idx(["tile_n","tilen"]), tileK: idx(["tile_k","tilek"]), tileCount: idx(["tile_count","tilecount"]),
    paddingRatio: idx(["padding_ratio","paddingratio","predicted_padding_ratio"]), utilization: idx(["utilization","predicted_utilization"]),
    sramBytes: idx(["sram_bytes","srambytes","predicted_sram_bytes"]), sramPressure: idx(["sram_pressure","srampressure"]),
    memoryBoundRatio: idx(["memory_bound_ratio","memoryboundratio","memory_ratio"]),
    predictedCycles: idx(["predicted_cycles","predictedcycles","estimate_cycles","cycles_pred"]),
    measuredCycles: idx(["measured_cycles","measuredcycles","scalesim_cycles","cycles","total_cycles_incl_prefetch","total cycles (incl. prefetch)"]),
    runtimeUs: idx(["runtime_us","runtimeus","iree_runtime_us","time_us"]), runtimeMs: idx(["runtime_ms","runtimems","iree_runtime_ms","time_ms"])
  };
  const get = (parts: string[], i: number) => i >= 0 ? parts[i]?.trim() : undefined;
  const samples: CalibrationSample[] = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(",");
    const predictedCycles = parseNum(get(parts, col.predictedCycles));
    let measuredCycles = col.measuredCycles >= 0 ? parseNum(get(parts, col.measuredCycles)) : undefined;
    const runtimeUs = col.runtimeUs >= 0 ? parseNum(get(parts, col.runtimeUs)) : (col.runtimeMs >= 0 ? (parseNum(get(parts, col.runtimeMs)) ?? 0) * 1000 : undefined);
    if ((!measuredCycles || !Number.isFinite(measuredCycles)) && runtimeUs && Number.isFinite(runtimeUs)) measuredCycles = runtimeUs * frequencyMHz;
    if (!predictedCycles || !measuredCycles) continue;
    let arrayRows = col.arrayRows >= 0 ? parseNum(get(parts, col.arrayRows)) : undefined;
    let arrayCols = col.arrayCols >= 0 ? parseNum(get(parts, col.arrayCols)) : undefined;
    const arr = get(parts, col.array);
    if (arr && (!arrayRows || !arrayCols)) { const m = arr.match(/(\d+)x(\d+)/i); if (m) { arrayRows=Number(m[1]); arrayCols=Number(m[2]); } }
    samples.push({
      model: get(parts, col.model), opName: get(parts, col.opName), arrayRows, arrayCols, dataflow: get(parts, col.dataflow) as Dataflow | undefined,
      tileM: col.tileM>=0 ? parseNum(get(parts,col.tileM)) : undefined, tileN: col.tileN>=0 ? parseNum(get(parts,col.tileN)) : undefined, tileK: col.tileK>=0 ? parseNum(get(parts,col.tileK)) : undefined,
      tileCount: col.tileCount>=0 ? parseNum(get(parts,col.tileCount)) : undefined,
      paddingRatio: col.paddingRatio>=0 ? parseNum(get(parts,col.paddingRatio)) : undefined, utilization: col.utilization>=0 ? parseNum(get(parts,col.utilization)) : undefined,
      sramBytes: col.sramBytes>=0 ? parseNum(get(parts,col.sramBytes)) : undefined, sramPressure: col.sramPressure>=0 ? parseNum(get(parts,col.sramPressure)) : undefined,
      memoryBoundRatio: col.memoryBoundRatio>=0 ? parseNum(get(parts,col.memoryBoundRatio)) : undefined,
      predictedCycles, measuredCycles, measuredRuntimeUs: runtimeUs, factor: measuredCycles / predictedCycles
    });
  }
  if (!samples.length) throw new Error("no valid calibration rows found");
  return buildProfileFromSamples(samples, "measurement-calibration");
}

export function calibrationFactor(profile: CalibrationProfile | undefined, hw: HardwareConfig, shape: MatmulShape, candidate?: TileCandidateResult): number {
  if (!profile) return 1;
  const factors: number[] = [];
  const opK = keyOp(shape.model, shape.opName);
  if (opK && profile.byOp?.[opK]) factors.push(profile.byOp[opK]);
  const arrK = keyArray(hw.arrayRows, hw.arrayCols);
  if (arrK && profile.byArray?.[arrK]) factors.push(profile.byArray[arrK]);
  if (profile.byDataflow?.[hw.dataflow]) factors.push(profile.byDataflow[hw.dataflow]!);
  if (!factors.length) factors.push(profile.globalCycleFactor || 1);
  let factor = factors.reduce((a,b)=>a*b, 1) ** (1 / factors.length);
  if (candidate && profile.residual) {
    const residuals: number[] = [];
    const keys = {
      k: bucketTileK(candidate.tileK), area: bucketTileArea(candidate.tileM, candidate.tileN),
      pressure: bucketPressure(candidate.sramBytes / Math.max(1, hw.sramKB * 1024)), pad: bucketPadding(candidate.paddingRatio)
    };
    if (keys.k && profile.residual.byTileK?.[keys.k]) residuals.push(profile.residual.byTileK[keys.k]);
    if (keys.area && profile.residual.byTileArea?.[keys.area]) residuals.push(profile.residual.byTileArea[keys.area]);
    if (keys.pressure && profile.residual.bySramPressure?.[keys.pressure]) residuals.push(profile.residual.bySramPressure[keys.pressure]);
    if (keys.pad && profile.residual.byPadding?.[keys.pad]) residuals.push(profile.residual.byPadding[keys.pad]);
    if (residuals.length) factor = Math.sqrt(factor * (residuals.reduce((a,b)=>a*b, 1) ** (1 / residuals.length)));
  }
  return clampFactor(factor);
}

export function applyCalibration(result: TileCandidateResult, factor: number): TileCandidateResult {
  const raw = result.rawCycles ?? result.cycles;
  const cycles = Math.max(1, Math.ceil(raw * factor));
  return { ...result, rawCycles: raw, cycles, timeUs: result.timeUs * factor, calibrationFactor: factor };
}

export function profileToMarkdown(profile?: CalibrationProfile): string {
  if (!profile) return "보정 profile이 적용되지 않았습니다.";
  const residualLines = profile.residual ? ["", "잔차 보정 bucket:", ...Object.entries(profile.residual).flatMap(([name, values]) => Object.entries(values ?? {}).map(([k,v])=>`- ${name}.${k}: ${Number(v).toFixed(4)}`))] : [];
  return [`보정 profile: ${profile.name}`, `Sample 수: ${profile.samples.length}`, `전역 cycle 보정 계수: ${profile.globalCycleFactor.toFixed(4)}`, "", "배열별 보정 계수:", ...Object.entries(profile.byArray ?? {}).map(([k,v])=>`- ${k}: ${v.toFixed(4)}`), "", "데이터플로우별 보정 계수:", ...Object.entries(profile.byDataflow ?? {}).map(([k,v])=>`- ${k}: ${Number(v).toFixed(4)}`), ...residualLines].join("\n");
}

export interface CalibrationSplitReport { train: CalibrationProfile; trainSamples: number; testSamples: number; beforeMapePct: number; afterMapePct: number; markdown: string; }

export function trainTestCalibration(samples: CalibrationSample[], trainRatio = 0.7): CalibrationSplitReport {
  const sorted = samples.slice().sort((a,b)=>`${a.model ?? ""}/${a.opName ?? ""}/${a.predictedCycles}`.localeCompare(`${b.model ?? ""}/${b.opName ?? ""}/${b.predictedCycles}`));
  const cut = Math.max(1, Math.min(sorted.length - 1, Math.round(sorted.length * trainRatio)));
  const trainSamples = sorted.slice(0, cut);
  const testSamples = sorted.slice(cut);
  const train = buildProfileFromSamples(trainSamples, "measurement-calibration-train");
  const before = mape(testSamples.map(s => [s.predictedCycles, s.measuredCycles ?? s.predictedCycles * s.factor] as const));
  const after = mape(testSamples.map(s => [s.predictedCycles * calibrationFactor(train, { name:"cal", arrayRows:s.arrayRows ?? 1, arrayCols:s.arrayCols ?? 1, frequencyMHz:1000, sramKB:1024, dataflow:s.dataflow ?? "WS", bytesPerElement:2 }, { id:"cal", model:s.model ?? "", opName:s.opName ?? "", m:1, n:1, k:1, dtypeBytes:2 }), s.measuredCycles ?? s.predictedCycles * s.factor] as const));
  const markdown = [`# 보정 Train/Test 보고서`, "", `Train sample 수: ${trainSamples.length}`, `Test sample 수: ${testSamples.length}`, `보정 전 MAPE: ${before.toFixed(2)}%`, `보정 후 MAPE: ${after.toFixed(2)}%`].join("\n");
  return { train, trainSamples: trainSamples.length, testSamples: testSamples.length, beforeMapePct: before, afterMapePct: after, markdown };
}

function buildProfileFromSamples(samples: CalibrationSample[], name: string): CalibrationProfile {
  const byArray: Record<string, number> = {};
  for (const k of new Set(samples.map(s=>keyArray(s.arrayRows,s.arrayCols)).filter(Boolean) as string[])) byArray[k] = median(samples.filter(s=>keyArray(s.arrayRows,s.arrayCols)===k).map(s=>s.factor));
  const byOp: Record<string, number> = {};
  for (const k of new Set(samples.map(s=>keyOp(s.model,s.opName)).filter(Boolean) as string[])) byOp[k] = median(samples.filter(s=>keyOp(s.model,s.opName)===k).map(s=>s.factor));
  const byDataflow: Partial<Record<Dataflow, number>> = {};
  for (const df of ["WS","OS","IS"] as Dataflow[]) { const vals = samples.filter(s=>s.dataflow===df).map(s=>s.factor); if (vals.length) byDataflow[df] = median(vals); }
  return { name, createdAt: new Date().toISOString(), globalCycleFactor: median(samples.map(s=>s.factor)), byArray, byOp, byDataflow, residual: { byTileK: factorsByBucket(samples, s=>bucketTileK(s.tileK)), byTileArea: factorsByBucket(samples, s=>bucketTileArea(s.tileM,s.tileN)), bySramPressure: factorsByBucket(samples, s=>bucketPressure(s.sramPressure)), byPadding: factorsByBucket(samples, s=>bucketPadding(s.paddingRatio)), byMemoryBound: factorsByBucket(samples, s=>bucketMemory(s.memoryBoundRatio)) }, samples };
}
function mape(pairs: ReadonlyArray<readonly [number, number]>) { return pairs.length ? pairs.reduce((a,[pred,ref])=>a+Math.abs((pred-ref)/Math.max(1,ref))*100,0)/pairs.length : 0; }
