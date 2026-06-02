import type { LearnedEstimatorSample } from "./learnedEstimator";
import {
  buildEstimatorSuiteArtifacts,
  parseEstimatorCsv,
  sampleFromEstimatorRow,
  toEstimatorCsv,
  type EstimatorSuiteArtifactBundle,
} from "./estimatorSuiteArtifacts";
import {
  buildEstimatorDataset,
  estimatorDatasetSummaryMarkdown,
  type EstimatorDatasetInput,
  type EstimatorDatasetSummary,
} from "./estimatorSuiteDataset";
import {
  trainEstimatorSuite,
  type EstimatorSuiteModel,
  type TrainEstimatorSuiteOptions,
} from "./estimatorSuite";
import { assessEstimatorSuiteReadiness, estimatorSuiteReadinessMarkdown } from "./estimatorSuiteReadiness";

export type EstimatorTargetScope = "full-layer" | "tile-policy";

export const ESTIMATOR_TARGET_SCOPES: readonly EstimatorTargetScope[] = [
  "full-layer",
  "tile-policy",
] as const;

export interface ScopedEstimatorDataset {
  scope: EstimatorTargetScope;
  csv: string;
  rows: Record<string, string>[];
  samples: LearnedEstimatorSample[];
  summary: EstimatorDatasetSummary;
  reportMarkdown: string;
}

export interface ScopedEstimatorDatasetsResult {
  mergedCsv: string;
  mergedRows: Record<string, string>[];
  mergedSamples: LearnedEstimatorSample[];
  mergedSummary: EstimatorDatasetSummary;
  mergedReportMarkdown: string;
  scopes: Record<EstimatorTargetScope, ScopedEstimatorDataset>;
  warnings: string[];
}

export interface ScopedEstimatorTrainingResult {
  scope: EstimatorTargetScope;
  samples: number;
  status: "trained" | "skipped";
  reason?: string;
  model?: EstimatorSuiteModel;
  artifacts?: EstimatorSuiteArtifactBundle;
  reportMarkdown: string;
}

export interface ScopedEstimatorPipelineResult extends ScopedEstimatorDatasetsResult {
  training: Record<EstimatorTargetScope, ScopedEstimatorTrainingResult>;
  files: Record<string, string>;
  combinedReportMarkdown: string;
}

function scopeSlug(scope: EstimatorTargetScope) {
  return scope;
}

function sampleScope(row: Record<string, string>) {
  return sampleFromEstimatorRow(row)?.targetScope;
}

function buildScopedInput(scope: EstimatorTargetScope, rows: Record<string, string>[]) {
  return [{ name: `${scope}.csv`, text: toEstimatorCsv(rows as unknown as Record<string, unknown>[]) }];
}

function emptySummary(scope: EstimatorTargetScope): EstimatorDatasetSummary {
  return {
    files: 0,
    inputRows: 0,
    mergedRows: 0,
    validSamples: 0,
    invalidRows: 0,
    duplicatesRemoved: 0,
    missingMeasuredCycles: 0,
    missingEstimatorCycles: 0,
    dataflows: {},
    arrays: {},
    models: {},
    ops: {},
    targetScopes: { [scope]: 0 },
    warnings: [`${scope} target sample이 없습니다.`],
  };
}

function datasetForScope(scope: EstimatorTargetScope, rows: Record<string, string>[]): ScopedEstimatorDataset {
  const scopedRows = rows.filter((row) => sampleScope(row) === scope);
  if (!scopedRows.length) {
    const summary = emptySummary(scope);
    return {
      scope,
      csv: "",
      rows: [],
      samples: [],
      summary,
      reportMarkdown: estimatorDatasetSummaryMarkdown(summary),
    };
  }
  const dataset = buildEstimatorDataset(buildScopedInput(scope, scopedRows), { dedupe: false });
  return {
    scope,
    csv: dataset.csv,
    rows: dataset.rows,
    samples: dataset.samples,
    summary: dataset.summary,
    reportMarkdown: estimatorDatasetSummaryMarkdown(dataset.summary),
  };
}

export function buildScopedEstimatorDatasets(
  files: EstimatorDatasetInput[],
  options: { dedupe?: boolean } = {},
): ScopedEstimatorDatasetsResult {
  const merged = buildEstimatorDataset(files, options);
  const scopes = Object.fromEntries(
    ESTIMATOR_TARGET_SCOPES.map((scope) => [scope, datasetForScope(scope, merged.rows)]),
  ) as Record<EstimatorTargetScope, ScopedEstimatorDataset>;
  const warnings = [
    ...merged.summary.warnings,
    ...ESTIMATOR_TARGET_SCOPES.flatMap((scope) => scopes[scope].summary.warnings.map((w) => `${scope}: ${w}`)),
  ];
  return {
    mergedCsv: merged.csv,
    mergedRows: merged.rows,
    mergedSamples: merged.samples,
    mergedSummary: merged.summary,
    mergedReportMarkdown: estimatorDatasetSummaryMarkdown(merged.summary),
    scopes,
    warnings,
  };
}

function trainOneScope(
  dataset: ScopedEstimatorDataset,
  options: TrainEstimatorSuiteOptions,
  minSamples: number,
): ScopedEstimatorTrainingResult {
  if (dataset.samples.length < minSamples) {
    const reportMarkdown = [
      `# ${dataset.scope} Estimator Suite Report`,
      "",
      "학습을 건너뛰었습니다.",
      "",
      `- Parsed samples: ${dataset.samples.length.toLocaleString()}`,
      `- Required samples: ${minSamples.toLocaleString()}`,
      "",
      dataset.scope === "full-layer"
        ? "full-layer dataset은 SCALE-Sim full topology COMPUTE_REPORT row를 target으로 사용해야 합니다."
        : "tile-policy dataset은 tile micro-run × tile-count extrapolation을 target으로 사용해야 합니다.",
    ].join("\n");
    return {
      scope: dataset.scope,
      samples: dataset.samples.length,
      status: "skipped",
      reason: `Need at least ${minSamples} ${dataset.scope} samples; got ${dataset.samples.length}`,
      reportMarkdown,
    };
  }

  const model = trainEstimatorSuite(dataset.samples, options);
  const artifacts = buildEstimatorSuiteArtifacts(model, dataset.samples);
  return {
    scope: dataset.scope,
    samples: dataset.samples.length,
    status: "trained",
    model,
    artifacts,
    reportMarkdown: artifacts.reportMarkdown,
  };
}

function firstMape(result: ScopedEstimatorTrainingResult) {
  return result.model?.validationSuite[0]?.ensemble.learnedMapePct;
}

function combinedReport(
  datasets: ScopedEstimatorDatasetsResult,
  training: Record<EstimatorTargetScope, ScopedEstimatorTrainingResult>,
  readiness: Record<"merged" | EstimatorTargetScope, ReturnType<typeof assessEstimatorSuiteReadiness>>,
) {
  const rows = ESTIMATOR_TARGET_SCOPES.map((scope) => {
    const ds = datasets.scopes[scope];
    const tr = training[scope];
    const mape = firstMape(tr);
    return `| ${scope} | ${ds.summary.validSamples.toLocaleString()} | ${tr.status} | ${mape === undefined ? "-" : `${mape.toFixed(2)}%`} | ${tr.reason ?? ""} |`;
  });
  return [
    "# Scoped Estimator Suite Pipeline Report",
    "",
    "TileForge는 서로 다른 의미의 cycle target을 한 모델에 섞지 않도록 full-layer와 tile-policy 파이프라인을 분리합니다.",
    "",
    "## Scope 정의",
    "",
    "| Scope | Target | 주 사용처 | Tile feature 처리 |",
    "|---|---|---|---|",
    "| full-layer | SCALE-Sim full topology `COMPUTE_REPORT.csv` row cycle | 외부 검증, 전체 workload cycle 비교 | 학습 feature에서 canonical no-tiling으로 약화 |",
    "| tile-policy | tile micro-run × tile-count extrapolation | tile ranking, design-space/sweet spot 탐색 | tileM/N/K, padding, edge 정보를 강하게 사용 |",
    "",
    "## 결과 요약",
    "",
    "| Scope | Samples | Status | First split ensemble MAPE | Note |",
    "|---|---:|---|---:|---|",
    ...rows,
    "",
    "## 전체 병합 데이터셋",
    "",
    `- Merged samples: ${datasets.mergedSummary.validSamples.toLocaleString()}`,
    `- Target scopes: ${Object.entries(datasets.mergedSummary.targetScopes).map(([k, v]) => `${k}=${v}`).join(", ") || "none"}`,
    `- Merged readiness: ${readiness.merged.level} (${(readiness.merged.score * 100).toFixed(1)}%)`,
    "",
    datasets.warnings.length ? ["## 경고", "", ...datasets.warnings.map((w) => `- ${w}`)].join("\n") : "## 경고\n\n없음",
  ].join("\n");
}

export function buildScopedEstimatorPipeline(
  files: EstimatorDatasetInput[],
  options: TrainEstimatorSuiteOptions & { dedupe?: boolean; minSamplesPerScope?: number } = {},
): ScopedEstimatorPipelineResult {
  const datasets = buildScopedEstimatorDatasets(files, { dedupe: options.dedupe !== false });
  const minSamples = Math.max(1, Math.floor(options.minSamplesPerScope ?? 40));
  const training = Object.fromEntries(
    ESTIMATOR_TARGET_SCOPES.map((scope) => [scope, trainOneScope(datasets.scopes[scope], options, minSamples)]),
  ) as Record<EstimatorTargetScope, ScopedEstimatorTrainingResult>;
  const readiness = {
    merged: assessEstimatorSuiteReadiness(datasets.mergedSamples, {
      scope: "merged",
      minSamples,
      requireExplicitScope: true,
      requireMultipleArrays: true,
      requireMultipleDataflows: true,
    }),
    "full-layer": assessEstimatorSuiteReadiness(datasets.scopes["full-layer"].samples, {
      scope: "full-layer",
      minSamples,
      requireExplicitScope: true,
      requireMultipleArrays: true,
      requireMultipleDataflows: true,
      model: training["full-layer"].model,
    }),
    "tile-policy": assessEstimatorSuiteReadiness(datasets.scopes["tile-policy"].samples, {
      scope: "tile-policy",
      minSamples,
      requireExplicitScope: true,
      requireMultipleArrays: true,
      requireMultipleDataflows: true,
      model: training["tile-policy"].model,
    }),
  } satisfies Record<"merged" | EstimatorTargetScope, ReturnType<typeof assessEstimatorSuiteReadiness>>;
  const filesOut: Record<string, string> = {
    "datasets/merged/samples.csv": datasets.mergedCsv,
    "datasets/merged/report.md": datasets.mergedReportMarkdown,
    "datasets/merged/readiness.json": JSON.stringify(readiness.merged, null, 2),
    "datasets/merged/readiness.md": estimatorSuiteReadinessMarkdown(readiness.merged),
  };
  for (const scope of ESTIMATOR_TARGET_SCOPES) {
    const slug = scopeSlug(scope);
    const dataset = datasets.scopes[scope];
    filesOut[`datasets/${slug}/samples.csv`] = dataset.csv;
    filesOut[`datasets/${slug}/report.md`] = dataset.reportMarkdown;
    filesOut[`datasets/${slug}/readiness.json`] = JSON.stringify(readiness[scope], null, 2);
    filesOut[`datasets/${slug}/readiness.md`] = estimatorSuiteReadinessMarkdown(readiness[scope]);
    const trained = training[scope];
    filesOut[`estimator-suite/${slug}/report.md`] = trained.reportMarkdown;
    if (trained.artifacts) {
      filesOut[`estimator-suite/${slug}/model.json`] = trained.artifacts.modelJson;
      filesOut[`estimator-suite/${slug}/tree-residual-model.json`] = trained.artifacts.treeModelJson;
      filesOut[`estimator-suite/${slug}/neural-residual-model.json`] = trained.artifacts.neuralModelJson;
      filesOut[`estimator-suite/${slug}/validation.csv`] = trained.artifacts.validationCsv;
      filesOut[`estimator-suite/${slug}/predictions.csv`] = trained.artifacts.predictionsCsv;
    }
  }
  const combinedReportMarkdown = combinedReport(datasets, training, readiness);
  filesOut["estimator-suite/scoped-pipeline-report.md"] = combinedReportMarkdown;
  return { ...datasets, training, files: filesOut, combinedReportMarkdown };
}

export function splitEstimatorCsvByScope(csvText: string) {
  const rows = parseEstimatorCsv(csvText);
  return Object.fromEntries(
    ESTIMATOR_TARGET_SCOPES.map((scope) => [
      scope,
      toEstimatorCsv(rows.filter((row) => sampleScope(row) === scope) as unknown as Record<string, unknown>[]),
    ]),
  ) as Record<EstimatorTargetScope, string>;
}
