import "../src/server/env";
import { claimQueuedJob, maxParallelJobs, recoverStaleRunningJobs } from "../src/server/jobStore";
import { runJob } from "../src/server/workerRunner";

const once = process.argv.includes("--once");
const active = new Set<string>();
let scheduling: Promise<number> | undefined;
let lastRecoverAt = 0;

const recoverIntervalMs = Math.max(
  5_000,
  Number(process.env.TILEFORGE_RUNNING_RECOVERY_INTERVAL_MS ?? 30_000),
);

async function recoverStaleRunningJobsThrottled() {
  const now = Date.now();
  if (now - lastRecoverAt < recoverIntervalMs) return 0;
  lastRecoverAt = now;
  const recovered = await recoverStaleRunningJobs();
  if (recovered > 0) console.log(`[tileforge-worker] recovered ${recovered} stale running job(s)`);
  return recovered;
}

async function startAvailableJobs() {
  // Keep scheduling single-flight. With thousands of jobs, overlapping scans from
  // the interval and each job's finally() can accumulate large temporary arrays
  // and push V8 into OOM.
  if (scheduling) return scheduling;
  scheduling = startAvailableJobsInner().finally(() => { scheduling = undefined; });
  return scheduling;
}

async function startAvailableJobsInner() {
  await recoverStaleRunningJobsThrottled();
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
