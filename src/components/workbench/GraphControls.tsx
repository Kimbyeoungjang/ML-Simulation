"use client";

import type { Dispatch, SetStateAction } from "react";
import type { DesignMetric } from "@/lib/designSpace";
import { FieldLabel } from "./primitives";

export type GraphMode = "fullLayer" | "candidates" | "designSpace";

export function GraphModeControls({
  graphMode,
  setGraphMode,
  fullLayerMetric,
  setFullLayerMetric,
  designMetric,
  setDesignMetric,
}: {
  graphMode: string;
  setGraphMode: Dispatch<SetStateAction<string>>;
  fullLayerMetric: string;
  setFullLayerMetric: Dispatch<SetStateAction<string>>;
  designMetric: DesignMetric;
  setDesignMetric: Dispatch<SetStateAction<DesignMetric>>;
}) {
  return (
    <div className="row graph-controls">
      <div>
        <FieldLabel tip="full-layer 실제 SCALE-Sim layer cycle과 비교하거나, tile 후보 내부 ranking을 확인합니다.">
          그래프 모드
        </FieldLabel>
        <select value={graphMode} onChange={(e) => setGraphMode(e.target.value)}>
          <option value="fullLayer">Full-layer SCALE-Sim 비교</option>
          <option value="candidates">Tile 후보 ranking</option>
          <option value="designSpace">Design-space sweet spot</option>
        </select>
      </div>
      {graphMode === "fullLayer" && (
        <div>
          <FieldLabel tip="SCALE-Sim full-layer 결과와 비교할 지표입니다. cycle 외에도 utilization, SRAM/DRAM access, mapping efficiency, stall cycle을 확인할 수 있습니다.">
            비교 지표
          </FieldLabel>
          <select value={fullLayerMetric} onChange={(e) => setFullLayerMetric(e.target.value)}>
            <option value="cycles">Cycle</option>
            <option value="timeUs">실행 시간</option>
            <option value="utilization">PE 사용률</option>
            <option value="sramAccess">SRAM access</option>
            <option value="dramAccess">DRAM access</option>
            <option value="mapping">Mapping efficiency</option>
            <option value="stall">Stall cycles</option>
            <option value="sramFootprint">SRAM footprint</option>
          </select>
        </div>
      )}
      {graphMode === "designSpace" && (
        <div>
          <FieldLabel tip="하드웨어/워크로드 sweep 그래프의 y축 지표입니다. score는 정규화된 속도 향상, 활용률, 비용 증가를 함께 고려합니다.">
            Design 지표
          </FieldLabel>
          <select value={designMetric} onChange={(e) => setDesignMetric(e.target.value as DesignMetric)}>
            <option value="score">Sweet-spot score</option>
            <option value="speedup">Speedup</option>
            <option value="throughput">Throughput</option>
          </select>
        </div>
      )}
    </div>
  );
}

export function ChartZoomControls({
  chartZoom,
  setChartZoom,
}: {
  chartZoom: number;
  setChartZoom: Dispatch<SetStateAction<number>>;
}) {
  return (
    <div className="graph-zoom-controls" title="그래프는 마우스 hover로 값을 확인하고, 슬라이더로 확대해 볼 수 있습니다.">
      <span className="small">확대</span>
      <button className="secondary" title="그래프를 축소합니다." onClick={() => setChartZoom((z) => Math.max(0.65, Number((z - 0.15).toFixed(2))))}>−</button>
      <input
        className="zoom-slider"
        type="range"
        min="65"
        max="225"
        step="5"
        value={Math.round(chartZoom * 100)}
        title="그래프 확대 비율"
        onChange={(e) => setChartZoom(Number(e.target.value) / 100)}
      />
      <span className="zoom-value">{Math.round(chartZoom * 100)}%</span>
      <button className="secondary" title="그래프를 확대합니다." onClick={() => setChartZoom((z) => Math.min(2.25, Number((z + 0.15).toFixed(2))))}>+</button>
      <button className="secondary" title="확대 비율을 100%로 되돌립니다." onClick={() => setChartZoom(1)}>맞춤</button>
    </div>
  );
}
