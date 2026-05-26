"use client";

import { memoryTrafficFor } from "@/lib/memoryTraffic";
import type { DownloadFn } from "./primitives";
import { ActionButton } from "./primitives";

type FullLayerMetricInfo = {
  label: string;
  unit: string;
  predicted: (r: any) => number | undefined;
  actual: (r: any) => number | undefined;
  format: (v: number) => string;
  note: string;
};

function normalizeOpName(name: string) {
  return String(name || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

export function FullLayerComparisonPanel({
  source,
  fallbackResult,
  scaleSummary,
  fullLayerMetric,
  chartZoom,
  download,
}: {
  source: any;
  fallbackResult: any;
  scaleSummary: any | null;
  fullLayerMetric: string;
  chartZoom: number;
  download: DownloadFn;
}) {
  const rows = Array.isArray(source?.results) ? source.results : [];
  const hw = source?.request?.hardware ??
    fallbackResult?.request?.hardware ?? { frequencyMHz: 700 };
  const scaleLayers = Array.isArray(scaleSummary?.layers)
    ? scaleSummary.layers
    : [];

  const matchScaleLayer = (row: any) => {
    const opName = normalizeOpName(row?.shape?.opName);
    const modelOp = normalizeOpName(
      `${row?.shape?.model || ""}${row?.shape?.opName || ""}`,
    );
    return scaleLayers.find((layer: any) => {
      const layerName = normalizeOpName(layer?.name);
      return (
        layerName === opName ||
        layerName === modelOp ||
        layerName.includes(opName) ||
        opName.includes(layerName)
      );
    });
  };

  const fullLayerRows = rows.map((row: any) => {
    const actual = matchScaleLayer(row);
    const predicted = Number(row?.best?.cycles) || 0;
    const actualCycles = Number(actual?.cycles) || 0;
    const errPct =
      predicted > 0 && actualCycles > 0
        ? ((actualCycles - predicted) / predicted) * 100
        : undefined;
    return { row, predicted, actual, actualCycles, errPct };
  });
  const hasFullLayerActual = fullLayerRows.some((r: any) => r.actualCycles > 0);

  const bestMemoryTrafficFor = (row: any) =>
    memoryTrafficFor(
      {
        ...(hw as any),
        bytesPerElement: Number(row?.shape?.dtypeBytes || hw.bytesPerElement || 2),
      },
      {
        ...(row?.shape as any),
        dtypeBytes: Number(row?.shape?.dtypeBytes || hw.bytesPerElement || 2),
      },
      row?.best ?? {},
    );
  const layerAccessKiB = (
    layer: any,
    key: "sramAccesses" | "dramAccesses",
    row: any,
  ) => {
    const accesses = Number(layer?.[key]);
    const bytes = Number(row?.shape?.dtypeBytes || hw.bytesPerElement || 2);
    return Number.isFinite(accesses) && accesses > 0
      ? (accesses * bytes) / 1024
      : undefined;
  };

  const fullLayerMetricInfo: Record<string, FullLayerMetricInfo> = {
    cycles: {
      label: "Cycle",
      unit: "cyc",
      predicted: (r) => r.predicted,
      actual: (r) => r.actualCycles,
      format: (v) => Math.round(v).toLocaleString(),
      note: "COMPUTE_REPORT.csv의 layer cycle과 TileForge learned estimator cycle을 비교합니다.",
    },
    timeUs: {
      label: "실행 시간",
      unit: "us",
      predicted: (r) => r.predicted / Math.max(1, Number(hw.frequencyMHz || 700)),
      actual: (r) =>
        r.actualCycles > 0
          ? r.actualCycles / Math.max(1, Number(hw.frequencyMHz || 700))
          : undefined,
      format: (v) => v.toFixed(3),
      note: "cycle을 현재 주파수로 나눈 시간입니다.",
    },
    utilization: {
      label: "PE 사용률",
      unit: "%",
      predicted: (r) => (Number(r.row?.best?.utilization) || 0) * 100,
      actual: (r) => Number(r.actual?.overallUtil ?? r.actual?.computeUtil),
      format: (v) => `${v.toFixed(1)}%`,
      note: "SCALE-Sim Overall Util/Compute Util과 TileForge 사용률을 비교합니다.",
    },
    mapping: {
      label: "Mapping efficiency",
      unit: "%",
      predicted: (r) => Number(r.row?.best?.fullLayerMappingEfficiency),
      actual: (r) => Number(r.actual?.mappingEfficiency),
      format: (v) => `${v.toFixed(1)}%`,
      note: "SCALE-Sim mapping efficiency와 full-layer estimator의 간단한 mapping 예측을 비교합니다.",
    },
    stall: {
      label: "Stall cycles",
      unit: "cyc",
      predicted: (r) => Number(r.row?.best?.fullLayerStallCycles),
      actual: (r) => Number(r.actual?.stallCycles),
      format: (v) => Math.round(v).toLocaleString(),
      note: "full-layer SRAM/DRAM pressure 기반 stall cycle 예측과 SCALE-Sim stall을 비교합니다.",
    },
    sramAccess: {
      label: "SRAM access",
      unit: "KiB",
      predicted: (r) => {
        const m = bestMemoryTrafficFor(r.row);
        return (m.sramReadBytes + m.sramWriteBytes) / 1024;
      },
      actual: (r) => layerAccessKiB(r.actual, "sramAccesses", r.row),
      format: (v) => `${v.toFixed(1)} KiB`,
      note: "Full-layer systolic reuse 기준 SRAM access 추정값입니다. tile-policy learned sramBytes와 섞지 않습니다.",
    },
    dramAccess: {
      label: "DRAM access",
      unit: "KiB",
      predicted: (r) => {
        const m = bestMemoryTrafficFor(r.row);
        return (m.dramReadBytes + m.dramWriteBytes) / 1024;
      },
      actual: (r) => layerAccessKiB(r.actual, "dramAccesses", r.row),
      format: (v) => `${v.toFixed(1)} KiB`,
      note: "Full-layer systolic reuse 기준 DRAM access 추정값입니다. tile micro-run access와 섞지 않습니다.",
    },
    sramFootprint: {
      label: "SRAM footprint",
      unit: "KiB",
      predicted: (r) => Number(r.row?.best?.sramBytes || 0) / 1024,
      actual: () => undefined,
      format: (v) => `${v.toFixed(1)} KiB`,
      note: "TileForge working-set footprint입니다. SCALE-Sim access와 다른 물리량이라 actual은 표시하지 않습니다.",
    },
  };

  if (!hasFullLayerActual) {
    return (
      <p className="small warn">
        선택 작업에 full-layer SCALE-Sim layer 결과가 없어 실제 비교 그래프를 만들 수 없습니다. full-pipeline 작업 완료 후 다시 확인하세요.
      </p>
    );
  }

  const fullInfo = fullLayerMetricInfo[fullLayerMetric] ?? fullLayerMetricInfo.cycles;
  const fullLayerPredVals = fullLayerRows
    .map((r: any) => fullInfo.predicted(r))
    .map((v: number | undefined) => (Number.isFinite(v) && v! >= 0 ? v : undefined));
  const fullLayerActualVals = fullLayerRows
    .map((r: any) => fullInfo.actual(r))
    .map((v: number | undefined) => (Number.isFinite(v) && v! >= 0 ? v : undefined));
  const fullLayerMax = Math.max(
    1,
    ...fullLayerPredVals.map((v: number | undefined) => v ?? 0),
    ...fullLayerActualVals.map((v: number | undefined) => v ?? 0),
  );
  const fullLayerSvgHeight = 96 + Math.max(1, fullLayerRows.length) * 52;
  const fullLayerSvgRows = fullLayerRows.map((r: any, i: number) => {
    const y = 98 + i * 52;
    const label = `${r.row?.shape?.model || ""}.${r.row?.shape?.opName || "op"}`;
    const predictedValue = fullLayerPredVals[i];
    const actualValue = fullLayerActualVals[i];
    const pw = predictedValue !== undefined ? Math.max(2, Math.round((predictedValue / fullLayerMax) * 540)) : 0;
    const aw = actualValue !== undefined ? Math.max(2, Math.round((actualValue / fullLayerMax) * 540)) : 0;
    const pred = pw
      ? `<rect x="250" y="${y}" width="${pw}" height="12" rx="4" fill="#1a73e8"/><text x="${260 + pw}" y="${y + 10}" fill="#202124" font-family="Consolas, monospace" font-size="11">예측 ${fullInfo.format(predictedValue!)}</text>`
      : `<text x="250" y="${y + 10}" fill="#1a73e8" font-family="Consolas, monospace" font-size="11">예측값 없음</text>`;
    const errPct = predictedValue && actualValue ? ((actualValue - predictedValue) / predictedValue) * 100 : undefined;
    const errText = errPct !== undefined ? ` (${errPct >= 0 ? "+" : ""}${errPct.toFixed(1)}%)` : "";
    const actual = aw
      ? `<rect x="250" y="${y + 21}" width="${aw}" height="10" rx="4" fill="#f9ab00"/><text x="${260 + aw}" y="${y + 30}" fill="#b06000" font-family="Consolas, monospace" font-size="11">SCALE-Sim ${fullInfo.format(actualValue!)}${errText}</text>`
      : `<text x="250" y="${y + 30}" fill="#b06000" font-family="Consolas, monospace" font-size="11">SCALE-Sim 값 없음</text>`;
    const hoverTitle = `${label} · 예측 ${predictedValue !== undefined ? fullInfo.format(predictedValue) : "없음"} · SCALE-Sim ${actualValue !== undefined ? fullInfo.format(actualValue) : "없음"}${errText}`;
    return `<g><title>${hoverTitle}</title><text x="20" y="${y + 13}" fill="#3c4043" font-family="Consolas, monospace" font-size="12">${label}</text>${pred}${actual}</g>`;
  });
  const fullLayerSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="980" height="${fullLayerSvgHeight}" viewBox="0 0 980 ${fullLayerSvgHeight}">
  <rect width="100%" height="100%" fill="#ffffff"/>
  <text x="20" y="30" fill="#202124" font-family="Arial" font-size="18">Full-layer SCALE-Sim ${fullInfo.label} 비교</text>
  <text x="20" y="52" fill="#5f6368" font-family="Arial" font-size="12">${fullInfo.note}</text>
  <text x="20" y="72" fill="#5f6368" font-family="Arial" font-size="11">파란색: TileForge 예측, 주황색: SCALE-Sim full-layer 결과</text>
  ${fullLayerSvgRows.join("\n  ")}
</svg>`;

  return (
    <>
      <div className="graph-actions">
        <ActionButton tip="full-layer 비교 그래프를 SVG로 다운로드합니다." onClick={() => download("full-layer-scalesim-comparison.svg", fullLayerSvg, "image/svg+xml")}>
          Full-layer 지표 비교 SVG 다운로드
        </ActionButton>
      </div>
      <div className="chart-scroll">
        <div className="chart-svg" style={{ transform: `scale(${chartZoom})`, transformOrigin: "top left", marginBottom: chartZoom > 1 ? `${(chartZoom - 1) * 180}px` : undefined }} dangerouslySetInnerHTML={{ __html: fullLayerSvg }} />
      </div>
      <h3>Full-layer op별 {fullInfo.label} 비교</h3>
      <table className="compact-table">
        <thead>
          <tr>
            <th>연산</th>
            <th>TileForge 예측</th>
            <th>SCALE-Sim 실제</th>
            <th>오차</th>
          </tr>
        </thead>
        <tbody>
          {fullLayerRows.map((r: any, i: number) => {
            const pv = fullLayerPredVals[i];
            const av = fullLayerActualVals[i];
            const err = pv && av ? ((av - pv) / pv) * 100 : undefined;
            return (
              <tr key={i}>
                <td>{r.row?.shape?.model}.{r.row?.shape?.opName}</td>
                <td>{pv !== undefined ? fullInfo.format(pv) : "-"}</td>
                <td>{av !== undefined ? fullInfo.format(av) : "-"}</td>
                <td>{err !== undefined ? `${err >= 0 ? "+" : ""}${err.toFixed(1)}%` : "-"}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}
