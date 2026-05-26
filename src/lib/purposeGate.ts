import type { ConfidenceAssessment } from "./confidence";
import type { SearchResponse } from "@/types/domain";
import type { IreeRuntimeDecision } from "./ireeRuntimeEvidence";
import type { PredictionRiskRegister } from "./predictionRiskRegister";

export interface PurposeGateScaleSimLayer {
  name: string;
  opName?: string;
  shapeId?: string;
  rank?: number;
  tileM?: number;
  tileN?: number;
  tileK?: number;
  cycles: number;
}

export interface PurposeGateExternalSummary {
  ok: boolean;
  skipped: boolean;
  tool: "scalesim" | "iree";
  triedCommands: string[];
  error?: string;
  totalCycles?: number;
  cycleRatio?: number;
  vmfbBytes?: number;
  candidateLayers?: PurposeGateScaleSimLayer[];
}

export type PurposeGateStatus =
  | "ready"
  | "needs-benchmark"
  | "validate-first"
  | "blocked";
export type PurposeGateArea =
  | "hardware-design"
  | "tiling-strategy"
  | "iree-options";

export interface PurposeGateDecision {
  area: PurposeGateArea;
  status: PurposeGateStatus;
  score: number;
  reasons: string[];
  nextActions: string[];
}

export interface PurposeGateReport {
  generatedAt: string;
  contract: {
    hardwareDesignMetric: "full-layer-cycles";
    tilingStrategyMetric: "tile-policy-ranking";
    ireeMetric: "runtime-a-b-benchmark";
  };
  summary: {
    totalCycles: number;
    totalTilePolicyCycles?: number;
    meanUtilization: number;
    meanPaddingRatio: number;
    minPredictionConfidence?: number;
    scaleSimCycleRatio?: number;
    ireeCompileOk?: boolean;
    ireeRuntimeStatus?: IreeRuntimeDecision["status"];
    ireeRuntimeMedianSpeedup?: number;
    ireeRuntimeCorrectness?: IreeRuntimeDecision["summary"]["correctness"];
    maxPredictionRisk?: number;
    highRiskOps?: number;
  };
  decisions: PurposeGateDecision[];
}

function clamp01(x: number) {
  return Math.max(0, Math.min(1, Number.isFinite(x) ? x : 0));
}

function scaleSimRatioError(scaleSim?: PurposeGateExternalSummary) {
  const ratio = Number(scaleSim?.cycleRatio);
  if (!scaleSim?.ok || !Number.isFinite(ratio) || ratio <= 0) return undefined;
  return Math.abs(ratio - 1);
}

function minPredictionConfidence(response: SearchResponse) {
  const values = response.results
    .map((r) => Number(r.best.predictionConfidence))
    .filter((x) => Number.isFinite(x));
  if (!values.length) return undefined;
  return Math.min(...values);
}

function candidateGroups(layers: PurposeGateScaleSimLayer[] | undefined) {
  const groups = new Map<string, PurposeGateScaleSimLayer[]>();
  for (const layer of layers ?? []) {
    const key = layer.shapeId || layer.opName || layer.name;
    if (!key) continue;
    const arr = groups.get(key) ?? [];
    arr.push(layer);
    groups.set(key, arr);
  }
  return [...groups.values()].filter((group) => group.length >= 2);
}

function selectedTileRegret(group: PurposeGateScaleSimLayer[]) {
  const withCycles = group.filter(
    (x) => Number.isFinite(x.cycles) && x.cycles > 0,
  );
  if (withCycles.length < 2) return undefined;
  const selected = withCycles.find((x) => x.rank === 1) ?? withCycles[0];
  const best = withCycles.reduce((a, b) => (b.cycles < a.cycles ? b : a));
  return selected.cycles / Math.max(1, best.cycles);
}

function evaluateTilingRegret(scaleSim?: PurposeGateExternalSummary) {
  const regrets = candidateGroups(scaleSim?.candidateLayers)
    .map(selectedTileRegret)
    .filter((x): x is number => Number.isFinite(x));
  if (!regrets.length) return undefined;
  regrets.sort((a, b) => a - b);
  const median = regrets[Math.floor(regrets.length / 2)] ?? regrets[0];
  const worst = Math.max(...regrets);
  return { median, worst, groups: regrets.length };
}

function decision(
  area: PurposeGateArea,
  status: PurposeGateStatus,
  score: number,
  reasons: string[],
  nextActions: string[],
): PurposeGateDecision {
  return { area, status, score: clamp01(score), reasons, nextActions };
}

export function evaluatePurposeGate(
  response: SearchResponse,
  opts: {
    confidence: ConfidenceAssessment;
    scaleSim?: PurposeGateExternalSummary;
    iree?: PurposeGateExternalSummary;
    ireeRuntime?: IreeRuntimeDecision;
    riskRegister?: PredictionRiskRegister;
    generatedAt?: string;
  },
): PurposeGateReport {
  const ratioError = scaleSimRatioError(opts.scaleSim);
  const minConf = minPredictionConfidence(response);
  const tilingRegret = evaluateTilingRegret(opts.scaleSim);
  const decisions: PurposeGateDecision[] = [];

  const hardwareReasons: string[] = [];
  const hardwareActions: string[] = [];
  let hardwareScore = opts.confidence.score;
  if (minConf != null) hardwareScore = Math.min(hardwareScore, minConf);
  if (opts.scaleSim?.ok && ratioError != null) {
    hardwareReasons.push(
      `SCALE-Sim/full-layer cycle ratio=${opts.scaleSim.cycleRatio?.toFixed(3)}.`,
    );
    hardwareScore +=
      ratioError <= 0.15 ? 0.14 : ratioError <= 0.35 ? 0.02 : -0.24;
  } else if (opts.scaleSim && !opts.scaleSim.ok) {
    hardwareReasons.push(
      "SCALE-Sim 실행이 실패해 hardware-design 승격을 막았습니다.",
    );
    hardwareScore -= 0.35;
  } else {
    hardwareReasons.push("아직 SCALE-Sim full-layer 검증이 없습니다.");
    hardwareScore -= 0.16;
    hardwareActions.push(
      "full-pipeline 또는 scalesim job으로 full-layer cycle ratio를 먼저 확인하세요.",
    );
  }
  if ((response.summary.meanUtilization ?? 0) < 0.5) {
    hardwareReasons.push(
      `평균 PE 사용률이 낮습니다 (${(response.summary.meanUtilization * 100).toFixed(1)}%).`,
    );
    hardwareScore -= 0.08;
  }
  if ((response.summary.meanPaddingRatio ?? 0) > 0.35) {
    hardwareReasons.push(
      `평균 padding 비율이 높습니다 (${(response.summary.meanPaddingRatio * 100).toFixed(1)}%).`,
    );
    hardwareScore -= 0.08;
  }
  if (minConf != null && minConf < 0.55) {
    hardwareReasons.push(
      `최저 op prediction confidence가 낮습니다 (${(minConf * 100).toFixed(1)}%).`,
    );
    hardwareActions.push(
      "낮은 confidence op를 SCALE-Sim 표본에 추가하고 Estimator Suite를 재학습하세요.",
    );
  }
  const maxRisk = opts.riskRegister?.summary.maxRiskScore;
  const highRiskOps = opts.riskRegister?.summary.highRiskOps ?? 0;
  if (maxRisk != null && Number.isFinite(maxRisk) && maxRisk >= 0.66) {
    hardwareReasons.push(
      `prediction risk register에서 high-risk op ${highRiskOps}개, max risk ${(maxRisk * 100).toFixed(0)}%가 발견되었습니다.`,
    );
    hardwareScore -= Math.min(0.18, 0.08 + highRiskOps * 0.03);
    hardwareActions.push(
      "prediction_risk_register.md의 recommended SCALE-Sim validation samples부터 검증하세요.",
    );
  }
  let hardwareStatus: PurposeGateStatus = "needs-benchmark";
  if (opts.scaleSim && !opts.scaleSim.ok) hardwareStatus = "blocked";
  else if (ratioError != null && ratioError <= 0.2 && hardwareScore >= 0.72 && !(maxRisk != null && maxRisk >= 0.78))
    hardwareStatus = "ready";
  else if (hardwareScore < 0.45 || (ratioError != null && ratioError > 0.35))
    hardwareStatus = "validate-first";
  if (!hardwareActions.length)
    hardwareActions.push(
      hardwareStatus === "ready"
        ? "인접 array/SRAM/bandwidth sweep을 진행해 sweet spot 안정성을 확인하세요."
        : "SCALE-Sim ratio가 안정될 때까지 representative workload를 더 검증하세요.",
    );
  decisions.push(
    decision(
      "hardware-design",
      hardwareStatus,
      hardwareScore,
      hardwareReasons,
      hardwareActions,
    ),
  );

  const tilingReasons: string[] = [];
  const tilingActions: string[] = [];
  let tilingScore = opts.confidence.score;
  if (tilingRegret) {
    tilingReasons.push(
      `SCALE-Sim top-k tile 후보 median regret=${tilingRegret.median.toFixed(3)}, worst=${tilingRegret.worst.toFixed(3)} (${tilingRegret.groups} groups).`,
    );
    tilingScore +=
      tilingRegret.median <= 1.05
        ? 0.16
        : tilingRegret.median <= 1.15
          ? 0.04
          : -0.22;
  } else {
    tilingReasons.push(
      "아직 top-k tile 후보를 SCALE-Sim으로 비교한 증거가 없습니다.",
    );
    tilingScore -= 0.14;
    tilingActions.push(
      "topology_top3.csv 기반 SCALE-Sim top-k 비교를 실행해 rank-1 후보의 regret을 확인하세요.",
    );
  }
  const highPaddingOps = response.results.filter(
    (r) => r.best.paddingRatio > 0.35,
  ).length;
  if (highPaddingOps) {
    tilingReasons.push(
      `${highPaddingOps}개 op에서 padding이 높아 rank가 shape boundary에 민감할 수 있습니다.`,
    );
    tilingScore -= Math.min(0.16, highPaddingOps * 0.04);
    tilingActions.push("tile 후보에 M/N/K 약수 기반 후보를 추가하세요.");
  }
  let tilingStatus: PurposeGateStatus = "needs-benchmark";
  if (tilingRegret && tilingRegret.median <= 1.08 && tilingScore >= 0.68)
    tilingStatus = "ready";
  else if (tilingScore < 0.44 || (tilingRegret && tilingRegret.median > 1.2))
    tilingStatus = "validate-first";
  if (!tilingActions.length)
    tilingActions.push(
      tilingStatus === "ready"
        ? "선택 tile을 compiler_hints와 함께 IREE runtime 후보로 넘기세요."
        : "tile-policy score를 그대로 확정하지 말고 top-k 후보를 benchmark하세요.",
    );
  decisions.push(
    decision(
      "tiling-strategy",
      tilingStatus,
      tilingScore,
      tilingReasons,
      tilingActions,
    ),
  );

  const ireeReasons: string[] = [];
  const ireeActions: string[] = [];
  let ireeScore = opts.confidence.score;
  let ireeStatus: PurposeGateStatus = "validate-first";
  if (opts.iree?.ok) {
    ireeReasons.push(
      `IREE baseline compile 성공, VMFB=${opts.iree.vmfbBytes?.toLocaleString() ?? "unknown"} bytes.`,
    );
    ireeScore += 0.08;
    ireeStatus = "needs-benchmark";
    ireeActions.push(
      "npm run benchmark:iree -- --artifact <job-dir> 로 baseline/hinted runtime A-B test를 실행하세요.",
    );
  } else if (opts.iree && !opts.iree.ok) {
    ireeReasons.push(
      "IREE compile 실패. compiler hint를 성능 후보로 사용할 수 없습니다.",
    );
    ireeScore -= 0.35;
    ireeStatus = "blocked";
    ireeActions.push(
      "generated.mlir와 iree_summary.json의 compiler error를 먼저 해결하세요.",
    );
  } else {
    ireeReasons.push("IREE compile 결과가 없습니다.");
    ireeScore -= 0.18;
    ireeActions.push(
      "iree-compile 또는 full-pipeline job으로 baseline compileability를 확인하세요.",
    );
  }

  const runtime = opts.ireeRuntime;
  if (runtime) {
    const speedupText = runtime.summary.medianSpeedup != null
      ? `${runtime.summary.medianSpeedup.toFixed(3)}x`
      : "해당 없음";
    ireeReasons.push(
      `IREE runtime decision=${runtime.status}, median speedup=${speedupText}, correctness=${runtime.summary.correctness}.`,
    );
    ireeActions.length = 0;
    if (runtime.status === "blocked") {
      ireeStatus = "blocked";
      ireeScore -= 0.42;
      ireeActions.push("runtime failure 또는 correctness mismatch를 먼저 해결하세요.");
    } else if (runtime.status === "regression") {
      ireeStatus = "validate-first";
      ireeScore -= 0.28;
      ireeActions.push("현재 transform hint는 승격하지 말고 baseline lowering을 유지하거나 다음 tile 후보를 benchmark하세요.");
    } else if (runtime.status === "needs-more-runs") {
      ireeStatus = "needs-benchmark";
      ireeScore -= 0.08;
      ireeActions.push("repetitions/warmup을 늘리고 parse 가능한 Google Benchmark real_time row를 확보하세요.");
    } else if (runtime.status === "keep-baseline") {
      ireeStatus = runtime.summary.correctness === "checked" ? "ready" : "needs-benchmark";
      ireeScore += runtime.summary.correctness === "checked" ? 0.1 : 0.02;
      ireeActions.push(
        runtime.summary.correctness === "checked"
          ? "현재 hint는 승격하지 말고 baseline IREE lowering을 기준 옵션으로 유지하세요."
          : "baseline 유지 판단 전에 correctness check를 추가하세요.",
      );
    } else if (runtime.status === "promote-candidate") {
      const correctnessChecked = runtime.summary.correctness === "checked";
      ireeStatus = correctnessChecked ? "ready" : "needs-benchmark";
      ireeScore += correctnessChecked ? 0.18 : 0.06;
      ireeActions.push(
        correctnessChecked
          ? "이 hint를 더 넓은 workload/backend matrix에서 승격 후보로 반복 검증하세요."
          : "speedup은 보이지만 correctness가 확인되지 않았으므로 승격 전 output 비교를 실행하세요.",
      );
    }
  }

  if (tilingStatus !== "ready") {
    ireeReasons.push(
      "타일링 전략이 아직 ready가 아니므로 compiler hint도 실험 후보 수준입니다.",
    );
    ireeScore -= 0.08;
    if (ireeStatus === "ready") ireeStatus = "needs-benchmark";
    else if (!runtime && opts.iree?.ok) ireeStatus = ireeStatus === "blocked" ? "blocked" : "needs-benchmark";
  }
  decisions.push(
    decision("iree-options", ireeStatus, ireeScore, ireeReasons, ireeActions),
  );

  return {
    generatedAt: opts.generatedAt ?? new Date().toISOString(),
    contract: {
      hardwareDesignMetric: "full-layer-cycles",
      tilingStrategyMetric: "tile-policy-ranking",
      ireeMetric: "runtime-a-b-benchmark",
    },
    summary: {
      totalCycles: response.summary.totalCycles,
      totalTilePolicyCycles: response.summary.totalTilePolicyCycles,
      meanUtilization: response.summary.meanUtilization,
      meanPaddingRatio: response.summary.meanPaddingRatio,
      minPredictionConfidence: minConf,
      scaleSimCycleRatio: opts.scaleSim?.cycleRatio,
      ireeCompileOk: opts.iree?.ok,
      ireeRuntimeStatus: opts.ireeRuntime?.status,
      ireeRuntimeMedianSpeedup: opts.ireeRuntime?.summary.medianSpeedup,
      ireeRuntimeCorrectness: opts.ireeRuntime?.summary.correctness,
      maxPredictionRisk: opts.riskRegister?.summary.maxRiskScore,
      highRiskOps: opts.riskRegister?.summary.highRiskOps,
    },
    decisions,
  };
}

function statusLabel(status: PurposeGateStatus) {
  if (status === "ready") return "ready";
  if (status === "needs-benchmark") return "benchmark 필요";
  if (status === "validate-first") return "검증 우선";
  return "차단";
}

export function purposeGateMarkdown(report: PurposeGateReport) {
  const lines = [
    "# Purpose Validation Gate",
    "",
    `Generated at: ${report.generatedAt}`,
    "",
    "이 파일은 estimate 결과를 세 목적에 바로 사용해도 되는지 구분합니다.",
    "",
    "| 목적 | 기준 지표 | 상태 | 점수 |",
    "|---|---:|---:|---:|",
  ];
  const metricName: Record<PurposeGateArea, string> = {
    "hardware-design": report.contract.hardwareDesignMetric,
    "tiling-strategy": report.contract.tilingStrategyMetric,
    "iree-options": report.contract.ireeMetric,
  };
  for (const item of report.decisions) {
    lines.push(
      `| ${item.area} | ${metricName[item.area]} | ${statusLabel(item.status)} | ${(item.score * 100).toFixed(0)}% |`,
    );
  }
  lines.push("", "## 세부 판단", "");
  for (const item of report.decisions) {
    lines.push(
      `### ${item.area}: ${statusLabel(item.status)} (${(item.score * 100).toFixed(0)}%)`,
      "",
    );
    lines.push("근거:");
    lines.push(...item.reasons.map((r) => `- ${r}`));
    lines.push("", "다음 행동:");
    lines.push(...item.nextActions.map((r) => `- ${r}`));
    lines.push("");
  }
  lines.push(
    "## 해석 원칙",
    "",
    "- hardware-design은 full-layer cycle과 SCALE-Sim ratio가 안정적일 때만 설계 판단으로 승격합니다.",
    "- tiling-strategy는 tile-policy rank가 top-k SCALE-Sim 비교에서 낮은 regret을 보일 때만 확정 후보로 봅니다.",
    "- IREE option은 compile 성공만으로는 충분하지 않으며 runtime A-B benchmark와 correctness check 전까지는 후보입니다.",
  );
  return lines.join("\n");
}
