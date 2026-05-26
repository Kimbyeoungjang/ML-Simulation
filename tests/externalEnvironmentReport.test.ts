import { afterEach, describe, expect, it } from "vitest";
import { buildExternalEnvironmentReport, externalEnvironmentReportMarkdown } from "../src/server/externalEnvironmentReport";

const oldScale = process.env.TILEFORGE_SCALE_SIM_CMD;
const oldIree = process.env.TILEFORGE_IREE_COMPILE_CMD;
const oldBench = process.env.TILEFORGE_IREE_BENCH_CMD;

afterEach(() => {
  process.env.TILEFORGE_SCALE_SIM_CMD = oldScale;
  process.env.TILEFORGE_IREE_COMPILE_CMD = oldIree;
  process.env.TILEFORGE_IREE_BENCH_CMD = oldBench;
});

describe("externalEnvironmentReport", () => {
  it("records configured commands, resolved candidates, versions, and benchmark risk", () => {
    process.env.TILEFORGE_SCALE_SIM_CMD = "npx tsx scripts/mock-scalesim.ts";
    process.env.TILEFORGE_IREE_COMPILE_CMD = "npx tsx scripts/mock-iree-compile.ts";
    delete process.env.TILEFORGE_IREE_BENCH_CMD;

    const report = buildExternalEnvironmentReport({ scalesimVersion: "mock-scale", ireeVersion: "mock-iree", generatedAt: "test" });
    expect(report.schema).toBe("tileforge.external-environment-report.v1");
    expect(report.configured.scaleSimCommand).toContain("mock-scalesim");
    expect(report.resolvedCandidates.scaleSim[0]).toContain("mock-scalesim");
    expect(report.observedVersions.iree).toBe("mock-iree");
    expect(report.riskNotes.join("\n")).toContain("TILEFORGE_IREE_BENCH_CMD");

    const md = externalEnvironmentReportMarkdown(report);
    expect(md).toContain("External Environment Report");
    expect(md).toContain("Resolved candidate commands");
  });
});
