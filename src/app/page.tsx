"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { type DownloadFn } from "@/components/workbench/primitives";
import { InputSettingsPanel } from "@/components/workbench/InputSettingsPanel";
import { ResultsPanel } from "@/components/workbench/ResultsPanel";
import { envSettingKeys, inputTabLabels, inputTabTips, tabLabels, tabTips, type Tab } from "@/components/workbench/workbenchTabs";
import { useWorkbenchJobs } from "@/components/workbench/useWorkbenchJobs";
import { useEstimatorSuiteWorkbench } from "@/components/workbench/useEstimatorSuiteWorkbench";
import { useWorkbenchPresets } from "@/components/workbench/useWorkbenchPresets";
import { useEnvSettings } from "@/components/workbench/useEnvSettings";
import { useProjectIO } from "@/components/workbench/useProjectIO";
import { useWorkbenchInputs } from "@/components/workbench/useWorkbenchInputs";
import { useWorkbenchPreview } from "@/components/workbench/useWorkbenchPreview";
import { confidenceSourceForJobSelection, selectDisplayConfidence } from "@/components/workbench/resultViewContracts";

export default function Home() {
  const [tab, setTab] = useState<Tab>("policy");
  const [serverMessage, setServerMessage] = useState("");
  const inputs = useWorkbenchInputs({ setServerMessage });
  const {
    hardware,
    dataflowModes,
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
    csvText,
    setCsvText,
    manualShape,
    setManualShape,
    conv,
    setConv,
    updateHw,
    updateScaleSim,
    importCsv,
    addConv,
    importOnnxFile,
    toggleDataflowMode,
    addManualShape,
  } = inputs;

  const jobs = useWorkbenchJobs({
    request: inputs.request,
    requestKey: inputs.requestKey,
    hardware: inputs.hardware,
    dataflowModes: inputs.dataflowModes,
    openTab: setTab,
    setServerMessage,
  });

  const estimatorSuite = useEstimatorSuiteWorkbench({
    request: inputs.request,
    autoAttachNewJob: jobs.autoAttachNewJob,
    refreshJobs: jobs.refreshJobs,
    startLiveJob: jobs.startLiveJob,
    openTab: setTab,
    setServerMessage,
  });

  const presets = useWorkbenchPresets({
    hardware: inputs.hardware,
    setHardware: inputs.setHardware,
    dataflowModes: inputs.dataflowModes,
    setDataflowModes: inputs.setDataflowModes,
    shapes: inputs.shapes,
    setShapes: inputs.setShapes,
    objective: inputs.objective,
    setObjective: inputs.setObjective,
    tileM: inputs.tileM,
    setTileM: inputs.setTileM,
    tileN: inputs.tileN,
    setTileN: inputs.setTileN,
    tileK: inputs.tileK,
    setTileK: inputs.setTileK,
    scaleSim: inputs.scaleSim,
    setScaleSim: inputs.setScaleSim,
    estimatorPlanOptions: estimatorSuite.estimatorPlanOptions,
    setEstimatorPlanOptions: estimatorSuite.setEstimatorPlanOptions,
    estimatorSuiteOptions: estimatorSuite.estimatorSuiteOptions,
    setEstimatorSuiteOptions: estimatorSuite.setEstimatorSuiteOptions,
    setServerMessage,
  });

  const { envValues, setEnvValues, envMessage, refreshEnvSettings, saveEnvSettings } = useEnvSettings();

  useEffect(() => {
    void presets.refreshPresets();
  }, []);

  const { result, confidence, uncertainty, arraySweep } = useWorkbenchPreview({
    request: inputs.request,
    requestKey: inputs.requestKey,
    activeEstimatorSuite: estimatorSuite.activeEstimatorSuite,
  });
  const confidenceSource = confidenceSourceForJobSelection({
    selectedJobConfidence: jobs.selectedJobConfidence,
    selectedJobConfidenceId: jobs.selectedJobConfidenceId,
    analysisJobId: jobs.analysisJobId,
  });
  const displayConfidence = selectDisplayConfidence({
    previewConfidence: confidence,
    selectedJobConfidence: jobs.selectedJobConfidence,
    selectedJobConfidenceId: jobs.selectedJobConfidenceId,
    analysisJobId: jobs.analysisJobId,
  });

  const { saveProject, loadProject } = useProjectIO({
    projectJson: result.artifacts.projectJson,
    setHardware: inputs.setHardware,
    setDataflowModes: inputs.setDataflowModes,
    setShapes: inputs.setShapes,
    setObjective: inputs.setObjective,
    setScaleSim: inputs.setScaleSim,
    setTileM: inputs.setTileM,
    setTileN: inputs.setTileN,
    setTileK: inputs.setTileK,
    setServerMessage,
  });

  const download: DownloadFn = (name, text, type = "text/plain") => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <main>
      <header className="topbar">
        <div>
          <h1 title="TPU 계열 systolic-array 설계를 빠르게 탐색하는 도구입니다.">TileForge</h1>
          <p className="lead" title="설정을 바꾸면 즉시 미리보기 예측이 갱신되고, 필요할 때 SCALE-Sim/IREE 검증 작업을 실행합니다.">
            하드웨어 설계값과 GEMM workload를 바꿔 보며 cycle, stall, memory 병목, sweet spot을 확인합니다.
          </p>
        </div>
        <div className="topbar-actions">
          <Link className="button-like secondary" href="/estimator-suite" title="Estimator Suite 학습/평가 전용 페이지로 이동합니다.">Estimator Suite</Link>
          <Link className="button-like secondary" href="/help" title="예제별 사용 방법과 각 입력 항목의 의미를 자세히 설명한 도움말 페이지로 이동합니다.">도움말</Link>
        </div>
      </header>
      <div className="grid">
        <InputSettingsPanel
          inputTab={inputTab}
          setInputTab={setInputTab}
          inputTabTips={inputTabTips}
          inputTabLabels={inputTabLabels}
          effectiveHardwarePresets={presets.effectiveHardwarePresets}
          applyHardwarePreset={presets.applyHardwarePreset}
          effectiveWorkloadPresets={presets.effectiveWorkloadPresets}
          applyWorkloadPreset={presets.applyWorkloadPreset}
          customPresetName={presets.customPresetName}
          setCustomPresetName={presets.setCustomPresetName}
          saveCustomPreset={presets.saveCustomPreset}
          customPresets={presets.customPresets}
          applyCustomPreset={presets.applyCustomPreset}
          deleteCustomPreset={presets.deleteCustomPreset}
          hardwarePresetName={presets.hardwarePresetName}
          setHardwarePresetName={presets.setHardwarePresetName}
          saveHardwarePreset={presets.saveHardwarePreset}
          userHardwarePresets={presets.userHardwarePresets}
          deleteHardwarePreset={presets.deleteHardwarePreset}
          workloadPresetName={presets.workloadPresetName}
          setWorkloadPresetName={presets.setWorkloadPresetName}
          saveWorkloadPreset={presets.saveWorkloadPreset}
          userWorkloadPresets={presets.userWorkloadPresets}
          deleteWorkloadPreset={presets.deleteWorkloadPreset}
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
          generateEstimatorSuiteDesign={estimatorSuite.generateEstimatorSuiteDesign}
          collectEstimatorSamplesFromJobsWeb={estimatorSuite.collectEstimatorSamplesFromJobsWeb}
          runEstimatorSuiteWeb={estimatorSuite.runEstimatorSuiteWeb}
          importEstimatorDatasetWeb={estimatorSuite.importEstimatorDatasetWeb}
          liveJobId={jobs.liveJobId}
          createJob={jobs.createJob}
          saveProject={saveProject}
          loadProject={loadProject}
          refreshJobs={jobs.refreshJobs}
          refreshStatus={jobs.refreshStatus}
          runDoctorCheck={jobs.runDoctorCheck}
          cancelJob={jobs.cancelJob}
          deleteJobPrompt={jobs.deleteJobPrompt}
          watchJob={jobs.watchJob}
          envValues={envValues}
          setEnvValues={setEnvValues}
          envKeys={envSettingKeys}
          refreshEnvSettings={refreshEnvSettings}
          saveEnvSettings={saveEnvSettings}
          envMessage={envMessage}
          serverMessage={serverMessage}
        />

        <ResultsPanel
          tabs={{ tab, tabTips, tabLabels, setTab }}
          estimate={{
            result,
            uncertainty,
            confidence: displayConfidence,
            confidenceSource,
            arraySweep,
          }}
          jobs={{
            analysisJobId: jobs.analysisJobId,
            setAnalysisJobId: jobs.setAnalysisJobId,
            jobsPayload: jobs.jobsPayload,
            jobsJson: jobs.jobsJson,
            jobsViewMode: jobs.jobsViewMode,
            setJobsViewMode: jobs.setJobsViewMode,
            jobsPage: jobs.jobsPage,
            setJobsPage: jobs.setJobsPage,
            jobsPageSize: jobs.jobsPageSize,
            setJobsPageSize: jobs.setJobsPageSize,
            liveJobId: jobs.liveJobId,
            liveJob: jobs.liveJob,
            liveLogs: jobs.liveLogs,
            liveConnected: jobs.liveConnected,
            liveAutoScroll: jobs.liveAutoScroll,
            setLiveAutoScroll: jobs.setLiveAutoScroll,
            stopLiveJob: jobs.stopLiveJob,
            autoAttachNewJob: jobs.autoAttachNewJob,
            setAutoAttachNewJob: jobs.setAutoAttachNewJob,
            startLiveJob: jobs.startLiveJob,
            selectedJobIds: jobs.selectedJobIds,
            setSelectedJobIds: jobs.setSelectedJobIds,
            deleteJobById: jobs.deleteJobById,
            deleteJobsByIds: jobs.deleteJobsByIds,
            cancelJobsByIds: jobs.cancelJobsByIds,
            cancelJobById: jobs.cancelJobById,
          }}
          report={{
            serverReportMarkdown: jobs.serverReportMarkdown,
            serverReportJobId: jobs.serverReportJobId,
            fetchJobReport: (id: string) => jobs.fetchJobReport(id, { manual: true }),
          }}
          external={{
            statusJson: jobs.statusJson,
            statusPayload: jobs.statusPayload,
            autoRefreshEnabled: jobs.autoRefreshEnabled,
            setAutoRefreshEnabled: jobs.setAutoRefreshEnabled,
            updateParallelJobs: jobs.updateParallelJobs,
          }}
          estimatorSuite={{ activeEstimatorSuite: estimatorSuite.activeEstimatorSuite }}
          download={download}
        />
      </div>
      <p className="footer" title="TileForge 결과는 설계 후보를 빠르게 좁히기 위한 분석값이며, 최종 평가는 SCALE-Sim/IREE 실측으로 검증하는 것이 좋습니다.">
        TileForge는 분석용 탐색 도구입니다. 생성된 정책과 MLIR은 튜닝 후보로 사용하고, 최종 결과는 SCALE-Sim/IREE로 검증하세요.
      </p>
    </main>
  );
}
