import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultCandidates, defaultHardware, defaultShapes } from "@/lib/defaults";
import { createJob, readJob } from "@/server/jobStore";
import { runJob } from "@/server/workerRunner";

describe("worker integration", () => {
  it("runs a full pipeline with mock external tools and records summaries", async () => {
    const oldRoot = process.env.TILEFORGE_JOB_ROOT;
    const oldWorkspace = process.env.TILEFORGE_WORKSPACE_ROOT;
    const oldScale = process.env.TILEFORGE_SCALE_SIM_CMD;
    const oldIree = process.env.TILEFORGE_IREE_COMPILE_CMD;
    const root = await mkdtemp(path.join(os.tmpdir(), "tileforge-it-"));
    process.env.TILEFORGE_JOB_ROOT = root;
    process.env.TILEFORGE_WORKSPACE_ROOT = root;
    const scaleMock = path.join(root, "mock-scalesim.sh");
    const ireeMock = path.join(root, "mock-iree.sh");
    await writeFile(scaleMock, "#!/bin/sh\nif [ \"$1\" = \"-h\" ] || [ \"$1\" = \"--version\" ]; then echo \"mock SCALE-Sim\"; exit 0; fi\ncat > COMPUTE_REPORT.csv <<'CSV'\nLayer Name,Cycles\nmock_layer,1234\nCSV\n", "utf8");
    await writeFile(ireeMock, "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo \"mock iree-compile\"; exit 0; fi\nout=''\nwhile [ \"$#\" -gt 0 ]; do\n  if [ \"$1\" = '-o' ]; then shift; out=\"$1\"; fi\n  shift || true\ndone\nif [ -z \"$out\" ]; then out='model.vmfb'; fi\nprintf 'mock-vmfb' > \"$out\"\n", "utf8");
    await chmod(scaleMock, 0o755);
    await chmod(ireeMock, 0o755);
    process.env.TILEFORGE_SCALE_SIM_CMD = scaleMock;
    process.env.TILEFORGE_IREE_COMPILE_CMD = ireeMock;
    try {
      const job = await createJob("full-pipeline", { hardware: defaultHardware, shapes: defaultShapes.slice(0, 1), candidates: defaultCandidates, objective: "balanced" });
      await runJob(job);
      const saved = await readJob(job.id);
      expect(saved.status).toBe("succeeded");
      expect(saved.artifacts).toContain("result.json");
      expect(saved.artifacts).toContain("scalesim_summary.json");
      expect(saved.artifacts).toContain("scalesim_top3_summary.json");
      expect(saved.artifacts).toContain("iree_summary.json");
      const scaleSummary = JSON.parse(await readFile(path.join(root, job.id, "scalesim_summary.json"), "utf8"));
      const scaleTop3Summary = JSON.parse(await readFile(path.join(root, job.id, "scalesim_top3_summary.json"), "utf8"));
      const ireeSummary = JSON.parse(await readFile(path.join(root, job.id, "iree_summary.json"), "utf8"));
      expect(scaleSummary.totalCycles).toBe(1234);
      expect(scaleSummary.candidateLayers.length).toBeGreaterThan(0);
      expect(scaleTop3Summary.layers.length).toBeGreaterThan(0);
      expect(ireeSummary.vmfbBytes).toBeGreaterThan(0);
      expect(await readFile(path.join(root, job.id, "report.md"), "utf8")).toContain("TileForge");
    } finally {
      await rm(root, { recursive: true, force: true });
      if (oldRoot === undefined) delete process.env.TILEFORGE_JOB_ROOT; else process.env.TILEFORGE_JOB_ROOT = oldRoot;
      if (oldWorkspace === undefined) delete process.env.TILEFORGE_WORKSPACE_ROOT; else process.env.TILEFORGE_WORKSPACE_ROOT = oldWorkspace;
      if (oldScale === undefined) delete process.env.TILEFORGE_SCALE_SIM_CMD; else process.env.TILEFORGE_SCALE_SIM_CMD = oldScale;
      if (oldIree === undefined) delete process.env.TILEFORGE_IREE_COMPILE_CMD; else process.env.TILEFORGE_IREE_COMPILE_CMD = oldIree;
    }
  });
});
