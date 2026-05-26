"use client";

import { useState } from "react";
import { memoryTrafficFor } from "@/lib/memoryTraffic";
import type { DownloadFn } from "./primitives";
import { ActionButton, FieldLabel } from "./primitives";
import { Metric } from "./MetricCard";

type MetricInfo = {
  label: string;
  unit: string;
  lowerBetter: boolean;
  value: (p: any) => number;
  actualValue?: (a: any) => number | undefined;
  format: (v: number) => string;
  description: string;
};

function tileKey(p: any) {
  return `${Number(p.tileM)}x${Number(p.tileN)}x${Number(p.tileK)}`;
}

export function CandidateGraphPanel({
  source,
  fallbackResult,
  scaleSummary,
  chartZoom,
  download,
}: {
  source: any;
  fallbackResult: any;
  scaleSummary: any | null;
  chartZoom: number;
  download: DownloadFn;
}) {
  const [selectedOp, setSelectedOp] = useState(0);
  const [metric, setMetric] = useState("cycles");
  const rows = Array.isArray(source?.results) ? source.results : [];
  const opIndex = Math.min(selectedOp, Math.max(0, rows.length - 1));
  const op = rows[opIndex];
  const heat = Array.isArray(op?.heatmap) ? [...op.heatmap] : [];
  const hw = source?.request?.hardware ??
    fallbackResult?.request?.hardware ?? { frequencyMHz: 700 };
  const shape = op?.shape ?? {};
  const dtype = Number(shape.dtypeBytes || hw.bytesPerElement || 2);
  const externalCandidates = Array.isArray(scaleSummary?.candidateLayers)
    ? scaleSummary.candidateLayers
    : [];

  const candidateActualByTile = new Map<string, any>();
  for (const c of externalCandidates) {
    const isFullLayerCandidate = !c.tileCount && !c.tileExtrapolatedCycles;
    if (!isFullLayerCandidate) continue;
    if (
      (c.shapeId && c.shapeId === shape.id) ||
      (!c.shapeId && c.opName === shape.opName)
    ) {
      candidateActualByTile.set(tileKey(c), c);
    }
  }

  const actualFor = (p: any) => candidateActualByTile.get(tileKey(p));
  const actualAccessKiB = (a: any, key: "sramAccesses" | "dramAccesses") => {
    const accesses = Number(a?.[key]);
    return Number.isFinite(accesses) && accesses > 0
      ? (accesses * dtype) / 1024
      : undefined;
  };
  const memoryFor = (p: any) =>
    memoryTrafficFor(
      { ...(hw as any), bytesPerElement: dtype },
      { ...(shape as any), dtypeBytes: dtype },
      p,
    );
  const estimatedSramAccessKiB = (p: any) => {
    const m = memoryFor(p);
    return (m.sramReadBytes + m.sramWriteBytes) / 1024;
  };
  const estimatedDramAccessKiB = (p: any) => {
    const m = memoryFor(p);
    return (m.dramReadBytes + m.dramWriteBytes) / 1024;
  };

  const metricInfo: Record<string, MetricInfo> = {
    cycles: {
      label: "Cycle",
      unit: "cyc",
      lowerBetter: true,
      value: (p) => Number(p.cycles) || 0,
      actualValue: (a) => Number(a?.cycles) || undefined,
      format: (v) => Math.round(v).toLocaleString(),
      description:
        "TileForge learned/analytical estimator cycle입니다. 주황색 actual은 같은 tile 후보를 full-layer로 검증한 경우에만 표시합니다.",
    },
    timeUs: {
      label: "실행 시간",
      unit: "us",
      lowerBetter: true,
      value: (p) =>
        (Number(p.cycles) || 0) / Math.max(1, Number(hw.frequencyMHz || 700)),
      actualValue: (a) =>
        Number(a?.cycles)
          ? Number(a.cycles) / Math.max(1, Number(hw.frequencyMHz || 700))
          : undefined,
      format: (v) => v.toFixed(3),
      description: "cycle을 주파수로 나눈 예상/실제 실행 시간입니다.",
    },
    utilization: {
      label: "PE 사용률",
      unit: "%",
      lowerBetter: false,
      value: (p) => (Number(p.utilization) || 0) * 100,
      actualValue: (a) => Number(a?.overallUtil ?? a?.computeUtil) || undefined,
      format: (v) => `${v.toFixed(1)}%`,
      description:
        "예측 PE 사용률입니다. SCALE-Sim actual은 같은 tile 후보를 full-layer로 검증한 경우에만 표시합니다.",
    },
    padding: {
      label: "패딩 비율",
      unit: "%",
      lowerBetter: true,
      value: (p) => (Number(p.paddingRatio) || 0) * 100,
      format: (v) => `${v.toFixed(1)}%`,
      description:
        "타일 경계에서 낭비되는 계산 비율입니다. SCALE-Sim에는 직접 대응되는 단일 지표가 없습니다.",
    },
    sramFootprint: {
      label: "SRAM footprint",
      unit: "KiB",
      lowerBetter: true,
      value: (p) => (Number(p.sramBytes) || 0) / 1024,
      format: (v) => `${v.toFixed(1)} KiB`,
      description:
        "타일이 동시에 요구하는 로컬 SRAM 작업 영역입니다. access 총량과는 다른 물리량이므로 SCALE-Sim 막대를 표시하지 않습니다.",
    },
    sram: {
      label: "SRAM accesses",
      unit: "KiB",
      lowerBetter: true,
      value: estimatedSramAccessKiB,
      actualValue: (a) => actualAccessKiB(a, "sramAccesses"),
      format: (v) => `${v.toFixed(1)} KiB`,
      description:
        "파란색은 TileForge 추정 SRAM read/write traffic입니다. SCALE-Sim micro-run access와 직접 비교하지 않습니다.",
    },
    dram: {
      label: "DRAM accesses",
      unit: "KiB",
      lowerBetter: true,
      value: estimatedDramAccessKiB,
      actualValue: (a) => actualAccessKiB(a, "dramAccesses"),
      format: (v) => `${v.toFixed(1)} KiB`,
      description:
        "파란색은 TileForge 추정 DRAM read/write traffic입니다. SCALE-Sim micro-run access와 직접 비교하지 않습니다.",
    },
    score: {
      label: "종합 점수",
      unit: "score",
      lowerBetter: true,
      value: (p) => Number(p.score ?? p.cycles) || 0,
      format: (v) => v.toFixed(3),
      description:
        "objective에 따른 내부 ranking 점수입니다. 외부 도구의 직접 대응값은 없습니다.",
    },
  };

  const info = metricInfo[metric] ?? metricInfo.cycles;
  const sorted = heat.sort((a: any, b: any) =>
    info.lowerBetter
      ? info.value(a) - info.value(b)
      : info.value(b) - info.value(a),
  );
  const top = sorted.slice(0, 24);
  const actualMetricValues = top
    .map((p: any) => info.actualValue?.(actualFor(p)))
    .map((v) => (Number.isFinite(v) && v! > 0 ? v : undefined));
  const hasActualMetric = actualMetricValues.some((v) => v !== undefined);
  const maxValue = Math.max(
    1e-9,
    ...actualMetricValues.map((v) => (v ? Math.abs(v) : 0)),
    ...top.map((p: any) => Math.abs(info.value(p)) || 0),
  );
  const best = top[0];
  const svgWidth = 980;
  const rowH = hasActualMetric ? 34 : 26;
  const svgHeight = 76 + top.length * rowH;
  const safeTitle = `${info.label} comparison${op?.shape ? ` - ${op.shape.model}.${op.shape.opName}` : ""}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="20" y="30" fill="#202124" font-family="Arial" font-size="18">${safeTitle}</text>
  <text x="20" y="52" fill="#5f6368" font-family="Arial" font-size="12">${info.description}</text>
  ${top
    .map((p: any, i: number) => {
      const y = 80 + i * rowH;
      const v = info.value(p);
      const w = Math.max(2, Math.round((Math.abs(v) / maxValue) * 600));
      const label = `${p.tileM}x${p.tileN}x${p.tileK}`;
      const actualMetricValue = actualMetricValues[i];
      const actualW = actualMetricValue
        ? Math.max(2, Math.round((Math.abs(actualMetricValue) / maxValue) * 600))
        : 0;
      const actualPart = actualW
        ? `<rect x="170" y="${y + 17}" width="${actualW}" height="6" rx="3" fill="#f9ab00"/><text x="${180 + actualW}" y="${y + 23}" fill="#b06000" font-family="Consolas, monospace" font-size="10">SCALE-Sim ${info.format(actualMetricValue!)}</text>`
        : "";
      const hoverTitle = `${label} · ${info.label} ${info.format(v)} · util ${((Number(p.utilization) || 0) * 100).toFixed(1)}% · SRAM ${((Number(p.sramBytes) || 0) / 1024).toFixed(1)} KiB`;
      return `<g><title>${hoverTitle}</title><text x="20" y="${y + 15}" fill="#3c4043" font-family="Consolas, monospace" font-size="12">${label}</text><rect x="170" y="${y}" width="${w}" height="16" rx="4" fill="#1a73e8"/><text x="${180 + w}" y="${y + 13}" fill="#202124" font-family="Consolas, monospace" font-size="12">예측 ${info.format(v)} · util ${((Number(p.utilization) || 0) * 100).toFixed(1)}% · SRAM ${((Number(p.sramBytes) || 0) / 1024).toFixed(1)} KiB</text>${actualPart}</g>`;
    })
    .join("\n  ")}
</svg>`;

  return (
    <>
      <p className="small">
        파란색은 TileForge 예측, 주황색은 같은 tile 후보를 full-layer로 검증한
        경우에만 표시되는 실제값입니다. SRAM footprint와 access traffic은 서로
        다른 물리량이므로 분리해서 표시합니다.
      </p>
      <div className="row graph-controls">
        <div>
          <FieldLabel tip="그래프로 볼 연산을 선택합니다.">연산 선택</FieldLabel>
          <select value={opIndex} onChange={(e) => setSelectedOp(Number(e.target.value))}>
            {rows.map((r: any, i: number) => (
              <option key={i} value={i}>
                {r.shape?.model}.{r.shape?.opName}
              </option>
            ))}
          </select>
        </div>
        <div>
          <FieldLabel tip="막대 그래프의 기준 지표를 선택합니다.">그래프 지표</FieldLabel>
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            <option value="cycles">Cycle</option>
            <option value="timeUs">예상 실행 시간</option>
            <option value="utilization">PE 사용률</option>
            <option value="padding">패딩 비율</option>
            <option value="sramFootprint">SRAM footprint</option>
            <option value="sram">SRAM access 추정</option>
            <option value="dram">DRAM access 추정</option>
            <option value="score">종합 점수</option>
          </select>
        </div>
      </div>
      <div className="graph-actions">
        <ActionButton tip="현재 그래프를 SVG 파일로 다운로드합니다." onClick={() => download(`tile-candidate-${metric}.svg`, svg, "image/svg+xml")}>
          그래프 SVG 다운로드
        </ActionButton>
      </div>
      {best && (
        <div className="cards graph-summary-cards">
          <Metric title={info.lowerBetter ? `최저 ${info.label}` : `최고 ${info.label}`} value={info.format(info.value(best))} tip="현재 선택한 지표 기준 최상위 타일 후보입니다." />
          <Metric title="선택 기준 최적 타일" value={`${best.tileM}×${best.tileN}×${best.tileK}`} tip="현재 그래프 지표 기준 상위 후보입니다." />
          <Metric title="PE 사용률" value={`${((best.utilization ?? 0) * 100).toFixed(1)}%`} tip="선택 후보의 PE 사용률입니다." />
          <Metric title="SRAM/cache" value={`${((best.sramBytes ?? 0) / 1024).toFixed(1)} KiB`} tip="선택 후보의 로컬 SRAM/cache 작업 영역입니다." />
        </div>
      )}
      <div className="chart-scroll">
        <div className="chart-svg" style={{ transform: `scale(${chartZoom})`, transformOrigin: "top left", marginBottom: chartZoom > 1 ? `${(chartZoom - 1) * 180}px` : undefined }} dangerouslySetInnerHTML={{ __html: svg }} />
      </div>
      <h3>상위 타일 후보</h3>
      <table className="compact-table">
        <thead>
          <tr>
            <th>순위</th>
            <th>타일</th>
            <th>{info.label} 예측</th>
            <th>{info.label} 실제</th>
            <th>예측 cycle</th>
            <th>SCALE-Sim cycle</th>
            <th>시간 us</th>
            <th>사용률</th>
            <th>패딩</th>
            <th>SRAM</th>
            <th>DRAM</th>
          </tr>
        </thead>
        <tbody>
          {top.map((p: any, i: number) => {
            const actual = actualFor(p);
            const actualMetricValue = actualMetricValues[i];
            return (
              <tr key={`${p.tileM}-${p.tileN}-${p.tileK}-${i}`}>
                <td>{i + 1}</td>
                <td>{p.tileM}×{p.tileN}×{p.tileK}</td>
                <td>{info.format(info.value(p))}</td>
                <td>{actualMetricValue ? info.format(actualMetricValue) : "-"}</td>
                <td>{Math.round(p.cycles).toLocaleString()}</td>
                <td>{actual?.cycles ? Math.round(actual.cycles).toLocaleString() : "-"}</td>
                <td>{((Number(p.cycles) || 0) / Math.max(1, Number(hw.frequencyMHz || 700))).toFixed(3)}</td>
                <td>{((p.utilization ?? 0) * 100).toFixed(1)}% / {actual?.overallUtil ? `${Number(actual.overallUtil).toFixed(1)}%` : "-"}</td>
                <td>{((p.paddingRatio ?? 0) * 100).toFixed(1)}%</td>
                <td>{((p.sramBytes ?? 0) / 1024).toFixed(1)} KiB; access {estimatedSramAccessKiB(p).toFixed(1)} / {actualAccessKiB(actual, "sramAccesses")?.toFixed(1) ?? "-"} KiB</td>
                <td>{estimatedDramAccessKiB(p).toFixed(1)} KiB / {actualAccessKiB(actual, "dramAccesses")?.toFixed(1) ?? "-"} KiB</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
