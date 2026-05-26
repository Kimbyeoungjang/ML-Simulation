"use client";

import { MiniField } from "./primitives";

export function EstimatorSuiteSamplingPlanPanel({
  planOptions,
  updatePlanOptions,
  busy,
  queuedCount,
  onPlan,
  onQueuePlan,
}: {
  planOptions: any;
  updatePlanOptions: (patch: any) => void;
  busy: boolean;
  queuedCount: number;
  onPlan: () => void;
  onQueuePlan: () => void;
}) {
  return (
    <section className="suite-section" title="수만 개 시뮬레이션 표본을 만들 때 사용할 파라미터 범위입니다.">
      <h4>2. 표본 계획 자동 생성</h4>
      <p className="small">
        범위 문법: <code>시작:끝:간격</code> 또는 쉼표 목록입니다. 예: <code>64:1024:64</code>, <code>64,128,256</code>, array는 <code>64x64,128x128</code>.
      </p>
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
      <div className="estimator-actions">
        <button className="secondary" onClick={onPlan} disabled={busy}>{busy ? "생성 중..." : "범위로 표본 CSV 생성"}</button>
        <button onClick={onQueuePlan} disabled={busy}>{busy ? "등록 중..." : "표본을 full-pipeline 큐에 등록"}</button>
      </div>
      {queuedCount > 0 && <p className="small good">최근 표본 계획에서 작업 {queuedCount.toLocaleString()}개를 큐에 등록했습니다.</p>}
    </section>
  );
}
