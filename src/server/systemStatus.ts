import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { workspacePaths } from "./workspace";
import { toolAvailability } from "./doctor";
import { quotaConfig } from "@/lib/quotas";
import { maxParallelJobs } from "./jobStore";
import { countJobsByStatusSqlite, sqlitePrimary } from "./sqliteStore";

type JobCounts = { total: number; queued: number; running: number; failed: number; succeeded: number; cancelled: number; succeeded_with_warnings?: number; approx?: boolean; stale?: boolean };
type StorageSnapshot = { cacheBytes: number; jobBytes: number; cacheMB: number; jobMB: number; skippedScan?: boolean; stale?: boolean; scannedAt?: string };

function envNumber(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function envBool(name: string, fallback = false): boolean {
  const value = process.env[name];
  if (value === undefined) return fallback;
  return value === "1" || value.toLowerCase() === "true" || value.toLowerCase() === "yes";
}

function normalizeCounts(raw: Record<string, number> | undefined): JobCounts | undefined {
  if (!raw) return undefined;
  const succeeded = Number(raw.succeeded ?? 0);
  const succeededWithWarnings = Number(raw.succeeded_with_warnings ?? 0);
  return {
    total: Object.values(raw).reduce((sum, n) => sum + Number(n ?? 0), 0),
    queued: Number(raw.queued ?? 0),
    running: Number(raw.running ?? 0),
    failed: Number(raw.failed ?? 0),
    succeeded: succeeded + succeededWithWarnings,
    succeeded_with_warnings: succeededWithWarnings,
    cancelled: Number(raw.cancelled ?? 0),
  };
}

let jobsCountCache: { expiresAt: number; value: JobCounts } | undefined;

function shallowTotalJobs(root: string): number {
  try {
    if (!fs.existsSync(root)) return 0;
    return fs.readdirSync(root, { withFileTypes: true }).filter((entry) => entry.isDirectory()).length;
  } catch {
    return 0;
  }
}

function countJobsFast(root: string): JobCounts {
  const ttl = Math.max(500, Math.min(envNumber("TILEFORGE_STATUS_COUNTS_CACHE_MS", 5_000), 60_000));
  const now = Date.now();
  if (jobsCountCache && jobsCountCache.expiresAt > now) return jobsCountCache.value;

  const sqliteCounts = sqlitePrimary() ? normalizeCounts(countJobsByStatusSqlite()) : undefined;
  if (sqliteCounts) {
    jobsCountCache = { value: sqliteCounts, expiresAt: now + ttl };
    return sqliteCounts;
  }

  // Large workspaces can contain thousands of job.json files. Do not parse them
  // on the hot /api/system/status path; that blocks the entire Next dev server.
  // When SQLite is unavailable, keep the last known status counts and refresh
  // only the cheap total directory count.
  if (jobsCountCache) {
    const value = { ...jobsCountCache.value, total: Math.max(jobsCountCache.value.total, shallowTotalJobs(root)), stale: true };
    jobsCountCache = { value, expiresAt: now + ttl };
    return value;
  }

  const total = shallowTotalJobs(root);
  const value: JobCounts = { total, queued: 0, running: 0, failed: 0, succeeded: 0, cancelled: 0, approx: true };
  jobsCountCache = { value, expiresAt: now + ttl };
  return value;
}

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

let storageCache: { expiresAt: number; value: StorageSnapshot } | undefined;

function zeroStorage(skippedScan = true): StorageSnapshot {
  return { cacheBytes: 0, jobBytes: 0, cacheMB: 0, jobMB: 0, skippedScan };
}

function storageStatus(paths: ReturnType<typeof workspacePaths>, jobs: JobCounts): StorageSnapshot {
  const ttl = Math.max(5_000, Math.min(envNumber("TILEFORGE_STATUS_SIZE_CACHE_MS", 60_000), 10 * 60_000));
  const now = Date.now();
  if (storageCache && storageCache.expiresAt > now) return storageCache.value;

  const scanStorage = envBool("TILEFORGE_STATUS_SCAN_STORAGE", false);
  if (!scanStorage) {
    const value = storageCache?.value ? { ...storageCache.value, skippedScan: true, stale: true } : zeroStorage(true);
    storageCache = { value, expiresAt: now + ttl };
    return value;
  }

  // Recursive storage scans are extremely expensive while many SCALE-Sim/IREE
  // jobs are producing artifacts. Keep the cached value during active runs and
  // let users opt into a manual/idle refresh by enabling TILEFORGE_STATUS_SCAN_STORAGE.
  if (jobs.running > 0 && storageCache) {
    const value = { ...storageCache.value, stale: true };
    storageCache = { value, expiresAt: now + ttl };
    return value;
  }

  const cacheBytes = dirSizeBytes(paths.cacheRoot);
  const jobBytes = dirSizeBytes(paths.jobRoot);
  const value: StorageSnapshot = {
    cacheBytes,
    jobBytes,
    cacheMB: cacheBytes / 1024 / 1024,
    jobMB: jobBytes / 1024 / 1024,
    scannedAt: new Date().toISOString(),
  };
  storageCache = { value, expiresAt: now + ttl };
  return value;
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
  const jobs = countJobsFast(paths.jobRoot);
  const storage = storageStatus(paths, jobs);
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
    storage,
    tools,
    sqlite: { disabled: process.env.TILEFORGE_DISABLE_SQLITE === "1", optional: true, countsApprox: Boolean(jobs.approx), countsStale: Boolean(jobs.stale) },
    worker: { computeWorkers: Number(process.env.TILEFORGE_COMPUTE_WORKERS ?? 0), parallelJobs: parallelLimit, runningInUnifiedDev: process.env.npm_lifecycle_event === "dev" },
    quota
  };
}
