import { describe, expect, it } from "vitest";
import { buildDesignSpaceRows, expandedValidationPlanRows, requestForDesignSweepRow, validationPlanRows } from "@/lib/designSpace";
import { estimateAll } from "@/lib/estimator";
import type { SearchRequest } from "@/types/domain";

function baseRequest(): SearchRequest {
  return {
    hardware: {
      name: "TPUv2-like",
      arrayRows: 128,
      arrayCols: 128,
      frequencyMHz: 700,
      sramKB: 8192,
      dataflow: "WS",
      bytesPerElement: 2,
      memoryBandwidthGBs: 100,
    },
    shapes: [
      { id: "gemm", model: "unit", opName: "matmul", m: 512, n: 512, k: 512, dtypeBytes: 2 },
    ],
    candidates: { tileM: [64, 128], tileN: [64, 128], tileK: [64, 128] },
    objective: "hardware-design",
    maxResultsPerOp: 3,
    scaleSim: { dataflow: "WS", runName: "baseline" },
  };
}

describe("design-space active learning request generation", () => {
  it("turns recommended validation rows into executable full-pipeline requests", () => {
    const req = baseRequest();
    const rows = buildDesignSpaceRows({ request: req });
    const plan = validationPlanRows(rows, 3);
    expect(plan.length).toBeGreaterThan(0);

    const next = requestForDesignSweepRow(req, plan[0].row, {
      rank: plan[0].rank,
      runNamePrefix: "active_learning",
    });

    expect(next.shapes.length).toBe(req.shapes.length);
    expect(next.candidates.tileM.length).toBeGreaterThan(0);
    expect(next.scaleSim?.runName).toContain("active_learning_01_");
    expect(next.hardware.name).not.toBe(req.hardware.name);
  });

  it("expands recommendation neighborhoods until the 40-sample training floor is covered", () => {
    const req = baseRequest();
    const rows = buildDesignSpaceRows({ request: req });
    const expanded = expandedValidationPlanRows(rows, {
      seedLimit: 5,
      minSamples: 40,
      samplesPerRequest: 1,
      oversampleFactor: 1,
      neighborhoodRadius: 4,
    });

    expect(expanded.length).toBeGreaterThanOrEqual(40);
    expect(expanded.some((item) => item.variant === "neighbor")).toBe(true);
    expect(new Set(expanded.map((item) => `${item.row.axis}:${item.row.x}`)).size).toBe(expanded.length);

    const requests = expanded.map((item) =>
      requestForDesignSweepRow(req, item.row, { rank: item.rank, runNamePrefix: "active_learning" }),
    );
    expect(requests.length).toBe(expanded.length);
    expect(requests[0].scaleSim?.runName).toContain("active_learning_01_");
  });


  it("emits SCALE-Sim cfg bandwidth fields as integers for expanded DRAM neighbors", () => {
    const req = {
      ...baseRequest(),
      scaleSim: { ...baseRequest().scaleSim, bandwidth: 128 },
    };
    const row = { axis: "dram" as const, x: Math.sqrt(0.125 * 0.25), label: "DRAM 0.177x" };
    const next = requestForDesignSweepRow(req, row, { rank: 1, runNamePrefix: "active_learning" });
    expect(next.scaleSim?.bandwidth).toBeCloseTo(22.627416, 5);

    const response = estimateAll(next);
    const config = response.artifacts.scaleSimConfig;

    expect(config).toContain("Bandwidth = 23");
    expect(config).not.toMatch(/Bandwidth = \d+\.\d+/);
    expect(config).not.toMatch(/SRAMBankBandwidth = \d+\.\d+/);
  });

});
