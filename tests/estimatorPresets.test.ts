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


  it("adds lite real-ML presets that avoid Llama-scale shapes", () => {
    const lite1k = estimatorPresets.find((preset) => preset.id === "real-ml-lite-1024");
    const lite2k = estimatorPresets.find((preset) => preset.id === "real-ml-lite-2048");
    expect(lite1k).toBeTruthy();
    expect(lite2k).toBeTruthy();
    expect(lite1k?.planOptions.maxSamples).toBe(1024);
    expect(lite2k?.planOptions.maxSamples).toBe(2048);
    expect(lite1k?.planOptions.topKPerShape).toBe(1);
    expect(lite2k?.planOptions.topKPerShape).toBe(1);
    expect(lite1k?.planOptions.includeCurrentShapes).toBe(false);
    expect(lite2k?.planOptions.includeCurrentShapes).toBe(false);
    expect(String(lite1k?.planOptions.shapeBank).toLowerCase()).not.toContain("llama");
    expect(String(lite2k?.planOptions.shapeBank).toLowerCase()).not.toContain("llama");
    expect(lite1k?.planOptions.mRange).toBe("");
    expect(lite2k?.planOptions.nRange).toBe("");
  });

  it("includes a large dataset training preset", () => {
    const large = estimatorPresets.find((preset) => preset.id === "large-50000");
    expect(large?.trainOptions.hiddenUnits).toBeGreaterThanOrEqual(128);
    expect(large?.trainOptions.maxFinalTrainSamples).toBeGreaterThanOrEqual(50000);
  });
});
