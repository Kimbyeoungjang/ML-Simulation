import type {
  MatmulShape,
  SearchRequest,
  SearchResponse,
} from "@/types/domain";
import { estimateAll } from "./estimator";
import { applyEstimatorSuiteToSearchResponse } from "./estimatorSuiteApply";
import type { EstimatorSuiteModel } from "./estimatorSuite";
import { hashObject } from "./hash";

import type { DesignMetric, DesignSweepRow, ValidationPlanRow } from "./designSpaceTypes";
export type { DesignMetric, DesignSweepRow, ValidationPlanRow } from "./designSpaceTypes";
import { attachRecommendationScores, compareDesignRows, estimateDesignUncertaintyPct, validationDesignRows, validationPlanRows as selectValidationPlanRows } from "./designSpaceScoring";
export { exportValidationPlanCsv, exportValidationPlanJson, paretoDesignRows, validationDesignRows, validationPlanRows } from "./designSpaceScoring";

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




function safeRunNamePart(value: unknown) {
  return String(value ?? "candidate")
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 64) || "candidate";
}

export function requestForDesignSweepRow(
  baseRequest: SearchRequest,
  row: Pick<DesignSweepRow, "axis" | "x" | "label">,
  options: { rank?: number; runNamePrefix?: string } = {},
): SearchRequest {
  const factor = Number.isFinite(Number(row.x)) && Number(row.x) > 0 ? Number(row.x) : 1;
  let next: SearchRequest;
  const hw = { ...baseRequest.hardware };

  if (row.axis === "array") {
    next = {
      ...baseRequest,
      hardware: {
        ...hw,
        arrayRows: Math.max(1, Math.round(hw.arrayRows * factor)),
        arrayCols: Math.max(1, Math.round(hw.arrayCols * factor)),
      },
    };
  } else if (row.axis === "frequency") {
    next = {
      ...baseRequest,
      hardware: {
        ...hw,
        frequencyMHz: Math.max(1, Math.round(hw.frequencyMHz * factor)),
      },
    };
  } else if (row.axis === "sram") {
    next = {
      ...baseRequest,
      hardware: { ...hw, sramKB: Math.max(1, Math.round(hw.sramKB * factor)) },
    };
  } else if (row.axis === "dram") {
    next = scaleDramBandwidth(baseRequest, factor);
  } else if (row.axis === "shape-m" || row.axis === "shape-n" || row.axis === "shape-k") {
    const axis = row.axis.slice("shape-".length) as "m" | "n" | "k";
    next = {
      ...baseRequest,
      shapes: baseRequest.shapes.map((shape) => scaledShape(shape, axis, factor)),
    };
  } else {
    next = { ...baseRequest, hardware: hw, shapes: [...baseRequest.shapes] };
  }

  const rank = options.rank !== undefined ? String(options.rank).padStart(2, "0") : "xx";
  const prefix = safeRunNamePart(options.runNamePrefix ?? "active_learning");
  const axisPart = safeRunNamePart(row.axis);
  const labelPart = safeRunNamePart(row.label);
  const runName = `${prefix}_${rank}_${axisPart}_${labelPart}`;
  return {
    ...next,
    hardware: {
      ...next.hardware,
      name: `${baseRequest.hardware.name || "hardware"}_${axisPart}_${labelPart}`.slice(0, 120),
    },
    scaleSim: { ...(next.scaleSim ?? {}), runName },
  };
}

export function requestForValidationPlanRow(
  baseRequest: SearchRequest,
  item: ValidationPlanRow,
  options: { runNamePrefix?: string } = {},
): SearchRequest {
  return requestForDesignSweepRow(baseRequest, item.row, {
    rank: item.rank,
    runNamePrefix: options.runNamePrefix,
  });
}




export interface ExpandedValidationPlanOptions {
  /** Number of top recommendation seeds to expand. */
  seedLimit?: number;
  /** Minimum valid measured samples the later training step needs. */
  minSamples?: number;
  /** Expected valid full-layer samples produced by one queued request. */
  samplesPerRequest?: number;
  /** Queue extra requests because some external SCALE-Sim runs may fail or be skipped. */
  oversampleFactor?: number;
  /** How many sweep points before/after each seed to include on the same axis. */
  neighborhoodRadius?: number;
  /** Hard cap to avoid accidentally queuing an extremely large active-learning batch. */
  maxRequests?: number;
}

export interface ExpandedValidationPlanItem {
  rank: number;
  sourceRank: number;
  row: DesignSweepRow;
  selectionScore: number;
  rationale: string;
  variant: "seed" | "neighbor" | "fill";
  offset: number;
  plannedSamples: number;
}

function designCsvCell(value: unknown) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function designRowKey(row: Pick<DesignSweepRow, "axis" | "x">) {
  return `${row.axis}:${roundFactor(Number(row.x) || 1)}`;
}

function nearestRowIndex(rows: DesignSweepRow[], target: DesignSweepRow) {
  const key = designRowKey(target);
  const exact = rows.findIndex((row) => designRowKey(row) === key);
  if (exact >= 0) return exact;
  let best = 0;
  let bestDistance = Number.POSITIVE_INFINITY;
  rows.forEach((row, index) => {
    const d = Math.abs(Math.log(Math.max(1e-12, row.x)) - Math.log(Math.max(1e-12, target.x)));
    if (d < bestDistance) {
      best = index;
      bestDistance = d;
    }
  });
  return best;
}

function offsetOrder(radius: number) {
  const out = [0];
  for (let i = 1; i <= radius; i++) {
    out.push(-i, i);
  }
  return out;
}

/**
 * Expands the top active-learning recommendation points into an executable
 * neighborhood plan.  The first pass keeps the user's mental model simple:
 * each recommended point is tested together with the nearest points immediately
 * before/after it on the same sweep axis.  If that neighborhood is not enough
 * to satisfy the estimator's 40-sample training floor, the remaining slots are
 * filled with the globally most useful validation rows.
 */
export function expandedValidationPlanRows(
  rows: DesignSweepRow[],
  options: ExpandedValidationPlanOptions = {},
): ExpandedValidationPlanItem[] {
  const cleanRows = rows.filter((row) => Number.isFinite(row.x) && row.x > 0);
  if (!cleanRows.length) return [];

  const seedLimit = Math.max(1, Math.min(Math.floor(options.seedLimit ?? 5), 25));
  const minSamples = Math.max(1, Math.floor(options.minSamples ?? 40));
  const samplesPerRequest = Math.max(1, Math.floor(options.samplesPerRequest ?? 1));
  const oversampleFactor = Math.max(1, Number(options.oversampleFactor ?? 1.2));
  const neighborhoodRadius = Math.max(1, Math.min(Math.floor(options.neighborhoodRadius ?? 4), 20));
  const maxRequests = Math.max(1, Math.floor(options.maxRequests ?? 128));
  const targetRequests = Math.min(
    maxRequests,
    Math.max(seedLimit, Math.ceil((minSamples / samplesPerRequest) * oversampleFactor)),
  );

  const seeds = selectValidationPlanRows(cleanRows, seedLimit);
  const seedMeta = new Map(
    seeds.map((item) => [designRowKey(item.row), item] as const),
  );
  const byAxis = new Map<string, DesignSweepRow[]>();
  for (const row of cleanRows) {
    const current = byAxis.get(row.axis) ?? [];
    current.push(row);
    byAxis.set(row.axis, current);
  }
  for (const axisRows of byAxis.values()) axisRows.sort((a, b) => a.x - b.x);

  const selected = new Map<string, ExpandedValidationPlanItem>();
  const add = (
    row: DesignSweepRow | undefined,
    sourceRank: number,
    variant: ExpandedValidationPlanItem["variant"],
    offset: number,
    selectionScore?: number,
    rationale?: string,
  ) => {
    if (!row || selected.size >= targetRequests) return;
    const key = designRowKey(row);
    if (selected.has(key)) return;
    const seed = seedMeta.get(key);
    selected.set(key, {
      rank: selected.size + 1,
      sourceRank,
      row,
      selectionScore: selectionScore ?? seed?.selectionScore ?? row.validationPriority ?? row.recommendationScore ?? 0,
      rationale: rationale ?? seed?.rationale ?? (variant === "neighbor" ? "neighbor around recommended candidate" : "priority fill to reach training minimum"),
      variant,
      offset,
      plannedSamples: samplesPerRequest,
    });
  };

  const offsets = offsetOrder(neighborhoodRadius);
  for (const seed of seeds) {
    const axisRows = byAxis.get(seed.row.axis) ?? [];
    const center = nearestRowIndex(axisRows, seed.row);
    for (const offset of offsets) {
      const row = axisRows[center + offset];
      add(
        row,
        seed.rank,
        offset === 0 ? "seed" : "neighbor",
        offset,
        offset === 0 ? seed.selectionScore : seed.selectionScore * Math.max(0.35, 1 - Math.abs(offset) * 0.08),
        offset === 0
          ? seed.rationale
          : `neighbor ${offset > 0 ? "+" : ""}${offset} around rank ${seed.rank}: ${seed.rationale}`,
      );
    }
  }

  // If multiple top recommendations are on the same axis, their neighborhoods can
  // overlap. Fill the remaining slots with the next highest-priority validation
  // rows so a one-click run still reaches the training sample floor.
  const rankedFill = validationDesignRows(cleanRows, cleanRows.length);
  for (const row of rankedFill) {
    add(row, seeds.length + 1, "fill", 0);
  }

  if (selected.size < targetRequests) {
    const fallback = [...cleanRows].sort(compareDesignRows);
    for (const row of fallback) add(row, seeds.length + 1, "fill", 0);
  }

  return [...selected.values()].map((item, index) => ({ ...item, rank: index + 1 }));
}

export function exportExpandedValidationPlanJson(items: ExpandedValidationPlanItem[]) {
  return `${JSON.stringify({
    generatedBy: "tileforge-design-space-expanded-active-learning",
    queuedCandidates: items.map((item) => ({
      rank: item.rank,
      sourceRank: item.sourceRank,
      variant: item.variant,
      offset: item.offset,
      axis: item.row.axis,
      label: item.row.label,
      factor: roundFactor(item.row.x),
      plannedSamples: item.plannedSamples,
      selectionScore: Number(item.selectionScore.toFixed(6)),
      rationale: item.rationale,
      validationPriority: Number(item.row.validationPriority.toFixed(6)),
      uncertaintyPct: Number(item.row.uncertaintyPct.toFixed(4)),
      predictionConfidence: Number(item.row.predictionConfidence.toFixed(6)),
      outOfDomain: item.row.outOfDomain,
      isKnee: item.row.isKnee,
      speedup: Number(item.row.speedup.toFixed(6)),
      throughput: Number(item.row.throughput.toFixed(6)),
      totalCycles: Math.round(item.row.totalCycles),
    })),
  }, null, 2)}\n`;
}

export function exportExpandedValidationPlanCsv(items: ExpandedValidationPlanItem[]) {
  const header = [
    "rank",
    "sourceRank",
    "variant",
    "offset",
    "axis",
    "label",
    "factor",
    "plannedSamples",
    "selectionScore",
    "rationale",
    "validationPriority",
    "uncertaintyPct",
    "predictionConfidence",
    "outOfDomain",
    "isKnee",
    "speedup",
    "throughput",
    "totalCycles",
  ];
  const lines = [header.join(",")];
  for (const item of items) {
    const row = item.row;
    lines.push([
      item.rank,
      item.sourceRank,
      item.variant,
      item.offset,
      row.axis,
      row.label,
      roundFactor(row.x),
      item.plannedSamples,
      item.selectionScore.toFixed(6),
      item.rationale,
      row.validationPriority.toFixed(6),
      row.uncertaintyPct.toFixed(4),
      row.predictionConfidence.toFixed(6),
      row.outOfDomain ? "true" : "false",
      row.isKnee ? "true" : "false",
      row.speedup.toFixed(6),
      row.throughput.toFixed(6),
      Math.round(row.totalCycles),
    ].map(designCsvCell).join(","));
  }
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
