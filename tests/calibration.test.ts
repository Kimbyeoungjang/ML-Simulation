import { describe, expect, it } from "vitest";
import { applyCalibrationFactor, calibrationFactor, fitCalibrationProfile, parseMeasurementCsv } from "@/lib/calibration";

describe("legacy calibration compatibility shim", () => {
  it("keeps old CI imports working without re-enabling the UI calibration path", () => {
    const samples = parseMeasurementCsv("predictedCycles,measuredCycles\n100,150\n200,300\n");
    expect(samples).toHaveLength(2);
    expect(calibrationFactor(samples)).toBeCloseTo(1.5);
    const profile = fitCalibrationProfile(samples);
    expect(applyCalibrationFactor(100, profile)).toBe(150);
  });
});
