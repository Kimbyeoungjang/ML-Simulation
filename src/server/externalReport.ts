import { readFile } from "node:fs/promises";
import path from "node:path";
import type { JobRecord } from "@/types/job";
import { estimateAll } from "@/lib/estimator";
import { assessConfidence, confidenceMarkdown } from "@/lib/confidence";
import { buildValidationReport, type ValidationSample } from "@/lib/verification";
import { buildValidationEvidenceBundle, estimatorSuiteFeedbackCsv, estimatorSuiteFeedbackCsvForScope, validationEvidenceJson, validationEvidenceMarkdown } from "./validationEvidence";
import { atomicWriteFile } from "./atomic";
import { saveJob } from "./jobStore";
import { jobDir } from "./workspace";
import type { ExternalRunSummary } from "./externalRunTypes";
import { matchScaleLayerForResult } from "./scaleSimReport";
import { buildValidationFeedbackPolicyReport, validationFeedbackPolicyJson, validationFeedbackPolicyMarkdown } from "./validationFeedbackPolicy";

function formatPctDelta(actual: number, predicted: number): string {
  if (!Number.isFinite(actual) || !Number.isFinite(predicted) || predicted <= 0) return "해당 없음";
  const pct = ((actual - predicted) / predicted) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function accuracyGradeFromRatio(ratio?: number): { label: string; description: string } {
  if (!ratio || !Number.isFinite(ratio)) return { label: "pending", description: "SCALE-Sim 결과 대기 중" };
  const err = Math.abs(ratio - 1) * 100;
  if (err < 5) return { label: "excellent", description: "매우 양호" };
  if (err < 15) return { label: "good", description: "양호" };
  if (err < 30) return { label: "warning", description: "주의" };
  return { label: "poor", description: "재학습 필요" };
}

function externalComparisonMarkdown(
  res: ReturnType<typeof estimateAll>,
  scale?: ExternalRunSummary,
): string {
  const predictedTotal = res.summary.totalCycles;
  const actualTotal = scale?.totalCycles;
  const hasActual = Boolean(scale?.ok && actualTotal && actualTotal > 0);
  const ratio = hasActual ? actualTotal! / predictedTotal : undefined;
  const grade = accuracyGradeFromRatio(ratio);
  const absDelta = hasActual ? actualTotal! - predictedTotal : undefined;
  const verdict = !hasActual
    ? "SCALE-Sim 결과가 아직 없어 비교할 수 없습니다."
    : ratio! > 1.15
      ? "SCALE-Sim cycle이 estimator보다 큽니다. 경계 타일, array fill/drain, 메모리 대기, 데이터플로우 모델이 estimator보다 더 보수적으로 반영되었을 가능성이 큽니다."
      : ratio! < 0.85
        ? "SCALE-Sim cycle이 estimator보다 작습니다. TileForge estimator가 padding 또는 pipeline 비용을 더 보수적으로 잡았거나, SCALE-Sim topology가 단순한 compute path로 해석되었을 가능성이 있습니다."
        : "SCALE-Sim과 estimator가 비교적 잘 맞습니다. 현재 타일 정책은 외부 시뮬레이터 기준에서도 큰 괴리 없이 동작하는 편입니다.";
  const lines = [
    "## 2-2. 예측 결과와 실제 실행 결과 비교",
    "| 항목 | TileForge estimator | SCALE-Sim 실제 실행 | 차이 | 해석 |",
    "|---|---:|---:|---:|---|",
    `| 전체 cycle | ${predictedTotal.toLocaleString()} | ${hasActual ? actualTotal!.toLocaleString() : "대기 중"} | ${hasActual ? `${absDelta! >= 0 ? "+" : ""}${absDelta!.toLocaleString()} (${formatPctDelta(actualTotal!, predictedTotal)})` : "대기 중"} | ${hasActual ? `SCALE-Sim / estimator = ${ratio!.toFixed(3)}배` : "full-pipeline 완료 후 갱신"} |`,
    `| 정확도 등급 | - | - | ${hasActual ? `${grade.label} (${grade.description})` : "대기 중"} | ${hasActual && grade.label === "poor" ? "현재 workload에서는 활성 estimator 재학습 또는 guard 확인이 필요합니다." : "-"} |`,
    "",
    `- 분석: ${verdict}`,
    "- 주의: IREE compile 성공은 `generated.mlir`의 컴파일 가능성을 검증하는 단계입니다. 실제 성능 비교의 cycle 기준은 SCALE-Sim 결과를 사용합니다.",
  ];
  if (hasActual && scale?.layers?.length) {
    lines.push(
      "",
      "### SCALE-Sim layer별 cycle 상위 항목",
      "| 순위 | SCALE-Sim layer | cycle | 비중 |",
      "|---:|---|---:|---:|",
    );
    const total = actualTotal!;
    for (const [index, layer] of [...scale.layers]
      .sort((a, b) => b.cycles - a.cycles)
      .slice(0, 8)
      .entries()) {
      lines.push(`| ${index + 1} | ${layer.name} | ${layer.cycles.toLocaleString()} | ${((layer.cycles / total) * 100).toFixed(1)}% |`);
    }
    lines.push(
      "",
      "### TileForge op별 예측 cycle 상위 항목",
      "| 순위 | 연산 | 예측 cycle | 비중 |",
      "|---:|---|---:|---:|",
    );
    for (const [index, item] of [...res.results]
      .sort((a, b) => b.best.cycles - a.best.cycles)
      .slice(0, 8)
      .entries()) {
      lines.push(`| ${index + 1} | ${item.shape.model}.${item.shape.opName} | ${item.best.cycles.toLocaleString()} | ${((item.best.cycles / predictedTotal) * 100).toFixed(1)}% |`);
    }
    lines.push(
      "",
      "### Full-layer op별 SCALE-Sim 비교",
      "| 연산 | TileForge cycle | SCALE-Sim layer cycle | 차이 | 판정 |",
      "|---|---:|---:|---:|---|",
    );
    for (const item of [...res.results].sort((a, b) => b.best.cycles - a.best.cycles)) {
      const layer = matchScaleLayerForResult(item, scale.layers || []);
      const pred = Number(item.best.cycles) || 0;
      const actual = Number(layer?.cycles) || 0;
      const err = actual > 0 && pred > 0 ? ((actual - pred) / pred) * 100 : undefined;
      const opGrade = accuracyGradeFromRatio(actual > 0 && pred > 0 ? actual / pred : undefined);
      lines.push(`| ${item.shape.model}.${item.shape.opName} | ${pred.toLocaleString()} | ${actual > 0 ? actual.toLocaleString() : "매칭 실패"} | ${err !== undefined ? `${err >= 0 ? "+" : ""}${err.toFixed(1)}%` : "-"} | ${opGrade.label} |`);
    }
    if (hasActual && grade.label === "poor") {
      lines.push("", "- 경고: 전체 cycle 오차가 30%를 초과합니다. 이 실행에서 Roofline/energy 절대값과 learned ranking은 preliminary 결과로 해석하세요.");
    }
    if (scale.candidateLayers?.length) {
      lines.push(
        "",
        "### SCALE-Sim micro-run 참고 진단: 정확도 평가용 아님",
        "| 연산 | rank | tile | TileForge tile-policy cycle | SCALE-Sim micro-run cycle | naive tile-count 외삽 | SCALE-Sim util | 해석 |",
        "|---|---:|---|---:|---:|---:|---:|---|",
      );
      for (const layer of scale.candidateLayers.slice(0, 12)) {
        const predicted = layer.predictedCycles ?? 0;
        const raw = layer.scaleSimRawCycles ?? layer.cycles;
        const extrapolated = layer.tileExtrapolatedCycles;
        const interpretation = extrapolated && predicted > 0
          ? "micro-run 외삽값입니다. full-layer 검증/학습 target으로 직접 쓰지 않습니다."
          : "같은 후보의 micro-run 값입니다.";
        lines.push(`| ${layer.opName ?? layer.name} | ${layer.rank ?? "-"} | ${layer.tileM}x${layer.tileN}x${layer.tileK} | ${predicted.toLocaleString()} | ${Math.round(raw).toLocaleString()} | ${extrapolated ? Math.round(extrapolated).toLocaleString() : "-"} | ${layer.overallUtil !== undefined ? `${layer.overallUtil.toFixed(1)}%` : "해당 없음"} | ${interpretation} |`);
      }
      lines.push("", "- 주의: 위 top-k 표는 tile 후보별 micro-run 진단입니다. 전체 cycle 정확도 판정은 full-layer SCALE-Sim layer 비교를 우선합니다.");
    }
  }
  lines.push("");
  return lines.join("\n");
}

function externalAppliedQuickMarkdown(
  res: ReturnType<typeof estimateAll>,
  scale?: ExternalRunSummary,
  iree?: ExternalRunSummary,
): string {
  const scaleApplied = Boolean(scale?.ok && scale.computeReport && (scale.totalCycles ?? 0) > 0);
  const ireeApplied = Boolean(iree?.ok && iree.vmfb && (iree.vmfbBytes ?? 0) > 0);
  const ratio = scale?.cycleRatio !== undefined ? scale.cycleRatio.toFixed(3) : "해당 없음";
  const verdict = scaleApplied && ireeApplied ? "성공" : scaleApplied || ireeApplied ? "부분 반영" : "대기/실패";
  return [
    "## 2-1. 실제 외부 도구 반영 상태",
    `**최종 판정: ${verdict}**`,
    "",
    `- **TileForge estimator**: 적용됨`,
    `  - 근거: 전체 예상 cycle ${res.summary.totalCycles.toLocaleString()}`,
    `- **SCALE-Sim**: ${scaleApplied ? "적용됨" : "미반영"}`,
    `  - 근거: ${scaleApplied ? `COMPUTE_REPORT.csv 파싱 완료, cycle ${scale?.totalCycles?.toLocaleString()}, estimator 대비 ${ratio}배` : (scale?.error ?? "실행 결과 없음")}`,
    `- **IREE compile**: ${ireeApplied ? "컴파일 가능성 확인" : "미반영"}`,
    `  - 근거: ${ireeApplied ? `model.vmfb 생성 완료, ${iree?.vmfbBytes?.toLocaleString()} bytes. runtime 성능 검증은 별도 benchmark 필요` : (iree?.error ?? "실행 결과 없음")}`,
    `- **외부 검증 갱신**: 적용됨`,
    `  - 근거: ${new Date().toISOString()}에 full-pipeline 결과로 report.md를 다시 썼습니다.`,
    `- **해석**: ${scaleApplied && ireeApplied ? "SCALE-Sim + IREE 결과가 이 보고서에 반영되었습니다." : "외부 도구 결과가 일부 또는 전부 누락되었습니다."}`,
    "",
    externalComparisonMarkdown(res, scale),
  ].join("\n");
}

function externalReportMarkdown(
  res: ReturnType<typeof estimateAll>,
  scale?: ExternalRunSummary,
  iree?: ExternalRunSummary,
): string {
  const scaleRatio = scale?.cycleRatio !== undefined ? `${scale.cycleRatio.toFixed(4)}배` : "해당 없음";
  const scaleApplied = Boolean(scale?.ok && scale.computeReport);
  const ireeApplied = Boolean(iree?.ok && iree.vmfb && (iree.vmfbBytes ?? 0) > 0);
  const overallApplied = scaleApplied && ireeApplied;
  return ([
    "# 실제 외부 도구 검증 보고서",
    "",
    `생성 시각: ${new Date().toISOString()}`,
    "",
    "## 0. 적용 여부 한눈에 보기",
    `- 최종 판정: ${overallApplied ? "실제 SCALE-Sim + IREE 결과가 보고서에 반영됨" : "일부 외부 도구 결과가 반영되지 않음"}`,
    `- SCALE-Sim 반영: ${scaleApplied ? `예 (${scale?.computeReport})` : "아니오"}`,
    `- IREE compile 반영: ${ireeApplied ? `예 (${iree?.vmfb}, ${iree?.vmfbBytes?.toLocaleString()} bytes)` : "아니오"}`,
    `- 보고서에서 확인할 위치: report.md의 "2-1. 실제 외부 도구 반영 상태"와 이 파일의 "SCALE-Sim 실제 실행 결과", "IREE 실제 compile 결과"`,
    `- 원본 산출물: ${scale?.computeReport ?? "COMPUTE_REPORT 없음"}, ${iree?.vmfb ?? "VMFB 없음"}`,
    "",
    "## 1. TileForge estimator 기준값",
    `- 전체 예상 cycle: ${res.summary.totalCycles.toLocaleString()}`,
    `- 전체 예상 시간: ${res.summary.totalTimeUs.toFixed(3)} us`,
    "",
    "## 2. SCALE-Sim 실제 실행 결과",
    `- 상태: ${scale?.ok ? "성공" : scale ? "실패" : "실행 안 함"}`,
    `- 사용 명령: ${scale?.command ?? "해당 없음"}`,
    `- COMPUTE_REPORT: ${scale?.computeReport ?? "해당 없음"}`,
    `- layer 수: ${scale?.layerCount ?? "해당 없음"}`,
    `- SCALE-Sim 전체 cycle: ${scale?.totalCycles?.toLocaleString() ?? "해당 없음"}`,
    `- SCALE-Sim / TileForge cycle 비율: ${scaleRatio}`,
    scale?.error ? `- 오류: ${scale.error}` : "",
    "",
    "## 3. IREE 실제 compile 결과",
    `- 상태: ${iree?.ok ? "성공" : iree ? "실패" : "실행 안 함"}`,
    `- 사용 명령: ${iree?.command ?? "해당 없음"}`,
    `- VMFB: ${iree?.vmfb ?? "해당 없음"}`,
    `- VMFB 크기: ${iree?.vmfbBytes?.toLocaleString() ?? "해당 없음"} bytes`,
    iree?.error ? `- 오류: ${iree.error}` : "",
    "",
    "## 4. 예측 결과와 실제 실행 결과 비교",
    `- TileForge estimator 전체 cycle: ${res.summary.totalCycles.toLocaleString()}`,
    `- SCALE-Sim 전체 cycle: ${scale?.totalCycles?.toLocaleString() ?? "해당 없음"}`,
    `- 절대 차이: ${scale?.totalCycles !== undefined ? `${scale.totalCycles - res.summary.totalCycles >= 0 ? "+" : ""}${(scale.totalCycles - res.summary.totalCycles).toLocaleString()}` : "해당 없음"}`,
    `- 상대 차이: ${scale?.totalCycles !== undefined ? formatPctDelta(scale.totalCycles, res.summary.totalCycles) : "해당 없음"}`,
    `- SCALE-Sim / TileForge 비율: ${scaleRatio}`,
    "- 해석: 비율이 1보다 크면 SCALE-Sim이 estimator보다 더 많은 pipeline, 경계, 메모리 비용을 반영한 것입니다. 비율이 1보다 작으면 estimator가 padding/타일 비용을 더 보수적으로 잡았거나 SCALE-Sim topology가 단순하게 해석된 것입니다.",
    "",
    "## 5. 어떻게 해석하면 되는가",
    "- `SCALE-Sim 반영: 예`이면 `COMPUTE_REPORT.csv`에서 파싱한 cycle이 이 검증 보고서에 들어온 것입니다.",
    "- `IREE compile 반영: 예`이고 VMFB 크기가 0보다 크면 `generated.mlir`이 실제 IREE compiler를 통과해 `model.vmfb`를 만든 것입니다.",
    "- 두 항목이 모두 `예`이면 estimator 단독 결과가 아니라, SCALE-Sim cycle과 IREE compile 산출물까지 같이 남은 실행으로 보면 됩니다.",
    "- 단, IREE compile 성공은 실행 성능 측정이 아니라 컴파일 가능성 검증입니다. 실제 런타임 성능은 별도 benchmark가 필요합니다.",
  ].filter(Boolean).join("\n") + "\n");
}

function validationSamplesFromScale(res: ReturnType<typeof estimateAll>, scale?: ExternalRunSummary): ValidationSample[] {
  if (!scale?.ok || !Array.isArray(scale.layers)) return [];
  return res.results.map((item) => {
    const layer = matchScaleLayerForResult(item, scale.layers || []);
    return {
      model: item.shape.model,
      opName: item.shape.opName,
      predictedCycles: item.best.fullLayerRawCycles ?? item.best.rawCycles ?? item.best.cycles,
      calibratedCycles: item.best.fullLayerCycles ?? item.best.cycles,
      scaleSimCycles: layer?.cycles,
    };
  }).filter((row) => row.scaleSimCycles && row.scaleSimCycles > 0);
}

export async function appendExternalReport(
  job: JobRecord,
  res: ReturnType<typeof estimateAll>,
  scale?: ExternalRunSummary,
  iree?: ExternalRunSummary,
) {
  const dir = jobDir(job.id);
  const report = externalReportMarkdown(res, scale, iree);
  await atomicWriteFile(path.join(dir, "external_validation_report.md"), report);
  let baseReport = "";
  try {
    baseReport = await readFile(path.join(dir, "report.md"), "utf8");
  } catch {
    baseReport = res.artifacts.reportMarkdown;
  }
  const marker = "\n---\n\n# 실제 외부 도구 검증 보고서\n";
  const baseWithoutExternal = baseReport.includes(marker)
    ? baseReport.slice(0, baseReport.indexOf(marker))
    : baseReport.trimEnd();
  const quick = externalAppliedQuickMarkdown(res, scale, iree).trimEnd();
  const quickPattern = /## 2-1\. 실제 외부 도구 반영 상태\n[\s\S]*?(?=\n## 3\. 최적 타일 정책)/;
  const withQuick = quickPattern.test(baseWithoutExternal)
    ? baseWithoutExternal.replace(quickPattern, quick + "\n")
    : baseWithoutExternal.replace(/\n## 3\. 최적 타일 정책/, `\n${quick}\n## 3. 최적 타일 정책`);
  await atomicWriteFile(path.join(dir, "report.md"), `${withQuick.trimEnd()}${marker}${report.replace(/^# 실제 외부 도구 검증 보고서\n+/, "")}`);
  const externalValidated = Boolean((scale?.ok && (scale.totalCycles ?? 0) > 0) && (iree?.ok && (iree.vmfbBytes ?? 0) > 0));
  const confidence = assessConfidence(res, {
    externalValidated,
    estimatorSuiteSamples: (res as any).estimatorSuite?.applied ? (res as any).estimatorSuite.modelSamples ?? 0 : 0,
    externalCycleRatio: scale?.cycleRatio,
  });
  await atomicWriteFile(path.join(dir, "confidence.md"), confidenceMarkdown(confidence));
  const validationSamples = validationSamplesFromScale(res, scale);
  const evidence = buildValidationEvidenceBundle(res, scale, { jobId: job.id });
  await atomicWriteFile(path.join(dir, "validation_evidence.json"), validationEvidenceJson(evidence));
  await atomicWriteFile(path.join(dir, "validation_evidence.md"), validationEvidenceMarkdown(evidence));
  const feedbackCsv = estimatorSuiteFeedbackCsv(evidence);
  const feedbackFullLayerCsv = estimatorSuiteFeedbackCsvForScope(evidence, "full-layer");
  const feedbackTilePolicyCsv = estimatorSuiteFeedbackCsvForScope(evidence, "tile-policy");
  const feedbackPolicy = buildValidationFeedbackPolicyReport(evidence);
  await atomicWriteFile(path.join(dir, "validation_feedback_policy.json"), validationFeedbackPolicyJson(feedbackPolicy));
  await atomicWriteFile(path.join(dir, "validation_feedback_policy.md"), validationFeedbackPolicyMarkdown(feedbackPolicy));
  if (feedbackCsv.trim()) {
    await atomicWriteFile(path.join(dir, "estimator_suite_feedback.csv"), feedbackCsv);
  }
  if (feedbackFullLayerCsv.trim()) {
    await atomicWriteFile(path.join(dir, "estimator_suite_feedback_full_layer.csv"), feedbackFullLayerCsv);
  }
  if (feedbackTilePolicyCsv.trim()) {
    await atomicWriteFile(path.join(dir, "estimator_suite_feedback_tile_policy.csv"), feedbackTilePolicyCsv);
  }
  if (validationSamples.length) {
    const validation = buildValidationReport(res, validationSamples);
    await atomicWriteFile(path.join(dir, "validation_report.md"), validation.markdown);
    await atomicWriteFile(path.join(dir, "validation_report.csv"), validation.csv);
  }
  job.artifacts = [
    ...new Set([
      ...(job.artifacts ?? []),
      "external_validation_report.md",
      "report.md",
      "confidence.md",
      "validation_evidence.json",
      "validation_evidence.md",
      "validation_feedback_policy.json",
      "validation_feedback_policy.md",
      ...(feedbackCsv.trim() ? ["estimator_suite_feedback.csv"] : []),
      ...(feedbackFullLayerCsv.trim() ? ["estimator_suite_feedback_full_layer.csv"] : []),
      ...(feedbackTilePolicyCsv.trim() ? ["estimator_suite_feedback_tile_policy.csv"] : []),
      ...(validationSamples.length ? ["validation_report.md", "validation_report.csv"] : []),
    ]),
  ];
  await saveJob(job);
}
