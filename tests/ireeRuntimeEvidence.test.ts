import { describe, expect, it } from "vitest";
import { buildIreeRuntimeDecision, parseIreeBenchmarkLog, summarizeIreeBenchmarkLog } from "@/lib/ireeRuntimeEvidence";

describe("IREE runtime evidence", () => {
  it("parses Google Benchmark real_time rows and normalizes units", () => {
    const log = [
      "BM_main/real_time 1000 us 1000 us 10",
      "BM_main/real_time 1.2 ms 1.2 ms 10",
      "BM_main/real_time_p90 0.002 s 0.002 s 10",
    ].join("\n");
    const parsed = parseIreeBenchmarkLog(log);
    expect(parsed).toHaveLength(3);
    expect(parsed[0].valueMs).toBeCloseTo(1.0);
    const summary = summarizeIreeBenchmarkLog(log);
    expect(summary.medianMs).toBeGreaterThan(0);
    expect(summary.p90Ms).toBeCloseTo(2.0);
  });

  it("promotes hinted variant only when runtime improves against baseline", () => {
    const decision = buildIreeRuntimeDecision({
      runs: [
        { variant: "baseline", function: "matmul", runtime: { medianMs: 10 } },
        { variant: "hinted", function: "matmul", runtime: { medianMs: 8 } },
      ],
    }, { correctness: "checked" });
    expect(decision.status).toBe("promote-candidate");
    expect(decision.summary.medianSpeedup).toBeCloseTo(1.25);
  });

  it("flags runtime regressions instead of treating compile success as enough", () => {
    const decision = buildIreeRuntimeDecision({
      runs: [
        { variant: "baseline", function: "matmul", runtime: { medianMs: 10 } },
        { variant: "hinted", function: "matmul", runtime: { medianMs: 11 } },
      ],
    });
    expect(decision.status).toBe("regression");
    expect(decision.comparisons[0].status).toBe("regression");
  });
});
