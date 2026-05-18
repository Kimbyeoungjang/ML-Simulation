import { readFile } from "node:fs/promises";
import path from "node:path";
import type { JobRecord } from "@/types/job";
import type { SearchRequest } from "@/types/domain";
import { estimateAll } from "./estimator";
import { parseEstimatorCsv, toEstimatorCsv } from "./estimatorSuiteArtifacts";

export interface CollectedEstimatorSampleRow {
  id: string;
  model: string;
  opName: string;
  arrayRows: number;
  arrayCols: number;
  sramKB: number;
  frequencyMHz: number;
  dataflow: string;
  dtypeBytes: number;
  m: number;
  n: number;
  k: number;
  tileM: number;
  tileN: number;
  tileK: number;
  estimatorCycles: number;
  measuredCycles: number;
  estimatorSramBytes?: number;
  measuredSramBytes?: number;
  estimatorDramBytes?: number;
  measuredDramBytes?: number;
  estimatorUtilization?: number;
  measuredUtilization?: number;
  scaleSimRunName: string;
  jobId: string;
  jobName: string;
}

export interface CollectEstimatorJobSamplesResult {
  rows: CollectedEstimatorSampleRow[];
  skipped: Array<{ jobId: string; name?: string; reason: string }>;
}

function n(v: unknown, fallback = NaN) {
  const x = Number(v);
  return Number.isFinite(x) ? x : fallback;
}

function firstPositive(values: unknown[]) {
  for (const v of values) {
    const x = n(v);
    if (x > 0) return x;
  }
  return NaN;
}

function firstFinite(values: unknown[]) {
  for (const v of values) {
    const x = n(v);
    if (Number.isFinite(x)) return x;
  }
  return undefined;
}

function accessBytes(accesses: unknown, dtypeBytes: number) {
  const x = n(accesses);
  if (!(x > 0)) return undefined;
  return Math.round(x * Math.max(1, dtypeBytes || 1));
}

function utilizationFraction(value: unknown) {
  const x = n(value);
  if (!(x > 0)) return undefined;
  return x > 1 ? x / 100 : x;
}

function sameTile(layer: any, tileM: number, tileN: number, tileK: number) {
  return n(layer?.tileM) === tileM && n(layer?.tileN) === tileN && n(layer?.tileK) === tileK;
}

function pickScaleLayer(scale: any, shape: any, tileM: number, tileN: number, tileK: number) {
  const candidates = Array.isArray(scale?.candidateLayers) ? scale.candidateLayers : [];
  const layers = Array.isArray(scale?.layers) ? scale.layers : [];
  return (
    candidates.find((l: any) => sameTile(l, tileM, tileN, tileK) && (!shape?.opName || l.opName === shape.opName || l.name === shape.opName)) ||
    candidates.find((l: any) => sameTile(l, tileM, tileN, tileK)) ||
    layers.find((l: any) => sameTile(l, tileM, tileN, tileK) && (!shape?.opName || l.opName === shape.opName || l.name === shape.opName)) ||
    layers.find((l: any) => shape?.opName && (l.opName === shape.opName || l.name === shape.opName)) ||
    layers[0]
  );
}

async function readJsonMaybe<T = any>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function requestShapeKey(req: SearchRequest | undefined) {
  const s = req?.shapes?.[0];
  const h = req?.hardware;
  const c = req?.candidates;
  if (!s || !h || !c) return undefined;
  return [
    s.id,
    s.model,
    s.opName,
    h.arrayRows,
    h.arrayCols,
    h.sramKB,
    h.dataflow,
    s.m,
    s.n,
    s.k,
    c.tileM?.[0],
    c.tileN?.[0],
    c.tileK?.[0],
  ].join("|");
}

function csvRowKey(row: Record<string, string>) {
  return [
    row.id || row.scaleSimRunName || "",
    row.model || "",
    row.opName || row.op_name || "",
    row.arrayRows || row.array_rows || "",
    row.arrayCols || row.array_cols || "",
    row.sramKB || row.sram_kb || "",
    row.dataflow || "",
    row.m || row.M || "",
    row.n || row.N || "",
    row.k || row.K || "",
    row.tileM || row.tm || row.tile_m || "",
    row.tileN || row.tn || row.tile_n || "",
    row.tileK || row.tk || row.tile_k || "",
  ].join("|");
}

function rowAliases(row: Record<string, string>) {
  return new Set([row.id, row.scaleSimRunName, row.opName, row.op_name].filter(Boolean));
}

function jobAliases(job: JobRecord) {
  const s = job.request?.shapes?.[0];
  return new Set([job.id, job.name, s?.id, s?.opName, job.request?.scaleSim?.runName].filter(Boolean) as string[]);
}

export async function collectEstimatorSamplesFromJobs(jobs: JobRecord[], jobRoot: string): Promise<CollectEstimatorJobSamplesResult> {
  const rows: CollectedEstimatorSampleRow[] = [];
  const skipped: CollectEstimatorJobSamplesResult["skipped"] = [];
  for (const job of jobs) {
    if (job.kind !== "full-pipeline") continue;
    if (job.status !== "succeeded" && job.status !== "succeeded_with_warnings") {
      skipped.push({ jobId: job.id, name: job.name, reason: `status=${job.status}` });
      continue;
    }
    const dir = path.join(jobRoot, job.id);
    const scale = await readJsonMaybe<any>(path.join(dir, "scalesim_summary.json"));
    if (!scale?.ok) {
      skipped.push({ jobId: job.id, name: job.name, reason: "missing or failed scalesim_summary.json" });
      continue;
    }
    const req = job.request;
    const shape = req?.shapes?.[0];
    const hw = req?.hardware;
    const tileM = n(req?.candidates?.tileM?.[0]);
    const tileN = n(req?.candidates?.tileN?.[0]);
    const tileK = n(req?.candidates?.tileK?.[0]);
    if (!shape || !hw || ![tileM, tileN, tileK].every((v) => v > 0)) {
      skipped.push({ jobId: job.id, name: job.name, reason: "job request is not a single sampled GEMM tile" });
      continue;
    }

    const resultJson = await readJsonMaybe<any>(path.join(dir, "result.json"));
    const response = resultJson?.payload?.response ?? resultJson?.response ?? resultJson;
    const resultRow = Array.isArray(response?.results) ? response.results[0] : undefined;
    let estimatorCycles = firstPositive([resultRow?.best?.rawCycles, resultRow?.best?.cycles, resultRow?.cycles, response?.summary?.analyticalTotalCycles, response?.summary?.totalCycles]);
    let estimatorSramBytes = firstPositive([resultRow?.best?.sramBytes, resultRow?.sramBytes]);
    let estimatorUtilization = firstFinite([resultRow?.best?.utilization, resultRow?.utilization]);
    if (!(estimatorCycles > 0) || !(estimatorSramBytes > 0) || estimatorUtilization === undefined) {
      try {
        const fresh = estimateAll(req);
        const freshRow = fresh.results?.[0];
        estimatorCycles = estimatorCycles > 0 ? estimatorCycles : fresh.summary.totalCycles;
        estimatorSramBytes = estimatorSramBytes > 0 ? estimatorSramBytes : firstPositive([freshRow?.best?.sramBytes, fresh.summary.maxSramBytes]);
        estimatorUtilization = estimatorUtilization ?? firstFinite([fresh.summary.meanUtilization, freshRow?.best?.utilization]);
      } catch {
        estimatorCycles = estimatorCycles > 0 ? estimatorCycles : NaN;
      }
    }
    const matchedLayer = pickScaleLayer(scale, shape, tileM, tileN, tileK);
    const measuredCycles = firstPositive([
      matchedLayer?.tileExtrapolatedCycles,
      matchedLayer?.cycles,
      scale.totalCycles,
      scale.totalCyclesInclPrefetch,
    ]);
    const dtypeBytes = shape.dtypeBytes ?? hw.bytesPerElement ?? 2;
    const measuredSramBytes = accessBytes(firstPositive([matchedLayer?.sramAccessBytes, matchedLayer?.sramBytes, matchedLayer?.sramAccesses]), dtypeBytes);
    const measuredDramBytes = accessBytes(firstPositive([matchedLayer?.dramAccessBytes, matchedLayer?.dramBytes, matchedLayer?.dramAccesses]), dtypeBytes);
    const measuredUtilization = utilizationFraction(firstFinite([matchedLayer?.computeUtil, matchedLayer?.overallUtil, matchedLayer?.mappingEfficiency]));
    const estimatorDramBytes = firstPositive([
      resultRow?.best?.dramBytes,
      resultRow?.dramBytes,
      (shape.m * shape.k + shape.k * shape.n + shape.m * shape.n) * dtypeBytes,
    ]);
    if (!(estimatorCycles > 0) || !(measuredCycles > 0)) {
      skipped.push({ jobId: job.id, name: job.name, reason: "missing positive estimatorCycles or measuredCycles" });
      continue;
    }
    rows.push({
      id: shape.id || job.name || job.id,
      model: shape.model || "sampling_plan",
      opName: shape.opName || shape.id || "op",
      arrayRows: hw.arrayRows,
      arrayCols: hw.arrayCols,
      sramKB: hw.sramKB,
      frequencyMHz: hw.frequencyMHz,
      dataflow: hw.dataflow,
      dtypeBytes,
      m: shape.m,
      n: shape.n,
      k: shape.k,
      tileM,
      tileN,
      tileK,
      estimatorCycles: Math.round(estimatorCycles),
      measuredCycles: Math.round(measuredCycles),
      estimatorSramBytes: estimatorSramBytes > 0 ? Math.round(estimatorSramBytes) : undefined,
      measuredSramBytes,
      estimatorDramBytes: estimatorDramBytes > 0 ? Math.round(estimatorDramBytes) : undefined,
      measuredDramBytes,
      estimatorUtilization: estimatorUtilization === undefined ? undefined : estimatorUtilization,
      measuredUtilization,
      scaleSimRunName: req.scaleSim?.runName || job.name || job.id,
      jobId: job.id,
      jobName: job.name || job.id,
    });
  }
  return { rows, skipped };
}

export function mergeCollectedSamplesIntoCsv(csvText: string, collected: CollectedEstimatorSampleRow[]) {
  const existing = parseEstimatorCsv(csvText);
  if (!existing.length) return toEstimatorCsv(collected as unknown as Record<string, unknown>[]);
  const byId = new Map<string, CollectedEstimatorSampleRow>();
  const byKey = new Map<string, CollectedEstimatorSampleRow>();
  for (const row of collected) {
    const aliases = [row.id, row.scaleSimRunName, row.opName, row.jobName, row.jobId].filter(Boolean);
    for (const a of aliases) byId.set(String(a), row);
    byKey.set([
      row.id,
      row.model,
      row.opName,
      row.arrayRows,
      row.arrayCols,
      row.sramKB,
      row.dataflow,
      row.m,
      row.n,
      row.k,
      row.tileM,
      row.tileN,
      row.tileK,
    ].join("|"), row);
  }
  const used = new Set<string>();
  const merged = existing.map((r) => {
    let match: CollectedEstimatorSampleRow | undefined;
    for (const a of rowAliases(r)) {
      match = byId.get(String(a));
      if (match) break;
    }
    match = match ?? byKey.get(csvRowKey(r));
    if (!match) return r;
    used.add(match.jobId);
    return {
      ...r,
      id: r.id || match.id,
      model: r.model || match.model,
      opName: r.opName || match.opName,
      arrayRows: r.arrayRows || match.arrayRows,
      arrayCols: r.arrayCols || match.arrayCols,
      sramKB: r.sramKB || match.sramKB,
      frequencyMHz: r.frequencyMHz || match.frequencyMHz,
      dataflow: r.dataflow || match.dataflow,
      dtypeBytes: r.dtypeBytes || match.dtypeBytes,
      m: r.m || match.m,
      n: r.n || match.n,
      k: r.k || match.k,
      tileM: r.tileM || match.tileM,
      tileN: r.tileN || match.tileN,
      tileK: r.tileK || match.tileK,
      estimatorCycles: r.estimatorCycles || match.estimatorCycles,
      measuredCycles: String(match.measuredCycles),
      estimatorSramBytes: r.estimatorSramBytes || match.estimatorSramBytes,
      measuredSramBytes: match.measuredSramBytes === undefined ? r.measuredSramBytes : String(match.measuredSramBytes),
      estimatorDramBytes: r.estimatorDramBytes || match.estimatorDramBytes,
      measuredDramBytes: match.measuredDramBytes === undefined ? r.measuredDramBytes : String(match.measuredDramBytes),
      estimatorUtilization: r.estimatorUtilization || match.estimatorUtilization,
      measuredUtilization: match.measuredUtilization === undefined ? r.measuredUtilization : String(match.measuredUtilization),
      scaleSimRunName: r.scaleSimRunName || match.scaleSimRunName,
      jobId: match.jobId,
      jobName: match.jobName,
    };
  });
  for (const row of collected) if (!used.has(row.jobId)) merged.push(row as unknown as Record<string, string>);
  return toEstimatorCsv(merged as unknown as Record<string, unknown>[]);
}
