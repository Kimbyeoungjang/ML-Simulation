import { describe, expect, it } from "vitest";
import { applyCalibrationFactor, calibrationFactor, fitCalibrationProfile, parseMeasurementCsv } from "../src/lib/calibration";

describe("calibration utilities", () => {
  it("parses measurement CSVs and fits a weighted cycle ratio", () => {
    const samples = parseMeasurementCsv('predictedCycles,measuredCycles,weight\n100,150,2\n200,300,1\n');
    expect(samples).toHaveLength(2);
    expect(calibrationFactor(samples)).toBeCloseTo(1.5);
    const profile = fitCalibrationProfile(samples);
    expect(applyCalibrationFactor(100, profile)).toBe(150);
  });

  it("handles quoted spreadsheet exports", () => {
    const samples = parseMeasurementCsv('estimatorCycles,scaleSimCycles\n"1,000",1500\n');
    expect(samples).toHaveLength(1);
    expect(samples[0].predictedCycles).toBe(1000);
    expect(samples[0].measuredCycles).toBe(1500);
  });
});
