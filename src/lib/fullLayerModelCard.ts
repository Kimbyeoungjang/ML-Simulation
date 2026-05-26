import type { SearchResponse } from "@/types/domain";

export const FULL_LAYER_MODEL_SCHEMA = "tileforge.full-layer-model-card.v1" as const;

export const SPILL_CALIBRATION = {
  osMTailScale: 2.95,
  osLongReductionScale: 640,
  isMTailScale: 23.3,
  isProjectionLikeMultiplier: 1.95,
  wsFilterSpillScale: 2.28,
} as const;

export const FULL_LAYER_MODEL_PROVENANCE = {
  schema: FULL_LAYER_MODEL_SCHEMA,
  modelName: "TileForge full-layer systolic analytical model",
  target: "hardware-design full-layer cycle estimate",
  nonGoals: [
    "cycle-accurate TPU simulation",
    "IREE runtime performance prediction",
    "tile-policy candidate micro-run target",
  ],
  primaryEquations: {
    WS: "ceil(K / arrayRows) * ceil(N / arrayCols) * (M + 2*arrayRows + arrayCols - 3)",
    OS: "ceil(M / arrayRows) * ceil(N / arrayCols) * (K + arrayRows + arrayCols - 2)",
    IS: "ceil(K / arrayRows) * ceil(M / arrayCols) * (N + 2*arrayRows + arrayCols - 3)",
  },
  spillCalibration: SPILL_CALIBRATION,
  calibrationScope: [
    "SCALE-Sim-like full-layer GEMM/topology comparisons",
    "systolic arrays represented by rectangular arrayRows x arrayCols",
    "GEMM/Conv2D-lowered workloads where A/B/C operand working sets are meaningful",
  ],
  outOfScopeWarnings: [
    "unvalidated model families or extreme aspect ratios",
    "very small shapes that significantly under-fill the array",
    "large SRAM spill/refill regions where external simulator behavior dominates",
    "IREE runtime scheduling/vectorization effects",
    "hardware features not represented in HardwareConfig, such as multicast topology, NoC contention, prefetch policy, bank conflicts, and compiler-specific fusion",
  ],
  interpretationRules: [
    "Use fullLayerCycles for hardware-design comparison, not for tile candidate micro-run ranking.",
    "Use tilePolicyCycles/score for tiling strategy ranking, not as final layer latency.",
    "Promote a result to design guidance only after purpose_gate.md allows it or external validation supports it.",
    "Treat compiler_hints as benchmark candidates until IREE runtime A-B results show a stable win.",
  ],
} as const;

function formatNumber(value: number | undefined): string {
  return Number.isFinite(value) ? Math.round(Number(value)).toLocaleString() : "n/a";
}

export function fullLayerModelCardJson(res?: SearchResponse): string {
  const worst = res?.results
    ?.flatMap((r) => [r.best])
    .sort((a, b) => (a.predictionConfidence ?? 1) - (b.predictionConfidence ?? 1))[0];
  return JSON.stringify(
    {
      ...FULL_LAYER_MODEL_PROVENANCE,
      generatedAt: new Date().toISOString(),
      runSummary: res
        ? {
            opCount: res.results.length,
            totalCycles: res.summary.totalCycles,
            minPredictionConfidence: res.summary.minPredictionConfidence ?? null,
            maxTileScratchBytes: res.summary.maxTileScratchBytes ?? res.summary.maxSramBytes,
            maxFullLayerWorkingSetBytes: res.summary.maxFullLayerSramBytes ?? null,
            lowestConfidenceOp: worst
              ? {
                  model: worst.model,
                  opName: worst.opName,
                  confidence: worst.predictionConfidence ?? null,
                  notes: worst.predictionNotes ?? [],
                }
              : null,
          }
        : null,
    },
    null,
    2,
  );
}

export function fullLayerModelCardMarkdown(res?: SearchResponse): string {
  const lines: string[] = [];
  lines.push("# Full-layer Model Card", "");
  lines.push("이 파일은 TileForge의 하드웨어 설계용 full-layer cycle 예측 모델이 무엇을 의미하고, 어디까지 믿을 수 있는지 기록합니다.", "");
  lines.push("## Target", "");
  lines.push("- 목적: 하드웨어 설계 비교용 full-layer cycle estimate");
  lines.push("- 비목적: cycle-accurate TPU simulator, IREE runtime predictor, tile-policy micro-run target");
  lines.push("- 해석 규칙: `fullLayerCycles`는 하드웨어 설계 비교에, `tilePolicyCycles`는 타일 후보 ranking에 사용합니다.", "");
  lines.push("## Primary equations", "");
  lines.push("| dataflow | equation |", "|---|---|");
  for (const [dataflow, equation] of Object.entries(FULL_LAYER_MODEL_PROVENANCE.primaryEquations)) {
    lines.push(`| ${dataflow} | \`${equation}\` |`);
  }
  lines.push("", "## Spill calibration constants", "");
  lines.push("| key | value | activates when |", "|---|---:|---|");
  lines.push(`| osMTailScale | ${SPILL_CALIBRATION.osMTailScale} | OS buffer spill with M tail |`);
  lines.push(`| osLongReductionScale | ${SPILL_CALIBRATION.osLongReductionScale} | OS long K reduction spill region |`);
  lines.push(`| isMTailScale | ${SPILL_CALIBRATION.isMTailScale} | IS buffer spill with M tail |`);
  lines.push(`| isProjectionLikeMultiplier | ${SPILL_CALIBRATION.isProjectionLikeMultiplier} | IS projection-like spill region |`);
  lines.push(`| wsFilterSpillScale | ${SPILL_CALIBRATION.wsFilterSpillScale} | WS spilled filter-dominated region |`);
  lines.push("", "이 상수들은 full-layer 외부 검증과 맞추기 위한 보수적 heuristic입니다. 새로운 workload family나 극단적인 SRAM/bandwidth 조건에서는 SCALE-Sim 검증을 우선해야 합니다.", "");
  if (res) {
    lines.push("## This run", "");
    lines.push(`- op 수: ${res.results.length}`);
    lines.push(`- total full-layer cycles: ${formatNumber(res.summary.totalCycles)}`);
    lines.push(`- min prediction confidence: ${((res.summary.minPredictionConfidence ?? 1) * 100).toFixed(1)}%`);
    lines.push(`- max tile scratch bytes: ${formatNumber(res.summary.maxTileScratchBytes ?? res.summary.maxSramBytes)}`);
    lines.push(`- max full-layer working-set bytes: ${formatNumber(res.summary.maxFullLayerSramBytes)}`);
    const risky = [...res.results]
      .map((r) => r.best)
      .sort((a, b) => (a.predictionConfidence ?? 1) - (b.predictionConfidence ?? 1))
      .slice(0, 5);
    if (risky.length) {
      lines.push("", "### Lowest-confidence ops", "", "| op | confidence | notes |", "|---|---:|---|");
      for (const item of risky) {
        lines.push(`| ${item.model}.${item.opName} | ${(((item.predictionConfidence ?? 1) * 100)).toFixed(1)}% | ${(item.predictionNotes ?? item.warnings ?? []).slice(0, 3).join("; ") || "-"} |`);
      }
    }
    lines.push("");
  }
  lines.push("## Out-of-scope warnings", "");
  for (const warning of FULL_LAYER_MODEL_PROVENANCE.outOfScopeWarnings) lines.push(`- ${warning}`);
  lines.push("", "## Required promotion path", "");
  lines.push("1. 빠른 estimate로 후보를 줄입니다.");
  lines.push("2. `purpose_gate.md`에서 hardware-design / tiling-strategy 상태를 확인합니다.");
  lines.push("3. SCALE-Sim full-layer 결과가 있으면 ratio와 op별 비교를 확인합니다.");
  lines.push("4. IREE hint는 runtime A-B benchmark 전까지 기본 옵션으로 승격하지 않습니다.");
  return lines.join("\n");
}
