import type { CalibrationProfile, CalibrationSample, TileCandidateResult } from "@/types/domain";

export type { CalibrationProfile, CalibrationSample };

const PREDICTED_HEADERS = new Set(["predictedCycles", "predicted_cycles", "estimatorCycles", "estimatedCycles", "cyclesPredicted"]);
const MEASURED_HEADERS = new Set(["measuredCycles", "measured_cycles", "scaleSimCycles", "actualCycles", "cyclesMeasured"]);
const WEIGHT_HEADERS = new Set(["weight", "sampleWeight"]);

function positiveFinite(value: unknown) {
  const n = Number(typeof value === "string" ? value.replace(/,/g, "") : value);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function csvCells(line: string) {
  // The calibration import format is intentionally simple, but this parser
  // still handles quoted commas so spreadsheet exports do not get truncated.
  const cells: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"' && line[i + 1] === '"') { cell += '"'; i++; continue; }
    if (ch === '"') { quoted = !quoted; continue; }
    if (ch === "," && !quoted) { cells.push(cell.trim()); cell = ""; continue; }
    cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}

function firstHeaderIndex(headers: string[], names: Set<string>) {
  return headers.findIndex((h) => names.has(h));
}

export function fitCalibrationProfile(samples: CalibrationSample[] = []): CalibrationProfile {
  const valid = samples.filter((s) => positiveFinite(s.predictedCycles) && positiveFinite(s.measuredCycles));
  if (!valid.length) return { factor: 1, samples: [], createdAt: new Date(0).toISOString(), note: "empty calibration profile" };
  let num = 0;
  let den = 0;
  for (const s of valid) {
    const w = positiveFinite(s.weight) ?? 1;
    num += w * s.measuredCycles;
    den += w * s.predictedCycles;
  }
  return { factor: den > 0 ? num / den : 1, samples: valid, createdAt: new Date().toISOString(), note: "weighted cycle-ratio calibration profile" };
}

export function applyCalibrationFactor(cycles: number, profile?: CalibrationProfile | null): number {
  const factor = positiveFinite(profile?.factor) ?? 1;
  return Math.max(1, Math.round((Number(cycles) || 0) * factor));
}

export function applyCalibration<T extends TileCandidateResult>(candidate: T, profile?: CalibrationProfile | null): T {
  const cycles = applyCalibrationFactor(candidate.cycles, profile);
  const baseCycles = Math.max(1, Number(candidate.cycles) || 1);
  const baseTime = Math.max(1e-9, Number(candidate.timeUs) || baseCycles);
  return { ...candidate, cycles, timeUs: cycles / (baseCycles / baseTime), calibrationFactor: positiveFinite(profile?.factor) ?? 1 };
}

export function parseCalibrationCsv(text: string): CalibrationSample[] {
  const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = csvCells(lines[0]);
  const pIdx = firstHeaderIndex(headers, PREDICTED_HEADERS);
  const mIdx = firstHeaderIndex(headers, MEASURED_HEADERS);
  const wIdx = firstHeaderIndex(headers, WEIGHT_HEADERS);
  if (pIdx < 0 || mIdx < 0) return [];
  const out: CalibrationSample[] = [];
  for (const line of lines.slice(1)) {
    const cols = csvCells(line);
    const predictedCycles = positiveFinite(cols[pIdx]);
    const measuredCycles = positiveFinite(cols[mIdx]);
    if (!predictedCycles || !measuredCycles) continue;
    const weight = wIdx >= 0 ? positiveFinite(cols[wIdx]) : undefined;
    out.push(weight ? { predictedCycles, measuredCycles, weight } : { predictedCycles, measuredCycles });
  }
  return out;
}

export function calibrationFactor(samples: CalibrationSample[] = []): number {
  return fitCalibrationProfile(samples).factor;
}

export function parseMeasurementCsv(text: string, _frequencyMHz?: number): CalibrationSample[] {
  void _frequencyMHz;
  return parseCalibrationCsv(text);
}
