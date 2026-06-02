"use client";

import { useEffect, useRef, useState } from "react";

export function JobExternalLogs({
  jobId,
  live,
}: {
  jobId: string;
  live?: boolean;
}) {
  const [logs, setLogs] = useState<Array<{ path: string; text: string; bytes?: number; updatedAt?: string }>>([]);
  const [open, setOpen] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  useEffect(() => {
    let cancelled = false;
    let timer: number | undefined;
    async function load() {
      if (!jobId) {
        setLogs([]);
        return;
      }
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
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
    };
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
          <button className="secondary" title="외부 도구 로그 목록을 접거나 펼칩니다." onClick={() => setOpen((v) => !v)}>{open ? "접기" : "펼치기"}</button>
        </div>
      </div>
      {open && logs.length === 0 && (
        <p className="small">아직 외부 도구 로그 파일이 생성되지 않았습니다. SCALE-Sim/IREE 단계에 진입하면 자동으로 표시됩니다.</p>
      )}
      {open && logs.map((log) => {
        const status = externalLogStatus(log.text);
        return (
          <details key={log.path} open className="external-log-detail">
            <summary>
              {log.path}{" "}
              {log.bytes != null ? (
                <span className="small">({fmtBytes(log.bytes)}, {log.updatedAt ? new Date(log.updatedAt).toLocaleTimeString() : ""})</span>
              ) : null}
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

export function fmtBytes(bytes: number | undefined): string {
  if (!Number.isFinite(bytes ?? NaN)) return "-";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = Number(bytes);
  let i = 0;
  while (value >= 1024 && i < units.length - 1) {
    value /= 1024;
    i++;
  }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}
