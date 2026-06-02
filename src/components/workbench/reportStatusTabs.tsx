"use client";

import { useEffect, useRef, useState } from "react";
import { confidenceMarkdown } from "@/lib/confidence";
import type { DownloadFn } from "./primitives";
import { ActionButton, Artifact, FieldLabel, MarkdownView } from "./primitives";
import { JobArtifactText, jobById, jobDisplayName, jobTooltip } from "./jobArtifacts";

export function ReportTab({
  report,
  sourceJobId,
  fallback,
  download,
  confidence,
  jobsPayload,
  onSelectJobReport,
  onDeleteJob,
}: {
  report: string;
  sourceJobId: string;
  fallback: boolean;
  download: DownloadFn;
  confidence: any;
  jobsPayload: any | null;
  onSelectJobReport: (id: string) => void;
  onDeleteJob: (id: string) => void;
}) {
  const jobs = Array.isArray(jobsPayload?.jobs) ? jobsPayload.jobs : [];
  const reportJobs = jobs.filter(
    (j: any) =>
      ["succeeded", "succeeded_with_warnings", "failed"].includes(j.status) &&
      Array.isArray(j.artifacts) &&
      j.artifacts.includes("report.md"),
  );
  return (
    <>
      <div
        className="report-status-strip"
        title="보고서가 클라이언트 추정값인지, 완료된 full-pipeline job artifact인지 표시합니다."
      >
        <span className={`badge ${fallback ? "warn-badge" : "ok-badge"}`}>
          {fallback ? "Estimator 미리보기" : "완료 job report.md"}
        </span>
        <span className="small">
          {fallback
            ? "full-pipeline 완료 전에는 외부 도구 반영 상태가 대기 중으로 보일 수 있습니다."
            : (() => { const j = jobById(jobsPayload, sourceJobId); return j ? `${jobDisplayName(j)}의 report.md를 보고 있습니다.` : `선택한 작업의 report.md를 보고 있습니다.`; })()}
        </span>
      </div>
      <section className="report-picker" title="완료된 작업별 report.md를 골라 봅니다.">
        <div>
          <b>작업별 보고서 선택</b>
          <p className="small">완료/실패한 작업 중 report.md artifact가 있는 작업을 선택하면 보고서 탭이 해당 작업 결과로 바뀝니다.</p>
        </div>
        <div className="report-picker-controls">
          <select
            value={sourceJobId}
            onChange={(e) => e.target.value && onSelectJobReport(e.target.value)}
            title="보고서를 볼 작업을 선택합니다."
          >
            <option value="">Estimator 미리보기 / 최신 자동 선택</option>
            {reportJobs.map((j: any) => (
              <option key={j.id} value={j.id}>
                {jobDisplayName(j)} · {j.status} · {j.createdAt ? new Date(j.createdAt).toLocaleString() : ""}
              </option>
            ))}
          </select>
          {sourceJobId && (
            <button className="secondary" onClick={() => onDeleteJob(sourceJobId)} title="현재 보고 있는 작업과 artifact를 삭제합니다.">
              현재 작업 삭제
            </button>
          )}
        </div>
      </section>
      <ExternalStatusOverview report={report} />
      <JobExternalLogs jobId={sourceJobId} live={false} />
      <Artifact name="report.md" text={report} download={download} />
      {sourceJobId ? (
        <JobArtifactText jobId={sourceJobId} path="confidence.md" title="선택 작업의 confidence.md" />
      ) : (
        <Artifact
          name="confidence.md"
          text={confidenceMarkdown(confidence)}
          download={download}
        />
      )}
    </>
  );
}


export function JobExternalLogs({ jobId, live }: { jobId: string; live?: boolean }) {
  const [logs, setLogs] = useState<Array<{ path: string; text: string; bytes?: number; updatedAt?: string }>>([]);
  const [open, setOpen] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function load() {
      if (!jobId) { setLogs([]); return; }
      try {
        const r = await fetch(`/api/jobs/${jobId}/external-logs?maxChars=30000`, { cache: "no-store" });
        if (r.ok) {
          const j = await r.json();
          if (!cancelled) setLogs(Array.isArray(j.logs) ? j.logs : []);
        }
      } catch {}
      if (!cancelled && live) timer = window.setTimeout(load, 1200);
    }
    void load();
    return () => { cancelled = true; if (timer) window.clearTimeout(timer); };
  }, [jobId, live]);
  if (!jobId) return null;
  return (
    <section className="external-log-panel" title="SCALE-Sim과 IREE가 실제로 출력한 stdout/stderr 로그입니다.">
      <div className="external-log-header">
        <div>
          <b>SCALE-Sim / IREE 실시간 원본 로그</b>
          <p className="small">TileForge 진행 로그와 별개로 외부 도구의 실제 명령, cwd, stdout, stderr를 계속 tail합니다.</p>
        </div>
        <div className="external-log-actions">
          <label className="terminal-check" title="외부 도구 로그가 갱신될 때 각 로그 박스를 맨 아래로 이동합니다.">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} /> 자동 스크롤
          </label>
          <button className="secondary" onClick={() => setOpen((v) => !v)}>{open ? "접기" : "펼치기"}</button>
        </div>
      </div>
      {open && logs.length === 0 && <p className="small">아직 외부 도구 로그 파일이 생성되지 않았습니다. SCALE-Sim/IREE 단계에 진입하면 자동으로 표시됩니다.</p>}
      {open && logs.map((log) => {
        const status = externalLogStatus(log.text);
        return (
          <details key={log.path} open className="external-log-detail">
            <summary>
              {log.path} {log.bytes != null ? <span className="small">({fmtBytes(log.bytes)}, {log.updatedAt ? new Date(log.updatedAt).toLocaleTimeString() : ""})</span> : null}
              <span className={`badge ${status.className}`}>{status.label}</span>
            </summary>
            <AutoScrollLog text={log.text} className={`terminal-body external-log-body ${status.className}`} enabled={autoScroll} />
          </details>
        );
      })}
    </section>
  );
}

function AutoScrollLog({ text, className, enabled }: { text: string; className: string; enabled: boolean }) {
  const ref = useRef<HTMLPreElement | null>(null);
  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [text, enabled]);
  return <pre ref={ref} className={className}>{text}</pre>;
}


export function externalLogStatus(text: string): { label: string; className: string } {
  const exit = text.match(/exitCode:\s*(-?\d+)/)?.[1];
  const lower = text.toLowerCase();
  if (exit && exit !== "0") return { label: `실패 exit ${exit}`, className: "err-badge" };
  if (exit === "0" && lower.includes("warning:")) return { label: "경고 있음 · 성공", className: "warn-badge" };
  if (exit === "0") return { label: "성공", className: "ok-badge" };
  if (lower.includes("traceback") || lower.includes("error:")) return { label: "실패 가능", className: "err-badge" };
  if (lower.includes("warning:")) return { label: "경고", className: "warn-badge" };
  return { label: "실행 중", className: "" };
}

export function ExternalStatusOverview({ report }: { report: string }) {
  const items = parseExternalStatus(report);
  if (items.length === 0) return null;
  const verdict = report.match(/\*\*최종 판정:\s*([^*]+)\*\*/)?.[1]?.trim();
  return (
    <section className="external-status-cards" title="report.md의 2-1 섹션을 표 대신 카드로 정리한 요약입니다.">
      <div className="external-status-heading">
        <div>
          <b>실제 외부 도구 반영 상태</b>
          <p className="small">보고서의 2-1 섹션을 읽기 쉽게 카드로 재구성했습니다.</p>
        </div>
        {verdict ? <span className={`badge ${verdict === "성공" ? "ok-badge" : verdict.includes("대기") ? "warn-badge" : "err-badge"}`}>최종 판정: {verdict}</span> : null}
      </div>
      <div className="external-status-grid">
        {items.map((item) => (
          <article key={item.label} className={`external-status-card ${statusClass(item.status)}`}>
            <span className="small">{item.label}</span>
            <strong>{item.status}</strong>
            <p>{item.reason}</p>
          </article>
        ))}
      </div>
    </section>
  );
}

export function statusClass(status: string) {
  if (status.includes("적용") || status === "성공") return "ok-card";
  if (status.includes("대기") || status.includes("부분")) return "warn-card";
  if (status.includes("미반영") || status.includes("실패")) return "err-card";
  return "";
}

export function parseExternalStatus(report: string): Array<{ label: string; status: string; reason: string }> {
  const section = report.match(/## 2-1\. 실제 외부 도구 반영 상태\n([\s\S]*?)(?=\n## 2-2\.|\n## 3\.|$)/)?.[1] ?? "";
  const bulletRe = /- \*\*(.+?)\*\*:\s*([^\n]+)\n(?:\s+- 근거:\s*([^\n]+))?/g;
  const bulletItems: Array<{ label: string; status: string; reason: string }> = [];
  let match: RegExpExecArray | null;
  while ((match = bulletRe.exec(section))) {
    const label = match[1].trim();
    if (label === "해석") continue;
    bulletItems.push({ label, status: match[2].trim(), reason: (match[3] ?? "").trim() });
  }
  if (bulletItems.length) return bulletItems;
  const rows = section.split(/\r?\n/).filter((line) => line.startsWith("|") && !line.includes("---") && !line.includes("항목"));
  return rows.map((row) => {
    const cols = row.split("|").slice(1, -1).map((c) => c.trim());
    return { label: cols[0] ?? "", status: cols[1] ?? "", reason: cols[2] ?? "" };
  }).filter((item) => item.label);
}


export function fmtBytes(bytes: number | undefined): string {
  if (!Number.isFinite(bytes ?? NaN)) return "-";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = Number(bytes);
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

export function ResourceMonitor({ payload, onParallelChange }: { payload: any | null; onParallelChange: (value: number) => void }) {
  const cpu = payload?.cpu;
  const mem = payload?.memory;
  const capacity = payload?.capacity;
  const cores = Array.isArray(cpu?.cores) ? cpu.cores : [];
  const [parallelDraft, setParallelDraft] = useState(String(capacity?.parallelLimit ?? 2));
  useEffect(() => {
    if (capacity?.parallelLimit != null) setParallelDraft(String(capacity.parallelLimit));
  }, [capacity?.parallelLimit]);
  return (
    <section className="resource-panel" title="서버 프로세스가 보는 CPU/RAM 사용량과 job 병렬 실행 여유를 표시합니다.">
      <div className="resource-header">
        <h3>서버 리소스</h3>
        <span className="small">{payload?.createdAt ? `갱신 ${new Date(payload.createdAt).toLocaleTimeString()}` : "상태 수집 중"}</span>
      </div>
      <div className="resource-cards">
        <div className="resource-card">
          <b>CPU</b>
          <strong>{cpu?.sampleBased ? `${cpu.overallPct?.toFixed?.(1) ?? cpu.overallPct}%` : "측정 준비 중"}</strong>
          <div className="bar"><span style={{ width: `${Math.min(100, Number(cpu?.overallPct ?? 0))}%` }} /></div>
          <p className="small">코어 {cores.length || payload?.cpuCount || "-"}개</p>
        </div>
        <div className="resource-card">
          <b>RAM</b>
          <strong>{mem?.usedPct != null ? `${mem.usedPct}%` : "-"}</strong>
          <div className="bar"><span style={{ width: `${Math.min(100, Number(mem?.usedPct ?? 0))}%` }} /></div>
          <p className="small">{fmtBytes(mem?.usedBytes)} / {fmtBytes(mem?.totalBytes)}</p>
        </div>
        <div className="resource-card">
          <b>병렬 작업 슬롯</b>
          <strong>{capacity ? `${capacity.availableSlots}/${capacity.parallelLimit}` : "-"}</strong>
          <p className="small">running {capacity?.runningJobs ?? 0}, queued {capacity?.queuedJobs ?? 0}</p>
          <p className="small">{capacity?.note ?? "작업 상태를 불러오는 중입니다."}</p>
        </div>
      </div>
      <div className="parallel-config" title=".env의 TILEFORGE_MAX_PARALLEL_JOBS 값을 바꾸고 현재 서버 프로세스에도 즉시 반영합니다.">
        <div>
          <b>병렬 실행 수</b>
          <p className="small">큐에 들어간 작업을 동시에 몇 개까지 실행할지 설정합니다. 저장하면 .env에 반영됩니다.</p>
        </div>
        <div className="parallel-controls">
          <input
            type="number"
            min={1}
            max={32}
            value={parallelDraft}
            onChange={(e) => setParallelDraft(e.target.value)}
            title="동시에 실행할 최대 job 수입니다."
          />
          <button title="병렬 실행 수를 .env에 저장하고 현재 서버 프로세스에 반영합니다." onClick={() => onParallelChange(Number(parallelDraft))}>.env에 저장</button>
        </div>
      </div>
      {cores.length > 0 && (
        <div className="cpu-core-grid" title="코어별 CPU 사용률입니다. 첫 조회 직후에는 0으로 보일 수 있고, 다음 자동 갱신부터 실제 변화량 기반 값이 표시됩니다.">
          {cores.map((core: any) => (
            <div key={core.index} className="cpu-core">
              <span>CPU {core.index}</span>
              <b>{Number(core.usagePct ?? 0).toFixed(1)}%</b>
              <div className="mini-bar"><span style={{ width: `${Math.min(100, Number(core.usagePct ?? 0))}%` }} /></div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

export function StatusTab({
  text,
  payload,
  download,
  autoRefreshEnabled,
  setAutoRefreshEnabled,
  onParallelChange,
}: {
  text: string;
  payload: any | null;
  download: DownloadFn;
  autoRefreshEnabled: boolean;
  setAutoRefreshEnabled: (value: boolean) => void;
  onParallelChange: (value: number) => void;
}) {
  return (
    <>
      <div
        className="report-status-strip"
        title="시스템 상태는 주기적으로 자동 갱신됩니다."
      >
        <span
          className={`badge ${autoRefreshEnabled ? "ok-badge" : "warn-badge"}`}
        >
          {autoRefreshEnabled ? "자동 갱신 중" : "자동 갱신 꺼짐"}
        </span>
        <label className="terminal-check" title="켜면 시스템 상태와 작업 상태를 주기적으로 새로고칩니다.">
          <input
            type="checkbox"
            checked={autoRefreshEnabled}
            onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
          />{" "}
          3초마다 jobs/status 갱신
        </label>
      </div>
      <ResourceMonitor payload={payload} onParallelChange={onParallelChange} />
      <Artifact name="system-status.json" text={text} download={download} />
    </>
  );
}
