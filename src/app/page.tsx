"use client";

import Link from "next/link";
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
import { applyEstimatorSuiteToSearchResponse } from "@/lib/estimatorSuiteApply";
import type { EstimatorSuiteModel } from "@/lib/estimatorSuite";
import { parseNumList, fmt } from "@/lib/math";
import { hardwarePresets, workloadPresets } from "@/lib/presets";
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
  | "calibration"
  | "iree"
  | "exports"
  | "graphs"
  | "report"
  | "jobs"
  | "estimatorSuite"
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
  estimatorSuite: "Estimator Suite",
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
  hardware: "배열 크기, 주파수, SRAM, 데이터플로우, 에너지/메모리 파라미터를 설정합니다.",
  tiling: "tileM/tileN/tileK 후보와 최적화 목표를 설정합니다.",
  scalesim: "SCALE-Sim의 SRAM/DRAM bandwidth, layout, bank 파라미터를 세부 설정합니다.",
  workload: "CSV, ONNX, JSON에서 GEMM workload shape를 가져옵니다.",
  conv: "Conv2D 파라미터를 im2col GEMM shape로 변환합니다.",
  calibration: "실측 cycle CSV를 사용해 estimator 보정 계수를 적용합니다.",
  tools: "서버 추정, 프로젝트 저장, full-pipeline 실행, 상태 진단을 수행합니다.",
};

const tabTips: Record<Tab, string> = {
  policy: "각 연산별 최적 타일 후보와 예상 사이클, 활용률을 확인합니다.",
  bottleneck: "전체 실행 시간에서 비중이 큰 연산과 병목 원인을 요약합니다.",
  roofline: "연산 집약도 기준으로 compute-bound인지 memory-bound인지 판단합니다.",
  energy: "MAC, SRAM, DRAM 접근 기반의 간단한 에너지 추정을 표시합니다.",
  array: "여러 systolic array 크기를 비교하여 설계 후보를 고릅니다.",
  calibration: "실측값 CSV로 적용한 보정 계수와 보정 보고서를 확인합니다.",
  iree: "생성된 MLIR과 IREE 실행 명령을 확인하고 다운로드합니다.",
  exports: "SCALE-Sim, LaTeX, SVG, manifest 등 산출물을 내려받습니다.",
  graphs: "타일 후보별 cycle/utilization 차이를 그래프로 비교합니다.",
  report: "현재 실험 설정과 결과를 논문/보고서용 Markdown으로 확인합니다.",
  jobs: "백그라운드 작업의 상태, 로그, artifact 정보를 확인합니다.",
  estimatorSuite: "웹에서 estimator suite 설계 CSV 생성, Tree/Neural/Ensemble 학습, 검증 리포트를 실행합니다.",
  status: "로컬 서버, 저장소, 워커, 외부 도구 상태를 JSON으로 확인합니다.",
};

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
  const [selectedJobIds, setSelectedJobIds] = useState<string[]>([]);
  const liveEventSource = useRef<EventSource | null>(null);
  const [calibrationCsv, setCalibrationCsv] = useState(
    "model,op_name,array,dataflow,predicted_cycles,measured_cycles\nvit_s,qkv,128x128,WS,1000000,1120000",
  );
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
  const [activeEstimatorSuite, setActiveEstimatorSuite] = useState<{ runId?: string; model?: EstimatorSuiteModel } | null>(null);
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
  const result = useMemo(() => applyEstimatorSuiteToSearchResponse(estimateAll(request), activeEstimatorSuite?.model), [JSON.stringify(request), activeEstimatorSuite?.runId]);
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
    void refreshPresets();
    void refreshEstimatorSuiteModels();
  }, []);

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
    setServerReportMarkdown("");
    setServerReportJobId("");
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
      setTab("estimatorSuite");
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
      setTab(enqueue ? "jobs" : "estimatorSuite");
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
      setTab("estimatorSuite");
    } catch (e: any) {
      setServerMessage(`Estimator sample 수집 실패: ${e?.message ?? e}`);
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
        body: JSON.stringify({ action: "suite", csvText: estimatorSuiteCsv, options: estimatorSuiteOptions }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Estimator suite failed");
      setEstimatorSuiteResult(j);
      setActiveEstimatorSuite({ runId: j.runId, model: j.model });
      await refreshEstimatorSuiteModels();
      setServerMessage(`Estimator suite 완료: ${j.model?.metadata?.samples?.toLocaleString?.() ?? j.model?.metadata?.samples} samples, 추천=${j.model?.recommended}. 이 브라우저 미리보기에도 즉시 적용했습니다.`);
      setTab("estimatorSuite");
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
      setTab("estimatorSuite");
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
    await refreshJobs({ switchTab: true, updateReport: true });
    if (created[0]?.id && autoAttachNewJob) startLiveJob(created[0].id);
  }
  async function fetchJobReport(id: string) {
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
    const r = await fetch("/api/jobs?limit=50", { cache: "no-store" });
    const payload = await r.json();
    setJobsPayload(payload);
    setJobsJson(JSON.stringify(payload, null, 2));
    if (updateReport) {
      const id = latestCompletedJobId(payload);
      if (id && id !== serverReportJobId) void fetchJobReport(id);
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
          calibrationRow={calibrationRow}
          setCalibrationRow={setCalibrationRow}
          appendCalibrationRow={appendCalibrationRow}
          appendCalibrationFromJob={appendCalibrationFromJob}
          calibrationCsv={calibrationCsv}
          setCalibrationCsv={setCalibrationCsv}
          applyCalibrationCsv={applyCalibrationCsv}
          clearCalibration={clearCalibration}
          calibration={calibration}
          generateEstimatorSuiteDesign={generateEstimatorSuiteDesign}
          collectEstimatorSamplesFromJobsWeb={collectEstimatorSamplesFromJobsWeb}
          runEstimatorSuiteWeb={runEstimatorSuiteWeb}
          liveJobId={liveJobId}
          createJob={createJob}
          runServerEstimate={runServerEstimate}
          saveProject={saveProject}
          loadProject={loadProject}
          refreshJobs={refreshJobs}
          refreshStatus={refreshStatus}
          runDoctorCheck={runDoctorCheck}
          cancelJob={cancelJob}
          deleteJobPrompt={deleteJobPrompt}
          watchJob={watchJob}
          serverMessage={serverMessage}
        />

        <ResultsPanel
          tab={tab}
          tabTips={tabTips}
          tabLabels={tabLabels}
          setTab={setTab}
          result={result}
          uncertainty={uncertainty}
          confidence={confidence}
          calibration={calibration}
          arraySweep={arraySweep}
          download={download}
          analysisJobId={analysisJobId}
          setAnalysisJobId={setAnalysisJobId}
          jobsPayload={jobsPayload}
          serverReportMarkdown={serverReportMarkdown}
          serverReportJobId={serverReportJobId}
          fetchJobReport={fetchJobReport}
          deleteJobById={deleteJobById}
          estimatorSuiteCsv={estimatorSuiteCsv}
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
