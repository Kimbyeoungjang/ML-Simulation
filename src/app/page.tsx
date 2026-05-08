"use client";

import Link from "next/link";
import type { ElementType } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { conv2dToGemm } from "@/lib/conv";
import { parseShapesCsv } from "@/lib/csv";
import { parseMeasurementCsv, profileToMarkdown } from "@/lib/calibration";
import {
  defaultArraySweep,
  defaultCandidates,
  defaultHardware,
  defaultShapes,
} from "@/lib/defaults";
import { estimateAll, sweepArrays } from "@/lib/estimator";
import { parseNumList, fmt } from "@/lib/math";
import { hardwarePresets, workloadPresets } from "@/lib/presets";
import { bottleneckMarkdown } from "@/lib/bottleneck";
import { rooflineMarkdown } from "@/lib/roofline";
import { energyMarkdown } from "@/lib/energy";
import { analyzeFusion, fusionMarkdown } from "@/lib/fusion";
import { validityMarkdown } from "@/lib/validity";
import { assessConfidence, confidenceMarkdown } from "@/lib/confidence";
import { totalCycleUncertainty } from "@/lib/uncertainty";
import type {
  CalibrationProfile,
  Conv2DShape,
  Dataflow,
  HardwareConfig,
  MatmulShape,
  Objective,
  SearchRequest,
  ScaleSimOverrides,
} from "@/types/domain";

type Tab =
  | "policy"
  | "bottleneck"
  | "roofline"
  | "energy"
  | "array"
  | "calibration"
  | "iree"
  | "exports"
  | "graphs"
  | "report"
  | "jobs"
  | "status";
type InputTab =
  | "presets"
  | "hardware"
  | "tiling"
  | "scalesim"
  | "workload"
  | "conv"
  | "calibration"
  | "tools";

type DownloadFn = (name: string, text: string, type?: string) => void;

const tabLabels: Record<Tab, string> = {
  policy: "타일 정책",
  bottleneck: "병목 분석",
  roofline: "루프라인",
  energy: "에너지",
  array: "배열 비교",
  calibration: "보정",
  iree: "IREE",
  exports: "내보내기",
  graphs: "그래프",
  report: "보고서",
  jobs: "작업",
  status: "상태",
};

const inputTabLabels: Record<InputTab, string> = {
  presets: "프리셋",
  hardware: "하드웨어",
  tiling: "타일링",
  scalesim: "SCALE-Sim",
  workload: "워크로드",
  conv: "Conv 변환",
  calibration: "보정",
  tools: "도구/실행",
};

const inputTabTips: Record<InputTab, string> = {
  presets: "자주 쓰는 하드웨어/워크로드 프리셋을 선택합니다.",
  hardware:
    "배열 크기, 주파수, SRAM, 데이터플로우, 에너지/메모리 파라미터를 설정합니다.",
  tiling: "tileM/tileN/tileK 후보와 최적화 목표를 설정합니다.",
  scalesim: "SCALE-Sim의 SRAM/DRAM bandwidth, layout, bank 파라미터를 세부 설정합니다.",
  workload: "CSV, ONNX, JSON에서 GEMM workload shape를 가져옵니다.",
  conv: "Conv2D 파라미터를 im2col GEMM shape로 변환합니다.",
  calibration: "실측 cycle CSV를 사용해 estimator 보정 계수를 적용합니다.",
  tools:
    "서버 추정, 프로젝트 저장, full-pipeline 실행, 상태 진단을 수행합니다.",
};

const tabTips: Record<Tab, string> = {
  policy: "각 연산별 최적 타일 후보와 예상 사이클, 활용률을 확인합니다.",
  bottleneck: "전체 실행 시간에서 비중이 큰 연산과 병목 원인을 요약합니다.",
  roofline:
    "연산 집약도 기준으로 compute-bound인지 memory-bound인지 판단합니다.",
  energy: "MAC, SRAM, DRAM 접근 기반의 간단한 에너지 추정을 표시합니다.",
  array: "여러 systolic array 크기를 비교하여 설계 후보를 고릅니다.",
  calibration: "실측값 CSV로 적용한 보정 계수와 보정 보고서를 확인합니다.",
  iree: "생성된 MLIR과 IREE 실행 명령을 확인하고 다운로드합니다.",
  exports: "SCALE-Sim, LaTeX, SVG, manifest 등 산출물을 내려받습니다.",
  graphs: "타일 후보별 cycle/utilization 차이를 그래프로 비교합니다.",
  report: "현재 실험 설정과 결과를 논문/보고서용 Markdown으로 확인합니다.",
  jobs: "백그라운드 작업의 상태, 로그, artifact 정보를 확인합니다.",
  status: "로컬 서버, 저장소, 워커, 외부 도구 상태를 JSON으로 확인합니다.",
};

function FieldLabel({
  children,
  tip,
}: {
  children: React.ReactNode;
  tip: string;
}) {
  return (
    <label title={tip}>
      {children}
      <span className="hint" aria-hidden="true">
        ?
      </span>
    </label>
  );
}

function ActionButton({
  children,
  tip,
  className,
  onClick,
}: {
  children: React.ReactNode;
  tip: string;
  className?: string;
  onClick: () => void;
}) {
  return (
    <button className={className} title={tip} onClick={onClick}>
      {children}
    </button>
  );
}

function MiniField({
  label,
  tip,
  children,
}: {
  label: string;
  tip?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="mini-field" title={tip}>
      <span>{label}</span>
      {children}
    </div>
  );
}

export default function Home() {
  const [hardware, setHardware] = useState<HardwareConfig>(defaultHardware);
  const [dataflowModes, setDataflowModes] = useState<Dataflow[]>([defaultHardware.dataflow]);
  const [inputTab, setInputTab] = useState<InputTab>("presets");
  const [shapes, setShapes] = useState<MatmulShape[]>(defaultShapes);
  const [objective, setObjective] = useState<Objective>("balanced");
  const [tileM, setTileM] = useState(defaultCandidates.tileM.join(", "));
  const [tileN, setTileN] = useState(defaultCandidates.tileN.join(", "));
  const [tileK, setTileK] = useState(defaultCandidates.tileK.join(", "));
  const [scaleSim, setScaleSim] = useState<ScaleSimOverrides>({
    runName: "tileforge_generated",
    bandwidth: 128,
    interfaceBandwidth: "USER",
    useLayout: true,
    ifmapCustomLayout: false,
    filterCustomLayout: false,
    ifmapSRAMBankBandwidth: 10,
    ifmapSRAMBankNum: 10,
    ifmapSRAMBankPort: 2,
    filterSRAMBankBandwidth: 10,
    filterSRAMBankNum: 10,
    filterSRAMBankPort: 2,
    emitLayoutSection: false,
  });
  const [csvText, setCsvText] = useState(
    "id,model,op_name,m,n,k,dtype_bytes\nbert_q,bert,query,384,768,768,2",
  );
  const [manualShape, setManualShape] = useState<MatmulShape>({
    id: "manual_matmul",
    model: "custom",
    opName: "matmul",
    m: 128,
    n: 128,
    k: 128,
    dtypeBytes: 2,
    source: "manual",
  });
  const [tab, setTab] = useState<Tab>("policy");
  const [serverMessage, setServerMessage] = useState("");
  const [jobsJson, setJobsJson] = useState("");
  const [jobsPayload, setJobsPayload] = useState<any | null>(null);
  const [statusJson, setStatusJson] = useState("");
  const [statusPayload, setStatusPayload] = useState<any | null>(null);
  const [serverReportMarkdown, setServerReportMarkdown] = useState("");
  const [serverReportJobId, setServerReportJobId] = useState("");
  const [autoRefreshEnabled, setAutoRefreshEnabled] = useState(true);
  const [liveJobId, setLiveJobId] = useState("");
  const [liveJob, setLiveJob] = useState<any | null>(null);
  const [liveLogs, setLiveLogs] = useState<string[]>([]);
  const [liveConnected, setLiveConnected] = useState(false);
  const [liveAutoScroll, setLiveAutoScroll] = useState(true);
  const [autoAttachNewJob, setAutoAttachNewJob] = useState(false);
  const [customPresets, setCustomPresets] = useState<any[]>([]);
  const [userHardwarePresets, setUserHardwarePresets] = useState<any[]>([]);
  const [userWorkloadPresets, setUserWorkloadPresets] = useState<any[]>([]);
  const [customPresetName, setCustomPresetName] = useState("");
  const [hardwarePresetName, setHardwarePresetName] = useState("");
  const [workloadPresetName, setWorkloadPresetName] = useState("");
  const [analysisJobId, setAnalysisJobId] = useState("");
  const analysisJobIdRef = useRef("");
  const serverReportJobIdRef = useRef("");
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const liveEventSource = useRef<EventSource | null>(null);
  const [calibrationCsv, setCalibrationCsv] = useState(
    "model,op_name,array,dataflow,predicted_cycles,measured_cycles\nvit_s,qkv,128x128,WS,1000000,1120000",
  );
  const [calibrationRow, setCalibrationRow] = useState({
    model: "vit_s",
    opName: "qkv",
    array: "128x128",
    dataflow: "WS",
    predictedCycles: 1000000,
    measuredCycles: 1120000,
  });
  const [calibration, setCalibration] = useState<
    CalibrationProfile | undefined
  >(undefined);
  const [conv, setConv] = useState<Conv2DShape>({
    id: "conv0",
    model: "cnn",
    opName: "conv2d_0",
    batch: 1,
    inputH: 224,
    inputW: 224,
    inputC: 3,
    outputC: 64,
    kernelH: 7,
    kernelW: 7,
    strideH: 2,
    strideW: 2,
    padH: 3,
    padW: 3,
    dilationH: 1,
    dilationW: 1,
    dtypeBytes: 2,
  });

  const candidates = useMemo(
    () => ({
      tileM: parseNumList(tileM),
      tileN: parseNumList(tileN),
      tileK: parseNumList(tileK),
    }),
    [tileM, tileN, tileK],
  );
  const request: SearchRequest = {
    hardware: { ...hardware, dataflow: dataflowModes[0] ?? hardware.dataflow },
    shapes,
    candidates,
    objective,
    maxResultsPerOp: 24,
    calibration,
    scaleSim,
  };
  const effectiveHardwarePresets = useMemo(
    () => [...hardwarePresets, ...userHardwarePresets.map((p: any) => p.hardware).filter(Boolean)],
    [userHardwarePresets],
  );
  const effectiveWorkloadPresets = useMemo(() => {
    const map: Record<string, MatmulShape[]> = { ...workloadPresets };
    for (const p of userWorkloadPresets) {
      if (p?.name && Array.isArray(p?.shapes)) map[p.name] = p.shapes;
    }
    return map;
  }, [userWorkloadPresets]);
  const result = useMemo(() => estimateAll(request), [JSON.stringify(request)]);
  const confidence = useMemo(
    () =>
      assessConfidence(result, {
        calibrationSamples: calibration?.samples.length ?? 0,
      }),
    [JSON.stringify(result.summary), calibration?.samples.length],
  );
  const uncertainty = useMemo(
    () => totalCycleUncertainty(result),
    [JSON.stringify(result.summary)],
  );
  const arraySweep = useMemo(
    () =>
      sweepArrays({
        baseHardware: hardware,
        shapes,
        candidates,
        arrays: defaultArraySweep,
        objective,
      }),
    [JSON.stringify(request)],
  );

  useEffect(() => {
    analysisJobIdRef.current = analysisJobId;
  }, [analysisJobId]);

  useEffect(() => {
    serverReportJobIdRef.current = serverReportJobId;
  }, [serverReportJobId]);

  useEffect(() => {
    void refreshPresets();
  }, []);

  async function refreshPresets() {
    try {
      const r = await fetch("/api/presets", { cache: "no-store" });
      if (!r.ok) throw new Error("프리셋 목록을 불러오지 못했습니다.");
      const data = await r.json();
      setCustomPresets(Array.isArray(data.presets) ? data.presets : []);
      setUserHardwarePresets(Array.isArray(data.hardwarePresets) ? data.hardwarePresets : []);
      setUserWorkloadPresets(Array.isArray(data.workloadPresets) ? data.workloadPresets : []);
    } catch (error: any) {
      setServerMessage(error?.message ?? String(error));
    }
  }

  function persistCustomPresets(next: any[]) {
    setCustomPresets(next);
  }

  useEffect(() => {
    void refreshJobs({ switchTab: false, updateReport: true });
    void refreshStatus(false);
    const timer = window.setInterval(() => {
      if (!autoRefreshEnabled) return;
      void refreshJobs({ switchTab: false, updateReport: true });
      void refreshStatus(false);
    }, 3000);
    return () => {
      window.clearInterval(timer);
      liveEventSource.current?.close();
    };
  }, [autoRefreshEnabled]);

  useEffect(() => {
    if (!analysisJobIdRef.current) {
      setServerReportMarkdown("");
      setServerReportJobId("");
      serverReportJobIdRef.current = "";
    }
  }, [JSON.stringify(request)]);

  function startLiveJob(id: string) {
    const trimmed = id.trim();
    if (!trimmed) return;
    liveEventSource.current?.close();
    setLiveJobId(trimmed);
    setLiveJob(null);
    setLiveLogs([`[local] 작업 ${trimmed} 실시간 로그 연결 중...`]);
    setLiveConnected(true);
    setTab("jobs");
    const es = new EventSource(`/api/jobs/${trimmed}/events?tail=1000`);
    liveEventSource.current = es;
    es.addEventListener("job", (ev: any) => {
      const data = JSON.parse(ev.data);
      setLiveJob(data);
      setLiveLogs(data.logs ?? []);
      setJobsJson(JSON.stringify(data, null, 2));
    });
    es.addEventListener("done", (ev: any) => {
      try {
        const data = JSON.parse(ev.data);
        setLiveLogs((prev) => [...prev, `[local] 작업 종료: ${data.status}`]);
      } catch {
        setLiveLogs((prev) => [...prev, "[local] 작업 종료"]);
      }
      setLiveConnected(false);
      es.close();
      if (liveEventSource.current === es) liveEventSource.current = null;
      void fetchJobReport(trimmed);
      void refreshJobs({ switchTab: false, updateReport: true });
      void refreshStatus(false);
    });
    es.addEventListener("error", () => {
      setLiveConnected(false);
      setLiveLogs((prev) => [
        ...prev,
        "[local] 실시간 로그 연결이 끊겼습니다. 작업 새로고침으로 최종 상태를 확인하세요.",
      ]);
      es.close();
      if (liveEventSource.current === es) liveEventSource.current = null;
    });
  }

  function stopLiveJob() {
    liveEventSource.current?.close();
    liveEventSource.current = null;
    setLiveConnected(false);
    setLiveLogs((prev) => [
      ...prev,
      "[local] 실시간 로그 연결을 중지했습니다.",
    ]);
  }

  const updateHw = (patch: Partial<HardwareConfig>) =>
    setHardware((h) => ({ ...h, ...patch }));
  const updateScaleSim = (patch: Partial<ScaleSimOverrides>) =>
    setScaleSim((s) => ({ ...s, ...patch }));
  const download: DownloadFn = (name, text, type = "text/plain") => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  async function runServerEstimate() {
    const r = await fetch("/api/estimate", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...request, arraySweep: defaultArraySweep }),
    });
    const j = await r.json();
    setServerMessage(
      `서버 추정 완료: ${j.results.length}개 연산, ${j.summary.totalCycles.toLocaleString()} cycles`,
    );
  }
  async function saveProject() {
    const r = await fetch("/api/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: result.artifacts.projectJson,
    });
    setServerMessage(`프로젝트 저장 완료: ${(await r.json()).path}`);
  }
  async function loadProject() {
    const r = await fetch("/api/project");
    if (!r.ok) return setServerMessage("저장된 프로젝트가 없습니다.");
    const p = await r.json();
    setHardware(p.hardware);
    setDataflowModes([p.hardware?.dataflow ?? "WS"] as Dataflow[]);
    setShapes(p.shapes);
    setObjective(p.objective);
    if (p.scaleSim) setScaleSim((cur) => ({ ...cur, ...p.scaleSim }));
    setTileM(p.candidates.tileM.join(", "));
    setTileN(p.candidates.tileN.join(", "));
    setTileK(p.candidates.tileK.join(", "));
    setServerMessage(".tileforge/project.json을 불러왔습니다.");
  }
  async function createJob(kind: string) {
    const modes = dataflowModes.length ? dataflowModes : [hardware.dataflow];
    const created: any[] = [];
    for (const df of modes) {
      const dfHardware = { ...hardware, dataflow: df };
      const dfRequest = { ...request, hardware: dfHardware };
      const suffix = modes.length > 1 ? `_${df}` : "";
      const r = await fetch("/api/jobs", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind, name: `${dfHardware.name}_${kind}${suffix}`, request: dfRequest }),
      });
      created.push(await r.json());
    }
    const names = created.map((j) => j.name ?? j.id).filter(Boolean).join(", ");
    setServerMessage(`${kind} 작업 ${created.length}개 생성 완료: ${names}`);
    if (created[0]?.id) {
      analysisJobIdRef.current = created[0].id;
      setAnalysisJobId(created[0].id);
      void fetchJobReport(created[0].id);
    }
    await refreshJobs({ switchTab: true, updateReport: true });
    if (created[0]?.id && autoAttachNewJob) startLiveJob(created[0].id);
  }
  async function fetchJobReport(id: string) {
    if (!id) {
      setServerReportMarkdown("");
      setServerReportJobId("");
      serverReportJobIdRef.current = "";
      return;
    }
    try {
      const r = await fetch(`/api/jobs/${id}/artifact?path=${encodeURIComponent("report.md")}`, {
        cache: "no-store",
      });
      if (!r.ok) {
        setServerReportMarkdown("");
        setServerReportJobId("");
        return;
      }
      const text = await r.text();
      if (text.trim()) {
        setServerReportMarkdown(text);
        setServerReportJobId(id);
        serverReportJobIdRef.current = id;
      }
    } catch {
      setServerReportMarkdown("");
      setServerReportJobId("");
    }
  }

  function latestCompletedJobId(payload: any): string | undefined {
    const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
    const completed = jobs.find(
      (j: any) =>
        ["succeeded", "succeeded_with_warnings"].includes(j?.status) &&
        Array.isArray(j?.artifacts) &&
        j.artifacts.includes("report.md"),
    );
    return completed?.id;
  }

  async function refreshJobs(
    options: { switchTab?: boolean; updateReport?: boolean; autoSelectReport?: boolean } = {},
  ) {
    const { switchTab = true, updateReport = false, autoSelectReport = false } = options;
    const r = await fetch("/api/jobs?limit=50", { cache: "no-store" });
    const payload = await r.json();
    setJobsPayload(payload);
    setJobsJson(JSON.stringify(payload, null, 2));
    if (updateReport) {
      const selectedId = analysisJobIdRef.current;
      if (selectedId) {
        if (serverReportJobIdRef.current !== selectedId) void fetchJobReport(selectedId);
      } else if (autoSelectReport) {
        const id = latestCompletedJobId(payload);
        if (id && id !== serverReportJobIdRef.current) {
          analysisJobIdRef.current = id;
          setAnalysisJobId(id);
          void fetchJobReport(id);
        }
      }
    }
    if (switchTab) setTab("jobs");
  }
  async function deleteJobById(id: string) {
    if (!id) return;
    if (!window.confirm(`작업 ${id}와 관련 artifact를 삭제할까요?`)) return;
    const r = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({ ok: false }));
    setServerMessage(`삭제 결과: ${j.ok ? "성공" : "실패"}`);
    if (serverReportJobId === id) {
      setServerReportMarkdown("");
      setServerReportJobId("");
      serverReportJobIdRef.current = "";
    }
    if (analysisJobId === id) {
      analysisJobIdRef.current = "";
      setAnalysisJobId("");
    }
    setSelectedJobIds((prev) => prev.filter((x) => x !== id));
    if (liveJobId === id) stopLiveJob();
    await refreshJobs({ switchTab: false, updateReport: true });
    await refreshStatus(false);
  }



  async function deleteJobsByIds(ids: string[]) {
    const unique = Array.from(new Set(ids.filter(Boolean)));
    if (unique.length === 0) return;
    if (!window.confirm(`선택한 작업 ${unique.length}개와 관련 artifact를 삭제할까요?`)) return;
    let ok = 0;
    for (const id of unique) {
      const r = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
      if (r.ok) ok += 1;
    }
    setSelectedJobIds((prev) => prev.filter((id) => !unique.includes(id)));
    if (unique.includes(serverReportJobId)) {
      setServerReportMarkdown("");
      setServerReportJobId("");
      serverReportJobIdRef.current = "";
    }
    if (unique.includes(analysisJobId)) {
      analysisJobIdRef.current = "";
      setAnalysisJobId("");
    }
    if (unique.includes(liveJobId)) stopLiveJob();
    setServerMessage(`선택 작업 삭제 완료: ${ok}/${unique.length}`);
    await refreshJobs({ switchTab: false, updateReport: true });
    await refreshStatus(false);
  }

  async function cancelJobById(id: string) {
    if (!id) return;
    const r = await fetch(`/api/jobs/${id}`, {
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
    let ok = 0;
    for (const id of unique) {
      const r = await fetch(`/api/jobs/${id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (r.ok) ok += 1;
    }
    setServerMessage(`선택 작업 중지 요청 완료: ${ok}/${unique.length}`);
    await refreshJobs({ switchTab: false, updateReport: true });
    await refreshStatus(false);
  }

  async function deleteJobPrompt() {
    const id = prompt("삭제할 작업 ID를 입력하세요.");
    if (!id) return;
    await deleteJobById(id);
  }
  async function cancelJob() {
    const id = prompt("취소할 작업 ID를 입력하세요.");
    if (!id) return;
    const r = await fetch(`/api/jobs/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    setServerMessage(`취소 결과: ${(await r.json()).status}`);
    await refreshJobs();
  }
  async function runDoctorCheck() {
    const r = await fetch("/api/doctor");
    const j = await r.json();
    setServerMessage(
      `진단 ${j.ok ? "정상" : "확인 필요"}: ${j.checks.map((c: any) => `${c.name}=${c.ok ? "정상" : "경고"}`).join(", ")}`,
    );
  }
  async function refreshStatus(switchTab = true) {
    const r = await fetch("/api/system/status", { cache: "no-store" });
    const payload = await r.json();
    setStatusPayload(payload);
    setStatusJson(JSON.stringify(payload, null, 2));
    if (switchTab) setTab("status");
  }

  async function updateParallelJobs(value: number) {
    const r = await fetch("/api/system/config", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ maxParallelJobs: value }),
    });
    const j = await r.json();
    if (!r.ok) return setServerMessage(j.error || "병렬 작업 수 저장에 실패했습니다.");
    setServerMessage(`병렬 작업 수를 ${j.maxParallelJobs}로 저장했습니다. .env의 TILEFORGE_MAX_PARALLEL_JOBS를 갱신했습니다.`);
    await refreshStatus(false);
  }
  function watchJob() {
    const id = prompt("실시간으로 볼 작업 ID를 입력하세요.");
    if (!id) return;
    startLiveJob(id);
  }
  function importCsv() {
    try {
      setShapes(parseShapesCsv(csvText));
      setServerMessage("CSV를 불러왔습니다.");
    } catch (e: any) {
      setServerMessage(e.message);
    }
  }
  function addConv() {
    try {
      setShapes((s) => [...s, conv2dToGemm(conv)]);
      setServerMessage("Conv2D를 GEMM으로 변환해 작업 목록에 추가했습니다.");
    } catch (e: any) {
      setServerMessage(e.message);
    }
  }
  async function importOnnxFile(file: File | null) {
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    const r = await fetch("/api/import/onnx", { method: "POST", body: form });
    const j = await r.json();
    if (!r.ok)
      return setServerMessage(j.error || "ONNX 불러오기에 실패했습니다.");
    setShapes(j.shapes);
    setServerMessage(
      `ONNX에서 GEMM shape ${j.shapes.length}개를 불러왔습니다. ${j.warnings?.length ? "경고: " + j.warnings.join(" | ") : ""}`,
    );
  }
  async function applyCalibrationCsv() {
    try {
      const profile = parseMeasurementCsv(
        calibrationCsv,
        hardware.frequencyMHz,
      );
      setCalibration(profile);
      const r = await fetch("/api/calibration", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: calibrationCsv,
          frequencyMHz: hardware.frequencyMHz,
        }),
      });
      const j = await r.json();
      setServerMessage(
        `보정 적용 완료: ${profile.samples.length}개 샘플 기준 factor ${profile.globalCycleFactor.toFixed(3)}. 서버 응답: ${j.globalCycleFactor?.toFixed?.(3) ?? "ok"}`,
      );
    } catch (e: any) {
      setServerMessage(e.message);
    }
  }
  function clearCalibration() {
    setCalibration(undefined);
    setServerMessage("보정값을 해제했습니다.");
  }
  function applyHardwarePreset(name: string) {
    const p = effectiveHardwarePresets.find((p) => p.name === name);
    if (p) { setHardware(p); setDataflowModes([p.dataflow]); }
  }
  function applyWorkloadPreset(name: string) {
    const p = effectiveWorkloadPresets[name];
    if (p) setShapes(p);
  }

  async function saveCustomPreset() {
    const name = customPresetName.trim() || `${hardware.name}_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}`;
    const nextPreset = {
      name,
      savedAt: new Date().toISOString(),
      hardware,
      shapes,
      objective,
      tileM,
      tileN,
      tileK,
      scaleSim,
      dataflowModes,
    };
    const defaultNameConflict = customPresets.some((p: any) => p.source === "default" && p.name === name);
    if (defaultNameConflict) {
      setServerMessage(`사용자 프리셋 이름 '${name}'은 기본 프리셋과 겹칩니다. 다른 이름을 사용하세요.`);
      return;
    }
    try {
      const r = await fetch("/api/presets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(nextPreset),
      });
      if (!r.ok) throw new Error(await r.text());
      await refreshPresets();
      setCustomPresetName(name);
      setServerMessage(`사용자 프리셋 저장 완료: ${name}`);
    } catch (error: any) {
      setServerMessage(`사용자 프리셋 저장 실패: ${error?.message ?? error}`);
    }
  }

  function applyCustomPreset(name: string) {
    const p = customPresets.find((p) => p.name === name);
    if (!p) return;
    if (p.hardware) { setHardware(p.hardware); setDataflowModes((Array.isArray(p.dataflowModes) && p.dataflowModes.length ? p.dataflowModes : [p.hardware.dataflow ?? "WS"]) as Dataflow[]); }
    if (p.shapes) setShapes(p.shapes);
    if (p.objective) setObjective(p.objective);
    if (p.tileM) setTileM(p.tileM);
    if (p.tileN) setTileN(p.tileN);
    if (p.tileK) setTileK(p.tileK);
    if (p.scaleSim) setScaleSim((cur) => ({ ...cur, ...p.scaleSim }));
    setCustomPresetName(name);
    setServerMessage(`사용자 프리셋 적용: ${name}`);
  }

  async function deleteCustomPreset(name: string) {
    if (!name) return;
    if (!window.confirm(`사용자 프리셋 '${name}'을 삭제할까요?`)) return;
    const preset = customPresets.find((p) => p.name === name);
    if (preset?.source === "default") {
      setServerMessage("기본 프리셋은 UI에서 삭제하지 않습니다. presets/default 폴더의 JSON 파일을 직접 수정하거나 삭제하세요.");
      return;
    }
    try {
      const r = await fetch(`/api/presets?name=${encodeURIComponent(name)}`, { method: "DELETE" });
      if (!r.ok) throw new Error(await r.text());
      await refreshPresets();
      if (customPresetName === name) setCustomPresetName("");
      setServerMessage(`사용자 프리셋 삭제: ${name}`);
    } catch (error: any) {
      setServerMessage(`사용자 프리셋 삭제 실패: ${error?.message ?? error}`);
    }
  }

  async function saveHardwarePreset() {
    const name = hardwarePresetName.trim() || hardware.name;
    try {
      const r = await fetch("/api/presets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "hardware", name, hardware: { ...hardware, name } }),
      });
      if (!r.ok) throw new Error(await r.text());
      await refreshPresets();
      setHardwarePresetName(name);
      setServerMessage(`하드웨어 프리셋 저장 완료: ${name}`);
    } catch (error: any) {
      setServerMessage(`하드웨어 프리셋 저장 실패: ${error?.message ?? error}`);
    }
  }

  async function deleteHardwarePreset(name: string) {
    if (!name) return;
    if (!window.confirm(`하드웨어 프리셋 '${name}'을 삭제할까요?`)) return;
    const r = await fetch(`/api/presets?kind=hardware&name=${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!r.ok) return setServerMessage(`하드웨어 프리셋 삭제 실패: ${await r.text()}`);
    await refreshPresets();
    if (hardwarePresetName === name) setHardwarePresetName("");
    setServerMessage(`하드웨어 프리셋 삭제: ${name}`);
  }

  async function saveWorkloadPreset() {
    const name = workloadPresetName.trim() || `workload_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}`;
    try {
      const r = await fetch("/api/presets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ kind: "workload", name, shapes }),
      });
      if (!r.ok) throw new Error(await r.text());
      await refreshPresets();
      setWorkloadPresetName(name);
      setServerMessage(`워크로드 프리셋 저장 완료: ${name}`);
    } catch (error: any) {
      setServerMessage(`워크로드 프리셋 저장 실패: ${error?.message ?? error}`);
    }
  }

  async function deleteWorkloadPreset(name: string) {
    if (!name) return;
    if (!window.confirm(`워크로드 프리셋 '${name}'을 삭제할까요?`)) return;
    const r = await fetch(`/api/presets?kind=workload&name=${encodeURIComponent(name)}`, { method: "DELETE" });
    if (!r.ok) return setServerMessage(`워크로드 프리셋 삭제 실패: ${await r.text()}`);
    await refreshPresets();
    if (workloadPresetName === name) setWorkloadPresetName("");
    setServerMessage(`워크로드 프리셋 삭제: ${name}`);
  }


  function toggleDataflowMode(mode: Dataflow) {
    setDataflowModes((prev) => {
      const next = prev.includes(mode) ? prev.filter((x) => x !== mode) : [...prev, mode];
      const normalized = next.length ? next : [mode];
      updateHw({ dataflow: normalized[0] });
      return normalized;
    });
  }

  function addManualShape() {
    const id = manualShape.id.trim() || `${manualShape.model}_${manualShape.opName}_${Date.now()}`;
    setShapes((prev) => [...prev, { ...manualShape, id, source: "manual" }]);
    setServerMessage(`수동 GEMM shape 추가: ${manualShape.model}.${manualShape.opName}`);
  }

  function appendCalibrationRow() {
    const line = `${calibrationRow.model},${calibrationRow.opName},${calibrationRow.array},${calibrationRow.dataflow},${calibrationRow.predictedCycles},${calibrationRow.measuredCycles}`;
    const header = "model,op_name,array,dataflow,predicted_cycles,measured_cycles";
    setCalibrationCsv((cur) => {
      const trimmed = cur.trim();
      return trimmed ? `${trimmed}\n${line}` : `${header}\n${line}`;
    });
  }

  async function appendCalibrationFromJob() {
    const jobId = analysisJobId || latestCompletedJobId(jobsPayload);
    if (!jobId) { setServerMessage("보정에 사용할 완료 작업을 먼저 선택하세요."); return; }
    try {
      const [resultRes, scaleRes] = await Promise.all([
        fetch(`/api/jobs/${jobId}/artifact?path=${encodeURIComponent("result.json")}`, { cache: "no-store" }),
        fetch(`/api/jobs/${jobId}/artifact?path=${encodeURIComponent("scalesim_summary.json")}`, { cache: "no-store" }),
      ]);
      if (!resultRes.ok || !scaleRes.ok) throw new Error("result.json 또는 scalesim_summary.json을 읽지 못했습니다.");
      const resultJson = JSON.parse(await resultRes.text());
      const scaleJson = JSON.parse(await scaleRes.text());
      const response = resultJson?.payload?.response ?? resultJson?.response ?? resultJson;
      const rows = Array.isArray(response?.results) ? response.results : [];
      const layers = Array.isArray(scaleJson?.layers) ? scaleJson.layers : [];
      const hw = response?.request?.hardware ?? hardware;
      const array = `${hw.arrayRows ?? hardware.arrayRows}x${hw.arrayCols ?? hardware.arrayCols}`;
      const dataflow = hw.dataflow ?? hardware.dataflow ?? "WS";
      const header = "model,op_name,array,dataflow,predicted_cycles,measured_cycles";
      const added: string[] = [];
      for (let i = 0; i < Math.min(rows.length, layers.length); i++) {
        const shape = rows[i]?.shape;
        const predicted = Number(rows[i]?.best?.cycles ?? rows[i]?.cycles ?? 0);
        const measured = Number(layers[i]?.cycles ?? 0);
        if (!shape || predicted <= 0 || measured <= 0) continue;
        added.push(`${shape.model},${shape.opName},${array},${dataflow},${Math.round(predicted)},${Math.round(measured)}`);
      }
      if (added.length === 0 && Number(response?.summary?.totalCycles) > 0 && Number(scaleJson?.totalCycles) > 0) {
        added.push(`${hw.name ?? "job"},total,${array},${dataflow},${Math.round(response.summary.totalCycles)},${Math.round(scaleJson.totalCycles)}`);
      }
      if (added.length === 0) throw new Error("추가할 predicted/measured cycle pair가 없습니다.");
      setCalibrationCsv((cur) => {
        const trimmed = cur.trim();
        return trimmed ? `${trimmed}\n${added.join("\n")}` : `${header}\n${added.join("\n")}`;
      });
      setServerMessage(`선택 작업에서 보정 sample ${added.length}개를 추가했습니다.`);
    } catch (error: any) {
      setServerMessage(`작업 결과 기반 보정 sample 추가 실패: ${error?.message ?? error}`);
    }
  }

  return (
    <main>
      <header className="topbar">
        <div>
          <h1 title="Systolic array 기반 타일/하드웨어 설계 탐색 도구입니다.">
            TileForge 워크벤치
          </h1>
          <p
            className="lead"
            title="입력 shape와 하드웨어 설정을 바꾸면 로컬 서버에서 추정과 외부 검증 산출물을 생성합니다."
          >
            TPU 계열 systolic-array 하드웨어와 컴파일러 타일링 정책을 함께
            탐색하는 로컬 웹 워크벤치입니다.
          </p>
        </div>
        <Link
          className="help-link"
          href="/help"
          title="예제별 사용 방법과 각 입력 항목의 의미를 자세히 설명한 도움말 페이지로 이동합니다."
        >
          도움말 열기
        </Link>
      </header>
      <div className="grid">
        <section
          className="panel"
          title="왼쪽 패널에서 하드웨어, 타일 후보, workload, 보정값, 실행 작업을 설정합니다."
        >
          <h2 title="실험에 사용할 모든 입력값을 설정하는 영역입니다.">
            입력 설정
          </h2>
          <div
            className="input-tabs"
            title="입력 설정을 섹션별 탭으로 나누어 표시합니다."
          >
            {(
              [
                "presets",
                "hardware",
                "tiling",
                "scalesim",
                "workload",
                "conv",
                "calibration",
                "tools",
              ] as InputTab[]
            ).map((t) => (
              <button
                key={t}
                title={inputTabTips[t]}
                className={inputTab === t ? "" : "secondary"}
                onClick={() => setInputTab(t)}
              >
                {inputTabLabels[t]}
              </button>
            ))}
          </div>
          <div className="input-tab-panel">
            {inputTab === "presets" && (
              <>
                <h3 title="자주 쓰는 하드웨어와 모델 shape를 한 번에 적용합니다.">
                  프리셋
                </h3>
                <FieldLabel tip="미리 정의된 systolic array 하드웨어 설정을 선택합니다. 선택하면 아래 하드웨어 입력값이 바뀝니다.">
                  하드웨어 프리셋
                </FieldLabel>
                <select
                  title="하드웨어 프리셋을 선택합니다. custom/current는 현재 입력값을 유지합니다."
                  onChange={(e) => applyHardwarePreset(e.target.value)}
                  defaultValue=""
                >
                  <option value="">직접 설정/현재값</option>
                  {effectiveHardwarePresets.map((p) => (
                    <option key={p.name}>{p.name}</option>
                  ))}
                </select>
                <FieldLabel tip="BERT, ViT, CNN 등 미리 정의된 GEMM workload 목록을 선택합니다.">
                  워크로드 프리셋
                </FieldLabel>
                <select
                  title="분석할 연산 shape 묶음을 선택합니다. 선택하면 현재 shape 목록이 교체됩니다."
                  onChange={(e) => applyWorkloadPreset(e.target.value)}
                  defaultValue=""
                >
                  <option value="">직접 설정/현재값</option>
                  {Object.keys(effectiveWorkloadPresets).map((k) => (
                    <option key={k}>{k}</option>
                  ))}
                </select>
                <h3 title="현재 수동 입력값을 레포지토리 presets/user 폴더에 사용자 프리셋으로 저장합니다.">
                  사용자 프리셋
                </h3>
                <FieldLabel tip="현재 하드웨어, workload, 타일링, SCALE-Sim 설정을 저장할 이름입니다.">
                  사용자 프리셋 이름
                </FieldLabel>
                <input
                  title="저장할 사용자 프리셋 이름을 입력합니다. 같은 이름으로 저장하면 덮어씁니다."
                  value={customPresetName}
                  onChange={(e) => setCustomPresetName(e.target.value)}
                  placeholder="예: vit-s_128x128_ws"
                />
                <ActionButton
                  tip="현재 수동 입력값 전체를 사용자 프리셋으로 저장합니다."
                  onClick={saveCustomPreset}
                >
                  현재 설정 저장
                </ActionButton>
                {customPresets.length > 0 && (
                  <>
                    <FieldLabel tip="저장된 사용자 프리셋을 선택해 적용하거나 삭제합니다.">
                      저장된 사용자 프리셋
                    </FieldLabel>
                    <select
                      title="저장된 사용자 프리셋 목록입니다."
                      value={customPresetName}
                      onChange={(e) => setCustomPresetName(e.target.value)}
                    >
                      <option value="">선택 안 함</option>
                      {customPresets.map((p) => (
                        <option key={p.name} value={p.name}>{p.name}</option>
                      ))}
                    </select>
                    <ActionButton
                      className="secondary"
                      tip="선택한 사용자 프리셋을 현재 입력값에 적용합니다."
                      onClick={() => applyCustomPreset(customPresetName)}
                    >
                      선택 프리셋 적용
                    </ActionButton>
                    <ActionButton
                      className="secondary"
                      tip="선택한 사용자 프리셋을 삭제합니다."
                      onClick={() => deleteCustomPreset(customPresetName)}
                    >
                      선택 프리셋 삭제
                    </ActionButton>
                    <div className="preset-list" title="저장된 사용자 프리셋을 바로 적용하거나 삭제합니다.">
                      {customPresets.map((p) => (
                        <div className="preset-item" key={p.name}>
                          <div>
                            <b>{p.name}</b>
                            <span className="small">{p.source === "default" ? "기본 프리셋" : "사용자 프리셋"} · {p.savedAt ? new Date(p.savedAt).toLocaleString() : "저장 시각 없음"}</span>
                          </div>
                          <div className="preset-actions">
                            <button className="secondary" onClick={() => applyCustomPreset(p.name)}>적용</button>
                            <button className="secondary danger-button" onClick={() => deleteCustomPreset(p.name)} disabled={p.source === "default"} title={p.source === "default" ? "기본 프리셋은 presets/default 폴더에서 관리합니다." : "프리셋 삭제"}>삭제</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  </>
                )}
                <p className="small">
                  프리셋을 적용한 뒤 하드웨어/타일링/SCALE-Sim/워크로드 탭에서 세부 값을
                  조정하세요. 사용자 프리셋은 레포지토리의 presets/user 폴더에 저장됩니다.
                </p>
              </>
            )}

            {inputTab === "hardware" && (
              <>
                <h3 title="시뮬레이션할 가속기 구조와 메모리/에너지 파라미터를 설정합니다.">
                  하드웨어
                </h3>
                <FieldLabel tip="실험 결과와 export 파일에 표시될 하드웨어 이름입니다.">
                  이름
                </FieldLabel>
                <input
                  title="하드웨어 구성 이름을 입력합니다."
                  value={hardware.name}
                  onChange={(e) => updateHw({ name: e.target.value })}
                />
                <div className="preset-manager-inline" title="현재 하드웨어 입력값만 별도 프리셋으로 저장합니다. 저장 후 프리셋 탭의 하드웨어 프리셋 목록에 바로 나타납니다.">
                  <MiniField label="하드웨어 프리셋 이름" tip="현재 하드웨어만 저장할 이름입니다.">
                    <input value={hardwarePresetName} onChange={(e) => setHardwarePresetName(e.target.value)} placeholder={hardware.name} />
                  </MiniField>
                  <button onClick={saveHardwarePreset}>하드웨어 저장</button>
                  {userHardwarePresets.length > 0 && (
                    <MiniField label="사용자 하드웨어" tip="레포지토리 presets/hardware 폴더에 저장된 하드웨어 프리셋입니다.">
                      <select value={hardwarePresetName} onChange={(e) => setHardwarePresetName(e.target.value)}>
                        <option value="">선택 안 함</option>
                        {userHardwarePresets.map((p: any) => <option key={p.name} value={p.name}>{p.name}</option>)}
                      </select>
                    </MiniField>
                  )}
                  <button className="secondary danger-button" onClick={() => deleteHardwarePreset(hardwarePresetName)} disabled={!hardwarePresetName}>삭제</button>
                </div>
                <div className="row">
                  <div>
                    <FieldLabel tip="systolic array의 세로 방향 PE 개수입니다.">
                      배열 행 수
                    </FieldLabel>
                    <input
                      title="PE 배열의 row 수입니다. 예: 128"
                      type="number"
                      value={hardware.arrayRows}
                      onChange={(e) => updateHw({ arrayRows: +e.target.value })}
                    />
                  </div>
                  <div>
                    <FieldLabel tip="systolic array의 가로 방향 PE 개수입니다.">
                      배열 열 수
                    </FieldLabel>
                    <input
                      title="PE 배열의 column 수입니다. 예: 128"
                      type="number"
                      value={hardware.arrayCols}
                      onChange={(e) => updateHw({ arrayCols: +e.target.value })}
                    />
                  </div>
                </div>
                <div className="row">
                  <div>
                    <FieldLabel tip="가속기 동작 주파수입니다. 사이클을 시간으로 환산할 때 사용합니다.">
                      주파수 MHz
                    </FieldLabel>
                    <input
                      title="MHz 단위의 동작 주파수입니다."
                      type="number"
                      value={hardware.frequencyMHz}
                      onChange={(e) =>
                        updateHw({ frequencyMHz: +e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel tip="타일이 사용할 수 있는 온칩 SRAM 용량입니다.">
                      SRAM KiB
                    </FieldLabel>
                    <input
                      title="온칩 SRAM 용량입니다. 너무 작은 값은 큰 타일 후보를 제외시킬 수 있습니다."
                      type="number"
                      value={hardware.sramKB}
                      onChange={(e) => updateHw({ sramKB: +e.target.value })}
                    />
                  </div>
                </div>
                <div className="row">
                  <div>
                    <FieldLabel tip="연산 데이터 하나가 차지하는 byte 수입니다. fp16/bfloat16/int16은 보통 2, fp32는 4, int8은 1입니다. 이 값은 SRAM 사용량과 메모리 traffic 추정에 직접 반영됩니다.">
                      원소당 byte
                    </FieldLabel>
                    <input
                      title="dtype byte 수입니다. 예: fp16=2, fp32=4"
                      type="number"
                      value={hardware.bytesPerElement}
                      onChange={(e) =>
                        updateHw({ bytesPerElement: +e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="dataflow-below-bytes">
                  <FieldLabel tip="데이터가 systolic array 안에서 어느 방향으로 오래 머무는지 정의합니다. WS는 weight-stationary, OS는 output-stationary, IS는 input-stationary입니다. 여러 개를 선택하면 full-pipeline 작업을 데이터플로우별로 큐에 나누어 넣어 비교합니다. 혼합 비교는 동일 workload를 여러 dataflow 조건으로 실행하는 방식입니다.">
                    데이터플로우 비교
                  </FieldLabel>
                  <div className="dataflow-grid dataflow-grid-below" title="여러 데이터플로우를 선택하면 선택한 조건별로 job을 큐에 넣어 비교합니다.">
                    {([
                      ["WS", "Weight stationary", "weight/filter를 PE 근처에 오래 두어 재사용합니다. Conv/GEMM weight 재사용이 큰 경우 자주 씁니다."],
                      ["OS", "Output stationary", "partial sum/output을 고정해 누산 write-back을 줄입니다. output 재사용과 누산 비용을 볼 때 유용합니다."],
                      ["IS", "Input stationary", "input activation을 오래 유지해 입력 재사용을 강조합니다. activation reuse가 큰 모델을 비교할 때 사용합니다."],
                    ] as [Dataflow, string, string][]).map(([mode, title, desc]) => (
                      <label className={`dataflow-card dataflow-card-compact ${dataflowModes.includes(mode) ? "selected" : ""}`} key={mode} title={`${mode} (${title}): ${desc}`}>
                        <input type="checkbox" checked={dataflowModes.includes(mode)} onChange={() => toggleDataflowMode(mode)} />
                        <span className="dataflow-code">{mode}</span>
                        <span className="dataflow-title">{title}</span>
                      </label>
                    ))}
                  </div>
                  <p className="small">대표 표시값: {hardware.dataflow}. 여러 개 선택 시 동일 입력을 dataflow별 작업으로 나누어 큐에 추가합니다.</p>
                </div>
                <div className="row">
                  <div>
                    <FieldLabel tip="외부 메모리 대역폭입니다. roofline과 메모리 병목 분석에 사용합니다.">
                      메모리 BW GB/s
                    </FieldLabel>
                    <input
                      title="GB/s 단위 메모리 대역폭입니다."
                      type="number"
                      value={hardware.memoryBandwidthGBs ?? 100}
                      onChange={(e) =>
                        updateHw({ memoryBandwidthGBs: +e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel tip="커널 실행마다 추가되는 host/device dispatch overhead입니다.">
                      디스패치 오버헤드 us
                    </FieldLabel>
                    <input
                      title="마이크로초 단위 dispatch overhead입니다. 작은 연산이 많은 경우 영향이 큽니다."
                      type="number"
                      value={hardware.dispatchOverheadUs ?? 0}
                      onChange={(e) =>
                        updateHw({ dispatchOverheadUs: +e.target.value })
                      }
                    />
                  </div>
                </div>
                <div className="row3">
                  <div>
                    <FieldLabel tip="MAC 한 번당 에너지입니다. 에너지 추정에 사용됩니다.">
                      pJ/MAC
                    </FieldLabel>
                    <input
                      title="MAC 1회당 picojoule 에너지입니다."
                      type="number"
                      value={hardware.energyPerMacPJ ?? 1}
                      onChange={(e) =>
                        updateHw({ energyPerMacPJ: +e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel tip="SRAM 접근 1회당 에너지입니다.">
                      pJ/SRAM 접근
                    </FieldLabel>
                    <input
                      title="SRAM access 1회당 picojoule 에너지입니다."
                      type="number"
                      value={hardware.energyPerSramAccessPJ ?? 5}
                      onChange={(e) =>
                        updateHw({ energyPerSramAccessPJ: +e.target.value })
                      }
                    />
                  </div>
                  <div>
                    <FieldLabel tip="DRAM에서 1 byte를 읽거나 쓰는 데 드는 에너지입니다.">
                      pJ/DRAM byte
                    </FieldLabel>
                    <input
                      title="DRAM byte 접근당 picojoule 에너지입니다."
                      type="number"
                      value={hardware.energyPerDramBytePJ ?? 60}
                      onChange={(e) =>
                        updateHw({ energyPerDramBytePJ: +e.target.value })
                      }
                    />
                  </div>
                </div>
              </>
            )}

            {inputTab === "tiling" && (
              <>
                <h3 title="탐색할 타일 크기 후보를 쉼표로 입력합니다.">
                  타일 후보
                </h3>
                <div className="info-box">
                  <b>타일링은 무엇을 정하나요?</b>
                  <p className="small">GEMM C[M×N] = A[M×K] × B[K×N]을 tileM×tileN×tileK 블록으로 나누어 array에 공급합니다. tileM/tileN은 공간 PE 활용률과 경계 padding에, tileK는 reduction 재사용과 SRAM working set에 영향을 줍니다.</p>
                </div>
                <FieldLabel tip="GEMM M축 타일 후보입니다. 쉼표로 여러 값을 입력합니다.">
                  tileM
                </FieldLabel>
                <input
                  title="M축 타일 후보입니다. 예: 16, 32, 64, 128"
                  value={tileM}
                  onChange={(e) => setTileM(e.target.value)}
                />
                <FieldLabel tip="GEMM N축 타일 후보입니다. 쉼표로 여러 값을 입력합니다.">
                  tileN
                </FieldLabel>
                <input
                  title="N축 타일 후보입니다. 예: 16, 32, 64, 128"
                  value={tileN}
                  onChange={(e) => setTileN(e.target.value)}
                />
                <FieldLabel tip="GEMM K축 reduction 타일 후보입니다. 쉼표로 여러 값을 입력합니다.">
                  tileK
                </FieldLabel>
                <input
                  title="K축 reduction 타일 후보입니다. 예: 16, 32, 64"
                  value={tileK}
                  onChange={(e) => setTileK(e.target.value)}
                />
                <FieldLabel tip="최적 타일을 고를 때 무엇을 우선할지 정합니다.">
                  최적화 목표
                </FieldLabel>
                <select
                  title="balanced는 사이클/활용률/메모리 사용량을 종합하고, cycles는 최저 사이클을 우선합니다."
                  value={objective}
                  onChange={(e) => setObjective(e.target.value as Objective)}
                >
                  <option value="balanced">균형</option>
                  <option value="cycles">사이클 최소</option>
                  <option value="utilization">활용률 우선</option>
                  <option value="hardware-design">하드웨어 설계</option>
                  <option value="pareto">Pareto 후보</option>
                </select>
                <div className="objective-help">
                  <b>목표별 가중치 해석</b>
                  <ul>
                    <li><b>균형</b>: cycle 65%, PE 미사용 penalty, padding, SRAM 초과 penalty를 함께 봅니다.</li>
                    <li><b>사이클 최소</b>: cycle을 가장 강하게 보며 SRAM 초과만 큰 penalty로 둡니다.</li>
                    <li><b>활용률 우선</b>: PE 사용률을 우선하고 padding/SRAM을 보조 penalty로 둡니다.</li>
                    <li><b>하드웨어 설계</b>: cycle, utilization, padding, 경계 타일 penalty를 비슷하게 보며 array shape 평가에 유리합니다.</li>
                    <li><b>Pareto 후보</b>: cycle, utilization, padding, SRAM이 서로 지배하지 않는 후보를 넓게 남깁니다.</li>
                  </ul>
                  <p className="small">내부 score는 낮을수록 좋습니다. 실제 보고서에는 최종 선택 후보뿐 아니라 그래프 탭에서 후보별 cycle/time/SRAM/DRAM 차이를 같이 확인할 수 있습니다.</p>
                </div>
              </>
            )}

            {inputTab === "scalesim" && (
              <>
                <h3 title="SCALE-Sim cfg/layout 생성에 직접 반영되는 세부 파라미터입니다.">
                  SCALE-Sim 세부 설정
                </h3>
                <div className="info-box">
                  <b>SCALE-Sim 메모리/레이아웃 설정</b>
                  <p className="small">DRAM/Interface Bandwidth는 외부 메모리 대역폭, Ifmap/Filter/Ofmap SRAM은 operand별 온칩 버퍼 용량입니다. custom layout은 데이터 배치 순서를 바꾸는 고급 옵션이며, 먼저 기본 layout으로 통과 여부를 확인한 뒤 켜는 것을 권장합니다.</p>
                </div>
                <FieldLabel tip="SCALE-Sim 결과 디렉터리 아래 run_name으로 사용됩니다.">
                  run_name
                </FieldLabel>
                <input
                  value={scaleSim.runName ?? "tileforge_generated"}
                  onChange={(e) => updateScaleSim({ runName: e.target.value })}
                />
                <div className="row">
                  <div>
                    <FieldLabel tip="SCALE-Sim cfg의 Bandwidth 값입니다. DRAM/외부 인터페이스 대역폭 모델에 사용됩니다.">
                      DRAM / Interface Bandwidth
                    </FieldLabel>
                    <input type="number" value={(scaleSim as any).dramBandwidth ?? scaleSim.bandwidth ?? 128} onChange={(e) => updateScaleSim({ bandwidth: +e.target.value, ...( { dramBandwidth: +e.target.value } as any ) })} />
                  </div>
                  <div>
                    <FieldLabel tip="SCALE-Sim cfg의 InterfaceBandwidth 값입니다. 보통 USER를 사용합니다.">
                      InterfaceBandwidth
                    </FieldLabel>
                    <input value={scaleSim.interfaceBandwidth ?? "USER"} onChange={(e) => updateScaleSim({ interfaceBandwidth: e.target.value })} />
                  </div>
                </div>
                <div className="row3">
                  <div>
                    <FieldLabel tip="Ifmap SRAM 크기 KiB입니다. 비우면 전체 SRAM을 3등분한 기본값을 씁니다.">Ifmap SRAM KiB</FieldLabel>
                    <input type="number" value={scaleSim.ifmapSramKB ?? Math.floor(hardware.sramKB / 3)} onChange={(e) => updateScaleSim({ ifmapSramKB: +e.target.value })} />
                  </div>
                  <div>
                    <FieldLabel tip="Filter SRAM 크기 KiB입니다.">Filter SRAM KiB</FieldLabel>
                    <input type="number" value={scaleSim.filterSramKB ?? Math.floor(hardware.sramKB / 3)} onChange={(e) => updateScaleSim({ filterSramKB: +e.target.value })} />
                  </div>
                  <div>
                    <FieldLabel tip="Ofmap SRAM 크기 KiB입니다.">Ofmap SRAM KiB</FieldLabel>
                    <input type="number" value={scaleSim.ofmapSramKB ?? Math.floor(hardware.sramKB / 3)} onChange={(e) => updateScaleSim({ ofmapSramKB: +e.target.value })} />
                  </div>
                </div>
                <div className="row3">
                  <div>
                    <FieldLabel tip="IfmapOffset 값입니다.">IfmapOffset</FieldLabel>
                    <input type="number" value={scaleSim.ifmapOffset ?? 0} onChange={(e) => updateScaleSim({ ifmapOffset: +e.target.value })} />
                  </div>
                  <div>
                    <FieldLabel tip="FilterOffset 값입니다.">FilterOffset</FieldLabel>
                    <input type="number" value={scaleSim.filterOffset ?? 10000000} onChange={(e) => updateScaleSim({ filterOffset: +e.target.value })} />
                  </div>
                  <div>
                    <FieldLabel tip="OfmapOffset 값입니다.">OfmapOffset</FieldLabel>
                    <input type="number" value={scaleSim.ofmapOffset ?? 20000000} onChange={(e) => updateScaleSim({ ofmapOffset: +e.target.value })} />
                  </div>
                </div>
                <div className="scale-checks">
                  <label className="check" title="layout.csv를 SCALE-Sim 명령에 -l로 전달할지 결정합니다. custom layout을 쓰려면 켜두는 것이 좋습니다.">
                    <input type="checkbox" checked={scaleSim.useLayout !== false} onChange={(e) => updateScaleSim({ useLayout: e.target.checked })} />
                    <span>layout.csv 사용 (-l)</span>
                  </label>
                  <label className="check" title="현재 SCALE-Sim은 cfg [layout] 섹션을 항상 요구합니다. 이 옵션은 custom layout/bank 값을 UI에서 편집할지 결정합니다.">
                    <input type="checkbox" checked={Boolean(scaleSim.emitLayoutSection)} onChange={(e) => updateScaleSim({ emitLayoutSection: e.target.checked })} />
                    <span>custom layout/bank 값 편집</span>
                  </label>
                </div>
                {!scaleSim.emitLayoutSection && (
                  <p className="small warn-text">기본값은 안전한 일반 layout입니다. cfg의 필수 [layout] 섹션은 항상 생성되며, custom layout은 꺼진 상태로 실행됩니다.</p>
                )}
                {scaleSim.emitLayoutSection && (
                  <>
                    <div className="scale-checks advanced-layout-checks">
                      <label className="check" title="IfmapCustomLayout 값을 True/False로 설정합니다. 켜면 layout.csv의 ifmap order를 사용합니다.">
                        <input type="checkbox" checked={Boolean(scaleSim.ifmapCustomLayout)} onChange={(e) => updateScaleSim({ ifmapCustomLayout: e.target.checked })} />
                        <span><b>Ifmap custom layout</b><small>입력 activation 배치 순서 사용</small></span>
                      </label>
                      <label className="check" title="FilterCustomLayout 값을 True/False로 설정합니다. 켜면 layout.csv의 filter order를 사용합니다.">
                        <input type="checkbox" checked={Boolean(scaleSim.filterCustomLayout)} onChange={(e) => updateScaleSim({ filterCustomLayout: e.target.checked })} />
                        <span><b>Filter custom layout</b><small>weight/filter 배치 순서 사용</small></span>
                      </label>
                    </div>
                    <div className="row3">
                      <div><FieldLabel tip="IfmapSRAMBankBandwidth">Ifmap bank BW</FieldLabel><input type="number" value={scaleSim.ifmapSRAMBankBandwidth ?? 10} onChange={(e) => updateScaleSim({ ifmapSRAMBankBandwidth: +e.target.value })} /></div>
                      <div><FieldLabel tip="IfmapSRAMBankNum">Ifmap bank num</FieldLabel><input type="number" value={scaleSim.ifmapSRAMBankNum ?? 10} onChange={(e) => updateScaleSim({ ifmapSRAMBankNum: +e.target.value })} /></div>
                      <div><FieldLabel tip="IfmapSRAMBankPort">Ifmap bank port</FieldLabel><input type="number" value={scaleSim.ifmapSRAMBankPort ?? 2} onChange={(e) => updateScaleSim({ ifmapSRAMBankPort: +e.target.value })} /></div>
                    </div>
                    <div className="row3">
                      <div><FieldLabel tip="FilterSRAMBankBandwidth">Filter bank BW</FieldLabel><input type="number" value={scaleSim.filterSRAMBankBandwidth ?? 10} onChange={(e) => updateScaleSim({ filterSRAMBankBandwidth: +e.target.value })} /></div>
                      <div><FieldLabel tip="FilterSRAMBankNum">Filter bank num</FieldLabel><input type="number" value={scaleSim.filterSRAMBankNum ?? 10} onChange={(e) => updateScaleSim({ filterSRAMBankNum: +e.target.value })} /></div>
                      <div><FieldLabel tip="FilterSRAMBankPort">Filter bank port</FieldLabel><input type="number" value={scaleSim.filterSRAMBankPort ?? 2} onChange={(e) => updateScaleSim({ filterSRAMBankPort: +e.target.value })} /></div>
                    </div>
                  </>
                )}
                <p className="small">SRAM/대역폭과 필수 [layout] 섹션은 scalesim.cfg에 항상 반영됩니다. custom layout을 켤 때는 중복 축이 생기지 않는 안전한 layout.csv를 자동 생성합니다.</p>
              </>
            )}

            {inputTab === "workload" && (
              <>
                <h3 title="분석할 GEMM 연산을 추가합니다. LLM/ViT/Conv 프리셋을 적용하거나 직접 M/N/K를 입력할 수 있습니다.">
                  워크로드 구성
                </h3>
                <div className="preset-manager-inline" title="현재 workload shape 목록만 별도 프리셋으로 저장합니다. 저장 후 프리셋 탭의 워크로드 프리셋에서 바로 선택할 수 있습니다.">
                  <MiniField label="워크로드 프리셋 이름" tip="현재 shape 목록을 저장할 이름입니다.">
                    <input value={workloadPresetName} onChange={(e) => setWorkloadPresetName(e.target.value)} placeholder="예: my_llm_block" />
                  </MiniField>
                  <button onClick={saveWorkloadPreset}>워크로드 저장</button>
                  {userWorkloadPresets.length > 0 && (
                    <MiniField label="사용자 워크로드" tip="레포지토리 presets/workload 폴더에 저장된 워크로드 프리셋입니다.">
                      <select value={workloadPresetName} onChange={(e) => setWorkloadPresetName(e.target.value)}>
                        <option value="">선택 안 함</option>
                        {userWorkloadPresets.map((p: any) => <option key={p.name} value={p.name}>{p.name}</option>)}
                      </select>
                    </MiniField>
                  )}
                  <button className="secondary" onClick={() => applyWorkloadPreset(workloadPresetName)} disabled={!workloadPresetName}>적용</button>
                  <button className="secondary danger-button" onClick={() => deleteWorkloadPreset(workloadPresetName)} disabled={!workloadPresetName}>삭제</button>
                </div>
                <div className="info-box">
                  <b>GEMM shape 의미</b>
                  <p className="small">TileForge는 각 연산을 C[M×N] = A[M×K] × B[K×N]으로 봅니다. M은 token/출력 위치 수, N은 출력 채널/hidden 차원, K는 reduction 차원입니다. LLM projection은 보통 M=token 수, N=출력 hidden, K=입력 hidden으로 입력하면 됩니다.</p>
                </div>
                <h4>수동 GEMM 추가</h4>
                <div className="row3">
                  <MiniField label="id" tip="shape id입니다. export와 로그에서 구분하기 쉽도록 고유 이름을 권장합니다."><input value={manualShape.id} onChange={(e) => setManualShape({ ...manualShape, id: e.target.value })} /></MiniField>
                  <MiniField label="model" tip="모델 이름입니다. 예: llama7b, vit_s, custom"><input value={manualShape.model} onChange={(e) => setManualShape({ ...manualShape, model: e.target.value })} /></MiniField>
                  <MiniField label="opName" tip="연산 이름입니다. 예: qkv_projection, ffn_expand"><input value={manualShape.opName} onChange={(e) => setManualShape({ ...manualShape, opName: e.target.value })} /></MiniField>
                </div>
                <div className="row4">
                  <MiniField label="M" tip="M: batch×sequence length 또는 im2col 출력 위치 수입니다."><input type="number" value={manualShape.m} onChange={(e) => setManualShape({ ...manualShape, m: +e.target.value })} /></MiniField>
                  <MiniField label="N" tip="N: 출력 feature/hidden/channel 차원입니다."><input type="number" value={manualShape.n} onChange={(e) => setManualShape({ ...manualShape, n: +e.target.value })} /></MiniField>
                  <MiniField label="K" tip="K: reduction/input feature 차원입니다."><input type="number" value={manualShape.k} onChange={(e) => setManualShape({ ...manualShape, k: +e.target.value })} /></MiniField>
                  <MiniField label="dtypeBytes" tip="fp16/bf16=2, fp32=4, int8=1."><input type="number" value={manualShape.dtypeBytes} onChange={(e) => setManualShape({ ...manualShape, dtypeBytes: +e.target.value })} /></MiniField>
                </div>
                <ActionButton tip="위 M/N/K 값을 현재 workload 목록 뒤에 추가합니다." onClick={addManualShape}>수동 GEMM 추가</ActionButton>
                <h4>CSV / ONNX 불러오기</h4>
                <textarea
                  title="GEMM shape CSV를 입력합니다. 열: id, model, op_name, m, n, k, dtype_bytes"
                  value={csvText}
                  onChange={(e) => setCsvText(e.target.value)}
                />
                <ActionButton tip="위 CSV 내용을 파싱하여 현재 workload shape 목록으로 교체합니다." onClick={importCsv}>CSV 불러오기</ActionButton>
                <ActionButton className="secondary" tip="기본 예제 shape 목록으로 되돌립니다." onClick={() => setShapes(defaultShapes)}>예제 초기화</ActionButton>
                <input title="ONNX 또는 JSON 파일에서 matmul/conv 계열 shape를 추출합니다." type="file" accept=".onnx,.json" onChange={(e) => importOnnxFile(e.target.files?.[0] ?? null)} />
                <p className="small">현재 workload shape: {shapes.length}개</p>
              </>
            )}

            {inputTab === "conv" && (
              <>
                <h3 title="Conv2D 파라미터를 GEMM 형태로 변환해 workload에 추가합니다.">
                  Conv → GEMM
                </h3>
                <div className="info-box">
                  <b>Conv가 GEMM으로 바뀌는 방식</b>
                  <p className="small">im2col 기준으로 M = batch × outputH × outputW, N = outputC, K = inputC × kernelH × kernelW입니다. outputH/outputW는 input, padding, stride, dilation으로 계산됩니다.</p>
                </div>
                <div className="row3">
                  <MiniField label="model" tip="모델 이름입니다. 예: resnet, cnn"><input value={conv.model} onChange={(e) => setConv({ ...conv, model: e.target.value })} /></MiniField>
                  <MiniField label="opName" tip="연산 이름입니다. 예: conv2d_0"><input value={conv.opName} onChange={(e) => setConv({ ...conv, opName: e.target.value })} /></MiniField>
                  <MiniField label="outputC / N" tip="출력 채널 수이며 GEMM의 N이 됩니다."><input type="number" value={conv.outputC} onChange={(e) => setConv({ ...conv, outputC: +e.target.value })} /></MiniField>
                </div>
                <div className="row3">
                  <MiniField label="inputH" tip="입력 feature map 높이입니다."><input type="number" value={conv.inputH} onChange={(e) => setConv({ ...conv, inputH: +e.target.value })} /></MiniField>
                  <MiniField label="inputW" tip="입력 feature map 너비입니다."><input type="number" value={conv.inputW} onChange={(e) => setConv({ ...conv, inputW: +e.target.value })} /></MiniField>
                  <MiniField label="inputC" tip="입력 채널 수입니다. kernelH×kernelW와 곱해져 GEMM K가 됩니다."><input type="number" value={conv.inputC} onChange={(e) => setConv({ ...conv, inputC: +e.target.value })} /></MiniField>
                </div>
                <div className="row3">
                  <MiniField label="kernelH" tip="커널 높이입니다."><input type="number" value={conv.kernelH} onChange={(e) => setConv({ ...conv, kernelH: +e.target.value })} /></MiniField>
                  <MiniField label="kernelW" tip="커널 너비입니다."><input type="number" value={conv.kernelW} onChange={(e) => setConv({ ...conv, kernelW: +e.target.value })} /></MiniField>
                  <MiniField label="stride" tip="H/W stride를 같은 값으로 설정합니다."><input type="number" value={conv.strideH} onChange={(e) => setConv({ ...conv, strideH: +e.target.value, strideW: +e.target.value })} /></MiniField>
                </div>
                <div className="row3">
                  <MiniField label="pad" tip="H/W padding을 같은 값으로 설정합니다."><input type="number" value={conv.padH} onChange={(e) => setConv({ ...conv, padH: +e.target.value, padW: +e.target.value })} /></MiniField>
                  <MiniField label="dilation" tip="H/W dilation을 같은 값으로 설정합니다."><input type="number" value={conv.dilationH} onChange={(e) => setConv({ ...conv, dilationH: +e.target.value, dilationW: +e.target.value })} /></MiniField>
                  <MiniField label="dtypeBytes" tip="fp16/bf16=2, fp32=4, int8=1."><input type="number" value={conv.dtypeBytes} onChange={(e) => setConv({ ...conv, dtypeBytes: +e.target.value })} /></MiniField>
                </div>
                <ActionButton tip="Conv2D shape를 im2col 기준 GEMM shape로 변환한 뒤 현재 workload 뒤에 추가합니다." onClick={addConv}>Conv를 GEMM으로 추가</ActionButton>
              </>
            )}

            {inputTab === "calibration" && (
              <>
                <h3 title="실측 결과를 사용해 analytic estimator의 cycle 예측을 보정합니다.">
                  보정
                </h3>
                <div className="info-box">
                  <b>보정은 언제 쓰나요?</b>
                  <p className="small">동일한 연산을 실제 측정하거나 SCALE-Sim 결과와 비교했을 때 estimator가 일관되게 높거나 낮으면 보정 sample을 추가하세요. measured/predicted 비율이 이후 cycle 추정에 곱해집니다.</p>
                </div>
                <h4>간편 보정 sample 추가</h4>
                <div className="row3">
                  <MiniField label="model" tip="보정 sample의 모델 이름입니다."><input value={calibrationRow.model} onChange={(e) => setCalibrationRow({ ...calibrationRow, model: e.target.value })} /></MiniField>
                  <MiniField label="opName" tip="보정 sample의 연산 이름입니다."><input value={calibrationRow.opName} onChange={(e) => setCalibrationRow({ ...calibrationRow, opName: e.target.value })} /></MiniField>
                  <MiniField label="array" tip="배열 크기입니다. 예: 128x128"><input value={calibrationRow.array} onChange={(e) => setCalibrationRow({ ...calibrationRow, array: e.target.value })} /></MiniField>
                </div>
                <div className="row3">
                  <MiniField label="dataflow" tip="보정 sample의 dataflow입니다."><select value={calibrationRow.dataflow} onChange={(e) => setCalibrationRow({ ...calibrationRow, dataflow: e.target.value })}><option>WS</option><option>OS</option><option>IS</option></select></MiniField>
                  <MiniField label="predictedCycles" tip="보정 전 estimator predicted cycle입니다."><input type="number" value={calibrationRow.predictedCycles} onChange={(e) => setCalibrationRow({ ...calibrationRow, predictedCycles: +e.target.value })} /></MiniField>
                  <MiniField label="measuredCycles" tip="실측 또는 SCALE-Sim measured cycle입니다."><input type="number" value={calibrationRow.measuredCycles} onChange={(e) => setCalibrationRow({ ...calibrationRow, measuredCycles: +e.target.value })} /></MiniField>
                </div>
                <div className="calibration-actions">
                  <ActionButton className="secondary" tip="간편 입력한 보정 sample을 아래 CSV 끝에 추가합니다." onClick={appendCalibrationRow}>sample을 CSV에 추가</ActionButton>
                  <ActionButton className="secondary" tip="선택한 작업 또는 최신 완료 작업의 TileForge 예측 cycle과 SCALE-Sim cycle을 CSV sample로 자동 추가합니다." onClick={appendCalibrationFromJob}>선택 작업 오차 자동 입력</ActionButton>
                </div>
                <h4>Raw CSV 입력</h4>
                <textarea
                  title="실측 CSV를 입력합니다. 열: model, op_name, array, dataflow, predicted_cycles, measured_cycles"
                  value={calibrationCsv}
                  onChange={(e) => setCalibrationCsv(e.target.value)}
                />
                <ActionButton
                  tip="실측값/예측값 비율을 계산해 이후 cycle 추정에 보정 계수를 적용합니다."
                  onClick={applyCalibrationCsv}
                >
                  보정 적용
                </ActionButton>
                <ActionButton
                  className="secondary"
                  tip="현재 적용된 보정 계수를 제거합니다."
                  onClick={clearCalibration}
                >
                  보정 해제
                </ActionButton>
                {calibration && (
                  <p
                    className="small warn"
                    title="현재 estimator에 적용 중인 전역 보정 계수입니다."
                  >
                    샘플 {calibration.samples.length}개 기준 보정 계수{" "}
                    {calibration.globalCycleFactor.toFixed(3)} 적용 중
                  </p>
                )}
              </>
            )}

            {inputTab === "tools" && (
              <>
                <h3 title="서버 계산, 프로젝트 저장, worker job, 진단 기능을 실행합니다.">
                  도구 / 실행
                </h3>
                <ActionButton
                  tip="현재 입력값을 API 서버로 보내 estimator를 실행합니다. 로컬 Next.js 서버에서 계산됩니다."
                  onClick={runServerEstimate}
                >
                  서버 추정 실행
                </ActionButton>
                <ActionButton
                  className="secondary"
                  tip="현재 프로젝트 설정을 .tileforge/project.json에 저장합니다."
                  onClick={saveProject}
                >
                  프로젝트 저장
                </ActionButton>
                <ActionButton
                  className="secondary"
                  tip=".tileforge/project.json에서 이전 설정을 불러옵니다."
                  onClick={loadProject}
                >
                  프로젝트 불러오기
                </ActionButton>
                <ActionButton
                  tip="Estimator 산출물 생성 후 SCALE-Sim과 IREE를 실제로 실행하는 전체 pipeline 작업을 등록합니다. worker가 실행 중이어야 진행됩니다."
                  onClick={() => createJob("full-pipeline")}
                >
                  SCALE-Sim/IREE 전체 실행
                </ActionButton>
                <ActionButton
                  className="secondary"
                  tip="최근 작업 목록과 상태를 새로고침합니다."
                  onClick={refreshJobs}
                >
                  작업 새로고침
                </ActionButton>
                <ActionButton
                  className="secondary"
                  tip="Node, 저장소, 외부 도구 등 실행 환경을 진단합니다."
                  onClick={runDoctorCheck}
                >
                  환경 진단
                </ActionButton>
                <ActionButton
                  className="secondary"
                  tip="현재 서버와 worker 상태를 JSON으로 조회합니다."
                  onClick={refreshStatus}
                >
                  시스템 상태
                </ActionButton>
                <p
                  className="small"
                  title="개발 서버 실행 방법과 외부 도구 환경 변수 안내입니다."
                >
                  <code>npm run dev</code>로 실행하세요. 최초 실행/명령 고정은{" "}
                  <code>npm run setup:env</code>, 전체 검증은{" "}
                  <code>npm run test:all</code>, 완전 재구성은{" "}
                  <code>npm run setup:fresh</code>를 사용합니다.
                </p>
                {liveJobId && (
                  <p
                    className="small"
                    title="현재 EventSource로 구독 중인 job id입니다."
                  >
                    실시간 구독 중인 작업: <code>{liveJobId}</code>
                  </p>
                )}
                {serverMessage && (
                  <p
                    className="small warn"
                    title="최근 API 실행 결과 또는 오류 메시지입니다."
                  >
                    {serverMessage}
                  </p>
                )}
              </>
            )}
          </div>
        </section>

        <section className={`results-section ${tab === "jobs" ? "jobs-wide" : ""}`} title="오른쪽 패널에서 추정 결과, 분석 탭, 내보내기 산출물을 확인합니다.">
          <div className="cards">
            <Metric
              title="총 사이클"
              tip="현재 workload 전체에 대한 예상 총 cycle과 불확실성입니다."
              value={`${fmt(result.summary.totalCycles, 0)} ±${uncertainty.uncertaintyPct.toFixed(1)}%`}
            />
            <Metric
              title="평균 활용률"
              tip="선택된 최적 타일들의 평균 PE utilization입니다."
              value={`${(result.summary.meanUtilization * 100).toFixed(1)}%`}
            />
            <Metric
              title="신뢰도"
              tip="입력 유효성, 보정 샘플, 경고 수 등을 종합한 결과 신뢰도입니다."
              value={`${confidence.level} (${(confidence.score * 100).toFixed(0)}%)`}
            />
            <Metric
              title="주요 병목"
              tip="전체 사이클에서 가장 큰 비중을 차지하는 연산입니다."
              value={result.summary.bottleneckOp}
            />
          </div>
          <div className={`panel alt ${tab === "jobs" ? "jobs-panel" : ""}`} style={{ marginTop: 16 }}>
            <ResultContextBar
              jobsPayload={jobsPayload}
              selectedJobId={analysisJobId}
              onSelect={(id) => {
                analysisJobIdRef.current = id;
                setAnalysisJobId(id);
                void fetchJobReport(id);
              }}
            />
            <div className="tabs">
              {(
                [
                  "policy",
                  "bottleneck",
                  "roofline",
                  "energy",
                  "array",
                  "calibration",
                  "iree",
                  "exports",
                  "graphs",
                  "report",
                  "jobs",
                  "status",
                ] as Tab[]
              ).map((t) => (
                <button
                  key={t}
                  title={tabTips[t]}
                  className={tab === t ? "" : "secondary"}
                  onClick={() => setTab(t)}
                >
                  {tabLabels[t]}
                </button>
              ))}
            </div>
            {tab === "policy" && <Policy result={result} download={download} jobId={analysisJobId} jobsPayload={jobsPayload} />}
            {tab === "bottleneck" && <Bottleneck result={result} jobId={analysisJobId} />}
            {tab === "roofline" && <Roofline result={result} jobId={analysisJobId} />}
            {tab === "energy" && <Energy result={result} jobId={analysisJobId} />}
            {tab === "array" && (
              <ArraySweep
                rows={arraySweep}
                comparisonCsv={result.artifacts.experimentComparisonCsv ?? ""}
                download={download}
              />
            )}
            {tab === "calibration" && (
              <Artifact
                name="calibration.md"
                text={profileToMarkdown(calibration)}
                download={download}
              />
            )}
            {tab === "iree" && <Iree result={result} download={download} jobId={analysisJobId} />}
            {tab === "exports" && (
              <Exports result={result} download={download} jobId={analysisJobId} jobsPayload={jobsPayload} />
            )}
            {tab === "graphs" && <Graphs result={result} download={download} jobId={analysisJobId} jobsPayload={jobsPayload} />}
            {tab === "report" && (
              <ReportTab
                report={(serverReportJobId === analysisJobId ? serverReportMarkdown : "") || result.artifacts.reportMarkdown}
                sourceJobId={analysisJobId}
                fallback={!serverReportMarkdown || serverReportJobId !== analysisJobId}
                download={download}
                confidence={confidence}
                jobsPayload={jobsPayload}
                onSelectJobReport={(id) => { analysisJobIdRef.current = id; setAnalysisJobId(id); void fetchJobReport(id); }}
                onDeleteJob={(id) => void deleteJobById(id)}
              />
            )}
            {tab === "jobs" && (
              <Jobs
                text={jobsJson || "작업 목록을 자동으로 불러오는 중입니다."}
                download={download}
                liveJobId={liveJobId}
                liveJob={liveJob}
                liveLogs={liveLogs}
                liveConnected={liveConnected}
                autoScroll={liveAutoScroll}
                setAutoScroll={setLiveAutoScroll}
                onStop={stopLiveJob}
                autoRefreshEnabled={autoRefreshEnabled}
                setAutoRefreshEnabled={setAutoRefreshEnabled}
                jobsPayload={jobsPayload}
                autoAttachNewJob={autoAttachNewJob}
                setAutoAttachNewJob={setAutoAttachNewJob}
                onWatchJob={startLiveJob}
                onDeleteJob={(id) => void deleteJobById(id)}
                selectedJobIds={selectedJobIds}
                setSelectedJobIds={setSelectedJobIds}
                onDeleteSelected={(ids) => void deleteJobsByIds(ids)}
                onCancelSelected={(ids) => void cancelJobsByIds(ids)}
                onCancelJob={(id) => void cancelJobById(id)}
              />
            )}
            {tab === "status" && (
              <StatusTab
                text={statusJson || "시스템 상태를 자동으로 불러오는 중입니다."}
                payload={statusPayload}
                download={download}
                autoRefreshEnabled={autoRefreshEnabled}
                setAutoRefreshEnabled={setAutoRefreshEnabled}
                onParallelChange={(value) => void updateParallelJobs(value)}
              />
            )}
          </div>
        </section>
      </div>
      <p
        className="footer"
        title="TileForge 결과는 설계 후보를 빠르게 좁히기 위한 분석값이며, 최종 평가는 SCALE-Sim/IREE 실측으로 검증하는 것이 좋습니다."
      >
        TileForge는 분석용 탐색 도구입니다. 생성된 정책과 MLIR은 튜닝 후보로
        사용하고, 최종 결과는 SCALE-Sim/IREE로 검증하세요.
      </p>
    </main>
  );
}


function jobDisplayName(job: any): string {
  if (!job) return "작업 미선택";
  return String(job.name || job.request?.hardware?.name || job.id || "작업");
}

function jobLabel(job: any): string {
  if (!job) return "작업 미선택";
  return `${jobDisplayName(job)} · ${job.status}`;
}

function jobTooltip(job: any): string {
  if (!job) return "";
  const when = job.createdAt ? new Date(job.createdAt).toLocaleString() : "";
  return `${jobDisplayName(job)}${when ? " · 생성 " + when : ""}${job.id ? " · id " + job.id : ""}`;
}

function jobById(payload: any | null, id: string) {
  const jobs = Array.isArray(payload?.jobs) ? payload.jobs : [];
  return jobs.find((j: any) => j.id === id);
}

function ResultContextBar({
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

function JobSourceNotice({ jobId, jobsPayload, tabName }: { jobId: string; jobsPayload?: any | null; tabName: string }) {
  if (!jobId) return <p className="small source-notice">현재 입력 설정으로 계산한 {tabName} 미리보기입니다. 작업 결과를 보려면 위의 결과 기준에서 작업을 선택하세요.</p>;
  const job = jobById(jobsPayload, jobId);
  return <p className="small source-notice">작업 산출물 기준: <strong title={jobTooltip(job)}>{job ? jobDisplayName(job) : "선택 작업"}</strong>{job ? <span className="badge">{job.status}</span> : null}. 없는 항목은 현재 입력 미리보기로 대체됩니다.</p>;
}

function CsvArtifactTable({ jobId, path, title }: { jobId: string; path: string; title: string }) {
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


function JobArtifactText({ jobId, path, title }: { jobId: string; path: string; title: string }) {
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

function JobArtifactList({ jobId, jobsPayload }: { jobId: string; jobsPayload: any | null }) {
  const job = jobById(jobsPayload, jobId);
  const artifacts: string[] = Array.isArray(job?.artifacts) ? job.artifacts : [];
  const storageKey = `tileforge:selected-artifacts:${jobId}`;
  const [selected, setSelected] = useState<string[]>([]);

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

function Metric({
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
function Policy({ result, download, jobId, jobsPayload }: { result: any; download: DownloadFn; jobId?: string; jobsPayload?: any | null }) {
  return (
    <>
      <JobSourceNotice jobId={jobId ?? ""} jobsPayload={jobsPayload} tabName="타일 정책" />
      {jobId && <CsvArtifactTable jobId={jobId} path="best_tile_policy.csv" title="선택 작업의 best_tile_policy.csv" />}
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
            <th title="선택 타일의 SRAM 작업 영역입니다.">SRAM 영역</th>
            <th title="전체 타일 반복을 고려한 SRAM access traffic 추정입니다.">SRAM access</th>
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
              <td>{((r.best.predictedSramAccessBytes ?? 0) / 1024).toFixed(1)} KiB</td>
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
function Heat({ points }: { points: any[] }) {
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
function Bottleneck({ result, jobId }: { result: any; jobId?: string }) {
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
function Roofline({ result, jobId }: { result: any; jobId?: string }) {
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
function Energy({ result, jobId }: { result: any; jobId?: string }) {
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
        <MarkdownView text={fusionMarkdown(analyzeFusion(result.request.shapes))} />
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
function ArraySweep({
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
function Iree({ result, download, jobId }: { result: any; download: DownloadFn; jobId?: string }) {
  return (
    <>
      <JobSourceNotice jobId={jobId ?? ""} tabName="IREE/MLIR" />
      {jobId && <JobArtifactText jobId={jobId} path="generated.mlir" title="선택 작업의 generated.mlir" />}
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
function Exports({ result, download, jobId, jobsPayload }: { result: any; download: DownloadFn; jobId?: string; jobsPayload?: any | null }) {
  return (
    <>
      <JobSourceNotice jobId={jobId ?? ""} jobsPayload={jobsPayload} tabName="내보내기" />
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

function Graphs({ result, download, jobId, jobsPayload }: { result: any; download: DownloadFn; jobId?: string; jobsPayload?: any | null }) {
  const [jobResult, setJobResult] = useState<any | null>(null);
  const [scaleSummary, setScaleSummary] = useState<any | null>(null);
  const [scaleTop3Summary, setScaleTop3Summary] = useState<any | null>(null);
  const [selectedOp, setSelectedOp] = useState(0);
  const [metric, setMetric] = useState("cycles");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError("");
      setJobResult(null);
      setScaleSummary(null);
      setScaleTop3Summary(null);
      if (!jobId) return;
      try {
        const [r, sr, top3r] = await Promise.all([
          fetch(`/api/jobs/${jobId}/artifact?path=${encodeURIComponent("result.json")}`, { cache: "no-store" }),
          fetch(`/api/jobs/${jobId}/artifact?path=${encodeURIComponent("scalesim_summary.json")}`, { cache: "no-store" }),
          fetch(`/api/jobs/${jobId}/artifact?path=${encodeURIComponent("scalesim_top3_summary.json")}`, { cache: "no-store" }),
        ]);
        if (!r.ok) throw new Error(await r.text());
        const parsed = JSON.parse(await r.text());
        if (!cancelled) setJobResult(parsed?.payload?.response ?? parsed?.response ?? parsed);
        if (sr.ok) {
          const st = await sr.text();
          if (!cancelled) setScaleSummary(JSON.parse(st));
        }
        if (top3r.ok) {
          const t3 = await top3r.text();
          if (!cancelled) setScaleTop3Summary(JSON.parse(t3));
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      }
    }
    void load();
    return () => { cancelled = true; };
  }, [jobId]);

  const source = jobResult ?? result;
  const rows = Array.isArray(source?.results) ? source.results : [];
  const opIndex = Math.min(selectedOp, Math.max(0, rows.length - 1));
  const op = rows[opIndex];
  const hw = source?.request?.hardware ?? result?.request?.hardware ?? { frequencyMHz: 700 };
  const shape = op?.shape ?? {};
  const dtype = Number(shape.dtypeBytes || hw.bytesPerElement || 2);
  const dramBytes = Math.max(1, (Number(shape.m) * Number(shape.k) + Number(shape.k) * Number(shape.n) + 2 * Number(shape.m) * Number(shape.n)) * dtype);
  const estimatedSramAccessKiB = (p: any) => {
    const direct = Number(p.predictedSramAccessBytes);
    if (Number.isFinite(direct) && direct > 0) return direct / 1024;
    const tm = Number(p.tileM || 1), tn = Number(p.tileN || 1), tk = Number(p.tileK || 1);
    const mTiles = Math.ceil(Number(shape.m || 1) / Math.max(1, tm));
    const nTiles = Math.ceil(Number(shape.n || 1) / Math.max(1, tn));
    const kTiles = Math.ceil(Number(shape.k || 1) / Math.max(1, tk));
    const tileRepeats = Math.max(1, mTiles * nTiles * kTiles);
    const ifmap = tileRepeats * tm * tk;
    const filter = tileRepeats * tk * tn;
    const ofmap = tileRepeats * tm * tn;
    const partial = Math.max(0, kTiles - 1) * mTiles * nTiles * tm * tn;
    return ((ifmap + filter + ofmap + partial) * dtype) / 1024;
  };
  const estimatedDramAccessKiB = (p: any) => {
    const direct = Number(p.predictedDramAccessBytes);
    if (Number.isFinite(direct) && direct > 0) return direct / 1024;
    return dramBytes / 1024;
  };
  const tileKey = (p: any) => `${Number(p.tileM)}x${Number(p.tileN)}x${Number(p.tileK)}`;
  const externalCandidates = [
    ...(Array.isArray(scaleSummary?.candidateLayers) ? scaleSummary.candidateLayers : []),
    ...(Array.isArray(scaleTop3Summary?.layers) ? scaleTop3Summary.layers : []),
  ];
  const mainActual = scaleSummary?.layers?.[opIndex];
  const candidateActualByRank = new Map<number, any>();
  const candidateActualByTile = new Map<string, any>();
  for (const c of externalCandidates) {
    if ((c.shapeId && c.shapeId === shape.id) || (!c.shapeId && c.opName === shape.opName)) {
      candidateActualByTile.set(tileKey(c), c);
      const rank = Number(c.rank);
      if (Number.isFinite(rank) && rank > 0) candidateActualByRank.set(rank, c);
    }
  }
  const allCandidates = (Array.isArray(op?.candidates) ? op.candidates : []).map((p: any, index: number) => ({
    ...p,
    __rank: index + 1,
    __actual: candidateActualByRank.get(index + 1) ?? candidateActualByTile.get(tileKey(p)) ?? (index === 0 ? mainActual : undefined),
  }));
  const top = allCandidates.slice(0, 3);
  const actualFor = (p: any, index: number) => p.__actual ?? candidateActualByRank.get(index + 1) ?? candidateActualByTile.get(tileKey(p)) ?? (index === 0 ? mainActual : undefined);
  const actualAccessKiB = (a: any, key: "sramAccesses" | "dramAccesses") => {
    const accesses = Number(a?.[key]);
    return Number.isFinite(accesses) && accesses > 0 ? accesses * dtype / 1024 : undefined;
  };
  const metricInfo: Record<string, { label: string; unit: string; lowerBetter: boolean; value: (p: any) => number; actualValue?: (a: any) => number | undefined; format: (v: number) => string; description: string }> = {
    cycles: { label: "Cycle", unit: "cyc", lowerBetter: true, value: (p) => Number(p.cycles) || 0, actualValue: (a) => Number(a?.cycles) || undefined, format: (v) => Math.round(v).toLocaleString(), description: "TileForge estimator cycle과 SCALE-Sim top3 tile 실행값을 비교합니다." },
    timeUs: { label: "실행 시간", unit: "us", lowerBetter: true, value: (p) => (Number(p.cycles) || 0) / Math.max(1, Number(hw.frequencyMHz || 700)), actualValue: (a) => Number(a?.cycles) ? Number(a.cycles) / Math.max(1, Number(hw.frequencyMHz || 700)) : undefined, format: (v) => v.toFixed(3), description: "cycle을 주파수로 나눈 예상/실제 실행 시간입니다." },
    utilization: { label: "PE 사용률", unit: "%", lowerBetter: false, value: (p) => (Number(p.utilization) || 0) * 100, actualValue: (a) => Number(a?.overallUtil ?? a?.computeUtil) || undefined, format: (v) => `${v.toFixed(1)}%`, description: "예측 PE 사용률과 SCALE-Sim Overall/Compute Util을 비교합니다." },
    padding: { label: "패딩 비율", unit: "%", lowerBetter: true, value: (p) => (Number(p.paddingRatio) || 0) * 100, format: (v) => `${v.toFixed(1)}%`, description: "타일 경계에서 낭비되는 계산 비율입니다." },
    sram: { label: "SRAM 작업 영역", unit: "KiB", lowerBetter: true, value: (p) => (Number(p.sramBytes) || 0) / 1024, format: (v) => `${v.toFixed(1)} KiB`, description: "타일 하나가 동시에 필요로 하는 IFMAP/FILTER/OFMAP 로컬 SRAM 작업 영역입니다." },
    sramAccess: { label: "SRAM access traffic", unit: "KiB", lowerBetter: true, value: (p) => estimatedSramAccessKiB(p), actualValue: (a) => actualAccessKiB(a, "sramAccesses"), format: (v) => `${v.toFixed(1)} KiB`, description: "예측 SRAM 접근량과 SCALE-Sim SRAM access를 비교합니다." },
    dram: { label: "DRAM access traffic", unit: "KiB", lowerBetter: true, value: (p) => estimatedDramAccessKiB(p), actualValue: (a) => actualAccessKiB(a, "dramAccesses"), format: (v) => `${v.toFixed(1)} KiB`, description: "예측 DRAM 접근량과 SCALE-Sim DRAM access 총량입니다." },
    score: { label: "종합 점수", unit: "score", lowerBetter: true, value: (p) => Number(p.score ?? p.cycles) || 0, format: (v) => v.toFixed(3), description: "objective에 따른 내부 ranking 점수입니다." },
  };
  const info = metricInfo[metric] ?? metricInfo.cycles;
  const allActualMetricValues = allCandidates.map((p: any, i: number) => info.actualValue?.(actualFor(p, i))).map((v) => Number.isFinite(v) && v! > 0 ? v : undefined);
  const actualMetricValues = top.map((p: any, i: number) => info.actualValue?.(actualFor(p, i))).map((v) => Number.isFinite(v) && v! > 0 ? v : undefined);
  const hasActualMetric = allActualMetricValues.some((v) => v !== undefined);
  const maxValue = Math.max(1e-9, ...allActualMetricValues.map((v) => v ? Math.abs(v) : 0), ...allCandidates.map((p: any) => Math.abs(info.value(p)) || 0));
  const best = allCandidates.length
    ? [...allCandidates].sort((a: any, b: any) => info.lowerBetter ? info.value(a) - info.value(b) : info.value(b) - info.value(a))[0]
    : top[0];
  const svgWidth = 980;
  const rowH = hasActualMetric ? 44 : 34;
  const svgHeight = 86 + Math.max(1, allCandidates.length) * rowH;
  const safeTitle = `${info.label} comparison${op?.shape ? ` - ${op.shape.model}.${op.shape.opName}` : ""}`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${svgHeight}" viewBox="0 0 ${svgWidth} ${svgHeight}">
  <rect width="100%" height="100%" fill="#0b1020"/>
  <text x="20" y="30" fill="#eaf0ff" font-family="Arial" font-size="18">${safeTitle}</text>
  <text x="20" y="52" fill="#9fb0d0" font-family="Arial" font-size="12">전체 tile 후보 ${allCandidates.length}개를 모두 표시합니다. ${info.description}</text>
  ${allCandidates.map((p: any, i: number) => {
    const y = 86 + i * rowH;
    const v = info.value(p);
    const w = Math.max(2, Math.round((Math.abs(v) / maxValue) * 600));
    const label = `#${p.__rank ?? i + 1} ${p.tileM}x${p.tileN}x${p.tileK}`;
    const actualMetricValue = allActualMetricValues[i];
    const actualW = actualMetricValue ? Math.max(2, Math.round((Math.abs(actualMetricValue) / maxValue) * 600)) : 0;
    const actualPart = actualW ? `<rect x="170" y="${y + 20}" width="${actualW}" height="6" rx="3" fill="#ffb86b"/><text x="${180 + actualW}" y="${y + 26}" fill="#ffdfb0" font-family="Consolas, monospace" font-size="10">SCALE-Sim ${info.format(actualMetricValue!)}</text>` : "";
    return `<text x="20" y="${y + 15}" fill="#cfe0ff" font-family="Consolas, monospace" font-size="12">${label}</text><rect x="170" y="${y}" width="${w}" height="16" rx="4" fill="#8db3ff"/><text x="${180 + w}" y="${y + 13}" fill="#eaf0ff" font-family="Consolas, monospace" font-size="12">예측 ${info.format(v)} · util ${((Number(p.utilization) || 0) * 100).toFixed(1)}% · SRAM ${((Number(p.sramBytes)||0)/1024).toFixed(1)} KiB</text>${actualPart}`;
  }).join("\n  ")}
</svg>`;

  const overviewMetrics = ["cycles", "utilization", "sramAccess", "dram"].map((key) => ({ key, info: metricInfo[key] }));
  const metricMax = new Map<string, number>();
  for (const item of overviewMetrics) {
    const values = top.flatMap((p: any, i: number) => {
      const predicted = Math.abs(item.info.value(p)) || 0;
      const actual = item.info.actualValue?.(actualFor(p, i));
      return [predicted, Number.isFinite(actual) && actual! > 0 ? Math.abs(actual!) : 0];
    });
    metricMax.set(item.key, Math.max(1e-9, ...values));
  }
  const overviewRowH = 90;
  const overviewHeight = 74 + Math.max(1, top.length) * overviewRowH;
  const overviewSvg = `<svg xmlns="http://www.w3.org/2000/svg" width="${svgWidth}" height="${overviewHeight}" viewBox="0 0 ${svgWidth} ${overviewHeight}">
  <rect width="100%" height="100%" fill="#0b1020"/>
  <text x="20" y="30" fill="#eaf0ff" font-family="Arial" font-size="18">Top-3 multi-metric overview</text>
  <text x="20" y="52" fill="#9fb0d0" font-family="Arial" font-size="12">각 타일의 cycle, PE 사용률, SRAM/DRAM access를 한 번에 비교합니다. 파란색=예측, 주황색=SCALE-Sim.</text>
  ${top.map((p: any, i: number) => {
    const baseY = 78 + i * overviewRowH;
    const label = `#${p.__rank ?? i + 1} ${p.tileM}x${p.tileN}x${p.tileK}`;
    const actual = actualFor(p, i);
    const bars = overviewMetrics.map((item, j) => {
      const y = baseY + 18 + j * 16;
      const predicted = item.info.value(p);
      const actualValue = item.info.actualValue?.(actual);
      const max = metricMax.get(item.key) ?? 1;
      const pw = Math.max(2, Math.round((Math.abs(predicted) / max) * 250));
      const aw = Number.isFinite(actualValue) && actualValue! > 0 ? Math.max(2, Math.round((Math.abs(actualValue!) / max) * 250)) : 0;
      const actualText = aw ? ` / 실제 ${item.info.format(actualValue!)}` : "";
      return `<text x="170" y="${y + 9}" fill="#9fb0d0" font-family="Arial" font-size="10">${item.info.label}</text><rect x="285" y="${y}" width="${pw}" height="6" rx="3" fill="#8db3ff"/><rect x="285" y="${y + 8}" width="${aw}" height="6" rx="3" fill="#ffb86b"/><text x="545" y="${y + 10}" fill="#eaf0ff" font-family="Consolas, monospace" font-size="10">예측 ${item.info.format(predicted)}${actualText}</text>`;
    }).join("");
    return `<text x="20" y="${baseY + 16}" fill="#cfe0ff" font-family="Consolas, monospace" font-size="12">${label}</text>${bars}`;
  }).join("\n  ")}
</svg>`;

  return (
    <section className="graphs-panel">
      <JobSourceNotice jobId={jobId ?? ""} jobsPayload={jobsPayload} tabName="그래프" />
      <h3>타일 후보 성능 비교</h3>
      <p className="small">첫 번째 그래프는 선택한 지표를 모든 tile 후보에 대해 표시합니다. 두 번째 그래프는 SCALE-Sim으로 검증한 상위 3개 tile의 cycle/PE/SRAM/DRAM을 한 번에 보여줍니다.</p>
      {error && <p className="small warn">선택 작업 result.json을 읽지 못해 현재 입력 미리보기를 사용합니다: {error}</p>}
      <div className="row graph-controls">
        <div>
          <FieldLabel tip="그래프로 볼 연산을 선택합니다.">연산 선택</FieldLabel>
          <select value={opIndex} onChange={(e) => setSelectedOp(Number(e.target.value))}>
            {rows.map((r: any, i: number) => <option key={i} value={i}>{r.shape?.model}.{r.shape?.opName}</option>)}
          </select>
        </div>
        <div>
          <FieldLabel tip="막대 그래프의 기준 지표를 선택합니다.">그래프 지표</FieldLabel>
          <select value={metric} onChange={(e) => setMetric(e.target.value)}>
            <option value="cycles">Cycle</option>
            <option value="timeUs">예상 실행 시간</option>
            <option value="utilization">PE 사용률</option>
            <option value="padding">패딩 비율</option>
            <option value="sram">SRAM 작업 영역</option>
            <option value="sramAccess">SRAM access traffic</option>
            <option value="dram">DRAM access traffic</option>
            <option value="score">종합 점수</option>
          </select>
        </div>
      </div>
      <div className="graph-actions">
        <ActionButton tip="현재 선택 지표의 전체 후보 그래프를 SVG 파일로 다운로드합니다." onClick={() => download(`tile-candidate-all-${metric}.svg`, svg, "image/svg+xml")}>전체 후보 SVG 다운로드</ActionButton>
        <ActionButton tip="Top-3 전체 지표 요약 그래프를 SVG 파일로 다운로드합니다." onClick={() => download("tile-candidate-top3-overview.svg", overviewSvg, "image/svg+xml")}>Top-3 요약 SVG 다운로드</ActionButton>
      </div>
      {best && (
        <div className="cards graph-summary-cards">
          <Metric title={info.lowerBetter ? `전체 후보 최저 ${info.label}` : `전체 후보 최고 ${info.label}`} value={info.format(info.value(best))} tip="현재 선택한 지표 기준 전체 후보 중 가장 좋은 타일입니다." />
          <Metric title="선택 지표 최상위 타일" value={`${best.tileM}×${best.tileN}×${best.tileK}`} tip="현재 그래프 지표 기준 전체 후보 중 최상위 타일입니다." />
          <Metric title="PE 사용률" value={`${((best.utilization ?? 0) * 100).toFixed(1)}%`} tip="선택 후보의 PE 사용률입니다." />
          <Metric title="SRAM 작업 영역" value={`${((best.sramBytes ?? 0) / 1024).toFixed(1)} KiB`} tip="선택 후보의 로컬 SRAM/cache 작업 영역입니다." />
          <Metric title="SRAM 접근량" value={`${estimatedSramAccessKiB(best).toFixed(1)} KiB`} tip="선택 후보의 전체 SRAM access traffic 추정입니다." />
        </div>
      )}
      <h3>전체 후보 지표 그래프</h3>
      <div className="chart-scroll"><div className="chart-svg" dangerouslySetInnerHTML={{ __html: svg }} /></div>
      <h3>Top-3 검증 요약 그래프</h3>
      <div className="chart-scroll"><div className="chart-svg" dangerouslySetInnerHTML={{ __html: overviewSvg }} /></div>
      <h3>상위 3개 타일 후보 검증 표</h3>
      <table className="compact-table">
        <thead><tr><th>순위</th><th>타일</th><th>{info.label} 예측</th><th>{info.label} 실제</th><th>예측 cycle</th><th>SCALE-Sim cycle</th><th>시간 us</th><th>사용률</th><th>패딩</th><th>SRAM 영역</th><th>SRAM access</th><th>DRAM access</th></tr></thead>
        <tbody>{top.map((p: any, i: number) => {
          const actual = actualFor(p, i);
          const actualMetricValue = actualMetricValues[i];
          return (
            <tr key={`${p.tileM}-${p.tileN}-${p.tileK}-${i}`}>
              <td>{i + 1}</td><td>{p.tileM}×{p.tileN}×{p.tileK}</td><td>{info.format(info.value(p))}</td><td>{actualMetricValue ? info.format(actualMetricValue) : "-"}</td><td>{Math.round(p.cycles).toLocaleString()}</td><td>{actual?.cycles ? Math.round(actual.cycles).toLocaleString() : "-"}</td><td>{((Number(p.cycles)||0)/Math.max(1, Number(hw.frequencyMHz||700))).toFixed(3)}</td><td>{((p.utilization ?? 0) * 100).toFixed(1)}% / {actual?.overallUtil ? `${Number(actual.overallUtil).toFixed(1)}%` : "-"}</td><td>{((p.paddingRatio ?? 0) * 100).toFixed(1)}%</td><td>{((p.sramBytes ?? 0) / 1024).toFixed(1)} KiB</td><td>{estimatedSramAccessKiB(p).toFixed(1)} KiB / {actualAccessKiB(actual, "sramAccesses")?.toFixed(1) ?? "-"} KiB</td><td>{estimatedDramAccessKiB(p).toFixed(1)} KiB / {actualAccessKiB(actual, "dramAccesses")?.toFixed(1) ?? "-"} KiB</td>
            </tr>
          );
        })}</tbody>
      </table>
      <h3>전체 후보 타일 표</h3>
      <p className="small">아래 표는 estimator가 계산한 모든 후보를 현재 선택 지표 순서로 정렬한 것입니다. SCALE-Sim 실제값은 top3로 실행된 후보에만 표시됩니다.</p>
      <table className="compact-table">
        <thead><tr><th>지표순위</th><th>est.순위</th><th>타일</th><th>{info.label}</th><th>cycle</th><th>사용률</th><th>패딩</th><th>SRAM 영역</th><th>SRAM access</th><th>DRAM access</th></tr></thead>
        <tbody>{[...allCandidates].sort((a: any, b: any) => info.lowerBetter ? info.value(a) - info.value(b) : info.value(b) - info.value(a)).map((p: any, i: number) => (
          <tr key={`all-${p.tileM}-${p.tileN}-${p.tileK}-${i}`}>
            <td>{i + 1}</td><td>{p.__rank}</td><td>{p.tileM}×{p.tileN}×{p.tileK}</td><td>{info.format(info.value(p))}</td><td>{Math.round(p.cycles).toLocaleString()}</td><td>{((p.utilization ?? 0) * 100).toFixed(1)}%</td><td>{((p.paddingRatio ?? 0) * 100).toFixed(1)}%</td><td>{((p.sramBytes ?? 0) / 1024).toFixed(1)} KiB</td><td>{estimatedSramAccessKiB(p).toFixed(1)} KiB</td><td>{estimatedDramAccessKiB(p).toFixed(1)} KiB</td>
          </tr>
        ))}</tbody>
      </table>
    </section>
  );
}


function slugifyHeading(text: string): string {
  return text
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, "")
    .replace(/\s+/g, "-")
    .replace(/[^\w\-가-힣]/g, "")
    .slice(0, 80);
}

function InlineMarkdown({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, index) => {
        if (part.startsWith("**") && part.endsWith("**")) {
          return <strong key={index}>{part.slice(2, -2)}</strong>;
        }
        if (part.startsWith("`") && part.endsWith("`")) {
          return <code key={index}>{part.slice(1, -1)}</code>;
        }
        return <span key={index}>{part}</span>;
      })}
    </>
  );
}

function MarkdownView({ text }: { text: string }) {
  const blocks: React.ReactNode[] = [];
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  let i = 0;
  let key = 0;
  const takeList = () => {
    const isOrdered = /^\s*\d+[.)]\s+/.test(lines[i]);
    const items: string[] = [];
    const marker = isOrdered ? /^\s*\d+[.)]\s+/ : /^\s*[-*+]\s+/;
    while (i < lines.length && marker.test(lines[i])) {
      items.push(lines[i].replace(marker, ""));
      i++;
    }
    const ListTag = isOrdered ? "ol" : "ul";
    blocks.push(
      <ListTag className="md-list" key={key++}>
        {items.map((item, idx) => (
          <li key={idx}><InlineMarkdown text={item} /></li>
        ))}
      </ListTag>,
    );
  };
  const takeTable = () => {
    const rows: string[][] = [];
    while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) {
      const cells = lines[i].trim().slice(1, -1).split("|").map((c) => c.trim());
      rows.push(cells);
      i++;
    }
    if (rows.length < 2) return;
    const header = rows[0];
    const body = rows.slice(2);
    blocks.push(
      <div className="md-table-wrap" key={key++}>
        <table className="md-table">
          <thead><tr>{header.map((c, idx) => <th key={idx}><InlineMarkdown text={c} /></th>)}</tr></thead>
          <tbody>{body.map((r, ri) => <tr key={ri}>{r.map((c, ci) => <td key={ci}><InlineMarkdown text={c} /></td>)}</tr>)}</tbody>
        </table>
      </div>,
    );
  };
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      i++;
      const code: string[] = [];
      while (i < lines.length && !lines[i].startsWith("```")) code.push(lines[i++]);
      if (i < lines.length) i++;
      blocks.push(<pre className="md-code" key={key++}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = line.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      const level = heading[1].length;
      const content = heading[2].trim();
      const id = slugifyHeading(content);
      const headingTags = ["h2", "h3", "h4", "h5"] as const;
      const Tag: ElementType = headingTags[level - 1] ?? "h5";
      blocks.push(<Tag className="md-heading" id={id} key={key++}><InlineMarkdown text={content} /></Tag>);
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < lines.length && /^\s*\|\s*:?-/.test(lines[i + 1])) {
      takeTable();
      continue;
    }
    if (/^\s*(?:[-*+]|\d+[.)])\s+/.test(line)) {
      takeList();
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && lines[i].trim() && !lines[i].startsWith("```") && !/^(#{1,4})\s+/.test(lines[i]) && !/^\s*(?:[-*+]|\d+[.)])\s+/.test(lines[i]) && !/^\s*\|.*\|\s*$/.test(lines[i])) {
      para.push(lines[i++]);
    }
    blocks.push(<p className="md-p" key={key++}><InlineMarkdown text={para.join(" ")} /></p>);
  }
  return <article className="markdown-view">{blocks}</article>;
}

function ReportTab({
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
            onChange={(e) => onSelectJobReport(e.target.value)}
            title="보고서를 볼 작업을 선택합니다."
          >
            <option value="">Estimator 미리보기</option>
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


function JobExternalLogs({ jobId, live }: { jobId: string; live?: boolean }) {
  const [logs, setLogs] = useState<Array<{ path: string; text: string; bytes?: number; updatedAt?: string }>>([]);
  const [open, setOpen] = useState(true);
  const [autoScroll, setAutoScroll] = useState(true);
  const bodyRefs = useRef<Record<string, HTMLPreElement | null>>({});
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
  useEffect(() => {
    if (!autoScroll) return;
    for (const el of Object.values(bodyRefs.current) as Array<HTMLPreElement | null>) if (el) el.scrollTop = el.scrollHeight;
  }, [logs, autoScroll, open]);
  if (!jobId) return null;
  const scrollToBottom = () => {
    for (const el of Object.values(bodyRefs.current) as Array<HTMLPreElement | null>) if (el) el.scrollTop = el.scrollHeight;
  };
  return (
    <section className="external-log-panel" title="SCALE-Sim과 IREE가 실제로 출력한 stdout/stderr 로그입니다.">
      <div className="external-log-header">
        <div>
          <b>SCALE-Sim / IREE 실시간 원본 로그</b>
          <p className="small">TileForge 진행 로그와 별개로 외부 도구의 실제 명령, cwd, stdout, stderr를 계속 tail합니다.</p>
        </div>
        <div className="terminal-actions">
          <label className="terminal-check" title="외부 도구 로그가 갱신될 때 각 로그 창을 맨 아래로 이동합니다.">
            <input type="checkbox" checked={autoScroll} onChange={(e) => setAutoScroll(e.target.checked)} /> 자동 스크롤
          </label>
          <button className="secondary" onClick={scrollToBottom}>맨 아래로</button>
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
            <pre ref={(el) => { bodyRefs.current[log.path] = el; }} className={`terminal-body external-log-body ${status.className}`}>{log.text}</pre>
          </details>
        );
      })}
    </section>
  );
}


function externalLogStatus(text: string): { label: string; className: string } {
  const exit = text.match(/exitCode:\s*(-?\d+)/)?.[1];
  const lower = text.toLowerCase();
  if (exit && exit !== "0") return { label: `실패 exit ${exit}`, className: "err-badge" };
  if (exit === "0" && lower.includes("warning:")) return { label: "경고 있음 · 성공", className: "warn-badge" };
  if (exit === "0") return { label: "성공", className: "ok-badge" };
  if (lower.includes("traceback") || lower.includes("error:")) return { label: "실패 가능", className: "err-badge" };
  if (lower.includes("warning:")) return { label: "경고", className: "warn-badge" };
  return { label: "실행 중", className: "" };
}

function ExternalStatusOverview({ report }: { report: string }) {
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

function statusClass(status: string) {
  if (status.includes("적용") || status === "성공") return "ok-card";
  if (status.includes("대기") || status.includes("부분")) return "warn-card";
  if (status.includes("미반영") || status.includes("실패")) return "err-card";
  return "";
}

function parseExternalStatus(report: string): Array<{ label: string; status: string; reason: string }> {
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


function fmtBytes(bytes: number | undefined): string {
  if (!Number.isFinite(bytes ?? NaN)) return "-";
  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let value = Number(bytes);
  let i = 0;
  while (value >= 1024 && i < units.length - 1) { value /= 1024; i++; }
  return `${value.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function ResourceMonitor({ payload, onParallelChange }: { payload: any | null; onParallelChange: (value: number) => void }) {
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
          <button onClick={() => onParallelChange(Number(parallelDraft))}>.env에 저장</button>
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

function StatusTab({
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
        <label className="terminal-check">
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
function Jobs({
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


function QueueSummary({
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
          <span className="badge">running {running.length}</span>
          <span className="badge">queued {queued.length}</span>
          <span className="badge">total {payload?.total ?? jobs.length}</span>
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
      <p className="small">새 작업 생성 시 콘솔 자동 연결을 끄면 큐에는 추가되지만 현재 보고 있는 콘솔은 유지됩니다.</p>
    </section>
  );
}

function LiveTerminal({
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
          <button className="secondary" title="현재 콘솔을 맨 아래로 이동합니다." onClick={() => { const el = boxRef.current; if (el) el.scrollTop = el.scrollHeight; }}>맨 아래로</button>
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

function classifyLogLine(line: string) {
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
function Artifact({
  name,
  text,
  download,
}: {
  name: string;
  text: string;
  download: DownloadFn;
}) {
  const [showRaw, setShowRaw] = useState(false);
  const isMarkdown = name.toLowerCase().endsWith(".md");
  return (
    <section className="artifact-panel" title={`${name} 미리보기와 다운로드입니다.`}>
      <div className="artifact-toolbar">
        <ActionButton
          tip={`${name} 파일을 다운로드합니다.`}
          onClick={() => download(name, text)}
        >{`${name} 다운로드`}</ActionButton>
        {isMarkdown && (
          <button className="secondary" onClick={() => setShowRaw((v) => !v)} title="Markdown 렌더링과 원문 보기를 전환합니다.">
            {showRaw ? "렌더링 보기" : "원문 보기"}
          </button>
        )}
      </div>
      {isMarkdown && !showRaw ? (
        <MarkdownView text={text} />
      ) : (
        <pre className="pre" title={`${name} 파일 내용 미리보기입니다.`}>
          {text}
        </pre>
      )}
    </section>
  );
}
