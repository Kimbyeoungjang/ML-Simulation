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
      <button className="secondary" title="현재 화면 설정으로 학습 입력 CSV 초안을 생성합니다." onClick={onDesign} disabled={busy}>{busy ? "실행 중..." : "현재 설정으로 설계 CSV 생성"}</button>
      <button className="secondary" title="완료된 full-pipeline 작업 artifact에서 measuredCycles를 찾아 CSV에 채웁니다." onClick={onCollectJobs} disabled={busy}>{busy ? "수집 중..." : "완료 작업에서 measuredCycles 채우기"}</button>
      <button title="현재 CSV로 Tree/Neural/Ensemble Estimator Suite 학습을 실행합니다." onClick={onRun} disabled={busy}>{busy ? "학습 중..." : "CSV로 Estimator Suite 학습"}</button>
      <button className="secondary" title="현재 학습/설계 CSV 입력을 파일로 저장합니다." onClick={() => download("estimator-suite-input.csv", csv, "text/csv")}>입력 CSV 다운로드</button>
      {result?.reportMarkdown && <button className="secondary" title="최근 학습 결과 리포트를 Markdown 파일로 저장합니다." onClick={() => download("estimator-suite-report.md", result.reportMarkdown, "text/markdown")}>리포트 다운로드</button>}
      {result?.validationCsv && <button className="secondary" title="검증 split별 오차와 모델 비교 결과 CSV를 저장합니다." onClick={() => download("estimator-suite-validation.csv", result.validationCsv, "text/csv")}>검증 CSV 다운로드</button>}
      {result?.predictionsCsv && <button className="secondary" title="sample별 예측값과 실제 measuredCycles 비교 CSV를 저장합니다." onClick={() => download("estimator-suite-predictions.csv", result.predictionsCsv, "text/csv")}>예측 CSV 다운로드</button>}
    </div>
  );
}
