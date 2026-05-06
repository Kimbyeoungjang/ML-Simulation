import { describe, expect, it } from "vitest";
import { parseJobKind, parseSearchRequest } from "@/lib/validation";
import { defaultHardware, defaultShapes, defaultCandidates } from "@/lib/defaults";
import { createJob, readJob, requestCancel } from "@/server/jobStore";

describe("API contract primitives", () => {
  const request = { hardware: defaultHardware, shapes: defaultShapes.slice(0,1), candidates: defaultCandidates, objective: "balanced" as const };

  it("accepts the canonical estimate request shape", () => {
    const parsed = parseSearchRequest(request);
    expect(parsed.hardware.arrayRows).toBeGreaterThan(0);
    expect(parsed.shapes).toHaveLength(1);
  });

  it("rejects invalid estimate requests", () => {
    expect(() => parseSearchRequest({ ...request, hardware: { ...defaultHardware, arrayRows: 0 } })).toThrow();
  });

  it("falls back invalid job kind to full-pipeline", () => {
    expect(parseJobKind("unknown")).toBe("full-pipeline");
  });

  it("creates, reads, and cancels a job", async () => {
    process.env.TILEFORGE_DETERMINISTIC = "";
    const job = await createJob("estimate", request);
    const loaded = await readJob(job.id);
    expect(loaded.status).toBe("queued");
    const cancelled = await requestCancel(job.id);
    expect(cancelled.cancelRequested).toBe(true);
  });
});
