"use client";

import { apiFetch } from "@/lib/apiClient";
import type { ElementType } from "react";
import { useEffect, useMemo, useState } from "react";
import { analyzeFusion, fusionMarkdown } from "@/lib/fusion";
import { bottleneckMarkdown } from "@/lib/bottleneck";
import { rooflineMarkdown } from "@/lib/roofline";
import { energyMarkdown } from "@/lib/energy";
import { validityMarkdown } from "@/lib/validity";
import { fmt } from "@/lib/math";
import { memoryTrafficFor } from "@/lib/memoryTraffic";
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
import { ActionButton, Artifact, FieldLabel, MarkdownView } from "./primitives";
import {
  CsvArtifactTable,
  JobArtifactList,
  JobArtifactText,
  JobSourceNotice,
} from "./jobArtifacts";

export function Metric({
  title,
  value,
  tip,
}: {
  title: string;
  value: string;
  tip: string;
}) {
  return (
    <div className="card" title={tip}>
      <span className="small">{title}</span>
      <br />
      <b>{value}</b>
    </div>
  );
}
export function Policy({
  result,
  download,
  jobId,
  jobsPayload,
}: {
  result: any;
  download: DownloadFn;
  jobId?: string;
  jobsPayload?: any | null;
}) {
  return (
    <>
      <JobSourceNotice
        jobId={jobId ?? ""}
        jobsPayload={jobsPayload}
        tabName="타일 정책"
      />
      {jobId && (
        <CsvArtifactTable
          jobId={jobId}
          path="best_tile_policy.csv"
          title="선택 작업의 best_tile_policy.csv"
        />
      )}
      <ActionButton
        tip="최적 타일 정책 표를 CSV로 저장합니다."
        onClick={() =>
          download(
            "best_tile_policy.csv",
            result.artifacts.policyCsv,
            "text/csv",
          )
        }
      >
        정책 CSV 다운로드
      </ActionButton>
      <ActionButton
        className="secondary"
        tip="현재 프로젝트 전체 설정과 결과를 JSON으로 저장합니다."
        onClick={() =>
          download(
            "project.tileforge.json",
            result.artifacts.projectJson,
            "application/json",
          )
        }
      >
        프로젝트 JSON 다운로드
      </ActionButton>
      <table title="각 연산별 최적 타일과 예상 성능을 보여주는 표입니다.">
        <thead>
          <tr>
            <th title="모델 이름과 연산 이름입니다.">연산</th>
            <th title="GEMM shape M×N×K입니다.">Shape</th>
            <th title="선택된 최적 tileM×tileN×tileK입니다.">최적 타일</th>
            <th title="예상 실행 사이클입니다.">사이클</th>
            <th title="PE 활용률입니다.">활용률</th>
            <th title="타일 경계 때문에 추가되는 padding 비율입니다.">
              Padding
            </th>
            <th title="선택 타일의 SRAM 요구량입니다.">SRAM</th>
            <th title="SRAM 초과, 낮은 활용률 등 주의 사항입니다.">경고</th>
          </tr>
        </thead>
        <tbody>
          {result.results.map((r: any) => (
            <tr
              key={r.shape.id}
              title={`${r.shape.model}.${r.shape.opName}의 최적 타일 결과입니다.`}
            >
              <td>
                {r.shape.model}.{r.shape.opName}
              </td>
              <td>
                {r.shape.m}×{r.shape.n}×{r.shape.k}
              </td>
              <td>
                <span className="badge" title="tileM×tileN×tileK">
                  {r.best.tileM}×{r.best.tileN}×{r.best.tileK}
                </span>
              </td>
              <td>{fmt(r.best.cycles, 0)}</td>
              <td>{(r.best.utilization * 100).toFixed(1)}%</td>
              <td>{(r.best.paddingRatio * 100).toFixed(1)}%</td>
              <td>{(r.best.sramBytes / 1024).toFixed(1)} KiB</td>
              <td>{r.best.warnings.join(", ")}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3 title="첫 번째 연산에 대한 타일 후보 점수 분포입니다.">
        Pareto / heatmap 예시
      </h3>
      {result.results[0] && (
        <Heat points={result.results[0].heatmap.slice(0, 64)} />
      )}
    </>
  );
}
export function Heat({ points }: { points: any[] }) {
  const max = Math.max(...points.map((p) => p.score));
  const min = Math.min(...points.map((p) => p.score));
  return (
    <div
      className="heat"
      title="각 칸은 하나의 타일 후보를 뜻하며, hover하면 세부 값을 볼 수 있습니다."
    >
      {points.map((p, i) => {
        const v = 1 - (p.score - min) / Math.max(1e-9, max - min);
        return (
          <div
            key={i}
            className="cell"
            style={{ opacity: 0.35 + v * 0.65 }}
            title={`타일 ${p.tileM}×${p.tileN}×${p.tileK}, 예상 사이클 ${p.cycles}`}
          >
            {p.tileM}/{p.tileN}
          </div>
        );
      })}
    </div>
  );
}
export function Bottleneck({ result, jobId }: { result: any; jobId?: string }) {
  return (
    <>
      <JobSourceNotice jobId={jobId ?? ""} tabName="병목 분석" />
      <h3 title="전체 cycle 비중이 큰 연산과 병목 원인을 보여줍니다.">
        병목 대시보드
      </h3>
      <table title="병목 상위 연산 목록입니다.">
        <thead>
          <tr>
            <th title="병목 연산입니다.">연산</th>
            <th title="해당 연산의 예상 사이클입니다.">사이클</th>
            <th title="전체 사이클 중 비율입니다.">비중</th>
            <th title="추정된 병목 원인입니다.">원인</th>
          </tr>
        </thead>
        <tbody>
          {result.bottlenecks?.topOps.map((o: any) => (
            <tr key={o.opName} title={`${o.model}.${o.opName} 병목 정보`}>
              <td>
                {o.model}.{o.opName}
              </td>
              <td>{fmt(o.cycles, 0)}</td>
              <td>{o.percent.toFixed(1)}%</td>
              <td>{o.issue}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <section title="Markdown 형식의 병목 분석 보고서입니다.">
        <MarkdownView text={bottleneckMarkdown(result.bottlenecks)} />
      </section>
    </>
  );
}
export function Roofline({ result, jobId }: { result: any; jobId?: string }) {
  return (
    <>
      <JobSourceNotice jobId={jobId ?? ""} tabName="루프라인 분석" />
      <h3 title="연산 집약도와 roofline 기준 성능 한계를 분석합니다.">
        루프라인 분석
      </h3>
      <table title="각 연산의 arithmetic intensity와 bound 판정입니다.">
        <thead>
          <tr>
            <th title="분석 대상 연산입니다.">연산</th>
            <th title="Arithmetic Intensity: byte당 연산량입니다.">AI</th>
            <th title="예상 달성 GOPS입니다.">달성 GOPS</th>
            <th title="계산 성능 상한입니다.">Compute roof</th>
            <th title="메모리 대역폭 기반 성능 상한입니다.">Memory roof</th>
            <th title="계산 병목인지 메모리 병목인지 나타냅니다.">Bound</th>
          </tr>
        </thead>
        <tbody>
          {result.roofline?.map((p: any) => (
            <tr key={p.opName} title={`${p.model}.${p.opName} 루프라인 결과`}>
              <td>
                {p.model}.{p.opName}
              </td>
              <td>{p.arithmeticIntensity.toFixed(2)}</td>
              <td>{p.achievedGops.toFixed(2)}</td>
              <td>{p.computeRoofGops.toFixed(1)}</td>
              <td>{p.memoryRoofGops.toFixed(1)}</td>
              <td>
                <span className="badge" title="성능 제한 요인">
                  {p.bound}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <section title="Markdown 형식의 루프라인 분석 보고서입니다.">
        <MarkdownView text={rooflineMarkdown(result.roofline)} />
      </section>
    </>
  );
}
export function Energy({ result, jobId }: { result: any; jobId?: string }) {
  return (
    <>
      <JobSourceNotice jobId={jobId ?? ""} tabName="에너지/유효성 분석" />
      <h3 title="입력한 에너지 파라미터를 바탕으로 전체 에너지를 추정합니다.">
        에너지 추정
      </h3>
      <div className="cards">
        <Metric
          title="전체"
          tip="MAC, SRAM, DRAM 에너지를 합산한 값입니다."
          value={`${result.energy?.totalEnergyUJ.toFixed(1)} uJ`}
        />
        <Metric
          title="MAC"
          tip="MAC 연산에서 발생한 에너지입니다."
          value={`${result.energy?.totalMacEnergyUJ.toFixed(1)} uJ`}
        />
        <Metric
          title="DRAM"
          tip="DRAM 접근에서 발생한 에너지입니다."
          value={`${result.energy?.totalDramEnergyUJ.toFixed(1)} uJ`}
        />
        <Metric
          title="EDP"
          tip="Energy-Delay Product입니다. 낮을수록 좋습니다."
          value={`${result.energy?.edp.toFixed(1)}`}
        />
      </div>
      <section title="Markdown 형식의 에너지 분석 보고서입니다.">
        <MarkdownView text={energyMarkdown(result.energy)} />
      </section>
      <h3 title="인접 연산을 합쳐 메모리 이동을 줄일 가능성을 찾습니다.">
        Fusion 후보
      </h3>
      <section title="연산 fusion 가능성 요약입니다.">
        <MarkdownView
          text={fusionMarkdown(analyzeFusion(result.request.shapes))}
        />
      </section>
      <h3 title="설정값과 결과가 말이 되는지 기본 검사를 수행합니다.">
        유효성 검사
      </h3>
      <section title="SRAM 초과, 잘못된 shape, 비정상적인 tile 등을 확인합니다.">
        <MarkdownView
          text={validityMarkdown(
            result.request.hardware,
            result.request.shapes,
            result.results.map((r: any) => r.best),
          )}
        />
      </section>
    </>
  );
}
export function ArraySweep({
  rows,
  comparisonCsv,
  download,
}: {
  rows: any[];
  comparisonCsv: string;
  download: DownloadFn;
}) {
  return (
    <>
      <ActionButton
        tip="배열 크기별 비교 결과를 CSV로 저장합니다."
        onClick={() =>
          download("experiment_comparison.csv", comparisonCsv, "text/csv")
        }
      >
        배열 비교 CSV 다운로드
      </ActionButton>
      <table title="여러 systolic array 크기 후보를 같은 workload로 비교한 결과입니다.">
        <thead>
          <tr>
            <th title="PE 배열 크기입니다.">배열</th>
            <th title="전체 workload 예상 사이클입니다.">총 사이클</th>
            <th title="평균 PE 활용률입니다.">활용률</th>
            <th title="가장 큰 SRAM 요구량입니다.">최대 SRAM</th>
            <th title="목표 함수 기준 점수입니다.">점수</th>
            <th title="설계 선택에 대한 간단한 조언입니다.">조언</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r: any) => (
            <tr
              key={`${r.arrayRows}x${r.arrayCols}`}
              title={`${r.arrayRows}×${r.arrayCols} 배열 후보 결과`}
            >
              <td>
                {r.arrayRows}×{r.arrayCols}
              </td>
              <td>{fmt(r.totalCycles, 0)}</td>
              <td>{(r.meanUtilization * 100).toFixed(1)}%</td>
              <td>{(r.maxSramBytes / 1024).toFixed(1)} KiB</td>
              <td>{r.score.toFixed(3)}</td>
              <td>{r.advice[0]}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
export function Iree({
  result,
  download,
  jobId,
}: {
  result: any;
  download: DownloadFn;
  jobId?: string;
}) {
  return (
    <>
      <JobSourceNotice jobId={jobId ?? ""} tabName="IREE/MLIR" />
      {jobId && (
        <JobArtifactText
          jobId={jobId}
          path="generated.mlir"
          title="선택 작업의 generated.mlir"
        />
      )}
      <Artifact
        name="iree-command.sh"
        text={result.artifacts.ireeCommand}
        download={download}
      />
      <Artifact
        name="generated.mlir"
        text={result.artifacts.mlir}
        download={download}
      />
      <Artifact
        name="transform.mlir"
        text={result.artifacts.transformDialect}
        download={download}
      />
    </>
  );
}
export function Exports({
  result,
  download,
  jobId,
  jobsPayload,
}: {
  result: any;
  download: DownloadFn;
  jobId?: string;
  jobsPayload?: any | null;
}) {
  return (
    <>
      <JobSourceNotice
        jobId={jobId ?? ""}
        jobsPayload={jobsPayload}
        tabName="내보내기"
      />
      {jobId && <JobArtifactList jobId={jobId} jobsPayload={jobsPayload} />}
      <ActionButton
        tip="결과 artifact의 해시와 메타데이터를 담은 manifest를 저장합니다."
        onClick={() =>
          download(
            "manifest.json",
            result.artifacts.manifestJson ?? "{}",
            "application/json",
          )
        }
      >
        manifest 다운로드
      </ActionButton>
      <ActionButton
        tip="보고서에 넣을 수 있는 LaTeX 표를 저장합니다."
        onClick={() =>
          download("policy_table.tex", result.artifacts.latexTable ?? "")
        }
      >
        LaTeX 표 다운로드
      </ActionButton>
      <ActionButton
        tip="요약 그림을 SVG 파일로 저장합니다."
        onClick={() =>
          download(
            "summary.svg",
            result.artifacts.svgSummary ?? "",
            "image/svg+xml",
          )
        }
      >
        SVG 요약 다운로드
      </ActionButton>
      <ActionButton
        tip="SCALE-Sim 실행에 사용할 설정 파일을 저장합니다."
        onClick={() =>
          download("scalesim.cfg", result.artifacts.scaleSimConfig)
        }
      >
        SCALE-Sim cfg 다운로드
      </ActionButton>
      <ActionButton
        tip="SCALE-Sim topology CSV를 저장합니다."
        onClick={() =>
          download(
            "topology.csv",
            result.artifacts.scaleSimTopology,
            "text/csv",
          )
        }
      >
        topology CSV 다운로드
      </ActionButton>
      <ActionButton
        tip="SCALE-Sim layout CSV를 저장합니다."
        onClick={() =>
          download(
            "layout.csv",
            result.artifacts.scaleSimLayout ?? "",
            "text/csv",
          )
        }
      >
        layout CSV 다운로드
      </ActionButton>
      <ActionButton
        tip="각 연산의 상위 3개 tile 후보를 SCALE-Sim으로 검증하기 위한 topology CSV를 저장합니다."
        onClick={() =>
          download(
            "topology_top3.csv",
            result.artifacts.scaleSimTopkTopology ?? "",
            "text/csv",
          )
        }
      >
        top3 topology CSV 다운로드
      </ActionButton>
      <ActionButton
        tip="top3 tile 후보 topology와 같은 layer 순서를 갖는 SCALE-Sim layout CSV를 저장합니다."
        onClick={() =>
          download(
            "layout_top3.csv",
            result.artifacts.scaleSimTopkLayout ?? "",
            "text/csv",
          )
        }
      >
        top3 layout CSV 다운로드
      </ActionButton>
      <pre className="pre" title="LaTeX 표 미리보기입니다.">
        {result.artifacts.latexTable}
      </pre>
    </>
  );
}

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
  const [jobResult, setJobResult] = useState<any | null>(null);
  const [scaleSummary, setScaleSummary] = useState<any | null>(null);
  const [selectedOp, setSelectedOp] = useState(0);
  const [metric, setMetric] = useState("cycles");
  const [fullLayerMetric, setFullLayerMetric] = useState("cycles");
  const [graphMode, setGraphMode] = useState("fullLayer");
  const [designMetric, setDesignMetric] = useState<DesignMetric>("score");
  const [designRows, setDesignRows] = useState<any[]>([]);
  const [designPending, setDesignPending] = useState(false);
  const [chartZoom, setChartZoom] = useState(1);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError("");
      setJobResult(null);
      setScaleSummary(null);
      if (!jobId) return;
      try {
        const [r, sr] = await Promise.all([
          apiFetch(
            `/api/jobs/${jobId}/artifact?path=${encodeURIComponent("result.json")}`,
            { cache: "no-store" },
          ),
          apiFetch(
            `/api/jobs/${jobId}/artifact?path=${encodeURIComponent("scalesim_summary.json")}`,
            { cache: "no-store" },
          ),
        ]);
        if (!r.ok) throw new Error(await r.text());
        const text = await r.text();
        const parsed = JSON.parse(text);
        if (!cancelled)
          setJobResult(parsed?.payload?.response ?? parsed?.response ?? parsed);
        if (sr.ok) {
          const st = await sr.text();
          if (!cancelled) setScaleSummary(JSON.parse(st));
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  const source = jobResult ?? result;
  const rows = Array.isArray(source?.results) ? source.results : [];
  const opIndex = Math.min(selectedOp, Math.max(0, rows.length - 1));
  const op = rows[opIndex];
  const heat = Array.isArray(op?.heatmap) ? [...op.heatmap] : [];
  const hw = source?.request?.hardware ??
    result?.request?.hardware ?? { frequencyMHz: 700 };
  const shape = op?.shape ?? {};
  const dtype = Number(shape.dtypeBytes || hw.bytesPerElement || 2);
  const tileKey = (p: any) =>
    `${Number(p.tileM)}x${Number(p.tileN)}x${Number(p.tileK)}`;
  const externalCandidates = Array.isArray(scaleSummary?.candidateLayers)
    ? scaleSummary.candidateLayers
    : [];
  const mainActual = scaleSummary?.layers?.[opIndex];
  void mainActual;
  const designSourceKey = useMemo(
    () =>
      graphMode === "designSpace"
        ? JSON.stringify({
            request: source?.request,
            summary: source?.summary,
            suite: activeEstimatorSuite?.runId,
          })
        : "",
    [graphMode, source, activeEstimatorSuite?.runId],
  );

  useEffect(() => {
    if (graphMode !== "designSpace") {
      setDesignRows([]);
      setDesignPending(false);
      return;
    }
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
  }, [graphMode, designSourceKey]);

  const designSvg = useMemo(
    () =>
      graphMode === "designSpace" && designRows.length
        ? buildDesignSpaceSvg(designRows, designMetric)
        : "",
    [graphMode, designRows, designMetric],
  );
  const designBest = useMemo(() => bestDesignRow(designRows), [designRows]);
  const designPareto = useMemo(
    () => paretoDesignRows(designRows),
    [designRows],
  );
  const designRiskBest = useMemo(
    () => bestRiskAdjustedDesignRow(designRows),
    [designRows],
  );
  const designValidationPlan = useMemo(
    () => validationPlanRows(designRows, 5),
    [designRows],
  );
  const designValidationRows = designValidationPlan.map((item) => item.row);
  const bestByAxis = useMemo(
    () => bestDesignRowsByAxis(designRows),
    [designRows],
  );

  const normalizeOpName = (name: string) =>
    String(name || "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "");
  const scaleLayers = Array.isArray(scaleSummary?.layers)
    ? scaleSummary.layers
    : [];
  const matchScaleLayer = (row: any) => {
    const opName = normalizeOpName(row?.shape?.opName);
    const modelOp = normalizeOpName(
      `${row?.shape?.model || ""}${row?.shape?.opName || ""}`,
    );
    return scaleLayers.find((l: any) => {
      const ln = normalizeOpName(l?.name);
      return (
        ln === opName ||
        ln === modelOp ||
        ln.includes(opName) ||
        opName.includes(ln)
      );
    });
  };
  const fullLayerRows = rows.map((r: any) => {
    const actual = matchScaleLayer(r);
    const predicted = Number(r?.best?.cycles) || 0;
    const actualCycles = Number(actual?.cycles) || 0;
    const errPct =
      predicted > 0 && actualCycles > 0
        ? ((actualCycles - predicted) / predicted) * 100
        : undefined;
    return { row: r, predicted, actual, actualCycles, errPct };
  });
  const hasFullLayerActual = fullLayerRows.some((r: any) => r.actualCycles > 0);

  const bestMemoryTrafficFor = (row: any) =>
    memoryTrafficFor(
      {
        ...(hw as any),
        bytesPerElement: Number(
          row?.shape?.dtypeBytes || hw.bytesPerElement || 2,
        ),
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
  const fullLayerMetricInfo: Record<
    string,
    {
      label: string;
      unit: string;
      predicted: (r: any) => number | undefined;
      actual: (r: any) => number | undefined;
      format: (v: number) => string;
      note: string;
    }
  > = {
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
      predicted: (r) =>
        r.predicted / Math.max(1, Number(hw.frequencyMHz || 700)),
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

  const candidateActualByTile = new Map<string, any>();
  for (const c of externalCandidates) {
    // SCALE-Sim top-k output in TileForge is a micro-run diagnostic. When the
    // record has tileCount/tileExtrapolatedCycles, it is not a full-layer
    // measured value for the candidate and must not be drawn as an "actual"
    // bar. Otherwise the graph looks wildly wrong because it compares
    // full-layer TileForge estimates with micro-run access/cycle counters.
    const isFullLayerCandidate = !c.tileCount && !c.tileExtrapolatedCycles;
    if (!isFullLayerCandidate) continue;
    if (
      (c.shapeId && c.shapeId === shape.id) ||
      (!c.shapeId && c.opName === shape.opName)
    ) {
      candidateActualByTile.set(tileKey(c), c);
    }
  }
  const actualFor = (p: any, _index: number) =>
    candidateActualByTile.get(tileKey(p));
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
  const metricInfo: Record<
    string,
    {
      label: string;
      unit: string;
      lowerBetter: boolean;
      value: (p: any) => number;
      actualValue?: (a: any) => number | undefined;
      format: (v: number) => string;
      description: string;
    }
  > = {
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
    .map((p: any, i: number) => info.actualValue?.(actualFor(p, i)))
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
        ? Math.max(
            2,
            Math.round((Math.abs(actualMetricValue) / maxValue) * 600),
          )
        : 0;
      const actualPart = actualW
        ? `<rect x="170" y="${y + 17}" width="${actualW}" height="6" rx="3" fill="#f9ab00"/><text x="${180 + actualW}" y="${y + 23}" fill="#b06000" font-family="Consolas, monospace" font-size="10">SCALE-Sim ${info.format(actualMetricValue!)}</text>`
        : "";
      const hoverTitle = `${label} · ${info.label} ${info.format(v)} · util ${((Number(p.utilization) || 0) * 100).toFixed(1)}% · SRAM ${((Number(p.sramBytes) || 0) / 1024).toFixed(1)} KiB`;
      return `<g><title>${hoverTitle}</title><text x="20" y="${y + 15}" fill="#3c4043" font-family="Consolas, monospace" font-size="12">${label}</text><rect x="170" y="${y}" width="${w}" height="16" rx="4" fill="#1a73e8"/><text x="${180 + w}" y="${y + 13}" fill="#202124" font-family="Consolas, monospace" font-size="12">예측 ${info.format(v)} · util ${((Number(p.utilization) || 0) * 100).toFixed(1)}% · SRAM ${((Number(p.sramBytes) || 0) / 1024).toFixed(1)} KiB</text>${actualPart}</g>`;
    })
    .join("\n  ")}
</svg>`;

  const fullInfo =
    fullLayerMetricInfo[fullLayerMetric] ?? fullLayerMetricInfo.cycles;
  const fullLayerPredVals = fullLayerRows
    .map((r: any) => fullInfo.predicted(r))
    .map((v: number | undefined) =>
      Number.isFinite(v) && v! >= 0 ? v : undefined,
    );
  const fullLayerActualVals = fullLayerRows
    .map((r: any) => fullInfo.actual(r))
    .map((v: number | undefined) =>
      Number.isFinite(v) && v! >= 0 ? v : undefined,
    );
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
    const pw =
      predictedValue !== undefined
        ? Math.max(2, Math.round((predictedValue / fullLayerMax) * 540))
        : 0;
    const aw =
      actualValue !== undefined
        ? Math.max(2, Math.round((actualValue / fullLayerMax) * 540))
        : 0;
    const pred = pw
      ? `<rect x="250" y="${y}" width="${pw}" height="12" rx="4" fill="#1a73e8"/><text x="${260 + pw}" y="${y + 10}" fill="#202124" font-family="Consolas, monospace" font-size="11">예측 ${fullInfo.format(predictedValue!)}</text>`
      : `<text x="250" y="${y + 10}" fill="#1a73e8" font-family="Consolas, monospace" font-size="11">예측값 없음</text>`;
    const errPct =
      predictedValue && actualValue
        ? ((actualValue - predictedValue) / predictedValue) * 100
        : undefined;
    const errText =
      errPct !== undefined
        ? ` (${errPct >= 0 ? "+" : ""}${errPct.toFixed(1)}%)`
        : "";
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
    <section className="graphs-panel">
      <JobSourceNotice
        jobId={jobId ?? ""}
        jobsPayload={jobsPayload}
        tabName="그래프"
      />
      <h3>그래프</h3>
      <p className="small">
        full-pipeline SCALE-Sim 결과가 있으면 기본적으로 op별 실제 layer cycle과
        비교합니다. tile 후보 그래프는 실제 full-layer 후보 검증이 있을 때만
        actual 막대를 표시합니다.
      </p>
      <div className="row graph-controls">
        <div>
          <FieldLabel tip="full-layer 실제 SCALE-Sim layer cycle과 비교하거나, tile 후보 내부 ranking을 확인합니다.">
            그래프 모드
          </FieldLabel>
          <select
            value={graphMode}
            onChange={(e) => setGraphMode(e.target.value)}
          >
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
            <select
              value={fullLayerMetric}
              onChange={(e) => setFullLayerMetric(e.target.value)}
            >
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
            <select
              value={designMetric}
              onChange={(e) => setDesignMetric(e.target.value as any)}
            >
              <option value="score">Sweet-spot score</option>
              <option value="speedup">Speedup</option>
              <option value="throughput">Throughput</option>
            </select>
          </div>
        )}
      </div>

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

      {graphMode === "designSpace" && (
        <>
          <p className="small">
            TPU 배열/클럭/SRAM/DRAM bandwidth를 변화시키는 하드웨어 축과, 고정
            하드웨어에서 M/N/K를 변화시키는 워크로드 축을 같은 기준으로
            그립니다. SRAM 축은 “최소 안전 용량”, DRAM 축은 “대역폭 knee”를
            찾도록 저용량/저대역 구간까지 함께 평가합니다. M/N/K 축은 총
            cycle이 아니라 ops/cycle 기준으로 정규화합니다. 활성 Estimator
            Suite가 full-layer target일 때만 hardware-design cycle 보정에
            사용하고, tile-policy 모델은 ranking 보조로만 사용합니다.
          </p>
          {designPending && (
            <div className="info-box">
              <b>Design-space 계산 중</b>
              <p className="small">그래프 탭 진입 후 UI가 멈추지 않도록 백그라운드 tick에서 sweep을 계산합니다.</p>
            </div>
          )}
          <div className="graph-actions">
            <ActionButton
              tip="하드웨어/워크로드 sweet-spot 그래프를 SVG로 다운로드합니다."
              onClick={() =>
                download(
                  "design-space-sweet-spots.svg",
                  designSvg,
                  "image/svg+xml",
                )
              }
            >
              Design-space SVG 다운로드
            </ActionButton>
            <ActionButton
              tip="다음 SCALE-Sim 검증 추천 후보를 CSV로 저장합니다. 이 후보를 검증한 뒤 training CSV에 추가하면 estimator 재보정에 바로 사용할 수 있습니다."
              onClick={() =>
                download(
                  "design-space-validation-plan.csv",
                  exportValidationPlanCsv(designRows, 5),
                  "text/csv",
                )
              }
            >
              검증 후보 CSV 다운로드
            </ActionButton>
            <ActionButton
              tip="검증 후보와 선정 이유를 JSON으로 저장합니다. 자동화 스크립트에서 읽기 쉽도록 rank, factor, uncertainty, rationale을 포함합니다."
              onClick={() =>
                download(
                  "design-space-validation-plan.json",
                  exportValidationPlanJson(designRows, 5),
                  "application/json",
                )
              }
            >
              검증 후보 JSON 다운로드
            </ActionButton>
          </div>
          {designBest && (
            <div className="cards graph-summary-cards">
              <Metric
                title="전체 최상위 sweet spot"
                value={`${designBest.label}`}
                tip="speedup·throughput·score가 가장 많이 겹치는 consensus sweet spot 후보입니다."
              />
              <Metric
                title="Speedup"
                value={`${niceNumber(designBest.speedup)}×`}
                tip="workload 크기가 달라도 비교 가능하도록 ops/cycle 기준으로 정규화한 개선 배율입니다."
              />
              <Metric
                title="예상 TOPS"
                value={niceNumber(designBest.throughput)}
                tip="GEMM 연산량과 cycle/frequency로 계산한 대략적 throughput입니다."
              />
              <Metric
                title="Recommendation"
                value={niceNumber(designBest.recommendationScore)}
                tip="Consensus, ROI, 예측 confidence를 섞은 최종 추천 점수입니다. 너무 비싼 하드웨어 확장이나 학습 범위 밖 extrapolation을 과도하게 추천하지 않도록 보정합니다."
              />
              <Metric
                title="Risk-adjusted"
                value={
                  designRiskBest
                    ? `${designRiskBest.label} / ${niceNumber(designRiskBest.riskAdjustedRecommendationScore)}`
                    : "-"
                }
                tip="불확실성까지 감안한 보수적 추천 후보입니다. 상위 후보들의 오차 범위가 겹칠 때 이 값을 우선 확인합니다."
              />
              <Metric
                title="Uncertainty"
                value={`±${designBest.uncertaintyPct.toFixed(1)}%`}
                tip="prediction confidence, SRAM overflow, 활용률, 확장 정도를 바탕으로 한 design-space용 예상 오차 범위입니다."
              />
              <Metric
                title="Consensus / ROI"
                value={`${niceNumber(designBest.agreementScore)} / ${niceNumber(designBest.roiScore)}`}
                tip="Consensus는 여러 성능 지표의 겹침, ROI는 비용 대비 추천 강도입니다."
              />
              <Metric
                title="Prediction confidence"
                value={`${((designBest.predictionConfidence ?? 1) * 100).toFixed(0)}%`}
                tip="활성 Estimator Suite 기준 학습 domain 안쪽인지 나타냅니다. analytical-only 실행은 100%로 표시합니다."
              />
              <Metric
                title="검증 추천 후보"
                value={`${designValidationRows.length}개`}
                tip="SCALE-Sim으로 검증하면 학습 효과가 클 것으로 추정되는 active-learning 후보 수입니다."
              />
              <Metric
                title="Pareto 후보"
                value={`${designPareto.length}개`}
                tip="speedup/throughput/score/cost 기준에서 지배되지 않는 설계 후보 수입니다."
              />
            </div>
          )}
          <div className="chart-scroll">
            <div
              className="chart-svg"
              style={{ transform: `scale(${chartZoom})`, transformOrigin: "top left", marginBottom: chartZoom > 1 ? `${(chartZoom - 1) * 180}px` : undefined }}
              dangerouslySetInnerHTML={{ __html: designSvg }}
            />
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
                검증 우선순위는 예측 불확실성, 학습 domain 밖 여부, 추천 잠재력,
                SRAM overflow, knee 여부를 섞어 계산합니다. 이 후보부터 실제
                SCALE-Sim을 돌려 training CSV에 추가하면 estimator 보정 효과가
                큽니다.
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
                        <td>
                          {((r.predictionConfidence ?? 1) * 100).toFixed(0)}%
                          {r.outOfDomain ? "*" : ""}
                        </td>
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
      )}
      {graphMode === "fullLayer" && !hasFullLayerActual && (
        <p className="small warn">
          선택 작업에 full-layer SCALE-Sim layer 결과가 없어 실제 비교 그래프를
          만들 수 없습니다. full-pipeline 작업 완료 후 다시 확인하세요.
        </p>
      )}
      {graphMode === "fullLayer" && hasFullLayerActual && (
        <>
          <div className="graph-actions">
            <ActionButton
              tip="full-layer 비교 그래프를 SVG로 다운로드합니다."
              onClick={() =>
                download(
                  `full-layer-scalesim-comparison.svg`,
                  fullLayerSvg,
                  "image/svg+xml",
                )
              }
            >
              Full-layer 지표 비교 SVG 다운로드
            </ActionButton>
          </div>
          <div className="chart-scroll">
            <div
              className="chart-svg"
              style={{ transform: `scale(${chartZoom})`, transformOrigin: "top left", marginBottom: chartZoom > 1 ? `${(chartZoom - 1) * 180}px` : undefined }}
              dangerouslySetInnerHTML={{ __html: fullLayerSvg }}
            />
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
                    <td>
                      {r.row?.shape?.model}.{r.row?.shape?.opName}
                    </td>
                    <td>{pv !== undefined ? fullInfo.format(pv) : "-"}</td>
                    <td>{av !== undefined ? fullInfo.format(av) : "-"}</td>
                    <td>
                      {err !== undefined
                        ? `${err >= 0 ? "+" : ""}${err.toFixed(1)}%`
                        : "-"}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
      {graphMode === "candidates" && (
        <p className="small">
          파란색은 TileForge 예측, 주황색은 같은 tile 후보를 full-layer로 검증한
          경우에만 표시되는 실제값입니다. SRAM footprint와 access traffic은 서로
          다른 물리량이므로 분리해서 표시합니다.
        </p>
      )}
      {error && (
        <p className="small warn">
          선택 작업 result.json을 읽지 못해 현재 입력 미리보기를 사용합니다:{" "}
          {error}
        </p>
      )}
      {graphMode === "candidates" && (
        <>
          <div className="row graph-controls">
            <div>
              <FieldLabel tip="그래프로 볼 연산을 선택합니다.">
                연산 선택
              </FieldLabel>
              <select
                value={opIndex}
                onChange={(e) => setSelectedOp(Number(e.target.value))}
              >
                {rows.map((r: any, i: number) => (
                  <option key={i} value={i}>
                    {r.shape?.model}.{r.shape?.opName}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <FieldLabel tip="막대 그래프의 기준 지표를 선택합니다.">
                그래프 지표
              </FieldLabel>
              <select
                value={metric}
                onChange={(e) => setMetric(e.target.value)}
              >
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
            <ActionButton
              tip="현재 그래프를 SVG 파일로 다운로드합니다."
              onClick={() =>
                download(`tile-candidate-${metric}.svg`, svg, "image/svg+xml")
              }
            >
              그래프 SVG 다운로드
            </ActionButton>
          </div>
          {best && (
            <div className="cards graph-summary-cards">
              <Metric
                title={
                  info.lowerBetter ? `최저 ${info.label}` : `최고 ${info.label}`
                }
                value={info.format(info.value(best))}
                tip="현재 선택한 지표 기준 최상위 타일 후보입니다."
              />
              <Metric
                title="선택 기준 최적 타일"
                value={`${best.tileM}×${best.tileN}×${best.tileK}`}
                tip="현재 그래프 지표 기준 상위 후보입니다."
              />
              <Metric
                title="PE 사용률"
                value={`${((best.utilization ?? 0) * 100).toFixed(1)}%`}
                tip="선택 후보의 PE 사용률입니다."
              />
              <Metric
                title="SRAM/cache"
                value={`${((best.sramBytes ?? 0) / 1024).toFixed(1)} KiB`}
                tip="선택 후보의 로컬 SRAM/cache 작업 영역입니다."
              />
            </div>
          )}
          <div className="chart-scroll">
            <div
              className="chart-svg"
              style={{ transform: `scale(${chartZoom})`, transformOrigin: "top left", marginBottom: chartZoom > 1 ? `${(chartZoom - 1) * 180}px` : undefined }}
              dangerouslySetInnerHTML={{ __html: svg }}
            />
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
                const actual = actualFor(p, i);
                const actualMetricValue = actualMetricValues[i];
                return (
                  <tr key={`${p.tileM}-${p.tileN}-${p.tileK}-${i}`}>
                    <td>{i + 1}</td>
                    <td>
                      {p.tileM}×{p.tileN}×{p.tileK}
                    </td>
                    <td>{info.format(info.value(p))}</td>
                    <td>
                      {actualMetricValue ? info.format(actualMetricValue) : "-"}
                    </td>
                    <td>{Math.round(p.cycles).toLocaleString()}</td>
                    <td>
                      {actual?.cycles
                        ? Math.round(actual.cycles).toLocaleString()
                        : "-"}
                    </td>
                    <td>
                      {(
                        (Number(p.cycles) || 0) /
                        Math.max(1, Number(hw.frequencyMHz || 700))
                      ).toFixed(3)}
                    </td>
                    <td>
                      {((p.utilization ?? 0) * 100).toFixed(1)}% /{" "}
                      {actual?.overallUtil
                        ? `${Number(actual.overallUtil).toFixed(1)}%`
                        : "-"}
                    </td>
                    <td>{((p.paddingRatio ?? 0) * 100).toFixed(1)}%</td>
                    <td>
                      {((p.sramBytes ?? 0) / 1024).toFixed(1)} KiB; access{" "}
                      {estimatedSramAccessKiB(p).toFixed(1)} /{" "}
                      {actualAccessKiB(actual, "sramAccesses")?.toFixed(1) ??
                        "-"}{" "}
                      KiB
                    </td>
                    <td>
                      {estimatedDramAccessKiB(p).toFixed(1)} KiB /{" "}
                      {actualAccessKiB(actual, "dramAccesses")?.toFixed(1) ??
                        "-"}{" "}
                      KiB
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </>
      )}
    </section>
  );
}
