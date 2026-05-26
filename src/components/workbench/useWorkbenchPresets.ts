"use client";

import { useMemo, useState } from "react";
import { estimatorPresets as builtInEstimatorPresets, findEstimatorPreset } from "@/lib/estimatorPresets";
import { hardwarePresets, workloadPresets } from "@/lib/presets";
import type { Dataflow, HardwareConfig, MatmulShape, Objective, ScaleSimOverrides } from "@/types/domain";

type UseWorkbenchPresetsArgs = {
  hardware: HardwareConfig;
  setHardware: (value: HardwareConfig) => void;
  dataflowModes: Dataflow[];
  setDataflowModes: (value: Dataflow[] | ((previous: Dataflow[]) => Dataflow[])) => void;
  shapes: MatmulShape[];
  setShapes: (value: MatmulShape[] | ((previous: MatmulShape[]) => MatmulShape[])) => void;
  objective: Objective;
  setObjective: (value: Objective) => void;
  tileM: string;
  setTileM: (value: string) => void;
  tileN: string;
  setTileN: (value: string) => void;
  tileK: string;
  setTileK: (value: string) => void;
  scaleSim: ScaleSimOverrides;
  setScaleSim: (value: ScaleSimOverrides | ((previous: ScaleSimOverrides) => ScaleSimOverrides)) => void;
  estimatorPlanOptions: any;
  setEstimatorPlanOptions: (value: any | ((previous: any) => any)) => void;
  estimatorSuiteOptions: any;
  setEstimatorSuiteOptions: (value: any | ((previous: any) => any)) => void;
  setServerMessage: (message: string) => void;
};

export function useWorkbenchPresets({
  hardware,
  setHardware,
  dataflowModes,
  setDataflowModes,
  shapes,
  setShapes,
  objective,
  setObjective,
  tileM,
  setTileM,
  tileN,
  setTileN,
  tileK,
  setTileK,
  scaleSim,
  setScaleSim,
  estimatorPlanOptions,
  setEstimatorPlanOptions,
  estimatorSuiteOptions,
  setEstimatorSuiteOptions,
  setServerMessage,
}: UseWorkbenchPresetsArgs) {
  const [customPresets, setCustomPresets] = useState<any[]>([]);
  const [userHardwarePresets, setUserHardwarePresets] = useState<any[]>([]);
  const [userWorkloadPresets, setUserWorkloadPresets] = useState<any[]>([]);
  const [userEstimatorPresets, setUserEstimatorPresets] = useState<any[]>([]);
  const [selectedEstimatorPreset, setSelectedEstimatorPreset] = useState("quick-512");
  const [estimatorPresetName, setEstimatorPresetName] = useState("");
  const [customPresetName, setCustomPresetName] = useState("");
  const [hardwarePresetName, setHardwarePresetName] = useState("");
  const [workloadPresetName, setWorkloadPresetName] = useState("");

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

  function applyHardwarePreset(name: string) {
    const p = effectiveHardwarePresets.find((preset) => preset.name === name);
    if (p) {
      setHardware(p);
      setDataflowModes([p.dataflow]);
    }
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
    const p = customPresets.find((preset) => preset.name === name);
    if (!p) return;
    if (p.hardware) {
      setHardware(p.hardware);
      setDataflowModes((Array.isArray(p.dataflowModes) && p.dataflowModes.length ? p.dataflowModes : [p.hardware.dataflow ?? "WS"]) as Dataflow[]);
    }
    if (p.shapes) setShapes(p.shapes);
    if (p.objective) setObjective(p.objective);
    if (p.tileM) setTileM(p.tileM);
    if (p.tileN) setTileN(p.tileN);
    if (p.tileK) setTileK(p.tileK);
    if (p.scaleSim) setScaleSim((cur: ScaleSimOverrides) => ({ ...cur, ...p.scaleSim }));
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

  function applyEstimatorPreset(id = selectedEstimatorPreset) {
    const preset = effectiveEstimatorPresets.find((p: any) => p.id === id || p.name === id) ?? findEstimatorPreset(id);
    if (!preset) {
      setServerMessage(`Estimator 프리셋을 찾지 못했습니다: ${id}`);
      return;
    }
    setSelectedEstimatorPreset(id);
    setEstimatorPlanOptions((cur: any) => ({ ...cur, ...preset.planOptions }));
    setEstimatorSuiteOptions((cur: any) => ({ ...cur, ...preset.trainOptions }));
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

  return {
    customPresets,
    userHardwarePresets,
    userWorkloadPresets,
    effectiveHardwarePresets,
    effectiveWorkloadPresets,
    effectiveEstimatorPresets,
    selectedEstimatorPreset,
    setSelectedEstimatorPreset,
    estimatorPresetName,
    setEstimatorPresetName,
    customPresetName,
    setCustomPresetName,
    hardwarePresetName,
    setHardwarePresetName,
    workloadPresetName,
    setWorkloadPresetName,
    refreshPresets,
    applyHardwarePreset,
    applyWorkloadPreset,
    saveCustomPreset,
    applyCustomPreset,
    deleteCustomPreset,
    saveHardwarePreset,
    deleteHardwarePreset,
    saveWorkloadPreset,
    deleteWorkloadPreset,
    applyEstimatorPreset,
    saveEstimatorPreset,
    deleteEstimatorPreset,
  };
}
