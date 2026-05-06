import { describe, expect, it } from "vitest";
import { parseMeasurementCsv, calibrationFactor } from "@/lib/calibration";
import { defaultHardware, defaultShapes } from "@/lib/defaults";

describe("calibration", () => {
  it("builds a correction profile from measured cycles", () => {
    const profile = parseMeasurementCsv("model,op_name,array,dataflow,predicted_cycles,measured_cycles\nvit,qkv,128x128,WS,100,120\nvit,ffn,128x128,WS,200,220");
    expect(profile.samples.length).toBe(2);
    expect(profile.globalCycleFactor).toBeCloseTo(1.15);
  });
  it("returns a usable factor", () => {
    const profile = parseMeasurementCsv("model,op_name,array,dataflow,predicted_cycles,measured_cycles\nvit_s,qkv,128x128,WS,100,120");
    const f = calibrationFactor(profile, defaultHardware, defaultShapes[0]);
    expect(f).toBeGreaterThan(1);
  });
});
