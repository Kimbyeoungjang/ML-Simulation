import { Metric } from "@/components/workbench/resultTabs";
import { fmt } from "@/lib/math";
import type { ResultsEstimateView } from "./resultsPanelTypes";

export function ResultsSummaryCards({ estimate }: { estimate: ResultsEstimateView }) {
  const { result, uncertainty, confidence, confidenceSource } = estimate;
  return (
    <div className="cards">
      <Metric
        title="총 사이클"
        tip="현재 workload 전체에 대한 예상 총 cycle과 불확실성입니다."
        value={`${fmt(result.summary.totalCycles, 0)} ±${uncertainty.uncertaintyPct.toFixed(1)}%`}
      />
      <Metric
        title="평균 활용률"
        tip="선택된 최적 타일들의 평균 PE utilization입니다."
        value={`${(result.summary.meanUtilization * 100).toFixed(1)}%`}
      />
      <Metric
        title="신뢰도"
        tip={confidenceSource === "selected-job" ? "선택한 작업의 confidence.md와 동일한 신뢰도입니다." : "현재 입력 미리보기 기준 신뢰도입니다. 작업을 선택하면 report/confidence.md 기준으로 표시됩니다."}
        value={`${confidence.level} (${(confidence.score * 100).toFixed(0)}%)${confidenceSource === "selected-job" ? " · 작업" : " · 미리보기"}`}
      />
      <Metric
        title="주요 병목"
        tip="전체 사이클에서 가장 큰 비중을 차지하는 연산입니다."
        value={result.summary.bottleneckOp}
      />
      {result.estimatorSuite?.applied && (
        <Metric
          title="Learned 보정"
          tip="활성 Estimator Suite가 analytical estimator cycle을 보정한 평균 계수입니다."
          value={`×${result.estimatorSuite.averageCycleFactor.toFixed(3)}`}
        />
      )}
    </div>
  );
}
