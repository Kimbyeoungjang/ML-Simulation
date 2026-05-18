"use client";

import { useEffect, useRef } from "react";
import type { DownloadFn } from "./primitives";
import { ActionButton } from "./primitives";
import { JobExternalLogs, jobDisplayName, jobLabel, jobTooltip } from "./resultTabs";

export function Jobs({
  text,
  download,
  liveJobId,
  liveJob,
  liveLogs,
  liveConnected,
  autoScroll,
  setAutoScroll,
  onStop,
  autoRefreshEnabled,
  setAutoRefreshEnabled,
  jobsPayload,
  autoAttachNewJob,
  setAutoAttachNewJob,
  onWatchJob,
  onDeleteJob,
  selectedJobIds,
  setSelectedJobIds,
  onDeleteSelected,
  onCancelSelected,
  onCancelJob,
}: {
  text: string;
  download: DownloadFn;
  liveJobId: string;
  liveJob: any | null;
  liveLogs: string[];
  liveConnected: boolean;
  autoScroll: boolean;
  setAutoScroll: (value: boolean) => void;
  onStop: () => void;
  autoRefreshEnabled: boolean;
  setAutoRefreshEnabled: (value: boolean) => void;
  jobsPayload: any | null;
  autoAttachNewJob: boolean;
  setAutoAttachNewJob: (value: boolean) => void;
  onWatchJob: (id: string) => void;
  onDeleteJob: (id: string) => void;
  selectedJobIds: string[];
  setSelectedJobIds: (ids: string[]) => void;
  onDeleteSelected: (ids: string[]) => void;
  onCancelSelected: (ids: string[]) => void;
  onCancelJob: (id: string) => void;
}) {
  return (
    <>
      <ActionButton
        tip="현재 화면에 표시된 job JSON을 파일로 저장합니다."
        onClick={() => download("jobs.json", text, "application/json")}
      >
        작업 JSON 다운로드
      </ActionButton>
      <div
        className="report-status-strip"
        title="작업 목록과 시스템 상태 자동 갱신 여부입니다."
      >
        <span
          className={`badge ${autoRefreshEnabled ? "ok-badge" : "warn-badge"}`}
        >
          {autoRefreshEnabled ? "자동 갱신 중" : "자동 갱신 꺼짐"}
        </span>
        <label className="terminal-check">
          <input
            type="checkbox"
            checked={autoRefreshEnabled}
            onChange={(e) => setAutoRefreshEnabled(e.target.checked)}
          />{" "}
          3초마다 jobs/status 갱신
        </label>
        <label className="terminal-check" title="켜면 새 작업을 만들 때 실시간 콘솔이 그 작업으로 자동 전환됩니다. 끄면 현재 콘솔은 유지되고 큐 목록에만 추가됩니다.">
          <input
            type="checkbox"
            checked={autoAttachNewJob}
            onChange={(e) => setAutoAttachNewJob(e.target.checked)}
          />{" "}
          새 작업 생성 시 콘솔 자동 연결
        </label>
      </div>
      <p className="small" title="작업 API의 기능 요약입니다.">
        작업 목록은 자동으로 갱신됩니다. 각 작업은 stage 이력, 진행률, 로그,
        artifact, 취소, 삭제, SSE 실시간 업데이트를 포함합니다.
      </p>
      <QueueSummary payload={jobsPayload} activeJobId={liveJobId} onWatchJob={onWatchJob} onDeleteJob={onDeleteJob} onCancelJob={onCancelJob} selectedJobIds={selectedJobIds} setSelectedJobIds={setSelectedJobIds} onDeleteSelected={onDeleteSelected} onCancelSelected={onCancelSelected} />
      <LiveTerminal
        jobId={liveJobId}
        job={liveJob}
        logs={liveLogs}
        connected={liveConnected}
        autoScroll={autoScroll}
        setAutoScroll={setAutoScroll}
        onStop={onStop}
      />
      <JobExternalLogs jobId={liveJobId} live={liveConnected || liveJob?.status === "running"} />
      <details className="json-details">
        <summary title="작업의 원본 JSON을 펼쳐서 확인합니다.">
          작업 JSON 원본 보기
        </summary>
        <pre
          className="pre"
          title="최근 작업 목록 또는 실시간 작업 상태 JSON입니다."
        >
          {text}
        </pre>
      </details>
    </>
  );
}


export function QueueSummary({
  payload,
  activeJobId,
  onWatchJob,
  onDeleteJob,
  selectedJobIds,
  setSelectedJobIds,
  onDeleteSelected,
  onCancelSelected,
  onCancelJob,
}: {
  payload: any | null;
  activeJobId: string;
  onWatchJob: (id: string) => void;
  onDeleteJob: (id: string) => void;
  selectedJobIds: string[];
  setSelectedJobIds: (ids: string[]) => void;
  onDeleteSelected: (ids: string[]) => void;
  onCancelSelected: (ids: string[]) => void;
  onCancelJob: (id: string) => void;
}) {
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const queued = jobs.filter((j: any) => j.status === "queued");
  const running = jobs.filter((j: any) => j.status === "running");
  const counts = payload?.counts ?? {};
  const queuedTotal = Number(counts.queued ?? queued.length);
  const runningTotal = Number(counts.running ?? running.length);
  const recentDone = jobs.filter((j: any) => ["succeeded", "succeeded_with_warnings", "failed", "cancelled"].includes(j.status)).slice(0, 20);
  const visible = [...running, ...queued, ...recentDone];
  const visibleIds = visible.map((j: any) => j.id);
  const allVisibleSelected = visibleIds.length > 0 && visibleIds.every((id: string) => selectedJobIds.includes(id));
  const toggleOne = (id: string) => setSelectedJobIds(selectedJobIds.includes(id) ? selectedJobIds.filter((x) => x !== id) : [...selectedJobIds, id]);
  const toggleAll = () => setSelectedJobIds(allVisibleSelected ? selectedJobIds.filter((id) => !visibleIds.includes(id)) : Array.from(new Set([...selectedJobIds, ...visibleIds])));
  return (
    <section className="queue-panel" title="현재 worker 큐에 들어간 작업과 실행 중인 작업을 보여줍니다.">
      <div className="queue-header">
        <h3>작업 큐</h3>
        <div className="queue-badges">
          <span className="badge">running {runningTotal}</span>
          <span className="badge">queued {queuedTotal}</span>
          <span className="badge">total {payload?.total ?? jobs.length}</span>
          {payload?.view === "dashboard" && <span className="badge ok-badge">live dashboard</span>}
          <span className="badge">selected {selectedJobIds.length}</span>
          <button className="secondary" onClick={toggleAll} disabled={visible.length === 0}>{allVisibleSelected ? "전체 해제" : "표시 작업 전체 선택"}</button>
          <button className="secondary" onClick={() => onCancelSelected(selectedJobIds)} disabled={selectedJobIds.length === 0}>선택 중지</button>
          <button className="secondary danger-button" onClick={() => onDeleteSelected(selectedJobIds)} disabled={selectedJobIds.length === 0}>선택 삭제</button>
        </div>
      </div>
      {visible.length === 0 ? (
        <p className="small">현재 표시할 작업이 없습니다. full-pipeline을 실행하면 여기에 queued/running 상태가 나타납니다.</p>
      ) : (
        <div className="queue-scroll" title="작업 큐 목록입니다. 많은 작업이 있어도 이 영역 안에서 스크롤됩니다.">
          <table className="queue-table">
            <thead>
              <tr>
                <th><input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} title="표시된 작업 전체 선택" /></th>
                <th>상태</th>
                <th>이름</th>
                <th>단계</th>
                <th>진행률</th>
                <th>생성 시각</th>
                <th>보기</th>
                <th>중지</th>
                <th>삭제</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((job: any) => (
                <tr key={job.id} className={job.id === activeJobId ? "active-row" : ""}>
                  <td><input type="checkbox" checked={selectedJobIds.includes(job.id)} onChange={() => toggleOne(job.id)} title="삭제할 작업 선택" /></td>
                  <td><span className={`badge ${job.status === "running" ? "warn-badge" : job.status === "queued" ? "" : job.status === "failed" ? "err-badge" : "ok-badge"}`}>{job.status}</span></td>
                  <td title={jobTooltip(job)}>{jobDisplayName(job)}</td>
                  <td>{job.stage ?? "-"}</td>
                  <td>{Number(job.progress ?? 0)}%</td>
                  <td>{job.createdAt ? new Date(job.createdAt).toLocaleTimeString() : "-"}</td>
                  <td><button className="secondary" onClick={() => onWatchJob(job.id)}>{job.id === activeJobId ? "보는 중" : "콘솔 보기"}</button></td>
                  <td><button className="secondary" onClick={() => onCancelJob(job.id)} disabled={["succeeded", "failed", "cancelled", "succeeded_with_warnings"].includes(job.status)}>중지</button></td>
                  <td><button className="secondary danger-button" onClick={() => onDeleteJob(job.id)}>삭제</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="small">새 작업 생성 시 콘솔 자동 연결을 끄면 큐에는 추가되지만 현재 보고 있는 콘솔은 유지됩니다. 대량 큐에서는 running 작업과 다음 queued 작업을 우선 표시합니다.</p>
    </section>
  );
}

export function LiveTerminal({
  jobId,
  job,
  logs,
  connected,
  autoScroll,
  setAutoScroll,
  onStop,
}: {
  jobId: string;
  job: any | null;
  logs: string[];
  connected: boolean;
  autoScroll: boolean;
  setAutoScroll: (value: boolean) => void;
  onStop: () => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!autoScroll) return;
    const el = boxRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [logs, autoScroll]);
  const terminalLines = logs.length
    ? logs
    : [
        "[local] 실행 중인 작업을 만들거나 '실시간 로그 보기'를 누르면 여기에 로그가 표시됩니다.",
      ];
  const status = job?.status ?? (jobId ? "connecting" : "idle");
  const progress = Number(job?.progress ?? 0);
  return (
    <section
      className="terminal-panel"
      title="현재 선택한 작업의 로그를 CMD처럼 실시간으로 표시합니다."
    >
      <div className="terminal-header">
        <div>
          <span className={`terminal-dot ${connected ? "on" : "off"}`} />
          <b>실시간 작업 콘솔</b>
          <span className="terminal-meta">
            {job ? jobLabel(job) : "작업 미선택"}
          </span>
        </div>
        <div className="terminal-actions">
          <label
            className="terminal-check"
            title="새 로그가 들어올 때 자동으로 맨 아래로 이동합니다."
          >
            <input
              type="checkbox"
              checked={autoScroll}
              onChange={(e) => setAutoScroll(e.target.checked)}
            />{" "}
            자동 스크롤
          </label>
          {connected && (
            <button
              className="secondary"
              title="SSE 연결만 끊습니다. 작업 자체를 취소하지는 않습니다."
              onClick={onStop}
            >
              연결 중지
            </button>
          )}
        </div>
      </div>
      <div className="terminal-status">
        {job ? <span className="badge">name: {jobDisplayName(job)}</span> : null}
        <span className="badge">status: {status}</span>
        <span className="badge">stage: {job?.stage ?? "-"}</span>
        <span className="badge">progress: {progress}%</span>
        {job?.artifacts?.length ? (
          <span className="badge">artifacts: {job.artifacts.length}</span>
        ) : null}
      </div>
      <div className="terminal-progress" aria-label="작업 진행률">
        <span style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
      </div>
      <div className="terminal-body" ref={boxRef} role="log" aria-live="polite">
        {terminalLines.map((line, i) => (
          <div
            key={`${i}-${line.slice(0, 30)}`}
            className={`terminal-line ${classifyLogLine(line)}`}
          >
            <span className="terminal-prompt">
              {i === terminalLines.length - 1 && connected ? "▌" : ">"}
            </span>
            <span>{line}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

export function classifyLogLine(line: string) {
  const lower = line.toLowerCase();
  if (
    lower.includes("실패") ||
    lower.includes("error") ||
    lower.includes("failed") ||
    lower.includes("enoent")
  )
    return "err";
  if (
    lower.includes("warning") ||
    lower.includes("경고") ||
    lower.includes("건너뜀") ||
    lower.includes("skipped")
  )
    return "warn";
  if (
    lower.includes("완료") ||
    lower.includes("succeeded") ||
    lower.includes("job 완료") ||
    lower.includes("compile 완료")
  )
    return "ok";
  return "";
}
