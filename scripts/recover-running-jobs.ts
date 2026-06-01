import "../src/server/env";
import { listJobs, releaseJobLock, saveJob } from "../src/server/jobStore";
import { nowIso } from "../src/lib/determinism";

const force = process.argv.includes("--force");
const requeue = process.argv.includes("--requeue") || process.argv.includes("--queued");
const olderThanMsArg = process.argv.find((a) => a.startsWith("--older-than-ms="));
const olderThanMs = Number(olderThanMsArg?.split("=")[1] ?? 30_000);
const now = Date.now();
let touched = 0;

for (const job of await listJobs()) {
  if (job.status !== "running") continue;
  const ageMs = now - Date.parse(job.updatedAt || job.createdAt || new Date(0).toISOString());
  if (!force && Number.isFinite(ageMs) && ageMs < olderThanMs) continue;
  if (requeue) {
    job.status = "queued";
    job.stage = "queued";
    job.progress = 0;
    job.startedAt = undefined;
    job.finishedAt = undefined;
    job.error = undefined;
  } else {
    job.status = "failed";
    job.stage = "failed" as any;
    job.progress = Math.max(job.progress ?? 0, 95);
    job.finishedAt = nowIso();
    job.error = JSON.stringify({
      code: "MANUAL_RUNNING_JOB_RECOVERY",
      message: "worker crash/OOM 이후 running 상태로 남은 job을 수동 복구했습니다.",
    }, null, 2);
  }
  job.updatedAt = nowIso();
  job.logs = [...(job.logs ?? []), `[${job.updatedAt}] ${requeue ? "running job을 queued로 되돌렸습니다." : "running job을 failed로 정리했습니다."}`].slice(-300);
  await saveJob(job);
  await releaseJobLock(job).catch(() => undefined);
  touched++;
}

console.log(JSON.stringify({ ok: true, touched, mode: requeue ? "requeue" : "fail", force, olderThanMs }, null, 2));
