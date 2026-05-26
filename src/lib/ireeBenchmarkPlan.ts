import type { SearchResponse, TileCandidateResult } from "@/types/domain";

function fmt(n: number, digits = 0) { return digits ? n.toFixed(digits) : Math.round(n).toLocaleString(); }
function pct(n: number, digits = 1) { return `${(n * 100).toFixed(digits)}%`; }
function tile(c: Pick<TileCandidateResult, "tileM" | "tileN" | "tileK">) { return [c.tileM, c.tileN, c.tileK] as [number, number, number]; }
function tileKey(t: readonly number[]) { return t.join("x"); }
function clampPositive(v: number) { return Math.max(1, Math.round(v)); }

export interface IreeBenchmarkVariant {
  name: string;
  op: string;
  tile: [number, number, number] | null;
  workgroupTileSizes: [number, number, number] | null;
  reductionTileSizes: [number, number, number] | null;
  vectorSizeHint: [number, number, number] | null;
  expectedUse: string;
  risk: "baseline" | "low" | "medium" | "high";
  commandHint: string;
}

export interface IreeBenchmarkPlan {
  schema: "tileforge.iree-benchmark-plan.v1";
  generatedAt: string;
  backend: "llvm-cpu";
  purpose: string;
  measurementProtocol: string[];
  variants: IreeBenchmarkVariant[];
}

function vectorFor(t: [number, number, number]): [number, number, number] {
  const p2 = (v: number, max: number) => {
    let p = 1;
    while (p * 2 <= Math.max(1, Math.min(v, max))) p *= 2;
    return p;
  };
  return [p2(t[0], 8), p2(t[1], 16), p2(t[2], 16)];
}

function riskForCandidate(c: TileCandidateResult): IreeBenchmarkVariant["risk"] {
  if (c.utilization < 0.4 || c.paddingRatio > 0.4 || c.warnings.some(w => /SRAM|초과|spill|overflow/i.test(w))) return "high";
  if (c.utilization < 0.55 || c.paddingRatio > 0.25 || (c.predictionConfidence ?? 1) < 0.75) return "medium";
  return "low";
}

function variant(op: string, name: string, t: [number, number, number] | null, expectedUse: string, risk: IreeBenchmarkVariant["risk"]): IreeBenchmarkVariant {
  return {
    name,
    op,
    tile: t,
    workgroupTileSizes: t ? [t[0], t[1], 0] : null,
    reductionTileSizes: t ? [0, 0, t[2]] : null,
    vectorSizeHint: t ? vectorFor(t) : null,
    expectedUse,
    risk,
    commandHint: t
      ? `Compare transform.mlir variant ${name} with tile=[${t.join(",")}] against baseline vmfb runtime.`
      : "Baseline iree-compile without TileForge transform hints.",
  };
}

export function buildIreeBenchmarkPlan(res: SearchResponse): IreeBenchmarkPlan {
  const variants: IreeBenchmarkVariant[] = [];
  variants.push(variant("all", "baseline", null, "control: checks compileability and default IREE lowering", "baseline"));
  const hw = res.request.hardware;
  for (const r of res.results) {
    const op = `${r.shape.model}.${r.shape.opName}`;
    const selected = tile(r.best);
    const seen = new Set<string>();
    const add = (name: string, t: [number, number, number], expectedUse: string, risk: IreeBenchmarkVariant["risk"]) => {
      const key = `${op}:${name}:${tileKey(t)}`;
      if (seen.has(key)) return;
      seen.add(key);
      variants.push(variant(op, name, t, expectedUse, risk));
    };
    add("tileforge-selected", selected, "primary TileForge tile-policy winner", riskForCandidate(r.best));
    const smallerK: [number, number, number] = [selected[0], selected[1], clampPositive(selected[2] / 2)];
    if (smallerK[2] !== selected[2]) add("smaller-reduction", smallerK, "tests whether lower K pressure improves IREE runtime/cache behavior", riskForCandidate(r.best) === "high" ? "medium" : "low");
    const arrayMatched: [number, number, number] = [clampPositive(Math.min(r.shape.m, hw.arrayRows)), clampPositive(Math.min(r.shape.n, hw.arrayCols)), selected[2]];
    add("array-matched-spatial", arrayMatched, "tests conservative spatial mapping aligned to the modeled systolic array", "low");
    const alt = r.candidates.find(c => c.tileK !== r.best.tileK || (c.tileScratchBytes ?? c.sramBytes) < (r.best.tileScratchBytes ?? r.best.sramBytes) * 0.75);
    if (alt) add("nearby-policy-alternative", tile(alt), "tests a close tile-policy alternative that may win after compiler/runtime effects", riskForCandidate(alt));
  }
  return {
    schema: "tileforge.iree-benchmark-plan.v1",
    generatedAt: new Date().toISOString(),
    backend: "llvm-cpu",
    purpose: "Turn TileForge estimates into an IREE A-B benchmark matrix. These are not final flags until runtime is measured.",
    measurementProtocol: [
      "Compile baseline generated.mlir without transform hints.",
      "Compile one transform variant at a time, keeping backend and target CPU identical.",
      "Run warmup iterations and repeated runtime measurements before making compiler decisions.",
      "Compare parsed runtime median and p90, not only vmfb size or compile success.",
      "Promote a hint only when `iree_runtime_decision.md` shows stable speedup and correctness is checked.",
    ],
    variants,
  };
}

export function ireeBenchmarkPlanMarkdown(plan: IreeBenchmarkPlan): string {
  const lines: string[] = [];
  lines.push("# IREE Benchmark Plan", "");
  lines.push(plan.purpose, "");
  lines.push("## Measurement protocol", "");
  for (const step of plan.measurementProtocol) lines.push(`- ${step}`);
  lines.push("", "## Variants", "");
  lines.push("| variant | op | tile | workgroup | reduction | vector | risk | expected use |", "|---|---|---:|---:|---:|---:|---|---|");
  for (const v of plan.variants) {
    const tile = v.tile ? v.tile.join("x") : "-";
    const wg = v.workgroupTileSizes ? `[${v.workgroupTileSizes.join(",")}]` : "-";
    const red = v.reductionTileSizes ? `[${v.reductionTileSizes.join(",")}]` : "-";
    const vec = v.vectorSizeHint ? `[${v.vectorSizeHint.join(",")}]` : "-";
    lines.push(`| ${v.name} | ${v.op} | ${tile} | ${wg} | ${red} | ${vec} | ${v.risk} | ${v.expectedUse} |`);
  }
  lines.push("", "## Compile command sketch", "");
  lines.push("```bash");
  lines.push("# baseline");
  lines.push("iree-compile generated.mlir --iree-hal-target-backends=llvm-cpu --iree-llvmcpu-target-cpu=host -o baseline.vmfb");
  lines.push("");
  lines.push("# hinted variant, after adapting transform.mlir to your IREE version");
  lines.push("iree-compile generated.mlir --iree-hal-target-backends=llvm-cpu --iree-llvmcpu-target-cpu=host --iree-codegen-transform-dialect-library=transform.mlir -o hinted.vmfb");
  lines.push("");
  lines.push("# compile + runtime benchmark harness");
  lines.push("npm run benchmark:iree -- --artifact <job-artifact-dir> --repetitions=5 --min-time-sec=0.05");
  lines.push("```");
  lines.push("", `총 ${fmt(plan.variants.length)}개 compile/runtime 비교 후보가 생성되었습니다.`);
  const risky = plan.variants.filter(v => v.risk === "high").length;
  if (risky) lines.push(`high risk 후보 ${fmt(risky)}개는 먼저 작은 workload에서 compile 안정성을 확인하세요.`);
  const avgTile = plan.variants.filter(v => v.tile).length / Math.max(1, plan.variants.length);
  lines.push(`tile hint 포함 비율: ${pct(avgTile, 1)}`);
  return lines.join("\n");
}
