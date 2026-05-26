"use client";

import type { DownloadFn } from "./primitives";
import { MarkdownView } from "./primitives";
import { EstimatorDatasetPanel } from "./EstimatorDatasetPanel";
import { EstimatorSuiteModelPanel } from "./EstimatorSuiteModelPanel";
import { EstimatorSuitePresetPanel } from "./EstimatorSuitePresetPanel";
import { EstimatorSuiteRunActions } from "./EstimatorSuiteRunActions";
import { EstimatorSuiteSamplingPlanPanel } from "./EstimatorSuiteSamplingPlanPanel";
import { EstimatorTrainingSettingsPanel } from "./EstimatorTrainingSettingsPanel";

export function EstimatorSuitePanel({
  csv,
  setCsv,
  presets = [],
  selectedPresetId,
  setSelectedPresetId,
  onApplyPreset,
  presetName,
  setPresetName,
  onSavePreset,
  onDeletePreset,
  options,
  updateOptions,
  planOptions,
  updatePlanOptions,
  result,
  busy,
  models,
  active,
  onRefreshModels,
  onActivateModel,
  onClearActiveModel,
  onDesign,
  onPlan,
  onQueuePlan,
  onCollectJobs,
  onRun,
  onImportDataset,
  download,
}: {
  csv: string;
  setCsv: (value: string) => void;
  presets?: Array<{ id: string; name: string; description: string; source?: string }>;
  selectedPresetId?: string;
  setSelectedPresetId?: (id: string) => void;
  onApplyPreset?: (id: string) => void;
  presetName?: string;
  setPresetName?: (name: string) => void;
  onSavePreset?: () => void;
  onDeletePreset?: (id: string) => void;
  options: any;
  updateOptions: (patch: any) => void;
  planOptions: any;
  updatePlanOptions: (patch: any) => void;
  result: any | null;
  busy: boolean;
  models: any[];
  active: { runId?: string; model?: any } | null;
  onRefreshModels: () => void;
  onActivateModel: (runId: string) => void;
  onClearActiveModel: () => void;
  onDesign: () => void;
  onPlan: () => void;
  onQueuePlan: () => void;
  onCollectJobs: () => void;
  onRun: () => void;
  onImportDataset: (files: Array<{ name: string; text: string }>, train: boolean) => void;
  download: DownloadFn;
}) {
  const model = result?.model;
  const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
  const sampleCount = model?.metadata?.samples;
  const queuedCount = Array.isArray(result?.queuedJobs) ? result.queuedJobs.length : 0;

  return (
    <div className="estimator-suite-panel">
      <div className="info-box">
        <b>Estimator Suite 자동화</b>
        <p className="small">
          웹에서 표본 계획을 만들고, 필요하면 각 표본을 full-pipeline 큐에 자동 등록합니다. 작업이 끝난 뒤 SCALE-Sim measuredCycles가 채워진 CSV를 사용해 Tree residual / Neural residual / Ensemble estimator를 학습합니다.
        </p>
      </div>

      <EstimatorSuitePresetPanel
        presets={presets}
        selectedPresetId={selectedPresetId}
        setSelectedPresetId={setSelectedPresetId}
        presetName={presetName}
        setPresetName={setPresetName}
        busy={busy}
        onApplyPreset={onApplyPreset}
        onSavePreset={onSavePreset}
        onDeletePreset={onDeletePreset}
      />

      <EstimatorSuiteModelPanel
        models={models}
        active={active}
        busy={busy}
        onRefreshModels={onRefreshModels}
        onActivateModel={onActivateModel}
        onClearActiveModel={onClearActiveModel}
      />

      <EstimatorSuiteSamplingPlanPanel
        planOptions={planOptions}
        updatePlanOptions={updatePlanOptions}
        busy={busy}
        queuedCount={queuedCount}
        onPlan={onPlan}
        onQueuePlan={onQueuePlan}
      />

      <EstimatorDatasetPanel busy={busy} result={result} onImportDataset={onImportDataset} />

      <EstimatorTrainingSettingsPanel options={options} updateOptions={updateOptions} />

      <EstimatorSuiteRunActions
        busy={busy}
        csv={csv}
        result={result}
        onDesign={onDesign}
        onCollectJobs={onCollectJobs}
        onRun={onRun}
        download={download}
      />

      <h4>학습/설계 CSV</h4>
      <textarea
        title="열: id,model,opName,arrayRows,arrayCols,sramKB,frequencyMHz,dataflow,dtypeBytes,m,n,k,tileM,tileN,tileK,estimatorCycles,measuredCycles"
        value={csv}
        onChange={(e) => setCsv(e.target.value)}
        style={{ minHeight: 220 }}
      />

      {model && (
        <div className="info-box">
          <b>최근 학습 결과</b>
          <p className="small">
            samples {Number(sampleCount ?? 0).toLocaleString()}개, 추천 모델 <b>{model.recommended}</b>, {model.metadata?.featureDomain?.primaryTargetScope ? `target=${model.metadata.featureDomain.primaryTargetScope}, ` : ""}
            {model.blend?.mode ? `blend=${model.blend.mode}, ` : ""}
            {model.blend?.adaptiveWeights ? `adaptive-stack=${model.blend.adaptiveWeights.buckets.length} buckets, ` : ""}
            {model.calibration?.mode ? `calibration=${model.calibration.mode}, buckets=${model.calibration.buckets.length}, regime=${model.calibration.buckets.filter((b: { kind: string }) => b.kind.includes("regime")).length}, trend=${model.calibration.scaleTrend?.blend?.toFixed(2) ?? "off"}, resource=${model.calibration.resourceTrend?.blend?.toFixed(2) ?? "off"}, tiling=${model.calibration.tilingTrend?.blend?.toFixed(2) ?? "off"}, local=${model.calibration.local?.prototypes.length ?? 0}, ` : ""}
            weight = analytical {model.weights.analytical.toFixed(3)}, tree {model.weights.tree.toFixed(3)}, neural {model.weights.neural.toFixed(3)}, direct {(model.weights.directNeural ?? 0).toFixed(3)}
          </p>
        </div>
      )}

      {result?.reportMarkdown && <MarkdownView text={result.reportMarkdown} />}
      {artifacts.length > 0 && (
        <div className="artifact-list">
          <h4>서버 저장 artifact</h4>
          <ul>
            {artifacts.map((a: any) => (
              <li key={a.name}><code>{a.name}</code> <span className="small">{a.path}</span></li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
