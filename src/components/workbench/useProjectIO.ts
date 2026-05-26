"use client";

import type { Dataflow, HardwareConfig, MatmulShape, Objective, ScaleSimOverrides } from "@/types/domain";

type UseProjectIOArgs = {
  projectJson: string;
  setHardware: (value: HardwareConfig) => void;
  setDataflowModes: (value: Dataflow[] | ((previous: Dataflow[]) => Dataflow[])) => void;
  setShapes: (value: MatmulShape[] | ((previous: MatmulShape[]) => MatmulShape[])) => void;
  setObjective: (value: Objective) => void;
  setScaleSim: (value: ScaleSimOverrides | ((previous: ScaleSimOverrides) => ScaleSimOverrides)) => void;
  setTileM: (value: string) => void;
  setTileN: (value: string) => void;
  setTileK: (value: string) => void;
  setServerMessage: (message: string) => void;
};

export function useProjectIO({
  projectJson,
  setHardware,
  setDataflowModes,
  setShapes,
  setObjective,
  setScaleSim,
  setTileM,
  setTileN,
  setTileK,
  setServerMessage,
}: UseProjectIOArgs) {
  function applyProjectState(p: any, source = "project") {
    if (p.hardware) {
      setHardware(p.hardware);
      setDataflowModes((Array.isArray(p.dataflowModes) && p.dataflowModes.length ? p.dataflowModes : [p.hardware?.dataflow ?? "WS"]) as Dataflow[]);
    }
    if (Array.isArray(p.shapes)) setShapes(p.shapes);
    if (p.objective) setObjective(p.objective);
    if (p.scaleSim) setScaleSim((cur: ScaleSimOverrides) => ({ ...cur, ...p.scaleSim }));
    if (p.candidates) {
      if (Array.isArray(p.candidates.tileM)) setTileM(p.candidates.tileM.join(", "));
      if (Array.isArray(p.candidates.tileN)) setTileN(p.candidates.tileN.join(", "));
      if (Array.isArray(p.candidates.tileK)) setTileK(p.candidates.tileK.join(", "));
    }
    setServerMessage(`${source} 설정을 불러왔습니다.`);
  }

  async function saveProject() {
    const r = await fetch("/api/project", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: projectJson,
    });
    setServerMessage(`프로젝트 저장 완료: ${(await r.json()).path}`);
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

  return { saveProject, loadProject, applyProjectState };
}
