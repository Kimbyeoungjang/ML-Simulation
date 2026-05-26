import path from "node:path";
import { readFile, readdir } from "node:fs/promises";
import type { ScaleSimLayerSummary } from "./externalRunTypes";

export function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      values.push(current);
      current = "";
    } else current += ch;
  }
  values.push(current);
  return values;
}

export function csvRows(text: string): Array<Record<string, string>> {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row;
  });
}

function stringFromRow(row: Record<string, string>, names: string[]): string | undefined {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && String(value).trim()) return String(value).trim();
  }
  return undefined;
}

function numberFromRow(row: Record<string, string>, names: string[]): number | undefined {
  for (const name of names) {
    const value = row[name];
    if (value === undefined) continue;
    const n = Number(String(value).replace(/[% ,]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

const cycleColumnNames = [
  "Cycles",
  "Total Cycles",
  "Total cycles",
  "Compute cycles",
  "Compute Cycles",
  "Total_compute_cycles",
];

async function readCsvRowsIfExists(file: string): Promise<Array<Record<string, string>>> {
  try {
    return csvRows(await readFile(file, "utf8"));
  } catch {
    return [];
  }
}

export async function parseScaleSimLayerReports(
  computeReport: string,
  metadata: Array<Partial<ScaleSimLayerSummary>> = [],
): Promise<ScaleSimLayerSummary[]> {
  const reportDir = path.dirname(computeReport);
  const computeRows = await readCsvRowsIfExists(computeReport);
  const bandwidthRows = await readCsvRowsIfExists(path.join(reportDir, "BANDWIDTH_REPORT.csv"));
  const detailRows = await readCsvRowsIfExists(path.join(reportDir, "DETAILED_ACCESS_REPORT.csv"));
  return computeRows.map((row, index) => {
    const meta = metadata[index] ?? {};
    const rawCycles = numberFromRow(row, cycleColumnNames) ?? 0;
    const tileCount = meta.tileCount && meta.tileCount > 0 ? meta.tileCount : undefined;
    const detail = detailRows[index] ?? {};
    const sramAccesses =
      (numberFromRow(detail, ["SRAM IFMAP Reads"]) ?? 0) +
      (numberFromRow(detail, ["SRAM Filter Reads"]) ?? 0) +
      (numberFromRow(detail, ["SRAM OFMAP Writes"]) ?? 0);
    const dramAccesses =
      (numberFromRow(detail, ["DRAM IFMAP Reads"]) ?? 0) +
      (numberFromRow(detail, ["DRAM Filter Reads"]) ?? 0) +
      (numberFromRow(detail, ["DRAM OFMAP Writes"]) ?? 0);
    const bandwidth = bandwidthRows[index] ?? {};
    return {
      ...meta,
      name:
        meta.name ??
        stringFromRow(row, ["Layer Name", "Layer name", "Layer", "layer", "Name", "name"]) ??
        `layer_${index + 1}`,
      cycles: rawCycles,
      cyclesPerTile: tileCount ? rawCycles : undefined,
      scaleSimRawCycles: rawCycles,
      scaleSimRows: 1,
      tileExtrapolatedCycles: tileCount ? rawCycles * tileCount : undefined,
      totalCyclesInclPrefetch: numberFromRow(row, ["Total Cycles (incl. prefetch)", "Total Cycles incl. prefetch"]),
      stallCycles: numberFromRow(row, ["Stall Cycles"]),
      overallUtil: numberFromRow(row, ["Overall Util %"]),
      mappingEfficiency: numberFromRow(row, ["Mapping Efficiency %"]),
      computeUtil: numberFromRow(row, ["Compute Util %"]),
      sramAccesses,
      dramAccesses,
      ...Object.fromEntries(Object.entries({
        avgIfmapSramBw: numberFromRow(bandwidth, ["Avg IFMAP SRAM BW"]),
        avgFilterSramBw: numberFromRow(bandwidth, ["Avg FILTER SRAM BW"]),
        avgOfmapSramBw: numberFromRow(bandwidth, ["Avg OFMAP SRAM BW"]),
        avgIfmapDramBw: numberFromRow(bandwidth, ["Avg IFMAP DRAM BW"]),
        avgFilterDramBw: numberFromRow(bandwidth, ["Avg FILTER DRAM BW"]),
        avgOfmapDramBw: numberFromRow(bandwidth, ["Avg OFMAP DRAM BW"]),
      }).filter(([, value]) => value !== undefined)),
    };
  });
}

export async function findFirstExistingFile(
  root: string,
  fileName: string,
  maxDepth = 8,
): Promise<string | undefined> {
  const wanted = fileName.toLowerCase();
  async function walk(dir: string, depth: number): Promise<string | undefined> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const lower = entry.name.toLowerCase();
      if (entry.isFile() && lower === wanted) return full;
      if (
        entry.isFile() &&
        lower.endsWith(".csv") &&
        lower.includes("compute") &&
        lower.includes("report")
      ) return full;
    }
    if (depth <= 0) return undefined;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const found = await walk(path.join(dir, entry.name), depth - 1);
      if (found) return found;
    }
    return undefined;
  }
  return walk(root, maxDepth);
}

export function normalizeScaleSimName(name?: string): string {
  return String(name || "").toLowerCase().replace(/[^a-z0-9]+/g, "");
}

export function matchScaleLayerForResult(item: any, layers: ScaleSimLayerSummary[]) {
  const op = normalizeScaleSimName(item?.shape?.opName);
  const modelOp = normalizeScaleSimName(`${item?.shape?.model || ""}${item?.shape?.opName || ""}`);
  return layers.find((layer) => {
    const layerName = normalizeScaleSimName(layer.name);
    return layerName === op || layerName === modelOp || layerName.includes(op) || op.includes(layerName);
  });
}
