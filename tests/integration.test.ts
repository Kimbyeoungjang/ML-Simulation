import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultCandidates, defaultHardware, defaultShapes } from "@/lib/defaults";
import { createJob, readJob } from "@/server/jobStore";
import { runJob } from "@/server/workerRunner";

describe("worker integration", () => {
  it("runs a full pipeline without real external tools and reports warnings", async () => {
    const oldRoot = process.env.TILEFORGE_JOB_ROOT;
    process.env.TILEFORGE_JOB_ROOT = await mkdtemp(path.join(os.tmpdir(), "tileforge-it-"));
    delete process.env.TILEFORGE_SCALE_SIM_CMD;
    delete process.env.TILEFORGE_IREE_COMPILE_CMD;
    try {
      const job = await createJob("full-pipeline", { hardware: defaultHardware, shapes: defaultShapes.slice(0, 1), candidates: defaultCandidates, objective: "balanced" });
      await runJob(job);
      const saved = await readJob(job.id);
      expect(saved.status).toBe("succeeded_with_warnings");
      expect(saved.artifacts).toContain("result.json");
      expect(saved.artifacts).toContain("scalesim_skipped.txt");
      expect(await readFile(path.join(process.env.TILEFORGE_JOB_ROOT!, job.id, "report.md"), "utf8")).toContain("TileForge");
    } finally {
      if (process.env.TILEFORGE_JOB_ROOT) await rm(process.env.TILEFORGE_JOB_ROOT, { recursive: true, force: true });
      if (oldRoot === undefined) delete process.env.TILEFORGE_JOB_ROOT; else process.env.TILEFORGE_JOB_ROOT = oldRoot;
    }
  });
});
