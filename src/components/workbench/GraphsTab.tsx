"use client";

import { useState } from "react";
import type { DesignMetric } from "@/lib/designSpace";
import type { DownloadFn } from "./primitives";
import { ChartZoomControls, GraphModeControls } from "./GraphControls";
import { JobSourceNotice } from "./jobArtifacts";
import { CandidateGraphPanel } from "./CandidateGraphPanel";
import { DesignSpacePanel } from "./DesignSpacePanel";
import { FullLayerComparisonPanel } from "./FullLayerComparisonPanel";
import { useGraphJobArtifacts } from "./useGraphJobArtifacts";

export function Graphs({
  result,
  download,
  jobId,
  jobsPayload,
  activeEstimatorSuite,
}: {
  result: any;
  download: DownloadFn;
  jobId?: string;
  jobsPayload?: any | null;
  activeEstimatorSuite?: any | null;
}) {
  const [fullLayerMetric, setFullLayerMetric] = useState("cycles");
  const [graphMode, setGraphMode] = useState("fullLayer");
  const [designMetric, setDesignMetric] = useState<DesignMetric>("score");
  const [chartZoom, setChartZoom] = useState(1);
  const { jobResult, scaleSummary, error } = useGraphJobArtifacts(jobId);
  const source = jobResult ?? result;

  return (
    <section className="graphs-panel">
      <JobSourceNotice jobId={jobId ?? ""} jobsPayload={jobsPayload} tabName="그래프" />
      <h3>그래프</h3>
      <p className="small">
        full-layer, tile-policy, design-space 그래프를 분리해서 표시합니다. 이
        분리는 하드웨어 설계 판단, 타일링 전략 선택, IREE 옵션 후보 생성이라는
        서로 다른 목적을 섞지 않기 위한 contract입니다.
      </p>
      <GraphModeControls
        graphMode={graphMode}
        setGraphMode={setGraphMode}
        fullLayerMetric={fullLayerMetric}
        setFullLayerMetric={setFullLayerMetric}
        designMetric={designMetric}
        setDesignMetric={setDesignMetric}
      />
      <ChartZoomControls chartZoom={chartZoom} setChartZoom={setChartZoom} />

      {error && (
        <p className="small warn">
          선택 작업 result.json을 읽지 못해 현재 입력 미리보기를 사용합니다: {error}
        </p>
      )}

      {graphMode === "designSpace" && (
        <DesignSpacePanel
          source={source}
          activeEstimatorSuite={activeEstimatorSuite}
          designMetric={designMetric}
          chartZoom={chartZoom}
          download={download}
        />
      )}
      {graphMode === "fullLayer" && (
        <FullLayerComparisonPanel
          source={source}
          fallbackResult={result}
          scaleSummary={scaleSummary}
          fullLayerMetric={fullLayerMetric}
          chartZoom={chartZoom}
          download={download}
        />
      )}
      {graphMode === "candidates" && (
        <CandidateGraphPanel
          source={source}
          fallbackResult={result}
          scaleSummary={scaleSummary}
          chartZoom={chartZoom}
          download={download}
        />
      )}
    </section>
  );
}
