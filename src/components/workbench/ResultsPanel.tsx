import { ResultContextBar } from "@/components/workbench/resultTabs";
import { ResultsSummaryCards } from "./ResultsSummaryCards";
import { ResultsTabContent } from "./ResultsTabContent";
import type { ResultsPanelProps } from "./resultsPanelTypes";
import type { Tab } from "./workbenchTabs";

const RESULT_TAB_ORDER: Tab[] = [
  "policy",
  "bottleneck",
  "roofline",
  "energy",
  "array",
  "iree",
  "exports",
  "graphs",
  "tpu",
  "report",
  "jobs",
  "status",
];

export function ResultsPanel({ tabs, estimate, jobs, report, external, estimatorSuite, download }: ResultsPanelProps) {
  const { tab, tabTips, tabLabels, setTab } = tabs;
  return (
    <section className="results-section" title="오른쪽 패널에서 추정 결과, 분석 탭, 내보내기 산출물을 확인합니다.">
      <ResultsSummaryCards estimate={estimate} />
      <div className={`panel alt ${tab === "jobs" ? "jobs-panel" : ""}`} style={{ marginTop: 16 }}>
        <ResultContextBar
          jobsPayload={jobs.jobsPayload}
          selectedJobId={jobs.analysisJobId}
          onSelect={(id) => {
            jobs.setAnalysisJobId(id);
            if (id) void report.fetchJobReport(id);
          }}
        />
        <div className="tabs">
          {RESULT_TAB_ORDER.map((t) => (
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
        <ResultsTabContent
          tab={tab}
          estimate={estimate}
          jobs={jobs}
          report={report}
          external={external}
          estimatorSuite={estimatorSuite}
          download={download}
        />
      </div>
    </section>
  );
}
