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

  it("learns array-dataflow and tile-specific robust factors", () => {
    const profile = parseMeasurementCsv([
      "model,op_name,array,dataflow,tile_m,tile_n,tile_k,predicted_cycles,measured_cycles",
      "vit,qkv,128x128,WS,64,64,32,100,140",
      "vit,qkv,128x128,WS,64,64,32,200,280",
      "vit,qkv,128x128,OS,64,64,32,100,110",
    ].join("\n"));
    expect(profile.method).toBe("robust-median");
    expect(profile.byArrayDataflow?.["128x128/WS"]).toBeCloseTo(1.4);
    expect(profile.byTile?.["64x64x32"]).toBeGreaterThan(1.1);
    const f = calibrationFactor(profile, { ...defaultHardware, arrayRows: 128, arrayCols: 128, dataflow: "WS" }, defaultShapes[0], { tileM: 64, tileN: 64, tileK: 32 });
    expect(f).toBeGreaterThan(1.2);
  });
