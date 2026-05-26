"use client";

import type { DownloadFn } from "./primitives";

export function EstimatorSuiteRunActions({
  busy,
  csv,
  result,
  onDesign,
  onCollectJobs,
  onRun,
  download,
}: {
  busy: boolean;
  csv: string;
  result: any | null;
  onDesign: () => void;
  onCollectJobs: () => void;
  onRun: () => void;
  download: DownloadFn;
}) {
  return (
    <div className="estimator-actions">
      <button className="secondary" onClick={onDesign} disabled={busy}>{busy ? "실행 중..." : "현재 설정으로 설계 CSV 생성"}</button>
      <button className="secondary" onClick={onCollectJobs} disabled={busy}>{busy ? "수집 중..." : "완료 작업에서 measuredCycles 채우기"}</button>
      <button onClick={onRun} disabled={busy}>{busy ? "학습 중..." : "CSV로 Estimator Suite 학습"}</button>
      <button className="secondary" onClick={() => download("estimator-suite-input.csv", csv, "text/csv")}>입력 CSV 다운로드</button>
      {result?.reportMarkdown && <button className="secondary" onClick={() => download("estimator-suite-report.md", result.reportMarkdown, "text/markdown")}>리포트 다운로드</button>}
      {result?.validationCsv && <button className="secondary" onClick={() => download("estimator-suite-validation.csv", result.validationCsv, "text/csv")}>검증 CSV 다운로드</button>}
      {result?.predictionsCsv && <button className="secondary" onClick={() => download("estimator-suite-predictions.csv", result.predictionsCsv, "text/csv")}>예측 CSV 다운로드</button>}
    </div>
  );
}
