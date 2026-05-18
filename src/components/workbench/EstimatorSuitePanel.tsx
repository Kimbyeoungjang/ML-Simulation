"use client";

import type { DownloadFn } from "./primitives";
import { MarkdownView, MiniField } from "./primitives";

export function EstimatorSuitePanel({
  csv,
  setCsv,
  options,
  updateOptions,
  planOptions,
  updatePlanOptions,
  result,
  busy,
  onDesign,
  onPlan,
  onQueuePlan,
  onRun,
  download,
}: {
  csv: string;
  setCsv: (value: string) => void;
  options: any;
  updateOptions: (patch: any) => void;
  planOptions: any;
  updatePlanOptions: (patch: any) => void;
  result: any | null;
  busy: boolean;
  onDesign: () => void;
  onPlan: () => void;
  onQueuePlan: () => void;
  onRun: () => void;
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

      <section className="suite-section" title="수만 개 시뮬레이션 표본을 만들 때 사용할 파라미터 범위입니다.">
        <h4>1. 표본 계획 자동 생성</h4>
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

      <section className="suite-section" title="학습 모델 하이퍼파라미터입니다.">
        <h4>2. 학습 설정</h4>
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
