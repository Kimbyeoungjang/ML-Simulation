import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { parseShapesCsv } from "@/lib/csv";
import { defaultHardware } from "@/lib/defaults";
import {
  buildTpuBenchmarkRows,
  compareTpuMeasurements,
  defaultTpuCandidates,
  makeHardwareFromCli,
  parseTpuBenchmarkExportCsv,
  parseTpuMeasurementCsv,
  tpuBenchmarkRowsToCsv,
  tpuCalibrationCsv,
  tpuComparisonRowsToCsv,
  type TpuComparisonRow,
} from "@/lib/tpuBenchmark";
import type { MatmulShape, Objective } from "@/types/domain";
import { parseCliArgs, printHelpAndExit } from "./cli-utils";

const DEFAULT_OUT_DIR = path.join(".tileforge", "tpu-simple");

function simpleShapes(dtypeBytes: number): MatmulShape[] {
  return [
    { id: "quick_128", model: "quick", opName: "matmul_128", m: 128, n: 128, k: 128, dtypeBytes, source: "manual" },
    { id: "quick_512", model: "quick", opName: "matmul_512", m: 512, n: 512, k: 512, dtypeBytes, source: "manual" },
    { id: "quick_1024", model: "quick", opName: "matmul_1024", m: 1024, n: 1024, k: 1024, dtypeBytes, source: "manual" },
  ];
}

function formatNumber(value: number, digits = 2): string {
  if (!Number.isFinite(value)) return "n/a";
  return value.toFixed(digits);
}

function median(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function comparisonSummary(rows: TpuComparisonRow[]): string {
  if (!rows.length) return "No matched TPU rows.\n";
  const absErrors = rows.map((row) => Math.abs(row.errorPct));
  const ratios = rows.map((row) => row.runtimeRatio);
  const totalPredictedCycles = rows.reduce((sum, row) => sum + row.predictedCycles, 0);
  const totalMeasuredCycles = rows.reduce((sum, row) => sum + row.measuredCycles, 0);
  const totalRatio = totalMeasuredCycles / Math.max(1, totalPredictedCycles);
  return [
    `matched_rows: ${rows.length}`,
    `total_measured_to_predicted_ratio: ${formatNumber(totalRatio, 4)}`,
    `median_runtime_ratio: ${formatNumber(median(ratios), 4)}`,
    `mape_percent: ${formatNumber(absErrors.reduce((a, b) => a + b, 0) / absErrors.length)}`,
    `max_abs_error_percent: ${formatNumber(Math.max(...absErrors))}`,
    "",
  ].join("\n");
}

function comparisonMarkdown(rows: TpuComparisonRow[], outDir: string): string {
  const header = [
    "# TileForge TPU Simple Comparison",
    "",
    comparisonSummary(rows).trimEnd(),
    "",
    "| op | shape | predicted us | measured us | ratio | error % | achieved TFLOPS |",
    "|---|---:|---:|---:|---:|---:|---:|",
  ];
  const table = rows.map((row) => [
    row.opName,
    `${row.m}x${row.n}x${row.k}`,
    formatNumber(row.predictedTimeUs),
    formatNumber(row.measuredUs),
    formatNumber(row.runtimeRatio, 3),
    formatNumber(row.errorPct),
    row.achievedTflops === undefined ? "" : formatNumber(row.achievedTflops, 3),
  ]).map((cells) => `| ${cells.join(" | ")} |`);
  return [
    ...header,
    ...table,
    "",
    "Generated files:",
    `- ${path.join(outDir, "comparison.csv")}`,
    `- ${path.join(outDir, "calibration.csv")}`,
    `- ${path.join(outDir, "summary.md")}`,
    "",
  ].join("\n");
}

function readmeText(outDir: string): string {
  const shapesPath = path.join(outDir, "shapes.csv");
  const pyPath = path.join(outDir, "run_on_tpu.py");
  const measurementsPath = path.join(outDir, "measurements.csv");
  return `TileForge TPU simple test\n\n1) Copy this folder to a TPU VM.\n\n2) On the TPU VM, run:\n\n   python ${path.basename(pyPath)} --shapes ${path.basename(shapesPath)} --out ${path.basename(measurementsPath)}\n\n3) Copy ${path.basename(measurementsPath)} back to this folder on your local machine.\n\n4) In the TileForge project root, run:\n\n   npm run tpu:simple -- --measurements ${measurementsPath}\n\nOne-command mode on a TPU VM with Node + project dependencies installed:\n\n   npm run tpu:simple -- --run\n\nUseful files:\n- ${shapesPath}: TileForge predictions and GEMM shapes\n- ${pyPath}: standalone JAX benchmark script\n- ${measurementsPath}: TPU runtime measurements\n- ${path.join(outDir, "summary.md")}: final human-readable comparison\n`;
}

async function prepare(args: Record<string, string | undefined>, outDir: string): Promise<string> {
  const hardware = makeHardwareFromCli(defaultHardware, {
    ...args,
    array: args.array || `${defaultHardware.arrayRows}x${defaultHardware.arrayCols}`,
    frequencyMHz: args["frequency-mhz"] || args.frequencyMHz,
    sramKb: args["sram-kb"] || args.sramKb,
    memoryBandwidthGBs: args["memory-bandwidth-gbs"] || args.memoryBandwidthGBs,
  });

  const shapesPath = args.shapes;
  const shapes = shapesPath
    ? parseShapesCsv(await readFile(shapesPath, "utf8"))
    : simpleShapes(hardware.bytesPerElement);

  const objective = (args.objective || "hardware-design") as Objective;
  const rows = buildTpuBenchmarkRows(
    {
      hardware,
      shapes,
      candidates: defaultTpuCandidates(hardware.arrayRows, hardware.arrayCols),
      objective,
      maxResultsPerOp: Number(args["max-results-per-op"] || args.maxResultsPerOp || 16),
    },
    { dtype: args.dtype || "bf16" },
  );

  await mkdir(outDir, { recursive: true });
  const predictionPath = path.join(outDir, "shapes.csv");
  await writeFile(predictionPath, tpuBenchmarkRowsToCsv(rows), "utf8");
  await copyFile(path.join("scripts", "tpu_matmul_bench.py"), path.join(outDir, "run_on_tpu.py"));
  await writeFile(path.join(outDir, "README.txt"), readmeText(outDir), "utf8");
  return predictionPath;
}

async function compare(outDir: string, measurementPath: string): Promise<TpuComparisonRow[]> {
  const predictionsPath = path.join(outDir, "shapes.csv");
  const predicted = parseTpuBenchmarkExportCsv(await readFile(predictionsPath, "utf8"));
  const measurements = parseTpuMeasurementCsv(await readFile(measurementPath, "utf8"));
  const rows = compareTpuMeasurements(predicted, measurements);
  if (!rows.length) {
    throw new Error(`No matching TPU measurements found. Expected shapes from ${predictionsPath}, got ${measurementPath}.`);
  }
  await writeFile(path.join(outDir, "comparison.csv"), tpuComparisonRowsToCsv(rows), "utf8");
  await writeFile(path.join(outDir, "calibration.csv"), tpuCalibrationCsv(rows), "utf8");
  await writeFile(path.join(outDir, "summary.md"), comparisonMarkdown(rows, outDir), "utf8");
  return rows;
}

function runPythonBenchmark(outDir: string, reps: string | undefined, warmup: string | undefined): string {
  const py = process.platform === "win32" ? "python" : "python3";
  const measurementPath = path.join(outDir, "measurements.csv");
  const result = spawnSync(
    py,
    [
      path.join(outDir, "run_on_tpu.py"),
      "--shapes",
      path.join(outDir, "shapes.csv"),
      "--out",
      measurementPath,
      "--reps",
      reps || "30",
      "--warmup",
      warmup || "5",
    ],
    { stdio: "inherit" },
  );
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`TPU benchmark failed with exit code ${result.status}`);
  return measurementPath;
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printHelpAndExit(`
Usage:
  npm run tpu:simple
  npm run tpu:simple -- --run
  npm run tpu:simple -- --measurements .tileforge/tpu-simple/measurements.csv

Default behavior:
  Creates .tileforge/tpu-simple/shapes.csv and .tileforge/tpu-simple/run_on_tpu.py.
  Copy that folder to a TPU VM, run the Python file, then import measurements.

Options:
  --run                    Prepare, run JAX benchmark, and compare in one command. Use this on a TPU VM.
  --measurements <csv>      Import TPU measurements and create comparison.csv, calibration.csv, summary.md.
  --shapes <csv>            Use your own GEMM shape CSV. If omitted, uses 128/512/1024 quick GEMMs.
  --out-dir <dir>           Default: .tileforge/tpu-simple
  --array <RxC>             Default: 128x128
  --frequency-mhz <MHz>     Default: hardware default, currently 700
  --dtype <bf16|f32|f16>    Default: bf16
  --reps <N>                Python benchmark repetitions for --run. Default: 30
  --warmup <N>              Python benchmark warmup iterations for --run. Default: 5
`);
  }

  const outDir = args["out-dir"] || args.outDir || DEFAULT_OUT_DIR;
  const predictionsPath = await prepare(args, outDir);
  const bundledRunner = path.join(outDir, "run_on_tpu.py");
  const defaultMeasurementPath = path.join(outDir, "measurements.csv");
  let measurementPath = args.measurements;

  if (args.run === "true") {
    measurementPath = runPythonBenchmark(outDir, args.reps, args.warmup);
  }

  if (!measurementPath && existsSync(defaultMeasurementPath)) {
    measurementPath = defaultMeasurementPath;
  }

  if (measurementPath) {
    const rows = await compare(outDir, measurementPath);
    console.log(comparisonSummary(rows));
    console.log(`Wrote ${path.join(outDir, "summary.md")}`);
    return;
  }

  console.log([
    "Created simple TPU benchmark package:",
    `  ${outDir}`,
    "",
    "Copy that folder to a TPU VM and run:",
    `  python ${path.basename(bundledRunner)} --shapes ${path.basename(predictionsPath)} --out measurements.csv`,
    "",
    "Then copy measurements.csv back and run:",
    `  npm run tpu:simple -- --measurements ${path.join(outDir, "measurements.csv")}`,
    "",
    "Or, if this project is already on the TPU VM:",
    "  npm run tpu:simple -- --run",
  ].join("\n"));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
