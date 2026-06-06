import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { estimateForShape, estimateTile } from "@/lib/estimator";
import { estimateAll } from "@/lib/estimator";
import type { HardwareConfig, MatmulShape, Objective, ProjectFile, ScaleSimOverrides, SearchResponse, TileCandidateResult, TileCandidates } from "@/types/domain";
import { commandLabel, csvRows, getStringOpt, hasFlag, numberFromRow, parseArgs, runScaleSimUntilReport, scaleSimArgs, scaleSimCommandCandidates, writeArtifacts } from "./external-utils";

const STRATEGIES = ["no_tiling", "baseline_tiling", "recommended_tiling"] as const;
type StrategyName = typeof STRATEGIES[number];

interface TargetPreset {
  id: string;
  label: string;
  hardware: HardwareConfig;
  scaleSim: ScaleSimOverrides;
  note: string;
}

interface LoadedInput {
  sourceKind: "search-response" | "project" | "shape-list" | "csv" | "default";
  sourcePath?: string;
  shapes: MatmulShape[];
  candidates: TileCandidates;
  inputResponse?: SearchResponse;
}

interface TileSpec { tileM: number; tileN: number; tileK: number; }
interface TileUnit { m: number; n: number; k: number; repeats: number; }

interface PlanEntry {
  targetId: string;
  targetLabel: string;
  hardware: HardwareConfig;
  scaleSim: ScaleSimOverrides;
  shape: MatmulShape;
  strategy: StrategyName;
  tile: TileSpec;
  estimatedCycles: number;
  estimatedUtilization: number;
  estimatedSramBytes: number;
  unitCount: number;
  totalRepeats: number;
}

interface ScaleSimResultRow extends PlanEntry {
  status: "ok" | "skipped" | "failed";
  scaleSimCycles?: number;
  scaleSimOverallUtil?: number;
  scaleSimMappingEfficiency?: number;
  elapsedMs?: number;
  artifactDir: string;
  computeReports: string[];
  error?: string;
}

const defaultCandidates: TileCandidates = {
  tileM: [16, 32, 64, 128, 256, 512],
  tileN: [16, 32, 64, 128, 256, 512],
  tileK: [16, 32, 64, 128, 256, 512],
};

const fallbackShapes: MatmulShape[] = [
  { id: "gemm_1024", model: "manual", opName: "gemm_1024", m: 1024, n: 1024, k: 1024, dtypeBytes: 2, source: "manual" },
];

const TARGET_PRESETS: Record<string, TargetPreset> = {
  "tpu-v2": {
    id: "tpu-v2",
    label: "TPU v2-like MXU",
    hardware: {
      name: "TPU v2-like 128x128 MXU",
      arrayRows: 128,
      arrayCols: 128,
      frequencyMHz: 700,
      sramKB: 8192,
      dataflow: "WS",
      bytesPerElement: 2,
      memoryBandwidthGBs: 300,
    },
    scaleSim: {
      runName: "tileforge_tpu_v2",
      dataflow: "WS",
      ifmapSRAMBankBandwidth: 10,
      filterSRAMBankBandwidth: 10,
      ifmapSRAMBankNum: 10,
      filterSRAMBankNum: 10,
      ifmapSRAMBankPort: 2,
      filterSRAMBankPort: 2,
    },
    note: "128x128 MXU 기준. memoryBandwidthGBs는 단일 MXU 근사용 기본값이므로 실제 실험 환경에 맞게 조정 가능.",
  },
  "tpu-v6e": {
    id: "tpu-v6e",
    label: "TPU v6e-like MXU",
    hardware: {
      name: "TPU v6e-like 256x256 MXU",
      arrayRows: 256,
      arrayCols: 256,
      frequencyMHz: 1750,
      sramKB: 16384,
      dataflow: "WS",
      bytesPerElement: 2,
      memoryBandwidthGBs: 409.5,
    },
    scaleSim: {
      runName: "tileforge_tpu_v6e",
      dataflow: "WS",
      ifmapSRAMBankBandwidth: 16,
      filterSRAMBankBandwidth: 16,
      ifmapSRAMBankNum: 16,
      filterSRAMBankNum: 16,
      ifmapSRAMBankPort: 2,
      filterSRAMBankPort: 2,
    },
    note: "256x256 MXU 기준. memoryBandwidthGBs는 칩 전체 HBM을 단일 MXU로 나눈 근사용 기본값이므로 필요 시 조정.",
  },
};

function sanitizeId(value: string): string {
  return value.replace(/[^a-zA-Z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "item";
}

function parseTileSpec(value: string | undefined): TileSpec | undefined {
  if (!value) return undefined;
  const parts = value.trim().split(/[x,/:]+/i).map(v => Number(v.trim()));
  if (parts.length !== 3 || parts.some(v => !Number.isFinite(v) || v <= 0)) {
    throw new Error(`타일 형식이 올바르지 않습니다: ${value}. 예: 128x128x128`);
  }
  return { tileM: Math.floor(parts[0]), tileN: Math.floor(parts[1]), tileK: Math.floor(parts[2]) };
}

function ceilDiv(a: number, b: number): number {
  return Math.ceil(a / Math.max(1, b));
}

function clampTile(shape: MatmulShape, tile: TileSpec): TileSpec {
  return {
    tileM: Math.max(1, Math.min(Math.floor(tile.tileM), shape.m)),
    tileN: Math.max(1, Math.min(Math.floor(tile.tileN), shape.n)),
    tileK: Math.max(1, Math.min(Math.floor(tile.tileK), shape.k)),
  };
}

function splitIntoTileUnits(shape: MatmulShape, tile: TileSpec): TileUnit[] {
  const tm = Math.max(1, tile.tileM);
  const tn = Math.max(1, tile.tileN);
  const tk = Math.max(1, tile.tileK);
  const mFull = Math.floor(shape.m / tm);
  const nFull = Math.floor(shape.n / tn);
  const kFull = Math.floor(shape.k / tk);
  const mRem = shape.m % tm;
  const nRem = shape.n % tn;
  const kRem = shape.k % tk;

  const mParts = [...(mFull > 0 ? [{ size: tm, count: mFull }] : []), ...(mRem > 0 ? [{ size: mRem, count: 1 }] : [])];
  const nParts = [...(nFull > 0 ? [{ size: tn, count: nFull }] : []), ...(nRem > 0 ? [{ size: nRem, count: 1 }] : [])];
  const kParts = [...(kFull > 0 ? [{ size: tk, count: kFull }] : []), ...(kRem > 0 ? [{ size: kRem, count: 1 }] : [])];
  const merged = new Map<string, TileUnit>();
  for (const mp of mParts) for (const np of nParts) for (const kp of kParts) {
    const key = `${mp.size}x${np.size}x${kp.size}`;
    const repeat = mp.count * np.count * kp.count;
    const old = merged.get(key);
    if (old) old.repeats += repeat;
    else merged.set(key, { m: mp.size, n: np.size, k: kp.size, repeats: repeat });
  }
  return Array.from(merged.values()).sort((a, b) => b.repeats - a.repeats || b.m * b.n * b.k - a.m * a.n * a.k);
}

function bandwidthElementsPerCycle(hw: HardwareConfig): number {
  const bytes = Math.max(1, hw.bytesPerElement || 2);
  if (!hw.memoryBandwidthGBs || !Number.isFinite(hw.memoryBandwidthGBs)) return 128;
  return Math.max(1, Math.round((hw.memoryBandwidthGBs * 1000) / Math.max(1, hw.frequencyMHz) / bytes));
}

function targetScaleSimOverrides(target: TargetPreset): ScaleSimOverrides {
  const bw = bandwidthElementsPerCycle(target.hardware);
  return {
    ...target.scaleSim,
    bandwidth: target.scaleSim.bandwidth ?? bw,
    dramBandwidth: target.scaleSim.dramBandwidth ?? bw,
    ifmapSramKB: target.scaleSim.ifmapSramKB ?? Math.max(1, Math.floor(target.hardware.sramKB / 3)),
    filterSramKB: target.scaleSim.filterSramKB ?? Math.max(1, Math.floor(target.hardware.sramKB / 3)),
    ofmapSramKB: target.scaleSim.ofmapSramKB ?? Math.max(1, Math.floor(target.hardware.sramKB / 3)),
  };
}

async function loadInput(inputPath?: string): Promise<LoadedInput> {
  if (!inputPath) {
    return { sourceKind: "default", shapes: fallbackShapes, candidates: defaultCandidates };
  }
  const absolute = path.resolve(inputPath);
  const text = await readFile(absolute, "utf8");
  if (absolute.toLowerCase().endsWith(".csv")) {
    const rows = csvRows(text);
    const shapes = rows.map((row, i): MatmulShape => {
      const m = numberFromRow(row, ["m", "M"]);
      const n = numberFromRow(row, ["n", "N"]);
      const k = numberFromRow(row, ["k", "K"]);
      if (!m || !n || !k) throw new Error(`CSV ${i + 1}번째 행에서 M,N,K를 읽지 못했습니다.`);
      const id = row.id || row.ID || row.shape_id || `csv_${i}`;
      return {
        id: sanitizeId(String(id)),
        model: String(row.model || row.Model || "csv"),
        opName: String(row.opName || row.op_name || row.Layer || row.layer || id),
        m: Math.floor(m),
        n: Math.floor(n),
        k: Math.floor(k),
        dtypeBytes: Number(row.dtypeBytes || row.dtype_bytes || 2),
        source: "csv",
      };
    });
    return { sourceKind: "csv", sourcePath: absolute, shapes, candidates: defaultCandidates };
  }

  const obj = JSON.parse(text);
  if (obj?.request?.shapes && obj?.results) {
    const response = obj as SearchResponse;
    return {
      sourceKind: "search-response",
      sourcePath: absolute,
      shapes: response.request.shapes,
      candidates: response.request.candidates ?? defaultCandidates,
      inputResponse: response,
    };
  }
  if (obj?.hardware && obj?.shapes && obj?.candidates) {
    const project = obj as ProjectFile;
    return { sourceKind: "project", sourcePath: absolute, shapes: project.shapes, candidates: project.candidates };
  }
  if (Array.isArray(obj)) {
    return { sourceKind: "shape-list", sourcePath: absolute, shapes: obj as MatmulShape[], candidates: defaultCandidates };
  }
  if (obj?.shapes && Array.isArray(obj.shapes)) {
    return { sourceKind: "shape-list", sourcePath: absolute, shapes: obj.shapes as MatmulShape[], candidates: obj.candidates ?? defaultCandidates };
  }
  throw new Error(`지원하지 않는 입력 형식입니다: ${absolute}`);
}

function candidateFromInput(input: LoadedInput, shape: MatmulShape): TileSpec | undefined {
  const hit = input.inputResponse?.results.find(r => r.shape.id === shape.id || (r.shape.model === shape.model && r.shape.opName === shape.opName));
  if (!hit) return undefined;
  return { tileM: hit.best.tileM, tileN: hit.best.tileN, tileK: hit.best.tileK };
}

function chooseRecommendedTile(input: LoadedInput, target: TargetPreset, shape: MatmulShape, objective: Objective, recommendedSource: "input" | "per-target"): TileSpec {
  if (recommendedSource === "input") {
    const existing = candidateFromInput(input, shape);
    if (existing) return clampTile(shape, existing);
  }
  const scaleSim = targetScaleSimOverrides(target);
  const result = estimateForShape(target.hardware, shape, input.candidates, objective, 32, scaleSim);
  return clampTile(shape, { tileM: result.best.tileM, tileN: result.best.tileN, tileK: result.best.tileK });
}

function chooseTile(input: LoadedInput, target: TargetPreset, shape: MatmulShape, strategy: StrategyName, objective: Objective, recommendedSource: "input" | "per-target", baselineOverride?: TileSpec): TileSpec {
  if (strategy === "no_tiling") return { tileM: shape.m, tileN: shape.n, tileK: shape.k };
  if (strategy === "baseline_tiling") {
    const base = baselineOverride ?? { tileM: target.hardware.arrayRows, tileN: target.hardware.arrayCols, tileK: target.hardware.arrayRows };
    return clampTile(shape, base);
  }
  return chooseRecommendedTile(input, target, shape, objective, recommendedSource);
}

function estimateStrategy(target: TargetPreset, shape: MatmulShape, tile: TileSpec, objective: Objective): TileCandidateResult {
  return estimateTile(target.hardware, shape, tile.tileM, tile.tileN, tile.tileK, objective, targetScaleSimOverrides(target));
}

function makePlan(input: LoadedInput, targets: TargetPreset[], objective: Objective, recommendedSource: "input" | "per-target", baselineOverride?: TileSpec): PlanEntry[] {
  const entries: PlanEntry[] = [];
  for (const target of targets) {
    const scaleSim = targetScaleSimOverrides(target);
    for (const shape of input.shapes) {
      for (const strategy of STRATEGIES) {
        const tile = chooseTile(input, target, shape, strategy, objective, recommendedSource, baselineOverride);
        const units = splitIntoTileUnits(shape, tile);
        const est = estimateStrategy(target, shape, tile, objective);
        entries.push({
          targetId: target.id,
          targetLabel: target.label,
          hardware: target.hardware,
          scaleSim,
          shape,
          strategy,
          tile,
          estimatedCycles: est.cycles,
          estimatedUtilization: est.utilization,
          estimatedSramBytes: est.sramBytes,
          unitCount: units.length,
          totalRepeats: units.reduce((sum, u) => sum + u.repeats, 0),
        });
      }
    }
  }
  return entries;
}

async function writeScaleSimArtifacts(dir: string, target: TargetPreset, unit: TileUnit, layerName: string): Promise<void> {
  const shape: MatmulShape = {
    id: sanitizeId(layerName),
    model: target.id,
    opName: sanitizeId(layerName),
    m: unit.m,
    n: unit.n,
    k: unit.k,
    dtypeBytes: target.hardware.bytesPerElement || 2,
    source: "manual",
  };
  const candidate = {
    tileM: [Math.max(1, Math.min(unit.m, target.hardware.arrayRows))],
    tileN: [Math.max(1, Math.min(unit.n, target.hardware.arrayCols))],
    tileK: [Math.max(1, Math.min(unit.k, target.hardware.arrayRows))],
  };
  const response = estimateAll({
    hardware: target.hardware,
    shapes: [shape],
    candidates: candidate,
    objective: "cycles",
    scaleSim: targetScaleSimOverrides(target),
  }, { includeArtifacts: true });
  await writeArtifacts(dir, response);
}

function summarizeComputeCsv(text: string): { cycles: number; overallUtil?: number; mappingEfficiency?: number } {
  const rows = csvRows(text);
  if (!rows.length) return { cycles: 0 };
  let cycles = 0;
  let weightedUtil = 0;
  let weightedMapping = 0;
  let utilWeight = 0;
  let mappingWeight = 0;
  for (const row of rows) {
    const c = numberFromRow(row, ["Total Cycles", "Cycles", "Total cycles", "Compute cycles"]) ?? 0;
    cycles += c;
    const util = numberFromRow(row, ["Overall Util %", "Compute Util %", "Overall Util", "Utilization"]);
    if (util !== undefined) {
      weightedUtil += util * Math.max(1, c);
      utilWeight += Math.max(1, c);
    }
    const mapping = numberFromRow(row, ["Mapping Efficiency %", "Mapping Efficiency"]);
    if (mapping !== undefined) {
      weightedMapping += mapping * Math.max(1, c);
      mappingWeight += Math.max(1, c);
    }
  }
  return {
    cycles,
    overallUtil: utilWeight > 0 ? weightedUtil / utilWeight : undefined,
    mappingEfficiency: mappingWeight > 0 ? weightedMapping / mappingWeight : undefined,
  };
}

async function runScaleSimForEntry(entry: PlanEntry, target: TargetPreset, outDir: string, commands: string[], timeoutMs: number): Promise<ScaleSimResultRow> {
  const shape = entry.shape;
  const units = splitIntoTileUnits(shape, entry.tile);
  const artifactRoot = path.join(outDir, "scalesim-artifacts", entry.targetId, sanitizeId(shape.id), entry.strategy);
  const computeReports: string[] = [];
  const startedAt = Date.now();
  let totalCycles = 0;
  let utilWeighted = 0;
  let utilWeight = 0;
  let mappingWeighted = 0;
  let mappingWeight = 0;

  for (const unit of units) {
    const unitKey = `${unit.m}x${unit.n}x${unit.k}_r${unit.repeats}`;
    const unitDir = path.join(artifactRoot, unitKey);
    await mkdir(unitDir, { recursive: true });
    await writeScaleSimArtifacts(unitDir, target, unit, `${shape.opName}_${unitKey}`);
    const logPath = path.join(unitDir, `scalesim-${Date.now()}.log`);
    const run = await runScaleSimUntilReport(commands, scaleSimArgs({
      config: path.join(unitDir, "scalesim.cfg"),
      topology: path.join(unitDir, "topology.csv"),
      layout: path.join(unitDir, "layout.csv"),
      outDir: unitDir,
    }), unitDir, command => ({
      cwd: unitDir,
      timeoutMs,
      logPath,
      env: { TILEFORGE_MOCK_OUTPUT_DIR: unitDir },
    }));
    void run;
    const reportText = await readFile(run.computeReport, "utf8");
    const summary = summarizeComputeCsv(reportText);
    const repeatedCycles = summary.cycles * unit.repeats;
    totalCycles += repeatedCycles;
    if (summary.overallUtil !== undefined) {
      utilWeighted += summary.overallUtil * repeatedCycles;
      utilWeight += repeatedCycles;
    }
    if (summary.mappingEfficiency !== undefined) {
      mappingWeighted += summary.mappingEfficiency * repeatedCycles;
      mappingWeight += repeatedCycles;
    }
    computeReports.push(run.computeReport);
  }

  return {
    ...entry,
    status: "ok",
    scaleSimCycles: Math.round(totalCycles),
    scaleSimOverallUtil: utilWeight > 0 ? utilWeighted / utilWeight : undefined,
    scaleSimMappingEfficiency: mappingWeight > 0 ? mappingWeighted / mappingWeight : undefined,
    elapsedMs: Date.now() - startedAt,
    artifactDir: artifactRoot,
    computeReports,
  };
}

function csvEscape(value: unknown): string {
  if (value === undefined || value === null) return "";
  const s = String(value);
  return /[",\n\r]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
}

function resultRowsToCsv(rows: ScaleSimResultRow[]): string {
  const header = [
    "target", "target_label", "strategy", "shape_id", "model", "op_name", "M", "N", "K",
    "tileM", "tileN", "tileK", "unit_count", "total_repeats", "estimated_cycles", "estimated_utilization",
    "estimated_sram_bytes", "scalesim_cycles", "speedup_vs_no_tiling", "scalesim_overall_util", "scalesim_mapping_efficiency",
    "status", "elapsed_ms", "artifact_dir", "error",
  ];
  const noTilingByTargetShape = new Map<string, number>();
  for (const row of rows) {
    if (row.strategy === "no_tiling" && row.scaleSimCycles) noTilingByTargetShape.set(`${row.targetId}:${row.shape.id}`, row.scaleSimCycles);
  }
  const lines = [header.join(",")];
  for (const row of rows) {
    const base = noTilingByTargetShape.get(`${row.targetId}:${row.shape.id}`);
    const speedup = base && row.scaleSimCycles ? base / row.scaleSimCycles : undefined;
    lines.push([
      row.targetId, row.targetLabel, row.strategy, row.shape.id, row.shape.model, row.shape.opName, row.shape.m, row.shape.n, row.shape.k,
      row.tile.tileM, row.tile.tileN, row.tile.tileK, row.unitCount, row.totalRepeats, row.estimatedCycles, row.estimatedUtilization,
      row.estimatedSramBytes, row.scaleSimCycles, speedup, row.scaleSimOverallUtil, row.scaleSimMappingEfficiency,
      row.status, row.elapsedMs, row.artifactDir, row.error,
    ].map(csvEscape).join(","));
  }
  return lines.join("\n") + "\n";
}

function totalsCsv(rows: ScaleSimResultRow[]): string {
  const groups = new Map<string, { target: string; label: string; strategy: StrategyName; estimated: number; measured: number; count: number; ok: number }>();
  for (const row of rows) {
    const key = `${row.targetId}:${row.strategy}`;
    const g = groups.get(key) ?? { target: row.targetId, label: row.targetLabel, strategy: row.strategy, estimated: 0, measured: 0, count: 0, ok: 0 };
    g.estimated += row.estimatedCycles;
    g.measured += row.scaleSimCycles ?? 0;
    g.count += 1;
    if (row.status === "ok") g.ok += 1;
    groups.set(key, g);
  }
  const noTilingByTarget = new Map<string, number>();
  for (const g of groups.values()) if (g.strategy === "no_tiling") noTilingByTarget.set(g.target, g.measured);
  const lines = [["target", "target_label", "strategy", "estimated_cycles", "scalesim_cycles", "speedup_vs_no_tiling", "shape_count", "ok_count"].join(",")];
  for (const g of Array.from(groups.values()).sort((a, b) => a.target.localeCompare(b.target) || STRATEGIES.indexOf(a.strategy) - STRATEGIES.indexOf(b.strategy))) {
    const base = noTilingByTarget.get(g.target);
    const speedup = base && g.measured ? base / g.measured : undefined;
    lines.push([g.target, g.label, g.strategy, g.estimated, g.measured, speedup, g.count, g.ok].map(csvEscape).join(","));
  }
  return lines.join("\n") + "\n";
}

function planToTpuJson(plan: PlanEntry[], source: LoadedInput): string {
  const targets = Array.from(new Map(plan.map(p => [p.targetId, {
    id: p.targetId,
    label: p.targetLabel,
    hardware: p.hardware,
    scaleSim: p.scaleSim,
  }])).values());
  const samples = plan.map(p => ({
    target: p.targetId,
    targetLabel: p.targetLabel,
    shape: p.shape,
    strategy: p.strategy,
    tile: p.tile,
    estimatedCycles: p.estimatedCycles,
    estimatedUtilization: p.estimatedUtilization,
    estimatedSramBytes: p.estimatedSramBytes,
    unitCount: p.unitCount,
    totalRepeats: p.totalRepeats,
  }));
  return JSON.stringify({
    version: "tileforge-tiling-experiment/v1",
    createdAt: new Date().toISOString(),
    source: { kind: source.sourceKind, path: source.sourcePath },
    targets,
    samples,
  }, null, 2);
}

function simpleGroupedBarSvg(rows: ScaleSimResultRow[]): string {
  const totals = new Map<string, number>();
  for (const row of rows) {
    if (row.status !== "ok" || !row.scaleSimCycles) continue;
    const key = `${row.targetId}:${row.strategy}`;
    totals.set(key, (totals.get(key) ?? 0) + row.scaleSimCycles);
  }
  const targets = Array.from(new Set(rows.map(r => r.targetId))).sort();
  const maxValue = Math.max(1, ...Array.from(totals.values()));
  const width = 1120;
  const height = 620;
  const margin = { left: 90, right: 40, top: 70, bottom: 120 };
  const plotW = width - margin.left - margin.right;
  const plotH = height - margin.top - margin.bottom;
  const groupW = plotW / Math.max(1, targets.length);
  const barW = Math.min(70, groupW / 5);
  const colors: Record<StrategyName, string> = {
    no_tiling: "#7f8c8d",
    baseline_tiling: "#3498db",
    recommended_tiling: "#2ecc71",
  };
  const parts: string[] = [];
  parts.push(`<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">`);
  parts.push(`<rect width="100%" height="100%" fill="white"/>`);
  parts.push(`<text x="${width / 2}" y="34" text-anchor="middle" font-family="Arial, sans-serif" font-size="24" font-weight="700">TileForge tiling experiment: SCALE-Sim total cycles</text>`);
  parts.push(`<line x1="${margin.left}" y1="${margin.top + plotH}" x2="${margin.left + plotW}" y2="${margin.top + plotH}" stroke="#222"/>`);
  parts.push(`<line x1="${margin.left}" y1="${margin.top}" x2="${margin.left}" y2="${margin.top + plotH}" stroke="#222"/>`);
  for (let i = 0; i <= 5; i++) {
    const y = margin.top + plotH - (plotH * i / 5);
    const value = maxValue * i / 5;
    parts.push(`<line x1="${margin.left}" y1="${y}" x2="${margin.left + plotW}" y2="${y}" stroke="#e5e5e5"/>`);
    parts.push(`<text x="${margin.left - 10}" y="${y + 4}" text-anchor="end" font-family="Arial, sans-serif" font-size="12">${formatShort(value)}</text>`);
  }
  for (let ti = 0; ti < targets.length; ti++) {
    const target = targets[ti];
    const cx = margin.left + groupW * ti + groupW / 2;
    parts.push(`<text x="${cx}" y="${margin.top + plotH + 35}" text-anchor="middle" font-family="Arial, sans-serif" font-size="15" font-weight="700">${escapeXml(target)}</text>`);
    for (let si = 0; si < STRATEGIES.length; si++) {
      const strategy = STRATEGIES[si];
      const value = totals.get(`${target}:${strategy}`) ?? 0;
      const h = plotH * value / maxValue;
      const x = cx - (barW * 1.5) + si * barW;
      const y = margin.top + plotH - h;
      parts.push(`<rect x="${x}" y="${y}" width="${barW * 0.82}" height="${h}" rx="4" fill="${colors[strategy]}"/>`);
      parts.push(`<text x="${x + barW * 0.41}" y="${Math.max(margin.top + 12, y - 6)}" text-anchor="middle" font-family="Arial, sans-serif" font-size="11">${formatShort(value)}</text>`);
    }
  }
  const legendY = height - 55;
  STRATEGIES.forEach((strategy, i) => {
    const x = margin.left + i * 250;
    parts.push(`<rect x="${x}" y="${legendY}" width="18" height="18" fill="${colors[strategy]}" rx="3"/>`);
    parts.push(`<text x="${x + 26}" y="${legendY + 14}" font-family="Arial, sans-serif" font-size="14">${strategy}</text>`);
  });
  parts.push(`</svg>`);
  return parts.join("\n");
}

function escapeXml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function formatShort(value: number): string {
  if (!Number.isFinite(value)) return "";
  const abs = Math.abs(value);
  if (abs >= 1e12) return `${(value / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${(value / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${(value / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${(value / 1e3).toFixed(1)}K`;
  return String(Math.round(value));
}

async function main(): Promise<void> {
  const opts = parseArgs();
  const inputPath = typeof opts.input === "string" ? opts.input : typeof opts.result === "string" ? opts.result : typeof opts.project === "string" ? opts.project : undefined;
  const outDir = path.resolve(getStringOpt(opts, "out", path.join(".tileforge", "experiments", `tiling-${new Date().toISOString().replace(/[:.]/g, "-")}`)));
  const targetIds = getStringOpt(opts, "targets", "tpu-v2,tpu-v6e").split(",").map(v => v.trim()).filter(Boolean);
  const targets = targetIds.map(id => {
    const target = TARGET_PRESETS[id];
    if (!target) throw new Error(`알 수 없는 target preset입니다: ${id}. 사용 가능: ${Object.keys(TARGET_PRESETS).join(", ")}`);
    return target;
  });
  const objective = getStringOpt(opts, "objective", "cycles") as Objective;
  const recommendedSource = getStringOpt(opts, "recommended-source", "per-target") as "input" | "per-target";
  if (!["input", "per-target"].includes(recommendedSource)) throw new Error("--recommended-source 는 input 또는 per-target 이어야 합니다.");
  const baselineOverride = parseTileSpec(typeof opts["baseline-tile"] === "string" ? opts["baseline-tile"] : undefined);
  const timeoutMs = Number(getStringOpt(opts, "timeout-ms", "300000"));
  const limit = Number(getStringOpt(opts, "limit", "0"));
  const dryRun = hasFlag(opts, "dry-run");
  const requireExternal = hasFlag(opts, "require-external");
  const preferredCommand = getStringOpt(opts, "cmd", process.env.TILEFORGE_SCALE_SIM_CMD ?? "");
  const commands = scaleSimCommandCandidates(preferredCommand);
  const input = await loadInput(inputPath);
  const limitedInput: LoadedInput = limit > 0 ? { ...input, shapes: input.shapes.slice(0, limit) } : input;

  await mkdir(outDir, { recursive: true });
  const plan = makePlan(limitedInput, targets, objective, recommendedSource, baselineOverride);
  await writeFile(path.join(outDir, "tpu_plan.json"), planToTpuJson(plan, limitedInput), "utf8");
  await writeFile(path.join(outDir, "experiment_plan.json"), JSON.stringify({
    createdAt: new Date().toISOString(),
    source: { kind: limitedInput.sourceKind, path: limitedInput.sourcePath },
    commandCandidates: commands.map(commandLabel),
    targets: targets.map(t => ({ id: t.id, label: t.label, hardware: t.hardware, scaleSim: targetScaleSimOverrides(t), note: t.note })),
    entries: plan,
  }, null, 2), "utf8");

  if (dryRun) {
    console.log(`실험 계획만 저장했습니다: ${outDir}`);
    console.log(`TPU 실행 계획: ${path.join(outDir, "tpu_plan.json")}`);
    return;
  }

  const rows: ScaleSimResultRow[] = [];
  for (const entry of plan) {
    const target = targets.find(t => t.id === entry.targetId);
    if (!target) continue;
    const label = `${entry.targetId}/${entry.strategy}/${entry.shape.id}`;
    console.log(`[SCALE-Sim] start ${label} tile=${entry.tile.tileM}x${entry.tile.tileN}x${entry.tile.tileK} units=${entry.unitCount}`);
    try {
      const row = await runScaleSimForEntry(entry, target, outDir, commands, timeoutMs);
      rows.push(row);
      console.log(`[SCALE-Sim] done  ${label} cycles=${row.scaleSimCycles?.toLocaleString()}`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      rows.push({
        ...entry,
        status: requireExternal ? "failed" : "skipped",
        artifactDir: path.join(outDir, "scalesim-artifacts", entry.targetId, sanitizeId(entry.shape.id), entry.strategy),
        computeReports: [],
        error: message,
      });
      console.log(`[SCALE-Sim] ${requireExternal ? "failed" : "skipped"} ${label}: ${message}`);
      if (requireExternal) {
        await writeFile(path.join(outDir, "results.csv"), resultRowsToCsv(rows), "utf8");
        await writeFile(path.join(outDir, "results.json"), JSON.stringify(rows, null, 2), "utf8");
        throw error;
      }
    }
  }

  await writeFile(path.join(outDir, "results.csv"), resultRowsToCsv(rows), "utf8");
  await writeFile(path.join(outDir, "results.json"), JSON.stringify(rows, null, 2), "utf8");
  await writeFile(path.join(outDir, "totals.csv"), totalsCsv(rows), "utf8");
  await writeFile(path.join(outDir, "total_cycles.svg"), simpleGroupedBarSvg(rows), "utf8");
  console.log(`완료: ${outDir}`);
  console.log(`- results.csv`);
  console.log(`- totals.csv`);
  console.log(`- total_cycles.svg`);
  console.log(`- tpu_plan.json`);
}

main().catch(error => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
