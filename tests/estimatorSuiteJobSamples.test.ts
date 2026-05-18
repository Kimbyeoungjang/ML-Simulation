import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { collectEstimatorSamplesFromJobs, mergeCollectedSamplesIntoCsv } from "@/lib/estimatorSuiteJobSamples";
import type { JobRecord } from "@/types/job";
import { defaultHardware } from "@/lib/defaults";

function job(id: string): JobRecord {
  return {
    id,
    name: "sample_qkv_128x256x128",
    kind: "full-pipeline",
    status: "succeeded",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    logs: [],
    artifacts: [],
    request: {
      hardware: { ...defaultHardware, arrayRows: 128, arrayCols: 128, sramKB: 8192, dataflow: "WS" },
      shapes: [{ id: "qkv", model: "vit", opName: "attention_qkv", m: 197, n: 2304, k: 384, dtypeBytes: 2 }],
      candidates: { tileM: [128], tileN: [256], tileK: [128] },
      objective: "balanced",
      maxResultsPerOp: 1,
    },
  };
}

describe("estimator suite job sample collection", () => {
  it("collects cycle, SRAM, DRAM, and utilization targets from SCALE-Sim summaries", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tileforge-job-samples-"));
    const j = job("job1");
    const dir = path.join(root, j.id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "scalesim_summary.json"), JSON.stringify({
      ok: true,
      totalCycles: 999999,
      layers: [{ name: "attention_qkv", opName: "attention_qkv", cycles: 77777, sramAccesses: 1234, dramAccesses: 5678, computeUtil: 25.5 }],
      candidateLayers: [{ name: "attention_qkv", opName: "attention_qkv", tileM: 128, tileN: 256, tileK: 128, tileExtrapolatedCycles: 88888, cycles: 1111, sramAccesses: 2000, dramAccesses: 3000, computeUtil: 33.3 }],
    }), "utf8");
    await writeFile(path.join(dir, "result.json"), JSON.stringify({ payload: { response: { results: [{ best: { cycles: 50000, sramBytes: 160 * 1024, utilization: 0.42 } }] } } }), "utf8");

    const result = await collectEstimatorSamplesFromJobs([j], root);
    expect(result.skipped).toHaveLength(0);
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0].measuredCycles).toBe(88888);
    expect(result.rows[0].measuredSramBytes).toBe(4000);
    expect(result.rows[0].measuredDramBytes).toBe(6000);
    expect(result.rows[0].measuredUtilization).toBeCloseTo(0.333);

    const merged = mergeCollectedSamplesIntoCsv("id,model,opName,arrayRows,arrayCols,sramKB,frequencyMHz,dataflow,dtypeBytes,m,n,k,tileM,tileN,tileK,estimatorCycles,measuredCycles,measuredSramBytes,measuredDramBytes,measuredUtilization\nqkv,vit,attention_qkv,128,128,8192,700,WS,2,197,2304,384,128,256,128,50000,,,,\n", result.rows);
    expect(merged).toContain("measuredSramBytes");
    expect(merged).toContain("4000");
    expect(merged).toContain("6000");
  });
});
