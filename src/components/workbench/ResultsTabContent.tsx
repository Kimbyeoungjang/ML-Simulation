import { Jobs } from "@/components/workbench/JobsPanel";
import {
  ArraySweep,
  Bottleneck,
  Energy,
  Exports,
  Graphs,
  Iree,
  Policy,
  ReportTab,
  Roofline,
  StatusTab,
} from "@/components/workbench/resultTabs";
import type { DownloadFn } from "./primitives";
import type { ResultsEstimateView, ResultsEstimatorSuiteView, ResultsExternalView, ResultsJobView, ResultsReportView } from "./resultsPanelTypes";
import type { Tab } from "./workbenchTabs";

export function ResultsTabContent({
  tab,
  estimate,
  jobs,
  report,
  external,
  estimatorSuite,
  download,
}: {
  tab: Tab;
  estimate: ResultsEstimateView;
  jobs: ResultsJobView;
  report: ResultsReportView;
  external: ResultsExternalView;
  estimatorSuite: ResultsEstimatorSuiteView;
  download: DownloadFn;
}) {
  const { result, arraySweep, confidence } = estimate;
  const {
    analysisJobId,
    setAnalysisJobId,
    jobsPayload,
    jobsViewMode,
    setJobsViewMode,
    jobsPage,
    setJobsPage,
    jobsPageSize,
    setJobsPageSize,
    jobsJson,
    liveJobId,
    liveJob,
    liveLogs,
    liveConnected,
    liveAutoScroll,
    setLiveAutoScroll,
    stopLiveJob,
    autoAttachNewJob,
    setAutoAttachNewJob,
    startLiveJob,
    selectedJobIds,
    setSelectedJobIds,
    deleteJobById,
    deleteJobsByIds,
    cancelJobsByIds,
    cancelJobById,
  } = jobs;
  const { serverReportMarkdown, serverReportJobId, fetchJobReport } = report;
  const { statusJson, statusPayload, autoRefreshEnabled, setAutoRefreshEnabled, updateParallelJobs } = external;

  if (tab === "policy") return <Policy result={result} download={download} jobId={analysisJobId} jobsPayload={jobsPayload} />;
  if (tab === "bottleneck") return <Bottleneck result={result} jobId={analysisJobId} />;
  if (tab === "roofline") return <Roofline result={result} jobId={analysisJobId} />;
  if (tab === "energy") return <Energy result={result} jobId={analysisJobId} />;
  if (tab === "array") {
    return (
      <ArraySweep
        rows={arraySweep}
        comparisonCsv={result.artifacts.experimentComparisonCsv ?? ""}
        download={download}
      />
    );
  }
  if (tab === "iree") return <Iree result={result} download={download} jobId={analysisJobId} />;
  if (tab === "exports") return <Exports result={result} download={download} jobId={analysisJobId} jobsPayload={jobsPayload} />;
  if (tab === "graphs") {
    return (
      <Graphs
        result={result}
        download={download}
        jobId={analysisJobId}
        jobsPayload={jobsPayload}
        activeEstimatorSuite={estimatorSuite.activeEstimatorSuite}
      />
    );
  }
  if (tab === "report") {
    return (
      <ReportTab
        report={serverReportMarkdown || result.artifacts.reportMarkdown}
        sourceJobId={serverReportJobId}
        fallback={!serverReportMarkdown}
        download={download}
        confidence={confidence}
        jobsPayload={jobsPayload}
        onSelectJobReport={(id) => {
          setAnalysisJobId(id);
          void fetchJobReport(id);
        }}
        onDeleteJob={(id) => void deleteJobById(id)}
      />
    );
  }
  if (tab === "jobs") {
    return (
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
        jobsViewMode={jobsViewMode}
        setJobsViewMode={setJobsViewMode}
        jobsPage={jobsPage}
        setJobsPage={setJobsPage}
        jobsPageSize={jobsPageSize}
        setJobsPageSize={setJobsPageSize}
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
    );
  }
  return (
    <StatusTab
      text={statusJson || "시스템 상태를 자동으로 불러오는 중입니다."}
      payload={statusPayload}
      download={download}
      autoRefreshEnabled={autoRefreshEnabled}
      setAutoRefreshEnabled={setAutoRefreshEnabled}
      onParallelChange={(value) => void updateParallelJobs(value)}
    />
  );
}
