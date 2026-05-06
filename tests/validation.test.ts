import { describe, expect, it } from "vitest";
import { defaultCandidates, defaultHardware, defaultShapes } from "@/lib/defaults";
import { parseSearchRequest } from "@/lib/validation";

describe("request validation", () => {
  it("accepts the default request", () => {
    const req = parseSearchRequest({ hardware: defaultHardware, shapes: defaultShapes, candidates: defaultCandidates, objective: "balanced" });
    expect(req.shapes.length).toBeGreaterThan(0);
    expect(req.candidates.tileM).toEqual([...req.candidates.tileM].sort((a, b) => a - b));
  });
  it("rejects invalid dimensions", () => {
    expect(() => parseSearchRequest({ hardware: { ...defaultHardware, arrayRows: 0 }, shapes: defaultShapes, candidates: defaultCandidates, objective: "balanced" })).toThrow();
  });
  it("rejects empty candidate lists", () => {
    expect(() => parseSearchRequest({ hardware: defaultHardware, shapes: defaultShapes, candidates: { ...defaultCandidates, tileK: [] }, objective: "balanced" })).toThrow();
  });
});
