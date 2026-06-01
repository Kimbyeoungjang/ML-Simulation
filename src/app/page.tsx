"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { conv2dToGemm } from "@/lib/conv";
import { parseShapesCsv } from "@/lib/csv";
import {
  defaultArraySweep,
  defaultCandidates,
  defaultHardware,
  defaultShapes,
} from "@/lib/defaults";
import { estimateAll, sweepArrays } from "@/lib/estimator";
import { applyEstimatorSuiteToSearchResponse } from "@/lib/estimatorSuiteApply";
import { estimatorPresets as builtInEstimatorPresets, findEstimatorPreset } from "@/lib/estimatorPresets";
import type { EstimatorSuiteModel } from "@/lib/estimatorSuite";
import { parseNumList, fmt } from "@/lib/math";
import { hardwarePresets, workloadPresets } from "@/lib/presets";
import { assessConfidence, confidenceMarkdown, type ConfidenceAssessment } from "@/lib/confidence";
import { totalCycleUncertainty } from "@/lib/uncertainty";
import type {
  Conv2DShape,
  Dataflow,
  HardwareConfig,
  MatmulShape,
  Objective,
  SearchRequest,
  ScaleSimOverrides,
} from "@/types/domain";

import { type DownloadFn } from "@/components/workbench/primitives";
import { InputSettingsPanel } from "@/components/workbench/InputSettingsPanel";
import { jobDisplayName } from "@/components/workbench/resultTabs";
import { ResultsPanel } from "@/components/workbench/ResultsPanel";

type Tab =
  | "policy"
  | "bottleneck"
  | "roofline"
  | "energy"
  | "array"
  | "iree"
  | "exports"
  | "graphs"
  | "report"
  | "jobs"
  | "status";
type InputTab =
  | "hardware"
  | "tiling"
  | "workload"
  | "run"
  | "tools"
  | "settings";

const tabLabels: Record<Tab, string> = {
  policy: "타일 후보",
  bottleneck: "병목",
  roofline: "Roofline",
  energy: "에너지",
  array: "배열 탐색",
  iree: "컴파일",
  exports: "파일",
  graphs: "그래프",
  report: "보고서",
  jobs: "작업 큐",
  status: "시스템",
};

const inputTabLabels: Record<InputTab, string> = {
  hardware: "하드웨어",
  tiling: "타일링",
  workload: "워크로드",
  run: "실행",
  tools: "도구",
  settings: "설정",
};

const inputTabTips: Record<InputTab, string> = {
  hardware: "가속기 크기, 클럭, SRAM/DRAM, dataflow를 정합니다.",
  tiling: "타일 후보와 ranking 기준을 정합니다. 하드웨어 성능 예측과 tile 선택을 분리해 봅니다.",
  workload: "GEMM 목록을 직접 만들거나 CSV/ONNX/Conv2D에서 가져옵니다.",
  run: "현재 설정으로 SCALE-Sim/IREE 검증 작업을 큐에 넣고 실행 상태를 확인합니다.",
  tools: "프리셋과 프로젝트 파일을 관리합니다. 학습기는 별도 페이지에서 다룹니다.",
  settings: "외부 도구 명령, 작업 폴더, 병렬 작업 수 같은 .env 값을 확인하고 바꿉니다.",
};

const envSettingKeys = [
  "TILEFORGE_SCALE_SIM_CMD",
  "TILEFORGE_IREE_COMPILE_CMD",
  "TILEFORGE_MAX_PARALLEL_JOBS",
  "TILEFORGE_WORKSPACE_DIR",
  "TILEFORGE_JOB_STORE",
  "TILEFORGE_CACHE_DIR",
  "TILEFORGE_EXTERNAL_TIMEOUT_MS",
];

const tabTips: Record<Tab, string> = {
  policy: "연산별 추천 tile과 하드웨어 설계용 cycle을 확인합니다.",
  bottleneck: "전체 cycle을 크게 만드는 연산과 병목 원인을 빠르게 찾습니다.",
  roofline: "연산 집약도 기준으로 compute-bound인지 memory-bound인지 봅니다.",
  energy: "MAC, SRAM, DRAM 접근량으로 대략적인 에너지와 EDP를 계산합니다.",
  array: "여러 systolic array 크기를 같은 workload로 비교합니다.",
  iree: "MLIR/IREE 관련 산출물과 컴파일 명령을 확인합니다.",
  exports: "SCALE-Sim, MLIR, SVG, CSV, manifest 파일을 내려받습니다.",
  graphs: "cycle, memory, mapping, stall, sweet spot을 시각적으로 확인합니다.",
  report: "핵심 결과만 정리한 Markdown 보고서를 확인합니다.",
  jobs: "검증 작업 큐, 진행 상태, 로그, artifact를 관리합니다.",
  status: "서버, 워커, 저장소, 외부 도구 상태를 점검합니다.",
};


function confidenceFromMarkdown(text: string): ConfidenceAssessment | null {
  const first = text.split(/\r?\n/).find((line) => line.includes("신뢰도:"));
  if (!first) return null;
  const pct = Number(first.match(/\((\d+(?:\.\d+)?)%\)/)?.[1]);
  const uncertainty = Number(text.match(/예상 불확실성:\s*±(\d+(?:\.\d+)?)%/)?.[1]);
  const level = first.includes("높음") ? "high" : first.includes("보통") ? "medium" : "low";
  const reasons = text
    .split(/\r?\n/)
    .filter((line) => line.trim().startsWith("- "))
    .map((line) => line.replace(/^\s*-\s*/, ""));
  return {
    level,
    score: Number.isFinite(pct) ? Math.max(0, Math.min(1, pct / 100)) : level === "high" ? 0.82 : level === "medium" ? 0.6 : 0.35,
    uncertaintyPct: Number.isFinite(uncertainty) ? uncertainty : level === "high" ? 12 : level === "medium" ? 24 : 40,
    reasons,
  };
}

export default function Home() {
  const [hardware, setHardware] = useState<HardwareConfig>(defaultHardware);
  const [dataflowModes, setDataflowModes] = useState<Dataflow[]>([defaultHardware.dataflow]);
  const [inputTab, setInputTab] = useState<InputTab>("hardware");
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
  const [envValues, setEnvValues] = useState<Record<string, string>>({});
  const [envMessage, setEnvMessage] = useState("");
  const [jobsJson, setJobsJson] = useState("");
  const [jobsPayload, setJobsPayload] = useState<any | null>(null);
  const [jobsViewMode, setJobsViewMode] = useState<"dashboard" | "paged">("paged");
  const [jobsPage, setJobsPage] = useState(1);
  const [jobsPageSize, setJobsPageSize] = useState(100);
  const [statusJson, setStatusJson] = useState("");
  const [statusPayload, setStatusPayload] = useState<any | null>(null);
  const [serverReportMarkdown, setServerReportMarkdown] = useState("");
  const [serverReportJobId, setServerReportJobId] = useState("");
  const [selectedJobConfidence, setSelectedJobConfidence] = useState<ConfidenceAssessment | null>(null);
  const [selectedJobConfidenceId, setSelectedJobConfidenceId] = useState("");
  const [reportAutoFollow, setReportAutoFollow] = useState(true);
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
  const [userEstimatorPresets, setUserEstimatorPresets] = useState<any[]>([]);
  const [estimatorPresetName, setEstimatorPresetName] = useState("");
  const [customPresetName, setCustomPresetName] = useState("");
  const [hardwarePresetName, setHardwarePresetName] = useState("");
  const [workloadPresetName, setWorkloadPresetName] = useState("");
  const [analysisJobId, setAnalysisJobId] = useState("");
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const liveEventSource = useRef<EventSource | null>(null);
  const [estimatorSuiteCsv, setEstimatorSuiteCsv] = useState(
    "id,model,opName,arrayRows,arrayCols,sramKB,frequencyMHz,dataflow,dtypeBytes,m,n,k,tileM,tileN,tileK,estimatorCycles,measuredCycles\n" +
      "s0,demo,qkv,128,128,4096,700,WS,2,384,768,768,128,128,64,1000000,1120000",
  );
  const [estimatorSuiteOptions, setEstimatorSuiteOptions] = useState({
    topK: 3,
    trees: 160,
    maxDepth: 10,
    minLeaf: 4,
    hiddenUnits: 64,
    epochs: 900,
    maxFinalTrainSamples: 20000,
    splits: "random,workload,array,dataflow,large-shape",
  });
  const [estimatorPlanOptions, setEstimatorPlanOptions] = useState({
    mRange: "64:512:64",
    nRange: "64:512:64",
    kRange: "64:512:64",
    tileMRange: defaultCandidates.tileM.join(","),
    tileNRange: defaultCandidates.tileN.join(","),
    tileKRange: defaultCandidates.tileK.join(","),
    arrayRange: `${defaultHardware.arrayRows}x${defaultHardware.arrayCols}`,
    sramKbRange: String(defaultHardware.sramKB),
    dataflows: "WS,OS,IS",
    maxSamples: 128,
    queueLimit: 128,
    topKPerShape: 1,
    includeCurrentShapes: true,
  });
  const [estimatorSuiteResult, setEstimatorSuiteResult] = useState<any | null>(null);
  const [estimatorSuiteBusy, setEstimatorSuiteBusy] = useState(false);
  const [estimatorSuiteModels, setEstimatorSuiteModels] = useState<any[]>([]);
  const [selectedEstimatorPreset, setSelectedEstimatorPreset] = useState("quick-512");
  const [activeEstimatorSuite, setActiveEstimatorSuite] = useState<{ runId?: string; model?: EstimatorSuiteModel } | null>(null);
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
  const effectiveEstimatorPresets = useMemo(() => [
    ...builtInEstimatorPresets.map((preset) => ({ ...preset, source: "builtin" })),
    ...userEstimatorPresets
      .filter((preset: any) => preset?.planOptions && preset?.trainOptions)
      .map((preset: any) => ({ ...preset, id: preset.id ?? `user-${preset.name}`, source: "estimator" })),
  ], [userEstimatorPresets]);
  const result = useMemo(() => applyEstimatorSuiteToSearchResponse(estimateAll(request), activeEstimatorSuite?.model), [JSON.stringify(request), activeEstimatorSuite?.runId]);
  const confidence = useMemo(
    () =>
      assessConfidence(result, {
        externalValidated: Boolean(result.artifacts?.validationCsv),
        estimatorSuiteSamples: result.estimatorSuite?.applied ? result.estimatorSuite.modelSamples ?? 0 : 0,
      }),
    [JSON.stringify(result.summary), result.estimatorSuite?.applied, result.estimatorSuite?.modelSamples, Boolean(result.artifacts?.validationCsv)],
  );
  const displayConfidence =
    selectedJobConfidence && selectedJobConfidenceId === analysisJobId
      ? selectedJobConfidence
      : confidence;
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
    void refreshPresets();
    void refreshEstimatorSuiteModels();
  }, []);

  async function refreshEnvSettings() {
    try {
      const r = await fetch("/api/env");
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "env read failed");
      setEnvValues(j.values ?? {});
      setEnvMessage("설정을 다시 읽었습니다.");
    } catch (error: any) {
      setEnvMessage(`설정 읽기 실패: ${error?.message ?? error}`);
    }
  }

  async function saveEnvSettings() {
    try {
      const r = await fetch("/api/env", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ values: envValues }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "env save failed");
      setEnvValues(j.values ?? envValues);
      setEnvMessage(".env를 저장했습니다. 실행 중인 작업에는 다음 실행부터 반영됩니다.");
    } catch (error: any) {
      setEnvMessage(`설정 저장 실패: ${error?.message ?? error}`);
    }
  }

  async function refreshEstimatorSuiteModels() {
    try {
      const r = await fetch("/api/estimator-suite", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Estimator suite model 목록을 불러오지 못했습니다.");
      setEstimatorSuiteModels(Array.isArray(j.models) ? j.models : []);
      if (j.activeRunId && j.activeModel) {
        const active = (Array.isArray(j.models) ? j.models : []).find((m: any) => m.runId === j.activeRunId);
        setActiveEstimatorSuite({ runId: j.activeRunId, model: j.activeModel });
        if (active) setServerMessage((prev) => prev || `활성 Estimator Suite 모델: ${j.activeRunId}`);
      } else {
        setActiveEstimatorSuite(null);
      }
    } catch (error: any) {
      setServerMessage(error?.message ?? String(error));
    }
  }

  async function refreshPresets() {
    try {
      const r = await fetch("/api/presets", { cache: "no-store" });
      if (!r.ok) throw new Error("프리셋 목록을 불러오지 못했습니다.");
      const data = await r.json();
      setCustomPresets(Array.isArray(data.presets) ? data.presets : []);
      setUserHardwarePresets(Array.isArray(data.hardwarePresets) ? data.hardwarePresets : []);
      setUserWorkloadPresets(Array.isArray(data.workloadPresets) ? data.workloadPresets : []);
      setUserEstimatorPresets(Array.isArray(data.estimatorPresets) ? data.estimatorPresets : []);
    } catch (error: any) {
      setServerMessage(error?.message ?? String(error));
    }
  }

  function persistCustomPresets(next: any[]) {
    setCustomPresets(next);
  }

  useEffect(() => {
    void refreshJobs({ switchTab: false, updateReport: false });
    void refreshStatus(false);
    const timer = window.setInterval(() => {
      if (!autoRefreshEnabled) return;
      void refreshJobs({ switchTab: false, updateReport: false });
      void refreshStatus(false);
    }, 3000);
    return () => {
      window.clearInterval(timer);
      liveEventSource.current?.close();
    };
  }, [autoRefreshEnabled, jobsViewMode, jobsPage, jobsPageSize]);

  useEffect(() => {
    setServerReportMarkdown("");
    setServerReportJobId("");
    setReportAutoFollow(true);
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

  function updateEstimatorSuiteOptions(patch: Partial<typeof estimatorSuiteOptions>) {
    setEstimatorSuiteOptions((cur) => ({ ...cur, ...patch }));
  }
  function updateEstimatorPlanOptions(patch: Partial<typeof estimatorPlanOptions>) {
    setEstimatorPlanOptions((cur) => ({ ...cur, ...patch }));
  }

  function applyEstimatorPreset(id = selectedEstimatorPreset) {
    const preset = effectiveEstimatorPresets.find((p: any) => p.id === id || p.name === id) ?? findEstimatorPreset(id);
    if (!preset) {
      setServerMessage(`Estimator 프리셋을 찾지 못했습니다: ${id}`);
      return;
    }
    setSelectedEstimatorPreset(id);
    setEstimatorPlanOptions((cur) => ({ ...cur, ...preset.planOptions }));
    setEstimatorSuiteOptions((cur) => ({ ...cur, ...preset.trainOptions }));
    setServerMessage(`Estimator 프리셋 적용: ${preset.name} - ${preset.description}`);
  }


  async function saveEstimatorPreset() {
    const name = estimatorPresetName.trim() || `estimator_${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}`;
    if (builtInEstimatorPresets.some((preset) => preset.name === name || preset.id === name)) {
      setServerMessage(`Estimator 기본 프리셋 '${name}'과 이름이 겹칩니다. 다른 이름을 사용하세요.`);
      return;
    }
    try {
      const r = await fetch("/api/presets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          kind: "estimator",
          name,
          description: "사용자가 저장한 Estimator 표본/학습 프리셋",
          planOptions: estimatorPlanOptions,
          trainOptions: estimatorSuiteOptions,
        }),
      });
      if (!r.ok) throw new Error(await r.text());
      await refreshPresets();
      setEstimatorPresetName(name);
      setSelectedEstimatorPreset(`user-${name}`);
      setServerMessage(`Estimator 프리셋 저장 완료: ${name}`);
    } catch (error: any) {
      setServerMessage(`Estimator 프리셋 저장 실패: ${error?.message ?? error}`);
    }
  }

  async function deleteEstimatorPreset(idOrName: string) {
    const preset = effectiveEstimatorPresets.find((p: any) => p.id === idOrName || p.name === idOrName);
    if (!preset) return;
    if (preset.source === "builtin") {
      setServerMessage("기본 Estimator 프리셋은 삭제할 수 없습니다. 사용자 프리셋만 삭제하세요.");
      return;
    }
    if (!window.confirm(`Estimator 프리셋 '${preset.name}'을 삭제할까요?`)) return;
    const r = await fetch(`/api/presets?kind=estimator&name=${encodeURIComponent(preset.name)}`, { method: "DELETE" });
    if (!r.ok) return setServerMessage(`Estimator 프리셋 삭제 실패: ${await r.text()}`);
    await refreshPresets();
    if (selectedEstimatorPreset === preset.id || selectedEstimatorPreset === preset.name) setSelectedEstimatorPreset("quick-512");
    if (estimatorPresetName === preset.name) setEstimatorPresetName("");
    setServerMessage(`Estimator 프리셋 삭제: ${preset.name}`);
  }

  async function generateEstimatorSuiteDesign() {
    setEstimatorSuiteBusy(true);
    try {
      const r = await fetch("/api/estimator-suite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "design", request, options: { topK: estimatorSuiteOptions.topK } }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Estimator suite design failed");
      setEstimatorSuiteCsv(j.designCsv);
      setEstimatorSuiteResult(j);
      setServerMessage(`Estimator suite 설계 CSV 생성: ${j.rows?.toLocaleString?.() ?? j.rows}개 후보`);
      } catch (e: any) {
      setServerMessage(`Estimator suite 설계 실패: ${e?.message ?? e}`);
    } finally {
      setEstimatorSuiteBusy(false);
    }
  }

  async function generateEstimatorSamplingPlan(enqueue = false) {
    setEstimatorSuiteBusy(true);
    try {
      const r = await fetch("/api/estimator-suite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: enqueue ? "plan-and-queue" : "plan",
          request,
          options: estimatorPlanOptions,
          maxSamples: estimatorPlanOptions.maxSamples,
          queueLimit: estimatorPlanOptions.queueLimit,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Estimator sampling plan failed");
      setEstimatorSuiteCsv(j.planCsv);
      setEstimatorSuiteResult(j);
      const queued = Array.isArray(j.queuedJobs) ? j.queuedJobs.length : 0;
      setServerMessage(enqueue ? `Estimator 표본 계획 ${j.rows}개 생성, full-pipeline 작업 ${queued}개 큐 등록` : `Estimator 표본 계획 CSV 생성: ${j.rows}개 후보`);
      if (enqueue) setTab("jobs");
      if (enqueue) await refreshJobs({ switchTab: true, updateReport: false });
      if (enqueue && j.queuedJobs?.[0]?.id && autoAttachNewJob) startLiveJob(j.queuedJobs[0].id);
    } catch (e: any) {
      setServerMessage(`Estimator 표본 계획 실패: ${e?.message ?? e}`);
    } finally {
      setEstimatorSuiteBusy(false);
    }
  }


  async function collectEstimatorSamplesFromJobsWeb() {
    setEstimatorSuiteBusy(true);
    try {
      const r = await fetch("/api/estimator-suite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "collect-jobs", csvText: estimatorSuiteCsv }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Estimator sample collection failed");
      setEstimatorSuiteCsv(j.csv ?? "");
      setEstimatorSuiteResult(j);
      setServerMessage(`완료 작업에서 estimator 학습 sample ${j.validSamples ?? 0}개 준비됨: 새로 수집 ${j.rows ?? 0}개`);
      } catch (e: any) {
      setServerMessage(`Estimator sample 수집 실패: ${e?.message ?? e}`);
    } finally {
      setEstimatorSuiteBusy(false);
    }
  }


  async function importEstimatorDatasetWeb(files: Array<{ name: string; text: string }>, train: boolean) {
    setEstimatorSuiteBusy(true);
    try {
      const r = await fetch("/api/estimator-suite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: train ? "dataset-job" : "dataset", request, files, options: estimatorSuiteOptions, train, activate: true }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Estimator dataset import failed");
      if (train && j.job?.id) {
        setEstimatorSuiteResult(j);
        setServerMessage(`Estimator dataset 학습 job 등록: ${j.job.name ?? j.job.id}. 작업 큐에서 진행률과 학습 로그를 확인하세요.`);
        setTab("jobs");
        await refreshJobs({ switchTab: true, updateReport: false });
        startLiveJob(j.job.id);
      } else {
        setEstimatorSuiteCsv(j.csv ?? "");
        setEstimatorSuiteResult(j);
        const valid = j.summary?.validSamples ?? 0;
        setServerMessage(`Estimator dataset 병합 완료: 유효 sample ${valid.toLocaleString?.() ?? valid}개`);
          }
    } catch (e: any) {
      setServerMessage(`Estimator dataset 처리 실패: ${e?.message ?? e}`);
    } finally {
      setEstimatorSuiteBusy(false);
    }
  }

  async function runEstimatorSuiteWeb() {
    setEstimatorSuiteBusy(true);
    try {
      const r = await fetch("/api/estimator-suite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "suite-job", request, csvText: estimatorSuiteCsv, options: estimatorSuiteOptions, activate: true }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Estimator suite job failed");
      setEstimatorSuiteResult(j);
      setServerMessage(`Estimator Suite 학습 job 등록: ${j.job?.name ?? j.job?.id}. 작업 큐에서 전체 진행률과 학습 로그를 실시간으로 확인하세요.`);
      setTab("jobs");
      await refreshJobs({ switchTab: true, updateReport: false });
      if (j.job?.id) startLiveJob(j.job.id);
    } catch (e: any) {
      setServerMessage(`Estimator suite 실패: ${e?.message ?? e}`);
    } finally {
      setEstimatorSuiteBusy(false);
    }
  }

  async function activateEstimatorSuiteModelWeb(runId: string) {
    setEstimatorSuiteBusy(true);
    try {
      const r = await fetch("/api/estimator-suite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "activate", runId }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Estimator suite activate failed");
      setActiveEstimatorSuite({ runId: j.activeRunId, model: j.model });
      await refreshEstimatorSuiteModels();
      setServerMessage(`활성 Estimator Suite 모델 적용: ${j.activeRunId}`);
      } catch (e: any) {
      setServerMessage(`Estimator suite 활성화 실패: ${e?.message ?? e}`);
    } finally {
      setEstimatorSuiteBusy(false);
    }
  }

  async function clearActiveEstimatorSuiteModelWeb() {
    setEstimatorSuiteBusy(true);
    try {
      const r = await fetch("/api/estimator-suite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "clear-active" }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Estimator suite clear failed");
      setActiveEstimatorSuite(null);
      await refreshEstimatorSuiteModels();
      setServerMessage("활성 Estimator Suite 모델을 해제했습니다. Analytical estimator 기준으로 돌아갑니다.");
    } catch (e: any) {
      setServerMessage(`Estimator suite 해제 실패: ${e?.message ?? e}`);
    } finally {
      setEstimatorSuiteBusy(false);
    }
  }

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
  function applyProjectState(p: any, source = "project") {
    if (p.hardware) {
      setHardware(p.hardware);
      setDataflowModes((Array.isArray(p.dataflowModes) && p.dataflowModes.length ? p.dataflowModes : [p.hardware?.dataflow ?? "WS"]) as Dataflow[]);
    }
    if (Array.isArray(p.shapes)) setShapes(p.shapes);
    if (p.objective) setObjective(p.objective);
    if (p.scaleSim) setScaleSim((cur) => ({ ...cur, ...p.scaleSim }));
    if (p.candidates) {
      if (Array.isArray(p.candidates.tileM)) setTileM(p.candidates.tileM.join(", "));
      if (Array.isArray(p.candidates.tileN)) setTileN(p.candidates.tileN.join(", "));
      if (Array.isArray(p.candidates.tileK)) setTileK(p.candidates.tileK.join(", "));
    }
    setServerMessage(`${source} 설정을 불러왔습니다.`);
  }

  async function loadProject(file?: File) {
    try {
      if (file) {
        applyProjectState(JSON.parse(await file.text()), file.name);
        return;
      }
      const r = await fetch("/api/project");
      if (!r.ok) return setServerMessage("저장된 프로젝트가 없습니다.");
      applyProjectState(await r.json(), ".tileforge/project.json");
    } catch (error: any) {
      setServerMessage(`프로젝트 불러오기 실패: ${error?.message ?? error}`);
    }
  }
  async function createJob(kind = "full-pipeline", allSelectedDataflows = true) {
    const modes = allSelectedDataflows ? (dataflowModes.length ? dataflowModes : [hardware.dataflow]) : [hardware.dataflow];
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
    await refreshJobs({ switchTab: true, updateReport: true });
    if (created[0]?.id && autoAttachNewJob) startLiveJob(created[0].id);
  }
  async function fetchJobReport(id: string, options: { manual?: boolean } = {}) {
    if (!id) return;
    try {
      const r = await fetch(`/api/jobs/${id}/artifacts/report.md`, {
        cache: "no-store",
      });
      if (!r.ok) return;
      const text = await r.text();
      if (text.trim()) {
        setServerReportMarkdown(text);
        setServerReportJobId(id);
        setAnalysisJobId(id);
        try {
          const cr = await fetch(`/api/jobs/${id}/artifacts/confidence.md`, {
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
    options: { switchTab?: boolean; updateReport?: boolean } = {},
  ) {
    const { switchTab = true, updateReport = false } = options;
    const params = jobsViewMode === "dashboard"
      ? `limit=${jobsPageSize}&dashboard=1&external=0&t=${Date.now()}`
      : `limit=${jobsPageSize}&page=${jobsPage}&external=0&t=${Date.now()}`;
    let payload: any;
    try {
      const r = await fetch(`/api/jobs?${params}`, { cache: "no-store" });
      if (!r.ok) throw new Error(`jobs api ${r.status}`);
      payload = await r.json();
    } catch (error: any) {
      setJobsJson(JSON.stringify({ ok: false, error: error?.message ?? String(error), previous: jobsPayload?.counts ?? null }, null, 2));
      return;
    }
    setJobsPayload(payload);
    setJobsJson(JSON.stringify(payload, null, 2));
    if (updateReport && reportAutoFollow) {
      const activeCount = Number(payload?.counts?.running ?? 0) + Number(payload?.counts?.queued ?? 0);
      const id = latestCompletedJobId(payload);
      // Avoid polling report.md forever while the system is idle. During active
      // runs, auto-follow the newest completed report unless the user manually
      // selected a specific report.
      if (activeCount > 0 && id && id !== serverReportJobId) void fetchJobReport(id);
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
    let ok = 0;
    for (const id of unique) {
      const r = await fetch(`/api/jobs/${id}`, { method: "DELETE" });
      if (r.ok) ok += 1;
    }
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
    const r = await fetch("/api/doctor");
    const j = await r.json();
    setServerMessage(
      `진단 ${j.ok ? "정상" : "확인 필요"}: ${j.checks.map((c: any) => `${c.name}=${c.ok ? "정상" : "경고"}`).join(", ")}`,
    );
  }
  async function refreshStatus(switchTab = true) {
    try {
      const r = await fetch("/api/system/status", { cache: "no-store" });
      if (!r.ok) throw new Error(`status api ${r.status}`);
      const payload = await r.json();
      setStatusPayload(payload);
      setStatusJson(JSON.stringify(payload, null, 2));
      if (switchTab) setTab("status");
    } catch (error: any) {
      setStatusJson(JSON.stringify({ ok: false, error: error?.message ?? String(error), previous: statusPayload?.summary ?? null }, null, 2));
    }
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
  function watchJob(id?: string) {
    const target = id || prompt("실시간으로 볼 작업 ID를 입력하세요.");
    if (!target) return;
    startLiveJob(target);
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

  return (
    <main>
      <header className="topbar">
        <div>
          <h1 title="TPU 계열 systolic-array 설계를 빠르게 탐색하는 도구입니다.">
            TileForge
          </h1>
          <p
            className="lead"
            title="설정을 바꾸면 즉시 미리보기 예측이 갱신되고, 필요할 때 SCALE-Sim/IREE 검증 작업을 실행합니다."
          >
            하드웨어 설계값과 GEMM workload를 바꿔 보며 cycle, stall, memory 병목, sweet spot을 확인합니다.
          </p>
        </div>
        <div className="topbar-actions">
          <Link className="button-like secondary" href="/estimator-suite" title="Estimator Suite 학습/평가 전용 페이지로 이동합니다.">Estimator Suite</Link>
          <Link
            className="button-like secondary"
            href="/help"
            title="예제별 사용 방법과 각 입력 항목의 의미를 자세히 설명한 도움말 페이지로 이동합니다."
          >
            도움말
          </Link>
        </div>
      </header>
      <div className="grid">
        <InputSettingsPanel
          inputTab={inputTab}
          setInputTab={setInputTab}
          inputTabTips={inputTabTips}
          inputTabLabels={inputTabLabels}
          effectiveHardwarePresets={effectiveHardwarePresets}
          applyHardwarePreset={applyHardwarePreset}
          effectiveWorkloadPresets={effectiveWorkloadPresets}
          applyWorkloadPreset={applyWorkloadPreset}
          customPresetName={customPresetName}
          setCustomPresetName={setCustomPresetName}
          saveCustomPreset={saveCustomPreset}
          customPresets={customPresets}
          applyCustomPreset={applyCustomPreset}
          deleteCustomPreset={deleteCustomPreset}
          hardwarePresetName={hardwarePresetName}
          setHardwarePresetName={setHardwarePresetName}
          saveHardwarePreset={saveHardwarePreset}
          userHardwarePresets={userHardwarePresets}
          deleteHardwarePreset={deleteHardwarePreset}
          workloadPresetName={workloadPresetName}
          setWorkloadPresetName={setWorkloadPresetName}
          saveWorkloadPreset={saveWorkloadPreset}
          userWorkloadPresets={userWorkloadPresets}
          deleteWorkloadPreset={deleteWorkloadPreset}
          hardware={hardware}
          updateHw={updateHw}
          dataflowModes={dataflowModes}
          toggleDataflowMode={toggleDataflowMode}
          objective={objective}
          setObjective={setObjective}
          tileM={tileM}
          setTileM={setTileM}
          tileN={tileN}
          setTileN={setTileN}
          tileK={tileK}
          setTileK={setTileK}
          scaleSim={scaleSim}
          updateScaleSim={updateScaleSim}
          csvText={csvText}
          setCsvText={setCsvText}
          importCsv={importCsv}
          manualShape={manualShape}
          setManualShape={setManualShape}
          addManualShape={addManualShape}
          shapes={shapes}
          setShapes={setShapes}
          importOnnxFile={importOnnxFile}
          conv={conv}
          setConv={setConv}
          addConv={addConv}
          generateEstimatorSuiteDesign={generateEstimatorSuiteDesign}
          collectEstimatorSamplesFromJobsWeb={collectEstimatorSamplesFromJobsWeb}
          runEstimatorSuiteWeb={runEstimatorSuiteWeb}
          importEstimatorDatasetWeb={importEstimatorDatasetWeb}
          liveJobId={liveJobId}
          createJob={createJob}
          saveProject={saveProject}
          loadProject={loadProject}
          refreshJobs={refreshJobs}
          refreshStatus={refreshStatus}
          runDoctorCheck={runDoctorCheck}
          cancelJob={cancelJob}
          deleteJobPrompt={deleteJobPrompt}
          watchJob={watchJob}
          envValues={envValues}
          setEnvValues={setEnvValues}
          envKeys={envSettingKeys}
          refreshEnvSettings={refreshEnvSettings}
          saveEnvSettings={saveEnvSettings}
          envMessage={envMessage}
          serverMessage={serverMessage}
        />

        <ResultsPanel
          tab={tab}
          tabTips={tabTips}
          tabLabels={tabLabels}
          setTab={setTab}
          result={result}
          uncertainty={uncertainty}
          confidence={displayConfidence}
          confidenceSource={selectedJobConfidence && selectedJobConfidenceId === analysisJobId ? "selected-job" : "preview"}
          arraySweep={arraySweep}
          download={download}
          analysisJobId={analysisJobId}
          setAnalysisJobId={setAnalysisJobId}
          jobsPayload={jobsPayload}
          jobsViewMode={jobsViewMode}
          setJobsViewMode={setJobsViewMode}
          jobsPage={jobsPage}
          setJobsPage={setJobsPage}
          jobsPageSize={jobsPageSize}
          setJobsPageSize={(n: number) => { setJobsPageSize(n); setJobsPage(1); }}
          serverReportMarkdown={serverReportMarkdown}
          serverReportJobId={serverReportJobId}
          fetchJobReport={(id: string) => fetchJobReport(id, { manual: true })}
          deleteJobById={deleteJobById}
          estimatorSuiteCsv={estimatorSuiteCsv}
          estimatorPresets={effectiveEstimatorPresets}
          selectedEstimatorPreset={selectedEstimatorPreset}
          setSelectedEstimatorPreset={setSelectedEstimatorPreset}
          onApplyEstimatorPreset={applyEstimatorPreset}
          estimatorPresetName={estimatorPresetName}
          setEstimatorPresetName={setEstimatorPresetName}
          saveEstimatorPreset={saveEstimatorPreset}
          deleteEstimatorPreset={deleteEstimatorPreset}
          setEstimatorSuiteCsv={setEstimatorSuiteCsv}
          estimatorSuiteOptions={estimatorSuiteOptions}
          updateEstimatorSuiteOptions={updateEstimatorSuiteOptions}
          estimatorPlanOptions={estimatorPlanOptions}
          updateEstimatorPlanOptions={updateEstimatorPlanOptions}
          estimatorSuiteResult={estimatorSuiteResult}
          estimatorSuiteBusy={estimatorSuiteBusy}
          estimatorSuiteModels={estimatorSuiteModels}
          activeEstimatorSuite={activeEstimatorSuite}
          refreshEstimatorSuiteModels={refreshEstimatorSuiteModels}
          activateEstimatorSuiteModel={activateEstimatorSuiteModelWeb}
          clearActiveEstimatorSuiteModel={clearActiveEstimatorSuiteModelWeb}
          generateEstimatorSuiteDesign={generateEstimatorSuiteDesign}
          generateEstimatorSamplingPlan={generateEstimatorSamplingPlan}
          collectEstimatorSamplesFromJobsWeb={collectEstimatorSamplesFromJobsWeb}
          runEstimatorSuiteWeb={runEstimatorSuiteWeb}
          importEstimatorDatasetWeb={importEstimatorDatasetWeb}
          jobsJson={jobsJson}
          liveJobId={liveJobId}
          liveJob={liveJob}
          liveLogs={liveLogs}
          liveConnected={liveConnected}
          liveAutoScroll={liveAutoScroll}
          setLiveAutoScroll={setLiveAutoScroll}
          stopLiveJob={stopLiveJob}
          autoRefreshEnabled={autoRefreshEnabled}
          setAutoRefreshEnabled={setAutoRefreshEnabled}
          autoAttachNewJob={autoAttachNewJob}
          setAutoAttachNewJob={setAutoAttachNewJob}
          startLiveJob={startLiveJob}
          selectedJobIds={selectedJobIds}
          setSelectedJobIds={setSelectedJobIds}
          deleteJobsByIds={deleteJobsByIds}
          cancelJobsByIds={cancelJobsByIds}
          cancelJobById={cancelJobById}
          statusJson={statusJson}
          statusPayload={statusPayload}
          updateParallelJobs={updateParallelJobs}
        />
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
