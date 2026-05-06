import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { estimateAll } from "@/lib/estimator";
import { defaultHardware, defaultShapes, defaultCandidates } from "@/lib/defaults";

async function main(): Promise<void> {
  const outDir = path.join(process.cwd(), ".tileforge", "demo-export");
  await mkdir(outDir, { recursive: true });
  const response = estimateAll({ hardware: defaultHardware, shapes: defaultShapes, candidates: defaultCandidates, objective: "balanced" });
  await writeFile(path.join(outDir, "report.md"), response.artifacts.reportMarkdown, "utf8");
  await writeFile(path.join(outDir, "best_tile_policy.csv"), response.artifacts.policyCsv, "utf8");
  await writeFile(path.join(outDir, "result.json"), JSON.stringify(response, null, 2), "utf8");
  console.log(`Demo export written to ${outDir}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
