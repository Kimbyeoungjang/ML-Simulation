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
  WS: { title: "Weight Stationary", desc: "가중치를 PE 안에 오래 유지해 weight 재사용을 높이는 방식입니다. TPU형 GEMM/Conv projection 비교의 기본 기준으로 쓰기 좋습니다." },
  OS: { title: "Output Stationary", desc: "부분합을 PE 안에 오래 유지해 ofmap write-back 부담을 줄이는 방식입니다. 누산량이 큰 연산의 대안으로 비교합니다." },
  IS: { title: "Input Stationary", desc: "입력 activation 재사용을 우선하는 방식입니다. 입력 재사용과 SRAM/DRAM 병목을 비교할 때 사용합니다." },
};

const envSettingTips: Record<string, string> = {
  TILEFORGE_WEB_PORT: "Next.js 웹 서버가 listen할 포트입니다. 예: 3000, 4000. 저장 후 서버를 재시작해야 반영됩니다.",
  TILEFORGE_WEB_HOST: "웹 서버 bind 주소입니다. 로컬 전용은 127.0.0.1, 같은 네트워크 접근 허용은 0.0.0.0을 사용합니다. 저장 후 재시작해야 반영됩니다.",
  NEXT_PUBLIC_TILEFORGE_API_BASE_URL: "브라우저가 호출할 API 서버 주소입니다. 비워두면 현재 웹 서버의 /api를 사용합니다. 예: http://127.0.0.1:4000",
  TILEFORGE_SCALE_SIM_CMD: "SCALE-Sim 실행 명령입니다. 예: py -3 -m scalesim.scale 또는 npx tsx scripts/mock-scalesim.ts",
  TILEFORGE_IREE_COMPILE_CMD: "IREE 컴파일 명령입니다. 예: py -3 -m iree.compiler.tools.core 또는 iree-compile",
  TILEFORGE_MAX_PARALLEL_JOBS: "worker가 동시에 처리할 full-pipeline 작업 수입니다. 너무 크게 잡으면 메모리 사용량이 급증합니다.",
  TILEFORGE_WORKSPACE_DIR: "job artifact, 임시 cfg/topology, 보고서를 저장할 작업 폴더입니다.",
  TILEFORGE_JOB_STORE: "작업 큐 상태를 저장할 SQLite 파일 경로입니다.",
  TILEFORGE_CACHE_DIR: "estimator와 외부 실행 캐시를 저장할 폴더입니다.",
  TILEFORGE_EXTERNAL_TIMEOUT_MS: "SCALE-Sim/IREE 외부 명령 하나에 허용할 최대 실행 시간(ms)입니다.",
  TILEFORGE_ENABLE_TPU_WEB_RUN: "TPU VM에서 웹 서버를 실행 중일 때 /api/tpu 서버 실행을 허용하려면 1로 설정합니다.",
  TILEFORGE_TPU_WEB_TIMEOUT_MS: "TPU 웹 benchmark 실행 요청의 최대 대기 시간(ms)입니다.",
};

function envTip(key: string) {
  return envSettingTips[key] ?? ".env에 저장되는 TileForge 실행 설정입니다. 비워두면 프로그램 기본값을 사용합니다.";
}

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

  const convFields: Array<[string, string, string]> = [
    ["batch", "Batch", "한 번에 처리하는 image 개수입니다."],
    ["inputH", "Input H", "입력 feature map의 높이입니다."],
    ["inputW", "Input W", "입력 feature map의 너비입니다."],
    ["inputC", "Input C", "입력 channel 수입니다."],
    ["outputC", "Output C", "출력 channel, 즉 filter 개수입니다."],
    ["kernelH", "Kernel H", "커널 높이입니다."],
    ["kernelW", "Kernel W", "커널 너비입니다."],
    ["strideH", "Stride H", "세로 stride입니다."],
    ["strideW", "Stride W", "가로 stride입니다."],
    ["padH", "Pad H", "위/아래 padding 크기입니다."],
    ["padW", "Pad W", "좌/우 padding 크기입니다."],
    ["dilationH", "Dilation H", "세로 dilation입니다."],
    ["dilationW", "Dilation W", "가로 dilation입니다."],
  ];

  const shapeName = (s: any) => s.opName ?? s.name ?? s.id ?? "op";

  return (
    <section className="panel setup-panel" title="하드웨어부터 실행까지 필요한 입력을 순서대로 설정합니다.">
      <div className="setup-header">
        <div>
          <h2>설계 흐름</h2>
          <p className="small">하드웨어를 정하고, 타일 후보를 고른 뒤, workload를 확인하고 검증 작업을 실행합니다.</p>
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
            <p className="small">가속기의 기본 성격을 정합니다. array, SRAM, DRAM을 바꾸면 오른쪽 미리보기 결과가 바로 갱신됩니다.</p>
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
              <MiniField label="메모리 BW GB/s" tip="하드웨어가 제공하는 외부 메모리 대역폭입니다. Roofline과 full-layer memory-bound 판단에 사용합니다.">
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
                <MiniField label="Ifmap SRAM KiB" tip="SCALE-Sim cfg의 ifmap SRAM 용량입니다. 입력 activation 버퍼 크기를 KiB 단위로 지정합니다."><input type="number" value={scaleSim.ifmapSramKB ?? Math.floor(hardware.sramKB / 3)} onChange={(e) => updateScaleSim({ ifmapSramKB: +e.target.value })} /></MiniField>
                <MiniField label="Filter SRAM KiB" tip="SCALE-Sim cfg의 filter SRAM 용량입니다. weight 버퍼 크기를 KiB 단위로 지정합니다."><input type="number" value={scaleSim.filterSramKB ?? Math.floor(hardware.sramKB / 3)} onChange={(e) => updateScaleSim({ filterSramKB: +e.target.value })} /></MiniField>
                <MiniField label="Ofmap SRAM KiB" tip="SCALE-Sim cfg의 ofmap SRAM 용량입니다. output/partial-sum 버퍼 크기를 KiB 단위로 지정합니다."><input type="number" value={scaleSim.ofmapSramKB ?? Math.floor(hardware.sramKB / 3)} onChange={(e) => updateScaleSim({ ofmapSramKB: +e.target.value })} /></MiniField>
              </div>
              <div className="row">
                <MiniField label="DRAM / Interface Bandwidth" tip="SCALE-Sim Bandwidth 값입니다. TileForge에서는 DRAM/global interface의 elements/cycle로 해석해 외부 검증과 full-layer bandwidth sweep에 사용합니다."><input type="number" value={(scaleSim as any).dramBandwidth ?? scaleSim.bandwidth ?? 128} onChange={(e) => updateScaleSim({ bandwidth: +e.target.value, ...({ dramBandwidth: +e.target.value } as any) })} /></MiniField>
                <MiniField label="run_name" tip="SCALE-Sim cfg의 run_name입니다. 결과 폴더와 로그를 구분할 때 사용합니다."><input value={scaleSim.runName ?? "tileforge_generated"} onChange={(e) => updateScaleSim({ runName: e.target.value })} /></MiniField>
              </div>
            </details>
          </>
        )}

        {inputTab === "tiling" && (
          <>
            <h3>타일링</h3>
            <p className="small">타일 후보를 쉼표로 입력합니다. 여기의 결과는 tile 선택과 ranking을 위한 보조 기준입니다.</p>
            <div className="row3">
              <MiniField label="tileM" tip="GEMM M축 타일 후보입니다."><input value={tileM} onChange={(e) => setTileM(e.target.value)} /></MiniField>
              <MiniField label="tileN" tip="GEMM N축 타일 후보입니다."><input value={tileN} onChange={(e) => setTileN(e.target.value)} /></MiniField>
              <MiniField label="tileK" tip="GEMM K축 reduction 타일 후보입니다."><input value={tileK} onChange={(e) => setTileK(e.target.value)} /></MiniField>
            </div>
            <FieldLabel tip="최적 타일을 고를 때 우선할 기준입니다.">최적화 목표</FieldLabel>
            <select title="타일 후보 ranking에 사용할 최적화 기준입니다." value={objective} onChange={(e) => setObjective(e.target.value as Objective)}>
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
            <p className="small">분석할 GEMM 목록을 구성합니다. Conv2D는 im2col 기준 GEMM으로 변환해 같은 목록에 추가합니다.</p>
            <FieldLabel tip="CSV 헤더를 포함해 GEMM 목록을 붙여넣습니다. 권장 열은 id,model,op_name 또는 opName,m,n,k,dtype_bytes입니다.">CSV 입력</FieldLabel>
            <textarea title="id,model,op_name,m,n,k,dtype_bytes 형식의 GEMM CSV를 입력합니다." value={csvText} onChange={(e) => setCsvText(e.target.value)} rows={6} />
            <ActionButton tip="CSV를 현재 workload 목록에 반영합니다." onClick={importCsv}>CSV 적용</ActionButton>
            <h4>수동 GEMM 추가</h4>
            <div className="row3">
              <MiniField label="연산 이름" tip="보고서와 그래프에 표시될 GEMM 연산 이름입니다."><input value={manualShape.opName ?? manualShape.id} onChange={(e) => setManualShape({ ...manualShape, opName: e.target.value, id: e.target.value || manualShape.id })} /></MiniField>
              <MiniField label="M" tip="GEMM M입니다."><input type="number" value={manualShape.m} onChange={(e) => setManualShape({ ...manualShape, m: +e.target.value })} /></MiniField>
              <MiniField label="N" tip="GEMM N입니다."><input type="number" value={manualShape.n} onChange={(e) => setManualShape({ ...manualShape, n: +e.target.value })} /></MiniField>
            </div>
            <MiniField label="K" tip="GEMM K입니다."><input type="number" value={manualShape.k} onChange={(e) => setManualShape({ ...manualShape, k: +e.target.value })} /></MiniField>
            <ActionButton tip="현재 수동 GEMM을 workload에 추가합니다." onClick={addManualShape}>GEMM 추가</ActionButton>
            <details className="advanced-box">
              <summary>Conv2D를 GEMM으로 추가</summary>
              <p className="small">Conv2D 설정은 workload 생성용입니다. 추가하면 오른쪽 목록에 GEMM shape가 생깁니다.</p>
              <div className="row3 conv-grid">
                {convFields.map(([key, label, tip]) => (
                  <MiniField key={key} label={label} tip={tip}>
                    <input
                      type="number"
                      value={Number((conv as any)[key] ?? 0)}
                      min={key.startsWith("pad") ? 0 : 1}
                      onChange={(e) => setConv({ ...conv, [key]: +e.target.value })}
                    />
                  </MiniField>
                ))}
              </div>
              <ActionButton tip="현재 Conv2D 파라미터를 im2col GEMM shape로 변환해 workload 목록에 추가합니다." onClick={addConv}>Conv2D → GEMM 추가</ActionButton>
            </details>
            <FieldLabel tip="ONNX 파일에서 MatMul/Gemm 노드를 가져옵니다.">ONNX 가져오기</FieldLabel>
            <input title="ONNX 파일을 선택하면 MatMul/Gemm 노드 shape를 workload 목록으로 가져옵니다." type="file" accept=".onnx" onChange={(e: ChangeEvent<HTMLInputElement>) => e.target.files?.[0] && importOnnxFile(e.target.files[0])} />
            <div className="shape-list clean-shape-list">
              {shapes.map((s: any, idx: number) => (
                <div key={`${shapeName(s)}-${idx}`} className="shape-row">
                  <span>{s.model ? `${s.model}.` : ""}{shapeName(s)}</span><code>{s.m}×{s.n}×{s.k}</code>
                  <button className="secondary danger-button" title="이 workload 항목을 목록에서 제거합니다." onClick={() => setShapes(shapes.filter((_: any, i: number) => i !== idx))}>삭제</button>
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
              <button title="현재 대표 dataflow로 full-pipeline 검증 작업을 큐에 넣습니다." onClick={() => createJob("full-pipeline", false)}>현재 조건 검증</button>
              <button className="secondary" title="선택한 WS/OS/IS를 각각 full-pipeline 작업으로 큐에 넣습니다." onClick={() => createJob("full-pipeline", true)}>선택 Dataflow 모두 검증</button>
              <button className="secondary" title="작업 큐 탭으로 이동해 진행 상황과 artifact를 확인합니다." onClick={() => refreshJobs({ switchTab: true, updateReport: false })}>작업 큐 열기</button>
              <button className="secondary" title="서버와 외부 도구 상태를 새로 불러옵니다." onClick={refreshStatus}>상태 새로고침</button>
              <button className="secondary" title="SCALE-Sim/IREE 명령과 작업 환경을 점검합니다." onClick={runDoctorCheck}>도구 점검</button>
            </div>
            {liveJobId && (
              <div className="live-job-actions">
                <span className="small">실시간 작업: {liveJobId}</span>
                <button className="secondary" title="현재 실시간 작업의 콘솔/로그 패널을 엽니다." onClick={() => watchJob(liveJobId)}>보기</button>
                <button className="secondary" title="현재 실시간 작업을 cancelled 상태로 전환합니다." onClick={() => cancelJob(liveJobId)}>취소</button>
                <button className="secondary danger-button" title="현재 실시간 작업 기록과 산출물을 삭제합니다." onClick={() => deleteJobPrompt(liveJobId)}>삭제</button>
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
              <button title="현재 하드웨어, 타일 후보, workload, SCALE-Sim 설정을 하나의 사용자 프리셋으로 저장합니다." onClick={saveCustomPreset}>전체 프리셋 저장</button>
              <button className="secondary" title="입력한 이름의 전체 프리셋을 현재 화면에 적용합니다." onClick={() => applyCustomPreset(customPresetName)} disabled={!customPresetName}>전체 프리셋 적용</button>
              <button className="secondary danger-button" title="입력한 이름의 전체 사용자 프리셋을 삭제합니다." onClick={() => deleteCustomPreset(customPresetName)} disabled={!customPresetName}>삭제</button>
            </div>
            <details className="advanced-box"><summary>하드웨어/워크로드 개별 저장</summary>
              <MiniField label="하드웨어 이름" tip="현재 하드웨어만 저장합니다."><input value={hardwarePresetName} onChange={(e) => setHardwarePresetName(e.target.value)} placeholder={hardware.name} /></MiniField>
              <div className="graph-actions"><button title="현재 하드웨어 설정만 사용자 프리셋으로 저장합니다." onClick={saveHardwarePreset}>하드웨어 저장</button><button className="secondary danger-button" title="입력한 이름의 하드웨어 프리셋을 삭제합니다." onClick={() => deleteHardwarePreset(hardwarePresetName)} disabled={!hardwarePresetName}>하드웨어 삭제</button></div>
              <MiniField label="워크로드 이름" tip="현재 shape 목록만 저장합니다."><input value={workloadPresetName} onChange={(e) => setWorkloadPresetName(e.target.value)} placeholder="my_workload" /></MiniField>
              <div className="graph-actions"><button title="현재 workload shape 목록만 사용자 프리셋으로 저장합니다." onClick={saveWorkloadPreset}>워크로드 저장</button><button className="secondary" title="입력한 이름의 workload 프리셋을 현재 shape 목록에 적용합니다." onClick={() => applyWorkloadPreset(workloadPresetName)} disabled={!workloadPresetName}>워크로드 적용</button><button className="secondary danger-button" title="입력한 이름의 workload 프리셋을 삭제합니다." onClick={() => deleteWorkloadPreset(workloadPresetName)} disabled={!workloadPresetName}>워크로드 삭제</button></div>
            </details>
            <div className="run-actions">
              <button className="secondary" title="현재 프로젝트를 .tileforge/project.json 및 다운로드 가능한 JSON으로 저장합니다." onClick={saveProject}>프로젝트 저장</button>
              <button className="secondary" title="서버에 저장된 .tileforge/project.json을 불러옵니다." onClick={() => loadProject()}>최근 프로젝트 불러오기</button>
              <label className="button-like secondary" title="내 컴퓨터의 project.tileforge.json 파일을 불러옵니다.">프로젝트 파일 불러오기<input type="file" accept=".json" onChange={(e) => e.target.files?.[0] && loadProject(e.target.files[0])} hidden /></label>
              <Link className="button-like secondary" title="Estimator Suite 학습/평가 화면으로 이동합니다." href="/estimator-suite">Estimator Suite 열기</Link>
            </div>
            {(customPresets.length > 0 || userHardwarePresets.length > 0 || userWorkloadPresets.length > 0) && <p className="small">사용자 프리셋: 전체 {customPresets.length}개, 하드웨어 {userHardwarePresets.length}개, 워크로드 {userWorkloadPresets.length}개</p>}
          </>
        )}

        {inputTab === "settings" && (
          <>
            <h3>설정</h3>
            <p className="small">외부 도구 명령, 작업 폴더, 병렬 실행 수를 관리합니다. 저장한 값은 다음 작업부터 적용됩니다.</p>
            <div className="env-grid">
              {envKeys.map((key: string) => {
                const tip = envTip(key);
                return (
                  <label key={key} className="env-row" title={tip}>
                    <span>{key}<small>{tip}</small></span>
                    <input title={tip} value={envValues[key] ?? ""} onChange={(e) => updateEnvValue(key, e.target.value)} placeholder="비워두면 기본값 사용" />
                  </label>
                );
              })}
            </div>
            <div className="run-actions">
              <button className="secondary" title="서버의 현재 .env 값을 다시 읽어 입력창에 반영합니다." onClick={refreshEnvSettings}>다시 읽기</button>
              <button title="입력한 환경 설정을 .env 파일에 저장합니다. 실행 중인 작업에는 다음 실행부터 반영됩니다." onClick={() => saveEnvSettings?.()}>.env 저장</button>
            </div>
            {envMessage && <p className="small status-note">{envMessage}</p>}
          </>
        )}
      </div>
    </section>
  );
}
