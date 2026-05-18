import type { CalibrationProfile, CalibrationSample, TileCandidateResult } from "@/types/domain";

/**
 * Legacy compatibility shim. The old global regression calibration UI/API was
 * removed in favour of Estimator Suite, but some downstream CI/tests and older
 * user projects still import these symbols. Keep these helpers as no-op/simple
 * utilities so old imports do not break while the runtime path stays Estimator
 * Suite based.
 */
export type { CalibrationProfile, CalibrationSample };

export function fitCalibrationProfile(samples: CalibrationSample[] = []): CalibrationProfile {
  const valid = samples.filter((s) => Number.isFinite(s.predictedCycles) && s.predictedCycles > 0 && Number.isFinite(s.measuredCycles) && s.measuredCycles > 0);
  if (!valid.length) return { factor: 1, samples: [], createdAt: new Date(0).toISOString(), note: "legacy no-op profile" };
  let num = 0;
  let den = 0;
  for (const s of valid) {
    const w = Number.isFinite(s.weight) && s.weight! > 0 ? s.weight! : 1;
    num += w * s.measuredCycles;
    den += w * s.predictedCycles;
  }
  return { factor: den > 0 ? num / den : 1, samples: valid, createdAt: new Date().toISOString(), note: "legacy compatibility profile" };
}

export function applyCalibrationFactor(cycles: number, profile?: CalibrationProfile | null): number {
  const factor = Number(profile?.factor);
  return Math.max(1, Math.round((Number(cycles) || 0) * (Number.isFinite(factor) && factor > 0 ? factor : 1)));
}

export function applyCalibration<T extends TileCandidateResult>(candidate: T, profile?: CalibrationProfile | null): T {
  const cycles = applyCalibrationFactor(candidate.cycles, profile);
  return { ...candidate, cycles, timeUs: cycles / Math.max(1, candidate.cycles / Math.max(1, candidate.timeUs || 1)), calibrationFactor: profile?.factor ?? 1 };
}

export function parseCalibrationCsv(text: string): CalibrationSample[] {
  const lines = String(text || "").trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map((h) => h.trim());
  const idx = (names: string[]) => names.map((n) => headers.findIndex((h) => h === n)).find((i) => i !== undefined && i >= 0) ?? -1;
  const pIdx = idx(["predictedCycles", "predicted_cycles", "estimatorCycles"]);
  const mIdx = idx(["measuredCycles", "measured_cycles", "scaleSimCycles"]);
  const out: CalibrationSample[] = [];
  for (const line of lines.slice(1)) {
    const cols = line.split(',');
    const predictedCycles = Number(cols[pIdx]);
    const measuredCycles = Number(cols[mIdx]);
    if (Number.isFinite(predictedCycles) && Number.isFinite(measuredCycles)) out.push({ predictedCycles, measuredCycles });
  }
  return out;
}


/** Backward-compatible name used by older CI/tests. */
export function calibrationFactor(samples: CalibrationSample[] = []): number {
  return fitCalibrationProfile(samples).factor;
}

/** Backward-compatible CSV parser name used by older CI/tests. */
export function parseMeasurementCsv(text: string): CalibrationSample[] {
  return parseCalibrationCsv(text);
}
