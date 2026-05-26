"use client";

import { analyzeFusion, fusionMarkdown } from "@/lib/fusion";
import { bottleneckMarkdown } from "@/lib/bottleneck";
import { rooflineMarkdown } from "@/lib/roofline";
import { energyMarkdown } from "@/lib/energy";
import { validityMarkdown } from "@/lib/validity";
import { fmt } from "@/lib/math";
import type { DownloadFn } from "./primitives";
import { ActionButton, Artifact, FieldLabel, MarkdownView } from "./primitives";
import { Metric } from "./MetricCard";
import {
  CsvArtifactTable,
  JobArtifactList,
  JobArtifactText,
  JobSourceNotice,
} from "./jobArtifacts";

export { Metric } from "./MetricCard";

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

export { Graphs } from "./GraphsTab";
