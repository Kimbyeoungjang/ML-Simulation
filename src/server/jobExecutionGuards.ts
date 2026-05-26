import type { JobRecord } from "@/types/job";
import { readJob, saveJob } from "./jobStore";

export async function throwIfCancelled(job: JobRecord) {
  const latest = await readJob(job.id);
  if (latest.cancelRequested || latest.status === "cancelled") {
    job.status = "cancelled";
    job.stage = "cancelled";
    job.progress = 100;
    await saveJob(job);
    throw new Error("사용자가 job을 취소했습니다");
  }
}

export async function withTimeout<T>(
  job: JobRecord,
  label: string,
  work: () => Promise<T>,
): Promise<T> {
  const timeoutMs =
    job.timeoutMs ??
    Number(process.env.TILEFORGE_JOB_TIMEOUT_MS ?? 10 * 60 * 1000);
  let timer: NodeJS.Timeout | undefined;
  try {
    return await Promise.race([
      work(),
      new Promise<T>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs} ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
