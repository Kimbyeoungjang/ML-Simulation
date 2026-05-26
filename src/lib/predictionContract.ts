import type { SearchResponse } from "@/types/domain";

export interface PredictionContract {
  schema: "tileforge.prediction-contract.v2";
  generatedAt: string;
  purpose: string[];
  primaryFlow: string[];
  metrics: {
    hardwareDesign: string;
    tilingStrategy: string;
    compilerOptions: string;
    validation: string;
  };
  semanticFields: Record<string, string>;
  summary: {
    fullLayerCycles: number;
    tilePolicyCycles: number;
    maxTileScratchBytes: number;
    maxFullLayerWorkingSetBytes: number;
    minPredictionConfidence: number;
  };
  guardrails: string[];
  recommendedValidation: string[];
  artifactMap: Record<string, string>;
}

export function buildPredictionContract(res: SearchResponse): PredictionContract {
  const bests = res.results.map(r => r.best);
  const totalTilePolicyCycles = res.summary.totalTilePolicyCycles
    ?? bests.reduce((sum, b) => sum + Math.max(1, b.tilePolicyCycles ?? b.cycles), 0);
  const maxTileScratchBytes = res.summary.maxTileScratchBytes
    ?? Math.max(...bests.map(b => b.tileScratchBytes ?? b.sramBytes), 0);
  const maxFullLayerWorkingSetBytes = res.summary.maxFullLayerSramBytes
    ?? Math.max(...bests.map(b => b.fullLayerSramBytes ?? b.sramBytes), 0);
  const minPredictionConfidence = res.summary.minPredictionConfidence
    ?? Math.min(...bests.map(b => b.predictionConfidence ?? 1), 1);

  return {
    schema: "tileforge.prediction-contract.v2",
    generatedAt: new Date().toISOString(),
    purpose: [
      "fast hardware design estimate",
      "tile-policy selection for matmul/linalg lowering",
      "IREE compiler optimization hint generation",
    ],
    primaryFlow: [
      "estimate full-layer hardware cycles",
      "rank feasible tile candidates with tile-policy score",
      "emit compiler lowering hints as benchmark candidates",
      "validate high-impact or low-confidence cases with SCALE-Sim and IREE runtime",
    ],
    metrics: {
      hardwareDesign: "summary.totalCycles and best.fullLayerCycles",
      tilingStrategy: "best.tilePolicyCycles, best.score, Pareto set, utilization, padding, tileScratchBytes",
      compilerOptions: "compiler_hints.json/md, iree_benchmark_plan.json/md, transform.mlir sketches",
      validation: "SCALE-Sim cycles for cycle calibration; IREE runtime benchmark for compiler option acceptance",
    },
    semanticFields: {
      "best.cycles": "Representative full-layer hardware-design cycles after calibration, kept for legacy UI compatibility.",
      "best.fullLayerCycles": "Whole-layer systolic estimate. Use for hardware array/SRAM/BW/dataflow comparison.",
      "best.tilePolicyCycles": "Candidate-ranking estimate. Use for tile strategy and IREE lowering candidates, not for final layer latency.",
      "best.sramBytes": "Tile-local scratch footprint. Use this for tile SRAM fit checks.",
      "best.tileScratchBytes": "Explicit alias for tile-local scratch footprint.",
      "best.fullLayerSramBytes": "Full-layer A/B/C working set. Use for refill/spill sensitivity and DRAM traffic discussion, not direct tile fit.",
      "best.predictionConfidence": "Confidence in the full-layer analytical/learned estimate. Low confidence means validate before trusting the design point.",
      "compiler_hints.*": "IREE lowering suggestions. They are benchmark candidates, not guaranteed-fast final flags.",
    },
    summary: {
      fullLayerCycles: res.summary.totalCycles,
      tilePolicyCycles: totalTilePolicyCycles,
      maxTileScratchBytes,
      maxFullLayerWorkingSetBytes,
      minPredictionConfidence,
    },
    guardrails: [
      "full-layer cycle is not the same quantity as tile-policy cycle.",
      "Do not compare tile-policy cycles directly against SCALE-Sim full topology cycles.",
      "Do not treat IREE compile success as runtime performance validation.",
      "Use tileScratchBytes/sramBytes for SRAM fit; use fullLayerSramBytes for spill/refill sensitivity.",
      "Medium/high risk compiler hints require A-B runtime benchmark before becoming default options.",
      "Estimator Suite correction should only be trusted inside its domain-confidence envelope.",
    ],
    recommendedValidation: [
      "Run SCALE-Sim on the bottleneck op and every op with predictionConfidence < 0.75.",
      "Run IREE baseline compile and lowering-hint compile separately; compare runtime, not only vmfb creation.",
      "Add measured SCALE-Sim cycles back into the Estimator Suite only with targetScope='full-layer'.",
      "Keep tile-policy samples separate from full-layer validation samples to avoid learning mixed semantics.",
    ],
    artifactMap: {
      "report.md": "Human-readable summary with metric semantics and risks.",
      "best_tile_policy.csv": "Per-op selected tile policy; includes full-layer and tile-policy cycles.",
      "hardware_design_plan.md/json": "Design-space guidance for array, SRAM, bandwidth and dataflow decisions.",
      "tiling_strategy.md/json": "Per-op tile selection rationale and alternative benchmark candidates.",
      "compiler_hints.md/json": "IREE lowering hint bundle.",
      "iree_benchmark_plan.md/json": "Concrete baseline vs hinted benchmark matrix.",
      "prediction_contract.json": "Machine-readable semantics for every prediction target.",
      "validation_report.csv/md": "SCALE-Sim-backed cycle validation when available.",
    },
  };
}
