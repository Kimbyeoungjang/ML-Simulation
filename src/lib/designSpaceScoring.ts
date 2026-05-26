import type { DesignSweepRow, ValidationPlanRow } from "./designSpaceTypes";

function clamp(x: number, lo: number, hi: number) {
  return Math.max(lo, Math.min(hi, x));
}

function roundFactor(value: number) {
  return Number(value.toFixed(6));
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

export function estimateDesignUncertaintyPct(
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

export function attachRecommendationScores(rows: DesignSweepRow[]): DesignSweepRow[] {
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

export function compareDesignRows(a: DesignSweepRow, b: DesignSweepRow) {
  return (
    b.recommendationScore - a.recommendationScore ||
    b.riskAdjustedRecommendationScore - a.riskAdjustedRecommendationScore ||
    b.agreementScore - a.agreementScore ||
    b.score - a.score ||
    b.speedup - a.speedup
  );
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
