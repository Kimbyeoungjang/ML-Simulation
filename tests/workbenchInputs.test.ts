import { describe, expect, it } from "vitest";
import { defaultCandidates, defaultHardware, defaultShapes } from "@/lib/defaults";
import { makeSearchRequest, normalizeDataflowModes } from "@/components/workbench/useWorkbenchInputs";

const candidateGrid = {
  tileM: defaultCandidates.tileM,
  tileN: defaultCandidates.tileN,
  tileK: defaultCandidates.tileK,
};

describe("workbench input contract", () => {
  it("uses the primary selected dataflow in the SearchRequest without mutating hardware", () => {
    const request = makeSearchRequest({
      hardware: { ...defaultHardware, dataflow: "WS" },
      dataflowModes: ["OS", "IS"],
      shapes: defaultShapes,
      candidates: candidateGrid,
      objective: "balanced",
      scaleSim: { runName: "test", bandwidth: 128 },
    });
    expect(request.hardware.dataflow).toBe("OS");
    expect(defaultHardware.dataflow).toBe("WS");
  });

  it("keeps at least one dataflow selected when toggling the final mode", () => {
    expect(normalizeDataflowModes(["WS"], "WS")).toEqual(["WS"]);
    expect(normalizeDataflowModes(["WS"], "OS")).toEqual(["WS", "OS"]);
    expect(normalizeDataflowModes(["WS", "OS"], "WS")).toEqual(["OS"]);
  });
});
