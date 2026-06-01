import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workspacePaths } from "./workspace";
import { toolAvailability } from "./doctor";
import { quotaConfig } from "@/lib/quotas";
import { maxParallelJobs } from "./jobStore";
import { countJobsByStatusSqlite, countJobsSqlite, sqlitePrimary } from "./sqliteStore";

function dirSizeBytes(dir: string): number {
  if (!fs.existsSync(dir)) return 0;
  let total = 0;
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const p = path.join(current, entry.name);
      try {
        if (entry.isDirectory()) stack.push(p);
        else total += fs.statSync(p).size;
      } catch { /* ignore transient files */ }
    }
  }
  return total;
}

function countJobs(root: string) {
  if (sqlitePrimary()) {
    const counts = countJobsByStatusSqlite();
    const total = countJobsSqlite();
    if (counts && total !== undefined) {
      return {
        total,
        queued: Number(counts.queued ?? 0),
        running: Number(counts.running ?? 0),
        failed: Number(counts.failed ?? 0),
        succeeded: Number(counts.succeeded ?? 0) + Number(counts.succeeded_with_warnings ?? 0),
        cancelled: Number(counts.cancelled ?? 0),
      };
    }
  }
  const out = { total: 0, queued: 0, running: 0, failed: 0, succeeded: 0, cancelled: 0 };
  if (!fs.existsSync(root)) return out;
  for (const name of fs.readdirSync(root)) {
    const jobPath = path.join(root, name, "job.json");
    if (!fs.existsSync(jobPath)) continue;
    out.total++;
    try {
      const status = JSON.parse(fs.readFileSync(jobPath, "utf8")).status as string;
      if (status in out) (out as any)[status]++;
      else if (status === "succeeded_with_warnings") out.succeeded++;
    } catch { out.failed++; }
  }
  return out;
}

const STATUS_SIZE_CACHE_MS = Math.max(1000, Number(process.env.TILEFORGE_STATUS_SIZE_CACHE_MS ?? 30_000));
const sizeCache = new Map<string, { at: number; bytes: number }>();

function cachedDirSizeBytes(dir: string): number {
  const now = Date.now();
  const cached = sizeCache.get(dir);
  if (cached && now - cached.at < STATUS_SIZE_CACHE_MS) return cached.bytes;
  const bytes = dirSizeBytes(dir);
  sizeCache.set(dir, { at: now, bytes });
  return bytes;
}

type CpuTimes = { idle: number; total: number };
let previousCpuTimes: CpuTimes[] | undefined;

function captureCpuTimes(): CpuTimes[] {
  return os.cpus().map((cpu) => {
    const times = cpu.times;
    const total = times.user + times.nice + times.sys + times.idle + times.irq;
    return { idle: times.idle, total };
  });
}

function sampleCpuUsage() {
  const cpus = os.cpus();
  const current = captureCpuTimes();
  const prev = previousCpuTimes;
  previousCpuTimes = current;
  const cores = current.map((cur, index) => {
    const old = prev?.[index];
    let usagePct = 0;
    if (old) {
      const totalDelta = cur.total - old.total;
      const idleDelta = cur.idle - old.idle;
      usagePct = totalDelta > 0 ? Math.max(0, Math.min(100, (1 - idleDelta / totalDelta) * 100)) : 0;
    }
    return {
      index,
      model: cpus[index]?.model ?? "CPU",
      speedMHz: cpus[index]?.speed ?? 0,
      usagePct: Number(usagePct.toFixed(1)),
    };
  });
  const overallPct = cores.length ? Number((cores.reduce((sum, c) => sum + c.usagePct, 0) / cores.length).toFixed(1)) : 0;
  return { overallPct, cores, sampleBased: Boolean(prev) };
}

export function systemStatus() {
  const paths = workspacePaths();
  const jobs = countJobs(paths.jobRoot);
  const cacheBytes = cachedDirSizeBytes(paths.cacheRoot);
  const jobBytes = cachedDirSizeBytes(paths.jobRoot);
  const tools = toolAvailability();
  const quota = quotaConfig();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();
  const usedMem = totalMem - freeMem;
  const parallelLimit = maxParallelJobs();
  const availableSlots = Math.max(0, parallelLimit - jobs.running);
  return {
    createdAt: new Date().toISOString(),
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    cpuCount: os.cpus()?.length ?? 1,
    cpu: sampleCpuUsage(),
    memory: {
      totalBytes: totalMem,
      freeBytes: freeMem,
      usedBytes: usedMem,
      usedPct: Number(((usedMem / totalMem) * 100).toFixed(1)),
      freePct: Number(((freeMem / totalMem) * 100).toFixed(1)),
    },
    workspace: paths,
    jobs,
    capacity: {
      parallelLimit,
      runningJobs: jobs.running,
      queuedJobs: jobs.queued,
      availableSlots,
      note: availableSlots > 0 ? `${availableSlots}개 작업을 추가로 즉시 실행할 수 있습니다.` : "병렬 실행 슬롯이 모두 사용 중입니다. 새 작업은 큐에서 대기합니다.",
    },
    storage: { cacheBytes, jobBytes, cacheMB: cacheBytes / 1024 / 1024, jobMB: jobBytes / 1024 / 1024 },
    tools,
    sqlite: { disabled: process.env.TILEFORGE_DISABLE_SQLITE === "1", optional: true },
    worker: { computeWorkers: Number(process.env.TILEFORGE_COMPUTE_WORKERS ?? 0), parallelJobs: parallelLimit, runningInUnifiedDev: process.env.npm_lifecycle_event === "dev" },
    quota
  };
}
