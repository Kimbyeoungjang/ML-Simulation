"use client";

import { useEffect, useMemo, useState } from "react";
import {
  bestDesignRow,
  bestDesignRowsByAxis,
  bestRiskAdjustedDesignRow,
  buildDesignSpaceRows,
  buildDesignSpaceSvg,
  exportValidationPlanCsv,
  exportValidationPlanJson,
  niceNumber,
  paretoDesignRows,
  validationPlanRows,
  type DesignMetric,
} from "@/lib/designSpace";
import type { DownloadFn } from "./primitives";
import { ActionButton } from "./primitives";
import { Metric } from "./MetricCard";

export function DesignSpacePanel({
  source,
  activeEstimatorSuite,
  designMetric,
  chartZoom,
  download,
}: {
  source: any;
  activeEstimatorSuite?: any | null;
  designMetric: DesignMetric;
  chartZoom: number;
  download: DownloadFn;
}) {
  const [designRows, setDesignRows] = useState<any[]>([]);
  const [designPending, setDesignPending] = useState(false);
  const designSourceKey = useMemo(
    () =>
      JSON.stringify({
        request: source?.request,
        summary: source?.summary,
        suite: activeEstimatorSuite?.runId,
      }),
    [source, activeEstimatorSuite?.runId],
  );

  useEffect(() => {
    let cancelled = false;
    setDesignPending(true);
    const timer = window.setTimeout(() => {
      try {
        const rows = buildDesignSpaceRows(source, activeEstimatorSuite);
        if (!cancelled) setDesignRows(rows);
      } finally {
        if (!cancelled) setDesignPending(false);
      }
    }, 20);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [designSourceKey, source, activeEstimatorSuite]);

  const designSvg = useMemo(
    () => (designRows.length ? buildDesignSpaceSvg(designRows, designMetric) : ""),
    [designRows, designMetric],
  );
  const designBest = useMemo(() => bestDesignRow(designRows), [designRows]);
  const designPareto = useMemo(() => paretoDesignRows(designRows), [designRows]);
  const designRiskBest = useMemo(() => bestRiskAdjustedDesignRow(designRows), [designRows]);
  const designValidationPlan = useMemo(() => validationPlanRows(designRows, 5), [designRows]);
  const designValidationRows = designValidationPlan.map((item) => item.row);
  const bestByAxis = useMemo(() => bestDesignRowsByAxis(designRows), [designRows]);

  return (
    <>
      <p className="small">
        TPU 배열/클럭/SRAM/DRAM bandwidth를 변화시키는 하드웨어 축과, 고정 하드웨어에서 M/N/K를 변화시키는 워크로드 축을 같은 기준으로 그립니다. SRAM 축은 “최소 안전 용량”, DRAM 축은 “대역폭 knee”를 찾도록 저용량/저대역 구간까지 함께 평가합니다. M/N/K 축은 총 cycle이 아니라 ops/cycle 기준으로 정규화합니다. 활성 Estimator Suite가 full-layer target일 때만 hardware-design cycle 보정에 사용하고, tile-policy 모델은 ranking 보조로만 사용합니다.
      </p>
      {designPending && (
        <div className="info-box">
          <b>Design-space 계산 중</b>
          <p className="small">그래프 탭 진입 후 UI가 멈추지 않도록 백그라운드 tick에서 sweep을 계산합니다.</p>
        </div>
      )}
      <div className="graph-actions">
        <ActionButton tip="하드웨어/워크로드 sweet-spot 그래프를 SVG로 다운로드합니다." onClick={() => download("design-space-sweet-spots.svg", designSvg, "image/svg+xml")}>
          Design-space SVG 다운로드
        </ActionButton>
        <ActionButton tip="다음 SCALE-Sim 검증 추천 후보를 CSV로 저장합니다. 이 후보를 검증한 뒤 training CSV에 추가하면 estimator 재보정에 바로 사용할 수 있습니다." onClick={() => download("design-space-validation-plan.csv", exportValidationPlanCsv(designRows, 5), "text/csv")}>
          검증 후보 CSV 다운로드
        </ActionButton>
        <ActionButton tip="검증 후보와 선정 이유를 JSON으로 저장합니다. 자동화 스크립트에서 읽기 쉽도록 rank, factor, uncertainty, rationale을 포함합니다." onClick={() => download("design-space-validation-plan.json", exportValidationPlanJson(designRows, 5), "application/json")}>
          검증 후보 JSON 다운로드
        </ActionButton>
      </div>
      {designBest && (
        <div className="cards graph-summary-cards">
          <Metric title="전체 최상위 sweet spot" value={`${designBest.label}`} tip="speedup·throughput·score가 가장 많이 겹치는 consensus sweet spot 후보입니다." />
          <Metric title="Speedup" value={`${niceNumber(designBest.speedup)}×`} tip="workload 크기가 달라도 비교 가능하도록 ops/cycle 기준으로 정규화한 개선 배율입니다." />
          <Metric title="예상 TOPS" value={niceNumber(designBest.throughput)} tip="GEMM 연산량과 cycle/frequency로 계산한 대략적 throughput입니다." />
          <Metric title="Recommendation" value={niceNumber(designBest.recommendationScore)} tip="Consensus, ROI, 예측 confidence를 섞은 최종 추천 점수입니다. 너무 비싼 하드웨어 확장이나 학습 범위 밖 extrapolation을 과도하게 추천하지 않도록 보정합니다." />
          <Metric title="Risk-adjusted" value={designRiskBest ? `${designRiskBest.label} / ${niceNumber(designRiskBest.riskAdjustedRecommendationScore)}` : "-"} tip="불확실성까지 감안한 보수적 추천 후보입니다. 상위 후보들의 오차 범위가 겹칠 때 이 값을 우선 확인합니다." />
          <Metric title="Uncertainty" value={`±${designBest.uncertaintyPct.toFixed(1)}%`} tip="prediction confidence, SRAM overflow, 활용률, 확장 정도를 바탕으로 한 design-space용 예상 오차 범위입니다." />
          <Metric title="Consensus / ROI" value={`${niceNumber(designBest.agreementScore)} / ${niceNumber(designBest.roiScore)}`} tip="Consensus는 여러 성능 지표의 겹침, ROI는 비용 대비 추천 강도입니다." />
          <Metric title="Prediction confidence" value={`${((designBest.predictionConfidence ?? 1) * 100).toFixed(0)}%`} tip="활성 Estimator Suite 기준 학습 domain 안쪽인지 나타냅니다. analytical-only 실행은 100%로 표시합니다." />
          <Metric title="검증 추천 후보" value={`${designValidationRows.length}개`} tip="SCALE-Sim으로 검증하면 학습 효과가 클 것으로 추정되는 active-learning 후보 수입니다." />
          <Metric title="Pareto 후보" value={`${designPareto.length}개`} tip="speedup/throughput/score/cost 기준에서 지배되지 않는 설계 후보 수입니다." />
        </div>
      )}
      <div className="chart-scroll">
        <div className="chart-svg" style={{ transform: `scale(${chartZoom})`, transformOrigin: "top left", marginBottom: chartZoom > 1 ? `${(chartZoom - 1) * 180}px` : undefined }} dangerouslySetInnerHTML={{ __html: designSvg }} />
      </div>
      <h3>축별 핵심 sweet spot</h3>
      <table className="compact-table sweetspot-table">
        <thead>
          <tr>
            <th>축</th>
            <th>권장값</th>
            <th>의미</th>
            <th>Speedup</th>
            <th>Cycle</th>
            <th>Risk</th>
            <th>주의</th>
          </tr>
        </thead>
        <tbody>
          {bestByAxis.map((r: any) => {
            const axisMeaning: Record<string, string> = {
              array: "PE 수 확장 효율",
              frequency: "클럭 향상 효율",
              sram: "최소 안전 SRAM",
              dram: "대역폭 knee",
              "shape-m": "M 변화 시 ops/cycle",
              "shape-n": "N 변화 시 ops/cycle",
              "shape-k": "K 변화 시 ops/cycle",
            };
            const notes = [
              r.isKnee ? "knee" : "",
              r.sramOverflowRatio > 0 ? "SRAM overflow" : "",
              r.outOfDomain ? "OOD" : "",
            ].filter(Boolean).join(" · ");
            return (
              <tr key={r.axis}>
                <td>{r.axis}</td>
                <td>{r.label}</td>
                <td>{axisMeaning[r.axis] ?? "sweet spot"}</td>
                <td>{niceNumber(r.speedup)}×</td>
                <td>{Math.round(r.totalCycles).toLocaleString()}</td>
                <td>±{r.uncertaintyPct.toFixed(1)}%</td>
                <td>{notes || "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {designValidationRows.length > 0 && (
        <details className="inline-details">
          <summary>다음 SCALE-Sim 검증 추천 후보 보기</summary>
          <h3>다음 SCALE-Sim 검증 추천 후보</h3>
          <p className="small">
            검증 우선순위는 예측 불확실성, 학습 domain 밖 여부, 추천 잠재력, SRAM overflow, knee 여부를 섞어 계산합니다. 이 후보부터 실제 SCALE-Sim을 돌려 training CSV에 추가하면 estimator 보정 효과가 큽니다.
          </p>
          <table className="compact-table">
            <thead>
              <tr>
                <th>순위</th>
                <th>축</th>
                <th>후보</th>
                <th>Selection</th>
                <th>Validate</th>
                <th>Unc.</th>
                <th>Conf.</th>
                <th>Risk speedup</th>
                <th>Risk rec.</th>
                <th>선정 이유</th>
              </tr>
            </thead>
            <tbody>
              {designValidationPlan.map((item: any) => {
                const r = item.row;
                return (
                  <tr key={`${r.axis}-${r.value}-${item.rank}`}>
                    <td>{item.rank}</td>
                    <td>{r.axis}</td>
                    <td>{r.label}</td>
                    <td>{niceNumber(item.selectionScore)}</td>
                    <td>{niceNumber(r.validationPriority)}</td>
                    <td>±{r.uncertaintyPct.toFixed(1)}%</td>
                    <td>{((r.predictionConfidence ?? 1) * 100).toFixed(0)}%{r.outOfDomain ? "*" : ""}</td>
                    <td>{niceNumber(r.riskAdjustedSpeedup)}×</td>
                    <td>{niceNumber(r.riskAdjustedRecommendationScore)}</td>
                    <td>{item.rationale}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      )}
    </>
  );
}
