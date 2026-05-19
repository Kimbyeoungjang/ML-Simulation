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
    expect(result.rows[0].targetScope).toBe("tile-policy");
    expect(result.rows[0].measuredSource).toBe("candidate.tileExtrapolatedCycles");
    expect(result.rows[0].measuredSramBytes).toBe(4000);
    expect(result.rows[0].measuredDramBytes).toBe(6000);
    expect(result.rows[0].measuredUtilization).toBeCloseTo(0.333);

    const merged = mergeCollectedSamplesIntoCsv("id,model,opName,arrayRows,arrayCols,sramKB,frequencyMHz,dataflow,dtypeBytes,m,n,k,tileM,tileN,tileK,estimatorCycles,measuredCycles,measuredSramBytes,measuredDramBytes,measuredUtilization\nqkv,vit,attention_qkv,128,128,8192,700,WS,2,197,2304,384,128,256,128,50000,,,,\n", result.rows);
    expect(merged).toContain("targetScope");
    expect(merged).toContain("tile-policy");
    expect(merged).toContain("measuredSramBytes");
    expect(merged).toContain("4000");
    expect(merged).toContain("6000");
  });

  it("collects one full-layer sample per shape from multi-op full-pipeline runs", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "tileforge-job-samples-multi-"));
    const j = job("job2");
    j.request!.shapes = [
      { id: "qkv", model: "vit", opName: "attention_qkv", m: 197, n: 2304, k: 384, dtypeBytes: 2 },
      { id: "fc1", model: "vit", opName: "mlp_fc1", m: 197, n: 1536, k: 384, dtypeBytes: 2 },
      { id: "fc2", model: "vit", opName: "mlp_fc2", m: 197, n: 384, k: 1536, dtypeBytes: 2 },
    ];
    const dir = path.join(root, j.id);
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, "scalesim_summary.json"), JSON.stringify({
      ok: true,
      totalCycles: 72951,
      layers: [
        { shapeId: "qkv", opName: "attention_qkv", tileM: 128, tileN: 256, tileK: 128, cycles: 31265 },
        { shapeId: "fc1", opName: "mlp_fc1", tileM: 128, tileN: 256, tileK: 128, cycles: 20843 },
        { shapeId: "fc2", opName: "mlp_fc2", tileM: 128, tileN: 128, tileK: 256, cycles: 20843 },
      ],
      candidateLayers: [],
    }), "utf8");
    await writeFile(path.join(dir, "result.json"), JSON.stringify({ payload: { response: { results: [
      { shape: { id: "qkv", opName: "attention_qkv" }, best: { shapeId: "qkv", opName: "attention_qkv", tileM: 128, tileN: 256, tileK: 128, rawCycles: 49327, cycles: 49327, sramBytes: 160 * 1024, utilization: 0.2 } },
      { shape: { id: "fc1", opName: "mlp_fc1" }, best: { shapeId: "fc1", opName: "mlp_fc1", tileM: 128, tileN: 256, tileK: 128, rawCycles: 32533, cycles: 32533, sramBytes: 160 * 1024, utilization: 0.2 } },
      { shape: { id: "fc2", opName: "mlp_fc2" }, best: { shapeId: "fc2", opName: "mlp_fc2", tileM: 128, tileN: 128, tileK: 256, rawCycles: 30365, cycles: 30365, sramBytes: 160 * 1024, utilization: 0.2 } },
    ] } } }), "utf8");

    const result = await collectEstimatorSamplesFromJobs([j], root);
    expect(result.skipped).toHaveLength(0);
    expect(result.rows.map((r) => r.opName)).toEqual(["attention_qkv", "mlp_fc1", "mlp_fc2"]);
    expect(result.rows.map((r) => r.measuredCycles)).toEqual([31265, 20843, 20843]);
    expect(new Set(result.rows.map((r) => r.targetScope))).toEqual(new Set(["full-layer"]));
  });

});
