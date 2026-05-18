import { estimateTile } from "./estimator";
import { toEstimatorCsv } from "./estimatorSuiteArtifacts";
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
}

export interface EstimatorSamplingPlanRow {
  id: string;
  model: string;
  opName: string;
  arrayRows: number;
  arrayCols: number;
  sramKB: number;
  frequencyMHz: number;
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

function generatedShapes(base: SearchRequest, options: EstimatorSamplingPlanOptions): MatmulShape[] {
  const mValues = parsePlanRange(options.mRange, []);
  const nValues = parsePlanRange(options.nRange, []);
  const kValues = parsePlanRange(options.kRange, []);
  const rows: MatmulShape[] = [];
  if (options.includeCurrentShapes !== false) rows.push(...base.shapes);
  if (mValues.length && nValues.length && kValues.length) {
    for (const m of mValues) for (const n of nValues) for (const k of kValues) {
      rows.push({ id: `plan_m${m}_n${n}_k${k}`, model: "sampling_plan", opName: `gemm_${m}x${n}x${k}`, m, n, k, dtypeBytes: base.hardware.bytesPerElement, source: "manual" });
    }
  }
  const seen = new Set<string>();
  return rows.filter((s) => {
    const key = `${s.m}x${s.n}x${s.k}:${s.dtypeBytes}:${s.id}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return s.m > 0 && s.n > 0 && s.k > 0;
  });
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
  // Keep the loop order balanced across dataflows. The previous array → SRAM →
  // dataflow → shape order could exhaust maxSamples with WS only when the shape
  // grid was large. Shape-first + dataflow-inside makes the first N queued rows
  // cover WS/OS/IS together.
  outer: for (const array of arrays) for (const sramKB of srams) for (const shape of shapes) for (const dataflow of dataflows) {
    const hw = { ...base.hardware, arrayRows: array.rows, arrayCols: array.cols, sramKB, dataflow };
    const candidates = [];
    for (const tileM of tileMValues) for (const tileN of tileNValues) for (const tileK of tileKValues) {
      candidates.push(estimateTile(hw, shape, tileM, tileN, tileK, base.objective));
    }
    candidates.sort((a, b) => a.score - b.score);
    const selected = candidates.slice(0, Math.max(1, Math.floor(options.topKPerShape ?? 1)));
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
      if (rows.length >= maxSamples) break outer;
    }
  }
  const csv = toEstimatorCsv(rows as unknown as Record<string, unknown>[]);
  return { rows, csv, totalRows: rows.length };
}

export function requestFromPlanRow(base: SearchRequest, row: EstimatorSamplingPlanRow): SearchRequest {
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
    scaleSim: { ...(base.scaleSim ?? {}), runName: row.scaleSimRunName, dataflow: row.dataflow },
    maxResultsPerOp: 1,
  };
}
