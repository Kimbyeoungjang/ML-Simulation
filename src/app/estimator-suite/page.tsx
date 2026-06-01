"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { defaultCandidates, defaultHardware, defaultShapes } from "@/lib/defaults";
import { estimatorPresets as builtInEstimatorPresets, findEstimatorPreset } from "@/lib/estimatorPresets";
import type { EstimatorSuiteModel } from "@/lib/estimatorSuite";
import { EstimatorSuitePanel } from "@/components/workbench/EstimatorSuitePanel";
import type { SearchRequest } from "@/types/domain";

const defaultRequest: SearchRequest = {
  hardware: defaultHardware,
  shapes: defaultShapes,
  candidates: defaultCandidates,
  objective: "balanced",
  scaleSim: {},
};

export default function EstimatorSuitePage() {
  const [csv, setCsv] = useState("");
  const [options, setOptions] = useState({
    splits: 5,
    holdoutRatio: 0.2,
    seed: 7,
    topK: 3,
    learningRate: 0.04,
    epochs: 220,
    hiddenUnits: 18,
    treeDepth: 4,
    minLeafSize: 6,
    directWeight: 0.35,
  });
  const [planOptions, setPlanOptions] = useState({
    mRange: "128,160,197,224,256,384,512,1024",
    nRange: "64,128,197,384,768,1024,1536,2304,3072,4096",
    kRange: "64,128,384,768,1024,1536,3072,4096",
    tileMRange: defaultCandidates.tileM.join(","),
    tileNRange: defaultCandidates.tileN.join(","),
    tileKRange: defaultCandidates.tileK.join(","),
    arrayRange: "64x64,128x128,128x256,256x128,256x256",
    sramKbRange: "2048,4096,8192,16384",
    dataflows: "WS,OS,IS",
    maxSamples: 512,
    queueLimit: 512,
    topKPerShape: 1,
    includeCurrentShapes: true,
    shapeBank: "transformer",
  });
  const [result, setResult] = useState<any | null>(null);
  const [busy, setBusy] = useState(false);
  const [models, setModels] = useState<any[]>([]);
  const [active, setActive] = useState<{ runId: string; model: EstimatorSuiteModel } | null>(null);
  const [presets, setPresets] = useState<any[]>(builtInEstimatorPresets);
  const [selectedPreset, setSelectedPreset] = useState("quick-512");
  const [presetName, setPresetName] = useState("");

  const effectivePresets = useMemo(() => presets.length ? presets : builtInEstimatorPresets, [presets]);
  const download = (name: string, text: string, type = "text/plain") => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  async function post(action: string, extra: Record<string, any> = {}) {
    setBusy(true);
    try {
      const r = await fetch("/api/estimator-suite", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, request: defaultRequest, csvText: csv, options, ...extra }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `${action} failed`);
      setResult(j);
      if (j.designCsv || j.planCsv || j.csv) setCsv(j.designCsv ?? j.planCsv ?? j.csv ?? csv);
      if (j.activeRunId && j.model) setActive({ runId: j.activeRunId, model: j.model });
      await refreshModels();
    } catch (error: any) {
      setResult({ ok: false, error: error?.message ?? String(error) });
    } finally {
      setBusy(false);
    }
  }

  async function refreshModels() {
    const r = await fetch("/api/estimator-suite");
    const j = await r.json();
    if (!j.ok) return;
    setModels(j.models ?? []);
    setActive(j.activeRunId && j.activeModel ? { runId: j.activeRunId, model: j.activeModel } : null);
  }

  async function refreshPresets() {
    const r = await fetch("/api/presets?kind=estimator");
    const j = await r.json();
    if (j.ok) setPresets(j.presets ?? builtInEstimatorPresets);
  }

  function applyPreset(id = selectedPreset) {
    const preset = effectivePresets.find((p: any) => p.id === id || p.name === id) ?? findEstimatorPreset(id);
    if (!preset) return;
    setSelectedPreset(id);
    setPlanOptions((cur) => ({ ...cur, ...preset.planOptions }));
    setOptions((cur) => ({ ...cur, ...preset.trainOptions }));
    setResult({ ok: true, message: `${preset.name} 프리셋을 적용했습니다.` });
  }

  async function savePreset() {
    const name = presetName.trim();
    if (!name) return setResult({ ok: false, error: "저장할 프리셋 이름을 입력하세요." });
    const r = await fetch("/api/presets", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ kind: "estimator", name, description: "사용자 Estimator 프리셋", planOptions, trainOptions: options }),
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || !j.ok) return setResult({ ok: false, error: j.error || "프리셋 저장 실패" });
    await refreshPresets();
    setSelectedPreset(`user-${name}`);
    setResult({ ok: true, message: `${name} 프리셋을 저장했습니다.` });
  }

  async function deletePreset(idOrName: string) {
    const preset = effectivePresets.find((p: any) => p.id === idOrName || p.name === idOrName);
    if (!preset || preset.source === "builtin") return;
    const r = await fetch(`/api/presets?kind=estimator&name=${encodeURIComponent(preset.name)}`, { method: "DELETE" });
    if (r.ok) await refreshPresets();
  }

  async function activateModel(runId: string) { await post("activate", { runId }); }
  async function clearActive() { await post("clear-active"); }
  async function importDataset(files: Array<{ name: string; text: string }>, train: boolean) {
    await post(train ? "dataset-job" : "dataset", { files, train, activate: true });
  }

  useEffect(() => { void refreshModels(); void refreshPresets(); }, []);

  return (
    <main className="estimator-page">
      <div className="topbar estimator-topbar">
        <div><span>Estimator Suite</span><small>학습 데이터 생성, 모델 학습, 검증 보고서</small></div>
        <Link className="button-like secondary" href="/">Workbench로 돌아가기</Link>
      </div>
      <EstimatorSuitePanel
        csv={csv}
        presets={effectivePresets}
        selectedPresetId={selectedPreset}
        setSelectedPresetId={setSelectedPreset}
        onApplyPreset={applyPreset}
        presetName={presetName}
        setPresetName={setPresetName}
        onSavePreset={savePreset}
        onDeletePreset={deletePreset}
        setCsv={setCsv}
        options={options}
        updateOptions={(patch: Partial<typeof options>) => setOptions((cur) => ({ ...cur, ...patch }))}
        planOptions={planOptions}
        updatePlanOptions={(patch: Partial<typeof planOptions>) => setPlanOptions((cur) => ({ ...cur, ...patch }))}
        result={result}
        busy={busy}
        models={models}
        active={active}
        onRefreshModels={refreshModels}
        onActivateModel={activateModel}
        onClearActiveModel={clearActive}
        onDesign={() => post("design", { options: { topK: options.topK } })}
        onPlan={() => post("plan", { options: planOptions, maxSamples: planOptions.maxSamples, queueLimit: planOptions.queueLimit })}
        onQueuePlan={() => post("plan-and-queue", { options: planOptions, maxSamples: planOptions.maxSamples, queueLimit: planOptions.queueLimit })}
        onCollectJobs={() => post("collect-jobs")}
        onRun={() => post("suite-job", { activate: true })}
        onImportDataset={importDataset}
        download={download}
      />
    </main>
  );
}
