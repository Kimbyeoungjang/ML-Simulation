import type { SearchResponse } from "@/types/domain";
import { toEstimatorCsv } from "@/lib/estimatorSuiteArtifacts";
import type { ExternalRunSummary, ScaleSimLayerSummary } from "./externalRunTypes";
import { matchScaleLayerForResult } from "./scaleSimReport";

export const VALIDATION_EVIDENCE_SCHEMA = "tileforge.validation-evidence.v1" as const;

export type ValidationEvidenceScope = "full-layer" | "tile-policy";
export type ValidationEvidenceReliability = "design-target" | "ranking-diagnostic" | "unmatched";

export interface ValidationEvidenceRow {
  id: string;
  generatedAt: string;
  jobId?: string;
  model: string;
  opName: string;
  shapeId: string;
  targetScope: ValidationEvidenceScope;
  measuredSource: string;
  reliability: ValidationEvidenceReliability;
  arrayRows: number;
  arrayCols: number;
  sramKB: number;
  frequencyMHz: number;
  memoryBandwidthGBs?: number;
  dataflow: string;
  dtypeBytes: number;
  m: number;
  n: number;
  k: number;
  tileM: number;
  tileN: number;
  tileK: number;
  estimatorCycles: number;
  rawEstimatorCycles?: number;
  measuredCycles?: number;
  measuredLayerName?: string;
  measuredUtilization?: number;
  measuredSramAccesses?: number;
  measuredDramAccesses?: number;
  predictionConfidence?: number;
  tileScratchBytes?: number;
  fullLayerWorkingSetBytes?: number;
  ratio?: number;
  absErrorPct?: number;
  notes: string[];
}

export interface ValidationEvidenceBundle {
  schema: typeof VALIDATION_EVIDENCE_SCHEMA;
  generatedAt: string;
  jobId?: string;
  summary: {
    rows: number;
    fullLayerMatched: number;
    fullLayerMissing: number;
    tilePolicyDiagnostics: number;
    meanAbsErrorPct?: number;
    medianAbsErrorPct?: number;
    worstAbsErrorPct?: number;
    readyForEstimatorSuiteFeedback: boolean;
  };
  rows: ValidationEvidenceRow[];
}

function pct(actual: number | undefined, predicted: number | undefined) {
  if (!Number.isFinite(actual) || !Number.isFinite(predicted) || !predicted) return undefined;
  return ((Number(predicted) - Number(actual)) / Number(actual)) * 100;
}

function ratio(actual: number | undefined, predicted: number | undefined) {
  if (!Number.isFinite(actual) || !Number.isFinite(predicted) || !predicted) return undefined;
  return Number(actual) / Number(predicted);
}

function median(xs: number[]) {
  const sorted = xs.slice().sort((a, b) => a - b);
  return sorted.length ? sorted[Math.floor(sorted.length / 2)] : undefined;
}

function mean(xs: number[]) {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : undefined;
}

function roundMaybe(v: number | undefined) {
  return Number.isFinite(v) ? Math.round(Number(v) * 1_000_000) / 1_000_000 : undefined;
}

function baseRow(input: {
  response: SearchResponse;
  result: SearchResponse["results"][number];
  targetScope: ValidationEvidenceScope;
  generatedAt: string;
  jobId?: string;
}): Omit<ValidationEvidenceRow, "id" | "measuredSource" | "reliability" | "estimatorCycles" | "notes"> {
  const { response, result } = input;
  const best = result.best;
  const hw = response.request.hardware;
  const shape = result.shape;
  return {
    generatedAt: input.generatedAt,
    jobId: input.jobId,
    model: shape.model,
    opName: shape.opName,
    shapeId: shape.id,
    targetScope: input.targetScope,
    arrayRows: hw.arrayRows,
    arrayCols: hw.arrayCols,
    sramKB: hw.sramKB,
    frequencyMHz: hw.frequencyMHz,
    memoryBandwidthGBs: hw.memoryBandwidthGBs,
    dataflow: hw.dataflow,
    dtypeBytes: shape.dtypeBytes,
    m: shape.m,
    n: shape.n,
    k: shape.k,
    tileM: best.tileM,
    tileN: best.tileN,
    tileK: best.tileK,
    rawEstimatorCycles: best.fullLayerRawCycles ?? best.rawCycles,
    predictionConfidence: best.predictionConfidence,
    tileScratchBytes: best.tileScratchBytes ?? best.sramBytes,
    fullLayerWorkingSetBytes: best.fullLayerSramBytes,
  };
}

function fullLayerEvidenceRows(response: SearchResponse, scale: ExternalRunSummary | undefined, generatedAt: string, jobId?: string) {
  return response.results.map((result) => {
    const layer = scale?.ok ? matchScaleLayerForResult(result, scale.layers ?? []) : undefined;
    const measured = layer?.cycles && layer.cycles > 0 ? layer.cycles : undefined;
    const estimated = result.best.fullLayerCycles ?? result.best.cycles;
    const err = pct(measured, estimated);
    const row: ValidationEvidenceRow = {
      ...baseRow({ response, result, targetScope: "full-layer", generatedAt, jobId }),
      id: `${jobId ?? "job"}:${result.shape.id}:full-layer`,
      measuredSource: measured ? "scalesim-compute-report" : "missing-scalesim-layer",
      reliability: measured ? "design-target" : "unmatched",
      estimatorCycles: estimated,
      measuredCycles: measured,
      measuredLayerName: layer?.name,
      measuredUtilization: layer?.overallUtil,
      measuredSramAccesses: layer?.sramAccesses,
      measuredDramAccesses: layer?.dramAccesses,
      ratio: roundMaybe(ratio(measured, estimated)),
      absErrorPct: err === undefined ? undefined : Math.abs(err),
      notes: measured
        ? ["full-layer SCALE-Sim COMPUTE_REPORT row matched; usable as Estimator Suite full-layer target"]
        : ["no matched SCALE-Sim layer; keep as unmatched evidence only"],
    };
    return row;
  });
}

function tilePolicyDiagnosticRows(response: SearchResponse, scale: ExternalRunSummary | undefined, generatedAt: string, jobId?: string) {
  const byShape = new Map(response.results.map((r) => [r.shape.id, r]));
  const rows: ValidationEvidenceRow[] = [];
  for (const layer of scale?.candidateLayers ?? []) {
    if (!layer.shapeId) continue;
    const result = byShape.get(layer.shapeId);
    if (!result) continue;
    const measured = layer.tileExtrapolatedCycles ?? layer.cycles;
    if (!Number.isFinite(measured) || measured <= 0) continue;
    const estimated = layer.predictedCycles ?? result.best.tilePolicyCycles ?? result.best.cycles;
    const err = pct(measured, estimated);
    const row: ValidationEvidenceRow = {
      ...baseRow({ response, result, targetScope: "tile-policy", generatedAt, jobId }),
      id: `${jobId ?? "job"}:${layer.shapeId}:tile-policy:${layer.rank ?? rows.length + 1}`,
      measuredSource: layer.tileExtrapolatedCycles ? "scalesim-topk-tile-extrapolated" : "scalesim-topk-micro-run",
      reliability: "ranking-diagnostic",
      tileM: layer.tileM ?? result.best.tileM,
      tileN: layer.tileN ?? result.best.tileN,
      tileK: layer.tileK ?? result.best.tileK,
      estimatorCycles: estimated,
      rawEstimatorCycles: layer.predictedCycles,
      measuredCycles: measured,
      measuredLayerName: layer.name,
      measuredUtilization: layer.overallUtil,
      measuredSramAccesses: layer.sramAccesses,
      measuredDramAccesses: layer.dramAccesses,
      ratio: roundMaybe(ratio(measured, estimated)),
      absErrorPct: err === undefined ? undefined : Math.abs(err),
      notes: [
        "top-k tile SCALE-Sim diagnostic; useful for ranking/regret analysis",
        "do not mix with full-layer hardware-design targets unless targetScope is explicitly separated",
      ],
    };
    rows.push(row);
  }
  return rows;
}

export function buildValidationEvidenceBundle(
  response: SearchResponse,
  scale?: ExternalRunSummary,
  opts: { jobId?: string; generatedAt?: string } = {},
): ValidationEvidenceBundle {
  const generatedAt = opts.generatedAt ?? new Date().toISOString();
  const fullLayer = fullLayerEvidenceRows(response, scale, generatedAt, opts.jobId);
  const tilePolicy = tilePolicyDiagnosticRows(response, scale, generatedAt, opts.jobId);
  const rows = [...fullLayer, ...tilePolicy];
  const matched = fullLayer.filter((r) => r.reliability === "design-target");
  const errors = matched.map((r) => r.absErrorPct).filter((x): x is number => Number.isFinite(x));
  return {
    schema: VALIDATION_EVIDENCE_SCHEMA,
    generatedAt,
    jobId: opts.jobId,
    summary: {
      rows: rows.length,
      fullLayerMatched: matched.length,
      fullLayerMissing: fullLayer.length - matched.length,
      tilePolicyDiagnostics: tilePolicy.length,
      meanAbsErrorPct: roundMaybe(mean(errors)),
      medianAbsErrorPct: roundMaybe(median(errors)),
      worstAbsErrorPct: errors.length ? roundMaybe(Math.max(...errors)) : undefined,
      readyForEstimatorSuiteFeedback: matched.length > 0,
    },
    rows,
  };
}

export function validationEvidenceJson(bundle: ValidationEvidenceBundle): string {
  return JSON.stringify(bundle, null, 2);
}

export function validationEvidenceMarkdown(bundle: ValidationEvidenceBundle): string {
  const lines: string[] = [];
  lines.push("# Validation Evidence Ledger", "");
  lines.push("이 파일은 외부 SCALE-Sim 결과를 TileForge 예측값과 연결해, 어떤 row가 Estimator Suite 재학습 target으로 안전한지 구분합니다.", "");
  lines.push("## Summary", "");
  lines.push("| item | value |", "|---|---:|");
  lines.push(`| total evidence rows | ${bundle.summary.rows.toLocaleString()} |`);
  lines.push(`| matched full-layer rows | ${bundle.summary.fullLayerMatched.toLocaleString()} |`);
  lines.push(`| missing full-layer rows | ${bundle.summary.fullLayerMissing.toLocaleString()} |`);
  lines.push(`| tile-policy diagnostic rows | ${bundle.summary.tilePolicyDiagnostics.toLocaleString()} |`);
  lines.push(`| mean abs error | ${bundle.summary.meanAbsErrorPct !== undefined ? `${bundle.summary.meanAbsErrorPct.toFixed(2)}%` : "n/a"} |`);
  lines.push(`| median abs error | ${bundle.summary.medianAbsErrorPct !== undefined ? `${bundle.summary.medianAbsErrorPct.toFixed(2)}%` : "n/a"} |`);
  lines.push(`| worst abs error | ${bundle.summary.worstAbsErrorPct !== undefined ? `${bundle.summary.worstAbsErrorPct.toFixed(2)}%` : "n/a"} |`);
  lines.push("", "## Rules", "");
  lines.push("- `reliability=design-target`인 `full-layer` row만 하드웨어 설계용 Estimator Suite full-layer 학습 target으로 바로 사용할 수 있습니다.");
  lines.push("- `reliability=ranking-diagnostic`인 `tile-policy` row는 top-k tile regret 진단용입니다. full-layer target과 섞지 마세요.");
  lines.push("- `unmatched` row는 SCALE-Sim layer 매칭 실패를 의미하므로, CSV에는 남기되 학습에서는 제외하거나 수동 검토하세요.");
  const preview = bundle.rows.slice(0, 12);
  if (preview.length) {
    lines.push("", "## Evidence preview", "");
    lines.push("| scope | reliability | op | estimator | measured | ratio | abs error | source |", "|---|---|---|---:|---:|---:|---:|---|");
    for (const row of preview) {
      lines.push(`| ${row.targetScope} | ${row.reliability} | ${row.model}.${row.opName} | ${Math.round(row.estimatorCycles).toLocaleString()} | ${row.measuredCycles ? Math.round(row.measuredCycles).toLocaleString() : "n/a"} | ${row.ratio !== undefined ? row.ratio.toFixed(3) : "n/a"} | ${row.absErrorPct !== undefined ? `${row.absErrorPct.toFixed(2)}%` : "n/a"} | ${row.measuredSource} |`);
    }
  }
  lines.push("", "## Feedback loop", "");
  lines.push("1. 하드웨어 설계용 재학습에는 `estimator_suite_feedback_full_layer.csv`를 Estimator Suite dataset에 추가합니다.");
  lines.push("2. `estimator_suite_feedback_tile_policy.csv`는 별도 tile-policy 학습/랭킹 검증에만 사용합니다.");
  lines.push("3. 전체 감사가 필요할 때만 `estimator_suite_feedback.csv`를 열고, 재학습 후 readiness report가 `ready` 또는 `caution`인지 확인합니다.");
  return lines.join("\n");
}

export type EstimatorSuiteFeedbackScope = "all" | "full-layer" | "tile-policy";

export function validationEvidenceRowToEstimatorFeedbackRecord(r: ValidationEvidenceRow): Record<string, unknown> {
  return {
    id: r.id,
    model: r.model,
    opName: r.opName,
    arrayRows: r.arrayRows,
    arrayCols: r.arrayCols,
    sramKB: r.sramKB,
    frequencyMHz: r.frequencyMHz,
    memoryBandwidthGBs: r.memoryBandwidthGBs ?? "",
    dataflow: r.dataflow,
    dtypeBytes: r.dtypeBytes,
    m: r.m,
    n: r.n,
    k: r.k,
    tileM: r.targetScope === "full-layer" ? r.m : r.tileM,
    tileN: r.targetScope === "full-layer" ? r.n : r.tileN,
    tileK: r.targetScope === "full-layer" ? r.k : r.tileK,
    estimatorCycles: Math.round(r.estimatorCycles),
    measuredCycles: Math.round(r.measuredCycles ?? 0),
    estimatorSramBytes: r.tileScratchBytes ?? "",
    measuredSramBytes: r.measuredSramAccesses ?? "",
    estimatorDramBytes: r.fullLayerWorkingSetBytes ?? "",
    measuredDramBytes: r.measuredDramAccesses ?? "",
    estimatorUtilization: r.predictionConfidence ?? "",
    measuredUtilization: r.measuredUtilization ?? "",
    targetScope: r.targetScope,
    measuredSource: r.measuredSource,
    evidenceReliability: r.reliability,
    ratio: r.ratio ?? "",
    absErrorPct: r.absErrorPct ?? "",
    sourceJobId: r.jobId ?? "",
    sourceLayer: r.measuredLayerName ?? "",
  };
}

function isFeedbackRowForScope(row: ValidationEvidenceRow, scope: EstimatorSuiteFeedbackScope): boolean {
  if (!row.measuredCycles || row.measuredCycles <= 0) return false;
  if (row.reliability === "unmatched") return false;
  if (scope === "all") return true;
  if (scope === "full-layer") return row.targetScope === "full-layer" && row.reliability === "design-target";
  return row.targetScope === "tile-policy" && row.reliability === "ranking-diagnostic";
}

export function estimatorSuiteFeedbackCsvForScope(
  bundle: ValidationEvidenceBundle,
  scope: EstimatorSuiteFeedbackScope = "all",
): string {
  const rows = bundle.rows
    .filter((r) => isFeedbackRowForScope(r, scope))
    .map(validationEvidenceRowToEstimatorFeedbackRecord);
  return toEstimatorCsv(rows);
}

export function estimatorSuiteFeedbackCsv(bundle: ValidationEvidenceBundle): string {
  return estimatorSuiteFeedbackCsvForScope(bundle, "all");
}
