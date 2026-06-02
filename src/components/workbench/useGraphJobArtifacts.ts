"use client";

import { apiFetch } from "@/lib/apiClient";
import { useEffect, useState } from "react";

export function useGraphJobArtifacts(jobId?: string) {
  const [jobResult, setJobResult] = useState<any | null>(null);
  const [scaleSummary, setScaleSummary] = useState<any | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setError("");
      setJobResult(null);
      setScaleSummary(null);
      if (!jobId) return;
      try {
        const [resultResponse, scaleResponse] = await Promise.all([
          apiFetch(`/api/jobs/${jobId}/artifact?path=${encodeURIComponent("result.json")}`, { cache: "no-store" }),
          apiFetch(`/api/jobs/${jobId}/artifact?path=${encodeURIComponent("scalesim_summary.json")}`, { cache: "no-store" }),
        ]);
        if (!resultResponse.ok) throw new Error(await resultResponse.text());
        const parsed = JSON.parse(await resultResponse.text());
        if (!cancelled) {
          setJobResult(parsed?.payload?.response ?? parsed?.response ?? parsed);
        }
        if (scaleResponse.ok) {
          const scaleParsed = JSON.parse(await scaleResponse.text());
          if (!cancelled) setScaleSummary(scaleParsed);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message ?? String(e));
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [jobId]);

  return { jobResult, scaleSummary, error };
}
