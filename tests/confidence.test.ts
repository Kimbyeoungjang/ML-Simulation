import { describe, expect, it } from "vitest";
import { estimateAll } from "../src/lib/estimator";
import { defaultCandidates, defaultHardware, defaultShapes } from "../src/lib/defaults";
import { assessConfidence } from "../src/lib/confidence";

describe("confidence assessment", () => {
  it("returns bounded confidence and uncertainty", () => {
    const res = estimateAll({ hardware: defaultHardware, shapes: defaultShapes, candidates: defaultCandidates, objective: "balanced" });
    const conf = assessConfidence(res);
    expect(conf.score).toBeGreaterThanOrEqual(0);
    expect(conf.score).toBeLessThanOrEqual(1);
    expect(conf.uncertaintyPct).toBeGreaterThan(0);
  });
});
