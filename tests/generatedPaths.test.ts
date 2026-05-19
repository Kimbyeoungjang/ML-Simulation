import { describe, expect, it } from "vitest";
import { isGeneratedPath } from "../scripts/generated-paths";

describe("generated path classifier", () => {
  it("excludes local outputs and private env files from release packaging", () => {
    expect(isGeneratedPath(".env")).toBe(true);
    expect(isGeneratedPath(".tileforge/jobs/foo.json")).toBe(true);
    expect(isGeneratedPath("benchmarks/results/latest.json")).toBe(true);
    expect(isGeneratedPath("reports/soak-worker.json")).toBe(true);
    expect(isGeneratedPath("model.vmfb")).toBe(true);
  });

  it("keeps source fixtures, examples, and public env template", () => {
    expect(isGeneratedPath(".env.example")).toBe(false);
    expect(isGeneratedPath("benchmarks/baselines.json")).toBe(false);
    expect(isGeneratedPath("examples/validation_samples.csv")).toBe(false);
    expect(isGeneratedPath("src/lib/zip.ts")).toBe(false);
  });
});
