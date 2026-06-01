import "../src/server/env";
import { spawn } from "node:child_process";
import path from "node:path";
import type { JobRecord } from "../src/types/job";
import {
  claimQueuedJob,
  maxParallelJobs,
  readJob,
  recoverStaleRunningJobs,
  releaseJobLock,
  updateJobStatus,
} from "../src/server/jobStore";
import { runJob } from "../src/server/workerRunner";

const once = process.argv.includes("--once");
const active = new Map<string, JobRecord>();
let scheduling = false;
let lastRecoveryAt = 0;

function isTrainingJob(job: JobRecord | undefined) {
  return job?.kind === "estimator-suite-train";
}

function hasActiveTrainingJob() {
  for (const job of active.values()) if (isTrainingJob(job)) return true;
  return false;
}

function trainingHeapMb() {
  const parsed = Number(process.env.TILEFORGE_TRAIN_HEAP_MB ?? 12_288);
  return Math.max(4_096, Math.min(Number.isFinite(parsed) ? Math.floor(parsed) : 12_288, 65_536));
}

function tsxCliPath() {
  return path.join(process.cwd(), "node_modules", "tsx", "dist", "cli.mjs");
}

async function runClaimedTrainingJobInChild(job: JobRecord): Promise<void> {
  const heapMb = trainingHeapMb();
  const args = [
    `--max-old-space-size=${heapMb}`,
    tsxCliPath(),
    "-r",
    "tsconfig-paths/register",
    "scripts/run-claimed-job.ts",
    job.id,
  ];
  console.log(`[tileforge-worker] estimator training job ${job.id} delegated to child process (heap=${heapMb}MB)`);
  const code = await new Promise<number>((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: { ...process.env, TILEFORGE_CHILD_JOB: "1" },
      stdio: ["ignore", "inherit", "inherit"],
      shell: false,
    });
    child.on("error", (error) => {
      console.error(`[tileforge-worker] failed to spawn training child for ${job.id}`, error);
      resolve(1);
    });
    child.on("close", (exitCode, signal) => {
      if (signal) console.error(`[tileforge-worker] training child ${job.id} exited by signal ${signal}`);
      resolve(exitCode ?? (signal ? 1 : 0));
    });
  });
  if (code !== 0) {
    try {
      const latest = await readJob(job.id);
      if (latest.status === "running") {
        latest.error = JSON.stringify({
          code: "TRAINING_CHILD_FAILED",
          message: `Estimator Suite training child exited with code ${code}. Node heap may still be too small, or the dataset/model options are too heavy.`,
          hint: "Try TILEFORGE_TRAIN_HEAP_MB=16384, fewer trees/epochs, or maxFinalTrainSamples=4096~8192.",
        }, null, 2);
        await updateJobStatus(latest, "failed", `Estimator Suite 학습 child process 실패(code=${code})`);
        await releaseJobLock(latest);
      }
    } catch (error) {
      console.error(`[tileforge-worker] failed to mark training job ${job.id} failed`, error);
    }
    throw new Error(`training child exited with code ${code}`);
  }
}

async function recoverIfDue() {
  const intervalMs = Math.max(5_000, Number(process.env.TILEFORGE_RUNNING_RECOVERY_INTERVAL_MS ?? 30_000));
  const now = Date.now();
  if (now - lastRecoveryAt < intervalMs) return;
  lastRecoveryAt = now;
  const recovered = await recoverStaleRunningJobs();
  if (recovered > 0) console.log(`[tileforge-worker] recovered ${recovered} stale running job(s)`);
}

async function runClaimedJob(job: JobRecord) {
  if (isTrainingJob(job)) return runClaimedTrainingJobInChild(job);
  return runJob(job, { lockHeld: true });
}

async function startAvailableJobs() {
  if (scheduling) return 0;
  scheduling = true;
  try {
    await recoverIfDue();
    if (hasActiveTrainingJob()) return 0;

    const limit = maxParallelJobs();
    let started = 0;
    while (active.size < limit) {
      const job = await claimQueuedJob([...active.keys()], {
        excludeKinds: active.size > 0 ? ["estimator-suite-train"] : undefined,
      });
      if (!job) break;
      if (active.has(job.id)) continue;
      active.set(job.id, job);
      started++;
      console.log(`[tileforge-worker] start job ${job.id} (${active.size}/${limit}, kind=${job.kind})`);
      void runClaimedJob(job)
        .catch((error) => console.error(`[tileforge-worker] job ${job.id} failed`, error))
        .finally(() => {
          active.delete(job.id);
          console.log(`[tileforge-worker] finish job ${job.id} (${active.size}/${limit})`);
          if (!once) void startAvailableJobs().catch((e) => console.error(e));
        });

      // Estimator Suite training is intentionally exclusive. It can allocate a
      // large heap and should not compete with SCALE-Sim/IREE child processes.
      if (isTrainingJob(job)) break;
    }
    return started;
  } finally {
    scheduling = false;
  }
}

async function main() {
  console.log(`[tileforge-worker] started (${once ? "once" : "loop"}, parallel=${maxParallelJobs()}, trainHeap=${trainingHeapMb()}MB)`);
  if (once) {
    await startAvailableJobs();
    while (active.size > 0) await new Promise((resolve) => setTimeout(resolve, 250));
    return;
  }
  setInterval(() => startAvailableJobs().catch((e) => console.error(e)), 2000);
  await startAvailableJobs();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
