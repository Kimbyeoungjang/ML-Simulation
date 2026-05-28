import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { parseSearchRequest, formatZodError } from "@/lib/validation";
import {
  buildTpuBenchmarkRows,
  compareTpuMeasurements,
  compareTpuSamples,
  parseTpuBenchmarkExportCsv,
  parseTpuMeasurementCsv,
  parseTpuSampleCsv,
  tpuBenchmarkRowsToCsv,
  tpuCalibrationCsv,
  tpuComparisonRowsToCsv,
  tpuSampleComparisonRowsToCsv,
  summarizeTpuRecommendation,
  type TpuComparisonRow,
  type TpuSampleComparisonRow,
} from "@/lib/tpuBenchmark";
import { nowIso, stableId } from "@/lib/determinism";

const WEB_TPU_ROOT = path.join(process.cwd(), ".tileforge", "tpu-web");
const RUN_ENABLED = process.env.TILEFORGE_ENABLE_TPU_WEB_RUN === "1" || process.env.TILEFORGE_ENABLE_TPU_WEB_RUN === "true";
const DEFAULT_TIMEOUT_MS = Math.max(10_000, Number(process.env.TILEFORGE_TPU_WEB_TIMEOUT_MS ?? 10 * 60 * 1000));

function csvSummary(rows: TpuComparisonRow[]): Record<string, number> {
  if (!rows.length) {
    return { matchedRows: 0, totalRatio: 0, medianRuntimeRatio: 0, mapePercent: 0, maxAbsErrorPercent: 0 };
  }
  const ratios = rows.map((row) => row.runtimeRatio).sort((a, b) => a - b);
  const absErrors = rows.map((row) => Math.abs(row.errorPct));
  const mid = Math.floor(ratios.length / 2);
  const medianRuntimeRatio = ratios.length % 2 ? ratios[mid] : (ratios[mid - 1] + ratios[mid]) / 2;
  const totalPred = rows.reduce((sum, row) => sum + row.predictedCycles, 0);
  const totalMeasured = rows.reduce((sum, row) => sum + row.measuredCycles, 0);
  return {
    matchedRows: rows.length,
    totalRatio: totalMeasured / Math.max(1, totalPred),
    medianRuntimeRatio,
    mapePercent: absErrors.reduce((a, b) => a + b, 0) / absErrors.length,
    maxAbsErrorPercent: Math.max(...absErrors),
  };
}

function sampleSummary(rows: TpuSampleComparisonRow[]): Record<string, number> {
  if (!rows.length) {
    return { sampleRows: 0, sampleMapePercent: 0, sampleMedianRatio: 0, sampleP10Ratio: 0, sampleP90Ratio: 0 };
  }
  const ratios = rows.map((row) => row.runtimeRatio).sort((a, b) => a - b);
  const absErrors = rows.map((row) => Math.abs(row.errorPct));
  const quantile = (q: number) => {
    const pos = (ratios.length - 1) * q;
    const lo = Math.floor(pos);
    const hi = Math.ceil(pos);
    if (lo === hi) return ratios[lo];
    return ratios[lo] * (hi - pos) + ratios[hi] * (pos - lo);
  };
  return {
    sampleRows: rows.length,
    sampleMapePercent: absErrors.reduce((a, b) => a + b, 0) / absErrors.length,
    sampleMedianRatio: quantile(0.5),
    sampleP10Ratio: quantile(0.1),
    sampleP90Ratio: quantile(0.9),
  };
}

function fmt(value: number, digits = 2): string {
  return Number.isFinite(value) ? value.toFixed(digits) : "n/a";
}

function summaryMarkdown(rows: TpuComparisonRow[], sampleRows: TpuSampleComparisonRow[] = []): string {
  const stats = csvSummary(rows);
  const sampleStats = sampleSummary(sampleRows);
  const recommendation = summarizeTpuRecommendation(rows);
  const sampleLines = sampleRows.length
    ? [
        "",
        "## Raw sample distribution",
        "",
        `- Raw timing samples: ${sampleStats.sampleRows}`,
        `- Sample median runtime ratio: ${fmt(sampleStats.sampleMedianRatio, 4)}`,
        `- Sample P10-P90 runtime ratio: ${fmt(sampleStats.sampleP10Ratio, 4)} ~ ${fmt(sampleStats.sampleP90Ratio, 4)}`,
        `- Sample MAPE: ${fmt(sampleStats.sampleMapePercent)}%`,
      ]
    : [];
  const recommendationLines = recommendation
    ? [
        "",
        "## Recommendation ranking check",
        "",
        `- Comparison mode: ${recommendation.mode === "runtime" ? "same-shape runtime, lower is better" : "different-shape throughput, higher is better"}`,
        `- TileForge predicted best: ${recommendation.predictedBestLabel}`,
        `- TPU measured best: ${recommendation.measuredBestLabel}`,
        `- Top-1 hit: ${recommendation.top1Hit ? "yes" : "no"}`,
        `- Top-3 hit: ${recommendation.top3Hit ? "yes" : "no"}`,
        `- Measured rank of predicted best: ${recommendation.predictedBestMeasuredRank}`,
        `- Regret vs measured best: ${fmt(recommendation.regretPercent)}%`,
        `- Spearman rank correlation: ${recommendation.spearmanRankCorrelation === undefined ? "n/a" : fmt(recommendation.spearmanRankCorrelation, 3)}`,
      ]
    : [];
  const lines = [
    "# TileForge TPU Web Comparison",
    "",
    `Generated at: ${nowIso()}`,
    "",
    `- Matched rows: ${stats.matchedRows}`,
    `- Total measured / predicted ratio: ${fmt(stats.totalRatio, 4)}`,
    `- Median runtime ratio: ${fmt(stats.medianRuntimeRatio, 4)}`,
    `- MAPE: ${fmt(stats.mapePercent)}%`,
    `- Max absolute error: ${fmt(stats.maxAbsErrorPercent)}%`,
    ...sampleLines,
    ...recommendationLines,
    "",
    "| op | shape | predicted us | measured us | ratio | error % | achieved TFLOPS |",
    "|---|---:|---:|---:|---:|---:|---:|",
    ...rows.map((row) =>
      `| ${row.model}.${row.opName} | ${row.m}x${row.n}x${row.k} | ${fmt(row.predictedTimeUs)} | ${fmt(row.measuredUs)} | ${fmt(row.runtimeRatio, 3)} | ${fmt(row.errorPct)} | ${row.achievedTflops === undefined ? "" : fmt(row.achievedTflops, 3)} |`,
    ),
    "",
  ];
  return lines.join("\n");
}

function runnerReadme(): string {
  return [
    "TileForge TPU web package",
    "",
    "1) Copy shapes.csv and run_on_tpu.py to a TPU VM.",
    "2) On the TPU VM, run:",
    "",
    "   python run_on_tpu.py --shapes shapes.csv --out measurements.csv --samples-out tpu_samples.csv",
    "",
    "3) In the TileForge web UI, paste or upload measurements.csv and tpu_samples.csv in the TPU 비교 tab.",
    "",
    "If the TileForge web server itself is running on a TPU VM and TILEFORGE_ENABLE_TPU_WEB_RUN=1,",
    "you can use the '서버에서 바로 실행' button instead.",
    "",
  ].join("\n");
}

async function prepare(body: any) {
  const request = parseSearchRequest(body.request);
  const rows = buildTpuBenchmarkRows(request, { dtype: body.dtype || "bf16" });
  const predictionsCsv = tpuBenchmarkRowsToCsv(rows);
  const runnerPy = await readFile(path.join(process.cwd(), "scripts", "tpu_matmul_bench.py"), "utf8");
  return NextResponse.json({
    ok: true,
    action: "prepare",
    count: rows.length,
    predictionsCsv,
    runnerPy,
    readme: runnerReadme(),
    stats: {
      predictedTotalCycles: rows.reduce((sum, row) => sum + row.predictedCycles, 0),
      predictedTotalUs: rows.reduce((sum, row) => sum + row.predictedTimeUs, 0),
    },
  });
}

async function compare(body: any) {
  const predicted = parseTpuBenchmarkExportCsv(String(body.predictionsCsv || ""));
  const measurements = parseTpuMeasurementCsv(String(body.measurementsCsv || ""));
  const samples = parseTpuSampleCsv(String(body.samplesCsv || ""));
  const rows = compareTpuMeasurements(predicted, measurements);
  const sampleRows = compareTpuSamples(predicted, samples);
  if (!rows.length) {
    return NextResponse.json({ ok: false, error: "No matching TPU measurements found. shape/id/model/op_name을 확인하세요." }, { status: 400 });
  }
  const comparisonCsv = tpuComparisonRowsToCsv(rows);
  const calibrationCsv = tpuCalibrationCsv(rows);
  const sampleComparisonCsv = tpuSampleComparisonRowsToCsv(sampleRows);
  const summaryMd = summaryMarkdown(rows, sampleRows);
  return NextResponse.json({
    ok: true,
    action: "compare",
    rows,
    sampleRows,
    stats: { ...csvSummary(rows), ...sampleSummary(sampleRows), recommendation: summarizeTpuRecommendation(rows) },
    comparisonCsv,
    calibrationCsv,
    sampleComparisonCsv,
    summaryMd,
  });
}

async function runPython(args: string[], cwd: string, timeoutMs: number): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const py = process.platform === "win32" ? "python" : "python3";
    const child = spawn(py, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      reject(new Error(`TPU web run timed out after ${timeoutMs} ms`));
    }, timeoutMs);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`TPU benchmark failed with exit code ${code}\n${stderr || stdout}`));
    });
  });
}

async function runServer(body: any) {
  if (!RUN_ENABLED) {
    return NextResponse.json(
      {
        ok: false,
        error: "Web TPU run is disabled. 서버가 TPU VM에서 실행 중일 때 .env에 TILEFORGE_ENABLE_TPU_WEB_RUN=1을 설정하세요.",
        code: "TPU_WEB_RUN_DISABLED",
      },
      { status: 403 },
    );
  }
  const request = parseSearchRequest(body.request);
  const rows = buildTpuBenchmarkRows(request, { dtype: body.dtype || "bf16" });
  const predictionsCsv = tpuBenchmarkRowsToCsv(rows);
  const runId = stableId("tpuweb");
  const dir = path.join(WEB_TPU_ROOT, runId);
  await mkdir(dir, { recursive: true });
  const shapesPath = path.join(dir, "shapes.csv");
  const runnerPath = path.join(dir, "run_on_tpu.py");
  const measurementsPath = path.join(dir, "measurements.csv");
  const samplesPath = path.join(dir, "tpu_samples.csv");
  await writeFile(shapesPath, predictionsCsv, "utf8");
  await writeFile(runnerPath, await readFile(path.join(process.cwd(), "scripts", "tpu_matmul_bench.py"), "utf8"), "utf8");
  const reps = String(Math.max(1, Math.min(Number(body.reps ?? 30), 1000)));
  const warmup = String(Math.max(0, Math.min(Number(body.warmup ?? 5), 1000)));
  const timeoutMs = Math.max(10_000, Math.min(Number(body.timeoutMs ?? DEFAULT_TIMEOUT_MS), 60 * 60 * 1000));
  const runLog = await runPython([runnerPath, "--shapes", shapesPath, "--out", measurementsPath, "--samples-out", samplesPath, "--reps", reps, "--warmup", warmup], process.cwd(), timeoutMs);
  const measurementsCsv = await readFile(measurementsPath, "utf8");
  const samplesCsv = await readFile(samplesPath, "utf8").catch(() => "");
  const comparisonRows = compareTpuMeasurements(rows, parseTpuMeasurementCsv(measurementsCsv));
  const sampleRows = compareTpuSamples(rows, parseTpuSampleCsv(samplesCsv));
  const comparisonCsv = tpuComparisonRowsToCsv(comparisonRows);
  const calibrationCsv = tpuCalibrationCsv(comparisonRows);
  const sampleComparisonCsv = tpuSampleComparisonRowsToCsv(sampleRows);
  const summaryMd = summaryMarkdown(comparisonRows, sampleRows);
  await writeFile(path.join(dir, "comparison.csv"), comparisonCsv, "utf8");
  await writeFile(path.join(dir, "calibration.csv"), calibrationCsv, "utf8");
  await writeFile(path.join(dir, "sample-comparison.csv"), sampleComparisonCsv, "utf8");
  await writeFile(path.join(dir, "summary.md"), summaryMd, "utf8");
  return NextResponse.json({
    ok: true,
    action: "run-server",
    runId,
    rows: comparisonRows,
    sampleRows,
    stats: { ...csvSummary(comparisonRows), ...sampleSummary(sampleRows), recommendation: summarizeTpuRecommendation(comparisonRows) },
    predictionsCsv,
    measurementsCsv,
    samplesCsv,
    comparisonCsv,
    calibrationCsv,
    sampleComparisonCsv,
    summaryMd,
    log: [runLog.stdout, runLog.stderr].filter(Boolean).join("\n"),
  });
}

export async function GET() {
  return NextResponse.json({
    ok: true,
    webRunEnabled: RUN_ENABLED,
    hint: RUN_ENABLED ? "서버에서 직접 TPU benchmark를 실행할 수 있습니다." : "측정 패키지 생성과 측정 CSV 비교만 사용 가능합니다.",
  });
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const action = body.action || "prepare";
    if (action === "prepare") return await prepare(body);
    if (action === "compare") return await compare(body);
    if (action === "run-server") return await runServer(body);
    return NextResponse.json({ ok: false, error: `Unknown TPU action: ${action}` }, { status: 400 });
  } catch (error: any) {
    return NextResponse.json({ ok: false, error: error?.message || "TPU web request failed", detail: formatZodError(error) }, { status: 400 });
  }
}
