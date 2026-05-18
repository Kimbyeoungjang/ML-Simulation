"use client";

import type { DownloadFn } from "./primitives";
import { MarkdownView, MiniField } from "./primitives";

export function EstimatorSuitePanel({
  csv,
  setCsv,
  options,
  updateOptions,
  result,
  busy,
  onDesign,
  onRun,
  download,
}: {
  csv: string;
  setCsv: (value: string) => void;
  options: any;
  updateOptions: (patch: any) => void;
  result: any | null;
  busy: boolean;
  onDesign: () => void;
  onRun: () => void;
  download: DownloadFn;
}) {
  const model = result?.model;
  const artifacts = Array.isArray(result?.artifacts) ? result.artifacts : [];
  const sampleCount = model?.metadata?.samples;
  return (
    <div className="estimator-suite-panel">
      <div className="info-box">
        <b>Estimator Suite 자동화</b>
        <p className="small">
          웹에서 설계 CSV를 만들고, SCALE-Sim 결과를 measuredCycles에 채운 뒤 Tree residual / Neural residual / Ensemble estimator를 학습합니다. 긴 대량 실험 자체는 기존 job queue로 돌리고, 여기서는 누적된 결과 CSV를 학습 데이터로 사용합니다.
        </p>
      </div>
      <div className="row4">
        <MiniField label="topK" tip="각 op에서 학습용 설계 CSV에 포함할 상위 tile 후보 개수입니다.">
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
      <div className="calibration-actions">
        <button onClick={onDesign} disabled={busy}>{busy ? "실행 중..." : "현재 설정으로 설계 CSV 생성"}</button>
        <button className="secondary" onClick={onRun} disabled={busy}>{busy ? "학습 중..." : "CSV로 Estimator Suite 학습"}</button>
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

