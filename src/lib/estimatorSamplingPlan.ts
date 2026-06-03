import { estimateTile } from "./estimator";
import { toEstimatorCsv } from "./estimatorSuiteArtifacts";
import { workloadPresets } from "./presets";
import type { Dataflow, MatmulShape, SearchRequest } from "@/types/domain";

export interface EstimatorSamplingPlanOptions {
  mRange?: string;
  nRange?: string;
  kRange?: string;
  tileMRange?: string;
  tileNRange?: string;
  tileKRange?: string;
  arrayRange?: string;
  sramKbRange?: string;
  dataflows?: string;
  maxSamples?: number;
  includeCurrentShapes?: boolean;
  topKPerShape?: number;
  /**
   * Comma-separated workload preset selectors. Supports exact preset names and aliases:
   * all, transformer, vit, bert, gpt, llm, cnn/resnet.
   */
  shapeBank?: string;
}

export interface EstimatorSamplingPlanRow {
  id: string;
  model: string;
  opName: string;
  arrayRows: number;
  arrayCols: number;
  sramKB: number;
  frequencyMHz: number;
  memoryBandwidthGBs?: number | string;
  dispatchOverheadUs?: number | string;
  dataflow: Dataflow;
  dtypeBytes: number;
  m: number;
  n: number;
  k: number;
  tileM: number;
  tileN: number;
  tileK: number;
  estimatorCycles: number;
  measuredCycles: string;
  scaleSimRunName: string;
}

function uniqSorted(values: number[]) {
  return Array.from(new Set(values.filter((v) => Number.isFinite(v) && v > 0).map((v) => Math.floor(v)))).sort((a, b) => a - b);
}

export function parsePlanRange(text: string | undefined, fallback: number[] = []): number[] {
  const src = String(text ?? "").trim();
  if (!src) return uniqSorted(fallback);
  const out: number[] = [];
  for (const part of src.split(/[,\s]+/).map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+(?:\.\d+)?):(\d+(?:\.\d+)?)(?::(\d+(?:\.\d+)?))?$/);
    if (m) {
      const start = Number(m[1]);
      const end = Number(m[2]);
      const step = Number(m[3] ?? 1);
      if (Number.isFinite(start) && Number.isFinite(end) && Number.isFinite(step) && step > 0) {
        const dir = start <= end ? 1 : -1;
        for (let v = start; dir > 0 ? v <= end + 1e-9 : v >= end - 1e-9; v += dir * step) out.push(Math.round(v));
      }
    } else {
      const v = Number(part);
      if (Number.isFinite(v)) out.push(Math.round(v));
    }
  }
  return uniqSorted(out.length ? out : fallback);
}

export function parseArrayRange(text: string | undefined, fallbackRows: number, fallbackCols: number) {
  const src = String(text ?? "").trim();
  if (!src) return [{ rows: fallbackRows, cols: fallbackCols }];
  const out: Array<{ rows: number; cols: number }> = [];
  for (const part of src.split(/[,\s]+/).map((p) => p.trim()).filter(Boolean)) {
    const m = part.match(/^(\d+)x(\d+)$/i);
    if (m) out.push({ rows: Number(m[1]), cols: Number(m[2]) });
    else {
      const v = Number(part);
      if (Number.isFinite(v) && v > 0) out.push({ rows: Math.floor(v), cols: Math.floor(v) });
    }
  }
  const seen = new Set<string>();
  return out.filter((a) => {
    const key = `${a.rows}x${a.cols}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return a.rows > 0 && a.cols > 0;
  });
}

function parseDataflows(text: string | undefined, fallback: Dataflow): Dataflow[] {
  const allowed = new Set<Dataflow>(["WS", "OS", "IS"]);
  const raw = String(text ?? "").trim();
  const values = raw ? raw.split(/[,\s]+/) : [fallback];
  const out = values.map((v) => v.toUpperCase()).filter((v): v is Dataflow => allowed.has(v as Dataflow));
  return out.length ? Array.from(new Set(out)) : [fallback];
}

function shapeBankPresetNames(selectorText: string | undefined): string[] {
  const allNames = Object.keys(workloadPresets);
  const raw = String(selectorText ?? "").trim();
  if (!raw) return [];
  const tokens = raw.split(/[,;\n]+/).map((token) => token.trim()).filter(Boolean);
  const picked = new Set<string>();

  function addWhere(predicate: (name: string) => boolean) {
    for (const name of allNames) {
      if (predicate(name)) picked.add(name);
    }
  }

  for (const token of tokens) {
    const lower = token.toLowerCase();
    if (lower === "all" || lower === "registered" || lower === "workloads") {
      allNames.forEach((name) => picked.add(name));
    } else if (lower === "transformer" || lower === "encoder" || lower === "vit-bert-gpt") {
      addWhere((name) => /vit|bert|gpt/i.test(name));
    } else if (lower === "vit") {
      addWhere((name) => /vit/i.test(name));
    } else if (lower === "bert") {
      addWhere((name) => /bert/i.test(name));
    } else if (lower === "gpt") {
      addWhere((name) => /gpt/i.test(name));
    } else if (lower === "llm" || lower === "llama" || lower === "projection") {
      addWhere((name) => /llama|gpt/i.test(name));
    } else if (lower === "cnn" || lower === "conv" || lower === "resnet") {
      addWhere((name) => /resnet|cnn|conv/i.test(name));
    } else {
      const exact = allNames.find((name) => name.toLowerCase() === lower);
      if (exact) picked.add(exact);
      else addWhere((name) => name.toLowerCase().includes(lower));
    }
  }

  return Array.from(picked);
}

function workloadPresetShapes(selectorText: string | undefined): MatmulShape[] {
  const names = shapeBankPresetNames(selectorText);
  const rows: MatmulShape[] = [];
  for (const name of names) {
    const shapes = workloadPresets[name] ?? [];
    for (const shape of shapes) {
      rows.push({
        ...shape,
        id: `bank_${name.replace(/[^A-Za-z0-9]+/g, "_")}_${shape.id}`,
        source: shape.source ?? "import",
      });
    }
  }
  return rows;
}

function generatedShapes(base: SearchRequest, options: EstimatorSamplingPlanOptions): MatmulShape[] {
  const mValues = parsePlanRange(options.mRange, []);
  const nValues = parsePlanRange(options.nRange, []);
  const kValues = parsePlanRange(options.kRange, []);
  const rows: MatmulShape[] = [];
  if (options.includeCurrentShapes !== false) rows.push(...base.shapes);
  rows.push(...workloadPresetShapes(options.shapeBank));
  if (mValues.length && nValues.length && kValues.length) {
    for (const m of mValues) for (const n of nValues) for (const k of kValues) {
      rows.push({ id: `plan_m${m}_n${n}_k${k}`, model: "sampling_plan", opName: `gemm_${m}x${n}x${k}`, m, n, k, dtypeBytes: base.hardware.bytesPerElement, source: "manual" });
    }
  }
  const seen = new Set<string>();
  return rows.filter((s) => {
    const key = `${s.m}x${s.n}x${s.k}:${s.dtypeBytes}:${s.model}:${s.opName}:${s.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return s.m > 0 && s.n > 0 && s.k > 0;
  });
}

function gcd(a: number, b: number): number {
  let x = Math.abs(Math.floor(a));
  let y = Math.abs(Math.floor(b));
  while (y) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function coprimeStride(total: number): number {
  if (total <= 2) return 1;
  let stride = Math.max(1, Math.floor(total * 0.61803398875));
  if (stride % 2 === 0) stride += 1;
  while (stride > 1 && gcd(stride, total) !== 1) stride -= 2;
  return Math.max(1, stride);
}

export function buildEstimatorSamplingPlan(base: SearchRequest, options: EstimatorSamplingPlanOptions = {}) {
  const maxSamples = Math.max(1, Math.floor(options.maxSamples ?? 512));
  const arrays = parseArrayRange(options.arrayRange, base.hardware.arrayRows, base.hardware.arrayCols);
  const srams = parsePlanRange(options.sramKbRange, [base.hardware.sramKB]);
  const dataflows = parseDataflows(options.dataflows, base.hardware.dataflow);
  const tileMValues = parsePlanRange(options.tileMRange, base.candidates.tileM);
  const tileNValues = parsePlanRange(options.tileNRange, base.candidates.tileN);
  const tileKValues = parsePlanRange(options.tileKRange, base.candidates.tileK);
  const shapes = generatedShapes(base, options);
  const rows: EstimatorSamplingPlanRow[] = [];
  const topK = Math.max(1, Math.floor(options.topKPerShape ?? 1));
  const totalCombos = arrays.length * srams.length * shapes.length * dataflows.length;
  const comboBudget = Math.min(totalCombos, Math.ceil(maxSamples / topK));
  const stride = coprimeStride(totalCombos);

  // Deterministically interleave array/SRAM/shape/dataflow axes instead of
  // exhausting the first array/SRAM bucket. This matters for integrated presets
  // where the synthetic shape grid is much larger than maxSamples.
  for (let pick = 0; pick < comboBudget && rows.length < maxSamples; pick++) {
    let cursor = (pick * stride) % totalCombos;
    const dataflow = dataflows[cursor % dataflows.length];
    cursor = Math.floor(cursor / dataflows.length);
    const shape = shapes[cursor % shapes.length];
    cursor = Math.floor(cursor / shapes.length);
    const sramKB = srams[cursor % srams.length];
    cursor = Math.floor(cursor / srams.length);
    const array = arrays[cursor % arrays.length];

    const hw = { ...base.hardware, arrayRows: array.rows, arrayCols: array.cols, sramKB, dataflow };
    const candidates = [];
    for (const tileM of tileMValues) for (const tileN of tileNValues) for (const tileK of tileKValues) {
      candidates.push(estimateTile(hw, shape, tileM, tileN, tileK, base.objective));
    }
    candidates.sort((a, b) => a.score - b.score);
    const selected = candidates.slice(0, topK);
    for (const tile of selected) {
      const idx = rows.length;
      const id = `sample_${idx}_${array.rows}x${array.cols}_${dataflow}_${sramKB}KB_${shape.m}x${shape.n}x${shape.k}_${tile.tileM}x${tile.tileN}x${tile.tileK}`;
      rows.push({
        id,
        model: shape.model,
        opName: shape.opName,
        arrayRows: array.rows,
        arrayCols: array.cols,
        sramKB,
        frequencyMHz: hw.frequencyMHz,
        memoryBandwidthGBs: hw.memoryBandwidthGBs ?? "",
        dispatchOverheadUs: hw.dispatchOverheadUs ?? "",
        dataflow,
        dtypeBytes: shape.dtypeBytes,
        m: shape.m,
        n: shape.n,
        k: shape.k,
        tileM: tile.tileM,
        tileN: tile.tileN,
        tileK: tile.tileK,
        estimatorCycles: tile.cycles,
        measuredCycles: "",
        scaleSimRunName: id,
      });
      if (rows.length >= maxSamples) break;
    }
  }
  const csv = toEstimatorCsv(rows as unknown as Record<string, unknown>[]);
  return { rows, csv, totalRows: rows.length };
}

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function isHeavyScaleSimPlanRow(row: EstimatorSamplingPlanRow): boolean {
  const peCount = Math.max(1, row.arrayRows * row.arrayCols);
  const macs = row.m * row.n * row.k;
  const tileCount =
    Math.ceil(row.m / Math.max(1, row.tileM)) *
    Math.ceil(row.n / Math.max(1, row.tileN)) *
    Math.ceil(row.k / Math.max(1, row.tileK));
  const opsPerPe = macs / peCount;
  const peThreshold = envNumber("TILEFORGE_HEAVY_SCALESIM_PE_THRESHOLD", 65_536);
  const tileThreshold = envNumber("TILEFORGE_HEAVY_SCALESIM_TILE_COUNT_THRESHOLD", 10_000);
  const opsPerPeThreshold = envNumber("TILEFORGE_HEAVY_SCALESIM_OPS_PER_PE_THRESHOLD", 5_000_000);
  const macThreshold = envNumber("TILEFORGE_HEAVY_SCALESIM_MAC_THRESHOLD", 10_000_000_000);
  return (
    peCount >= peThreshold ||
    tileCount >= tileThreshold ||
    opsPerPe >= opsPerPeThreshold ||
    macs >= macThreshold
  );
}

export function requestFromPlanRow(base: SearchRequest, row: EstimatorSamplingPlanRow): SearchRequest {
  const heavyScaleSim = isHeavyScaleSimPlanRow(row);
  const inheritedScaleSim = base.scaleSim ?? {};
  return {
    ...base,
    hardware: {
      ...base.hardware,
      name: `${base.hardware.name}_${row.arrayRows}x${row.arrayCols}_${row.dataflow}_${row.sramKB}KB`,
      arrayRows: row.arrayRows,
      arrayCols: row.arrayCols,
      sramKB: row.sramKB,
      dataflow: row.dataflow,
      frequencyMHz: row.frequencyMHz,
      bytesPerElement: row.dtypeBytes,
    },
    shapes: [{ id: row.id, model: row.model, opName: row.opName, m: row.m, n: row.n, k: row.k, dtypeBytes: row.dtypeBytes, source: "manual" }],
    candidates: { tileM: [row.tileM], tileN: [row.tileN], tileK: [row.tileK] },
    scaleSim: {
      ...inheritedScaleSim,
      runName: row.scaleSimRunName,
      dataflow: row.dataflow,
      measurementMode: inheritedScaleSim.measurementMode ?? (heavyScaleSim ? "tile-policy" : "both"),
      skipOnTimeout: inheritedScaleSim.skipOnTimeout ?? heavyScaleSim,
    },
    maxResultsPerOp: 1,
  };
}
