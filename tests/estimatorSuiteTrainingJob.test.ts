import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultCandidates, defaultHardware, defaultShapes } from "@/lib/defaults";
import { createJob, readJob, saveJob } from "@/server/jobStore";
import { runJob } from "@/server/workerRunner";

function csv(rows = 60) {
  const header = "id,model,opName,arrayRows,arrayCols,sramKB,frequencyMHz,dataflow,dtypeBytes,m,n,k,tileM,tileN,tileK,estimatorCycles,measuredCycles";
  const body = Array.from({ length: rows }, (_, i) => {
    const m = [128, 160, 192, 224][i % 4];
    const n = [384, 768, 1536, 2304][Math.floor(i / 2) % 4];
    const k = [384, 768, 1536][Math.floor(i / 3) % 3];
    const tileM = [64, 128][i % 2];
    const tileN = [128, 256, 512][Math.floor(i / 4) % 3];
    const tileK = [128, 256][Math.floor(i / 5) % 2];
    const estimator = Math.max(100, Math.round((m * n * k) / 8192));
    const measured = Math.round(estimator * (1.05 + (i % 5) * 0.02));
    const df = ["WS", "OS", "IS"][i % 3];
    return `s${i},vit,op${i % 3},128,128,8192,700,${df},2,${m},${n},${k},${tileM},${tileN},${tileK},${estimator},${measured}`;
  });
  return [header, ...body].join("\n");
}

describe("estimator suite training job", () => {
  it("runs as a queue job and writes live progress logs/artifacts", async () => {
    const oldRoot = process.env.TILEFORGE_JOB_ROOT;
    const oldWorkspace = process.env.TILEFORGE_WORKSPACE_ROOT;
    const root = await mkdtemp(path.join(os.tmpdir(), "tileforge-est-train-"));
    process.env.TILEFORGE_JOB_ROOT = path.join(root, "jobs");
    process.env.TILEFORGE_WORKSPACE_ROOT = root;
    try {
      const job = await createJob("estimator-suite-train", { hardware: defaultHardware, shapes: defaultShapes.slice(0, 1), candidates: defaultCandidates, objective: "balanced" }, "estimator_train_test");
      job.estimatorSuite = { mode: "csv", csvText: csv(), options: { trees: 8, maxDepth: 3, hiddenUnits: 6, epochs: 20, splits: "random", maxFinalTrainSamples: 50 }, activate: false };
      await saveJob(job);
      await runJob(job);
      const saved = await readJob(job.id);
      expect(saved.status).toBe("succeeded");
      expect(saved.kind).toBe("estimator-suite-train");
      expect(saved.logs.join("\n")).toContain("Tree residual");
      expect(saved.logs.join("\n")).toContain("Neural residual");
      expect(saved.progress).toBe(100);
      expect(saved.artifacts).toContain("estimator-suite-model.json");
      expect(await readFile(path.join(root, "estimator-suite", job.id, "estimator-suite-report.md"), "utf8")).toContain("TileForge Web Estimator Suite Report");
    } finally {
      await rm(root, { recursive: true, force: true });
      if (oldRoot === undefined) delete process.env.TILEFORGE_JOB_ROOT; else process.env.TILEFORGE_JOB_ROOT = oldRoot;
      if (oldWorkspace === undefined) delete process.env.TILEFORGE_WORKSPACE_ROOT; else process.env.TILEFORGE_WORKSPACE_ROOT = oldWorkspace;
    }
  });
});
