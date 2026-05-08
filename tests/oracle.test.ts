import { describe, expect, it } from "vitest";
import { estimateAll } from "@/lib/estimator";
import { hardwarePresets, workloadPresets } from "@/lib/presets";
import type { Dataflow, ScaleSimOverrides } from "@/types/domain";

const scaleSimDefaults: ScaleSimOverrides = {
  bandwidth: 128,
  ifmapSRAMBankBandwidth: 10,
  filterSRAMBankBandwidth: 10,
};

describe("SCALE-Sim reference oracle", () => {
  it("keeps BERT block tile-policy estimates close to checked local SCALE-Sim top1 runs", () => {
    const observed: Record<Dataflow, number> = {
      WS: 609_273,
      OS: 305_199,
      IS: 609_273,
    };
    const predicted = Object.fromEntries(
      (["WS", "OS", "IS"] as Dataflow[]).map((dataflow) => {
        const response = estimateAll({
          hardware: { ...hardwarePresets[1], dataflow },
          shapes: workloadPresets["BERT-base seq384 block"],
          candidates: { tileM: [32, 64, 128], tileN: [64, 128], tileK: [32, 64, 128, 256] },
          objective: "balanced",
          maxResultsPerOp: 8,
          scaleSim: scaleSimDefaults,
        }, { includeArtifacts: false });
        return [dataflow, response.summary.totalCycles];
      }),
    ) as Record<Dataflow, number>;

    expect(predicted.OS).toBeLessThan(predicted.WS);
    expect(Math.abs(predicted.WS - predicted.IS)).toBeLessThan(1);
    for (const dataflow of ["WS", "OS", "IS"] as Dataflow[]) {
      const relativeError = Math.abs(predicted[dataflow] - observed[dataflow]) / observed[dataflow];
      expect(relativeError).toBeLessThan(0.01);
    }
  });
});
