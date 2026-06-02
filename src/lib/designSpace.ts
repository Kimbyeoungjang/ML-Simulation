import type {
  MatmulShape,
  SearchRequest,
  SearchResponse,
} from "@/types/domain";
import { estimateAll } from "./estimator";
import { applyEstimatorSuiteToSearchResponse } from "./estimatorSuiteApply";
import type { EstimatorSuiteModel } from "./estimatorSuite";
import { hashObject } from "./hash";

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

const HARDWARE_FACTORS = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]);
const MEMORY_FACTORS = Object.freeze([0.125, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4]);
const SHAPE_FACTORS = Object.freeze([0.5, 0.75, 1, 1.25, 1.5, 2]);

function refinedFactors(seed: readonly number[]) {
  const values = new Set<number>();
  const sorted = [...seed]
    .filter((v) => Number.isFinite(v) && v > 0)
    .sort((a, b) => a - b);
  for (let i = 0; i < sorted.length; i++) {
    values.add(sorted[i]);
    if (i + 1 < sorted.length) {
      // Geometric midpoints give better resolution around knees without
      // strongly biasing toward either the small or large side of a sweep.
      values.add(Math.sqrt(sorted[i] * sorted[i + 1]));
    }
  }
  return [...values].sort((a, b) => a - b);
}

const HARDWARE_SWEEP_FACTORS = Object.freeze(refinedFactors(HARDWARE_FACTORS));
const MEMORY_SWEEP_FACTORS = Object.freeze(refinedFactors(MEMORY_FACTORS));
const SHAPE_SWEEP_FACTORS = Object.freeze(refinedFactors(SHAPE_FACTORS));
const AXES = Object.freeze([
  "array",
  "frequency",
  "sram",
  "dram",
  "shape-m",
  "shape-n",
  "shape-k",
]);

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

export function niceNumber(v: number) {
  if (!Number.isFinite(v)) return "-";
  if (Math.abs(v) >= 1000) return Math.round(v).toLocaleString();
  if (Math.abs(v) >= 10) return v.toFixed(1);
  return v.toFixed(2);
}

function safeSvgText(text: string) {
  return String(text).replace(
    /[<>&]/g,
    (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c] || c,
  );
}

function workloadOps(shapes: MatmulShape[]) {
  return shapes.reduce(
    (sum, s) =>
      sum +
      2 *
        Math.max(1, Number(s.m || 1)) *
        Math.max(1, Number(s.n || 1)) *
        Math.max(1, Number(s.k || 1)),
    0,
  );
}

function scaledShape(
  shape: MatmulShape,
  axis: "m" | "n" | "k",
  factor: number,
): MatmulShape {
  if (Math.abs(factor - 1) < 1e-12) return shape;
  const next = { ...shape };
  next[axis] = Math.max(1, Math.round(Number(shape?.[axis] || 1) * factor));
  // Keep a stable, deterministic id for exported artifacts, but avoid mutating
  // the baseline shape when factor=1 so repeated baseline sweeps hit the cache.
  next.id = `${shape?.id || "shape"}_${axis}${factor}`;
  return next;
}

function responseKey(req: SearchRequest) {
  return hashObject({
    hardware: req.hardware,
    // Shape id is intentionally ignored here. Design-space sweeps disable artifacts,
    // and numerical estimates only depend on workload dimensions/metadata. This
    // lets equivalent baseline points across M/N/K axes reuse one cached estimate.
    shapes: req.shapes.map((s) => ({
      model: s.model,
      opName: s.opName,
      m: s.m,
      n: s.n,
      k: s.k,
      dtypeBytes: s.dtypeBytes,
    })),
    candidates: req.candidates,
    objective: req.objective,
    maxResultsPerOp: req.maxResultsPerOp,
    scaleSim: req.scaleSim,
  });
}

function axisCost(axis: string, factor: number) {
  if (axis === "array") return Math.max(0.01, factor * factor);
  if (axis === "frequency") return Math.max(0.01, Math.pow(factor, 1.35));
  if (axis === "dram") return Math.max(0.01, Math.pow(factor, 1.12));
  if (axis === "sram") return Math.max(0.01, Math.pow(factor, 0.86));
  return 1;
}

function roundFactor(value: number) {
  return Number(value.toFixed(6));
}

function scaleDramBandwidth(req: SearchRequest, factor: number): SearchRequest {
  const scaleSim = req.scaleSim ? { ...req.scaleSim } : undefined;
  const hw = { ...req.hardware };
  if (Number.isFinite(Number(scaleSim?.dramBandwidth)) && Number(scaleSim?.dramBandwidth) > 0) {
    scaleSim!.dramBandwidth = Math.max(0.001, Number(scaleSim!.dramBandwidth) * factor);
  } else if (Number.isFinite(Number(scaleSim?.bandwidth)) && Number(scaleSim?.bandwidth) > 0) {
    scaleSim!.bandwidth = Math.max(0.001, Number(scaleSim!.bandwidth) * factor);
  } else if (Number.isFinite(Number(hw.memoryBandwidthGBs)) && Number(hw.memoryBandwidthGBs) > 0) {
    hw.memoryBandwidthGBs = Math.max(0.001, Number(hw.memoryBandwidthGBs) * factor);
  } else {
    // Explicitly model a reasonable baseline only for the DRAM sweep. Keeping it
    // local to this axis avoids changing normal reports whose hardware preset
    // intentionally leaves off-chip bandwidth unset.
    hw.memoryBandwidthGBs = 100 * factor;
  }
  return { ...req, hardware: hw, scaleSim };
}

function dedupeAxisRows(rows: DesignSweepRow[]) {
  const byKey = new Map<string, DesignSweepRow>();
  for (const row of rows) {
    const key = `${row.axis}:${roundFactor(row.x)}`;
    const prev = byKey.get(key);
    // Keep the row with the higher confidence, then better recommendation. This
    // mainly removes duplicates caused by integer rounding on tiny arrays/SRAMs.
    if (
      !prev ||
      row.predictionConfidence > prev.predictionConfidence ||
      (row.predictionConfidence === prev.predictionConfidence &&
        compareDesignRows(row, prev) < 0)
    ) {
      byKey.set(key, row);
    }
  }
  return [...byKey.values()].sort(
    (a, b) => a.axis.localeCompare(b.axis) || a.x - b.x,
  );
}

function effectiveArrayFactor(
  baseRows: number,
  baseCols: number,
  rows: number,
  cols: number,
) {
  const baseArea = Math.max(1, baseRows * baseCols);
  return Math.sqrt(Math.max(1, rows * cols) / baseArea);
}

function effectiveShapeFactor(
  baseShapes: MatmulShape[],
  nextShapes: MatmulShape[],
  axis: "m" | "n" | "k",
) {
  let weightedBase = 0;
  let weightedNext = 0;
  for (let i = 0; i < baseShapes.length; i++) {
    const base = baseShapes[i];
    const next = nextShapes[i] || base;
    const weight = Math.max(
      1,
      Number(base.m || 1) * Number(base.n || 1) * Number(base.k || 1),
    );
    weightedBase += Math.max(1, Number(base[axis] || 1)) * weight;
    weightedNext += Math.max(1, Number(next[axis] || 1)) * weight;
  }
  return weightedNext / Math.max(1, weightedBase);
}

function metricMax(
  rows: DesignSweepRow[],
  axis: string,
  getter: (row: DesignSweepRow) => number,
) {
  return Math.max(
    1e-9,
    ...rows
      .filter((row) => row.axis === axis)
      .map(getter)
      .filter(Number.isFinite),
  );
}

function estimateDesignUncertaintyPct(
  row: Pick<
    DesignSweepRow,
    | "predictionConfidence"
    | "meanUtilization"
    | "sramOverflowRatio"
    | "cost"
    | "workScale"
    | "outOfDomain"
  >,
) {
  const confidence = Number.isFinite(row.predictionConfidence)
    ? clamp(row.predictionConfidence, 0.25, 1)
    : 1;
  const lowUtilPenalty =
    Math.max(0, 0.55 - clamp(row.meanUtilization, 0, 1)) * 22;
  const sramPenalty = Math.min(18, Math.max(0, row.sramOverflowRatio) * 14);
  const extrapolationPenalty = row.outOfDomain ? 8 : 0;
  const expansionPenalty = Math.min(
    10,
    Math.max(0, row.cost - 1) * 2 + Math.max(0, row.workScale - 1) * 3,
  );
  return clamp(
    5 +
      (1 - confidence) * 38 +
      lowUtilPenalty +
      sramPenalty +
      extrapolationPenalty +
      expansionPenalty,
    5,
    65,
  );
}

function attachRecommendationScores(rows: DesignSweepRow[]): DesignSweepRow[] {
  const firstPass = rows.map((row) => {
    const speed = row.speedup / metricMax(rows, row.axis, (r) => r.speedup);
    const tops =
      row.throughput / metricMax(rows, row.axis, (r) => r.throughput);
    const score = row.score / metricMax(rows, row.axis, (r) => r.score);
    const agreementScore = Math.min(speed, tops, score);
    const expansionPenalty =
      1 +
      0.35 * Math.max(0, row.cost - 1) +
      0.15 * Math.max(0, row.workScale - 1);
    const confidence = Number.isFinite(row.predictionConfidence)
      ? Math.max(0.25, Math.min(1, row.predictionConfidence))
      : 1;
    const confidencePenalty = 0.55 + 0.45 * confidence;
    const roiScore = (agreementScore / expansionPenalty) * confidencePenalty;
    // Consensus prevents single-metric winners; ROI prevents over-recommending
    // very expensive hardware points whose extra gain is already flattening.
    // When an active learned model reports low domain confidence, keep the
    // point visible but damp the final recommendation so extrapolated hardware
    // sweeps do not dominate trusted in-domain candidates.
    const recommendationScore =
      (0.68 * agreementScore + 0.32 * roiScore) * confidencePenalty;
    const uncertaintyPct = estimateDesignUncertaintyPct(row);
    const riskAdjustedSpeedup = row.speedup / (1 + uncertaintyPct / 100);
    const riskAdjustedRecommendationScore =
      recommendationScore * (1 - clamp(uncertaintyPct / 140, 0.04, 0.48));
    return {
      ...row,
      agreementScore,
      roiScore,
      recommendationScore,
      uncertaintyPct,
      riskAdjustedSpeedup,
      riskAdjustedRecommendationScore,
      validationPriority: 0,
      marginalEfficiency: 0,
      isKnee: false,
    };
  });

  const byAxis = new Map<string, DesignSweepRow[]>();
  for (const row of firstPass) {
    byAxis.set(row.axis, [...(byAxis.get(row.axis) || []), row]);
  }

  const enriched: DesignSweepRow[] = [];
  for (const [, axisRows] of byAxis) {
    const sorted = axisRows.slice().sort((a, b) => a.x - b.x);
    const margins = sorted.map((row, i) => {
      if (i === 0) return Number.POSITIVE_INFINITY;
      const prev = sorted[i - 1];
      const denom =
        row.cost !== prev.cost
          ? row.cost - prev.cost
          : row.workScale - prev.workScale;
      return denom > 1e-9 ? Math.max(0, row.speedup - prev.speedup) / denom : 0;
    });
    const finiteMargins = margins.filter(Number.isFinite).filter((v) => v > 0);
    const firstMargin = finiteMargins[0] || 0;
    let kneeIndex =
      firstMargin > 0
        ? margins.findIndex(
            (m, i) => i > 0 && Number.isFinite(m) && m <= firstMargin * 0.35,
          )
        : -1;
    if (kneeIndex < 0 && sorted.length >= 4) {
      // Fallback elbow detector: choose the interior point farthest above the
      // straight line from first to last in normalized cost/work vs speedup
      // space. This keeps the graph informative even when the marginal drop is
      // gradual rather than crossing a hard threshold.
      const effortOf = (row: DesignSweepRow) =>
        row.cost !== 1 ? row.cost : row.workScale;
      const effort = sorted.map(effortOf);
      const minEffort = Math.min(...effort);
      const maxEffort = Math.max(...effort);
      const minSpeed = Math.min(...sorted.map((r) => r.speedup));
      const maxSpeed = Math.max(...sorted.map((r) => r.speedup));
      let bestDistance = 0;
      for (let i = 1; i < sorted.length - 1; i++) {
        const x =
          (effort[i] - minEffort) / Math.max(1e-9, maxEffort - minEffort);
        const y =
          (sorted[i].speedup - minSpeed) / Math.max(1e-9, maxSpeed - minSpeed);
        const distance = y - x;
        if (distance > bestDistance) {
          bestDistance = distance;
          kneeIndex = i;
        }
      }
    }
    const bestRec = Math.max(1e-9, ...sorted.map((r) => r.recommendationScore));
    for (let i = 0; i < sorted.length; i++) {
      const row = sorted[i];
      const isKnee = i === kneeIndex;
      const uncertainty = clamp(row.uncertaintyPct / 65, 0, 1);
      const normalizedPotential = clamp(
        row.recommendationScore / bestRec,
        0,
        1,
      );
      const validationPriority = clamp(
        0.38 * uncertainty +
          0.28 * normalizedPotential +
          0.18 * Math.max(0, 1 - row.predictionConfidence) +
          0.1 * Math.min(1, row.sramOverflowRatio) +
          0.06 * (isKnee ? 1 : 0),
        0,
        1,
      );
      enriched.push({
        ...row,
        marginalEfficiency: margins[i],
        isKnee,
        validationPriority,
      });
    }
  }
  return enriched;
}

export function buildDesignSpaceRows(
  source: unknown,
  activeEstimatorSuite?: { model?: EstimatorSuiteModel | null } | null,
): DesignSweepRow[] {
  const req = (source as { request?: SearchRequest })?.request;
  if (!req?.hardware || !Array.isArray(req?.shapes) || !req.shapes.length)
    return [];

  const model = activeEstimatorSuite?.model ?? null;
  const evalCache = new Map<string, SearchResponse>();

  const evalReq = (nextReq: SearchRequest) => {
    const key = responseKey(nextReq);
    const hit = evalCache.get(key);
    if (hit) return hit;
    // Design-space graphs only need numerical summaries. Skipping artifact
    // generation removes MLIR/report/SCALE-Sim CSV work from every sweep point.
    const analytical = estimateAll(nextReq, { includeArtifacts: false });
    const estimated = applyEstimatorSuiteToSearchResponse(analytical, model);
    evalCache.set(key, estimated);
    return estimated;
  };

  // Always normalize speedup against the same prediction path used by the sweep.
  // If an Estimator Suite is active, the baseline must be suite-adjusted too;
  // otherwise the ×1 rows can drift away from speedup=1 and recommendation
  // scores become biased toward or against learned-model sweeps.
  const baseEstimated = evalReq(req);
  const baseCycles = Math.max(
    1,
    Number(baseEstimated.summary?.totalCycles) ||
      Number(
        (source as { summary?: { totalCycles?: number } })?.summary
          ?.totalCycles,
      ) ||
      1,
  );
  const baseOps = Math.max(1, workloadOps(req.shapes));
  const baseOpsPerCycle = baseOps / baseCycles;

  const makeRow = (
    axis: string,
    label: string,
    value: number,
    nextReq: SearchRequest,
  ): DesignSweepRow => {
    const estimated = evalReq(nextReq);
    const totalCycles = Math.max(
      1,
      Number(estimated.summary?.totalCycles) || 1,
    );
    const ops = Math.max(1, workloadOps(nextReq.shapes || []));
    const seconds =
      totalCycles /
      Math.max(1, Number(nextReq.hardware?.frequencyMHz || 1)) /
      1e6;
    const throughput = seconds > 0 ? ops / seconds / 1e12 : 0;
    const isBase = Math.abs(value - 1) < 1e-9;
    const cycleSpeedup = isBase ? 1 : baseCycles / totalCycles;
    const speedup = isBase ? 1 : ops / totalCycles / Math.max(1e-9, baseOpsPerCycle);
    const workScale = ops / baseOps;
    const cost = axisCost(axis, value);
    const costGrowth = Math.max(0, cost - 1);
    const sramOverflow =
      Math.max(
        0,
        Number(estimated.summary?.maxSramBytes || 0) -
          nextReq.hardware.sramKB * 1024,
      ) / Math.max(1, nextReq.hardware.sramKB * 1024);
    const utilization = Math.min(
      1,
      Math.max(0, Number(estimated.summary?.meanUtilization || 0)),
    );
    const suiteSummary = (
      estimated as {
        estimatorSuite?: { applied?: boolean; minDomainConfidence?: number };
      }
    ).estimatorSuite;
    const suiteAppliesToFullLayer = Boolean(
      suiteSummary?.applied &&
        (suiteSummary as { appliedToFullLayer?: boolean }).appliedToFullLayer,
    );
    const predictionConfidence = suiteAppliesToFullLayer
      ? Math.max(
          0.25,
          Math.min(1, Number(suiteSummary?.minDomainConfidence) || 0.25),
        )
      : 1;
    const rawScore = (() => {
      if (axis === "sram") {
        const capacityReward = Math.max(0, 1 - cost) * 0.22;
        const extraCapacityPenalty = Math.max(0, cost - 1) * 0.22;
        return speedup + utilization * 0.08 + capacityReward - extraCapacityPenalty - sramOverflow * 1.45;
      }
      if (axis === "dram") {
        return speedup / (1 + 0.28 * costGrowth) + utilization * 0.08 - sramOverflow * 0.25;
      }
      return speedup / (1 + 0.42 * costGrowth) + utilization * 0.08 - sramOverflow * 0.25;
    })();
    const score = Math.max(1e-9, rawScore);
    return {
      axis,
      label,
      x: value,
      value,
      totalCycles,
      speedup,
      cycleSpeedup,
      workScale,
      throughput,
      meanUtilization: utilization,
      maxSramKiB: Number(estimated.summary?.maxSramBytes || 0) / 1024,
      cost,
      score,
      sramOverflowRatio: sramOverflow,
      predictionConfidence,
      outOfDomain: predictionConfidence < 0.8,
      agreementScore: 0,
      roiScore: 0,
      recommendationScore: 0,
      uncertaintyPct: estimateDesignUncertaintyPct({
        predictionConfidence,
        meanUtilization: utilization,
        sramOverflowRatio: sramOverflow,
        cost,
        workScale,
        outOfDomain: predictionConfidence < 0.8,
      }),
      riskAdjustedSpeedup: speedup,
      riskAdjustedRecommendationScore: 0,
      validationPriority: 0,
      marginalEfficiency: 0,
      isKnee: false,
      isBase,
    };
  };

  const rows: DesignSweepRow[] = [];
  const hw = req.hardware;
  for (const f of HARDWARE_SWEEP_FACTORS) {
    const arrayHw = {
      ...hw,
      arrayRows: Math.max(1, Math.round(hw.arrayRows * f)),
      arrayCols: Math.max(1, Math.round(hw.arrayCols * f)),
    };
    const arrayFactor = roundFactor(
      effectiveArrayFactor(
        hw.arrayRows,
        hw.arrayCols,
        arrayHw.arrayRows,
        arrayHw.arrayCols,
      ),
    );
    rows.push(
      makeRow("array", `Array ×${niceNumber(arrayFactor)}`, arrayFactor, {
        ...req,
        hardware: arrayHw,
      }),
    );

    const frequencyHw = {
      ...hw,
      frequencyMHz: Math.max(1, Math.round(hw.frequencyMHz * f)),
    };
    const frequencyFactor = roundFactor(
      frequencyHw.frequencyMHz / Math.max(1, hw.frequencyMHz),
    );
    rows.push(
      makeRow(
        "frequency",
        `Freq ×${niceNumber(frequencyFactor)}`,
        frequencyFactor,
        { ...req, hardware: frequencyHw },
      ),
    );
  }

  for (const f of MEMORY_SWEEP_FACTORS) {
    const sramHw = { ...hw, sramKB: Math.max(1, Math.round(hw.sramKB * f)) };
    const sramFactor = roundFactor(sramHw.sramKB / Math.max(1, hw.sramKB));
    rows.push(
      makeRow("sram", `SRAM ×${niceNumber(sramFactor)}`, sramFactor, {
        ...req,
        hardware: sramHw,
      }),
    );

    const dramReq = scaleDramBandwidth(req, f);
    rows.push(
      makeRow("dram", `DRAM BW ×${niceNumber(roundFactor(f))}`, roundFactor(f), dramReq),
    );
  }

  for (const f of SHAPE_SWEEP_FACTORS) {
    for (const axis of ["m", "n", "k"] as const) {
      const shapes = req.shapes.map((s) => scaledShape(s, axis, f));
      const effectiveFactor = roundFactor(
        effectiveShapeFactor(req.shapes, shapes, axis),
      );
      rows.push(
        makeRow(
          `shape-${axis}`,
          `${axis.toUpperCase()} ×${niceNumber(effectiveFactor)}`,
          effectiveFactor,
          { ...req, shapes },
        ),
      );
    }
  }
  return attachRecommendationScores(dedupeAxisRows(rows));
}

export function bestDesignRowsByAxis(rows: DesignSweepRow[]) {
  return AXES.map(
    (axis) => rows.filter((r) => r.axis === axis).sort(compareDesignRows)[0],
  ).filter(Boolean) as DesignSweepRow[];
}

export function bestDesignRow(rows: DesignSweepRow[]) {
  return rows.slice().sort(compareDesignRows)[0];
}

export function bestRiskAdjustedDesignRow(rows: DesignSweepRow[]) {
  return rows
    .slice()
    .sort(
      (a, b) =>
        b.riskAdjustedRecommendationScore - a.riskAdjustedRecommendationScore ||
        compareDesignRows(a, b),
    )[0];
}

function validationSelectionScores(rows: DesignSweepRow[]) {
  const paretoSet = new Set(paretoDesignRows(rows));
  const nonBaseRows = rows.filter((row) => !row.isBase);
  const maxRiskRecommendation = Math.max(
    1e-9,
    ...nonBaseRows.map((row) => row.riskAdjustedRecommendationScore),
  );
  const maxRiskSpeedup = Math.max(
    1e-9,
    ...nonBaseRows.map((row) => row.riskAdjustedSpeedup),
  );

  const scores = new Map<DesignSweepRow, number>();
  for (const row of nonBaseRows) {
    // Active validation is most useful when a point is both uncertain and
    // plausibly valuable. Normalize all value-like terms to keep the selector
    // stable if future scoring changes make recommendationScore larger than 1.
    const normalizedRiskRecommendation = clamp(
      row.riskAdjustedRecommendationScore / maxRiskRecommendation,
      0,
      1,
    );
    const normalizedRiskSpeedup = clamp(
      row.riskAdjustedSpeedup / maxRiskSpeedup,
      0,
      1,
    );
    const score =
      0.54 * clamp(row.validationPriority, 0, 1) +
      0.2 * normalizedRiskRecommendation +
      0.08 * normalizedRiskSpeedup +
      0.08 * (paretoSet.has(row) ? 1 : 0) +
      0.06 * (row.isKnee ? 1 : 0) +
      0.04 * (row.outOfDomain ? 1 : 0);
    scores.set(row, clamp(score, 0, 1));
  }
  return scores;
}

function validationSelectionScore(
  row: DesignSweepRow,
  scores: ReadonlyMap<DesignSweepRow, number>,
) {
  return scores.get(row) || 0;
}

function isNearDuplicateValidationPoint(
  row: DesignSweepRow,
  selected: DesignSweepRow[],
) {
  return selected.some((prev) => {
    if (prev.axis !== row.axis) return false;
    const logDistance = Math.abs(
      Math.log(Math.max(1e-9, row.x) / Math.max(1e-9, prev.x)),
    );
    return logDistance < 0.08;
  });
}

export function validationDesignRows(rows: DesignSweepRow[], limit = 5) {
  const maxRows = Math.max(0, limit);
  if (maxRows === 0) return [];

  const scores = validationSelectionScores(rows);
  const candidates = rows
    .filter((row) => !row.isBase)
    .slice()
    .sort(
      (a, b) =>
        validationSelectionScore(b, scores) -
          validationSelectionScore(a, scores) || compareDesignRows(a, b),
    );

  const selected: DesignSweepRow[] = [];
  const selectedAxes = new Set<string>();

  // First pass: diversify across axes so the validation batch can identify
  // whether the dominant error source is array, memory, clock, or workload
  // scaling. This avoids spending the whole SCALE-Sim budget on near-duplicate
  // points from one axis.
  for (const row of candidates) {
    if (selected.length >= maxRows) break;
    if (selectedAxes.has(row.axis)) continue;
    selected.push(row);
    selectedAxes.add(row.axis);
  }

  // Second pass: fill remaining slots while avoiding rounded/geometrically
  // adjacent duplicates on the same axis when alternatives exist.
  for (const row of candidates) {
    if (selected.length >= maxRows) break;
    if (selected.includes(row)) continue;
    if (isNearDuplicateValidationPoint(row, selected)) continue;
    selected.push(row);
  }

  // Last resort: if the request has fewer unique axes than the limit, fill with
  // the best remaining rows even if they are close to an already selected point.
  for (const row of candidates) {
    if (selected.length >= maxRows) break;
    if (!selected.includes(row)) selected.push(row);
  }

  return selected;
}

function compareDesignRows(a: DesignSweepRow, b: DesignSweepRow) {
  return (
    b.recommendationScore - a.recommendationScore ||
    b.riskAdjustedRecommendationScore - a.riskAdjustedRecommendationScore ||
    b.agreementScore - a.agreementScore ||
    b.score - a.score ||
    b.speedup - a.speedup
  );
}

export function designAxisSummary(rows: DesignSweepRow[]) {
  return bestDesignRowsByAxis(rows).map((row) => ({
    axis: row.axis,
    label: row.label,
    recommendationScore: row.recommendationScore,
    agreementScore: row.agreementScore,
    roiScore: row.roiScore,
    predictionConfidence: row.predictionConfidence,
    outOfDomain: row.outOfDomain,
    marginalEfficiency: row.marginalEfficiency,
    isKnee: row.isKnee,
    uncertaintyPct: row.uncertaintyPct,
    riskAdjustedSpeedup: row.riskAdjustedSpeedup,
    riskAdjustedRecommendationScore: row.riskAdjustedRecommendationScore,
    validationPriority: row.validationPriority,
  }));
}

export function paretoDesignRows(rows: DesignSweepRow[]) {
  return rows.filter(
    (row) =>
      !rows.some(
        (other) =>
          other !== row &&
          other.speedup >= row.speedup &&
          other.throughput >= row.throughput &&
          other.score >= row.score &&
          other.cost <= row.cost &&
          (other.speedup > row.speedup ||
            other.throughput > row.throughput ||
            other.score > row.score ||
            other.cost < row.cost),
      ),
  );
}

function csvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function validationRationale(row: DesignSweepRow, selectionScore: number) {
  const reasons: string[] = [];
  if (selectionScore >= 0.7) reasons.push("high selection score");
  if (row.uncertaintyPct >= 20) reasons.push("high uncertainty");
  if (row.outOfDomain || row.predictionConfidence < 0.8)
    reasons.push("low domain confidence");
  if (row.isKnee) reasons.push("near marginal knee");
  if (row.sramOverflowRatio > 0) reasons.push("SRAM pressure");
  if (
    row.riskAdjustedRecommendationScore >
    0.75 * Math.max(1e-9, row.recommendationScore)
  )
    reasons.push("stable risk-adjusted value");
  if (row.meanUtilization < 0.55) reasons.push("low utilization regime");
  return reasons.length ? reasons.join("; ") : "diversity coverage";
}

export function validationPlanRows(
  rows: DesignSweepRow[],
  limit = 5,
): ValidationPlanRow[] {
  const selected = validationDesignRows(rows, limit);
  const scoreMap = validationSelectionScores(rows);
  return selected.map((row, index) => {
    const selectionScore = validationSelectionScore(row, scoreMap);
    return {
      rank: index + 1,
      row,
      selectionScore,
      rationale: validationRationale(row, selectionScore),
    };
  });
}

export interface ExpandedValidationPlanItem extends ValidationPlanRow {
  variant: "seed" | "neighbor";
}

export function expandedValidationPlanRows(
  rows: DesignSweepRow[],
  options: {
    seedLimit?: number;
    minSamples?: number;
    samplesPerRequest?: number;
    oversampleFactor?: number;
    neighborhoodRadius?: number;
    maxRequests?: number;
  } = {},
): ExpandedValidationPlanItem[] {
  const samplesPerRequest = Math.max(1, Math.floor(options.samplesPerRequest ?? 1));
  const targetRequests = Math.min(
    Math.max(1, options.maxRequests ?? Number.POSITIVE_INFINITY),
    Math.max(
      options.seedLimit ?? 5,
      Math.ceil(((options.minSamples ?? 40) / samplesPerRequest) * (options.oversampleFactor ?? 1)),
    ),
  );
  const seedLimit = Math.max(1, options.seedLimit ?? 5);
  const radius = Math.max(1, Math.floor(options.neighborhoodRadius ?? 3));
  const seeds = validationPlanRows(rows, seedLimit);
  const allRows = rows.filter((row) => !row.isBase).slice().sort(compareDesignRows);
  const scoreMap = validationSelectionScores(rows);
  const out: ExpandedValidationPlanItem[] = [];
  const seen = new Set<string>();
  const push = (row: DesignSweepRow, variant: ExpandedValidationPlanItem["variant"]) => {
    if (out.length >= targetRequests) return;
    const key = `${row.axis}:${roundFactor(row.x)}`;
    if (seen.has(key)) return;
    seen.add(key);
    const selectionScore = validationSelectionScore(row, scoreMap);
    out.push({
      rank: out.length + 1,
      row,
      variant,
      selectionScore,
      rationale: variant === "seed" ? validationRationale(row, selectionScore) : `neighbor of validation seed; ${validationRationale(row, selectionScore)}`,
    });
  };

  for (const seed of seeds) push(seed.row, "seed");

  for (const seed of seeds) {
    const sameAxis = allRows
      .filter((row) => row.axis === seed.row.axis && row !== seed.row)
      .sort((a, b) => Math.abs(Math.log(a.x / seed.row.x)) - Math.abs(Math.log(b.x / seed.row.x)));
    for (const row of sameAxis.slice(0, radius * 2)) push(row, "neighbor");
  }

  for (const row of allRows) push(row, out.length < seedLimit ? "seed" : "neighbor");

  // Very small design spaces can have fewer unique existing rows than the
  // training floor. In that case, create conservative synthetic neighbors by
  // nudging the best seed factors geometrically. requestForDesignSweepRow can
  // execute these rows because the axis/x contract is the only required input.
  let syntheticStep = 1;
  while (out.length < targetRequests && seeds.length) {
    for (const seed of seeds) {
      const sign = syntheticStep % 2 === 0 ? 1 : -1;
      const magnitude = Math.ceil(syntheticStep / 2);
      const factor = roundFactor(seed.row.x * Math.pow(1.08, sign * magnitude));
      push({ ...seed.row, x: factor, value: factor, label: `${seed.row.label} n${sign > 0 ? "+" : "-"}${magnitude}`, isBase: Math.abs(factor - 1) < 1e-9 }, "neighbor");
      if (out.length >= targetRequests) break;
    }
    syntheticStep++;
  }

  return out;
}

export function requestForDesignSweepRow(
  req: SearchRequest,
  row: Pick<DesignSweepRow, "axis" | "x" | "label">,
  options: { rank?: number; runNamePrefix?: string } = {},
): SearchRequest {
  const factor = Math.max(1e-9, Number(row.x) || 1);
  const hw = { ...req.hardware };
  let next: SearchRequest;
  if (row.axis === "array") {
    next = { ...req, hardware: { ...hw, arrayRows: Math.max(1, Math.round(hw.arrayRows * factor)), arrayCols: Math.max(1, Math.round(hw.arrayCols * factor)) } };
  } else if (row.axis === "frequency") {
    next = { ...req, hardware: { ...hw, frequencyMHz: Math.max(1, Math.round(hw.frequencyMHz * factor)) } };
  } else if (row.axis === "sram") {
    next = { ...req, hardware: { ...hw, sramKB: Math.max(1, Math.round(hw.sramKB * factor)) } };
  } else if (row.axis === "dram") {
    next = scaleDramBandwidth(req, factor);
  } else if (row.axis === "shape-m" || row.axis === "shape-n" || row.axis === "shape-k") {
    const axis = row.axis.slice("shape-".length) as "m" | "n" | "k";
    next = { ...req, shapes: req.shapes.map((shape) => scaledShape(shape, axis, factor)) };
  } else {
    next = { ...req };
  }
  const rank = String(Math.max(1, Math.floor(options.rank ?? 1))).padStart(2, "0");
  const safeAxis = row.axis.replace(/[^a-z0-9_-]+/gi, "_");
  const safeFactor = roundFactor(factor).toString().replace(/[^0-9a-z_-]+/gi, "p");
  const runName = `${options.runNamePrefix ?? "design_validation"}_${rank}_${safeAxis}_${safeFactor}`;
  return {
    ...next,
    hardware: { ...next.hardware, name: `${req.hardware.name} / ${row.label}` },
    scaleSim: { ...(next.scaleSim ?? {}), runName },
  };
}

export function exportValidationPlanJson(rows: DesignSweepRow[], limit = 5) {
  const plan = validationPlanRows(rows, limit).map((item) => ({
    rank: item.rank,
    axis: item.row.axis,
    label: item.row.label,
    factor: roundFactor(item.row.x),
    selectionScore: Number(item.selectionScore.toFixed(6)),
    rationale: item.rationale,
    validationPriority: Number(item.row.validationPriority.toFixed(6)),
    uncertaintyPct: Number(item.row.uncertaintyPct.toFixed(4)),
    predictionConfidence: Number(item.row.predictionConfidence.toFixed(6)),
    outOfDomain: item.row.outOfDomain,
    isKnee: item.row.isKnee,
    riskAdjustedSpeedup: Number(item.row.riskAdjustedSpeedup.toFixed(6)),
    riskAdjustedRecommendationScore: Number(
      item.row.riskAdjustedRecommendationScore.toFixed(6),
    ),
    speedup: Number(item.row.speedup.toFixed(6)),
    throughput: Number(item.row.throughput.toFixed(6)),
    totalCycles: Math.round(item.row.totalCycles),
    workScale: Number(item.row.workScale.toFixed(6)),
    cost: Number(item.row.cost.toFixed(6)),
    sramOverflowRatio: Number(item.row.sramOverflowRatio.toFixed(6)),
    meanUtilization: Number(item.row.meanUtilization.toFixed(6)),
  }));
  return `${JSON.stringify({ generatedBy: "tileforge-design-space", candidates: plan }, null, 2)}\n`;
}

export function exportValidationPlanCsv(rows: DesignSweepRow[], limit = 5) {
  const plan = validationPlanRows(rows, limit);
  const header = [
    "rank",
    "axis",
    "label",
    "factor",
    "selectionScore",
    "rationale",
    "validationPriority",
    "uncertaintyPct",
    "predictionConfidence",
    "outOfDomain",
    "isKnee",
    "riskAdjustedSpeedup",
    "riskAdjustedRecommendationScore",
    "speedup",
    "throughput",
    "totalCycles",
    "workScale",
    "cost",
    "sramOverflowRatio",
    "meanUtilization",
  ];
  const lines = [header.join(",")];
  plan.forEach((item) => {
    const row = item.row;
    lines.push(
      [
        item.rank,
        row.axis,
        row.label,
        roundFactor(row.x),
        item.selectionScore.toFixed(6),
        item.rationale,
        row.validationPriority.toFixed(6),
        row.uncertaintyPct.toFixed(4),
        row.predictionConfidence.toFixed(6),
        row.outOfDomain ? "true" : "false",
        row.isKnee ? "true" : "false",
        row.riskAdjustedSpeedup.toFixed(6),
        row.riskAdjustedRecommendationScore.toFixed(6),
        row.speedup.toFixed(6),
        row.throughput.toFixed(6),
        Math.round(row.totalCycles),
        row.workScale.toFixed(6),
        row.cost.toFixed(6),
        row.sramOverflowRatio.toFixed(6),
        row.meanUtilization.toFixed(6),
      ]
        .map(csvCell)
        .join(","),
    );
  });
  return `${lines.join("\n")}\n`;
}

export function buildDesignSpaceSvg(
  rows: DesignSweepRow[],
  metric: DesignMetric,
) {
  const axes = [...AXES];
  const axisLabels: Record<string, string> = {
    array: "TPU array",
    frequency: "Clock",
    sram: "SRAM capacity",
    dram: "DRAM bandwidth",
    "shape-m": "M sweep",
    "shape-n": "N sweep",
    "shape-k": "K sweep",
  };
  const width = 1120;
  const panelH = 145;
  const height = 58 + axes.length * panelH;
  const valueOf = (r: DesignSweepRow) =>
    metric === "speedup"
      ? r.speedup
      : metric === "throughput"
        ? r.throughput
        : r.score;
  const validationSet = new Set(validationDesignRows(rows, axes.length));
  const rowsByAxis = new Map(
    axes.map((a) => [
      a,
      rows.filter((r) => r.axis === a).sort((a, b) => a.x - b.x),
    ]),
  );
  const metricLabel =
    metric === "speedup"
      ? "work-normalized speedup"
      : metric === "throughput"
        ? "estimated TOPS"
        : "sweet-spot score";
  const panels = axes
    .map((axis, ai) => {
      const ys = 82 + ai * panelH;
      const data = rowsByAxis.get(axis) || [];
      const maxX = Math.max(1, ...data.map((r) => r.x));
      const minX = Math.min(...data.map((r) => r.x), 0.125);
      const logMinX = Math.log(Math.max(1e-9, minX));
      const logMaxX = Math.log(Math.max(1e-9, maxX));
      const maxValue = Math.max(
        1e-9,
        ...data.map(valueOf).filter(Number.isFinite),
      );
      const best = data.slice().sort(compareDesignRows)[0];
      const points = data.map((r) => {
        const x =
          210 +
          ((Math.log(Math.max(1e-9, r.x)) - logMinX) /
            Math.max(1e-9, logMaxX - logMinX)) *
            690;
        const y = ys + 92 - (valueOf(r) / maxValue) * 76;
        return { r, x, y };
      });
      const path = points
        .map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
        .join(" ");
      const bestPoint = points.find((p) => p.r === best);
      const kneePoints = points.filter((p) => p.r.isKnee);
      return `<text x="20" y="${ys + 14}" fill="#202124" font-family="Arial" font-size="14">${safeSvgText(axisLabels[axis])}</text>
      <line x1="210" y1="${ys + 98}" x2="930" y2="${ys + 98}" stroke="#dadce0"/>
      <line x1="210" y1="${ys + 12}" x2="210" y2="${ys + 98}" stroke="#dadce0"/>
      <path d="${path}" fill="none" stroke="#1a73e8" stroke-width="2.5"/>
      ${points.map((p) => {
        const title = safeSvgText(`${axisLabels[p.r.axis] ?? p.r.axis} · ${p.r.label} · ${metricLabel}: ${niceNumber(valueOf(p.r))} · speedup ${niceNumber(p.r.speedup)}x · uncertainty ±${p.r.uncertaintyPct.toFixed(1)}%`);
        return `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="${p.r.isBase ? 5 : 3.5}" fill="${p.r.isBase ? "#fbbc04" : "#1a73e8"}"><title>${title}</title></circle>`;
      }).join("\n      ")}
      ${kneePoints.map((p) => `<path d="M ${p.x.toFixed(1)} ${(p.y - 6).toFixed(1)} L ${(p.x + 6).toFixed(1)} ${p.y.toFixed(1)} L ${p.x.toFixed(1)} ${(p.y + 6).toFixed(1)} L ${(p.x - 6).toFixed(1)} ${p.y.toFixed(1)} Z" fill="#ffb86b"><title>marginal knee: ×${niceNumber(p.r.x)}, efficiency ${niceNumber(p.r.marginalEfficiency)}</title></path>`).join("\n      ")}
      ${points
        .filter((p) => validationSet.has(p.r))
        .map(
          (p) =>
            `<path d="M ${p.x.toFixed(1)} ${(p.y - 9).toFixed(1)} L ${(p.x + 7).toFixed(1)} ${(p.y + 5).toFixed(1)} L ${(p.x - 7).toFixed(1)} ${(p.y + 5).toFixed(1)} Z" fill="#c792ea"><title>next validation candidate: ×${niceNumber(p.r.x)}, priority ${niceNumber(p.r.validationPriority)}</title></path>`,
        )
        .join("\n      ")}
      ${bestPoint ? `<line x1="${bestPoint.x.toFixed(1)}" y1="${ys + 10}" x2="${bestPoint.x.toFixed(1)}" y2="${ys + 102}" stroke="#188038" stroke-dasharray="4 4"/><rect x="936" y="${ys + 13}" width="166" height="54" rx="10" fill="#f8fafd" stroke="#dadce0"/><text x="948" y="${ys + 31}" fill="#188038" font-family="Consolas, monospace" font-size="12">×${niceNumber(best.x)} · ${niceNumber(best.speedup)}x</text><text x="948" y="${ys + 49}" fill="#3c4043" font-family="Consolas, monospace" font-size="11">risk ±${best.uncertaintyPct.toFixed(1)}% · util ${(best.meanUtilization * 100).toFixed(0)}%</text><text x="948" y="${ys + 64}" fill="#5f6368" font-family="Consolas, monospace" font-size="10">rec ${niceNumber(best.recommendationScore)} · ROI ${niceNumber(best.roiScore)}</text>` : ""}
      <text x="210" y="${ys + 120}" fill="#5f6368" font-family="Consolas, monospace" font-size="11">×${niceNumber(minX)}</text>
      <text x="885" y="${ys + 120}" fill="#5f6368" font-family="Consolas, monospace" font-size="11">×${niceNumber(maxX)}</text>`;
    })
    .join("\n");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <desc>Design-space sweep confidence-aware consensus+ROI recommend sweet:</desc>
    <rect width="100%" height="100%" fill="#ffffff"/>
    <text x="20" y="30" fill="#202124" font-family="Arial" font-size="18">Design-space sweet spot · ${safeSvgText(metricLabel)}</text>
    <text x="20" y="52" fill="#5f6368" font-family="Arial" font-size="12">각 축은 log-scale입니다. 초록=권장점, 노랑=baseline, 주황=knee, 보라=다음 검증 후보입니다.</text>
    <path d="M 970 43 L 976 49 L 970 55 L 964 49 Z" fill="#ffb86b"><title>marginal knee legend</title></path>
    <text x="982" y="53" fill="#5f6368" font-family="Arial" font-size="11">knee</text>
    <path d="M 1020 41 L 1027 55 L 1013 55 Z" fill="#c792ea"><title>next validation candidate legend</title></path>
    <text x="1033" y="53" fill="#5f6368" font-family="Arial" font-size="11">validate</text>
    ${panels}
  </svg>`;
}
