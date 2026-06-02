import path from "node:path";
import { mkdir, readFile, readdir, rm, stat } from "node:fs/promises";
import type { JobRecord } from "@/types/job";
import type { estimateAll } from "@/lib/estimator";
import { scaleSimTopkCandidates } from "@/lib/mlir";
import { addLog, saveJob } from "./jobStore";
import {
  runExternalCommand,
  type ExternalCommandResult,
} from "./externalCommand";
import { jobDir } from "./workspace";
import { readTextTail as readTextTailFile } from "./fileTail";
import { atomicWriteFile } from "./atomic";
import {
  computeArtifactIntegrity,
  computeJobIntegrityManifest,
} from "./artifactIntegrity";
import { recordArtifactSqlite } from "./sqliteStore";
import {
  commandLabel,
  formatCandidateErrors,
  ireeCompileCommandCandidates,
  scaleSimArgs,
  scaleSimCommandCandidates,
  withPrependedPythonPath,
} from "./externalToolCandidates";
import type {
  ExternalRunSummary,
  ScaleSimLayerSummary,
} from "./externalRunTypes";
import {
  findFirstExistingFile,
  parseScaleSimLayerReports,
} from "./scaleSimReport";

async function runCommandCandidates(
  commands: string[],
  args: string[],
  cwd: string,
  timeoutMs: number,
  logPrefix: string,
  env?: Record<string, string | undefined>,
): Promise<{
  command: string;
  result: ExternalCommandResult;
  errors: Array<{ command: string; message: string }>;
  logPath: string;
}> {
  const errors: Array<{ command: string; message: string }> = [];
  for (const command of commands) {
    const safeName = commandLabel(command).replace(/[^a-zA-Z0-9_.-]+/g, "_");
    const logPath = path.join(cwd, `${logPrefix}-${safeName}.log`);
    try {
      const result = await runExternalCommand(command, args, {
        cwd,
        timeoutMs,
        logPath,
        env,
      });
      return { command, result, errors, logPath };
    } catch (error) {
      errors.push({
        command: commandLabel(command),
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }
  throw new Error(formatCandidateErrors(errors));
}

export async function runScaleSimForJob(
  job: JobRecord,
  res: ReturnType<typeof estimateAll>,
): Promise<ExternalRunSummary> {
  const dir = jobDir(job.id);
  const outDir = path.join(dir, "scalesim-output");
  await mkdir(outDir, { recursive: true });
  const commands = scaleSimCommandCandidates();
  const args = scaleSimArgs({
    config: path.join(dir, "scalesim.cfg"),
    topology: path.join(dir, "topology.csv"),
    layout: path.join(dir, "layout.csv"),
    outDir,
    useLayout: res.request.scaleSim?.useLayout !== false,
  });
  const startedAt = Date.now();
  try {
    const run = await runCommandCandidates(
      commands,
      args,
      outDir,
      job.timeoutMs ??
        Number(process.env.TILEFORGE_JOB_TIMEOUT_MS ?? 10 * 60 * 1000),
      "scalesim",
      withPrependedPythonPath(path.resolve("external/SCALE-Sim"), {
        TILEFORGE_MOCK_OUTPUT_DIR: outDir,
      }),
    );
    const computeReport = await findFirstExistingFile(
      outDir,
      "COMPUTE_REPORT.csv",
    );
    if (!computeReport)
      throw new Error(
        "SCALE-Sim 실행은 성공했지만 COMPUTE_REPORT.csv를 찾지 못했습니다",
      );
    const layerMetadata = res.results.map((r) => ({
      name: r.shape.opName,
      opName: r.shape.opName,
      shapeId: r.shape.id,
      predictedCycles: r.best.cycles,
      predictedTimeUs: r.best.timeUs,
      predictedUtilization: r.best.utilization,
      predictedPaddingRatio: r.best.paddingRatio,
      predictedSramBytes: r.best.sramBytes,
      tileM: r.best.tileM,
      tileN: r.best.tileN,
      tileK: r.best.tileK,
    }));
    const layers = (
      await parseScaleSimLayerReports(computeReport, layerMetadata)
    ).filter((layer) => layer.cycles > 0);
    const totalCycles = layers.reduce((sum, layer) => sum + layer.cycles, 0);
    const candidateLayers = await runScaleSimTopkForJob(job, res, commands);
    await pruneScaleSimRawOutputs(job, outDir, [computeReport]);
    const summary: ExternalRunSummary = {
      ok: true,
      skipped: false,
      tool: "scalesim",
      command: commandLabel(run.command),
      triedCommands: commands.map(commandLabel),
      elapsedMs: Date.now() - startedAt,
      logPath: path.relative(dir, run.logPath),
      computeReport: path.relative(dir, computeReport),
      layerCount: layers.length,
      totalCycles,
      layers,
      candidateLayers,
      cycleRatio:
        res.summary.totalCycles > 0
          ? totalCycles / res.summary.totalCycles
          : undefined,
    };
    await atomicWriteFile(
      path.join(dir, "scalesim_summary.json"),
      JSON.stringify(summary, null, 2),
    );
    job.artifacts = [
      ...new Set(
        [
          ...(job.artifacts ?? []),
          "scalesim_summary.json",
          summary.logPath,
          summary.computeReport,
          "scalesim_top3_summary.json",
        ].filter(Boolean) as string[],
      ),
    ];
    await saveJob(job);
    await addLog(
      job,
      `SCALE-Sim 완료: ${summary.computeReport}, 전체 cycle=${totalCycles.toLocaleString()}`,
    );
    return summary;
  } catch (error) {
    const files = await listFiles(outDir, 5);
    const logFiles = files.filter((file) =>
      file.toLowerCase().endsWith(".log"),
    );
    const logTails: string[] = [];
    for (const rel of logFiles.slice(-3)) {
      const tail = await readTextTail(path.join(outDir, rel));
      if (tail.trim()) logTails.push(`--- ${rel} ---\n${tail.trim()}`);
    }
    const baseError = error instanceof Error ? error.message : String(error);
    const message = [
      baseError,
      `files under scalesim-output: ${files.length ? files.join(", ") : "(none)"}`,
      logTails.length
        ? `log tail:\n${logTails.join("\n")}`
        : "log tail: (empty)",
    ].join("\n");
    const summary: ExternalRunSummary = {
      ok: false,
      skipped: false,
      tool: "scalesim",
      triedCommands: commands.map(commandLabel),
      elapsedMs: Date.now() - startedAt,
      error: message,
    };
    await atomicWriteFile(
      path.join(dir, "scalesim_summary.json"),
      JSON.stringify(summary, null, 2),
    );
    job.artifacts = [
      ...new Set([...(job.artifacts ?? []), "scalesim_summary.json"]),
    ];
    await saveJob(job);
    throw new Error(message);
  }
}

async function runScaleSimTopkForJob(
  job: JobRecord,
  res: ReturnType<typeof estimateAll>,
  commands: string[],
): Promise<ScaleSimLayerSummary[]> {
  const dir = jobDir(job.id);
  const metadata = scaleSimTopkCandidates(res).map((c) => ({
    name: c.layerName,
    ...c,
  }));
  if (!metadata.length) return [];
  const outDir = path.join(dir, "scalesim-top3-output");
  await mkdir(outDir, { recursive: true });
  const topology = path.join(dir, "topology_top3.csv");
  const layout = path.join(dir, "layout_top3.csv");
  const args = scaleSimArgs({
    config: path.join(dir, "scalesim.cfg"),
    topology,
    layout,
    outDir,
    useLayout: res.request.scaleSim?.useLayout !== false,
  });
  const startedAt = Date.now();
  const run = await runCommandCandidates(
    commands,
    args,
    outDir,
    job.timeoutMs ??
      Number(process.env.TILEFORGE_JOB_TIMEOUT_MS ?? 10 * 60 * 1000),
    "scalesim-top3",
    withPrependedPythonPath(path.resolve("external/SCALE-Sim"), {
      TILEFORGE_MOCK_OUTPUT_DIR: outDir,
    }),
  );
  const computeReport = await findFirstExistingFile(
    outDir,
    "COMPUTE_REPORT.csv",
  );
  if (!computeReport) {
    throw new Error(
      "SCALE-Sim top3 실행은 성공했지만 COMPUTE_REPORT.csv를 찾지 못했습니다",
    );
  }
  const layers = (
    await parseScaleSimLayerReports(computeReport, metadata)
  ).filter((layer) => layer.cycles > 0);
  await pruneScaleSimRawOutputs(job, outDir, [computeReport]);
  const summary = {
    ok: true,
    tool: "scalesim-top3",
    command: commandLabel(run.command),
    elapsedMs: Date.now() - startedAt,
    logPath: path.relative(dir, run.logPath),
    computeReport: path.relative(dir, computeReport),
    layerCount: layers.length,
    layers,
  };
  await atomicWriteFile(
    path.join(dir, "scalesim_top3_summary.json"),
    JSON.stringify(summary, null, 2),
  );
  job.artifacts = [
    ...new Set(
      [
        ...(job.artifacts ?? []),
        "scalesim_top3_summary.json",
        summary.logPath,
        summary.computeReport,
      ].filter(Boolean) as string[],
    ),
  ];
  await saveJob(job);
  await addLog(
    job,
    `SCALE-Sim top3 완료: ${summary.computeReport}, 후보 ${layers.length}개`,
  );
  return layers;
}

async function pruneScaleSimRawOutputs(
  job: JobRecord,
  root: string,
  keepFiles: string[] = [],
): Promise<{ removedFiles: number; removedBytes: number }> {
  if (process.env.TILEFORGE_KEEP_EXTERNAL_RAW === "1")
    return { removedFiles: 0, removedBytes: 0 };
  const keep = new Set(keepFiles.map((file) => path.resolve(file)));
  const keepNames = new Set([
    "COMPUTE_REPORT.csv",
    "DETAILED_ACCESS_REPORT.csv",
    "BANDWIDTH_REPORT.csv",
    "RUN_STATS.csv",
    "CONFIG.csv",
  ]);
  const maxSmallReportBytes = Number(
    process.env.TILEFORGE_EXTERNAL_KEEP_REPORT_MAX_BYTES ?? 25 * 1024 * 1024,
  );
  let removedFiles = 0;
  let removedBytes = 0;
  async function walk(dir: string): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await walk(full);
        continue;
      }
      if (!entry.isFile()) continue;
      const resolved = path.resolve(full);
      const upper = entry.name.toUpperCase();
      if (keep.has(resolved) || keepNames.has(entry.name)) continue;
      let size = 0;
      try {
        size = (await stat(full)).size;
      } catch {
        continue;
      }
      const looksVerbose =
        /TRACE|ACCESS|BW|BANDWIDTH|DETAILED|DRAM|SRAM|IFMAP|FILTER|OFMAP/i.test(
          entry.name,
        );
      const shouldDelete = looksVerbose || size > maxSmallReportBytes;
      if (!shouldDelete) continue;
      await rm(full, { force: true });
      removedFiles++;
      removedBytes += size;
    }
  }
  await walk(root);
  if (removedFiles) {
    const mib = removedBytes / 1024 / 1024;
    await addLog(
      job,
      `SCALE-Sim raw output 정리: ${removedFiles}개 파일, ${mib.toFixed(1)} MiB 삭제. 원본 전체 보존은 TILEFORGE_KEEP_EXTERNAL_RAW=1`,
    );
  }
  return { removedFiles, removedBytes };
}

async function readTextTail(file: string, maxChars = 4000): Promise<string> {
  try {
    return (await readTextTailFile(file, maxChars)).text;
  } catch {
    return "";
  }
}

async function listFiles(root: string, maxDepth = 4, maxFiles = 2000): Promise<string[]> {
  const files: string[] = [];
  let truncated = false;
  async function walk(dir: string, depth: number): Promise<void> {
    if (files.length >= maxFiles) { truncated = true; return; }
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (files.length >= maxFiles) { truncated = true; break; }
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full) || entry.name;
      if (entry.isFile()) files.push(rel);
      else if (entry.isDirectory() && depth > 0) await walk(full, depth - 1);
    }
  }
  await walk(root, maxDepth);
  const sorted = files.sort();
  if (truncated) sorted.push(`... truncated after ${maxFiles} files`);
  return sorted;
}

async function requireNonEmptyFile(
  file: string,
  label: string,
): Promise<number> {
  let s: Awaited<ReturnType<typeof stat>>;
  try {
    s = await stat(file);
  } catch {
    throw new Error(`${label} 파일이 생성되지 않았습니다: ${file}`);
  }
  if (!s.isFile()) throw new Error(`${label} 경로가 파일이 아닙니다: ${file}`);
  if (s.size <= 0 && process.env.TILEFORGE_ALLOW_EMPTY_VMFB !== "1") {
    throw new Error(`${label} 파일이 0 bytes입니다: ${file}`);
  }
  return s.size;
}

export async function runIreeForJob(
  job: JobRecord,
): Promise<ExternalRunSummary> {
  const dir = jobDir(job.id);
  const outDir = path.join(dir, "iree-output");
  await mkdir(outDir, { recursive: true });
  const commands = ireeCompileCommandCandidates();
  const vmfb = path.join(outDir, "model.vmfb");
  const useTransformHints =
    process.env.TILEFORGE_IREE_USE_TRANSFORM_HINTS === "1";
  const args = [
    path.join(dir, "generated.mlir"),
    "--iree-hal-target-backends=llvm-cpu",
    "--iree-llvmcpu-target-cpu=host",
    ...(process.env.TILEFORGE_IREE_SHOW_UNINITIALIZED_WARNINGS === "1"
      ? []
      : ["--iree-global-opt-enable-warn-on-uninitialized-values=false"]),
    ...(useTransformHints
      ? [
          `--iree-codegen-transform-dialect-library=${path.join(dir, "transform.mlir")}`,
        ]
      : []),
    "-o",
    vmfb,
  ];
  await addLog(
    job,
    useTransformHints
      ? "IREE compile에 transform.mlir lowering hint를 실험적으로 적용합니다"
      : "IREE compile은 baseline compileability 검증으로 실행합니다. lowering hint는 compiler_hints.md/json에 별도 저장됩니다",
  );
  const startedAt = Date.now();
  const errors: Array<{ command: string; message: string }> = [];

  for (const command of commands) {
    const safeName = commandLabel(command).replace(/[^a-zA-Z0-9_.-]+/g, "_");
    const logPath = path.join(dir, `iree-compile-${safeName}.log`);
    try {
      await runExternalCommand(command, args, {
        cwd: dir,
        timeoutMs:
          job.timeoutMs ??
          Number(process.env.TILEFORGE_JOB_TIMEOUT_MS ?? 10 * 60 * 1000),
        logPath,
        env: { TILEFORGE_MOCK_VMFB: vmfb },
      });
      const vmfbBytes = await requireNonEmptyFile(vmfb, "IREE VMFB");
      const summary: ExternalRunSummary = {
        ok: true,
        skipped: false,
        tool: "iree",
        command: commandLabel(command),
        triedCommands: commands.map(commandLabel),
        elapsedMs: Date.now() - startedAt,
        logPath: path.relative(dir, logPath),
        vmfb: path.relative(dir, vmfb),
        vmfbBytes,
      };
      await atomicWriteFile(
        path.join(dir, "iree_summary.json"),
        JSON.stringify(summary, null, 2),
      );
      job.artifacts = [
        ...new Set(
          [
            ...(job.artifacts ?? []),
            "iree_summary.json",
            summary.logPath,
            summary.vmfb,
          ].filter(Boolean) as string[],
        ),
      ];
      await saveJob(job);
      await addLog(
        job,
        `IREE compile 완료: ${summary.vmfb}, VMFB=${summary.vmfbBytes?.toLocaleString()} bytes`,
      );
      return summary;
    } catch (error) {
      const files = await listFiles(outDir, 3);
      const detail = error instanceof Error ? error.message : String(error);
      errors.push({
        command: commandLabel(command),
        message: `${detail}; files under iree-output: ${files.length ? files.join(", ") : "(none)"}; log=${path.relative(dir, logPath)}`,
      });
    }
  }

  const message =
    formatCandidateErrors(errors) ||
    "실행 가능한 IREE compiler 후보가 없습니다";
  const summary: ExternalRunSummary = {
    ok: false,
    skipped: false,
    tool: "iree",
    triedCommands: commands.map(commandLabel),
    elapsedMs: Date.now() - startedAt,
    error: message,
  };
  await atomicWriteFile(
    path.join(dir, "iree_summary.json"),
    JSON.stringify(summary, null, 2),
  );
  job.artifacts = [...new Set([...(job.artifacts ?? []), "iree_summary.json"])];
  await saveJob(job);
  throw new Error(message);
}

export async function readExternalSummary(
  dir: string,
  name: string,
): Promise<ExternalRunSummary | undefined> {
  try {
    return JSON.parse(await readFile(path.join(dir, name), "utf8"));
  } catch {
    return undefined;
  }
}

export async function refreshIntegrityManifest(job: JobRecord) {
  const dir = jobDir(job.id);
  const artifactNames = [
    ...new Set(
      [...(job.artifacts ?? []), "artifact_integrity.json"].filter(
        (name) => name !== "artifact_integrity.json",
      ),
    ),
  ];
  const integrity = await computeJobIntegrityManifest(job.id, artifactNames);
  await atomicWriteFile(
    path.join(dir, "artifact_integrity.json"),
    JSON.stringify(integrity, null, 2),
  );
  recordArtifactSqlite(
    job.id,
    await computeArtifactIntegrity(
      job.id,
      "artifact_integrity.json",
      "tileforge.integrity.v1",
    ),
  );
  job.artifacts = [...new Set([...artifactNames, "artifact_integrity.json"])];
  await saveJob(job);
}
