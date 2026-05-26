import type { LearnedEstimatorSample } from "./learnedEstimator";

export type EstimatorSuiteTrainingTargetScope = "auto" | "full-layer" | "tile-policy" | "all";

export const ESTIMATOR_SUITE_TRAINING_POLICY_SCHEMA = "tileforge.estimator-suite-training-policy.v1" as const;

export interface EstimatorSuiteTrainingPolicyResult {
  schema: typeof ESTIMATOR_SUITE_TRAINING_POLICY_SCHEMA;
  generatedAt: string;
  requestedScope: EstimatorSuiteTrainingTargetScope;
  effectiveScope: "full-layer" | "tile-policy" | "mixed" | "all";
  inputSamples: number;
  selectedSamples: number;
  excludedSamples: number;
  countsByScope: Record<string, number>;
  selectedCountsByScope: Record<string, number>;
  warnings: string[];
  samples: LearnedEstimatorSample[];
}

function normalizeScope(scope: unknown): "full-layer" | "tile-policy" | "mixed" {
  if (scope === "full-layer" || scope === "tile-policy") return scope;
  return "mixed";
}

function countScopes(samples: LearnedEstimatorSample[]) {
  const counts: Record<string, number> = {};
  for (const sample of samples) {
    const scope = normalizeScope(sample.targetScope);
    counts[scope] = (counts[scope] ?? 0) + 1;
  }
  return counts;
}

function selectedCounts(samples: LearnedEstimatorSample[]) {
  return countScopes(samples);
}

function parseRequestedScope(raw: unknown): EstimatorSuiteTrainingTargetScope {
  const v = String(raw ?? "auto").trim().toLowerCase();
  if (["full", "full_layer", "full-layer", "layer", "hardware", "hardware-design"].includes(v)) return "full-layer";
  if (["tile", "tile_policy", "tile-policy", "ranking", "candidate"].includes(v)) return "tile-policy";
  if (["all", "mixed", "unsafe-all"].includes(v)) return "all";
  return "auto";
}

export function normalizeEstimatorSuiteTrainingTargetScope(raw: unknown): EstimatorSuiteTrainingTargetScope {
  return parseRequestedScope(raw);
}

export function applyEstimatorSuiteTrainingPolicy(
  samples: LearnedEstimatorSample[],
  options: { targetScope?: EstimatorSuiteTrainingTargetScope | string } = {},
): EstimatorSuiteTrainingPolicyResult {
  const requestedScope = parseRequestedScope(options.targetScope);
  const countsByScope = countScopes(samples);
  const fullLayer = samples.filter((s) => normalizeScope(s.targetScope) === "full-layer");
  const tilePolicy = samples.filter((s) => normalizeScope(s.targetScope) === "tile-policy");
  const mixed = samples.filter((s) => normalizeScope(s.targetScope) === "mixed");
  const warnings: string[] = [];
  let selected = samples;
  let effectiveScope: EstimatorSuiteTrainingPolicyResult["effectiveScope"] = "all";

  if (requestedScope === "all") {
    selected = samples;
    effectiveScope = "all";
    if (fullLayer.length && tilePolicy.length) {
      warnings.push("full-layer와 tile-policy sample을 함께 학습합니다. 이 모드는 진단/실험용이며 기본 하드웨어 설계 모델에는 권장하지 않습니다.");
    }
  } else if (requestedScope === "full-layer") {
    if (fullLayer.length) {
      selected = fullLayer;
      effectiveScope = "full-layer";
    } else if (mixed.length && !tilePolicy.length) {
      selected = mixed;
      effectiveScope = "mixed";
      warnings.push("명시적 full-layer row가 없어 legacy mixed row로 학습합니다. 가능하면 validation_evidence 기반 full-layer feedback CSV를 사용하세요.");
    } else {
      selected = [];
      effectiveScope = "full-layer";
      warnings.push("full-layer target row가 없어 학습할 수 없습니다. estimator_suite_feedback_full_layer.csv를 사용하거나 targetScope를 확인하세요.");
    }
  } else if (requestedScope === "tile-policy") {
    if (tilePolicy.length) {
      selected = tilePolicy;
      effectiveScope = "tile-policy";
    } else if (mixed.length && !fullLayer.length) {
      selected = mixed;
      effectiveScope = "mixed";
      warnings.push("명시적 tile-policy row가 없어 legacy mixed row로 학습합니다. 가능하면 tile-policy diagnostic CSV를 분리해서 사용하세요.");
    } else {
      selected = [];
      effectiveScope = "tile-policy";
      warnings.push("tile-policy target row가 없어 학습할 수 없습니다. ranking diagnostic CSV 또는 targetScope를 확인하세요.");
    }
  } else {
    // auto mode: prefer explicit full-layer design targets, because TileForge's
    // primary trained estimator is used to calibrate hardware-design cycles.
    if (fullLayer.length) {
      selected = fullLayer;
      effectiveScope = "full-layer";
      if (tilePolicy.length) warnings.push(`tile-policy diagnostic row ${tilePolicy.length.toLocaleString()}개를 자동 제외했습니다. full-layer 모델과 ranking diagnostic을 섞지 않기 위한 기본 동작입니다.`);
      if (mixed.length) warnings.push(`legacy mixed row ${mixed.length.toLocaleString()}개를 자동 제외했습니다. 명시적 full-layer evidence가 있으므로 scoped target만 사용합니다.`);
    } else if (tilePolicy.length && !mixed.length) {
      selected = tilePolicy;
      effectiveScope = "tile-policy";
      warnings.push("full-layer target이 없고 tile-policy diagnostic만 있어 tile-policy 모델로 학습합니다. 이 모델을 hardware-design cycle 보정에 사용하지 마세요.");
    } else if (mixed.length && !tilePolicy.length) {
      selected = mixed;
      effectiveScope = "mixed";
      warnings.push("targetScope가 없는 legacy mixed dataset입니다. 새 검증 데이터는 full-layer/tile-policy scope를 명시하세요.");
    } else if (tilePolicy.length && mixed.length) {
      selected = tilePolicy;
      effectiveScope = "tile-policy";
      warnings.push("full-layer target이 없고 tile-policy/mixed row가 섞여 있어 tile-policy row만 선택했습니다. mixed row는 제외했습니다.");
    } else {
      selected = [];
      effectiveScope = "full-layer";
      warnings.push("학습 가능한 target row가 없습니다.");
    }
  }

  if (selected.length < samples.length) {
    warnings.push(`scope policy로 ${samples.length - selected.length}개 sample을 제외했습니다.`);
  }
  if (selected.length > 0 && selected.length < 40) {
    warnings.push(`선택된 sample이 ${selected.length.toLocaleString()}개입니다. Estimator Suite 학습에는 최소 40개가 필요합니다.`);
  }

  return {
    schema: ESTIMATOR_SUITE_TRAINING_POLICY_SCHEMA,
    generatedAt: new Date().toISOString(),
    requestedScope,
    effectiveScope,
    inputSamples: samples.length,
    selectedSamples: selected.length,
    excludedSamples: samples.length - selected.length,
    countsByScope,
    selectedCountsByScope: selectedCounts(selected),
    warnings,
    samples: selected,
  };
}

export function estimatorSuiteTrainingPolicyJson(result: EstimatorSuiteTrainingPolicyResult): string {
  const { samples: _samples, ...safe } = result;
  return JSON.stringify(safe, null, 2);
}

export function estimatorSuiteTrainingPolicyMarkdown(result: EstimatorSuiteTrainingPolicyResult): string {
  const lines: string[] = [];
  lines.push("# Estimator Suite Training Policy", "");
  lines.push("이 파일은 입력 dataset에서 어떤 target scope가 실제 학습에 사용되었는지 기록합니다. full-layer 설계 target과 tile-policy ranking diagnostic을 조용히 섞지 않기 위한 safety gate입니다.", "");
  lines.push("## Summary", "");
  lines.push("| item | value |", "|---|---:|");
  lines.push(`| requested scope | ${result.requestedScope} |`);
  lines.push(`| effective scope | ${result.effectiveScope} |`);
  lines.push(`| input samples | ${result.inputSamples.toLocaleString()} |`);
  lines.push(`| selected samples | ${result.selectedSamples.toLocaleString()} |`);
  lines.push(`| excluded samples | ${result.excludedSamples.toLocaleString()} |`);
  lines.push("", "## Input scope distribution", "");
  lines.push("| scope | samples |", "|---|---:|");
  for (const [scope, count] of Object.entries(result.countsByScope).sort()) lines.push(`| ${scope} | ${count.toLocaleString()} |`);
  lines.push("", "## Selected scope distribution", "");
  lines.push("| scope | samples |", "|---|---:|");
  for (const [scope, count] of Object.entries(result.selectedCountsByScope).sort()) lines.push(`| ${scope} | ${count.toLocaleString()} |`);
  lines.push("", "## Warnings", "");
  if (result.warnings.length) for (const warning of result.warnings) lines.push(`- ${warning}`);
  else lines.push("없음");
  lines.push("", "## Rules", "");
  lines.push("- 기본 `auto` 모드는 명시적 full-layer row가 있으면 full-layer만 사용합니다.");
  lines.push("- tile-policy row는 ranking/regret 진단용이며 hardware-design full-layer cycle 보정에 섞지 않습니다.");
  lines.push("- legacy mixed row는 과거 CSV 호환용입니다. 새 검증 데이터는 `targetScope`와 `evidenceReliability`를 포함하세요.");
  return lines.join("\n");
}
