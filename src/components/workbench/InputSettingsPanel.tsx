
import type { ChangeEvent } from "react";
import type { Dataflow, Objective } from "@/types/domain";
import { defaultShapes } from "@/lib/defaults";
import { ActionButton, FieldLabel, MiniField } from "@/components/workbench/primitives";

type InputTab =
  | "presets"
  | "hardware"
  | "tiling"
  | "scalesim"
  | "workload"
  | "conv"
  | "tools";

type InputSettingsPanelProps = Record<string, any>;

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
    generateEstimatorSuiteDesign,
    createJob,
    runServerEstimate,
    saveProject,
    loadProject,
    refreshJobs,
    refreshStatus,
    runDoctorCheck,
    runEstimatorSuiteWeb,
    liveJobId,
    cancelJob,
    deleteJobPrompt,
    watchJob,
    serverMessage,
  } = props;

  return (
        <section
          className="panel"
          title="왼쪽 패널에서 하드웨어, 타일 후보, workload, 실행 작업을 설정합니다."
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
                  {effectiveHardwarePresets.map((p: any) => (
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
                      {customPresets.map((p: any) => (
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
                      {customPresets.map((p: any) => (
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
                    <FieldLabel tip="데이터가 systolic array 안에서 어느 방향으로 오래 머무는지 정의합니다. WS는 weight-stationary, OS는 output-stationary, IS는 input-stationary입니다. 여러 개를 선택하면 full-pipeline 작업을 데이터플로우별로 큐에 나누어 넣어 비교합니다. 혼합 비교는 동일 workload를 여러 dataflow 조건으로 실행하는 방식입니다.">
                      데이터플로우 비교
                    </FieldLabel>
                    <div className="dataflow-grid" title="여러 데이터플로우를 선택하면 선택한 조건별로 job을 큐에 넣어 비교합니다.">
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
                  tip="현재 workload와 tile 후보 기준으로 Estimator Suite 학습용 설계 CSV를 생성합니다. 생성 후 measuredCycles에 SCALE-Sim 결과를 채우면 웹에서 바로 학습할 수 있습니다."
                  onClick={generateEstimatorSuiteDesign}
                >
                  Estimator Suite 설계 CSV 생성
                </ActionButton>
                <ActionButton
                  className="secondary"
                  tip="아래 Estimator Suite 탭의 CSV를 사용해 Tree/Neural/Ensemble residual estimator를 웹에서 학습하고 검증합니다."
                  onClick={runEstimatorSuiteWeb}
                >
                  Estimator Suite 웹 학습
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
  );
}
