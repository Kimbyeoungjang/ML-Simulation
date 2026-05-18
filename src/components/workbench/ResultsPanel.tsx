import { EstimatorSuitePanel } from "@/components/workbench/EstimatorSuitePanel";
import { Jobs } from "@/components/workbench/JobsPanel";
import {
  ArraySweep,
  Bottleneck,
  Energy,
  Exports,
  Graphs,
  Iree,
  Metric,
  Policy,
  ReportTab,
  ResultContextBar,
  Roofline,
  StatusTab,
} from "@/components/workbench/resultTabs";
import { Artifact } from "@/components/workbench/primitives";
import { profileToMarkdown } from "@/lib/calibration";
import { fmt } from "@/lib/math";

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

type ResultsPanelProps = Record<string, any>;

export function ResultsPanel(props: ResultsPanelProps) {
  const {
    tab,
    tabTips,
    tabLabels,
    setTab,
    result,
    uncertainty,
    confidence,
    calibration,
    arraySweep,
    download,
    analysisJobId,
    setAnalysisJobId,
    jobsPayload,
    serverReportMarkdown,
    serverReportJobId,
    fetchJobReport,
    deleteJobById,
    estimatorSuiteCsv,
    setEstimatorSuiteCsv,
    estimatorSuiteOptions,
    updateEstimatorSuiteOptions,
    estimatorPlanOptions,
    updateEstimatorPlanOptions,
    estimatorSuiteResult,
    estimatorSuiteBusy,
    generateEstimatorSuiteDesign,
    generateEstimatorSamplingPlan,
    runEstimatorSuiteWeb,
    jobsJson,
    liveJobId,
    liveJob,
    liveLogs,
    liveConnected,
    liveAutoScroll,
    setLiveAutoScroll,
    stopLiveJob,
    autoRefreshEnabled,
    setAutoRefreshEnabled,
    autoAttachNewJob,
    setAutoAttachNewJob,
    startLiveJob,
    selectedJobIds,
    setSelectedJobIds,
    deleteJobsByIds,
    cancelJobsByIds,
    cancelJobById,
    statusJson,
    statusPayload,
    updateParallelJobs,
  } = props;

  return (
        <section className={`results-section ${tab === "jobs" ? "jobs-wide" : ""}`} title="오른쪽 패널에서 추정 결과, 분석 탭, 내보내기 산출물을 확인합니다.">
          <div className="cards">
            <Metric
              title="총 사이클"
              tip="현재 workload 전체에 대한 예상 총 cycle과 불확실성입니다."
              value={`${fmt(result.summary.totalCycles, 0)} ±${uncertainty.uncertaintyPct.toFixed(1)}%`}
            />
            <Metric
              title="평균 활용률"
              tip="선택된 최적 타일들의 평균 PE utilization입니다."
              value={`${(result.summary.meanUtilization * 100).toFixed(1)}%`}
            />
            <Metric
              title="신뢰도"
              tip="입력 유효성, 보정 샘플, 경고 수 등을 종합한 결과 신뢰도입니다."
              value={`${confidence.level} (${(confidence.score * 100).toFixed(0)}%)`}
            />
            <Metric
              title="주요 병목"
              tip="전체 사이클에서 가장 큰 비중을 차지하는 연산입니다."
              value={result.summary.bottleneckOp}
            />
          </div>
          <div className={`panel alt ${tab === "jobs" ? "jobs-panel" : ""}`} style={{ marginTop: 16 }}>
            <ResultContextBar
              jobsPayload={jobsPayload}
              selectedJobId={analysisJobId}
              onSelect={(id) => { setAnalysisJobId(id); if (id) void fetchJobReport(id); }}
            />
            <div className="tabs">
              {(
                [
                  "policy",
                  "bottleneck",
                  "roofline",
                  "energy",
                  "array",
                  "calibration",
                  "iree",
                  "exports",
                  "graphs",
                  "report",
                  "jobs",
                  "estimatorSuite",
                  "status",
                ] as Tab[]
              ).map((t) => (
                <button
                  key={t}
                  title={tabTips[t]}
                  className={tab === t ? "" : "secondary"}
                  onClick={() => setTab(t)}
                >
                  {tabLabels[t]}
                </button>
              ))}
            </div>
            {tab === "policy" && <Policy result={result} download={download} jobId={analysisJobId} jobsPayload={jobsPayload} />}
            {tab === "bottleneck" && <Bottleneck result={result} jobId={analysisJobId} />}
            {tab === "roofline" && <Roofline result={result} jobId={analysisJobId} />}
            {tab === "energy" && <Energy result={result} jobId={analysisJobId} />}
            {tab === "array" && (
              <ArraySweep
                rows={arraySweep}
                comparisonCsv={result.artifacts.experimentComparisonCsv ?? ""}
                download={download}
              />
            )}
            {tab === "calibration" && (
              <Artifact
                name="calibration.md"
                text={profileToMarkdown(calibration)}
                download={download}
              />
            )}
            {tab === "iree" && <Iree result={result} download={download} jobId={analysisJobId} />}
            {tab === "exports" && (
              <Exports result={result} download={download} jobId={analysisJobId} jobsPayload={jobsPayload} />
            )}
            {tab === "graphs" && <Graphs result={result} download={download} jobId={analysisJobId} jobsPayload={jobsPayload} />}
            {tab === "report" && (
              <ReportTab
                report={serverReportMarkdown || result.artifacts.reportMarkdown}
                sourceJobId={serverReportJobId}
                fallback={!serverReportMarkdown}
                download={download}
                confidence={confidence}
                jobsPayload={jobsPayload}
                onSelectJobReport={(id) => { setAnalysisJobId(id); void fetchJobReport(id); }}
                onDeleteJob={(id) => void deleteJobById(id)}
              />
            )}
            {tab === "estimatorSuite" && (
              <EstimatorSuitePanel
                csv={estimatorSuiteCsv}
                setCsv={setEstimatorSuiteCsv}
                options={estimatorSuiteOptions}
                updateOptions={updateEstimatorSuiteOptions}
                planOptions={estimatorPlanOptions}
                updatePlanOptions={updateEstimatorPlanOptions}
                result={estimatorSuiteResult}
                busy={estimatorSuiteBusy}
                onDesign={generateEstimatorSuiteDesign}
                onPlan={() => generateEstimatorSamplingPlan(false)}
                onQueuePlan={() => generateEstimatorSamplingPlan(true)}
                onRun={runEstimatorSuiteWeb}
                download={download}
              />
            )}

            {tab === "jobs" && (
              <Jobs
                text={jobsJson || "작업 목록을 자동으로 불러오는 중입니다."}
                download={download}
                liveJobId={liveJobId}
                liveJob={liveJob}
                liveLogs={liveLogs}
                liveConnected={liveConnected}
                autoScroll={liveAutoScroll}
                setAutoScroll={setLiveAutoScroll}
                onStop={stopLiveJob}
                autoRefreshEnabled={autoRefreshEnabled}
                setAutoRefreshEnabled={setAutoRefreshEnabled}
                jobsPayload={jobsPayload}
                autoAttachNewJob={autoAttachNewJob}
                setAutoAttachNewJob={setAutoAttachNewJob}
                onWatchJob={startLiveJob}
                onDeleteJob={(id) => void deleteJobById(id)}
                selectedJobIds={selectedJobIds}
                setSelectedJobIds={setSelectedJobIds}
                onDeleteSelected={(ids) => void deleteJobsByIds(ids)}
                onCancelSelected={(ids) => void cancelJobsByIds(ids)}
                onCancelJob={(id) => void cancelJobById(id)}
              />
            )}
            {tab === "status" && (
              <StatusTab
                text={statusJson || "시스템 상태를 자동으로 불러오는 중입니다."}
                payload={statusPayload}
                download={download}
                autoRefreshEnabled={autoRefreshEnabled}
                setAutoRefreshEnabled={setAutoRefreshEnabled}
                onParallelChange={(value) => void updateParallelJobs(value)}
              />
            )}
          </div>
        </section>
  );
}
