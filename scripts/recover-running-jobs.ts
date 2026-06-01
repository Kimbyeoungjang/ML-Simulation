import "../src/server/env";
import { listJobs, readJob, releaseJobLock, saveJob } from "../src/server/jobStore";

const force = process.argv.includes("--force");
const requeue = process.argv.includes("--requeue");

async function main() {
  const jobs = (await listJobs()).filter((j) => j.status === "running");
  let changed = 0;
  for (const job of jobs) {
    const latest = await readJob(job.id).catch(() => job);
    if (latest.status !== "running") continue;
    if (!force) {
      console.log(`${latest.id}\t${latest.name ?? ""}\t${latest.stage}\t${latest.updatedAt}`);
      continue;
    }
    latest.status = requeue ? "queued" : "failed";
    latest.stage = requeue ? "queued" : ("failed" as any);
    latest.progress = requeue ? 0 : Math.max(latest.progress ?? 0, 95);
    latest.error = requeue ? undefined : JSON.stringify({ code: "MANUAL_RUNNING_RECOVERY", message: "Manually recovered a running job after worker crash/OOM." }, null, 2);
    latest.finishedAt = requeue ? undefined : new Date().toISOString();
    await releaseJobLock(latest);
    await saveJob(latest);
    changed++;
  }
  if (!force) {
    console.log(`running jobs: ${jobs.length}`);
    console.log("Use --force to mark them failed, or --force --requeue to put them back in queue.");
  } else {
    console.log(`${changed} running job(s) ${requeue ? "requeued" : "marked failed"}.`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
