"use client";

import { useState } from "react";
import type { ChangeEvent } from "react";
import type { DownloadFn } from "./primitives";
import { MarkdownView, MiniField } from "./primitives";

export function EstimatorSuitePanel({
  csv,
  setCsv,
  presets = [],
  selectedPresetId,
  setSelectedPresetId,
  onApplyPreset,
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
  presets?: Array<{ id: string; name: string; description: string }>;
  selectedPresetId?: string;
  setSelectedPresetId?: (id: string) => void;
  onApplyPreset?: (id: string) => void;
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
  const [datasetFiles, setDatasetFiles] = useState<Array<{ name: string; text: string }>>([]);
  const [datasetTrainAfterImport, setDatasetTrainAfterImport] = useState(true);
  const model = result?.model;
  const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
  const sampleCount = model?.metadata?.samples;
  const queuedCount = Array.isArray(result?.queuedJobs) ? result.queuedJobs.length : 0;

  async function onDatasetFilesSelected(event: ChangeEvent<HTMLInputElement>) {
    const selected = Array.from(event.target.files ?? []);
    const loaded = await Promise.all(selected.map(async (file) => ({ name: file.name, text: await file.text() })));
    setDatasetFiles(loaded);
  }
  const datasetSummary = result?.summary;
  return (
    <div className="estimator-suite-panel">
      <div className="info-box">
        <b>Estimator Suite 자동화</b>
        <p className="small">
          웹에서 표본 계획을 만들고, 필요하면 각 표본을 full-pipeline 큐에 자동 등록합니다. 작업이 끝난 뒤 SCALE-Sim measuredCycles가 채워진 CSV를 사용해 Tree residual / Neural residual / Ensemble estimator를 학습합니다.
        </p>
      </div>



      <section className="suite-section" title="자주 쓰는 표본 계획과 학습 설정을 한 번에 적용합니다.">
        <h4>0. Estimator 프리셋</h4>
        <p className="small">Smoke/512개 테스트/4096개 본 실험/대량 CSV 학습 설정을 버튼 하나로 적용합니다. 프리셋은 표본 계획 값과 Tree/Neural 학습 설정을 함께 바꿉니다.</p>
        <div className="row2">
          <label className="mini-field">
            <span>프리셋</span>
            <select value={selectedPresetId ?? ""} onChange={(e) => setSelectedPresetId?.(e.target.value)}>
              {presets.map((preset) => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
            </select>
          </label>
          <div className="calibration-actions">
            <button className="secondary" onClick={() => selectedPresetId && onApplyPreset?.(selectedPresetId)} disabled={busy || !selectedPresetId}>프리셋 적용</button>
          </div>
        </div>
        {presets.find((preset) => preset.id === selectedPresetId)?.description && (
          <p className="small good">{presets.find((preset) => preset.id === selectedPresetId)?.description}</p>
        )}
      </section>

      <section className="suite-section" title="학습된 Estimator Suite 모델을 일반 TileForge estimator에 적용합니다.">
        <h4>1. 활성 Estimator Suite 적용</h4>
        <p className="small">활성 모델을 선택하면 일반 타일 ranking, 총 cycle, 보고서의 cycle 값이 analytical baseline 대신 learned ensemble 보정값을 사용합니다. 서버 full-pipeline 작업에도 같은 활성 모델이 적용됩니다.</p>
        <div className="calibration-actions">
          <button className="secondary" onClick={onRefreshModels} disabled={busy}>모델 목록 새로고침</button>
          <button className="secondary" onClick={onClearActiveModel} disabled={busy || !active?.runId}>활성 모델 해제</button>
        </div>
        {active?.runId ? (
          <p className="small good">현재 활성 모델: <code>{active.runId}</code>{active.model?.recommended ? ` (${active.model.recommended})` : ""}</p>
        ) : (
          <p className="small warn">활성 Estimator Suite 모델이 없습니다. 현재 미리보기는 analytical estimator 기준입니다.</p>
        )}
        {Array.isArray(models) && models.length > 0 ? (
          <div className="table-wrap">
            <table className="mini-table">
              <thead><tr><th>상태</th><th>runId</th><th>samples</th><th>추천</th><th>생성 시각</th><th>동작</th></tr></thead>
              <tbody>
                {models.slice(0, 12).map((m: any) => (
                  <tr key={m.runId}>
                    <td>{m.runId === active?.runId || m.active ? "활성" : "-"}</td>
                    <td><code>{m.runId}</code></td>
                    <td>{Number(m.samples ?? 0).toLocaleString()}</td>
                    <td>{m.recommended ?? "-"}</td>
                    <td>{m.createdAt ?? "-"}</td>
                    <td><button className="secondary" onClick={() => onActivateModel(m.runId)} disabled={busy || m.runId === active?.runId}>적용</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="small">아직 저장된 estimator-suite-model.json이 없습니다. 학습을 먼저 실행하세요.</p>
        )}
      </section>

      <section className="suite-section" title="수만 개 시뮬레이션 표본을 만들 때 사용할 파라미터 범위입니다.">
        <h4>2. 표본 계획 자동 생성</h4>
        <p className="small">범위 문법: <code>시작:끝:간격</code> 또는 쉼표 목록입니다. 예: <code>64:1024:64</code>, <code>64,128,256</code>, array는 <code>64x64,128x128</code>.</p>
        <div className="row4">
          <MiniField label="M range" tip="GEMM M 차원 범위입니다."><input value={planOptions.mRange} onChange={(e) => updatePlanOptions({ mRange: e.target.value })} /></MiniField>
          <MiniField label="N range" tip="GEMM N 차원 범위입니다."><input value={planOptions.nRange} onChange={(e) => updatePlanOptions({ nRange: e.target.value })} /></MiniField>
          <MiniField label="K range" tip="GEMM K 차원 범위입니다."><input value={planOptions.kRange} onChange={(e) => updatePlanOptions({ kRange: e.target.value })} /></MiniField>
          <MiniField label="max samples" tip="생성할 최대 표본 수입니다. 너무 크게 잡으면 큐가 길어집니다."><input type="number" value={planOptions.maxSamples} onChange={(e) => updatePlanOptions({ maxSamples: +e.target.value })} /></MiniField>
        </div>
        <div className="row4">
          <MiniField label="tileM" tip="tileM 후보 범위/목록입니다."><input value={planOptions.tileMRange} onChange={(e) => updatePlanOptions({ tileMRange: e.target.value })} /></MiniField>
          <MiniField label="tileN" tip="tileN 후보 범위/목록입니다."><input value={planOptions.tileNRange} onChange={(e) => updatePlanOptions({ tileNRange: e.target.value })} /></MiniField>
          <MiniField label="tileK" tip="tileK 후보 범위/목록입니다."><input value={planOptions.tileKRange} onChange={(e) => updatePlanOptions({ tileKRange: e.target.value })} /></MiniField>
          <MiniField label="topK/shape" tip="각 shape에서 estimator score 기준 상위 몇 개 tile을 표본으로 고를지입니다."><input type="number" value={planOptions.topKPerShape} onChange={(e) => updatePlanOptions({ topKPerShape: +e.target.value })} /></MiniField>
        </div>
        <div className="row4">
          <MiniField label="arrays" tip="arrayRows x arrayCols 목록입니다. 예: 64x64,128x128,128x256"><input value={planOptions.arrayRange} onChange={(e) => updatePlanOptions({ arrayRange: e.target.value })} /></MiniField>
          <MiniField label="SRAM KB" tip="SRAM 크기 범위/목록입니다."><input value={planOptions.sramKbRange} onChange={(e) => updatePlanOptions({ sramKbRange: e.target.value })} /></MiniField>
          <MiniField label="dataflows" tip="WS,OS,IS 중 사용할 데이터플로우 목록입니다."><input value={planOptions.dataflows} onChange={(e) => updatePlanOptions({ dataflows: e.target.value })} /></MiniField>
          <MiniField label="queue limit" tip="표본 계획 중 실제로 큐에 넣을 최대 작업 수입니다."><input type="number" value={planOptions.queueLimit} onChange={(e) => updatePlanOptions({ queueLimit: +e.target.value })} /></MiniField>
        </div>
        <label className="check" title="켜면 현재 입력 패널의 workload shape도 표본 계획에 포함합니다.">
          <input type="checkbox" checked={Boolean(planOptions.includeCurrentShapes)} onChange={(e) => updatePlanOptions({ includeCurrentShapes: e.target.checked })} /> 현재 workload shape 포함
        </label>
        <div className="calibration-actions">
          <button className="secondary" onClick={onPlan} disabled={busy}>{busy ? "생성 중..." : "범위로 표본 CSV 생성"}</button>
          <button onClick={onQueuePlan} disabled={busy}>{busy ? "등록 중..." : "표본을 full-pipeline 큐에 등록"}</button>
        </div>
        {queuedCount > 0 && <p className="small good">최근 표본 계획에서 작업 {queuedCount.toLocaleString()}개를 큐에 등록했습니다.</p>}
      </section>

      <section className="suite-section" title="여러 CSV 파일을 업로드해 하나의 대형 학습 dataset으로 병합하고 바로 학습합니다.">
        <h4>3. 대량 CSV Dataset Manager</h4>
        <p className="small">이미 수천~수만 개 SCALE-Sim 결과 CSV가 있다면 여기에 여러 파일을 한 번에 업로드하세요. 자동으로 병합, 중복 제거, measuredCycles/estimatorCycles 유효성 검사, 분포 요약을 수행하고 원하면 바로 Estimator Suite 학습까지 실행합니다.</p>
        <div className="row2">
          <label className="mini-field">
            <span>CSV 파일 업로드</span>
            <input type="file" accept=".csv,text/csv" multiple onChange={(e) => void onDatasetFilesSelected(e)} />
          </label>
          <label className="check" title="켜면 업로드 후 병합 dataset으로 즉시 Tree/Neural/Ensemble 학습까지 실행합니다.">
            <input type="checkbox" checked={datasetTrainAfterImport} onChange={(e) => setDatasetTrainAfterImport(e.target.checked)} /> 업로드 후 즉시 학습
          </label>
        </div>
        {datasetFiles.length > 0 ? (
          <p className="small good">선택된 CSV: {datasetFiles.length.toLocaleString()}개, 총 {(datasetFiles.reduce((sum, f) => sum + f.text.length, 0) / 1024).toFixed(1)} KiB</p>
        ) : (
          <p className="small warn">아직 선택된 CSV가 없습니다. 여러 결과 CSV를 선택한 뒤 아래 버튼을 누르세요.</p>
        )}
        <div className="calibration-actions">
          <button onClick={() => onImportDataset(datasetFiles, datasetTrainAfterImport)} disabled={busy || datasetFiles.length === 0}>
            {datasetTrainAfterImport ? "CSV 병합 후 자동 학습" : "CSV 병합/검증만 실행"}
          </button>
          {datasetFiles.length > 0 && <button className="secondary" onClick={() => setDatasetFiles([])} disabled={busy}>선택 해제</button>}
        </div>
        {datasetSummary && (
          <div className="table-wrap">
            <table className="mini-table">
              <thead><tr><th>파일</th><th>입력 row</th><th>병합 row</th><th>유효 sample</th><th>중복 제거</th><th>measured 누락</th></tr></thead>
              <tbody>
                <tr>
                  <td>{Number(datasetSummary.files ?? 0).toLocaleString()}</td>
                  <td>{Number(datasetSummary.inputRows ?? 0).toLocaleString()}</td>
                  <td>{Number(datasetSummary.mergedRows ?? 0).toLocaleString()}</td>
                  <td>{Number(datasetSummary.validSamples ?? 0).toLocaleString()}</td>
                  <td>{Number(datasetSummary.duplicatesRemoved ?? 0).toLocaleString()}</td>
                  <td>{Number(datasetSummary.missingMeasuredCycles ?? 0).toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="suite-section" title="학습 모델 하이퍼파라미터입니다.">
        <h4>4. 학습 설정</h4>
        <div className="row4">
          <MiniField label="topK" tip="현재 설정 기반 단순 설계 CSV에 포함할 상위 tile 후보 개수입니다.">
            <input type="number" value={options.topK} onChange={(e) => updateOptions({ topK: +e.target.value })} />
          </MiniField>
          <MiniField label="trees" tip="Tree residual ensemble의 tree 개수입니다.">
            <input type="number" value={options.trees} onChange={(e) => updateOptions({ trees: +e.target.value })} />
          </MiniField>
          <MiniField label="maxDepth" tip="Tree residual 모델의 최대 깊이입니다.">
            <input type="number" value={options.maxDepth} onChange={(e) => updateOptions({ maxDepth: +e.target.value })} />
          </MiniField>
          <MiniField label="minLeaf" tip="Tree leaf 최소 sample 수입니다.">
            <input type="number" value={options.minLeaf} onChange={(e) => updateOptions({ minLeaf: +e.target.value })} />
          </MiniField>
        </div>
        <div className="row4">
          <MiniField label="hidden" tip="Neural residual estimator의 hidden unit 개수입니다.">
            <input type="number" value={options.hiddenUnits} onChange={(e) => updateOptions({ hiddenUnits: +e.target.value })} />
          </MiniField>
          <MiniField label="epochs" tip="Neural residual estimator 학습 epoch 수입니다.">
            <input type="number" value={options.epochs} onChange={(e) => updateOptions({ epochs: +e.target.value })} />
          </MiniField>
          <MiniField label="maxFinalTrain" tip="최종 모델 학습에 사용할 최대 sample 수입니다. 검증에는 전체 split을 사용하되 최종 학습 시간을 제한할 수 있습니다.">
            <input type="number" value={options.maxFinalTrainSamples} onChange={(e) => updateOptions({ maxFinalTrainSamples: +e.target.value })} />
          </MiniField>
          <MiniField label="splits" tip="검증 split 목록입니다. random,workload,array,dataflow,large-shape를 사용할 수 있습니다.">
            <input value={options.splits} onChange={(e) => updateOptions({ splits: e.target.value })} />
          </MiniField>
        </div>
      </section>

      <div className="calibration-actions">
        <button className="secondary" onClick={onDesign} disabled={busy}>{busy ? "실행 중..." : "현재 설정으로 설계 CSV 생성"}</button>
        <button className="secondary" onClick={onCollectJobs} disabled={busy}>{busy ? "수집 중..." : "완료 작업에서 measuredCycles 채우기"}</button>
        <button onClick={onRun} disabled={busy}>{busy ? "학습 중..." : "CSV로 Estimator Suite 학습"}</button>
        <button className="secondary" onClick={() => download("estimator-suite-input.csv", csv, "text/csv")}>입력 CSV 다운로드</button>
        {result?.reportMarkdown && <button className="secondary" onClick={() => download("estimator-suite-report.md", result.reportMarkdown, "text/markdown")}>리포트 다운로드</button>}
        {result?.validationCsv && <button className="secondary" onClick={() => download("estimator-suite-validation.csv", result.validationCsv, "text/csv")}>검증 CSV 다운로드</button>}
        {result?.predictionsCsv && <button className="secondary" onClick={() => download("estimator-suite-predictions.csv", result.predictionsCsv, "text/csv")}>예측 CSV 다운로드</button>}
      </div>
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
            samples {Number(sampleCount ?? 0).toLocaleString()}개, 추천 모델 <b>{model.recommended}</b>, weight = analytical {model.weights.analytical.toFixed(3)}, tree {model.weights.tree.toFixed(3)}, neural {model.weights.neural.toFixed(3)}
          </p>
        </div>
      )}
      {result?.reportMarkdown && <MarkdownView text={result.reportMarkdown} />}
      {artifacts.length > 0 && (
        <div className="artifact-list">
          <h4>서버 저장 artifact</h4>
          <ul>
            {artifacts.map((a: any) => <li key={a.name}><code>{a.name}</code> <span className="small">{a.path}</span></li>)}
          </ul>
        </div>
      )}
    </div>
  );
}
