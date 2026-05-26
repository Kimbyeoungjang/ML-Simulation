"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type RefreshJobsFn = (options?: { switchTab?: boolean; updateReport?: boolean }) => void | Promise<void>;

type UseLiveJobEventsArgs = {
  setJobsJson: (value: string) => void;
  openJobsTab: () => void;
  fetchJobReport: (id: string) => void | Promise<void>;
  refreshJobs: RefreshJobsFn;
  refreshStatus: (switchTab?: boolean) => void | Promise<void>;
};

export function useLiveJobEvents({
  setJobsJson,
  openJobsTab,
  fetchJobReport,
  refreshJobs,
  refreshStatus,
}: UseLiveJobEventsArgs) {
  const [liveJobId, setLiveJobId] = useState("");
  const [liveJob, setLiveJob] = useState<any | null>(null);
  const [liveLogs, setLiveLogs] = useState<string[]>([]);
  const [liveConnected, setLiveConnected] = useState(false);
  const [liveAutoScroll, setLiveAutoScroll] = useState(true);
  const liveEventSource = useRef<EventSource | null>(null);

  const stopLiveJob = useCallback(() => {
    liveEventSource.current?.close();
    liveEventSource.current = null;
    setLiveConnected(false);
    setLiveLogs((prev) => [
      ...prev,
      "[local] 실시간 로그 연결을 중지했습니다.",
    ]);
  }, []);

  const startLiveJob = useCallback(
    (id: string) => {
      const trimmed = id.trim();
      if (!trimmed) return;
      liveEventSource.current?.close();
      setLiveJobId(trimmed);
      setLiveJob(null);
      setLiveLogs([`[local] 작업 ${trimmed} 실시간 로그 연결 중...`]);
      setLiveConnected(true);
      openJobsTab();

      const es = new EventSource(`/api/jobs/${trimmed}/events?tail=1000`);
      liveEventSource.current = es;
      es.addEventListener("job", (ev: MessageEvent) => {
        const data = JSON.parse(ev.data);
        setLiveJob(data);
        setLiveLogs(data.logs ?? []);
        setJobsJson(JSON.stringify(data, null, 2));
      });
      es.addEventListener("done", (ev: MessageEvent) => {
        try {
          const data = JSON.parse(ev.data);
          setLiveLogs((prev) => [...prev, `[local] 작업 종료: ${data.status}`]);
        } catch {
          setLiveLogs((prev) => [...prev, "[local] 작업 종료"]);
        }
        setLiveConnected(false);
        es.close();
        if (liveEventSource.current === es) liveEventSource.current = null;
        void fetchJobReport(trimmed);
        void refreshJobs({ switchTab: false, updateReport: true });
        void refreshStatus(false);
      });
      es.addEventListener("error", () => {
        setLiveConnected(false);
        setLiveLogs((prev) => [
          ...prev,
          "[local] 실시간 로그 연결이 끊겼습니다. 작업 새로고침으로 최종 상태를 확인하세요.",
        ]);
        es.close();
        if (liveEventSource.current === es) liveEventSource.current = null;
      });
    },
    [fetchJobReport, openJobsTab, refreshJobs, refreshStatus, setJobsJson],
  );

  useEffect(() => {
    return () => {
      liveEventSource.current?.close();
      liveEventSource.current = null;
    };
  }, []);

  return {
    liveJobId,
    liveJob,
    liveLogs,
    liveConnected,
    liveAutoScroll,
    setLiveAutoScroll,
    startLiveJob,
    stopLiveJob,
  };
}
