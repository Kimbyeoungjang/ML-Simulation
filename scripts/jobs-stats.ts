import { listJobs } from "@/server/jobStore";
import { getJobRoot } from "@/server/workspace";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";

async function dirSize(dir: string): Promise<number> {
  let total = 0;
  try {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) total += await dirSize(p);
      else total += (await stat(p)).size;
    }
  } catch {}
  return total;
}

async function main(): Promise<void> {
  const jobs = await listJobs();
  const byStatus = new Map<string, number>();
  for (const job of jobs) byStatus.set(job.status, (byStatus.get(job.status) ?? 0) + 1);
  const bytes = await dirSize(getJobRoot());
  console.log(JSON.stringify({ jobRoot: getJobRoot(), totalJobs: jobs.length, byStatus: Object.fromEntries(byStatus), bytes }, null, 2));
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
