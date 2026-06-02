"use client";

import { apiFetch } from "@/lib/apiClient";
import { useEffect, useState } from "react";
import { defaultCandidates, defaultHardware } from "@/lib/defaults";
import type { EstimatorSuiteModel } from "@/lib/estimatorSuite";
import type { SearchRequest } from "@/types/domain";

type UseEstimatorSuiteWorkbenchArgs = {
  request: SearchRequest;
  autoAttachNewJob: boolean;
  refreshJobs: (options?: { switchTab?: boolean; updateReport?: boolean }) => Promise<void>;
  startLiveJob: (id: string) => void;
  openTab: (tab: "jobs" | "status" | "report" | "graphs" | "policy" | any) => void;
  setServerMessage: (message: string | ((previous: string) => string)) => void;
};

const DEFAULT_SUITE_CSV =
  "id,model,opName,arrayRows,arrayCols,sramKB,frequencyMHz,dataflow,dtypeBytes,m,n,k,tileM,tileN,tileK,estimatorCycles,measuredCycles\n" +
  "s0,demo,qkv,128,128,4096,700,WS,2,384,768,768,128,128,64,1000000,1120000";

export const defaultEstimatorSuiteOptions = {
  topK: 3,
  trees: 160,
  maxDepth: 10,
  minLeaf: 4,
  hiddenUnits: 64,
  epochs: 900,
  maxFinalTrainSamples: 20000,
  splits: "random,workload,array,dataflow,large-shape",
};

export const defaultEstimatorPlanOptions = {
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
};

export function useEstimatorSuiteWorkbench({
  request,
  autoAttachNewJob,
  refreshJobs,
  startLiveJob,
  openTab,
  setServerMessage,
}: UseEstimatorSuiteWorkbenchArgs) {
  const [estimatorSuiteCsv, setEstimatorSuiteCsv] = useState(DEFAULT_SUITE_CSV);
  const [estimatorSuiteOptions, setEstimatorSuiteOptions] = useState(defaultEstimatorSuiteOptions);
  const [estimatorPlanOptions, setEstimatorPlanOptions] = useState(defaultEstimatorPlanOptions);
  const [estimatorSuiteResult, setEstimatorSuiteResult] = useState<any | null>(null);
  const [estimatorSuiteBusy, setEstimatorSuiteBusy] = useState(false);
  const [estimatorSuiteModels, setEstimatorSuiteModels] = useState<any[]>([]);
  const [activeEstimatorSuite, setActiveEstimatorSuite] = useState<{ runId?: string; model?: EstimatorSuiteModel } | null>(null);

  function updateEstimatorSuiteOptions(patch: Partial<typeof estimatorSuiteOptions>) {
    setEstimatorSuiteOptions((cur) => ({ ...cur, ...patch }));
  }

  function updateEstimatorPlanOptions(patch: Partial<typeof estimatorPlanOptions>) {
    setEstimatorPlanOptions((cur) => ({ ...cur, ...patch }));
  }

  async function refreshEstimatorSuiteModels() {
    try {
      const r = await apiFetch("/api/estimator-suite", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Estimator suite model 목록을 불러오지 못했습니다.");
      const models = Array.isArray(j.models) ? j.models : [];
      setEstimatorSuiteModels(models);
      if (j.activeRunId && j.activeModel) {
        const active = models.find((m: any) => m.runId === j.activeRunId);
        setActiveEstimatorSuite({ runId: j.activeRunId, model: j.activeModel });
        if (active) setServerMessage((prev: string) => prev || `활성 Estimator Suite 모델: ${j.activeRunId}`);
      } else {
        setActiveEstimatorSuite(null);
      }
    } catch (error: any) {
      setServerMessage(error?.message ?? String(error));
    }
  }

  useEffect(() => {
    void refreshEstimatorSuiteModels();
  }, []);

  async function runBusy(label: string, task: () => Promise<void>) {
    setEstimatorSuiteBusy(true);
    try {
      await task();
    } catch (e: any) {
      setServerMessage(`${label} 실패: ${e?.message ?? e}`);
    } finally {
      setEstimatorSuiteBusy(false);
    }
  }

  async function generateEstimatorSuiteDesign() {
    await runBusy("Estimator suite 설계", async () => {
      const r = await apiFetch("/api/estimator-suite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "design", request, options: { topK: estimatorSuiteOptions.topK } }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Estimator suite design failed");
      setEstimatorSuiteCsv(j.designCsv);
      setEstimatorSuiteResult(j);
      setServerMessage(`Estimator suite 설계 CSV 생성: ${j.rows?.toLocaleString?.() ?? j.rows}개 후보`);
    });
  }

  async function generateEstimatorSamplingPlan(enqueue = false) {
    await runBusy("Estimator 표본 계획", async () => {
      const r = await apiFetch("/api/estimator-suite", {
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
      if (enqueue) openTab("jobs");
      if (enqueue) await refreshJobs({ switchTab: true, updateReport: false });
      if (enqueue && j.queuedJobs?.[0]?.id && autoAttachNewJob) startLiveJob(j.queuedJobs[0].id);
    });
  }

  async function collectEstimatorSamplesFromJobsWeb() {
    await runBusy("Estimator sample 수집", async () => {
      const r = await apiFetch("/api/estimator-suite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "collect-jobs", csvText: estimatorSuiteCsv }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Estimator sample collection failed");
      setEstimatorSuiteCsv(j.csv ?? "");
      setEstimatorSuiteResult(j);
      setServerMessage(`완료 작업에서 estimator 학습 sample ${j.validSamples ?? 0}개 준비됨: 새로 수집 ${j.rows ?? 0}개`);
    });
  }

  async function importEstimatorDatasetWeb(files: Array<{ name: string; text: string }>, train: boolean) {
    await runBusy("Estimator dataset 처리", async () => {
      const r = await apiFetch("/api/estimator-suite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: train ? "dataset-job" : "dataset", request, files, options: estimatorSuiteOptions, train, activate: true }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Estimator dataset import failed");
      if (train && j.job?.id) {
        setEstimatorSuiteResult(j);
        setServerMessage(`Estimator dataset 학습 job 등록: ${j.job.name ?? j.job.id}. 작업 큐에서 진행률과 학습 로그를 확인하세요.`);
        openTab("jobs");
        await refreshJobs({ switchTab: true, updateReport: false });
        startLiveJob(j.job.id);
      } else {
        setEstimatorSuiteCsv(j.csv ?? "");
        setEstimatorSuiteResult(j);
        const valid = j.summary?.validSamples ?? 0;
        setServerMessage(`Estimator dataset 병합 완료: 유효 sample ${valid.toLocaleString?.() ?? valid}개`);
      }
    });
  }

  async function runEstimatorSuiteWeb() {
    await runBusy("Estimator suite", async () => {
      const r = await apiFetch("/api/estimator-suite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "suite-job", request, csvText: estimatorSuiteCsv, options: estimatorSuiteOptions, activate: true }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Estimator suite job failed");
      setEstimatorSuiteResult(j);
      setServerMessage(`Estimator Suite 학습 job 등록: ${j.job?.name ?? j.job?.id}. 작업 큐에서 전체 진행률과 학습 로그를 실시간으로 확인하세요.`);
      openTab("jobs");
      await refreshJobs({ switchTab: true, updateReport: false });
      if (j.job?.id) startLiveJob(j.job.id);
    });
  }

  async function activateEstimatorSuiteModelWeb(runId: string) {
    await runBusy("Estimator suite 활성화", async () => {
      const r = await apiFetch("/api/estimator-suite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "activate", runId }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Estimator suite activate failed");
      setActiveEstimatorSuite({ runId: j.activeRunId, model: j.model });
      await refreshEstimatorSuiteModels();
      setServerMessage(`활성 Estimator Suite 모델 적용: ${j.activeRunId}`);
    });
  }

  async function clearActiveEstimatorSuiteModelWeb() {
    await runBusy("Estimator suite 해제", async () => {
      const r = await apiFetch("/api/estimator-suite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "clear-active" }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || "Estimator suite clear failed");
      setActiveEstimatorSuite(null);
      await refreshEstimatorSuiteModels();
      setServerMessage("활성 Estimator Suite 모델을 해제했습니다. Analytical estimator 기준으로 돌아갑니다.");
    });
  }

  return {
    estimatorSuiteCsv,
    setEstimatorSuiteCsv,
    estimatorSuiteOptions,
    setEstimatorSuiteOptions,
    updateEstimatorSuiteOptions,
    estimatorPlanOptions,
    setEstimatorPlanOptions,
    updateEstimatorPlanOptions,
    estimatorSuiteResult,
    estimatorSuiteBusy,
    estimatorSuiteModels,
    activeEstimatorSuite,
    setActiveEstimatorSuite,
    refreshEstimatorSuiteModels,
    generateEstimatorSuiteDesign,
    generateEstimatorSamplingPlan,
    collectEstimatorSamplesFromJobsWeb,
    importEstimatorDatasetWeb,
    runEstimatorSuiteWeb,
    activateEstimatorSuiteModelWeb,
    clearActiveEstimatorSuiteModelWeb,
  };
}
