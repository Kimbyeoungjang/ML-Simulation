import type { LearnedEstimatorSample } from "./learnedEstimator";
import { parseEstimatorCsv, sampleFromEstimatorRow, toEstimatorCsv } from "./estimatorSuiteArtifacts";

export interface EstimatorDatasetInput {
  name: string;
  text: string;
}

export interface EstimatorDatasetSummary {
  files: number;
  inputRows: number;
  mergedRows: number;
  validSamples: number;
  invalidRows: number;
  duplicatesRemoved: number;
  missingMeasuredCycles: number;
  missingEstimatorCycles: number;
  dataflows: Record<string, number>;
  arrays: Record<string, number>;
  models: Record<string, number>;
  ops: Record<string, number>;
  targetScopes: Record<string, number>;
  warnings: string[];
}

export interface EstimatorDatasetBuildResult {
  csv: string;
  rows: Record<string, string>[];
  samples: LearnedEstimatorSample[];
  summary: EstimatorDatasetSummary;
}

function numberish(value: string | undefined) {
  if (value === undefined || value.trim() === "") return NaN;
  const n = Number(value);
  return Number.isFinite(n) ? n : NaN;
}

function first(row: Record<string, string>, names: string[], fallback = "") {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && value !== "") return value;
  }
  return fallback;
}

function inc(map: Record<string, number>, key: string) {
  const normalized = key.trim() || "unknown";
  map[normalized] = (map[normalized] ?? 0) + 1;
}

function rowSignature(row: Record<string, string>) {
  const explicit = first(row, ["id", "sampleId"]);
  if (explicit) {
    const scope = first(row, ["targetScope", "target_scope", "measurementScope", "scope"], "mixed");
    const source = first(row, ["measuredSource", "measured_source"], "");
    return `id:${explicit}|${scope}|${source}`;
  }
  const pieces = [
    first(row, ["model"], "csv"),
    first(row, ["opName", "op_name", "layer"], "op"),
    first(row, ["arrayRows", "array_rows"]),
    first(row, ["arrayCols", "array_cols"]),
    first(row, ["sramKB", "sram_kb"]),
    first(row, ["dataflow"]),
    first(row, ["m", "M"]),
    first(row, ["n", "N"]),
    first(row, ["k", "K"]),
    first(row, ["tileM", "tm", "tile_m"]),
    first(row, ["tileN", "tn", "tile_n"]),
    first(row, ["tileK", "tk", "tile_k"]),
    first(row, ["targetScope", "target_scope", "measurementScope", "scope"], "mixed"),
    first(row, ["measuredSource", "measured_source"], ""),
  ];
  return `cfg:${pieces.join("|")}`;
}

function normalizeRow(row: Record<string, string>, sourceName: string, sourceIndex: number, rowIndex: number) {
  const out = { ...row };
  if (!out.id && !out.sampleId) out.id = `${sourceName.replace(/[^a-zA-Z0-9_-]+/g, "_")}_${sourceIndex}_${rowIndex}`;
  if (!out.sourceCsv) out.sourceCsv = sourceName;
  return out;
}

export function buildEstimatorDataset(files: EstimatorDatasetInput[], options: { dedupe?: boolean } = {}): EstimatorDatasetBuildResult {
  const dedupe = options.dedupe !== false;
  const warnings: string[] = [];
  const normalizedRows: Record<string, string>[] = [];
  let inputRows = 0;
  let duplicatesRemoved = 0;
  const seen = new Set<string>();

  files.forEach((file, fileIndex) => {
    const rows = parseEstimatorCsv(file.text);
    if (!rows.length) warnings.push(`${file.name}: 읽을 수 있는 CSV row가 없습니다.`);
    inputRows += rows.length;
    rows.forEach((row, rowIndex) => {
      const normalized = normalizeRow(row, file.name || `dataset_${fileIndex}`, fileIndex, rowIndex);
      const sig = rowSignature(normalized);
      if (dedupe && seen.has(sig)) {
        duplicatesRemoved++;
        return;
      }
      seen.add(sig);
      normalizedRows.push(normalized);
    });
  });

  let missingMeasuredCycles = 0;
  let missingEstimatorCycles = 0;
  let invalidRows = 0;
  const samples: LearnedEstimatorSample[] = [];
  const dataflows: Record<string, number> = {};
  const arrays: Record<string, number> = {};
  const models: Record<string, number> = {};
  const ops: Record<string, number> = {};
  const targetScopes: Record<string, number> = {};

  for (const row of normalizedRows) {
    const measured = numberish(first(row, ["measuredCycles", "scaleSimCycles", "scalesimCycles", "totalCycles", "cycles_measured", "measured_cycles"]));
    const estimator = numberish(first(row, ["estimatorCycles", "predictedCycles", "tileforgeCycles", "cycles_estimator", "predicted_cycles"]));
    if (!Number.isFinite(measured) || measured <= 0) missingMeasuredCycles++;
    if (!Number.isFinite(estimator) || estimator <= 0) missingEstimatorCycles++;
    const sample = sampleFromEstimatorRow(row);
    if (sample) {
      samples.push(sample);
      inc(dataflows, sample.dataflow);
      inc(arrays, `${sample.arrayRows}x${sample.arrayCols}`);
      inc(models, sample.model ?? "csv");
      inc(ops, sample.opName ?? "op");
      inc(targetScopes, sample.targetScope ?? "mixed");
    } else {
      invalidRows++;
    }
  }

  if (samples.length < 40) warnings.push(`학습 가능한 measured sample이 ${samples.length}개입니다. Estimator Suite 학습에는 최소 40개가 필요합니다.`);
  if (missingMeasuredCycles > 0) warnings.push(`measuredCycles가 비었거나 0 이하인 row ${missingMeasuredCycles.toLocaleString()}개는 학습에서 제외됩니다.`);
  if (duplicatesRemoved > 0) warnings.push(`중복 row ${duplicatesRemoved.toLocaleString()}개를 제거했습니다.`);
  const scopeKinds = Object.keys(targetScopes).filter((k) => (targetScopes[k] ?? 0) > 0);
  if (scopeKinds.length > 1) warnings.push(`full-layer와 tile-policy target이 함께 있습니다(${scopeKinds.join(", ")}). 보고서/학습에서 target 기준을 분리해서 해석하세요.`);

  return {
    csv: toEstimatorCsv(normalizedRows as unknown as Record<string, unknown>[]),
    rows: normalizedRows,
    samples,
    summary: {
      files: files.length,
      inputRows,
      mergedRows: normalizedRows.length,
      validSamples: samples.length,
      invalidRows,
      duplicatesRemoved,
      missingMeasuredCycles,
      missingEstimatorCycles,
      dataflows,
      arrays,
      models,
      ops,
      targetScopes,
      warnings,
    },
  };
}

function mapTable(title: string, values: Record<string, number>) {
  const entries = Object.entries(values).sort((a, b) => b[1] - a[1]).slice(0, 20);
  if (!entries.length) return [`## ${title}`, "", "값이 없습니다."].join("\n");
  return [
    `## ${title}`,
    "",
    "| 값 | row 수 |",
    "|---|---:|",
    ...entries.map(([k, v]) => `| ${k} | ${v.toLocaleString()} |`),
  ].join("\n");
}

export function estimatorDatasetSummaryMarkdown(summary: EstimatorDatasetSummary) {
  return [
    "# Estimator Suite Dataset Summary",
    "",
    "## 개요",
    "",
    "| 항목 | 값 |",
    "|---|---:|",
    `| 업로드 CSV 파일 | ${summary.files.toLocaleString()} |`,
    `| 입력 row | ${summary.inputRows.toLocaleString()} |`,
    `| 병합 후 row | ${summary.mergedRows.toLocaleString()} |`,
    `| 유효 학습 sample | ${summary.validSamples.toLocaleString()} |`,
    `| 제외 row | ${summary.invalidRows.toLocaleString()} |`,
    `| 제거된 중복 | ${summary.duplicatesRemoved.toLocaleString()} |`,
    `| measuredCycles 누락/무효 | ${summary.missingMeasuredCycles.toLocaleString()} |`,
    `| estimatorCycles 누락/무효 | ${summary.missingEstimatorCycles.toLocaleString()} |`,
    "",
    summary.warnings.length ? ["## 경고", "", ...summary.warnings.map((w) => `- ${w}`)].join("\n") : "## 경고\n\n없음",
    "",
    mapTable("Dataflow 분포", summary.dataflows),
    "",
    mapTable("Array 분포", summary.arrays),
    "",
    mapTable("Model 분포", summary.models),
    "",
    mapTable("Operation 분포", summary.ops),
    "",
    mapTable("Target scope 분포", summary.targetScopes),
  ].join("\n");
}
