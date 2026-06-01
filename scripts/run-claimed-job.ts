import "../src/server/env";
import { readJob } from "../src/server/jobStore";
import { runJob } from "../src/server/workerRunner";

async function main() {
  const id = process.argv[2];
  if (!id) throw new Error("Usage: tsx scripts/run-claimed-job.ts <job-id>");
  const job = await readJob(id);
  await runJob(job, { lockHeld: true });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
