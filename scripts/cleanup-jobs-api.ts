import { listJobs, deleteJob } from "../src/server/jobStore";

async function main(): Promise<void> {
  const olderThanDaysArg = process.argv.find(a => a.startsWith("--older-than-days="));
  const olderThanDays = olderThanDaysArg ? Number(olderThanDaysArg.split("=")[1]) : 30;
  const cutoff = Date.now() - olderThanDays * 24 * 60 * 60 * 1000;
  let deleted = 0;

  for (const job of await listJobs()) {
    const finished = job.finishedAt ? Date.parse(job.finishedAt) : Date.parse(job.updatedAt);
    if (Number.isFinite(finished) && finished < cutoff) {
      await deleteJob(job.id);
      deleted++;
    }
  }

  console.log(JSON.stringify({ olderThanDays, deleted }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
