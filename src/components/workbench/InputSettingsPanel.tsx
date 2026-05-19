import type { ChangeEvent } from "react";
import Link from "next/link";
import type { Dataflow, Objective } from "@/types/domain";
import { defaultShapes } from "@/lib/defaults";
import { ActionButton, FieldLabel, MiniField } from "@/components/workbench/primitives";

type InputTab =
  | "hardware"
  | "tiling"
  | "workload"
  | "run"
  | "tools"
  | "settings";

type InputSettingsPanelProps = Record<string, any>;

const dataflowCopy: Record<Dataflow, { title: string; desc: string }> = {
  WS: { title: "Weight Stationary", desc: "weight/filter 재사용이 큰 GEMM·Conv에 적합합니다." },
  OS: { title: "Output Stationary", desc: "partial sum을 오래 유지해 누산 write-back을 줄입니다." },
  IS: { title: "Input Stationary", desc: "activation 재사용이 큰 경우를 비교할 때 유용합니다." },
};

export function InputSettingsPanel(props: InputSettingsPanelProps) {
  const {
    inputTab,
    setInputTab,
    inputTabTips,
    inputTabLabels,
    effectiveHardwarePresets,
    applyHardwarePreset,
    effectiveWorkloadPresets,
    applyWorkloadPreset,
    customPresetName,
    setCustomPresetName,
    saveCustomPreset,
    customPresets,
    applyCustomPreset,
    deleteCustomPreset,
    hardwarePresetName,
    setHardwarePresetName,
    saveHardwarePreset,
    userHardwarePresets,
    deleteHardwarePreset,
    workloadPresetName,
    setWorkloadPresetName,
    saveWorkloadPreset,
    userWorkloadPresets,
    deleteWorkloadPreset,
    hardware,
    updateHw,
    dataflowModes,
    toggleDataflowMode,
    objective,
    setObjective,
    tileM,
    setTileM,
    tileN,
    setTileN,
    tileK,
    setTileK,
    scaleSim,
    updateScaleSim,
    csvText,
    setCsvText,
    importCsv,
    manualShape,
    setManualShape,
    addManualShape,
    shapes,
    setShapes,
    importOnnxFile,
    conv,
    setConv,
    addConv,
    createJob,
    saveProject,
    loadProject,
    refreshJobs,
    refreshStatus,
    runDoctorCheck,
    liveJobId,
    cancelJob,
    deleteJobPrompt,
    watchJob,
    serverMessage,
    envValues = {},
    setEnvValues,
    envKeys = [],
    refreshEnvSettings,
    saveEnvSettings,
    envMessage,
  } = props;

  const steps = ["hardware", "tiling", "workload", "run"] as InputTab[];
  const utilityTabs = ["tools", "settings"] as InputTab[];
  const updateEnvValue = (key: string, value: string) => {
    setEnvValues?.((cur: Record<string, string>) => ({ ...cur, [key]: value }));
  };

  return (
    <section className="panel setup-panel" title="하드웨어부터 실행까지 필요한 입력을 순서대로 설정합니다.">
      <div className="setup-header">
        <div>
          <h2>실험 설정</h2>
          <p className="small">하드웨어 → 타일링 → 워크로드 → 실행 순서로 맞추면 바로 미리보기 결과가 갱신됩니다.</p>
        </div>
        <div className="setup-summary" aria-label="현재 입력 요약">
          <span>{hardware.arrayRows}×{hardware.arrayCols}</span>
          <span>{dataflowModes.join("/")}</span>
          <span>{shapes.length} ops</span>
        </div>
      </div>

      <div className="setup-progress">
        {steps.map((t, index) => (
          <button
            key={t}
            title={inputTabTips[t]}
            className={inputTab === t ? "setup-step active" : "setup-step secondary"}
            onClick={() => setInputTab(t)}
          >
            <span className="step-no">{String(index + 1).padStart(2, "0")}</span>
            <span>{inputTabLabels[t]}</span>
          </button>
        ))}
      </div>
      <div className="input-tabs utility-tabs">
        {utilityTabs.map((t) => (
          <button key={t} className={inputTab === t ? "active" : "secondary"} onClick={() => setInputTab(t)} title={inputTabTips[t]}>
            {inputTabLabels[t]}
          </button>
        ))}
      </div>

      <div className="input-tab-panel">
        {inputTab === "hardware" && (
          <>
            <h3>하드웨어</h3>
            <p className="small">Systolic array 크기와 메모리 구성을 정합니다. 선택한 값은 즉시 추정 결과에 반영됩니다.</p>
            <div className="quick-preset-row">
              <MiniField label="하드웨어 프리셋" tip="자주 쓰는 array/SRAM 설정을 불러옵니다.">
                <select onChange={(e) => applyHardwarePreset(e.target.value)} defaultValue="">
                  <option value="">현재 설정 유지</option>
                  {effectiveHardwarePresets.map((p: any) => <option key={p.name}>{p.name}</option>)}
                </select>
              </MiniField>
              <MiniField label="이름" tip="보고서와 export에 표시될 하드웨어 이름입니다.">
                <input value={hardware.name} onChange={(e) => updateHw({ name: e.target.value })} />
              </MiniField>
            </div>
            <div className="row">
              <MiniField label="배열 행" tip="systolic array의 row PE 개수입니다.">
                <input type="number" value={hardware.arrayRows} onChange={(e) => updateHw({ arrayRows: +e.target.value })} />
              </MiniField>
              <MiniField label="배열 열" tip="systolic array의 column PE 개수입니다.">
                <input type="number" value={hardware.arrayCols} onChange={(e) => updateHw({ arrayCols: +e.target.value })} />
              </MiniField>
            </div>
            <div className="row">
              <MiniField label="주파수 MHz" tip="사이클을 시간으로 환산할 때 사용합니다.">
                <input type="number" value={hardware.frequencyMHz} onChange={(e) => updateHw({ frequencyMHz: +e.target.value })} />
              </MiniField>
              <MiniField label="SRAM KiB" tip="온칩 SRAM 총량입니다. SRAM sweet spot 분석의 기준이 됩니다.">
                <input type="number" value={hardware.sramKB} onChange={(e) => updateHw({ sramKB: +e.target.value })} />
              </MiniField>
            </div>
            <FieldLabel tip="여러 데이터플로우를 선택하면 같은 workload를 조건별로 비교 실행할 수 있습니다.">데이터플로우</FieldLabel>
            <div className="dataflow-grid clean-dataflow-grid">
              {(["WS", "OS", "IS"] as Dataflow[]).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  className={`dataflow-card-clean ${dataflowModes.includes(mode) ? "selected" : ""}`}
                  onClick={() => toggleDataflowMode(mode)}
                  title={`${mode}: ${dataflowCopy[mode].desc}`}
                >
                  <span className="dataflow-code">{mode}</span>
                  <span className="dataflow-title">{dataflowCopy[mode].title}</span>
                  <span className="dataflow-desc">{dataflowCopy[mode].desc}</span>
                </button>
              ))}
            </div>
            <div className="row">
              <MiniField label="원소당 byte" tip="fp16/bfloat16은 보통 2, fp32는 4, int8은 1입니다.">
                <input type="number" value={hardware.bytesPerElement} onChange={(e) => updateHw({ bytesPerElement: +e.target.value })} />
              </MiniField>
              <MiniField label="메모리 BW GB/s" tip="DRAM roofline과 memory-bound 판단에 사용합니다.">
                <input type="number" value={hardware.memoryBandwidthGBs ?? 100} onChange={(e) => updateHw({ memoryBandwidthGBs: +e.target.value })} />
              </MiniField>
            </div>
            <details className="advanced-box">
              <summary>에너지·SCALE-Sim 세부 설정</summary>
              <div className="row3">
                <MiniField label="pJ/MAC" tip="MAC 1회당 에너지입니다."><input type="number" value={hardware.energyPerMacPJ ?? 1} onChange={(e) => updateHw({ energyPerMacPJ: +e.target.value })} /></MiniField>
                <MiniField label="pJ/SRAM 접근" tip="SRAM 접근당 에너지입니다."><input type="number" value={hardware.energyPerSramAccessPJ ?? 5} onChange={(e) => updateHw({ energyPerSramAccessPJ: +e.target.value })} /></MiniField>
                <MiniField label="pJ/DRAM byte" tip="DRAM byte 접근당 에너지입니다."><input type="number" value={hardware.energyPerDramBytePJ ?? 60} onChange={(e) => updateHw({ energyPerDramBytePJ: +e.target.value })} /></MiniField>
              </div>
              <div className="row3">
                <MiniField label="Ifmap SRAM KiB" tip="SCALE-Sim ifmap SRAM입니다."><input type="number" value={scaleSim.ifmapSramKB ?? Math.floor(hardware.sramKB / 3)} onChange={(e) => updateScaleSim({ ifmapSramKB: +e.target.value })} /></MiniField>
                <MiniField label="Filter SRAM KiB" tip="SCALE-Sim filter SRAM입니다."><input type="number" value={scaleSim.filterSramKB ?? Math.floor(hardware.sramKB / 3)} onChange={(e) => updateScaleSim({ filterSramKB: +e.target.value })} /></MiniField>
                <MiniField label="Ofmap SRAM KiB" tip="SCALE-Sim ofmap SRAM입니다."><input type="number" value={scaleSim.ofmapSramKB ?? Math.floor(hardware.sramKB / 3)} onChange={(e) => updateScaleSim({ ofmapSramKB: +e.target.value })} /></MiniField>
              </div>
              <div className="row">
                <MiniField label="DRAM / Interface Bandwidth" tip="SCALE-Sim cfg bandwidth 값입니다."><input type="number" value={(scaleSim as any).dramBandwidth ?? scaleSim.bandwidth ?? 128} onChange={(e) => updateScaleSim({ bandwidth: +e.target.value, ...({ dramBandwidth: +e.target.value } as any) })} /></MiniField>
                <MiniField label="run_name" tip="SCALE-Sim 결과 디렉터리 이름입니다."><input value={scaleSim.runName ?? "tileforge_generated"} onChange={(e) => updateScaleSim({ runName: e.target.value })} /></MiniField>
              </div>
            </details>
          </>
        )}

        {inputTab === "tiling" && (
          <>
            <h3>타일링</h3>
            <p className="small">후보는 쉼표로 입력합니다. 미리보기는 입력이 바뀔 때마다 자동으로 다시 계산됩니다.</p>
            <div className="row3">
              <MiniField label="tileM" tip="GEMM M축 타일 후보입니다."><input value={tileM} onChange={(e) => setTileM(e.target.value)} /></MiniField>
              <MiniField label="tileN" tip="GEMM N축 타일 후보입니다."><input value={tileN} onChange={(e) => setTileN(e.target.value)} /></MiniField>
              <MiniField label="tileK" tip="GEMM K축 reduction 타일 후보입니다."><input value={tileK} onChange={(e) => setTileK(e.target.value)} /></MiniField>
            </div>
            <FieldLabel tip="최적 타일을 고를 때 우선할 기준입니다.">최적화 목표</FieldLabel>
            <select value={objective} onChange={(e) => setObjective(e.target.value as Objective)}>
              <option value="balanced">균형</option>
              <option value="cycles">사이클 최소</option>
              <option value="utilization">활용률 우선</option>
              <option value="hardware-design">하드웨어 설계</option>
              <option value="pareto">Pareto 후보</option>
            </select>
            <div className="info-box"><b>권장 흐름</b><p className="small">하드웨어 설계에는 full-layer cycle을 기준으로 보고, tile 후보 선택에는 tile-policy score와 후보별 SRAM/DRAM 부담을 함께 확인하세요.</p></div>
          </>
        )}

        {inputTab === "workload" && (
          <>
            <h3>워크로드</h3>
            <p className="small">GEMM shape를 직접 추가하거나 CSV/ONNX/Conv2D에서 가져옵니다. Conv2D 변환은 workload 생성 기능으로 통합했습니다.</p>
            <FieldLabel tip="name,m,n,k 형식의 CSV를 붙여넣습니다.">CSV 입력</FieldLabel>
            <textarea value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={6} />
            <ActionButton tip="CSV를 현재 workload 목록에 반영합니다." onClick={importCsv}>CSV 적용</ActionButton>
            <h4>수동 GEMM 추가</h4>
            <div className="row3">
              <MiniField label="이름" tip="연산 이름입니다."><input value={manualShape.name} onChange={(e) => setManualShape({ ...manualShape, name: e.target.value })} /></MiniField>
              <MiniField label="M" tip="GEMM M입니다."><input type="number" value={manualShape.m} onChange={(e) => setManualShape({ ...manualShape, m: +e.target.value })} /></MiniField>
              <MiniField label="N" tip="GEMM N입니다."><input type="number" value={manualShape.n} onChange={(e) => setManualShape({ ...manualShape, n: +e.target.value })} /></MiniField>
            </div>
            <MiniField label="K" tip="GEMM K입니다."><input type="number" value={manualShape.k} onChange={(e) => setManualShape({ ...manualShape, k: +e.target.value })} /></MiniField>
            <ActionButton tip="현재 수동 GEMM을 workload에 추가합니다." onClick={addManualShape}>GEMM 추가</ActionButton>
            <details className="advanced-box">
              <summary>Conv2D를 GEMM으로 추가</summary>
              <div className="row3">
                {(["n", "h", "w", "c", "r", "s", "k", "stride", "pad"] as const).map((key) => (
                  <MiniField key={key} label={key.toUpperCase()} tip={`Conv2D ${key} 값입니다.`}>
                    <input type="number" value={(conv as any)[key]} onChange={(e) => setConv({ ...conv, [key]: +e.target.value })} />
                  </MiniField>
                ))}
              </div>
              <ActionButton tip="현재 Conv2D 파라미터를 im2col GEMM shape로 변환해 추가합니다." onClick={addConv}>Conv2D 추가</ActionButton>
            </details>
            <FieldLabel tip="ONNX 파일에서 MatMul/Gemm 노드를 가져옵니다.">ONNX 가져오기</FieldLabel>
            <input type="file" accept=".onnx" onChange={(e: ChangeEvent<HTMLInputElement>) => e.target.files?.[0] && importOnnxFile(e.target.files[0])} />
            <div className="shape-list clean-shape-list">
              {shapes.map((s: any, idx: number) => (
                <div key={`${s.name}-${idx}`} className="shape-row">
                  <span>{s.name}</span><code>{s.m}×{s.n}×{s.k}</code>
                  <button className="secondary danger-button" onClick={() => setShapes(shapes.filter((_: any, i: number) => i !== idx))}>삭제</button>
                </div>
              ))}
              {shapes.length === 0 && <p className="small">아직 workload가 없습니다. 기본값을 불러오거나 GEMM을 추가하세요.</p>}
            </div>
          </>
        )}

        {inputTab === "run" && (
          <>
            <h3>실행</h3>
            <div className="info-box"><b>자동 미리보기</b><p className="small">입력값을 바꾸면 로컬 추정은 바로 갱신됩니다. SCALE-Sim/IREE 검증이 필요할 때만 full-pipeline 작업을 큐에 넣으세요.</p></div>
            <div className="run-actions">
              <button onClick={() => createJob(false)}>Full-pipeline 작업 추가</button>
              <button className="secondary" onClick={() => createJob(true)}>Dataflow별 작업 추가</button>
              <button className="secondary" onClick={() => refreshJobs({ switchTab: true, updateReport: false })}>작업 큐 열기</button>
              <button className="secondary" onClick={refreshStatus}>상태 새로고침</button>
              <button className="secondary" onClick={runDoctorCheck}>도구 점검</button>
            </div>
            {liveJobId && (
              <div className="live-job-actions">
                <span className="small">실시간 작업: {liveJobId}</span>
                <button className="secondary" onClick={() => watchJob(liveJobId)}>보기</button>
                <button className="secondary" onClick={() => cancelJob(liveJobId)}>취소</button>
                <button className="secondary danger-button" onClick={() => deleteJobPrompt(liveJobId)}>삭제</button>
              </div>
            )}
            {serverMessage && <p className="small status-note">{serverMessage}</p>}
          </>
        )}

        {inputTab === "tools" && (
          <>
            <h3>도구</h3>
            <p className="small">프리셋, 프로젝트 파일, 보조 유틸리티를 관리합니다. Estimator Suite는 별도 페이지에서 학습/평가합니다.</p>
            <div className="quick-preset-row">
              <MiniField label="하드웨어 프리셋" tip="저장된 하드웨어 프리셋을 불러옵니다.">
                <select onChange={(e) => applyHardwarePreset(e.target.value)} defaultValue=""><option value="">선택 안 함</option>{effectiveHardwarePresets.map((p: any) => <option key={p.name}>{p.name}</option>)}</select>
              </MiniField>
              <MiniField label="워크로드 프리셋" tip="저장된 workload 프리셋을 불러옵니다.">
                <select onChange={(e) => applyWorkloadPreset(e.target.value)} defaultValue=""><option value="">선택 안 함</option>{Object.keys(effectiveWorkloadPresets).map((k) => <option key={k}>{k}</option>)}</select>
              </MiniField>
            </div>
            <FieldLabel tip="현재 전체 설정을 사용자 프리셋으로 저장합니다.">전체 프리셋 이름</FieldLabel>
            <input value={customPresetName} onChange={(e) => setCustomPresetName(e.target.value)} placeholder="예: vit-s_128x128_ws" />
            <div className="graph-actions">
              <button onClick={saveCustomPreset}>전체 프리셋 저장</button>
              <button className="secondary" onClick={() => applyCustomPreset(customPresetName)} disabled={!customPresetName}>전체 프리셋 적용</button>
              <button className="secondary danger-button" onClick={() => deleteCustomPreset(customPresetName)} disabled={!customPresetName}>삭제</button>
            </div>
            <details className="advanced-box"><summary>하드웨어/워크로드 개별 저장</summary>
              <MiniField label="하드웨어 이름" tip="현재 하드웨어만 저장합니다."><input value={hardwarePresetName} onChange={(e) => setHardwarePresetName(e.target.value)} placeholder={hardware.name} /></MiniField>
              <div className="graph-actions"><button onClick={saveHardwarePreset}>하드웨어 저장</button><button className="secondary danger-button" onClick={() => deleteHardwarePreset(hardwarePresetName)} disabled={!hardwarePresetName}>하드웨어 삭제</button></div>
              <MiniField label="워크로드 이름" tip="현재 shape 목록만 저장합니다."><input value={workloadPresetName} onChange={(e) => setWorkloadPresetName(e.target.value)} placeholder="my_workload" /></MiniField>
              <div className="graph-actions"><button onClick={saveWorkloadPreset}>워크로드 저장</button><button className="secondary" onClick={() => applyWorkloadPreset(workloadPresetName)} disabled={!workloadPresetName}>워크로드 적용</button><button className="secondary danger-button" onClick={() => deleteWorkloadPreset(workloadPresetName)} disabled={!workloadPresetName}>워크로드 삭제</button></div>
            </details>
            <div className="run-actions">
              <button className="secondary" onClick={saveProject}>프로젝트 저장</button>
              <label className="button-like secondary">프로젝트 불러오기<input type="file" accept=".json" onChange={(e) => e.target.files?.[0] && loadProject(e.target.files[0])} hidden /></label>
              <Link className="button-like secondary" href="/estimator-suite">Estimator Suite 열기</Link>
            </div>
            {(customPresets.length > 0 || userHardwarePresets.length > 0 || userWorkloadPresets.length > 0) && <p className="small">사용자 프리셋: 전체 {customPresets.length}개, 하드웨어 {userHardwarePresets.length}개, 워크로드 {userWorkloadPresets.length}개</p>}
          </>
        )}

        {inputTab === "settings" && (
          <>
            <h3>설정</h3>
            <p className="small">외부 도구 경로와 작업 디렉터리 같은 `.env` 값을 웹에서 확인하고 수정합니다.</p>
            <div className="env-grid">
              {envKeys.map((key: string) => (
                <label key={key} className="env-row">
                  <span>{key}</span>
                  <input value={envValues[key] ?? ""} onChange={(e) => updateEnvValue(key, e.target.value)} placeholder="비워두면 기본값 사용" />
                </label>
              ))}
            </div>
            <div className="run-actions">
              <button className="secondary" onClick={refreshEnvSettings}>다시 읽기</button>
              <button onClick={() => saveEnvSettings?.()}>.env 저장</button>
            </div>
            {envMessage && <p className="small status-note">{envMessage}</p>}
          </>
        )}
      </div>
    </section>
  );
}
