import type { CalibrationProfile, CalibrationSample, Dataflow, HardwareConfig, MatmulShape, TileCandidateResult } from "@/types/domain";

function median(xs: number[]): number {
  const ys = xs.filter(Number.isFinite).sort((a,b)=>a-b);
  if (!ys.length) return 1;
  const mid = Math.floor(ys.length / 2);
  return ys.length % 2 ? ys[mid] : (ys[mid-1] + ys[mid]) / 2;
}
function keyArray(r?: number, c?: number) { return r && c ? `${r}x${c}` : undefined; }
function keyOp(model?: string, opName?: string) { return model && opName ? `${model}/${opName}` : opName; }

export function parseMeasurementCsv(text: string, frequencyMHz = 1000): CalibrationProfile {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) throw new Error("measurement CSV needs a header and at least one row");
  const headers = lines[0].split(",").map(h=>h.trim());
  const idx = (names: string[]) => headers.findIndex(h => names.includes(h.toLowerCase()));
  const col = { model: idx(["model"]), opName: idx(["op","op_name","opname"]), array: idx(["array"]), arrayRows: idx(["array_rows","arrayrows","rows"]), arrayCols: idx(["array_cols","arraycols","cols"]), dataflow: idx(["dataflow"]), tileM: idx(["tile_m","tilem"]), tileN: idx(["tile_n","tilen"]), tileK: idx(["tile_k","tilek"]), predictedCycles: idx(["predicted_cycles","predictedcycles","estimate_cycles","cycles_pred"]), measuredCycles: idx(["measured_cycles","measuredcycles","scalesim_cycles","cycles"]), runtimeUs: idx(["runtime_us","runtimeus","iree_runtime_us","time_us"]), runtimeMs: idx(["runtime_ms","runtimems","iree_runtime_ms","time_ms"]) };
  const get = (parts: string[], i: number) => i >= 0 ? parts[i]?.trim() : undefined;
  const samples: CalibrationSample[] = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(",");
    const predictedCycles = Number(get(parts, col.predictedCycles));
    let measuredCycles = col.measuredCycles >= 0 ? Number(get(parts, col.measuredCycles)) : undefined;
    const runtimeUs = col.runtimeUs >= 0 ? Number(get(parts, col.runtimeUs)) : (col.runtimeMs >= 0 ? Number(get(parts, col.runtimeMs)) * 1000 : undefined);
    if ((!measuredCycles || !Number.isFinite(measuredCycles)) && runtimeUs && Number.isFinite(runtimeUs)) measuredCycles = runtimeUs * frequencyMHz;
    if (!predictedCycles || !measuredCycles || !Number.isFinite(predictedCycles) || !Number.isFinite(measuredCycles)) continue;
    let arrayRows = col.arrayRows >= 0 ? Number(get(parts, col.arrayRows)) : undefined;
    let arrayCols = col.arrayCols >= 0 ? Number(get(parts, col.arrayCols)) : undefined;
    const arr = get(parts, col.array);
    if (arr && (!arrayRows || !arrayCols)) { const m = arr.match(/(\d+)x(\d+)/i); if (m) { arrayRows=Number(m[1]); arrayCols=Number(m[2]); } }
    samples.push({ model: get(parts, col.model), opName: get(parts, col.opName), arrayRows, arrayCols, dataflow: get(parts, col.dataflow) as Dataflow | undefined, tileM: col.tileM>=0 ? Number(get(parts,col.tileM)) : undefined, tileN: col.tileN>=0 ? Number(get(parts,col.tileN)) : undefined, tileK: col.tileK>=0 ? Number(get(parts,col.tileK)) : undefined, predictedCycles, measuredCycles, measuredRuntimeUs: runtimeUs, factor: measuredCycles / predictedCycles });
  }
  if (!samples.length) throw new Error("no valid calibration rows found");
  const byArray: Record<string, number> = {};
  for (const k of new Set(samples.map(s=>keyArray(s.arrayRows,s.arrayCols)).filter(Boolean) as string[])) byArray[k] = median(samples.filter(s=>keyArray(s.arrayRows,s.arrayCols)===k).map(s=>s.factor));
  const byOp: Record<string, number> = {};
  for (const k of new Set(samples.map(s=>keyOp(s.model,s.opName)).filter(Boolean) as string[])) byOp[k] = median(samples.filter(s=>keyOp(s.model,s.opName)===k).map(s=>s.factor));
  const byDataflow: Partial<Record<Dataflow, number>> = {};
  for (const df of ["WS","OS","IS"] as Dataflow[]) { const vals = samples.filter(s=>s.dataflow===df).map(s=>s.factor); if (vals.length) byDataflow[df] = median(vals); }
  return { name: "measurement-calibration", createdAt: new Date().toISOString(), globalCycleFactor: median(samples.map(s=>s.factor)), byArray, byOp, byDataflow, samples };
}

export function calibrationFactor(profile: CalibrationProfile | undefined, hw: HardwareConfig, shape: MatmulShape): number {
  if (!profile) return 1;
  const factors: number[] = [];
  const opK = keyOp(shape.model, shape.opName);
  if (opK && profile.byOp?.[opK]) factors.push(profile.byOp[opK]);
  const arrK = keyArray(hw.arrayRows, hw.arrayCols);
  if (arrK && profile.byArray?.[arrK]) factors.push(profile.byArray[arrK]);
  if (profile.byDataflow?.[hw.dataflow]) factors.push(profile.byDataflow[hw.dataflow]!);
  if (!factors.length) return profile.globalCycleFactor || 1;
  // Geometric-ish blend to avoid one noisy category dominating.
  const weighted = factors.reduce((a,b)=>a*b, 1) ** (1 / factors.length);
  return Math.max(0.05, Math.min(50, weighted));
}

export function applyCalibration(result: TileCandidateResult, factor: number): TileCandidateResult {
  const raw = result.rawCycles ?? result.cycles;
  const cycles = Math.max(1, Math.ceil(raw * factor));
  return { ...result, rawCycles: raw, cycles, timeUs: result.timeUs * factor, calibrationFactor: factor };
}

export function profileToMarkdown(profile?: CalibrationProfile): string {
  if (!profile) return "보정 profile이 적용되지 않았습니다.";
  return [`보정 profile: ${profile.name}`, `Sample 수: ${profile.samples.length}`, `전역 cycle 보정 계수: ${profile.globalCycleFactor.toFixed(4)}`, "", "배열별 보정 계수:", ...Object.entries(profile.byArray ?? {}).map(([k,v])=>`- ${k}: ${v.toFixed(4)}`), "", "데이터플로우별 보정 계수:", ...Object.entries(profile.byDataflow ?? {}).map(([k,v])=>`- ${k}: ${Number(v).toFixed(4)}`)].join("\n");
}

export interface CalibrationSplitReport {
  train: CalibrationProfile;
  trainSamples: number;
  testSamples: number;
  beforeMapePct: number;
  afterMapePct: number;
  markdown: string;
}

export function trainTestCalibration(samples: CalibrationSample[], trainRatio = 0.7): CalibrationSplitReport {
  const sorted = samples.slice().sort((a,b)=>`${a.model ?? ""}/${a.opName ?? ""}/${a.predictedCycles}`.localeCompare(`${b.model ?? ""}/${b.opName ?? ""}/${b.predictedCycles}`));
  const cut = Math.max(1, Math.min(sorted.length - 1, Math.round(sorted.length * trainRatio)));
  const trainSamples = sorted.slice(0, cut);
  const testSamples = sorted.slice(cut);
  const train = buildProfileFromSamples(trainSamples, "measurement-calibration-train");
  const before = mape(testSamples.map(s => [s.predictedCycles, s.measuredCycles ?? s.predictedCycles * s.factor] as const));
  const after = mape(testSamples.map(s => [s.predictedCycles * train.globalCycleFactor, s.measuredCycles ?? s.predictedCycles * s.factor] as const));
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
  return { name, createdAt: new Date().toISOString(), globalCycleFactor: median(samples.map(s=>s.factor)), byArray, byOp, byDataflow, samples };
}
function mape(pairs: ReadonlyArray<readonly [number, number]>) { return pairs.length ? pairs.reduce((a,[pred,ref])=>a+Math.abs((pred-ref)/Math.max(1,ref))*100,0)/pairs.length : 0; }
