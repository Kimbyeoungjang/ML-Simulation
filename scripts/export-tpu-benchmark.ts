import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseShapesCsv } from "@/lib/csv";
import { defaultHardware } from "@/lib/defaults";
import {
  addQuickSanityShapes,
  buildTpuBenchmarkRows,
  defaultTpuCandidates,
  makeHardwareFromCli,
  tpuBenchmarkRowsToCsv,
} from "@/lib/tpuBenchmark";
import type { Objective } from "@/types/domain";
import { parseCliArgs, printHelpAndExit } from "./cli-utils";

async function main() {
  const args = parseCliArgs(process.argv.slice(2));
  if (args.help || args.h) {
    printHelpAndExit(`
Usage:
  npm run tpu:export -- --shapes examples/shapes.csv --out .tileforge/tpu/tpu_benchmark_shapes.csv

Options:
  --shapes <csv>             Input GEMM shapes CSV. Default: examples/shapes.csv
  --out <csv>                Output benchmark/prediction CSV. Default: .tileforge/tpu/tpu_benchmark_shapes.csv
  --array <RxC>              TPU systolic array model. Default: 128x128
  --frequency-mhz <MHz>      Cycle-to-time conversion. Default: hardware default, currently 700
  --sram-kb <KB>             SRAM size used by estimator. Default: hardware default
  --dataflow <WS|OS|IS>      Estimator dataflow. Default: WS
  --dtype <bf16|f32>         Runtime dtype label for TPU script. Default: derived from dtype_bytes
  --include-quick-grid       Add sanity GEMMs such as 64/128/512/1024 square cases
  --max-results-per-op <N>   Candidate count retained by estimator. Default: 16
`);
  }

  const shapesPath = args.shapes || "examples/shapes.csv";
  const outPath = args.out || path.join(".tileforge", "tpu", "tpu_benchmark_shapes.csv");
  const hardware = makeHardwareFromCli(defaultHardware, {
    ...args,
    array: args.array || `${defaultHardware.arrayRows}x${defaultHardware.arrayCols}`,
    frequencyMHz: args["frequency-mhz"] || args.frequencyMHz,
    sramKb: args["sram-kb"] || args.sramKb,
    memoryBandwidthGBs: args["memory-bandwidth-gbs"] || args.memoryBandwidthGBs,
  });

  let shapes = parseShapesCsv(await readFile(shapesPath, "utf8"));
  if (args["include-quick-grid"] === "true" || args.includeQuickGrid === "true") {
    shapes = addQuickSanityShapes(shapes, hardware.bytesPerElement);
  }

  const candidates = defaultTpuCandidates(hardware.arrayRows, hardware.arrayCols);
  const objective = (args.objective || "hardware-design") as Objective;
  const rows = buildTpuBenchmarkRows(
    {
      hardware,
      shapes,
      candidates,
      objective,
      maxResultsPerOp: Number(args["max-results-per-op"] || args.maxResultsPerOp || 16),
    },
    { dtype: args.dtype },
  );

  await mkdir(path.dirname(outPath), { recursive: true });
  await writeFile(outPath, tpuBenchmarkRowsToCsv(rows), "utf8");

  const totalPredictedCycles = rows.reduce((sum, row) => sum + row.predictedCycles, 0);
  const totalPredictedUs = rows.reduce((sum, row) => sum + row.predictedTimeUs, 0);
  console.log(JSON.stringify({ outPath, rows: rows.length, hardware, totalPredictedCycles, totalPredictedUs }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack || error.message : error);
  process.exit(1);
});
