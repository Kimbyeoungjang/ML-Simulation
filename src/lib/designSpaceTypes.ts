export type DesignMetric = "speedup" | "throughput" | "score";

export interface DesignSweepRow {
  axis: string;
  label: string;
  x: number;
  value: number;
  /** Total cycles for the evaluated point. For workload scaling axes this is not directly comparable with baseline. */
  totalCycles: number;
  /** Work-normalized speedup: (ops/cycle at this point) / (baseline ops/cycle). */
  speedup: number;
  /** Raw total-cycle speedup, useful only when workload ops are unchanged. */
  cycleSpeedup: number;
  /** Workload size relative to the baseline request. */
  workScale: number;
  /** Estimated throughput in TOPS. */
  throughput: number;
  meanUtilization: number;
  maxSramKiB: number;
  /** Hardware cost proxy. Workload-only sweeps keep this at 1. */
  cost: number;
  /** Cost-aware sweet-spot score. */
  score: number;
  /** Cross-metric consensus score: high only when speedup, throughput, and score overlap on the same point. */
  agreementScore: number;
  /** Return-on-investment score that penalizes expensive hardware/workload expansion after consensus is computed. */
  roiScore: number;
  /** Final recommendation score used for sweet-spot ranking. Blends consensus quality with ROI. */
  recommendationScore: number;
  /** Estimated one-sigma-ish relative error used for risk-aware ranking. */
  uncertaintyPct: number;
  /** Conservative speedup lower bound. Useful when two candidates overlap within uncertainty. */
  riskAdjustedSpeedup: number;
  /** Recommendation score penalized by uncertainty. */
  riskAdjustedRecommendationScore: number;
  /** Active-learning priority: high means this point is valuable to validate with SCALE-Sim next. */
  validationPriority: number;
  /** SRAM overflow ratio relative to configured SRAM capacity. */
  sramOverflowRatio: number;
  /** Minimum estimator-suite domain confidence for this sweep point. Analytical-only runs use 1. */
  predictionConfidence: number;
  /** True when learned predictions were damped because the sweep point is outside the training domain. */
  outOfDomain: boolean;
  /** Marginal normalized-speedup gained per extra cost/work unit from the previous sweep point on the same axis. */
  marginalEfficiency: number;
  /** True when this point is the first point on the axis where marginal returns clearly flatten. */
  isKnee: boolean;
  isBase?: boolean;
}

export interface ValidationPlanRow {
  rank: number;
  row: DesignSweepRow;
  selectionScore: number;
  rationale: string;
}
