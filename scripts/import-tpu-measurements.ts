import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  compareTpuMeasurements,
  parseTpuBenchmarkExportCsv,
  parseTpuMeasurementCsv,
  tpuCalibrationCsv,
  tpuComparisonRowsToCsv,
} from "@/lib/tpuBenchmark";
import { parseCliArgs, printHelpAndExit } from "./cli-utils";

function summarize(errors: number[]) {
  if (!errors.length) return { mape: 0, maxAbsErrorPct: 0 };
  const abs = errors.map((v) => Math.abs(v));
  return {
    mape: abs.reduce((a, b) => a + b, 0) / abs.length,
    maxAbsErrorPct: Math.max(...abs),
  };
}

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printHelpAndExit(`
Usage:
  npm run tpu:import -- --predictions .tileforge/tpu/tpu_benchmark_shapes.csv --measurements tpu_measurements.csv

Options:
  --predictions <csv>      CSV created by npm run tpu:export
  --measurements <csv>     CSV created by scripts/tpu_matmul_bench.py on a TPU VM
  --out <csv>              Full comparison CSV. Default: .tileforge/tpu/tpu_comparison.csv
  --calibration-out <csv>  TileForge calibration CSV. Default: .tileforge/tpu/tpu_calibration.csv
`);
  }

  const predictionsPath = args.predictions || path.join(".tileforge", "tpu", "tpu_benchmark_shapes.csv");
  const measurementsPath = args.measurements || "tpu_measurements.csv";
  const outPath = args.out || path.join(".tileforge", "tpu", "tpu_comparison.csv");
  const calibrationPath = args["calibration-out"] || args.calibrationOut || path.join(".tileforge", "tpu", "tpu_calibration.csv");

  const predicted = parseTpuBenchmarkExportCsv(await readFile(predictionsPath, "utf8"));
  const measurements = parseTpuMeasurementCsv(await readFile(measurementsPath, "utf8"));
  const rows = compareTpuMeasurements(predicted, measurements);
  if (!rows.length) {
    throw new Error(`No matching TPU measurements found. Match is by id/model/op_name/m/n/k first, then by m/n/k.`);
  }

  await mkdir(path.dirname(outPath), { recursive: true });
  await mkdir(path.dirname(calibrationPath), { recursive: true });
  await writeFile(outPath, tpuComparisonRowsToCsv(rows), "utf8");
  await writeFile(calibrationPath, tpuCalibrationCsv(rows), "utf8");

  const totalPredictedCycles = rows.reduce((sum, row) => sum + row.predictedCycles, 0);
  const totalMeasuredCycles = rows.reduce((sum, row) => sum + row.measuredCycles, 0);
  const ratio = totalMeasuredCycles / Math.max(1, totalPredictedCycles);
  console.log(JSON.stringify({
    outPath,
    calibrationPath,
    matchedRows: rows.length,
    totalPredictedCycles: Math.round(totalPredictedCycles),
    totalMeasuredCycles: Math.round(totalMeasuredCycles),
    measuredToPredictedRatio: ratio,
    ...summarize(rows.map((row) => row.errorPct)),
  }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
