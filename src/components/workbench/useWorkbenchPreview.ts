"use client";

import { useMemo } from "react";
import { defaultArraySweep } from "@/lib/defaults";
import { estimateAll, sweepArrays } from "@/lib/estimator";
import { applyEstimatorSuiteToSearchResponse } from "@/lib/estimatorSuiteApply";
import { assessConfidence } from "@/lib/confidence";
import { totalCycleUncertainty } from "@/lib/uncertainty";
import type { SearchRequest } from "@/types/domain";
import type { EstimatorSuiteModel } from "@/lib/estimatorSuite";

export function useWorkbenchPreview({
  request,
  requestKey,
  activeEstimatorSuite,
}: {
  request: SearchRequest;
  requestKey: string;
  activeEstimatorSuite: { runId?: string; model?: EstimatorSuiteModel } | null;
}) {
  const result = useMemo(
    () => applyEstimatorSuiteToSearchResponse(estimateAll(request), activeEstimatorSuite?.model),
    [requestKey, activeEstimatorSuite?.runId],
  );
  const confidence = useMemo(
    () => assessConfidence(result, {
      externalValidated: Boolean(result.artifacts?.validationCsv),
      estimatorSuiteSamples: result.estimatorSuite?.applied ? result.estimatorSuite.modelSamples ?? 0 : 0,
    }),
    [
      JSON.stringify(result.summary),
      result.estimatorSuite?.applied,
      result.estimatorSuite?.modelSamples,
      Boolean(result.artifacts?.validationCsv),
    ],
  );
  const uncertainty = useMemo(() => totalCycleUncertainty(result), [JSON.stringify(result.summary)]);
  const arraySweep = useMemo(
    () => sweepArrays({
      baseHardware: request.hardware,
      shapes: request.shapes,
      candidates: request.candidates,
      arrays: defaultArraySweep,
      objective: request.objective,
    }),
    [requestKey],
  );

  return { result, confidence, uncertainty, arraySweep };
}
