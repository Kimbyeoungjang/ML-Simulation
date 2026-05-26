import type { LearnedEstimatorMetrics, LearnedEstimatorSample } from "./learnedEstimator";
import type { EstimatorSuiteModel } from "./estimatorSuiteTypes";

export type EstimatorSuiteReadinessLevel = "ready" | "caution" | "blocked";
export type EstimatorSuiteGateStatus = "pass" | "warn" | "fail";

export interface EstimatorSuiteReadinessGate {
  name: string;
  status: EstimatorSuiteGateStatus;
  message: string;
}

export interface EstimatorSuiteReadinessReport {
  level: EstimatorSuiteReadinessLevel;
  score: number;
  samples: number;
  minSamples: number;
  recommendedSamples: number;
  scope: string;
  scopeCounts: Record<string, number>;
  dataflows: Record<string, number>;
  arrays: Record<string, number>;
  workloads: Record<string, number>;
  measuredOverEstimator: {
    median: number;
    p90: number;
    max: number;
  };
  validation?: LearnedEstimatorMetrics;
  gates: EstimatorSuiteReadinessGate[];
  warnings: string[];
  actions: string[];
}

export interface EstimatorSuiteReadinessOptions {
  scope?: string;
  minSamples?: number;
  recommendedSamples?: number;
  requireExplicitScope?: boolean;
  requireMultipleArrays?: boolean;
  requireMultipleDataflows?: boolean;
  model?: EstimatorSuiteModel;
}

function inc(map: Record<string, number>, key: string) {
  const k = key.trim() || "unknown";
  map[k] = (map[k] ?? 0) + 1;
}

function percentile(xs: number[], p: number) {
  const clean = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!clean.length) return 0;
  return clean[Math.min(clean.length - 1, Math.max(0, Math.floor(clean.length * p)))];
}

function sampleRatio(sample: LearnedEstimatorSample) {
  const measured = Number(sample.measuredCycles);
  const predicted = Number(sample.estimatorCycles);
  if (!Number.isFinite(measured) || !Number.isFinite(predicted) || measured <= 0 || predicted <= 0) return NaN;
  return measured / predicted;
}

function addGate(gates: EstimatorSuiteReadinessGate[], gate: EstimatorSuiteReadinessGate) {
  gates.push(gate);
}

function gateScore(status: EstimatorSuiteGateStatus) {
  if (status === "pass") return 1;
  if (status === "warn") return 0.55;
  return 0;
}

function validationFromModel(model: EstimatorSuiteModel | undefined): LearnedEstimatorMetrics | undefined {
  if (!model) return undefined;
  return model.blend?.validation ?? model.validationSuite?.[0]?.ensemble;
}

export function assessEstimatorSuiteReadiness(
  samples: LearnedEstimatorSample[],
  options: EstimatorSuiteReadinessOptions = {},
): EstimatorSuiteReadinessReport {
  const minSamples = Math.max(1, Math.floor(options.minSamples ?? 40));
  const recommendedSamples = Math.max(minSamples, Math.floor(options.recommendedSamples ?? 160));
  const scope = options.scope ?? "merged";
  const scopeCounts: Record<string, number> = {};
  const dataflows: Record<string, number> = {};
  const arrays: Record<string, number> = {};
  const workloads: Record<string, number> = {};
  for (const sample of samples) {
    inc(scopeCounts, String(sample.targetScope ?? "mixed"));
    inc(dataflows, String(sample.dataflow ?? "unknown").toUpperCase());
    inc(arrays, `${Number(sample.arrayRows) || 0}x${Number(sample.arrayCols) || 0}`);
    inc(workloads, String(sample.model ?? sample.opName ?? "unknown"));
  }
  const ratios = samples.map(sampleRatio).filter(Number.isFinite);
  const ratioStats = {
    median: percentile(ratios, 0.5),
    p90: percentile(ratios, 0.9),
    max: ratios.length ? Math.max(...ratios) : 0,
  };
  const gates: EstimatorSuiteReadinessGate[] = [];
  addGate(gates, {
    name: "sample-count",
    status: samples.length >= recommendedSamples ? "pass" : samples.length >= minSamples ? "warn" : "fail",
    message:
      samples.length >= recommendedSamples
        ? `${samples.length.toLocaleString()} samples meet the deployment recommendation.`
        : samples.length >= minSamples
          ? `${samples.length.toLocaleString()} samples are trainable but below the ${recommendedSamples.toLocaleString()} sample deployment recommendation.`
          : `${samples.length.toLocaleString()} samples are below the ${minSamples.toLocaleString()} sample training minimum.`,
  });
  const explicit = samples.filter((s) => s.targetScope && s.targetScope !== "mixed").length;
  addGate(gates, {
    name: "target-scope-contract",
    status:
      samples.length === 0
        ? "fail"
        : explicit === samples.length
          ? "pass"
          : options.requireExplicitScope
            ? "fail"
            : "warn",
    message:
      explicit === samples.length
        ? "All samples declare full-layer or tile-policy target scope."
        : `${samples.length - explicit} sample(s) use legacy/mixed target scope; do not treat one validation number as universal.`,
  });
  const scopeKinds = Object.keys(scopeCounts).filter((k) => (scopeCounts[k] ?? 0) > 0);
  addGate(gates, {
    name: "scope-homogeneity",
    status: scopeKinds.length <= 1 || scope === "merged" ? "pass" : "fail",
    message:
      scopeKinds.length <= 1
        ? `Dataset scope is homogeneous: ${scopeKinds[0] ?? "none"}.`
        : `Dataset mixes target scopes (${scopeKinds.join(", ")}); split training by scope before deployment.`,
  });
  const arrayKinds = Object.keys(arrays).length;
  addGate(gates, {
    name: "hardware-coverage",
    status: arrayKinds >= 3 ? "pass" : arrayKinds >= 2 ? "warn" : options.requireMultipleArrays ? "fail" : "warn",
    message:
      arrayKinds >= 3
        ? `${arrayKinds} array shapes represented.`
        : arrayKinds >= 2
          ? `${arrayKinds} array shapes represented; enough for interpolation but weak for hardware search.`
          : `${arrayKinds} array shape represented; learned correction should be treated as local calibration only.`,
  });
  const dataflowKinds = Object.keys(dataflows).length;
  addGate(gates, {
    name: "dataflow-coverage",
    status: dataflowKinds >= 3 ? "pass" : dataflowKinds >= 2 ? "warn" : options.requireMultipleDataflows ? "fail" : "warn",
    message:
      dataflowKinds >= 3
        ? "WS/OS/IS style dataflow coverage is broad enough for comparative use."
        : dataflowKinds >= 2
          ? `${dataflowKinds} dataflows represented; cross-dataflow ranking remains uncertain.`
          : `${dataflowKinds} dataflow represented; do not use this model to compare dataflows.`,
  });
  const workloadKinds = Object.keys(workloads).length;
  addGate(gates, {
    name: "workload-diversity",
    status: workloadKinds >= 8 ? "pass" : workloadKinds >= 3 ? "warn" : "fail",
    message:
      workloadKinds >= 8
        ? `${workloadKinds} workload/model groups represented.`
        : workloadKinds >= 3
          ? `${workloadKinds} workload/model groups represented; generalization to new models is limited.`
          : `${workloadKinds} workload/model group represented; this is a calibration set, not a general estimator dataset.`,
  });
  const validation = validationFromModel(options.model);
  if (validation) {
    const improved = validation.learnedMapePct < validation.baselineMapePct * 0.98;
    const robust = validation.p90AbsPct <= 35;
    addGate(gates, {
      name: "heldout-error",
      status: improved && robust ? "pass" : improved ? "warn" : "fail",
      message: `Validation MAPE ${validation.learnedMapePct.toFixed(2)}% vs baseline ${validation.baselineMapePct.toFixed(2)}%, P90 ${validation.p90AbsPct.toFixed(2)}%.`,
    });
  } else {
    addGate(gates, {
      name: "heldout-error",
      status: "warn",
      message: "No trained model validation was provided; only dataset readiness was checked.",
    });
  }

  const rawScore = gates.reduce((sum, gate) => sum + gateScore(gate.status), 0) / Math.max(1, gates.length);
  const failCount = gates.filter((g) => g.status === "fail").length;
  const warnCount = gates.filter((g) => g.status === "warn").length;
  const level: EstimatorSuiteReadinessLevel = failCount > 0 ? "blocked" : warnCount > 1 || rawScore < 0.82 ? "caution" : "ready";
  const warnings = gates.filter((g) => g.status !== "pass").map((g) => `${g.name}: ${g.message}`);
  const actions: string[] = [];
  if ((scopeCounts.mixed ?? 0) > 0) actions.push("Add targetScope=full-layer or targetScope=tile-policy to every training row.");
  if (samples.length < recommendedSamples) actions.push(`Collect at least ${recommendedSamples.toLocaleString()} samples before using the model as a deployment default.`);
  if (arrayKinds < 3) actions.push("Add SCALE-Sim samples for at least three array shapes before using the model for hardware design ranking.");
  if (dataflowKinds < 3) actions.push("Add WS, OS, and IS coverage before using the model for dataflow comparison.");
  if (workloadKinds < 8) actions.push("Add workload diversity, especially shapes near the expected deployment models.");
  if (validation && validation.p90AbsPct > 35) actions.push("Keep analytical/full-layer estimate visible and require external validation for top candidates until P90 error improves.");

  return {
    level,
    score: Math.round(rawScore * 1000) / 1000,
    samples: samples.length,
    minSamples,
    recommendedSamples,
    scope,
    scopeCounts,
    dataflows,
    arrays,
    workloads,
    measuredOverEstimator: ratioStats,
    validation,
    gates,
    warnings,
    actions: Array.from(new Set(actions)),
  };
}

function compactMap(map: Record<string, number>) {
  const entries = Object.entries(map).sort((a, b) => b[1] - a[1]).slice(0, 8);
  return entries.length ? entries.map(([k, v]) => `${k}=${v}`).join(", ") : "none";
}

export function estimatorSuiteReadinessMarkdown(report: EstimatorSuiteReadinessReport) {
  return [
    `# Estimator Suite Readiness: ${report.scope}`,
    "",
    `- Level: **${report.level}**`,
    `- Score: ${(report.score * 100).toFixed(1)}%`,
    `- Samples: ${report.samples.toLocaleString()} / train min ${report.minSamples.toLocaleString()} / deployment recommendation ${report.recommendedSamples.toLocaleString()}`,
    `- Target scopes: ${compactMap(report.scopeCounts)}`,
    `- Arrays: ${compactMap(report.arrays)}`,
    `- Dataflows: ${compactMap(report.dataflows)}`,
    `- Workloads: ${compactMap(report.workloads)}`,
    `- Measured/estimator ratio: median ${report.measuredOverEstimator.median.toFixed(3)}, p90 ${report.measuredOverEstimator.p90.toFixed(3)}, max ${report.measuredOverEstimator.max.toFixed(3)}`,
    "",
    "## Gates",
    "",
    "| Gate | Status | Message |",
    "|---|---|---|",
    ...report.gates.map((gate) => `| ${gate.name} | ${gate.status} | ${gate.message} |`),
    "",
    report.actions.length
      ? ["## Required actions", "", ...report.actions.map((action) => `- ${action}`)].join("\n")
      : "## Required actions\n\nNone.",
  ].join("\n");
}
