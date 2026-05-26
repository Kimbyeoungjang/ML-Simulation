import type { SearchResponse, TileCandidateResult } from "@/types/domain";

function fmt(n: number, digits = 0) {
  return digits ? n.toFixed(digits) : Math.round(n).toLocaleString();
}

function pct(n: number, digits = 1) {
  return `${(n * 100).toFixed(digits)}%`;
}

function bytesKiB(n: number) {
  return `${fmt(n / 1024, 1)} KiB`;
}

function bests(res: SearchResponse): TileCandidateResult[] {
  return res.results.map(r => r.best);
}

function bottleneckShare(res: SearchResponse, b: TileCandidateResult) {
  return (b.fullLayerCycles ?? b.cycles) / Math.max(1, res.summary.totalCycles);
}

export interface HardwareDesignPlan {
  schema: "tileforge.hardware-design-plan.v1";
  generatedAt: string;
  objective: "hardware-design";
  decisionMetrics: Record<string, string>;
  summary: {
    totalFullLayerCycles: number;
    totalTilePolicyCycles: number;
    meanUtilization: number;
    maxTileScratchBytes: number;
    maxFullLayerWorkingSetBytes: number;
    minPredictionConfidence: number;
    bottleneckOp: string;
  };
  bottlenecks: Array<{ op: string; fullLayerCycles: number; share: number; issue: string }>;
  designActions: Array<{ axis: "array" | "sram" | "bandwidth" | "dataflow" | "validation"; priority: "high" | "medium" | "low"; action: string; reason: string }>;
}

export function buildHardwareDesignPlan(res: SearchResponse): HardwareDesignPlan {
  const h = res.request.hardware;
  const rows = bests(res);
  const maxTileScratchBytes = res.summary.maxTileScratchBytes ?? Math.max(...rows.map(b => b.tileScratchBytes ?? b.sramBytes), 0);
  const maxFullLayerWorkingSetBytes = res.summary.maxFullLayerSramBytes ?? Math.max(...rows.map(b => b.fullLayerSramBytes ?? b.sramBytes), 0);
  const minConfidence = res.summary.minPredictionConfidence ?? Math.min(...rows.map(b => b.predictionConfidence ?? 1), 1);
  const totalTilePolicyCycles = res.summary.totalTilePolicyCycles ?? rows.reduce((sum, b) => sum + Math.max(1, b.tilePolicyCycles ?? b.cycles), 0);
  const bottlenecks = rows
    .slice()
    .sort((a, b) => (b.fullLayerCycles ?? b.cycles) - (a.fullLayerCycles ?? a.cycles))
    .slice(0, 5)
    .map(b => {
      const share = bottleneckShare(res, b);
      let issue = "compute path dominates";
      if ((b.fullLayerStallCycles ?? 0) > Math.max(1024, (b.fullLayerComputeCycles ?? 1) * 0.08)) issue = "memory/refill stall sensitive";
      else if (b.utilization < 0.5) issue = "array under-utilization";
      else if (b.paddingRatio > 0.25) issue = "padding/boundary waste";
      return { op: `${b.model}.${b.opName}`, fullLayerCycles: b.fullLayerCycles ?? b.cycles, share, issue };
    });

  const designActions: HardwareDesignPlan["designActions"] = [];
  if (res.summary.meanUtilization < 0.55) {
    designActions.push({
      axis: "array",
      priority: "high",
      action: "array sweep에 직사각형 후보를 포함하세요. 예: rows×cols, rows×2cols, 2rows×cols.",
      reason: `평균 PE 사용률이 ${pct(res.summary.meanUtilization)}로 낮아 square array만 키우면 낭비가 커질 수 있습니다.`,
    });
  } else {
    designActions.push({
      axis: "array",
      priority: "medium",
      action: "현재 array 주변에서 ±2배 sweep을 돌려 성능 knee를 찾으세요.",
      reason: `평균 PE 사용률 ${pct(res.summary.meanUtilization)}로 기본 매핑은 가능하지만 면적 대비 효율 knee 확인이 필요합니다.`,
    });
  }

  if (maxTileScratchBytes > h.sramKB * 1024) {
    designActions.push({ axis: "sram", priority: "high", action: "tileK/tileN 축소 또는 SRAM 증설을 우선 검토하세요.", reason: `최대 tile scratch ${bytesKiB(maxTileScratchBytes)}가 설정 SRAM ${fmt(h.sramKB)} KiB를 초과합니다.` });
  } else if (maxTileScratchBytes < h.sramKB * 1024 * 0.35) {
    designActions.push({ axis: "sram", priority: "medium", action: "SRAM을 줄여도 되는지 sweep으로 확인하세요.", reason: `최대 tile scratch가 ${bytesKiB(maxTileScratchBytes)}로 설정 SRAM 대비 여유가 큽니다.` });
  } else {
    designActions.push({ axis: "sram", priority: "low", action: "현재 SRAM은 타일 scratch 관점에서 대체로 균형적입니다.", reason: `최대 tile scratch ${bytesKiB(maxTileScratchBytes)} / 설정 ${fmt(h.sramKB)} KiB.` });
  }

  const stallHeavy = rows.filter(b => (b.fullLayerStallCycles ?? 0) > Math.max(1024, (b.fullLayerComputeCycles ?? 1) * 0.08));
  if (stallHeavy.length) {
    designActions.push({ axis: "bandwidth", priority: "high", action: "DRAM/SRAM bandwidth sweep를 bottleneck op 중심으로 수행하세요.", reason: `${stallHeavy.length}개 op에서 full-layer stall이 의미 있게 예측됩니다.` });
  } else {
    designActions.push({ axis: "bandwidth", priority: "low", action: "현재 예측은 compute-dominant입니다. bandwidth는 낮출 때 cycle 급증 지점만 확인하세요.", reason: "full-layer stall이 전체 compute cycle 대비 작습니다." });
  }

  const dataflows = new Set(rows.map(b => b.warnings.join(" ")).join(" ").match(/dataflow/gi) ?? []);
  designActions.push({
    axis: "dataflow",
    priority: dataflows.size ? "medium" : "low",
    action: "WS/OS/IS 비교 artifact를 함께 확인하고, bottleneck op가 바뀌는지 보세요.",
    reason: `${h.dataflow} 기준 예측이며, compiler lowering과 stationary choice가 달라지면 최적 tile도 바뀔 수 있습니다.`,
  });

  if (minConfidence < 0.75 || bottlenecks.some(b => b.share > 0.35)) {
    designActions.push({ axis: "validation", priority: "high", action: "bottleneck op와 low-confidence op를 SCALE-Sim calibration sample로 추가하세요.", reason: `최소 confidence ${(minConfidence * 100).toFixed(0)}%, 최대 bottleneck share ${(Math.max(...bottlenecks.map(b => b.share), 0) * 100).toFixed(1)}%.` });
  }

  return {
    schema: "tileforge.hardware-design-plan.v1",
    generatedAt: new Date().toISOString(),
    objective: "hardware-design",
    decisionMetrics: {
      cycles: "Use fullLayerCycles/summary.totalCycles.",
      sram: "Use tileScratchBytes for local SRAM fit; use fullLayerSramBytes for refill/spill sensitivity.",
      utilization: "Use full-layer utilization to judge array fit, not only tile spatial utilization.",
      confidence: "Validate low-confidence bottlenecks before final design conclusions.",
    },
    summary: {
      totalFullLayerCycles: res.summary.totalCycles,
      totalTilePolicyCycles,
      meanUtilization: res.summary.meanUtilization,
      maxTileScratchBytes,
      maxFullLayerWorkingSetBytes,
      minPredictionConfidence: minConfidence,
      bottleneckOp: res.summary.bottleneckOp,
    },
    bottlenecks,
    designActions,
  };
}

export function hardwareDesignPlanMarkdown(plan: HardwareDesignPlan): string {
  const lines: string[] = [];
  lines.push("# Hardware Design Plan", "");
  lines.push("이 파일은 array/SRAM/bandwidth/dataflow 의사결정용입니다. 타일 후보 ranking이나 IREE 옵션 확정에는 `tiling_strategy.md`, `iree_benchmark_plan.md`를 같이 보세요.", "");
  lines.push("## Summary", "");
  lines.push("| metric | value |", "|---|---:|");
  lines.push(`| full-layer cycles | ${fmt(plan.summary.totalFullLayerCycles)} |`);
  lines.push(`| tile-policy cycles | ${fmt(plan.summary.totalTilePolicyCycles)} |`);
  lines.push(`| mean utilization | ${pct(plan.summary.meanUtilization, 2)} |`);
  lines.push(`| max tile scratch | ${bytesKiB(plan.summary.maxTileScratchBytes)} |`);
  lines.push(`| max full-layer working set | ${bytesKiB(plan.summary.maxFullLayerWorkingSetBytes)} |`);
  lines.push(`| min confidence | ${pct(plan.summary.minPredictionConfidence, 0)} |`);
  lines.push(`| bottleneck op | ${plan.summary.bottleneckOp} |`, "");
  lines.push("## Bottlenecks", "");
  lines.push("| op | full-layer cycles | share | issue |", "|---|---:|---:|---|");
  for (const b of plan.bottlenecks) lines.push(`| ${b.op} | ${fmt(b.fullLayerCycles)} | ${pct(b.share, 1)} | ${b.issue} |`);
  lines.push("", "## Design actions", "");
  lines.push("| priority | axis | action | reason |", "|---|---|---|---|");
  for (const a of plan.designActions) lines.push(`| ${a.priority} | ${a.axis} | ${a.action} | ${a.reason} |`);
  return lines.join("\n");
}
