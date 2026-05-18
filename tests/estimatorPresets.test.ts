import { describe, expect, it } from "vitest";
import { estimatorPresets } from "@/lib/estimatorPresets";

describe("estimator presets", () => {
  it("provides ready-to-run WS/OS/IS presets", () => {
    const quick = estimatorPresets.find((preset) => preset.id === "quick-512");
    expect(quick).toBeTruthy();
    expect(quick?.planOptions.maxSamples).toBe(512);
    expect(quick?.planOptions.queueLimit).toBe(512);
    expect(quick?.planOptions.dataflows.split(",").sort()).toEqual(["IS", "OS", "WS"]);
    expect(quick?.trainOptions.maxFinalTrainSamples).toBe(512);
  });

  it("includes a large dataset training preset", () => {
    const large = estimatorPresets.find((preset) => preset.id === "large-50000");
    expect(large?.trainOptions.hiddenUnits).toBeGreaterThanOrEqual(128);
    expect(large?.trainOptions.maxFinalTrainSamples).toBeGreaterThanOrEqual(50000);
  });
});
