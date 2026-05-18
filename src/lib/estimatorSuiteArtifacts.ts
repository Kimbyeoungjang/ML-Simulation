import { estimateTile } from "./estimator";
import { defaultHardware } from "./defaults";
import type { LearnedEstimatorSample } from "./learnedEstimator";
import type { SearchRequest } from "@/types/domain";
import {
  estimatorSuitePredictionRows,
  summarizeSuiteValidation,
  type EstimatorSuiteModel,
  type EstimatorSuiteSplitKind,
  type TrainEstimatorSuiteOptions,
} from "./estimatorSuite";
import { multiTargetSummaryRows } from "./multiTargetEstimator";

export interface EstimatorSuiteRunOptions extends TrainEstimatorSuiteOptions {
  topK?: number;
}

export interface EstimatorSuiteArtifactBundle {
  modelJson: string;
  treeModelJson: string;
  neuralModelJson: string;
  validationCsv: string;
  predictionsCsv: string;
  reportMarkdown: string;
}

function csvEscape(v: unknown) {
  const s = String(v ?? "");
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toEstimatorCsv(rows: Record<string, unknown>[]) {
  if (!rows.length) return "";
  const header = Array.from(new Set(rows.flatMap((r) => Object.keys(r))));
  return [
    header.join(","),
    ...rows.map((r) => header.map((h) => csvEscape(r[h])).join(",")),
  ].join("\n") + "\n";
}

function parseCsvLine(line: string) {
  const out: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (quoted) {
      if (ch === '"' && line[i + 1] === '"') {
        cell += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      out.push(cell);
      cell = "";
    } else cell += ch;
  }
  out.push(cell);
  return out;
}

export function parseEstimatorCsv(text: string) {
  const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
  if (!lines.length) return [] as Record<string, string>[];
  const header = parseCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const cells = parseCsvLine(line);
    const row: Record<string, string> = {};
    header.forEach((h, i) => {
      row[h] = cells[i] ?? "";
    });
    return row;
  });
}

function num(row: Record<string, string>, names: string[], fallback = NaN) {
  for (const n of names) {
    const raw = row[n];
    if (raw === undefined || raw === "") continue;
    const v = Number(raw);
    if (Number.isFinite(v)) return v;
  }
  return fallback;
}

function str(row: Record<string, string>, names: string[], fallback = "") {
  for (const n of names) if (row[n]) return row[n];
  return fallback;
}

function optNum(row: Record<string, string>, names: string[]) {
  for (const n of names) {
    const raw = row[n];
    if (raw === undefined || raw === "") continue;
    const v = Number(raw);
    if (Number.isFinite(v)) return v;
  }
  return undefined;
}

export function sampleFromEstimatorRow(row: Record<string, string>): LearnedEstimatorSample | undefined {
  const measuredCycles = num(row, ["measuredCycles", "scaleSimCycles", "scalesimCycles", "totalCycles", "cycles_measured", "measured_cycles"]);
  const estimatorCycles = num(row, ["estimatorCycles", "predictedCycles", "tileforgeCycles", "cycles_estimator", "predicted_cycles"]);
  const m = num(row, ["m", "M"]), n = num(row, ["n", "N"]), k = num(row, ["k", "K"]);
  const tileM = num(row, ["tileM", "tm", "tile_m"]), tileN = num(row, ["tileN", "tn", "tile_n"]), tileK = num(row, ["tileK", "tk", "tile_k"]);
  if (![measuredCycles, estimatorCycles, m, n, k, tileM, tileN, tileK].every((v) => Number.isFinite(v) && v > 0)) return undefined;
  return {
    id: str(row, ["id", "sampleId"], ""),
    model: str(row, ["model"], "csv"),
    opName: str(row, ["opName", "op_name", "layer"], "op"),
    arrayRows: num(row, ["arrayRows", "array_rows"], defaultHardware.arrayRows),
    arrayCols: num(row, ["arrayCols", "array_cols"], defaultHardware.arrayCols),
    sramKB: num(row, ["sramKB", "sram_kb"], defaultHardware.sramKB),
    frequencyMHz: num(row, ["frequencyMHz", "freqMHz", "frequency_mhz"], defaultHardware.frequencyMHz),
    memoryBandwidthGBs: optNum(row, ["memoryBandwidthGBs", "memoryBandwidthGBps", "memoryBandwidth", "memory_bandwidth_gbs"]),
    dispatchOverheadUs: optNum(row, ["dispatchOverheadUs", "dispatch_us", "dispatchOverhead"]),
    dataflow: str(row, ["dataflow"], defaultHardware.dataflow),
    dtypeBytes: num(row, ["dtypeBytes", "dtype_bytes"], 2),
    m, n, k, tileM, tileN, tileK, estimatorCycles, measuredCycles,
    estimatorSramBytes: optNum(row, ["estimatorSramBytes", "predictedSramBytes", "tileforgeSramBytes", "sramBytes", "sram_bytes_estimator"]),
    measuredSramBytes: optNum(row, ["measuredSramBytes", "scaleSimSramBytes", "scalesimSramBytes", "sramAccessBytes", "sramBytesMeasured", "sram_bytes_measured"]),
    estimatorDramBytes: optNum(row, ["estimatorDramBytes", "predictedDramBytes", "tileforgeDramBytes", "dramBytes", "dram_bytes_estimator"]),
    measuredDramBytes: optNum(row, ["measuredDramBytes", "scaleSimDramBytes", "scalesimDramBytes", "dramAccessBytes", "dramBytesMeasured", "dram_bytes_measured"]),
    estimatorUtilization: optNum(row, ["estimatorUtilization", "predictedUtilization", "tileforgeUtilization", "utilization", "util_estimator"]),
    measuredUtilization: optNum(row, ["measuredUtilization", "scaleSimUtilization", "scalesimUtilization", "actualUtilization", "utilMeasured", "util_measured"]),
  };
}

export function parseEstimatorSamplesCsv(text: string): LearnedEstimatorSample[] {
  return parseEstimatorCsv(text).map(sampleFromEstimatorRow).filter(Boolean) as LearnedEstimatorSample[];
}

export function designEstimatorSuiteCsv(request: SearchRequest, options: { topK?: number } = {}) {
  const topK = Math.max(1, Math.floor(options.topK ?? request.maxResultsPerOp ?? 3));
  const rows: Record<string, unknown>[] = [];
  for (const shape of request.shapes) {
    const candidates = [];
    for (const tileM of request.candidates.tileM) {
      for (const tileN of request.candidates.tileN) {
        for (const tileK of request.candidates.tileK) {
          candidates.push(estimateTile(request.hardware, shape, tileM, tileN, tileK, request.objective));
        }
      }
    }
    candidates.sort((a, b) => a.score - b.score);
    for (const tile of candidates.slice(0, topK)) {
      rows.push({
        id: `${request.hardware.name}_${shape.id}_${tile.tileM}x${tile.tileN}x${tile.tileK}`,
        model: shape.model,
        opName: shape.opName,
        arrayRows: request.hardware.arrayRows,
        arrayCols: request.hardware.arrayCols,
        sramKB: request.hardware.sramKB,
        frequencyMHz: request.hardware.frequencyMHz,
        dataflow: request.hardware.dataflow,
        dtypeBytes: shape.dtypeBytes,
        m: shape.m,
        n: shape.n,
        k: shape.k,
        tileM: tile.tileM,
        tileN: tile.tileN,
        tileK: tile.tileK,
        estimatorCycles: tile.cycles,
        estimatorSramBytes: tile.sramBytes,
        estimatorDramBytes: (shape.m * shape.k + shape.k * shape.n + shape.m * shape.n) * (shape.dtypeBytes || request.hardware.bytesPerElement || 2),
        estimatorUtilization: tile.utilization,
        measuredCycles: "",
        measuredSramBytes: "",
        measuredDramBytes: "",
        measuredUtilization: "",
        scaleSimRunName: `web_lab_${rows.length}`,
      });
    }
  }
  return toEstimatorCsv(rows);
}

export function normalizeSuiteSplitKinds(value: unknown): EstimatorSuiteSplitKind[] {
  const allowed = new Set<EstimatorSuiteSplitKind>(["random", "workload", "array", "dataflow", "large-shape"]);
  const raw = Array.isArray(value) ? value : String(value ?? "random,workload,array,dataflow,large-shape").split(/[, ]+/);
  const out = raw.map((v) => String(v).trim()).filter((v): v is EstimatorSuiteSplitKind => allowed.has(v as EstimatorSuiteSplitKind));
  return out.length ? out : ["random"];
}

export function buildEstimatorSuiteArtifacts(model: EstimatorSuiteModel, samples: LearnedEstimatorSample[]): EstimatorSuiteArtifactBundle {
  const rows = model.validationSuite;
  const metricRows = rows.map((r) => `| ${r.kind} | ${r.testSamples} | ${r.baseline.learnedMapePct.toFixed(2)}% | ${r.tree.learnedMapePct.toFixed(2)}% | ${r.neural.learnedMapePct.toFixed(2)}% | ${r.ensemble.learnedMapePct.toFixed(2)}% | ${r.ensemble.p90AbsPct.toFixed(2)}% | ${r.recommended} |`).join("\n");
  const multiRows = multiTargetSummaryRows(model.multiTarget).map(r => `| ${r.target} | ${r.samples} | ${r.mapePct.toFixed(2)}% | ${r.p90AbsPct.toFixed(2)}% |`).join("\n");
  const reportMarkdown = [
    `# TileForge Web Estimator Suite Report`,
    ``,
    `추천 최종 모델: **${model.recommended}**`,
    ``,
    `이 suite는 cycle에 대해 analytical baseline, Tree residual, Neural residual, Direct neural을 함께 학습하고 validation 성능으로 ensemble weight를 정합니다. CSV에 SRAM/DRAM/utilization measured column이 있으면 해당 지표는 별도 multi-target direct model로 학습합니다.`,
    ``,
    `## Dataset`,
    ``,
    `- Valid samples: ${model.metadata.samples.toLocaleString()}`,
    `- Final train samples: ${model.metadata.trainSamples.toLocaleString()}`,
    `- Target: ${model.target}`,
    ``,
    `## Final ensemble weights`,
    ``,
    `| Component | Weight |`,
    `|---|---:|`,
    `| Analytical baseline | ${model.weights.analytical.toFixed(4)} |`,
    `| Tree residual | ${model.weights.tree.toFixed(4)} |`,
    `| Neural residual | ${model.weights.neural.toFixed(4)} |`,
    `| Direct neural cycle | ${(model.weights.directNeural ?? 0).toFixed(4)} |`,
    ``,
    `## Holdout validation`,
    ``,
    `| Split | Test samples | Analytical MAPE | Tree MAPE | Neural MAPE | Ensemble MAPE | Ensemble P90 | Best |`,
    `|---|---:|---:|---:|---:|---:|---:|---|`,
    metricRows || `| n/a | 0 | - | - | - | - | - | - |`,
    ``,
    `## Multi-target metrics`,
    ``,
    `| Target | Samples | MAPE | P90 |`,
    `|---|---:|---:|---:|`,
    multiRows || `| n/a | 0 | - | - |`,
    ``,
    `## Recommended use`,
    ``,
    `- 수천 개 이하 데이터에서는 Tree residual 중심으로 확인하세요.`,
    `- 수만 개 이상 데이터에서는 Neural residual과 Ensemble의 holdout 성능을 함께 비교하세요.`,
    `- random split만 보지 말고 workload/array/dataflow/large-shape holdout을 함께 제시하는 것이 안전합니다.`,
  ].join("\n");
  return {
    modelJson: JSON.stringify(model, null, 2),
    treeModelJson: JSON.stringify(model.tree, null, 2),
    neuralModelJson: JSON.stringify(model.neural, null, 2),
    validationCsv: toEstimatorCsv(summarizeSuiteValidation(model) as unknown as Record<string, unknown>[]),
    predictionsCsv: toEstimatorCsv(estimatorSuitePredictionRows(samples, model) as unknown as Record<string, unknown>[]),
    reportMarkdown,
  };
}
