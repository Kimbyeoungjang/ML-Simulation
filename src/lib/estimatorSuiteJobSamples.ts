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
    // Use the analytical pre-correction cycle as the model input. If an active
    // Estimator Suite was already applied to this job, `best.cycles` may be the
    // learned value, while `best.rawCycles` preserves the analytical baseline.
    let estimatorCycles = firstPositive([resultRow?.best?.rawCycles, resultRow?.best?.cycles, resultRow?.cycles, response?.summary?.totalCycles]);
    if (!(estimatorCycles > 0)) {
      try {
        estimatorCycles = estimateAll(req).summary.totalCycles;
      } catch {
        estimatorCycles = NaN;
      }
    }
    // For sampled tile jobs, the main SCALE-Sim topology runs the whole GEMM
    // layer and does not encode the selected tile shape. Using that value would
    // make every tile for the same M/N/K share the same target and teach the
    // learned estimator the wrong thing. Prefer the top-k tile-policy run, which
    // simulates the selected tile and extrapolates by tile count.
    const candidateLayers = Array.isArray(scale.candidateLayers) ? scale.candidateLayers : [];
    const matchedCandidate = candidateLayers.find((c: any) =>
      n(c?.tileM) === tileM && n(c?.tileN) === tileN && n(c?.tileK) === tileK &&
      (!c?.opName || !shape.opName || c.opName === shape.opName)
    ) ?? candidateLayers.find((c: any) => n(c?.rank) === 1);
    const measuredCycles = firstPositive([
      matchedCandidate?.cycles,
      scale.layers?.[0]?.cycles,
      scale.totalCycles,
      scale.totalCyclesInclPrefetch,
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
      dtypeBytes: shape.dtypeBytes ?? hw.bytesPerElement ?? 2,
      m: shape.m,
      n: shape.n,
      k: shape.k,
      tileM,
      tileN,
      tileK,
      estimatorCycles: Math.round(estimatorCycles),
      measuredCycles: Math.round(measuredCycles),
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
      scaleSimRunName: r.scaleSimRunName || match.scaleSimRunName,
      jobId: match.jobId,
      jobName: match.jobName,
    };
  });
  for (const row of collected) if (!used.has(row.jobId)) merged.push(row as unknown as Record<string, string>);
  return toEstimatorCsv(merged as unknown as Record<string, unknown>[]);
}
