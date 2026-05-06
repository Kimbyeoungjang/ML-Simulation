import "../src/server/env";
import { findQueued, maxParallelJobs, recoverStaleRunningJobs } from "../src/server/jobStore";
import { runJob } from "../src/server/workerRunner";

const once = process.argv.includes("--once");
const active = new Set<string>();

async function startAvailableJobs() {
  const recovered = await recoverStaleRunningJobs();
  if (recovered > 0) console.log(`[tileforge-worker] recovered ${recovered} stale running job(s)`);
  const limit = maxParallelJobs();
  let started = 0;
  while (active.size < limit) {
    const job = await findQueued([...active]);
    if (!job) break;
    active.add(job.id);
    started++;
    console.log(`[tileforge-worker] start job ${job.id} (${active.size}/${limit})`);
    void runJob(job)
      .catch((error) => console.error(`[tileforge-worker] job ${job.id} failed`, error))
      .finally(() => {
        active.delete(job.id);
        console.log(`[tileforge-worker] finish job ${job.id} (${active.size}/${limit})`);
        if (!once) void startAvailableJobs().catch((e) => console.error(e));
      });
  }
  return started;
}

async function main() {
  console.log(`[tileforge-worker] started (${once ? "once" : "loop"}, parallel=${maxParallelJobs()})`);
  if (once) {
    await startAvailableJobs();
    while (active.size > 0) await new Promise((resolve) => setTimeout(resolve, 250));
    return;
  }
  setInterval(() => startAvailableJobs().catch((e) => console.error(e)), 1200);
  await startAvailableJobs();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
