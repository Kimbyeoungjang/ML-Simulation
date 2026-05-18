import path from "node:path";
import { mkdir, readFile, readdir, stat } from "node:fs/promises";
import type { JobRecord } from "@/types/job";
import { estimateAll } from "@/lib/estimator";
import { scaleSimTopkCandidates } from "@/lib/mlir";
import { estimateMaybeThreaded } from "./threadedEstimate";
import { responseToPolicyEntries } from "@/lib/policyDb";
import {
  RESULT_SCHEMA_VERSION,
  POLICY_DB_SCHEMA_VERSION,
  stampArtifact,
} from "@/lib/schemas";
import {
  acquireJobLock,
  addLog,
  markStageDone,
  readJob,
  releaseJobLock,
  saveJob,
  updateJobStatus,
  updateProgress,
} from "./jobStore";
import {
  runExternalCommand,
  detectExternalToolVersion,
  type ExternalCommandResult,
} from "./externalCommand";
import { normalizeError } from "@/lib/errors";
import { nowIso } from "@/lib/determinism";
import { jobDir } from "./workspace";
import { atomicWriteFile, hasStageMarker, writeStageMarker } from "./atomic";
import {
  computeArtifactIntegrity,
  computeJobIntegrityManifest,
  verifyRequiredArtifacts,
} from "./artifactIntegrity";
import { assessConfidence, confidenceMarkdown } from "@/lib/confidence";
import { readEstimateCache, writeEstimateCache, cacheKey as estimateCacheKey } from "@/lib/cache";
import { totalCycleUncertainty } from "@/lib/uncertainty";
import { recordArtifactSqlite } from "./sqliteStore";
import {
  commandLabel,
  formatCandidateErrors,
  ireeCompileCommandCandidates,
  scaleSimArgs,
  scaleSimCommandCandidates,
  withPrependedPythonPath,
} from "./externalToolCandidates";

async function throwIfCancelled(job: JobRecord) {
  const latest = await readJob(job.id);
  if (latest.cancelRequested || latest.status === "cancelled") {
    job.status = "cancelled";
    job.stage = "cancelled";
    job.progress = 100;
    await saveJob(job);
    throw new Error("사용자가 job을 취소했습니다");
  }
}

async function withTimeout<T>(
  job: JobRecord,
  label: string,
  work: () => Promise<T>,
): Promise<T> {
  const timeoutMs =
    job.timeoutMs ??
    Number(process.env.TILEFORGE_JOB_TIMEOUT_MS ?? 10 * 60 * 1000);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs} ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function runJob(job: JobRecord, options: { lockHeld?: boolean } = {}) {
  let lockHeld = Boolean(options.lockHeld);
  if (!lockHeld) {
    lockHeld = await acquireJobLock(job);
    if (!lockHeld) {
      await addLog(job, "건너뜀: 다른 worker가 이미 이 job을 잠갔습니다");
      return;
    }
  }
  job.startedAt = job.startedAt ?? nowIso();
  job.attempts = (job.attempts ?? 0) + 1;
  await saveJob(job);
  try {
    await runJobOnce(job);
  } catch (e: any) {
    if (
      String(e?.message ?? e)
        .toLowerCase()
        .includes("cancelled")
    ) {
      await updateJobStatus(job, "cancelled", "Job 취소됨");
    } else if ((job.attempts ?? 1) < (job.maxAttempts ?? 1)) {
      const err = normalizeError(e);
      job.status = "queued";
      job.stage = "retrying";
      job.progress = 0;
      job.error = JSON.stringify(err.toJSON?.() ?? err, null, 2);
      await updateProgress(
        job,
        "retrying",
        0,
        `시도 ${job.attempts} 실패; 재시도: ${e?.message ?? e}`,
      );
    } else {
      const err = normalizeError(e);
      job.error = JSON.stringify(
        err.toJSON?.() ?? { message: String(e) },
        null,
        2,
      );
      await updateJobStatus(job, "failed", `실패: ${err.message}`);
    }
  } finally {
    if (lockHeld) await releaseJobLock(job);
  }
}

async function runJobOnce(job: JobRecord) {
  await updateJobStatus(
    job,
    "running",
    `${job.kind} job 시작: ${job.attempts ?? 1}번째 시도`,
  );
  await updateProgress(
    job,
    "validated",
    5,
    "요청을 검증하고 상태 machine을 초기화했습니다",
  );
  await throwIfCancelled(job);
  const versions = {
    scalesim: await detectExternalToolVersion(
      process.env.TILEFORGE_SCALE_SIM_CMD,
    ),
    iree: await detectExternalToolVersion(
      process.env.TILEFORGE_IREE_COMPILE_CMD,
    ),
  };
  if (versions.scalesim)
    await addLog(job, `SCALE-Sim 버전: ${versions.scalesim}`);
  if (versions.iree) await addLog(job, `IREE 버전: ${versions.iree}`);

  let res: ReturnType<typeof estimateAll> | undefined;
  const dir = jobDir(job.id);
  if (!(await hasStageMarker(dir, "estimate"))) {
    await updateProgress(job, "estimating", 15, "Estimator 실행 중");
    const cached = await readEstimateCache(job.request);
    if (cached) {
      res = cached;
      await addLog(job, `Estimator cache hit: ${estimateCacheKey(job.request)}`);
    } else {
      res = await estimateMaybeThreaded(job.request);
      await writeEstimateCache(job.request, res);
      await addLog(job, `Estimator cache 저장: ${estimateCacheKey(job.request)}`);
    }
    await writeStageMarker(dir, "estimate", {
      totalCycles: res.summary.totalCycles,
      cacheKey: estimateCacheKey(job.request),
    });
    await markStageDone(job, "estimating", "Estimator 완료");
  } else {
    await updateProgress(
      job,
      "estimating",
      35,
      "완료된 estimator 단계를 재사용합니다",
    );
    res = (await readEstimateCache(job.request)) ?? await estimateMaybeThreaded(job.request);
  }

  await updateProgress(
    job,
    "generating-artifacts",
    45,
    "산출물을 atomic 방식으로 생성 중",
  );
  await writeArtifacts(job, res, versions);
  await writeStageMarker(dir, "artifacts", { count: job.artifacts.length });
  await throwIfCancelled(job);

  let scaleSummary: ExternalRunSummary | undefined;
  let ireeSummary: ExternalRunSummary | undefined;

  if (job.kind === "scalesim" || job.kind === "full-pipeline") {
    if (!(await hasStageMarker(dir, "scalesim"))) {
      await updateProgress(
        job,
        "running-scalesim",
        65,
        "SCALE-Sim 실제 실행 중",
      );
      scaleSummary = await withTimeout(job, "SCALE-Sim", () =>
        runScaleSimForJob(job, res),
      );
      await writeStageMarker(dir, "scalesim", scaleSummary);
    } else {
      await addLog(job, "완료된 SCALE-Sim 단계를 재사용합니다");
      scaleSummary = await readExternalSummary(dir, "scalesim_summary.json");
    }
  }
  await throwIfCancelled(job);

  if (job.kind === "iree-compile" || job.kind === "full-pipeline") {
    if (!(await hasStageMarker(dir, "iree"))) {
      await updateProgress(
        job,
        "running-iree",
        82,
        "IREE 실제 compile 실행 중",
      );
      ireeSummary = await withTimeout(job, "IREE compile", () =>
        runIreeForJob(job),
      );
      await writeStageMarker(dir, "iree", ireeSummary);
    } else {
      await addLog(job, "완료된 IREE 단계를 재사용합니다");
      ireeSummary = await readExternalSummary(dir, "iree_summary.json");
    }
  }
  await updateProgress(
    job,
    "generating-report",
    95,
    "SCALE-Sim/IREE 결과를 보고서에 반영 중",
  );
  await appendExternalReport(job, res, scaleSummary, ireeSummary);
  await refreshIntegrityManifest(job);
  await writeStageMarker(dir, "report");
  await updateProgress(job, "done", 100, "완료");
  const required = await verifyRequiredArtifacts(job.id);
  if (!required.ok) {
    const detail = `산출물 무결성 검사 실패. 누락=${required.missing.join(",") || "없음"}; 실패=${required.integrityFailures.map((f) => `${f.name}:${f.reason}`).join(";") || "없음"}`;
    job.error = detail;
    await updateJobStatus(job, "failed", detail);
    return;
  }
  const warnings = job.warnings ?? [];
  await updateJobStatus(
    job,
    warnings.length ? "succeeded_with_warnings" : "succeeded",
    warnings.length ? `Job 완료: 경고 ${warnings.length}개` : "Job 완료",
  );
}

async function writeArtifacts(
  job: JobRecord,
  res: ReturnType<typeof estimateAll>,
  versions?: { scalesim?: string; iree?: string },
) {
  const dir = jobDir(job.id);
  const resultJson = JSON.stringify(
    stampArtifact(RESULT_SCHEMA_VERSION, { response: res }),
    null,
    2,
  );
  const policyDbJson = JSON.stringify(
    stampArtifact(POLICY_DB_SCHEMA_VERSION, {
      entries: responseToPolicyEntries(res),
    }),
    null,
    2,
  );
  const confidence = assessConfidence(res, {
    externalValidated: Boolean(res.artifacts.validationCsv),
    calibrationSamples: res.request.calibration?.samples?.length ?? 0,
  });
  const uncertainty = totalCycleUncertainty(res);
  const artifacts: Record<string, string> = {
    "best_tile_policy.csv": res.artifacts.policyCsv,
    "generated.mlir": res.artifacts.mlir,
    "transform.mlir": res.artifacts.transformDialect,
    "report.md": res.artifacts.reportMarkdown,
    "scalesim.cfg": res.artifacts.scaleSimConfig,
    "topology.csv": res.artifacts.scaleSimTopology,
    "layout.csv": res.artifacts.scaleSimLayout ?? "",
    "topology_top3.csv": res.artifacts.scaleSimTopkTopology ?? "",
    "layout_top3.csv": res.artifacts.scaleSimTopkLayout ?? "",
    "project.json": res.artifacts.projectJson,
    "manifest.json": res.artifacts.manifestJson ?? "{}",
    "iree-command.sh": res.artifacts.ireeCommand ?? "",
    "policy_table.tex": res.artifacts.latexTable ?? "",
    "summary.svg": res.artifacts.svgSummary ?? "",
    "experiment_comparison.csv": res.artifacts.experimentComparisonCsv ?? "",
    "validation_report.md": res.artifacts.validationMarkdown ?? "",
    "validation_report.csv": res.artifacts.validationCsv ?? "",
    "robust_policy.md": res.artifacts.robustPolicyMarkdown ?? "",
    "robust_policy.csv": res.artifacts.robustPolicyCsv ?? "",
    "dataflow_comparison.csv": res.artifacts.dataflowComparisonCsv ?? "",
    "memory_traffic.csv": res.artifacts.memoryTrafficCsv ?? "",
    "prune_report.txt": res.artifacts.pruneReportMarkdown ?? "",
    "tile_schedule.svg": res.artifacts.tileScheduleSvg ?? "",
    "confidence.md": confidenceMarkdown(confidence),
    "uncertainty.json": JSON.stringify(uncertainty, null, 2),
    "external_tools.json": JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        scalesim: {
          configured: Boolean(process.env.TILEFORGE_SCALE_SIM_CMD),
          version: versions?.scalesim ?? null,
        },
        iree: {
          configured: Boolean(process.env.TILEFORGE_IREE_COMPILE_CMD),
          version: versions?.iree ?? null,
        },
      },
      null,
      2,
    ),
    "policy-db.json": policyDbJson,
    "result.json": resultJson,
  };
  for (const [name, content] of Object.entries(artifacts))
    await atomicWriteFile(path.join(dir, name), content);
  const artifactNames = Object.keys(artifacts);
  const integrity = await computeJobIntegrityManifest(job.id, artifactNames);
  await atomicWriteFile(
    path.join(dir, "artifact_integrity.json"),
    JSON.stringify(integrity, null, 2),
  );
  for (const item of integrity.artifacts) recordArtifactSqlite(job.id, item);
  recordArtifactSqlite(
    job.id,
    await computeArtifactIntegrity(
      job.id,
      "artifact_integrity.json",
      "tileforge.integrity.v1",
    ),
  );
  job.artifacts = [
    ...new Set([
      ...(job.artifacts ?? []),
      ...artifactNames,
      "artifact_integrity.json",
    ]),
  ];
  await saveJob(job);
  await addLog(
    job,
    `${artifactNames.length}개 산출물을 atomic rename으로 저장하고 SHA-256 checksum을 기록했습니다`,
  );
}

type ExternalRunSummary = {
  ok: boolean;
  skipped: boolean;
  tool: "scalesim" | "iree";
  command?: string;
  triedCommands: string[];
  elapsedMs?: number;
  error?: string;
  logPath?: string;
  computeReport?: string;
  layerCount?: number;
  totalCycles?: number;
  cycleRatio?: number;
  vmfb?: string;
  vmfbBytes?: number;
  layers?: ScaleSimLayerSummary[];
  candidateLayers?: ScaleSimLayerSummary[];
};

type ScaleSimLayerSummary = {
  name: string;
  opName?: string;
  shapeId?: string;
  rank?: number;
  tileM?: number;
  tileN?: number;
  tileK?: number;
  tileCount?: number;
  cycles: number;
  cyclesPerTile?: number;
  predictedCycles?: number;
  predictedTimeUs?: number;
  predictedUtilization?: number;
  predictedPaddingRatio?: number;
  predictedSramBytes?: number;
  totalCyclesInclPrefetch?: number;
  stallCycles?: number;
  overallUtil?: number;
  mappingEfficiency?: number;
  computeUtil?: number;
  sramAccesses?: number;
  dramAccesses?: number;
};

async function fileSize(file: string): Promise<number> {
  try {
    return (await stat(file)).size;
  } catch {
    return 0;
  }
}

function csvRows(text: string): Array<Record<string, string>> {
  const lines = text.trim().split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = splitCsvLine(lines[0]).map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = splitCsvLine(line);
    const row: Record<string, string> = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ?? "";
    });
    return row;
  });
}

function splitCsvLine(line: string): string[] {
  const values: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (quoted && line[i + 1] === '"') {
        current += '"';
        i++;
      } else quoted = !quoted;
    } else if (ch === "," && !quoted) {
      values.push(current);
      current = "";
    } else current += ch;
  }
  values.push(current);
  return values;
}

function stringFromRow(
  row: Record<string, string>,
  names: string[],
): string | undefined {
  for (const name of names) {
    const value = row[name];
    if (value !== undefined && String(value).trim())
      return String(value).trim();
  }
  return undefined;
}

function numberFromRow(
  row: Record<string, string>,
  names: string[],
): number | undefined {
  for (const name of names) {
    const value = row[name];
    if (value === undefined) continue;
    const n = Number(String(value).replace(/[% ,]/g, ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

const cycleColumnNames = [
  "Cycles",
  "Total Cycles",
  "Total cycles",
  "Compute cycles",
  "Compute Cycles",
  "Total_compute_cycles",
];

async function readCsvRowsIfExists(file: string): Promise<Array<Record<string, string>>> {
  try {
    return csvRows(await readFile(file, "utf8"));
  } catch {
    return [];
  }
}

async function parseScaleSimLayerReports(
  computeReport: string,
  metadata: Array<Partial<ScaleSimLayerSummary>> = [],
): Promise<ScaleSimLayerSummary[]> {
  const reportDir = path.dirname(computeReport);
  const computeRows = await readCsvRowsIfExists(computeReport);
  const bandwidthRows = await readCsvRowsIfExists(path.join(reportDir, "BANDWIDTH_REPORT.csv"));
  const detailRows = await readCsvRowsIfExists(path.join(reportDir, "DETAILED_ACCESS_REPORT.csv"));
  return computeRows.map((row, index) => {
    const meta = metadata[index] ?? {};
    const cyclesPerTile = numberFromRow(row, cycleColumnNames) ?? 0;
    const tileCount = meta.tileCount && meta.tileCount > 0 ? meta.tileCount : undefined;
    const detail = detailRows[index] ?? {};
    const sramAccesses =
      (numberFromRow(detail, ["SRAM IFMAP Reads"]) ?? 0) +
      (numberFromRow(detail, ["SRAM Filter Reads"]) ?? 0) +
      (numberFromRow(detail, ["SRAM OFMAP Writes"]) ?? 0);
    const dramAccesses =
      (numberFromRow(detail, ["DRAM IFMAP Reads"]) ?? 0) +
      (numberFromRow(detail, ["DRAM Filter Reads"]) ?? 0) +
      (numberFromRow(detail, ["DRAM OFMAP Writes"]) ?? 0);
    const bandwidth = bandwidthRows[index] ?? {};
    return {
      ...meta,
      name:
        meta.name ??
        stringFromRow(row, ["Layer Name", "Layer name", "Layer", "layer", "Name", "name"]) ??
        `layer_${index + 1}`,
      cycles: tileCount ? cyclesPerTile * tileCount : cyclesPerTile,
      cyclesPerTile: tileCount ? cyclesPerTile : undefined,
      totalCyclesInclPrefetch: numberFromRow(row, ["Total Cycles (incl. prefetch)", "Total Cycles incl. prefetch"]),
      stallCycles: numberFromRow(row, ["Stall Cycles"]),
      overallUtil: numberFromRow(row, ["Overall Util %"]),
      mappingEfficiency: numberFromRow(row, ["Mapping Efficiency %"]),
      computeUtil: numberFromRow(row, ["Compute Util %"]),
      sramAccesses,
      dramAccesses,
      ...Object.fromEntries(Object.entries({
        avgIfmapSramBw: numberFromRow(bandwidth, ["Avg IFMAP SRAM BW"]),
        avgFilterSramBw: numberFromRow(bandwidth, ["Avg FILTER SRAM BW"]),
        avgOfmapSramBw: numberFromRow(bandwidth, ["Avg OFMAP SRAM BW"]),
        avgIfmapDramBw: numberFromRow(bandwidth, ["Avg IFMAP DRAM BW"]),
        avgFilterDramBw: numberFromRow(bandwidth, ["Avg FILTER DRAM BW"]),
        avgOfmapDramBw: numberFromRow(bandwidth, ["Avg OFMAP DRAM BW"]),
      }).filter(([, value]) => value !== undefined)),
    };
  });
}

async function findFirstExistingFile(
  root: string,
  fileName: string,
  maxDepth = 8,
): Promise<string | undefined> {
  const wanted = fileName.toLowerCase();
  async function walk(dir: string, depth: number): Promise<string | undefined> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return undefined;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const lower = entry.name.toLowerCase();
      if (entry.isFile() && lower === wanted) return full;
      if (
        entry.isFile() &&
        lower.endsWith(".csv") &&
        lower.includes("compute") &&
        lower.includes("report")
      )
        return full;
    }
    if (depth <= 0) return undefined;
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const found = await walk(path.join(dir, entry.name), depth - 1);
      if (found) return found;
    }
    return undefined;
  }
  return walk(root, maxDepth);
}

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

async function runScaleSimForJob(
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
    const layers = (await parseScaleSimLayerReports(computeReport, layerMetadata))
      .filter((layer) => layer.cycles > 0);
    const totalCycles = layers.reduce((sum, layer) => sum + layer.cycles, 0);
    const candidateLayers = await runScaleSimTopkForJob(job, res, commands);
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
    const logFiles = files.filter((file) => file.toLowerCase().endsWith(".log"));
    const logTails: string[] = [];
    for (const rel of logFiles.slice(-3)) {
      const tail = await readTextTail(path.join(outDir, rel));
      if (tail.trim()) logTails.push(`--- ${rel} ---\n${tail.trim()}`);
    }
    const baseError = error instanceof Error ? error.message : String(error);
    const message = [
      baseError,
      `files under scalesim-output: ${files.length ? files.join(", ") : "(none)"}`,
      logTails.length ? `log tail:\n${logTails.join("\n")}` : "log tail: (empty)",
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
  const computeReport = await findFirstExistingFile(outDir, "COMPUTE_REPORT.csv");
  if (!computeReport) {
    throw new Error("SCALE-Sim top3 실행은 성공했지만 COMPUTE_REPORT.csv를 찾지 못했습니다");
  }
  const layers = (await parseScaleSimLayerReports(computeReport, metadata))
    .filter((layer) => layer.cycles > 0);
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


async function readTextTail(file: string, maxChars = 4000): Promise<string> {
  try {
    const text = await readFile(file, "utf8");
    return text.length > maxChars ? text.slice(-maxChars) : text;
  } catch {
    return "";
  }
}

async function listFiles(root: string, maxDepth = 4): Promise<string[]> {
  const files: string[] = [];
  async function walk(dir: string, depth: number): Promise<void> {
    let entries: import("node:fs").Dirent[];
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full) || entry.name;
      if (entry.isFile()) files.push(rel);
      else if (entry.isDirectory() && depth > 0) await walk(full, depth - 1);
    }
  }
  await walk(root, maxDepth);
  return files.sort();
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

async function runIreeForJob(job: JobRecord): Promise<ExternalRunSummary> {
  const dir = jobDir(job.id);
  const outDir = path.join(dir, "iree-output");
  await mkdir(outDir, { recursive: true });
  const commands = ireeCompileCommandCandidates();
  const vmfb = path.join(outDir, "model.vmfb");
  const args = [
    path.join(dir, "generated.mlir"),
    "--iree-hal-target-backends=llvm-cpu",
    "--iree-llvmcpu-target-cpu=host",
    ...(process.env.TILEFORGE_IREE_SHOW_UNINITIALIZED_WARNINGS === "1"
      ? []
      : ["--iree-global-opt-enable-warn-on-uninitialized-values=false"]),
    "-o",
    vmfb,
  ];
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

async function readExternalSummary(
  dir: string,
  name: string,
): Promise<ExternalRunSummary | undefined> {
  try {
    return JSON.parse(await readFile(path.join(dir, name), "utf8"));
  } catch {
    return undefined;
  }
}

function formatPctDelta(actual: number, predicted: number): string {
  if (!Number.isFinite(actual) || !Number.isFinite(predicted) || predicted <= 0)
    return "해당 없음";
  const pct = ((actual - predicted) / predicted) * 100;
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`;
}

function externalComparisonMarkdown(
  res: ReturnType<typeof estimateAll>,
  scale?: ExternalRunSummary,
): string {
  const predictedTotal = res.summary.totalCycles;
  const actualTotal = scale?.totalCycles;
  const hasActual = Boolean(scale?.ok && actualTotal && actualTotal > 0);
  const ratio = hasActual ? actualTotal! / predictedTotal : undefined;
  const absDelta = hasActual ? actualTotal! - predictedTotal : undefined;
  const verdict = !hasActual
    ? "SCALE-Sim 결과가 아직 없어 비교할 수 없습니다."
    : ratio! > 1.15
      ? "SCALE-Sim cycle이 estimator보다 큽니다. 경계 타일, array fill/drain, 메모리 대기, 데이터플로우 모델이 estimator보다 더 보수적으로 반영되었을 가능성이 큽니다."
      : ratio! < 0.85
        ? "SCALE-Sim cycle이 estimator보다 작습니다. TileForge estimator가 padding 또는 pipeline 비용을 더 보수적으로 잡았거나, SCALE-Sim topology가 단순한 compute path로 해석되었을 가능성이 있습니다."
        : "SCALE-Sim과 estimator가 비교적 잘 맞습니다. 현재 타일 정책은 외부 시뮬레이터 기준에서도 큰 괴리 없이 동작하는 편입니다.";
  const lines = [
    "## 2-2. 예측 결과와 실제 실행 결과 비교",
    "| 항목 | TileForge estimator | SCALE-Sim 실제 실행 | 차이 | 해석 |",
    "|---|---:|---:|---:|---|",
    `| 전체 cycle | ${predictedTotal.toLocaleString()} | ${hasActual ? actualTotal!.toLocaleString() : "대기 중"} | ${hasActual ? `${absDelta! >= 0 ? "+" : ""}${absDelta!.toLocaleString()} (${formatPctDelta(actualTotal!, predictedTotal)})` : "대기 중"} | ${hasActual ? `SCALE-Sim / estimator = ${ratio!.toFixed(3)}배` : "full-pipeline 완료 후 갱신"} |`,
    "",
    `- 분석: ${verdict}`,
    "- 주의: IREE compile 성공은 `generated.mlir`의 컴파일 가능성을 검증하는 단계입니다. 실제 성능 비교의 cycle 기준은 SCALE-Sim 결과를 사용합니다.",
  ];
  if (hasActual && scale?.layers?.length) {
    lines.push(
      "",
      "### SCALE-Sim layer별 cycle 상위 항목",
      "| 순위 | SCALE-Sim layer | cycle | 비중 |",
      "|---:|---|---:|---:|",
    );
    const total = actualTotal!;
    for (const [index, layer] of [...scale.layers]
      .sort((a, b) => b.cycles - a.cycles)
      .slice(0, 8)
      .entries()) {
      lines.push(
        `| ${index + 1} | ${layer.name} | ${layer.cycles.toLocaleString()} | ${((layer.cycles / total) * 100).toFixed(1)}% |`,
      );
    }
    lines.push(
      "",
      "### TileForge op별 예측 cycle 상위 항목",
      "| 순위 | 연산 | 예측 cycle | 비중 |",
      "|---:|---|---:|---:|",
    );
    for (const [index, item] of [...res.results]
      .sort((a, b) => b.best.cycles - a.best.cycles)
      .slice(0, 8)
      .entries()) {
      lines.push(
        `| ${index + 1} | ${item.shape.model}.${item.shape.opName} | ${item.best.cycles.toLocaleString()} | ${((item.best.cycles / predictedTotal) * 100).toFixed(1)}% |`,
      );
    }
    if (scale.candidateLayers?.length) {
      lines.push(
        "",
        "### SCALE-Sim top3 tile 후보 검증",
        "| 연산 | rank | tile | TileForge cycle | SCALE-Sim extrapolated cycle | 차이 | SCALE-Sim util |",
        "|---|---:|---|---:|---:|---:|---:|",
      );
      for (const layer of scale.candidateLayers.slice(0, 12)) {
        const predicted = layer.predictedCycles ?? 0;
        const delta = predicted > 0 ? ((layer.cycles - predicted) / predicted) * 100 : 0;
        lines.push(
          `| ${layer.opName ?? layer.name} | ${layer.rank ?? "-"} | ${layer.tileM}x${layer.tileN}x${layer.tileK} | ${predicted.toLocaleString()} | ${Math.round(layer.cycles).toLocaleString()} | ${predicted > 0 ? `${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%` : "해당 없음"} | ${layer.overallUtil !== undefined ? `${layer.overallUtil.toFixed(1)}%` : "해당 없음"} |`,
        );
      }
    }
  }
  lines.push("");
  return lines.join("\n");
}

function externalAppliedQuickMarkdown(
  res: ReturnType<typeof estimateAll>,
  scale?: ExternalRunSummary,
  iree?: ExternalRunSummary,
): string {
  const scaleApplied = Boolean(
    scale?.ok && scale.computeReport && (scale.totalCycles ?? 0) > 0,
  );
  const ireeApplied = Boolean(
    iree?.ok && iree.vmfb && (iree.vmfbBytes ?? 0) > 0,
  );
  const ratio =
    scale?.cycleRatio !== undefined ? scale.cycleRatio.toFixed(3) : "해당 없음";
  const verdict =
    scaleApplied && ireeApplied
      ? "성공"
      : scaleApplied || ireeApplied
        ? "부분 반영"
        : "대기/실패";
  return [
    "## 2-1. 실제 외부 도구 반영 상태",
    `**최종 판정: ${verdict}**`,
    "",
    `- **TileForge estimator**: 적용됨`,
    `  - 근거: 전체 예상 cycle ${res.summary.totalCycles.toLocaleString()}`,
    `- **SCALE-Sim**: ${scaleApplied ? "적용됨" : "미반영"}`,
    `  - 근거: ${scaleApplied ? `COMPUTE_REPORT.csv 파싱 완료, cycle ${scale?.totalCycles?.toLocaleString()}, estimator 대비 ${ratio}배` : (scale?.error ?? "실행 결과 없음")}`,
    `- **IREE compile**: ${ireeApplied ? "적용됨" : "미반영"}`,
    `  - 근거: ${ireeApplied ? `model.vmfb 생성 완료, ${iree?.vmfbBytes?.toLocaleString()} bytes` : (iree?.error ?? "실행 결과 없음")}`,
    `- **외부 검증 갱신**: 적용됨`,
    `  - 근거: ${new Date().toISOString()}에 full-pipeline 결과로 report.md를 다시 썼습니다.`,
    `- **해석**: ${scaleApplied && ireeApplied ? "SCALE-Sim + IREE 결과가 이 보고서에 반영되었습니다." : "외부 도구 결과가 일부 또는 전부 누락되었습니다."}`,
    "",
    externalComparisonMarkdown(res, scale),
  ].join("\n");
}

function externalReportMarkdown(
  res: ReturnType<typeof estimateAll>,
  scale?: ExternalRunSummary,
  iree?: ExternalRunSummary,
): string {
  const scaleRatio =
    scale?.cycleRatio !== undefined
      ? `${scale.cycleRatio.toFixed(4)}배`
      : "해당 없음";
  const scaleApplied = Boolean(scale?.ok && scale.computeReport);
  const ireeApplied = Boolean(
    iree?.ok && iree.vmfb && (iree.vmfbBytes ?? 0) > 0,
  );
  const overallApplied = scaleApplied && ireeApplied;
  return (
    [
      "# 실제 외부 도구 검증 보고서",
      "",
      `생성 시각: ${new Date().toISOString()}`,
      "",
      "## 0. 적용 여부 한눈에 보기",
      `- 최종 판정: ${overallApplied ? "실제 SCALE-Sim + IREE 결과가 보고서에 반영됨" : "일부 외부 도구 결과가 반영되지 않음"}`,
      `- SCALE-Sim 반영: ${scaleApplied ? `예 (${scale?.computeReport})` : "아니오"}`,
      `- IREE compile 반영: ${ireeApplied ? `예 (${iree?.vmfb}, ${iree?.vmfbBytes?.toLocaleString()} bytes)` : "아니오"}`,
      `- 보고서에서 확인할 위치: report.md의 "2-1. 실제 외부 도구 반영 상태"와 이 파일의 "SCALE-Sim 실제 실행 결과", "IREE 실제 compile 결과"`,
      `- 원본 산출물: ${scale?.computeReport ?? "COMPUTE_REPORT 없음"}, ${iree?.vmfb ?? "VMFB 없음"}`,
      "",
      "## 1. TileForge estimator 기준값",
      `- 전체 예상 cycle: ${res.summary.totalCycles.toLocaleString()}`,
      `- 전체 예상 시간: ${res.summary.totalTimeUs.toFixed(3)} us`,
      "",
      "## 2. SCALE-Sim 실제 실행 결과",
      `- 상태: ${scale?.ok ? "성공" : scale ? "실패" : "실행 안 함"}`,
      `- 사용 명령: ${scale?.command ?? "해당 없음"}`,
      `- COMPUTE_REPORT: ${scale?.computeReport ?? "해당 없음"}`,
      `- layer 수: ${scale?.layerCount ?? "해당 없음"}`,
      `- SCALE-Sim 전체 cycle: ${scale?.totalCycles?.toLocaleString() ?? "해당 없음"}`,
      `- SCALE-Sim / TileForge cycle 비율: ${scaleRatio}`,
      scale?.error ? `- 오류: ${scale.error}` : "",
      "",
      "## 3. IREE 실제 compile 결과",
      `- 상태: ${iree?.ok ? "성공" : iree ? "실패" : "실행 안 함"}`,
      `- 사용 명령: ${iree?.command ?? "해당 없음"}`,
      `- VMFB: ${iree?.vmfb ?? "해당 없음"}`,
      `- VMFB 크기: ${iree?.vmfbBytes?.toLocaleString() ?? "해당 없음"} bytes`,
      iree?.error ? `- 오류: ${iree.error}` : "",
      "",
      "## 4. 예측 결과와 실제 실행 결과 비교",
      `- TileForge estimator 전체 cycle: ${res.summary.totalCycles.toLocaleString()}`,
      `- SCALE-Sim 전체 cycle: ${scale?.totalCycles?.toLocaleString() ?? "해당 없음"}`,
      `- 절대 차이: ${scale?.totalCycles !== undefined ? `${scale.totalCycles - res.summary.totalCycles >= 0 ? "+" : ""}${(scale.totalCycles - res.summary.totalCycles).toLocaleString()}` : "해당 없음"}`,
      `- 상대 차이: ${scale?.totalCycles !== undefined ? formatPctDelta(scale.totalCycles, res.summary.totalCycles) : "해당 없음"}`,
      `- SCALE-Sim / TileForge 비율: ${scaleRatio}`,
      "- 해석: 비율이 1보다 크면 SCALE-Sim이 estimator보다 더 많은 pipeline, 경계, 메모리 비용을 반영한 것입니다. 비율이 1보다 작으면 estimator가 padding/타일 비용을 더 보수적으로 잡았거나 SCALE-Sim topology가 단순하게 해석된 것입니다.",
      "",
      "## 5. 어떻게 해석하면 되는가",
      "- `SCALE-Sim 반영: 예`이면 `COMPUTE_REPORT.csv`에서 파싱한 cycle이 이 검증 보고서에 들어온 것입니다.",
      "- `IREE compile 반영: 예`이고 VMFB 크기가 0보다 크면 `generated.mlir`이 실제 IREE compiler를 통과해 `model.vmfb`를 만든 것입니다.",
      "- 두 항목이 모두 `예`이면 estimator 단독 결과가 아니라, SCALE-Sim cycle과 IREE compile 산출물까지 같이 남은 실행으로 보면 됩니다.",
      "- 단, IREE compile 성공은 실행 성능 측정이 아니라 컴파일 가능성 검증입니다. 실제 런타임 성능은 별도 benchmark가 필요합니다.",
    ]
      .filter(Boolean)
      .join("\n") + "\n"
  );
}

async function appendExternalReport(
  job: JobRecord,
  res: ReturnType<typeof estimateAll>,
  scale?: ExternalRunSummary,
  iree?: ExternalRunSummary,
) {
  const dir = jobDir(job.id);
  const report = externalReportMarkdown(res, scale, iree);
  await atomicWriteFile(
    path.join(dir, "external_validation_report.md"),
    report,
  );
  let baseReport = "";
  try {
    baseReport = await readFile(path.join(dir, "report.md"), "utf8");
  } catch {
    baseReport = res.artifacts.reportMarkdown;
  }
  const marker = "\n---\n\n# 실제 외부 도구 검증 보고서\n";
  const baseWithoutExternal = baseReport.includes(marker)
    ? baseReport.slice(0, baseReport.indexOf(marker))
    : baseReport.trimEnd();
  const quick = externalAppliedQuickMarkdown(res, scale, iree).trimEnd();
  const quickPattern =
    /## 2-1\. 실제 외부 도구 반영 상태\n[\s\S]*?(?=\n## 3\. 최적 타일 정책)/;
  const withQuick = quickPattern.test(baseWithoutExternal)
    ? baseWithoutExternal.replace(quickPattern, quick + "\n")
    : baseWithoutExternal.replace(
        /\n## 3\. 최적 타일 정책/,
        `\n${quick}\n## 3. 최적 타일 정책`,
      );
  await atomicWriteFile(
    path.join(dir, "report.md"),
    `${withQuick.trimEnd()}${marker}${report.replace(/^# 실제 외부 도구 검증 보고서\n+/, "")}`,
  );
  const externalValidated = Boolean((scale?.ok && (scale.totalCycles ?? 0) > 0) && (iree?.ok && (iree.vmfbBytes ?? 0) > 0));
  const confidence = assessConfidence(res, {
    externalValidated,
    calibrationSamples: res.request.calibration?.samples?.length ?? 0,
    externalCycleRatio: scale?.cycleRatio,
  });
  await atomicWriteFile(path.join(dir, "confidence.md"), confidenceMarkdown(confidence));
  job.artifacts = [
    ...new Set([
      ...(job.artifacts ?? []),
      "external_validation_report.md",
      "report.md",
      "confidence.md",
    ]),
  ];
  await saveJob(job);
}

async function refreshIntegrityManifest(job: JobRecord) {
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
