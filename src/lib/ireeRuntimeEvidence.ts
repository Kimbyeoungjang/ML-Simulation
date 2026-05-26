export type IreeRuntimeDecisionStatus = "promote-candidate" | "keep-baseline" | "needs-more-runs" | "regression" | "blocked";

export interface IreeBenchmarkMeasurement {
  label: string;
  kind: "sample" | "mean" | "median" | "p90" | "other";
  valueMs: number;
  unit: string;
  raw: string;
}

export interface IreeRunRuntimeSummary {
  measurements: IreeBenchmarkMeasurement[];
  medianMs?: number;
  p90Ms?: number;
  sampleCount: number;
  parseWarnings: string[];
}

export interface IreeRuntimeComparison {
  function: string;
  baselineMs?: number;
  hintedMs?: number;
  speedup?: number;
  status: IreeRuntimeDecisionStatus;
  reasons: string[];
}

export interface IreeRuntimeDecision {
  schema: "tileforge.iree-runtime-decision.v1";
  generatedAt: string;
  status: IreeRuntimeDecisionStatus;
  comparisons: IreeRuntimeComparison[];
  summary: {
    comparedFunctions: number;
    improvedFunctions: number;
    regressedFunctions: number;
    medianSpeedup?: number;
    worstSpeedup?: number;
    correctness: "not-checked" | "checked" | "mismatch";
  };
  nextActions: string[];
}

const UNIT_TO_MS: Record<string, number> = {
  ns: 1e-6,
  us: 1e-3,
  µs: 1e-3,
  ms: 1,
  s: 1000,
};

function quantile(sorted: number[], q: number) {
  if (!sorted.length) return undefined;
  const pos = (sorted.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  const next = sorted[base + 1];
  if (next == null) return sorted[base];
  return sorted[base] + rest * (next - sorted[base]);
}

function kindForLabel(label: string): IreeBenchmarkMeasurement["kind"] {
  const lower = label.toLowerCase();
  if (/(^|[_/])median$/.test(lower) || lower.includes("real_time_median")) return "median";
  if (/(^|[_/])mean$/.test(lower) || lower.includes("real_time_mean")) return "mean";
  if (/(^|[_/])p90$/.test(lower) || lower.includes("real_time_p90")) return "p90";
  if (lower.includes("stddev") || lower.includes("cv")) return "other";
  return lower.includes("real_time") ? "sample" : "other";
}

export function parseIreeBenchmarkLog(log: string): IreeBenchmarkMeasurement[] {
  const measurements: IreeBenchmarkMeasurement[] = [];
  for (const line of log.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || !/real_time/i.test(trimmed)) continue;
    const match = trimmed.match(/^(\S*real_time\S*)\s+([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?)\s*(ns|us|µs|ms|s)\b/i);
    if (!match) continue;
    const unit = match[3];
    const factor = UNIT_TO_MS[unit] ?? UNIT_TO_MS[unit.toLowerCase()];
    const value = Number(match[2]);
    if (!Number.isFinite(value) || !Number.isFinite(factor)) continue;
    measurements.push({
      label: match[1],
      kind: kindForLabel(match[1]),
      valueMs: value * factor,
      unit,
      raw: trimmed,
    });
  }
  return measurements;
}

export function summarizeIreeBenchmarkLog(log: string): IreeRunRuntimeSummary {
  const measurements = parseIreeBenchmarkLog(log);
  const parseWarnings: string[] = [];
  if (!measurements.length) {
    parseWarnings.push("No Google Benchmark real_time rows were parsed from the runtime log.");
    return { measurements, sampleCount: 0, parseWarnings };
  }
  const explicitMedian = measurements.find((m) => m.kind === "median")?.valueMs;
  const explicitP90 = measurements.find((m) => m.kind === "p90")?.valueMs;
  const samples = measurements.filter((m) => m.kind === "sample").map((m) => m.valueMs);
  const fallbackSamples = samples.length ? samples : measurements.filter((m) => m.kind !== "other").map((m) => m.valueMs);
  const sorted = [...fallbackSamples].sort((a, b) => a - b);
  const medianMs = explicitMedian ?? quantile(sorted, 0.5);
  const p90Ms = explicitP90 ?? quantile(sorted, 0.9) ?? medianMs;
  if (sorted.length < 3) parseWarnings.push("Fewer than 3 runtime samples were parsed; treat the speedup as directional only.");
  return { measurements, medianMs, p90Ms, sampleCount: sorted.length, parseWarnings };
}

export function buildIreeRuntimeDecision(report: any, opts: { generatedAt?: string; correctness?: "not-checked" | "checked" | "mismatch" } = {}): IreeRuntimeDecision {
  const runs: any[] = Array.isArray(report?.runs) ? report.runs : [];
  const byFunction = new Map<string, { baseline?: any; hinted?: any }>();
  for (const run of runs) {
    const fn = String(run.function ?? "unknown");
    const entry = byFunction.get(fn) ?? {};
    if (run.variant === "baseline") entry.baseline = run;
    if (run.variant === "hinted") entry.hinted = run;
    byFunction.set(fn, entry);
  }

  const comparisons: IreeRuntimeComparison[] = [];
  for (const [fn, pair] of byFunction) {
    const reasons: string[] = [];
    const baselineMs = Number(pair.baseline?.runtime?.medianMs ?? pair.baseline?.medianMs);
    const hintedMs = Number(pair.hinted?.runtime?.medianMs ?? pair.hinted?.medianMs);
    if (!pair.baseline || pair.baseline.error || pair.baseline.skipped) {
      comparisons.push({ function: fn, status: "blocked", reasons: ["Baseline runtime run is missing, failed, or skipped."] });
      continue;
    }
    if (!pair.hinted || pair.hinted.error || pair.hinted.skipped) {
      comparisons.push({ function: fn, baselineMs: Number.isFinite(baselineMs) ? baselineMs : undefined, status: "keep-baseline", reasons: ["Hinted runtime run is missing, failed, or skipped."] });
      continue;
    }
    if (!Number.isFinite(baselineMs) || !Number.isFinite(hintedMs) || baselineMs <= 0 || hintedMs <= 0) {
      comparisons.push({ function: fn, status: "needs-more-runs", reasons: ["Runtime logs did not expose comparable median real_time values."] });
      continue;
    }
    const speedup = baselineMs / hintedMs;
    if (speedup >= 1.05) {
      reasons.push(`Hinted median runtime improved by ${(100 * (speedup - 1)).toFixed(1)}%.`);
      comparisons.push({ function: fn, baselineMs, hintedMs, speedup, status: "promote-candidate", reasons });
    } else if (speedup < 0.98) {
      reasons.push(`Hinted median runtime regressed by ${(100 * (1 - speedup)).toFixed(1)}%.`);
      comparisons.push({ function: fn, baselineMs, hintedMs, speedup, status: "regression", reasons });
    } else {
      reasons.push("Hinted runtime is within ±5% of baseline; keep the default lowering unless more runs show a stable gain.");
      comparisons.push({ function: fn, baselineMs, hintedMs, speedup, status: "keep-baseline", reasons });
    }
  }

  const speeds = comparisons.map((c) => c.speedup).filter((x): x is number => Number.isFinite(x));
  speeds.sort((a, b) => a - b);
  const improved = comparisons.filter((c) => c.status === "promote-candidate").length;
  const regressed = comparisons.filter((c) => c.status === "regression").length;
  const blocked = comparisons.filter((c) => c.status === "blocked").length;
  const correctness = opts.correctness ?? "not-checked";
  let status: IreeRuntimeDecisionStatus = "needs-more-runs";
  if (correctness === "mismatch" || blocked > 0) status = "blocked";
  else if (comparisons.length && improved === comparisons.length) status = "promote-candidate";
  else if (regressed > 0) status = "regression";
  else if (comparisons.length && comparisons.every((c) => c.status === "keep-baseline")) status = "keep-baseline";

  const nextActions: string[] = [];
  if (correctness === "not-checked") nextActions.push("Run a correctness check or compare baseline/hinted outputs before promoting transform hints.");
  if (status === "promote-candidate") nextActions.push("Repeat the benchmark on representative shapes and record this run as IREE runtime evidence.");
  else if (status === "regression") nextActions.push("Do not promote the current transform hint; inspect transform.mlir and try the next tiling variant.");
  else if (status === "keep-baseline") nextActions.push("Keep the baseline IREE lowering unless a broader benchmark matrix shows stable speedup.");
  else if (status === "blocked") nextActions.push("Fix runtime/compile failures before using compiler hints for decisions.");
  else nextActions.push("Increase repetitions/warmup and ensure both baseline and hinted runs emit parseable Google Benchmark real_time rows.");

  return {
    schema: "tileforge.iree-runtime-decision.v1",
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    status,
    comparisons,
    summary: {
      comparedFunctions: comparisons.length,
      improvedFunctions: improved,
      regressedFunctions: regressed,
      medianSpeedup: quantile(speeds, 0.5),
      worstSpeedup: speeds.length ? speeds[0] : undefined,
      correctness,
    },
    nextActions,
  };
}

export function ireeRuntimeDecisionMarkdown(decision: IreeRuntimeDecision): string {
  const lines: string[] = [];
  lines.push("# IREE Runtime Decision", "");
  lines.push(`Generated at: ${decision.generatedAt}`);
  lines.push(`Status: **${decision.status}**`, "");
  lines.push("## Summary", "");
  lines.push(`- Compared functions: ${decision.summary.comparedFunctions}`);
  lines.push(`- Improved functions: ${decision.summary.improvedFunctions}`);
  lines.push(`- Regressed functions: ${decision.summary.regressedFunctions}`);
  if (decision.summary.medianSpeedup != null) lines.push(`- Median speedup: ${decision.summary.medianSpeedup.toFixed(3)}x`);
  if (decision.summary.worstSpeedup != null) lines.push(`- Worst speedup: ${decision.summary.worstSpeedup.toFixed(3)}x`);
  lines.push(`- Correctness: ${decision.summary.correctness}`);
  lines.push("", "## Function comparisons", "");
  lines.push("| function | status | baseline median ms | hinted median ms | speedup | reasons |", "|---|---|---:|---:|---:|---|");
  for (const c of decision.comparisons) {
    lines.push(`| ${c.function} | ${c.status} | ${c.baselineMs?.toFixed(4) ?? "-"} | ${c.hintedMs?.toFixed(4) ?? "-"} | ${c.speedup?.toFixed(3) ?? "-"} | ${c.reasons.join("<br>")} |`);
  }
  lines.push("", "## Next actions", "");
  for (const action of decision.nextActions) lines.push(`- ${action}`);
  lines.push("", "## Interpretation", "");
  lines.push("- `promote-candidate` means the hint is worth broader runtime validation, not that it is globally optimal.");
  lines.push("- `keep-baseline` means compile succeeded but measured runtime did not justify the hint.");
  lines.push("- `regression` means the hinted variant was slower on at least one compared function.");
  lines.push("- Correctness remains a separate requirement from runtime speed.");
  return lines.join("\n");
}
