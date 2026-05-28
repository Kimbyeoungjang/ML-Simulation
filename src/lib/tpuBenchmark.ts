import type { Dataflow, HardwareConfig, MatmulShape, SearchRequest, TileCandidates } from "@/types/domain";
import { estimateAll } from "./estimator";

export interface TpuBenchmarkExportRow {
  id: string;
  model: string;
  opName: string;
  m: number;
  n: number;
  k: number;
  dtypeBytes: number;
  dtype: string;
  hardwareName: string;
  array: string;
  dataflow: Dataflow;
  frequencyMHz: number;
  predictedCycles: number;
  predictedTimeUs: number;
  predictionConfidence: number;
  bestTileM: number;
  bestTileN: number;
  bestTileK: number;
  fullLayerComputeCycles: number;
  fullLayerStallCycles: number;
  tilePolicyCycles: number;
}

export interface TpuMeasurementRow {
  id?: string;
  model?: string;
  opName?: string;
  m: number;
  n: number;
  k: number;
  dtype?: string;
  medianUs?: number;
  meanUs?: number;
  minUs?: number;
  maxUs?: number;
  p90Us?: number;
  achievedTflops?: number;
  reps?: number;
}

export interface TpuComparisonRow extends TpuBenchmarkExportRow {
  measuredUs: number;
  measuredCycles: number;
  errorPct: number;
  runtimeRatio: number;
  achievedTflops?: number;
  meanUs?: number;
  p90Us?: number;
  reps?: number;
}

const EXPORT_HEADERS: Array<keyof TpuBenchmarkExportRow> = [
  "id",
  "model",
  "opName",
  "m",
  "n",
  "k",
  "dtypeBytes",
  "dtype",
  "hardwareName",
  "array",
  "dataflow",
  "frequencyMHz",
  "predictedCycles",
  "predictedTimeUs",
  "predictionConfidence",
  "bestTileM",
  "bestTileN",
  "bestTileK",
  "fullLayerComputeCycles",
  "fullLayerStallCycles",
  "tilePolicyCycles",
];

const COMPARISON_HEADERS: Array<keyof TpuComparisonRow> = [
  ...EXPORT_HEADERS,
  "measuredUs",
  "measuredCycles",
  "errorPct",
  "runtimeRatio",
  "achievedTflops",
  "meanUs",
  "p90Us",
  "reps",
];

function csvEscape(value: unknown): string {
  if (value === undefined || value === null) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function csvCells(line: string): string[] {
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') {
      cell += '"';
      i++;
      continue;
    }
    if (ch === '"') {
      quoted = !quoted;
      continue;
    }
    if (ch === "," && !quoted) {
      cells.push(cell.trim());
      cell = "";
      continue;
    }
    cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

function normalizeHeader(header: string): string {
  return header.trim().toLowerCase().replace(/[^a-z0-9]/g, "");
}

function parseNumber(value: unknown, field: string, rowNumber: number, options: { required?: boolean; positive?: boolean } = {}): number | undefined {
  if (value === undefined || value === null || String(value).trim() === "") {
    if (options.required) throw new Error(`CSV row ${rowNumber}: missing ${field}`);
    return undefined;
  }
  const n = Number(String(value).replace(/,/g, ""));
  if (!Number.isFinite(n) || (options.positive && n <= 0)) {
    throw new Error(`CSV row ${rowNumber}: invalid ${field}: ${value}`);
  }
  return n;
}

function asDataflow(value: string | undefined, fallback: Dataflow): Dataflow {
  const v = String(value || fallback).toUpperCase();
  if (v === "WS" || v === "OS" || v === "IS") return v;
  return fallback;
}

function dtypeFromBytes(dtypeBytes: number): string {
  if (dtypeBytes === 2) return "bf16";
  if (dtypeBytes === 4) return "f32";
  return `bytes${dtypeBytes}`;
}

function rowKey(row: Pick<TpuBenchmarkExportRow, "id" | "model" | "opName" | "m" | "n" | "k">): string {
  return [row.id || "", row.model || "", row.opName || "", row.m, row.n, row.k].join("|").toLowerCase();
}

function shapeKey(row: Pick<TpuBenchmarkExportRow, "m" | "n" | "k">): string {
  return `${row.m}x${row.n}x${row.k}`;
}

export function rowsToCsv<T extends Record<string, unknown>>(rows: T[], headers: string[]): string {
  return [headers.join(","), ...rows.map((row) => headers.map((header) => csvEscape(row[header])).join(","))].join("\n") + "\n";
}

export function parseCsvRecords(text: string): Array<Record<string, string>> {
  const lines = String(text || "").split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (!lines.length) return [];
  const rawHeaders = csvCells(lines[0]);
  const headers = rawHeaders.map(normalizeHeader);
  return lines.slice(1).map((line) => {
    const cells = csvCells(line);
    const record: Record<string, string> = {};
    headers.forEach((h, i) => {
      record[h] = cells[i] ?? "";
    });
    return record;
  });
}

function first(record: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const v = record[normalizeHeader(name)];
    if (v !== undefined && v !== "") return v;
  }
  return undefined;
}

export function buildTpuBenchmarkRows(request: SearchRequest, options: { dtype?: string } = {}): TpuBenchmarkExportRow[] {
  const response = estimateAll(request, { includeArtifacts: false });
  return response.results.map((result) => {
    const best = result.best;
    const shape = result.shape;
    const predictedCycles = Math.max(1, Math.round(best.fullLayerCycles ?? best.cycles));
    const frequencyMHz = Math.max(1, Number(request.hardware.frequencyMHz) || 1);
    return {
      id: shape.id,
      model: shape.model,
      opName: shape.opName,
      m: shape.m,
      n: shape.n,
      k: shape.k,
      dtypeBytes: shape.dtypeBytes,
      dtype: options.dtype || dtypeFromBytes(shape.dtypeBytes),
      hardwareName: request.hardware.name,
      array: `${request.hardware.arrayRows}x${request.hardware.arrayCols}`,
      dataflow: request.hardware.dataflow,
      frequencyMHz,
      predictedCycles,
      predictedTimeUs: predictedCycles / frequencyMHz,
      predictionConfidence: best.predictionConfidence ?? 1,
      bestTileM: best.tileM,
      bestTileN: best.tileN,
      bestTileK: best.tileK,
      fullLayerComputeCycles: Math.max(1, Math.round(best.fullLayerComputeCycles ?? predictedCycles)),
      fullLayerStallCycles: Math.max(0, Math.round(best.fullLayerStallCycles ?? 0)),
      tilePolicyCycles: Math.max(1, Math.round(best.tilePolicyCycles ?? best.cycles)),
    };
  });
}

export function tpuBenchmarkRowsToCsv(rows: TpuBenchmarkExportRow[]): string {
  return rowsToCsv(rows as unknown as Array<Record<string, unknown>>, EXPORT_HEADERS);
}

export function parseTpuBenchmarkExportCsv(text: string): TpuBenchmarkExportRow[] {
  return parseCsvRecords(text).map((record, i) => {
    const rowNumber = i + 2;
    const dtypeBytes = parseNumber(first(record, ["dtype_bytes", "dtypeBytes"]), "dtypeBytes", rowNumber, { required: true, positive: true }) ?? 2;
    const frequencyMHz = parseNumber(first(record, ["frequency_mhz", "frequencyMHz"]), "frequencyMHz", rowNumber, { required: true, positive: true }) ?? 1;
    return {
      id: first(record, ["id"]) || `row_${i}`,
      model: first(record, ["model"]) || "tpu-model",
      opName: first(record, ["op_name", "opName", "op"]) || `op_${i}`,
      m: parseNumber(first(record, ["m"]), "m", rowNumber, { required: true, positive: true }) ?? 1,
      n: parseNumber(first(record, ["n"]), "n", rowNumber, { required: true, positive: true }) ?? 1,
      k: parseNumber(first(record, ["k"]), "k", rowNumber, { required: true, positive: true }) ?? 1,
      dtypeBytes,
      dtype: first(record, ["dtype"]) || dtypeFromBytes(dtypeBytes),
      hardwareName: first(record, ["hardware_name", "hardwareName"]) || "unknown",
      array: first(record, ["array"]) || "unknown",
      dataflow: asDataflow(first(record, ["dataflow"]), "WS"),
      frequencyMHz,
      predictedCycles: parseNumber(first(record, ["predicted_cycles", "predictedCycles"]), "predictedCycles", rowNumber, { required: true, positive: true }) ?? 1,
      predictedTimeUs: parseNumber(first(record, ["predicted_time_us", "predictedTimeUs"]), "predictedTimeUs", rowNumber, { required: true, positive: true }) ?? 1,
      predictionConfidence: parseNumber(first(record, ["prediction_confidence", "predictionConfidence"]), "predictionConfidence", rowNumber) ?? 1,
      bestTileM: parseNumber(first(record, ["best_tile_m", "bestTileM"]), "bestTileM", rowNumber) ?? 0,
      bestTileN: parseNumber(first(record, ["best_tile_n", "bestTileN"]), "bestTileN", rowNumber) ?? 0,
      bestTileK: parseNumber(first(record, ["best_tile_k", "bestTileK"]), "bestTileK", rowNumber) ?? 0,
      fullLayerComputeCycles: parseNumber(first(record, ["full_layer_compute_cycles", "fullLayerComputeCycles"]), "fullLayerComputeCycles", rowNumber) ?? 0,
      fullLayerStallCycles: parseNumber(first(record, ["full_layer_stall_cycles", "fullLayerStallCycles"]), "fullLayerStallCycles", rowNumber) ?? 0,
      tilePolicyCycles: parseNumber(first(record, ["tile_policy_cycles", "tilePolicyCycles"]), "tilePolicyCycles", rowNumber) ?? 0,
    };
  });
}

export function parseTpuMeasurementCsv(text: string): TpuMeasurementRow[] {
  return parseCsvRecords(text).map((record, i) => {
    const rowNumber = i + 2;
    const medianUs = parseNumber(first(record, ["median_us", "medianUs", "measured_us", "measuredUs", "p50_us", "p50Us"]), "medianUs", rowNumber, { positive: true });
    const meanUs = parseNumber(first(record, ["mean_us", "meanUs"]), "meanUs", rowNumber, { positive: true });
    if (!medianUs && !meanUs) throw new Error(`CSV row ${rowNumber}: measurement CSV needs median_us/measured_us or mean_us`);
    return {
      id: first(record, ["id"]),
      model: first(record, ["model"]),
      opName: first(record, ["op_name", "opName", "op"]),
      m: parseNumber(first(record, ["m"]), "m", rowNumber, { required: true, positive: true }) ?? 1,
      n: parseNumber(first(record, ["n"]), "n", rowNumber, { required: true, positive: true }) ?? 1,
      k: parseNumber(first(record, ["k"]), "k", rowNumber, { required: true, positive: true }) ?? 1,
      dtype: first(record, ["dtype"]),
      medianUs,
      meanUs,
      minUs: parseNumber(first(record, ["min_us", "minUs"]), "minUs", rowNumber, { positive: true }),
      maxUs: parseNumber(first(record, ["max_us", "maxUs"]), "maxUs", rowNumber, { positive: true }),
      p90Us: parseNumber(first(record, ["p90_us", "p90Us"]), "p90Us", rowNumber, { positive: true }),
      achievedTflops: parseNumber(first(record, ["achieved_tflops", "achievedTflops"]), "achievedTflops", rowNumber, { positive: true }),
      reps: parseNumber(first(record, ["reps"]), "reps", rowNumber, { positive: true }),
    };
  });
}

export function compareTpuMeasurements(predicted: TpuBenchmarkExportRow[], measurements: TpuMeasurementRow[]): TpuComparisonRow[] {
  const byFullKey = new Map<string, TpuMeasurementRow>();
  const byShapeKey = new Map<string, TpuMeasurementRow>();
  for (const measurement of measurements) {
    const synthetic = {
      id: measurement.id || "",
      model: measurement.model || "",
      opName: measurement.opName || "",
      m: measurement.m,
      n: measurement.n,
      k: measurement.k,
    };
    byFullKey.set(rowKey(synthetic), measurement);
    if (!byShapeKey.has(shapeKey(measurement))) byShapeKey.set(shapeKey(measurement), measurement);
  }

  const rows: TpuComparisonRow[] = [];
  for (const pred of predicted) {
    const measurement = byFullKey.get(rowKey(pred)) ?? byShapeKey.get(shapeKey(pred));
    if (!measurement) continue;
    const measuredUs = measurement.medianUs ?? measurement.meanUs;
    if (!measuredUs) continue;
    const measuredCycles = measuredUs * pred.frequencyMHz;
    const errorPct = ((measuredCycles - pred.predictedCycles) / pred.predictedCycles) * 100;
    rows.push({
      ...pred,
      measuredUs,
      measuredCycles,
      errorPct,
      runtimeRatio: measuredUs / pred.predictedTimeUs,
      achievedTflops: measurement.achievedTflops,
      meanUs: measurement.meanUs,
      p90Us: measurement.p90Us,
      reps: measurement.reps,
    });
  }
  return rows;
}

export function tpuComparisonRowsToCsv(rows: TpuComparisonRow[]): string {
  return rowsToCsv(rows as unknown as Array<Record<string, unknown>>, COMPARISON_HEADERS);
}

export function tpuCalibrationCsv(rows: TpuComparisonRow[]): string {
  return rowsToCsv(
    rows.map((row) => ({
      model: row.model,
      op_name: row.opName,
      array: row.array,
      dataflow: row.dataflow,
      predicted_cycles: Math.round(row.predictedCycles),
      measured_cycles: Math.round(row.measuredCycles),
      measured_us: row.measuredUs,
      error_pct: row.errorPct,
      source: "tpu",
    })),
    ["model", "op_name", "array", "dataflow", "predicted_cycles", "measured_cycles", "measured_us", "error_pct", "source"],
  );
}

export function makeHardwareFromCli(base: HardwareConfig, options: Record<string, string | undefined>): HardwareConfig {
  const array = options.array;
  const [rows, cols] = array && /^\d+x\d+$/i.test(array)
    ? array.toLowerCase().split("x").map((v) => Number(v))
    : [base.arrayRows, base.arrayCols];
  return {
    ...base,
    name: options.hardwareName || base.name,
    arrayRows: rows || base.arrayRows,
    arrayCols: cols || base.arrayCols,
    frequencyMHz: Number(options.frequencyMHz || base.frequencyMHz),
    sramKB: Number(options.sramKb || options.sramKB || base.sramKB),
    dataflow: asDataflow(options.dataflow, base.dataflow),
    bytesPerElement: Number(options.bytesPerElement || base.bytesPerElement),
    memoryBandwidthGBs: options.memoryBandwidthGBs ? Number(options.memoryBandwidthGBs) : base.memoryBandwidthGBs,
  };
}

export function addQuickSanityShapes(shapes: MatmulShape[], dtypeBytes = 2): MatmulShape[] {
  const extras: MatmulShape[] = [
    { id: "quick_64", model: "quick", opName: "matmul_64", m: 64, n: 64, k: 64, dtypeBytes, source: "manual" },
    { id: "quick_128", model: "quick", opName: "matmul_128", m: 128, n: 128, k: 128, dtypeBytes, source: "manual" },
    { id: "quick_512", model: "quick", opName: "matmul_512", m: 512, n: 512, k: 512, dtypeBytes, source: "manual" },
    { id: "quick_1024", model: "quick", opName: "matmul_1024", m: 1024, n: 1024, k: 1024, dtypeBytes, source: "manual" },
    { id: "quick_k4096", model: "quick", opName: "matmul_256_256_4096", m: 256, n: 256, k: 4096, dtypeBytes, source: "manual" },
  ];
  const seen = new Set(shapes.map((shape) => shapeKey(shape)));
  return [...shapes, ...extras.filter((shape) => !seen.has(shapeKey(shape)))];
}

export function defaultTpuCandidates(arrayRows: number, arrayCols: number): TileCandidates {
  const base = [16, 32, 64, 128, 256, 512];
  const tileM = base.filter((v) => v <= Math.max(512, arrayRows * 2));
  const tileN = base.filter((v) => v <= Math.max(512, arrayCols * 2));
  const tileK = base.filter((v) => v <= 512);
  return { tileM, tileN, tileK };
}
