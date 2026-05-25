import "../src/server/env";
import { claimQueuedJob, maxParallelJobs, recoverStaleRunningJobs } from "../src/server/jobStore";
import { runJob } from "../src/server/workerRunner";

const once = process.argv.includes("--once");
const active = new Set<string>();
let polling = false;

function intEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(Math.floor(parsed), max));
}

const pollMs = intEnv("TILEFORGE_WORKER_POLL_MS", 1200, 250, 60_000);

async function startAvailableJobs() {
  if (polling) return 0;
  polling = true;
  try {
    const recovered = await recoverStaleRunningJobs();
    if (recovered > 0) console.log(`[tileforge-worker] recovered ${recovered} stale running job(s)`);
    const limit = maxParallelJobs();
    let started = 0;
    while (active.size < limit) {
      const job = await claimQueuedJob([...active]);
      if (!job) break;
      if (active.has(job.id)) continue;
      active.add(job.id);
      started++;
      console.log(`[tileforge-worker] start job ${job.id} (${active.size}/${limit})`);
      void runJob(job, { lockHeld: true })
        .catch((error) => console.error(`[tileforge-worker] job ${job.id} failed`, error))
        .finally(() => {
          active.delete(job.id);
          console.log(`[tileforge-worker] finish job ${job.id} (${active.size}/${limit})`);
          if (!once) void startAvailableJobs().catch((e) => console.error(e));
        });
    }
    return started;
  } finally {
    polling = false;
  }
}

async function main() {
  console.log(`[tileforge-worker] started (${once ? "once" : "loop"}, parallel=${maxParallelJobs()}, pollMs=${pollMs})`);
  if (once) {
    await startAvailableJobs();
    while (active.size > 0) await new Promise((resolve) => setTimeout(resolve, 250));
    return;
  }
  setInterval(() => startAvailableJobs().catch((e) => console.error(e)), pollMs);
  await startAvailableJobs();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
