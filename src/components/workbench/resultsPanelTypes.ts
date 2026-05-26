import type { DownloadFn } from "./primitives";
import type { Tab } from "./workbenchTabs";

export type ConfidenceSource = "preview" | "selected-job";

export type ResultsTabsView = {
  tab: Tab;
  setTab: (tab: Tab) => void;
  tabTips: Record<Tab, string>;
  tabLabels: Record<Tab, string>;
};

export type ResultsEstimateView = {
  result: any;
  uncertainty: any;
  confidence: any;
  confidenceSource: ConfidenceSource;
  arraySweep: any[];
};

export type ResultsJobView = {
  analysisJobId: string;
  setAnalysisJobId: (id: string) => void;
  jobsPayload: any | null;
  jobsJson: string;
  jobsViewMode: any;
  setJobsViewMode: (mode: any) => void;
  jobsPage: number;
  setJobsPage: (page: number) => void;
  jobsPageSize: number;
  setJobsPageSize: (size: number) => void;
  liveJobId: string;
  liveJob: any;
  liveLogs: any[];
  liveConnected: boolean;
  liveAutoScroll: boolean;
  setLiveAutoScroll: (enabled: boolean) => void;
  stopLiveJob: () => void;
  autoAttachNewJob: boolean;
  setAutoAttachNewJob: (enabled: boolean) => void;
  startLiveJob: (id: string) => void;
  selectedJobIds: string[];
  setSelectedJobIds: (ids: string[] | ((prev: string[]) => string[])) => void;
  deleteJobById: (id: string) => void | Promise<void>;
  deleteJobsByIds: (ids: string[]) => void | Promise<void>;
  cancelJobsByIds: (ids: string[]) => void | Promise<void>;
  cancelJobById: (id: string) => void | Promise<void>;
};

export type ResultsReportView = {
  serverReportMarkdown: string;
  serverReportJobId: string;
  fetchJobReport: (id: string) => void | Promise<void>;
};

export type ResultsExternalView = {
  statusJson: string;
  statusPayload: any | null;
  autoRefreshEnabled: boolean;
  setAutoRefreshEnabled: (enabled: boolean) => void;
  updateParallelJobs: (value: number) => void | Promise<void>;
};

export type ResultsEstimatorSuiteView = {
  activeEstimatorSuite: any | null;
};

export type ResultsPanelProps = {
  tabs: ResultsTabsView;
  estimate: ResultsEstimateView;
  jobs: ResultsJobView;
  report: ResultsReportView;
  external: ResultsExternalView;
  estimatorSuite: ResultsEstimatorSuiteView;
  download: DownloadFn;
};
