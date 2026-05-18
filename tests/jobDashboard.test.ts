import { describe, expect, it } from "vitest";
import { dashboardJobs } from "@/server/jobStore";

function job(id: string, status: string, createdAt: string, updatedAt = createdAt): any {
  return { id, status, kind: "full-pipeline", stage: status, progress: status === "running" ? 50 : 0, createdAt, updatedAt, request: {}, logs: [], artifacts: [], warnings: [] };
}

describe("job dashboard view", () => {
  it("keeps running jobs visible even when many queued jobs exist", () => {
    const jobs = [
      ...Array.from({ length: 120 }, (_, i) => job(`q${i}`, "queued", `2026-05-18T10:${String(i % 60).padStart(2, "0")}:00.000Z`)),
      job("running-old", "running", "2026-05-18T09:00:00.000Z", "2026-05-18T11:00:00.000Z"),
      job("done", "succeeded", "2026-05-18T08:00:00.000Z", "2026-05-18T11:01:00.000Z"),
    ];
    const visible = dashboardJobs(jobs, 50);
    expect(visible.some((j) => j.id === "running-old")).toBe(true);
    expect(visible.some((j) => j.id === "done")).toBe(true);
    expect(visible.length).toBeLessThanOrEqual(50);
  });
});
