import { readFile } from "node:fs/promises";
import path from "node:path";
import type { JobRecord } from "@/types/job";
import type { SearchRequest } from "@/types/domain";
import { estimateAll } from "./estimator";
import { memoryTrafficFor } from "./memoryTraffic";
import { parseEstimatorCsv, toEstimatorCsv } from "./estimatorSuiteArtifacts";

export interface CollectedEstimatorSampleRow {
  id: string;
  model: string;
  opName: string;
  arrayRows: number;
  arrayCols: number;
  sramKB: number;
  frequencyMHz: number;
  memoryBandwidthGBs?: number;
  dispatchOverheadUs?: number;
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
  targetScope: "full-layer" | "tile-policy" | "mixed";
  measuredSource: string;
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

function scaleLayerOpMatches(layer: any, shape: any) {
  return !shape?.opName || layer?.opName === shape.opName || layer?.name === shape.opName || layer?.shapeId === shape.id;
}

type PickedMeasuredScaleTarget = {
  layer: any;
  measuredCycles: number;
  targetScope: "full-layer" | "tile-policy";
  measuredSource: string;
};

function pickMeasuredScaleTargets(scale: any, shape: any, tileM: number, tileN: number, tileK: number): PickedMeasuredScaleTarget[] {
  const layers = Array.isArray(scale?.layers) ? scale.layers : [];
  const candidates = Array.isArray(scale?.candidateLayers) ? scale.candidateLayers : [];
  const sameOp = (l: any) => scaleLayerOpMatches(l, shape);
  const targets: PickedMeasuredScaleTarget[] = [];

  const exactCandidate =
    candidates.find((l: any) => sameTile(l, tileM, tileN, tileK) && sameOp(l)) ||
    candidates.find((l: any) => sameTile(l, tileM, tileN, tileK));
  const candidate = candidates.find((l: any) => sameOp(l)) || candidates[0];
  const tilePolicyLayer = exactCandidate || candidate;
  if (tilePolicyLayer && n(tilePolicyLayer.tileExtrapolatedCycles) > 0) {
    targets.push({
      layer: tilePolicyLayer,
      measuredCycles: n(tilePolicyLayer.tileExtrapolatedCycles),
      targetScope: "tile-policy",
      measuredSource: exactCandidate ? "candidate.tileExtrapolatedCycles" : "candidate.tileExtrapolatedCycles.fallback",
    });
  } else if (tilePolicyLayer && n(tilePolicyLayer.cycles) > 0) {
    targets.push({
      layer: tilePolicyLayer,
      measuredCycles: n(tilePolicyLayer.cycles),
      targetScope: "tile-policy",
      measuredSource: exactCandidate ? "candidate.cycles" : "candidate.cycles.fallback",
    });
  }

  const fullLayer =
    layers.find((l: any) => sameOp(l)) ||
    layers.find((l: any) => sameTile(l, tileM, tileN, tileK)) ||
    layers[0];
  if (fullLayer && n(fullLayer.cycles) > 0) {
    targets.push({ layer: fullLayer, measuredCycles: n(fullLayer.cycles), targetScope: "full-layer", measuredSource: "layers.cycles" });
  } else if (fullLayer && n(fullLayer.scaleSimRawCycles) > 0) {
    targets.push({ layer: fullLayer, measuredCycles: n(fullLayer.scaleSimRawCycles), targetScope: "full-layer", measuredSource: "layers.scaleSimRawCycles" });
  } else if (n(scale?.totalCycles) > 0) {
    targets.push({ layer: undefined, measuredCycles: n(scale.totalCycles), targetScope: "full-layer", measuredSource: "scale.totalCycles" });
  } else if (n(scale?.totalCyclesInclPrefetch) > 0) {
    targets.push({ layer: undefined, measuredCycles: n(scale.totalCyclesInclPrefetch), targetScope: "full-layer", measuredSource: "scale.totalCyclesInclPrefetch" });
  }

  const seen = new Set<string>();
  return targets.filter((target) => {
    if (!(target.measuredCycles > 0)) return false;
    const key = `${target.targetScope}:${target.measuredSource}:${target.measuredCycles}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
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
    row.targetScope || row.target_scope || row.scope || "mixed",
  ].join("|");
}

function collectedRowKey(row: CollectedEstimatorSampleRow) {
  return [
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
    row.targetScope,
  ].join("|");
}

function rowAliases(row: Record<string, string>) {
  const scope = row.targetScope || row.target_scope || row.scope || "mixed";
  return new Set([
    row.id,
    row.scaleSimRunName,
    row.id ? `${row.id}:${scope}` : "",
    row.scaleSimRunName ? `${row.scaleSimRunName}:${scope}` : "",
  ].filter(Boolean));
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
    const hw = req?.hardware;
    if (!req?.shapes?.length || !hw) {
      skipped.push({ jobId: job.id, name: job.name, reason: "job request has no hardware or shapes" });
      continue;
    }

    const resultJson = await readJsonMaybe<any>(path.join(dir, "result.json"));
    const response = resultJson?.payload?.response ?? resultJson?.response ?? resultJson;
    const resultRows = Array.isArray(response?.results) ? response.results : [];

    for (const shape of req.shapes) {
      const resultRow =
        resultRows.find((r: any) => r?.shape?.id === shape.id || r?.best?.shapeId === shape.id) ||
        resultRows.find((r: any) => r?.shape?.opName === shape.opName || r?.best?.opName === shape.opName) ||
        (req.shapes.length === 1 ? resultRows[0] : undefined);
      const best = resultRow?.best;
      const tileM = n(best?.tileM, n(req?.candidates?.tileM?.[0]));
      const tileN = n(best?.tileN, n(req?.candidates?.tileN?.[0]));
      const tileK = n(best?.tileK, n(req?.candidates?.tileK?.[0]));
      if (![tileM, tileN, tileK].every((v) => v > 0)) {
        skipped.push({ jobId: job.id, name: job.name, reason: `shape=${shape.id}: missing positive tile sizes` });
        continue;
      }

      let estimatorCycles = firstPositive([best?.rawCycles, best?.cycles, resultRow?.cycles, response?.summary?.analyticalTotalCycles, response?.summary?.totalCycles]);
      let estimatorSramBytes = firstPositive([best?.sramBytes, resultRow?.sramBytes]);
      let estimatorUtilization = firstFinite([best?.utilization, resultRow?.utilization]);
      if (!(estimatorCycles > 0) || !(estimatorSramBytes > 0) || estimatorUtilization === undefined) {
        try {
          const oneShapeReq: SearchRequest = { ...req, shapes: [shape], candidates: { tileM: [tileM], tileN: [tileN], tileK: [tileK] } };
          const fresh = estimateAll(oneShapeReq);
          const freshRow = fresh.results?.[0];
          estimatorCycles = estimatorCycles > 0 ? estimatorCycles : fresh.summary.totalCycles;
          estimatorSramBytes = estimatorSramBytes > 0 ? estimatorSramBytes : firstPositive([freshRow?.best?.sramBytes, fresh.summary.maxSramBytes]);
          estimatorUtilization = estimatorUtilization ?? firstFinite([fresh.summary.meanUtilization, freshRow?.best?.utilization]);
        } catch {
          estimatorCycles = estimatorCycles > 0 ? estimatorCycles : NaN;
        }
      }

      const measuredTargets = pickMeasuredScaleTargets(scale, shape, tileM, tileN, tileK);
      const dtypeBytes = shape.dtypeBytes ?? hw.bytesPerElement ?? 2;
      const traffic = memoryTrafficFor(hw, shape, {
        shapeId: shape.id, model: shape.model, opName: shape.opName,
        tileM, tileN, tileK, cycles: Math.max(1, estimatorCycles), rawCycles: Math.max(1, estimatorCycles),
        timeUs: Math.max(1, estimatorCycles) / Math.max(1, hw.frequencyMHz), utilization: estimatorUtilization ?? 0,
        paddingRatio: 0, sramBytes: estimatorSramBytes > 0 ? estimatorSramBytes : 0,
        boundaryPenalty: 0, score: 0, isPareto: false, warnings: [], explanation: ""
      });
      const estimatorDramBytes = firstPositive([
        traffic.dramReadBytes + traffic.dramWriteBytes,
        best?.dramBytes,
        resultRow?.dramBytes,
        (shape.m * shape.k + shape.k * shape.n + shape.m * shape.n) * dtypeBytes,
      ]);
      const estimatorSramTrafficBytes = firstPositive([
        traffic.sramReadBytes + traffic.sramWriteBytes,
        estimatorSramBytes,
      ]);
      if (!(estimatorCycles > 0) || !measuredTargets.length) {
        skipped.push({ jobId: job.id, name: job.name, reason: `shape=${shape.id}: missing positive estimatorCycles or measuredCycles` });
        continue;
      }
      for (const measured of measuredTargets) {
        const matchedLayer = measured.layer;
        const measuredCycles = measured.measuredCycles;
        const measuredSramBytes = accessBytes(firstPositive([matchedLayer?.sramAccessBytes, matchedLayer?.sramBytes, matchedLayer?.sramAccesses]), dtypeBytes);
        const measuredDramBytes = accessBytes(firstPositive([matchedLayer?.dramAccessBytes, matchedLayer?.dramBytes, matchedLayer?.dramAccesses]), dtypeBytes);
        const measuredUtilization = utilizationFraction(firstFinite([matchedLayer?.computeUtil, matchedLayer?.overallUtil, matchedLayer?.mappingEfficiency]));
        const baseId = shape.id || shape.opName || job.name || job.id;
        rows.push({
          id: `${baseId}_${measured.targetScope}`,
          model: shape.model || "sampling_plan",
          opName: shape.opName || shape.id || "op",
          arrayRows: hw.arrayRows,
          arrayCols: hw.arrayCols,
          sramKB: hw.sramKB,
          frequencyMHz: hw.frequencyMHz,
          memoryBandwidthGBs: hw.memoryBandwidthGBs,
          dispatchOverheadUs: hw.dispatchOverheadUs,
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
          estimatorSramBytes: estimatorSramTrafficBytes > 0 ? Math.round(estimatorSramTrafficBytes) : undefined,
          measuredSramBytes,
          estimatorDramBytes: estimatorDramBytes > 0 ? Math.round(estimatorDramBytes) : undefined,
          measuredDramBytes,
          estimatorUtilization: estimatorUtilization === undefined ? undefined : estimatorUtilization,
          measuredUtilization,
          targetScope: measured.targetScope,
          measuredSource: measured.measuredSource,
          scaleSimRunName: `${req.scaleSim?.runName || job.name || job.id}_${measured.targetScope}`,
          jobId: job.id,
          jobName: job.name || job.id,
        });
      }
    }
  }
  return { rows, skipped };
}


export function mergeCollectedSamplesIntoCsv(csvText: string, collected: CollectedEstimatorSampleRow[]) {
  const existing = parseEstimatorCsv(csvText);
  if (!existing.length) return toEstimatorCsv(collected as unknown as Record<string, unknown>[]);
  const byId = new Map<string, CollectedEstimatorSampleRow>();
  const byKey = new Map<string, CollectedEstimatorSampleRow>();
  for (const row of collected) {
    const aliases = [
      row.id,
      row.scaleSimRunName,
      `${row.id}:${row.targetScope}`,
      `${row.scaleSimRunName}:${row.targetScope}`,
    ].filter(Boolean);
    for (const a of aliases) byId.set(String(a), row);
    byKey.set(collectedRowKey(row), row);
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
    used.add(collectedRowKey(match));
    return {
      ...r,
      id: r.id || match.id,
      model: r.model || match.model,
      opName: r.opName || match.opName,
      arrayRows: r.arrayRows || match.arrayRows,
      arrayCols: r.arrayCols || match.arrayCols,
      sramKB: r.sramKB || match.sramKB,
      frequencyMHz: r.frequencyMHz || match.frequencyMHz,
      memoryBandwidthGBs: r.memoryBandwidthGBs || match.memoryBandwidthGBs,
      dispatchOverheadUs: r.dispatchOverheadUs || match.dispatchOverheadUs,
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
      targetScope: r.targetScope || match.targetScope,
      measuredSource: r.measuredSource || match.measuredSource,
      scaleSimRunName: r.scaleSimRunName || match.scaleSimRunName,
      jobId: match.jobId,
      jobName: match.jobName,
    };
  });
  for (const row of collected) if (!used.has(collectedRowKey(row))) merged.push(row as unknown as Record<string, string>);
  return toEstimatorCsv(merged as unknown as Record<string, unknown>[]);
}
