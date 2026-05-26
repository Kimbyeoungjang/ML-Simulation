import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { artifactGuideJson, artifactGuideMarkdown } from "@/lib/artifactGuide";
import { assessConfidence } from "@/lib/confidence";
import { buildIreeRuntimeDecision, ireeRuntimeDecisionMarkdown, summarizeIreeBenchmarkLog, type IreeRuntimeDecision } from "@/lib/ireeRuntimeEvidence";
import { evaluatePurposeGate, purposeGateMarkdown, type PurposeGateExternalSummary } from "@/lib/purposeGate";
import type { SearchResponse } from "@/types/domain";
import { runExternalCommand } from "@/server/externalCommand";
import { absolutizeConfiguredToolCommand } from "@/server/externalToolCandidates";
import { commandLabel, getStringOpt, hasFlag, ireeCompileCommandCandidates, parseArgs } from "./external-utils";

type FunctionSpec = {
  name: string;
  inputs: string[];
};

type RuntimeCase = {
  name: "baseline" | "hinted";
  compileArgs: string[];
  vmfb: string;
  compileLog: string;
};

function splitCommands(value: string | undefined, fallback: string[]): string[] {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  return raw.split("|").map((s) => s.trim()).filter(Boolean).map((s) => absolutizeConfiguredToolCommand(s));
}

async function readJsonMaybe<T = any>(file: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return undefined;
  }
}

function searchResponseFromResultArtifact(raw: any): SearchResponse | undefined {
  const response = raw?.response ?? raw;
  if (!response?.summary || !Array.isArray(response?.results)) return undefined;
  return response as SearchResponse;
}

function purposeExternalSummary(raw: any, tool: "scalesim" | "iree"): PurposeGateExternalSummary | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  return {
    ok: Boolean(raw.ok),
    skipped: Boolean(raw.skipped),
    tool,
    triedCommands: Array.isArray(raw.triedCommands) ? raw.triedCommands : raw.command ? [String(raw.command)] : [],
    error: raw.error,
    totalCycles: raw.totalCycles,
    cycleRatio: raw.cycleRatio,
    vmfbBytes: raw.vmfbBytes,
    candidateLayers: Array.isArray(raw.candidateLayers) ? raw.candidateLayers : Array.isArray(raw.layers) ? raw.layers : undefined,
  };
}

async function listArtifactNames(root: string): Promise<string[]> {
  const out: string[] = [];
  async function walk(dir: string, prefix = "") {
    let entries: any[] = [];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const name = String(entry.name);
      const rel = prefix ? `${prefix}/${name}` : name;
      if (entry.isDirectory()) await walk(path.join(dir, name), rel);
      else out.push(rel);
    }
  }
  await walk(root);
  return out.sort();
}

async function refreshPurposeGateWithRuntimeEvidence(artifactDir: string, decision: IreeRuntimeDecision, benchmarkSummary?: any) {
  const resultArtifact = await readJsonMaybe<any>(path.join(artifactDir, "result.json"));
  const res = searchResponseFromResultArtifact(resultArtifact);
  if (!res) return { refreshed: false, reason: "missing result.json SearchResponse" };
  const scaleRaw = await readJsonMaybe<any>(path.join(artifactDir, "scalesim_summary.json"));
  const ireeRaw = await readJsonMaybe<any>(path.join(artifactDir, "iree_summary.json"));
  const scaleSim = purposeExternalSummary(scaleRaw, "scalesim");
  let iree = purposeExternalSummary(ireeRaw, "iree");
  if (!iree && benchmarkSummary?.compile) {
    const baselineCompile = (benchmarkSummary.compile as any[]).find((item) => item?.name === "baseline" && item?.ok);
    if (baselineCompile) {
      iree = {
        ok: true,
        skipped: false,
        tool: "iree",
        triedCommands: baselineCompile.command ? [String(baselineCompile.command)] : [],
        vmfbBytes: baselineCompile.vmfbBytes,
      };
    }
  }
  const confidence = assessConfidence(res, {
    externalValidated: Boolean((scaleSim?.ok && (scaleSim.totalCycles ?? 0) > 0) || iree?.ok),
    externalCycleRatio: scaleSim?.cycleRatio,
    estimatorSuiteSamples: (res as any).estimatorSuite?.applied ? ((res as any).estimatorSuite.modelSamples ?? 0) : 0,
  });
  const gate = evaluatePurposeGate(res, {
    confidence,
    scaleSim,
    iree,
    ireeRuntime: decision,
  });
  await writeFile(path.join(artifactDir, "purpose_gate.json"), JSON.stringify(gate, null, 2), "utf8");
  await writeFile(path.join(artifactDir, "purpose_gate.md"), purposeGateMarkdown(gate), "utf8");
  await writeFile(path.join(artifactDir, "iree_runtime_purpose_gate.json"), JSON.stringify(gate, null, 2), "utf8");
  await writeFile(path.join(artifactDir, "iree_runtime_purpose_gate.md"), purposeGateMarkdown(gate), "utf8");
  const artifacts = await listArtifactNames(artifactDir);
  await writeFile(path.join(artifactDir, "artifact_guide.json"), artifactGuideJson({ artifacts, res, gate, externalApplied: Boolean(scaleSim?.ok || iree?.ok) }), "utf8");
  await writeFile(path.join(artifactDir, "artifact_guide.md"), artifactGuideMarkdown({ artifacts, res, gate, externalApplied: Boolean(scaleSim?.ok || iree?.ok) }), "utf8");
  return { refreshed: true };
}

function parseFunctions(mlir: string): FunctionSpec[] {
  const functions: FunctionSpec[] = [];
  const re = /func\.func\s+@([A-Za-z0-9_$.]+)\s*\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(mlir))) {
    const name = match[1];
    const args = match[2];
    const inputs = [...args.matchAll(/tensor<([^>]+)>/g)].map((m) => m[1]);
    functions.push({ name, inputs });
  }
  return functions;
}

function inputArgs(spec: FunctionSpec): string[] {
  return spec.inputs.map((shape) => `--input=${shape}=0`);
}

async function requireNonEmpty(file: string, label: string): Promise<number> {
  const s = await stat(file);
  if (!s.isFile()) throw new Error(`${label} is not a file: ${file}`);
  if (s.size <= 0 && process.env.TILEFORGE_ALLOW_EMPTY_VMFB !== "1") throw new Error(`${label} is empty: ${file}`);
  return s.size;
}

async function compileVariant(
  commands: string[],
  variant: RuntimeCase,
  cwd: string,
  timeoutMs: number,
): Promise<{ command: string; elapsedMs: number; vmfbBytes: number }> {
  const errors: string[] = [];
  for (const command of commands) {
    try {
      const startedAt = Date.now();
      await runExternalCommand(command, variant.compileArgs, {
        cwd,
        timeoutMs,
        logPath: variant.compileLog,
        env: { TILEFORGE_MOCK_VMFB: variant.vmfb },
      });
      const vmfbBytes = await requireNonEmpty(variant.vmfb, `${variant.name} VMFB`);
      return { command: commandLabel(command), elapsedMs: Date.now() - startedAt, vmfbBytes };
    } catch (error) {
      errors.push(`${commandLabel(command)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(errors.join("\n"));
}

async function runBenchmark(
  commands: string[],
  vmfb: string,
  spec: FunctionSpec,
  outDir: string,
  label: string,
  timeoutMs: number,
  benchmarkOptions: { repetitions: number; minTimeSec: number; warmupSec: number },
): Promise<{ command?: string; elapsedMs?: number; logPath?: string; skipped?: boolean; error?: string; runtime?: ReturnType<typeof summarizeIreeBenchmarkLog> }> {
  if (!commands.length) return { skipped: true, error: "No IREE runtime/benchmark command configured." };
  const errors: string[] = [];
  for (const command of commands) {
    const safe = commandLabel(command).replace(/[^a-zA-Z0-9_.-]+/g, "_");
    const logPath = path.join(outDir, `${label}-${spec.name}-${safe}.log`);
    const benchmarkMode = /benchmark/i.test(command);
    const benchmarkArgs = benchmarkMode
      ? [
          `--benchmark_repetitions=${benchmarkOptions.repetitions}`,
          `--benchmark_min_time=${benchmarkOptions.minTimeSec}`,
          ...(benchmarkOptions.warmupSec > 0 ? [`--benchmark_min_warmup_time=${benchmarkOptions.warmupSec}`] : []),
        ]
      : [];
    const args = benchmarkMode
      ? [`--module=${vmfb}`, `--function=${spec.name}`, ...inputArgs(spec), ...benchmarkArgs]
      : ["--module", vmfb, "--function", spec.name, ...inputArgs(spec)];
    try {
      const startedAt = Date.now();
      await runExternalCommand(command, args, { cwd: outDir, timeoutMs, logPath });
      const runtimeLog = await readFile(logPath, "utf8").catch(() => "");
      return {
        command: commandLabel(command),
        elapsedMs: Date.now() - startedAt,
        logPath: path.relative(outDir, logPath),
        runtime: summarizeIreeBenchmarkLog(runtimeLog),
      };
    } catch (error) {
      errors.push(`${commandLabel(command)}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return { skipped: false, error: errors.join("\n") };
}

function markdown(summary: any): string {
  const lines: string[] = [];
  lines.push("# IREE Runtime Benchmark Report", "");
  lines.push(`- artifactDir: ${summary.artifactDir}`);
  lines.push(`- generatedAt: ${summary.generatedAt}`);
  lines.push(`- status: ${summary.ok ? "ok" : summary.skipped ? "skipped" : "failed"}`);
  lines.push("", "## Compile variants", "");
  lines.push("| variant | compile status | vmfb bytes | elapsed ms | command |", "|---|---|---:|---:|---|");
  for (const c of summary.compile ?? []) {
    lines.push(`| ${c.name} | ${c.ok ? "ok" : "failed"} | ${c.vmfbBytes ?? "-"} | ${c.elapsedMs ?? "-"} | ${c.command ?? "-"} |`);
  }
  lines.push("", "## Runtime runs", "");
  lines.push("| variant | function | status | median ms | p90 ms | samples | command/log |", "|---|---|---|---:|---:|---:|---|");
  for (const r of summary.runs ?? []) {
    const status = r.skipped ? "skipped" : r.error ? "failed" : "ok";
    lines.push(`| ${r.variant} | ${r.function} | ${status} | ${r.runtime?.medianMs?.toFixed?.(4) ?? "-"} | ${r.runtime?.p90Ms?.toFixed?.(4) ?? "-"} | ${r.runtime?.sampleCount ?? "-"} | ${r.logPath ?? r.command ?? r.error ?? "-"} |`);
  }
  if (summary.decision) {
    lines.push("", "## Runtime decision", "");
    lines.push(`- status: ${summary.decision.status}`);
    if (summary.decision.summary?.medianSpeedup != null) lines.push(`- median speedup: ${summary.decision.summary.medianSpeedup.toFixed(3)}x`);
    if (summary.decision.summary?.worstSpeedup != null) lines.push(`- worst speedup: ${summary.decision.summary.worstSpeedup.toFixed(3)}x`);
    lines.push("- 자세한 판단은 `iree_runtime_decision.md`를 보세요.");
  }
  lines.push("", "## Interpretation", "");
  lines.push("- 이 파일은 compile 성공, runtime 실행 가능성, 그리고 baseline/hinted 성능 비교를 분리해서 기록합니다.");
  lines.push("- median/p90/sample 수가 부족하면 hint를 기본값으로 승격하지 마세요.");
  lines.push("- transform hint를 기본값으로 승격하려면 correctness와 baseline 대비 runtime 개선이 함께 확인되어야 합니다.");
  return lines.join("\n");
}

async function main() {
  const opts = parseArgs();
  const artifactDir = path.resolve(getStringOpt(opts, "artifact", path.join(".tileforge", "external", "artifact")));
  const outDir = path.resolve(getStringOpt(opts, "out", path.join(artifactDir, "iree-runtime")));
  const timeoutMs = Number(getStringOpt(opts, "timeout-ms", "180000"));
  const requireExternal = hasFlag(opts, "require-external");
  const withTransform = !hasFlag(opts, "baseline-only");
  const repetitions = Math.max(1, Number(getStringOpt(opts, "repetitions", process.env.TILEFORGE_IREE_BENCH_REPETITIONS ?? "5")));
  const minTimeSec = Math.max(0.001, Number(getStringOpt(opts, "min-time-sec", process.env.TILEFORGE_IREE_BENCH_MIN_TIME_SEC ?? "0.05")));
  const warmupSec = Math.max(0, Number(getStringOpt(opts, "warmup-sec", process.env.TILEFORGE_IREE_BENCH_WARMUP_SEC ?? "0")));
  const correctness = hasFlag(opts, "correctness-checked") ? "checked" : hasFlag(opts, "correctness-mismatch") ? "mismatch" : "not-checked";
  const preferredCompile = getStringOpt(opts, "compile-cmd", process.env.TILEFORGE_IREE_COMPILE_CMD ?? "");
  const compileCommands = ireeCompileCommandCandidates(preferredCompile);
  const runtimeCommands = splitCommands(process.env.TILEFORGE_IREE_BENCH_CMD ?? process.env.TILEFORGE_IREE_RUN_CMD, ["iree-benchmark-module", "iree-run-module"]);

  await mkdir(outDir, { recursive: true });
  const inputMlir = path.join(artifactDir, "generated.mlir");
  const transform = path.join(artifactDir, "transform.mlir");
  const mlir = await readFile(inputMlir, "utf8");
  const functions = parseFunctions(mlir);
  if (!functions.length) throw new Error(`No func.func entries found in ${inputMlir}`);

  const variants: RuntimeCase[] = [
    {
      name: "baseline",
      vmfb: path.join(outDir, "baseline.vmfb"),
      compileLog: path.join(outDir, "compile-baseline.log"),
      compileArgs: [inputMlir, "--iree-hal-target-backends=llvm-cpu", "--iree-llvmcpu-target-cpu=host", "--iree-global-opt-enable-warn-on-uninitialized-values=false", "-o", path.join(outDir, "baseline.vmfb")],
    },
  ];
  if (withTransform) {
    variants.push({
      name: "hinted",
      vmfb: path.join(outDir, "hinted.vmfb"),
      compileLog: path.join(outDir, "compile-hinted.log"),
      compileArgs: [inputMlir, "--iree-hal-target-backends=llvm-cpu", "--iree-llvmcpu-target-cpu=host", "--iree-global-opt-enable-warn-on-uninitialized-values=false", `--iree-codegen-transform-dialect-library=${transform}`, "-o", path.join(outDir, "hinted.vmfb")],
    });
  }

  const compile: any[] = [];
  const runs: any[] = [];
  for (const variant of variants) {
    try {
      const result = await compileVariant(compileCommands, variant, outDir, timeoutMs);
      compile.push({ name: variant.name, ok: true, ...result });
      for (const spec of functions) {
        const run = await runBenchmark(runtimeCommands, variant.vmfb, spec, outDir, variant.name, timeoutMs, { repetitions, minTimeSec, warmupSec });
        runs.push({ variant: variant.name, function: spec.name, ...run });
      }
    } catch (error) {
      compile.push({ name: variant.name, ok: false, error: error instanceof Error ? error.message : String(error) });
      if (requireExternal) throw error;
    }
  }

  const ok = compile.some((c) => c.ok) && runs.some((r) => !r.error && !r.skipped);
  const generatedAt = new Date().toISOString();
  const baseSummary = {
    schema: "tileforge.iree-runtime-benchmark.v2",
    generatedAt,
    artifactDir,
    outDir,
    ok,
    skipped: !ok && !requireExternal,
    benchmarkOptions: { repetitions, minTimeSec, warmupSec, correctness },
    functions,
    compile,
    runs,
  };
  const decision = buildIreeRuntimeDecision(baseSummary, { generatedAt, correctness: correctness as "not-checked" | "checked" | "mismatch" });
  const summary = { ...baseSummary, decision };
  await writeFile(path.join(outDir, "iree_runtime_benchmark_report.json"), JSON.stringify(summary, null, 2), "utf8");
  await writeFile(path.join(outDir, "iree_runtime_benchmark_report.md"), markdown(summary), "utf8");
  await writeFile(path.join(outDir, "iree_runtime_decision.json"), JSON.stringify(decision, null, 2), "utf8");
  await writeFile(path.join(outDir, "iree_runtime_decision.md"), ireeRuntimeDecisionMarkdown(decision), "utf8");
  const refresh = await refreshPurposeGateWithRuntimeEvidence(artifactDir, decision, summary);
  await writeFile(path.join(outDir, "iree_runtime_purpose_gate_refresh.json"), JSON.stringify(refresh, null, 2), "utf8");
  console.log(`wrote ${path.join(outDir, "iree_runtime_benchmark_report.md")}`);
  if (refresh.refreshed) console.log(`refreshed ${path.join(artifactDir, "purpose_gate.md")} with IREE runtime evidence`);
  if (!ok && requireExternal) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
