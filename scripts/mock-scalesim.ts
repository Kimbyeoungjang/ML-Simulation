import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

function opt(name: string, fallback?: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : fallback;
}

async function main(): Promise<void> {
  if (process.argv.includes("-h") || process.argv.includes("--help")) {
    console.log("mock SCALE-Sim usage: mock-scalesim -c scalesim.cfg -t topology.csv -p output_dir");
    return;
  }
  const cfg = opt("-c", process.argv[2] ?? "scalesim.cfg") ?? "scalesim.cfg";
  const topology = opt("-t", process.argv[3] ?? "topology.csv") ?? "topology.csv";
  const outDir = process.env.TILEFORGE_MOCK_OUTPUT_DIR ?? opt("-p", path.dirname(path.resolve(topology))) ?? path.dirname(path.resolve(topology));
  await mkdir(outDir, { recursive: true });
  const report = [
    "Layer,Cycles,Compute Utilization,Mapping Efficiency",
    "mock_matmul,123456,87.5,92.0"
  ].join("\n") + "\n";
  await writeFile(path.join(outDir, "COMPUTE_REPORT.csv"), report, "utf8");
  await writeFile(path.join(outDir, "mock-scalesim.log"), `mock scalesim\nconfig=${cfg}\ntopology=${topology}\n`, "utf8");
  console.log(`mock SCALE-Sim 생성 완료: ${path.join(outDir, "COMPUTE_REPORT.csv")}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
