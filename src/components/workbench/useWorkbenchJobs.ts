"use client";

import { apiFetch } from "@/lib/apiClient";
import { useEffect, useRef, useState } from "react";
import { jobDisplayName } from "@/components/workbench/resultTabs";
import type { ConfidenceAssessment } from "@/lib/confidence";
import type { Dataflow, HardwareConfig, SearchRequest } from "@/types/domain";
import { confidenceFromMarkdown } from "./confidenceMarkdown";
import { useLiveJobEvents } from "./useLiveJobEvents";

type JobsViewMode = "dashboard" | "paged";
type RefreshJobsOptions = { switchTab?: boolean; updateReport?: boolean; skipIfBusy?: boolean };

type UseWorkbenchJobsArgs = {
  request: SearchRequest;
  requestKey: string;
  hardware: HardwareConfig;
  dataflowModes: Dataflow[];
  openTab: (tab: "jobs" | "status") => void;
  setServerMessage: (message: string) => void;
};

function latestCompletedJobId(payload: any): string | undefined {
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  const completed = jobs.find(
    (j: any) =>
      ["succeeded", "succeeded_with_warnings"].includes(j?.status) &&
      (j?.hasReport || (Array.isArray(j?.artifacts) && j.artifacts.includes("report.md"))),
  );
  return completed?.id;
}

export function useWorkbenchJobs({
  request,
  requestKey,
  hardware,
  dataflowModes,
  openTab,
  setServerMessage,
}: UseWorkbenchJobsArgs) {
  const [jobsJson, setJobsJson] = useState("");
  const [jobsPayload, setJobsPayload] = useState<any | null>(null);
  const [jobsViewMode, setJobsViewMode] = useState<JobsViewMode>("paged");
  const [jobsPage, setJobsPage] = useState(1);
  const [jobsPageSize, setJobsPageSizeState] = useState(20);
  const [statusJson, setStatusJson] = useState("");
  const [statusPayload, setStatusPayload] = useState<any | null>(null);
  const [serverReportMarkdown, setServerReportMarkdown] = useState("");
  const [serverReportJobId, setServerReportJobId] = useState("");
  const [selectedJobConfidence, setSelectedJobConfidence] = useState<ConfidenceAssessment | null>(null);
  const [selectedJobConfidenceId, setSelectedJobConfidenceId] = useState("");
  const [reportAutoFollow, setReportAutoFollow] = useState(true);
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [autoAttachNewJob, setAutoAttachNewJob] = useState(false);
  const [analysisJobId, setAnalysisJobId] = useState("");
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const jobsRefreshInFlight = useRef(false);
  const statusRefreshInFlight = useRef(false);

  async function fetchJobReport(id: string, options: { manual?: boolean } = {}) {
    if (!id) return;
    try {
      const r = await apiFetch(`/api/jobs/${id}/artifacts/report.md`, {
        cache: "no-store",
      });
      if (!r.ok) return;
      const text = await r.text();
      if (text.trim()) {
        setServerReportMarkdown(text);
        setServerReportJobId(id);
        setAnalysisJobId(id);
        try {
          const cr = await apiFetch(`/api/jobs/${id}/artifacts/confidence.md`, {
            cache: "no-store",
          });
          if (cr.ok) {
            const parsed = confidenceFromMarkdown(await cr.text());
            setSelectedJobConfidence(parsed);
            setSelectedJobConfidenceId(parsed ? id : "");
          }
        } catch {
          setSelectedJobConfidence(null);
          setSelectedJobConfidenceId("");
        }
        if (options.manual) setReportAutoFollow(false);
      }
    } catch {
      // report.md may not exist until the job reaches the report stage.
    }
  }

  async function refreshJobs(options: RefreshJobsOptions = {}) {
    const { switchTab = true, updateReport = false, skipIfBusy = false } = options;
    if (skipIfBusy && jobsRefreshInFlight.current) return;
    jobsRefreshInFlight.current = true;
    const params = jobsViewMode === "dashboard"
      ? `limit=${jobsPageSize}&dashboard=1&external=0&t=${Date.now()}`
      : `limit=${jobsPageSize}&page=${jobsPage}&external=0&t=${Date.now()}`;
    let payload: any;
    try {
      const r = await apiFetch(`/api/jobs?${params}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`jobs api ${r.status}`);
      payload = await r.json();
    } catch (error: any) {
      setJobsJson(JSON.stringify({ ok: false, error: error?.message ?? String(error), previous: jobsPayload?.counts ?? null }, null, 2));
      return;
    } finally {
      jobsRefreshInFlight.current = false;
    }
    setJobsPayload(payload);
    const preview = { ...payload, jobs: Array.isArray(payload?.jobs) ? payload.jobs.slice(0, 20) : [] };
    setJobsJson(JSON.stringify({ ...preview, note: "jobs 원본 JSON 미리보기는 렌더링 비용을 줄이기 위해 최대 20개만 표시합니다. 전체 목록은 위 표와 페이지 이동을 사용하세요." }, null, 2));
    if (updateReport && reportAutoFollow) {
      const activeCount = Number(payload?.counts?.running ?? 0) + Number(payload?.counts?.queued ?? 0);
      const id = latestCompletedJobId(payload);
      // Avoid polling report.md forever while the system is idle. During active
      // runs, auto-follow the newest completed report unless the user manually
      // selected a specific report.
      if (activeCount > 0 && id && id !== serverReportJobId) void fetchJobReport(id);
    }
    if (switchTab) openTab("jobs");
  }

  async function refreshStatus(switchTab = true, options: { skipIfBusy?: boolean } = {}) {
    if (options.skipIfBusy && statusRefreshInFlight.current) return;
    statusRefreshInFlight.current = true;
    try {
      const r = await apiFetch("/api/system/status", { cache: "no-store" });
      if (!r.ok) throw new Error(`status api ${r.status}`);
      const payload = await r.json();
      setStatusPayload(payload);
      setStatusJson(JSON.stringify(payload, null, 2));
      if (switchTab) openTab("status");
    } catch (error: any) {
      setStatusJson(JSON.stringify({ ok: false, error: error?.message ?? String(error), previous: statusPayload?.summary ?? null }, null, 2));
    } finally {
      statusRefreshInFlight.current = false;
    }
  }

  const {
    liveJobId,
    liveJob,
    liveLogs,
    liveConnected,
    liveAutoScroll,
    setLiveAutoScroll,
    startLiveJob,
    stopLiveJob,
  } = useLiveJobEvents({
    setJobsJson,
    openJobsTab: () => openTab("jobs"),
    fetchJobReport,
    refreshJobs,
    refreshStatus,
  });

  useEffect(() => {
    void refreshJobs({ switchTab: false, updateReport: false });
    void refreshStatus(false);
    const timer = window.setInterval(() => {
      if (!autoRefreshEnabled) return;
      void refreshJobs({ switchTab: false, updateReport: false, skipIfBusy: true });
      void refreshStatus(false, { skipIfBusy: true });
    }, 15000);
    return () => {
      window.clearInterval(timer);
    };
  }, [autoRefreshEnabled, jobsViewMode, jobsPage, jobsPageSize]);

  useEffect(() => {
    setServerReportMarkdown("");
    setServerReportJobId("");
    setReportAutoFollow(true);
  }, [requestKey]);

  async function createJob(kind = "full-pipeline", allSelectedDataflows = true) {
    const modes = allSelectedDataflows ? (dataflowModes.length ? dataflowModes : [hardware.dataflow]) : [hardware.dataflow];
    const created: any[] = [];
    for (const df of modes) {
      const dfHardware = { ...hardware, dataflow: df };
      const dfRequest = { ...request, hardware: dfHardware };
      const suffix = modes.length > 1 ? `_${df}` : "";
      const r = await apiFetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, name: `${dfHardware.name}_${kind}${suffix}`, request: dfRequest }),
      });
      created.push(await r.json());
    }
    const names = created.map((j) => j.name ?? j.id).filter(Boolean).join(", ");
    setServerMessage(`${kind} 작업 ${created.length}개 생성 완료: ${names}`);
    await refreshJobs({ switchTab: true, updateReport: true });
    if (created[0]?.id && autoAttachNewJob) startLiveJob(created[0].id);
  }

  async function deleteJobById(id: string) {
    if (!id) return;
    if (!window.confirm(`작업 ${id}와 관련 artifact를 삭제할까요?`)) return;
    const r = await apiFetch(`/api/jobs/${id}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({ ok: false }));
    setServerMessage(`삭제 결과: ${j.ok ? "성공" : "실패"}`);
    if (serverReportJobId === id) {
      setServerReportMarkdown("");
      setServerReportJobId("");
    }
    if (analysisJobId === id) setAnalysisJobId("");
    setSelectedJobIds((prev) => prev.filter((x) => x !== id));
    if (liveJobId === id) stopLiveJob();
    await refreshJobs({ switchTab: false, updateReport: true });
    await refreshStatus(false);
  }

  async function deleteJobsByIds(ids: string[]) {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (unique.length === 0) return;
    if (!window.confirm(`선택한 작업 ${unique.length}개와 관련 artifact를 삭제할까요?`)) return;
    const r = await apiFetch(`/api/jobs`, {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ids: unique }),
    });
    const payload = await r.json().catch(() => ({ deleted: 0 }));
    const ok = Number(payload?.deleted ?? 0);
    setSelectedJobIds((prev) => prev.filter((id) => !unique.includes(id)));
    if (unique.includes(serverReportJobId)) {
      setServerReportMarkdown("");
      setServerReportJobId("");
    }
    if (unique.includes(analysisJobId)) setAnalysisJobId("");
    if (unique.includes(liveJobId)) stopLiveJob();
    setServerMessage(`선택 작업 삭제 완료: ${ok}/${unique.length}`);
    await refreshJobs({ switchTab: false, updateReport: true });
    await refreshStatus(false);
  }

  async function cancelJobById(id: string) {
    if (!id) return;
    const r = await apiFetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    const j = await r.json().catch(() => ({}));
    setServerMessage(`중지 요청: ${jobDisplayName(j) || id} (${j.status ?? "요청됨"})`);
    await refreshJobs({ switchTab: false, updateReport: true });
  }

  async function cancelJobsByIds(ids: string[]) {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (unique.length === 0) return;
    if (!window.confirm(`선택한 작업 ${unique.length}개를 중지할까요? 실행 중인 외부 프로세스는 다음 체크포인트에서 취소됩니다.`)) return;
    const r = await apiFetch(`/api/jobs`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel", ids: unique }),
    });
    const payload = await r.json().catch(() => ({ cancelled: 0 }));
    const ok = Number(payload?.cancelled ?? 0);
    setServerMessage(`선택 작업 중지 요청 완료: ${ok}/${unique.length}`);
    await refreshJobs({ switchTab: false, updateReport: true });
    await refreshStatus(false);
  }

  async function deleteJobPrompt(id?: string) {
    const target = id || prompt("삭제할 작업 ID를 입력하세요.");
    if (!target) return;
    await deleteJobById(target);
  }

  async function cancelJob(id?: string) {
    const target = id || prompt("취소할 작업 ID를 입력하세요.");
    if (!target) return;
    await cancelJobById(target);
  }

  async function runDoctorCheck() {
    const r = await apiFetch("/api/doctor");
    const j = await r.json();
    setServerMessage(
      `진단 ${j.ok ? "정상" : "확인 필요"}: ${j.checks.map((c: any) => `${c.name}=${c.ok ? "정상" : "경고"}`).join(", ")}`,
    );
  }

  function watchJob(id?: string) {
    const target = id || prompt("실시간으로 볼 작업 ID를 입력하세요.");
    if (!target) return;
    startLiveJob(target);
  }

  async function updateParallelJobs(value: number) {
    const r = await apiFetch("/api/system/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxParallelJobs: value }),
    });
    const j = await r.json();
    if (!r.ok) return setServerMessage(j.error || "병렬 작업 수 저장에 실패했습니다.");
    setServerMessage(`병렬 작업 수를 ${j.maxParallelJobs}로 저장했습니다. .env의 TILEFORGE_MAX_PARALLEL_JOBS를 갱신했습니다.`);
    await refreshStatus(false);
  }

  function setJobsPageSize(value: number) {
    setJobsPageSizeState(value);
    setJobsPage(1);
  }

  return {
    jobsJson,
    jobsPayload,
    jobsViewMode,
    setJobsViewMode,
    jobsPage,
    setJobsPage,
    jobsPageSize,
    setJobsPageSize,
    statusJson,
    statusPayload,
    serverReportMarkdown,
    serverReportJobId,
    selectedJobConfidence,
    selectedJobConfidenceId,
    autoRefreshEnabled,
    setAutoRefreshEnabled,
    autoAttachNewJob,
    setAutoAttachNewJob,
    analysisJobId,
    setAnalysisJobId,
    selectedJobIds,
    setSelectedJobIds,
    liveJobId,
    liveJob,
    liveLogs,
    liveConnected,
    liveAutoScroll,
    setLiveAutoScroll,
    startLiveJob,
    stopLiveJob,
    createJob,
    fetchJobReport,
    refreshJobs,
    deleteJobById,
    deleteJobsByIds,
    cancelJobById,
    cancelJobsByIds,
    deleteJobPrompt,
    runDoctorCheck,
    cancelJob,
    refreshStatus,
    watchJob,
    updateParallelJobs,
  };
}
