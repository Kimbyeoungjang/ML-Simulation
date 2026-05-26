import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { csvRows, findFirstExistingFile, matchScaleLayerForResult, parseScaleSimLayerReports } from "@/server/scaleSimReport";

describe("SCALE-Sim report parser", () => {
  it("parses quoted numeric CSV fields and companion bandwidth/access reports", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tileforge-scalesim-report-"));
    await writeFile(path.join(dir, "COMPUTE_REPORT.csv"), [
      "Layer Name,Total Cycles,Overall Util %,Mapping Efficiency %",
      "attention_qkv,\"31,265\",84.5,91.2",
    ].join("\n"), "utf8");
    await writeFile(path.join(dir, "DETAILED_ACCESS_REPORT.csv"), [
      "SRAM IFMAP Reads,SRAM Filter Reads,SRAM OFMAP Writes,DRAM IFMAP Reads,DRAM Filter Reads,DRAM OFMAP Writes",
      "1,2,3,4,5,6",
    ].join("\n"), "utf8");
    await writeFile(path.join(dir, "BANDWIDTH_REPORT.csv"), [
      "Avg IFMAP SRAM BW,Avg FILTER SRAM BW,Avg OFMAP SRAM BW",
      "7,8,9",
    ].join("\n"), "utf8");

    const rows = csvRows('name,value\n"a,b",10\n');
    expect(rows[0].name).toBe("a,b");

    const layers = await parseScaleSimLayerReports(path.join(dir, "COMPUTE_REPORT.csv"), [{ shapeId: "qkv", tileCount: 3 }]);
    expect(layers[0].name).toBe("attention_qkv");
    expect(layers[0].cycles).toBe(31265);
    expect(layers[0].tileExtrapolatedCycles).toBe(93795);
    expect(layers[0].sramAccesses).toBe(6);
    expect(layers[0].dramAccesses).toBe(15);
    expect(layers[0].overallUtil).toBe(84.5);
  });

  it("finds nested compute reports and matches generated layer names", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tileforge-scalesim-find-"));
    const nested = path.join(dir, "run", "outputs");
    await import("node:fs/promises").then(fs => fs.mkdir(nested, { recursive: true }));
    const file = path.join(nested, "my_compute_report.csv");
    await writeFile(file, "Layer,Cycles\nvit_attention_qkv,100\n", "utf8");
    await expect(findFirstExistingFile(dir, "COMPUTE_REPORT.csv")).resolves.toBe(file);
    const match = matchScaleLayerForResult({ shape: { model: "vit", opName: "attention_qkv" } }, [{ name: "vit_attention_qkv", cycles: 100 }]);
    expect(match?.cycles).toBe(100);
  });
});
