import { describe, expect, it } from "vitest";
import { defaultCandidates, defaultHardware, defaultShapes } from "@/lib/defaults";
import { runMetamorphicChecks } from "@/lib/metamorphic";

describe("metamorphic checks", () => {
  it("passes core estimator metamorphic properties", () => {
    const checks = runMetamorphicChecks({ hardware: defaultHardware, shapes: defaultShapes, candidates: defaultCandidates, objective: "balanced" });
    expect(checks.every(c => c.passed)).toBe(true);
  });
});
