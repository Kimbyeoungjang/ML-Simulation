"use client";

import { useMemo, useState } from "react";
import { conv2dToGemm } from "@/lib/conv";
import { parseShapesCsv } from "@/lib/csv";
import { defaultCandidates, defaultHardware, defaultShapes } from "@/lib/defaults";
import { parseNumList } from "@/lib/math";
import type { Conv2DShape, Dataflow, HardwareConfig, MatmulShape, Objective, SearchRequest, ScaleSimOverrides } from "@/types/domain";
import type { InputTab } from "@/components/workbench/workbenchTabs";

export type WorkbenchInputs = ReturnType<typeof useWorkbenchInputs>;

export function makeSearchRequest({
  hardware,
  dataflowModes,
  shapes,
  candidates,
  objective,
  scaleSim,
}: {
  hardware: HardwareConfig;
  dataflowModes: Dataflow[];
  shapes: MatmulShape[];
  candidates: { tileM: number[]; tileN: number[]; tileK: number[] };
  objective: Objective;
  scaleSim: ScaleSimOverrides;
}): SearchRequest {
  return {
    hardware: { ...hardware, dataflow: dataflowModes[0] ?? hardware.dataflow },
    shapes,
    candidates,
    objective,
    maxResultsPerOp: 24,
    scaleSim,
  };
}

export function normalizeDataflowModes(prev: Dataflow[], mode: Dataflow): Dataflow[] {
  const next = prev.includes(mode) ? prev.filter((x) => x !== mode) : [...prev, mode];
  return next.length ? next : [mode];
}

export function useWorkbenchInputs({ setServerMessage }: { setServerMessage: (message: string) => void }) {
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
  const [csvText, setCsvText] = useState("id,model,op_name,m,n,k,dtype_bytes\nbert_q,bert,query,384,768,768,2");
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
    () => ({ tileM: parseNumList(tileM), tileN: parseNumList(tileN), tileK: parseNumList(tileK) }),
    [tileM, tileN, tileK],
  );
  const request = useMemo(
    () => makeSearchRequest({ hardware, dataflowModes, shapes, candidates, objective, scaleSim }),
    [hardware, dataflowModes, shapes, candidates, objective, scaleSim],
  );
  const requestKey = useMemo(() => JSON.stringify(request), [request]);

  const updateHw = (patch: Partial<HardwareConfig>) => setHardware((h) => ({ ...h, ...patch }));
  const updateScaleSim = (patch: Partial<ScaleSimOverrides>) => setScaleSim((s) => ({ ...s, ...patch }));

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
    if (!r.ok) {
      setServerMessage(j.error || "ONNX 불러오기에 실패했습니다.");
      return;
    }
    setShapes(j.shapes);
    setServerMessage(`ONNX에서 GEMM shape ${j.shapes.length}개를 불러왔습니다. ${j.warnings?.length ? "경고: " + j.warnings.join(" | ") : ""}`);
  }

  function toggleDataflowMode(mode: Dataflow) {
    setDataflowModes((prev) => {
      const normalized = normalizeDataflowModes(prev, mode);
      setHardware((h) => ({ ...h, dataflow: normalized[0] }));
      return normalized;
    });
  }

  function addManualShape() {
    const id = manualShape.id.trim() || `${manualShape.model}_${manualShape.opName}_${Date.now()}`;
    setShapes((prev) => [...prev, { ...manualShape, id, source: "manual" }]);
    setServerMessage(`수동 GEMM shape 추가: ${manualShape.model}.${manualShape.opName}`);
  }

  return {
    hardware,
    setHardware,
    dataflowModes,
    setDataflowModes,
    inputTab,
    setInputTab,
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
    csvText,
    setCsvText,
    manualShape,
    setManualShape,
    conv,
    setConv,
    candidates,
    request,
    requestKey,
    updateHw,
    updateScaleSim,
    importCsv,
    addConv,
    importOnnxFile,
    toggleDataflowMode,
    addManualShape,
  };
}
