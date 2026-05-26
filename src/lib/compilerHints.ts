import type { HardwareConfig, SearchResponse, TileCandidateResult } from "@/types/domain";

export type CompilerHintRisk = "low" | "medium" | "high";

export interface IreeTileHint {
  model: string;
  opName: string;
  shape: { m: number; n: number; k: number; dtypeBytes: number };
  tile: { m: number; n: number; k: number };
  workgroupTileSizes: [number, number, number];
  reductionTileSizes: [number, number, number];
  vectorHint: [number, number, number];
  estimated: {
    fullLayerCycles: number;
    tilePolicyCycles: number;
    utilization: number;
    paddingRatio: number;
    tileScratchBytes: number;
    fullLayerSramBytes: number;
  };
  compilerOptions: string[];
  transformComment: string;
  risk: CompilerHintRisk;
  reasons: string[];
}

export interface CompilerHintsBundle {
  target: "iree-lowering-hints";
  generatedAt: string;
  hardware: HardwareConfig;
  contract: {
    hardwareDesignMetric: "full-layer-cycles";
    tilingMetric: "tile-policy-score";
    compilerMetric: "lowering-hint";
    runtimeBenchmarkRequired: boolean;
  };
  globalOptions: string[];
  hints: IreeTileHint[];
  notes: string[];
}

function roundPowerOfTwoAtMost(v: number, max: number) {
  const x = Math.max(1, Math.min(Math.floor(v), max));
  let p = 1;
  while (p * 2 <= x) p *= 2;
  return p;
}

function vectorHintFor(hw: HardwareConfig, c: TileCandidateResult): [number, number, number] {
  const vecM = roundPowerOfTwoAtMost(Math.min(c.tileM, hw.arrayRows), 16);
  const vecN = roundPowerOfTwoAtMost(Math.min(c.tileN, hw.arrayCols), 16);
  const vecK = roundPowerOfTwoAtMost(c.tileK, 16);
  if (hw.dataflow === "OS") return [Math.max(1, Math.min(vecM, 8)), Math.max(1, Math.min(vecN, 16)), Math.max(1, Math.min(vecK, 16))];
  if (hw.dataflow === "IS") return [Math.max(1, Math.min(vecM, 16)), Math.max(1, Math.min(vecN, 8)), Math.max(1, Math.min(vecK, 16))];
  return [Math.max(1, Math.min(vecM, 8)), Math.max(1, Math.min(vecN, 16)), Math.max(1, Math.min(vecK, 16))];
}

function riskFor(c: TileCandidateResult): CompilerHintRisk {
  const lowUtil = c.utilization < 0.45;
  const highPad = c.paddingRatio > 0.35;
  const sramWarning = c.warnings.some(w => /SRAM|용량|overflow|spill/i.test(w));
  const full = c.fullLayerCycles ?? c.cycles;
  const policy = c.tilePolicyCycles ?? c.cycles;
  const mismatch = Math.max(full, policy) / Math.max(1, Math.min(full, policy));
  if ((lowUtil && highPad) || sramWarning || mismatch > 200) return "high";
  if (lowUtil || highPad || mismatch > 80) return "medium";
  return "low";
}

function reasonsFor(c: TileCandidateResult, risk: CompilerHintRisk): string[] {
  const reasons: string[] = [];
  reasons.push(`full-layer ${Math.round(c.fullLayerCycles ?? c.cycles).toLocaleString()} cycles, tile-policy ${Math.round(c.tilePolicyCycles ?? c.cycles).toLocaleString()} cycles로 분리하여 해석`);
  reasons.push(`tile ${c.tileM}x${c.tileN}x${c.tileK}, util ${(c.utilization * 100).toFixed(1)}%, padding ${(c.paddingRatio * 100).toFixed(1)}%`);
  if ((c.fullLayerStallCycles ?? 0) > 0) reasons.push(`full-layer stall ${Math.round(c.fullLayerStallCycles ?? 0).toLocaleString()} cycles가 있어 runtime benchmark 우선`);
  if (risk !== "low") reasons.push(`risk=${risk}: IREE transform을 강제 적용하기 전에 compile/runtime A-B test 필요`);
  for (const warning of c.warnings.slice(0, 3)) reasons.push(`warning: ${warning}`);
  return reasons;
}

function compilerOptionsFor(hw: HardwareConfig, c: TileCandidateResult): string[] {
  const opts = [
    "--iree-hal-target-backends=llvm-cpu",
    "--iree-llvmcpu-target-cpu=host",
    "--iree-global-opt-enable-warn-on-uninitialized-values=false",
  ];
  const tileScratch = c.tileScratchBytes ?? c.sramBytes;
  if (tileScratch <= Math.max(1, hw.sramKB * 1024) * 0.5) {
    opts.push("# hint: tile fits comfortably in modeled SRAM; prefer keeping matmul tiled/fused near producer-consumer ops");
  } else if (tileScratch > Math.max(1, hw.sramKB * 1024)) {
    opts.push("# hint: tile exceeds modeled SRAM; reduce reduction tile or let IREE choose a smaller lowering config");
  }
  if (c.tileK >= 128) opts.push("# hint: large reduction tile; compare against a smaller K tile in IREE runtime benchmark");
  return opts;
}

export function buildCompilerHints(res: SearchResponse): CompilerHintsBundle {
  const hw = res.request.hardware;
  const hints: IreeTileHint[] = res.results.map((r) => {
    const b = r.best;
    const risk = riskFor(b);
    const vectorHint = vectorHintFor(hw, b);
    return {
      model: r.shape.model,
      opName: r.shape.opName,
      shape: { m: r.shape.m, n: r.shape.n, k: r.shape.k, dtypeBytes: r.shape.dtypeBytes },
      tile: { m: b.tileM, n: b.tileN, k: b.tileK },
      workgroupTileSizes: [b.tileM, b.tileN, 0],
      reductionTileSizes: [0, 0, b.tileK],
      vectorHint,
      estimated: {
        fullLayerCycles: b.fullLayerCycles ?? b.cycles,
        tilePolicyCycles: b.tilePolicyCycles ?? b.cycles,
        utilization: b.utilization,
        paddingRatio: b.paddingRatio,
        tileScratchBytes: b.tileScratchBytes ?? b.sramBytes,
        fullLayerSramBytes: b.fullLayerSramBytes ?? b.sramBytes,
      },
      compilerOptions: compilerOptionsFor(hw, b),
      transformComment: `candidate lowering hint: tile=[${b.tileM}, ${b.tileN}, ${b.tileK}], vector=[${vectorHint.join(", ")}]`,
      risk,
      reasons: reasonsFor(b, risk),
    };
  });
  return {
    target: "iree-lowering-hints",
    generatedAt: new Date().toISOString(),
    hardware: hw,
    contract: {
      hardwareDesignMetric: "full-layer-cycles",
      tilingMetric: "tile-policy-score",
      compilerMetric: "lowering-hint",
      runtimeBenchmarkRequired: true,
    },
    globalOptions: [
      "iree-compile generated.mlir --iree-hal-target-backends=llvm-cpu --iree-llvmcpu-target-cpu=host -o model.vmfb",
      "# Experimental only: add --iree-codegen-transform-dialect-library=transform.mlir after checking that the local IREE version accepts this transform dialect sketch.",
    ],
    hints,
    notes: [
      "TileForge의 주 목적은 빠른 설계 탐색입니다. full-layer cycle은 하드웨어 설계 비교용이고 tile-policy cycle은 타일 후보 ranking용입니다.",
      "IREE 산출물은 compiler lowering hint입니다. compile 성공은 runtime 성능 검증을 의미하지 않으므로 benchmark A-B test가 필요합니다.",
      "risk가 medium/high인 op는 SCALE-Sim 또는 실제 IREE runtime 측정으로 calibration sample을 추가하는 것이 좋습니다.",
    ],
  };
}

export function compilerHintsMarkdown(bundle: CompilerHintsBundle): string {
  const lines: string[] = [];
  lines.push("# IREE Compiler Hints", "");
  lines.push("## Prediction contract", "");
  lines.push("| 목적 | 기준 지표 | 용도 |", "|---|---|---|");
  lines.push("| 하드웨어 설계 | full-layer-cycles | array/SRAM/BW/dataflow 비교 |");
  lines.push("| 타일링 전략 | tile-policy-score | MLIR/IREE lowering 후보 선택 |");
  lines.push("| 컴파일러 옵션 | lowering-hint | IREE transform/benchmark 후보 생성 |");
  lines.push("", "> compile 성공은 runtime 성능 검증이 아닙니다. 최종 적용 전 IREE benchmark로 A-B test하세요.", "");
  lines.push("## Global command", "");
  lines.push("```bash");
  for (const option of bundle.globalOptions) lines.push(option);
  lines.push("```", "");
  lines.push("## Per-op hints", "");
  lines.push("| op | shape | tile | workgroup | reduction | vector | risk | 이유 |", "|---|---:|---:|---:|---:|---:|---:|---|");
  for (const h of bundle.hints) {
    lines.push(`| ${h.model}.${h.opName} | ${h.shape.m}x${h.shape.n}x${h.shape.k} | ${h.tile.m}x${h.tile.n}x${h.tile.k} | [${h.workgroupTileSizes.join(",")}] | [${h.reductionTileSizes.join(",")}] | [${h.vectorHint.join(",")}] | ${h.risk} | ${h.reasons[1] ?? "-"} |`);
  }
  lines.push("", "## Notes");
  for (const note of bundle.notes) lines.push(`- ${note}`);
  return lines.join("\n");
}
