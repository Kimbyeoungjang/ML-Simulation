"use client";

import { useEffect, useState } from "react";
import type { DownloadFn } from "./primitives";
import { Artifact } from "./primitives";

export function jobDisplayName(job: any): string {
  if (!job) return "작업 미선택";
  return String(job.name || job.request?.hardware?.name || job.id || "작업");
}

export function jobLabel(job: any): string {
  if (!job) return "작업 미선택";
  return `${jobDisplayName(job)} · ${job.status}`;
}

export function jobTooltip(job: any): string {
  if (!job) return "";
  const when = job.createdAt ? new Date(job.createdAt).toLocaleString() : "";
  return `${jobDisplayName(job)}${when ? " · 생성 " + when : ""}${job.id ? " · id " + job.id : ""}`;
}

export function jobById(payload: any | null, id: string) {
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  return jobs.find((j: any) => j.id === id);
}

export function ResultContextBar({
  jobsPayload,
  selectedJobId,
  onSelect,
}: {
  jobsPayload: any | null;
  selectedJobId: string;
  onSelect: (id: string) => void;
}) {
  const jobs = Array.isArray(jobsPayload?.jobs) ? jobsPayload.jobs : [];
  const artifactJobs = jobs.filter((j: any) => Array.isArray(j.artifacts) && j.artifacts.length > 0);
  const selected = jobById(jobsPayload, selectedJobId);
  return (
    <section className="result-context" title="오른쪽 결과 탭이 현재 입력값 미리보기인지, 특정 작업의 산출물인지 표시합니다.">
      <div>
        <b>결과 기준</b>
        <p className="small">
          {selected ? `${jobDisplayName(selected)}의 산출물을 보고 있습니다.` : "현재 입력 설정으로 계산한 estimator 미리보기를 보고 있습니다."}
        </p>
      </div>
      <div className="result-context-controls">
        <select value={selectedJobId} onChange={(e) => onSelect(e.target.value)} title="타일 정책, IREE, 내보내기, 보고서 탭에서 참조할 작업을 선택합니다.">
          <option value="">현재 입력 미리보기</option>
          {artifactJobs.map((j: any) => (
            <option key={j.id} value={j.id}>{jobLabel(j)}</option>
          ))}
        </select>
        {selected && <span className={`badge ${selected.status === "failed" ? "err-badge" : selected.status === "running" ? "warn-badge" : "ok-badge"}`}>{selected.status}</span>}
      </div>
    </section>
  );
}

export function JobSourceNotice({ jobId, jobsPayload, tabName }: { jobId: string; jobsPayload?: any | null; tabName: string }) {
  if (!jobId) return <p className="small source-notice">현재 입력 설정으로 계산한 {tabName} 미리보기입니다. 작업 결과를 보려면 위의 결과 기준에서 작업을 선택하세요.</p>;
  const job = jobById(jobsPayload, jobId);
  return <p className="small source-notice">작업 산출물 기준: <strong title={jobTooltip(job)}>{job ? jobDisplayName(job) : "선택 작업"}</strong>{job ? <span className="badge">{job.status}</span> : null}. 없는 항목은 현재 입력 미리보기로 대체됩니다.</p>;
}

export function CsvArtifactTable({ jobId, path, title }: { jobId: string; path: string; title: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!jobId) return;
      try {
        const r = await fetch(`/api/jobs/${jobId}/artifact?path=${encodeURIComponent(path)}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`${path} artifact를 읽지 못했습니다.`);
        const t = await r.text();
        if (!cancelled) { setText(t); setError(""); }
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e));
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [jobId, path]);
  if (!jobId) return null;
  if (error) return <p className="small warn">{title}: {error}</p>;
  if (!text) return <p className="small">{title}를 불러오는 중입니다.</p>;
  const rows = text.trim().split(/\r?\n/).map((line) => line.split(","));
  const header = rows[0] ?? [];
  const body = rows.slice(1);
  return (
    <section className="job-artifact-view">
      <div className="artifact-toolbar"><b>{title}</b><a className="help-link" href={`/api/jobs/${jobId}/artifact?path=${encodeURIComponent(path)}`} target="_blank">원본 열기</a></div>
      <div className="md-table-wrap"><table className="md-table"><thead><tr>{header.map((h, i) => <th key={i}>{h}</th>)}</tr></thead><tbody>{body.map((r, i) => <tr key={i}>{header.map((_, j) => <td key={j}>{r[j] ?? ""}</td>)}</tr>)}</tbody></table></div>
    </section>
  );
}


export function JobArtifactText({ jobId, path, title }: { jobId: string; path: string; title: string }) {
  const [text, setText] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!jobId) return;
      try {
        const r = await fetch(`/api/jobs/${jobId}/artifact?path=${encodeURIComponent(path)}`, { cache: "no-store" });
        if (!r.ok) throw new Error(`${path} artifact를 읽지 못했습니다.`);
        const t = await r.text();
        if (!cancelled) { setText(t); setError(""); }
      } catch (e: any) {
        if (!cancelled) setError(e.message || String(e));
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [jobId, path]);
  if (!jobId) return null;
  if (error) return <p className="small warn">{title}: {error}</p>;
  if (!text) return <p className="small">{title}를 불러오는 중입니다.</p>;
  return <Artifact name={path} text={text} download={(name, body) => {
    const blob = new Blob([body], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  }} />;
}

export function JobArtifactList({ jobId, jobsPayload }: { jobId: string; jobsPayload: any | null }) {
  const job = jobById(jobsPayload, jobId);
  const summaryArtifacts: string[] = Array.isArray(job?.artifacts) ? job.artifacts : [];
  const [loadedArtifacts, setLoadedArtifacts] = useState<string[]>([]);
  const [artifactListError, setArtifactListError] = useState("");
  const artifacts = loadedArtifacts.length ? loadedArtifacts : summaryArtifacts;
  const storageKey = `tileforge:selected-artifacts:${jobId}`;
  const [selected, setSelected] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    async function loadArtifacts() {
      if (!jobId) {
        setLoadedArtifacts([]);
        return;
      }
      try {
        const r = await fetch(`/api/jobs/${jobId}/artifacts`, { cache: "no-store" });
        if (!r.ok) throw new Error(`artifact list api ${r.status}`);
        const payload = await r.json();
        const names = Array.isArray(payload?.artifacts)
          ? payload.artifacts.map((a: any) => typeof a === "string" ? a : a?.name).filter(Boolean)
          : [];
        if (!cancelled) {
          setLoadedArtifacts(names);
          setArtifactListError("");
        }
      } catch (error: any) {
        if (!cancelled) setArtifactListError(error?.message ?? String(error));
      }
    }
    void loadArtifacts();
    return () => { cancelled = true; };
  }, [jobId]);

  useEffect(() => {
    if (!jobId) return;
    try {
      const raw = window.localStorage.getItem(storageKey);
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed)) setSelected(parsed.filter((x) => artifacts.includes(x)));
      else setSelected([]);
    } catch {
      setSelected([]);
    }
  }, [jobId, artifacts.join("|")]);

  useEffect(() => {
    if (!jobId) return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(selected));
    } catch {
      // best-effort UI state persistence only
    }
  }, [jobId, selected.join("|")]);

  if (!jobId) return null;
  if (artifactListError && !artifacts.length) return <p className="small warn">artifact 목록을 불러오지 못했습니다: {artifactListError}</p>;
  if (!artifacts.length) return <p className="small warn">선택한 작업의 artifact 목록이 아직 없습니다.</p>;

  const allSelected = selected.length === artifacts.length && artifacts.length > 0;
  const toggleOne = (artifactPath: string) => {
    setSelected((prev) => prev.includes(artifactPath) ? prev.filter((x) => x !== artifactPath) : [...prev, artifactPath]);
  };
  const selectAll = () => setSelected(artifacts);
  const clearAll = () => setSelected([]);
  const saveBlob = async (url: string, filename: string) => {
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) { alert(await r.text()); return; }
    const blob = await r.blob();
    const objectUrl = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(objectUrl);
  };
  const downloadArtifact = async (artifactPath: string) => {
    await saveBlob(`/api/jobs/${jobId}/artifact?path=${encodeURIComponent(artifactPath)}&download=1`, artifactPath.split(/[\\/]/).pop() || artifactPath);
  };
  const downloadSelected = async () => {
    const paths = selected.length ? selected : artifacts;
    const label = selected.length ? "selected" : "all";
    await saveBlob(`/api/jobs/${jobId}/bundle?paths=${encodeURIComponent(JSON.stringify(paths))}`, `tileforge-${jobId}-${label}.zip`);
  };

  return (
    <section className="job-artifact-view">
      <div className="artifact-list-header">
        <div>
          <h3>선택 작업 산출물</h3>
          <p className="small">체크한 산출물만 ZIP으로 내려받을 수 있습니다. 선택 상태는 작업별로 유지됩니다.</p>
        </div>
        <div className="artifact-actions">
          <button className="secondary" onClick={selectAll} disabled={allSelected}>모두 선택</button>
          <button className="secondary" onClick={clearAll} disabled={selected.length === 0}>모두 해제</button>
          <button onClick={downloadSelected}>{selected.length ? `선택 ${selected.length}개 다운로드` : "모두 다운로드"}</button>
        </div>
      </div>
      <div className="artifact-grid selectable-artifacts">
        {artifacts.map((a) => (
          <div key={a} className={`artifact-download artifact-card ${selected.includes(a) ? "selected" : ""}`} title={a}>
            <label className="artifact-select-label">
              <input type="checkbox" checked={selected.includes(a)} onChange={() => toggleOne(a)} />
              <span>{a}</span>
            </label>
            <button className="secondary tiny-download" onClick={() => downloadArtifact(a)}>다운로드</button>
          </div>
        ))}
      </div>
    </section>
  );
}

