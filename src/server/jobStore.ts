import "./env";
import { readProjectDotEnv } from "./env";
import { mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import type { JobKind, JobRecord, JobStatus, JobStage } from "@/types/job";
import type { SearchRequest } from "@/types/domain";
import { hashObject } from "@/lib/hash";
import { ensureJobRoot, getJobRoot, jobDir } from "./workspace";
import { nowIso, stableId } from "@/lib/determinism";
import { countJobsSqlite, deleteJobSqlite, listDashboardJobsSqlite, listJobsPageSqlite, listJobsSqlite, markStageSqlite, mirrorLog, readJobSqlite, saveJobSqlite, selectQueuedJobsSqlite, sqlitePrimary } from "./sqliteStore";
import { atomicWriteFile } from "./atomic";
import { appendJobEvent } from "./eventsLog";
import { assertTransition, isTerminalStatus } from "@/lib/stateMachine";

const DEFAULT_TIMEOUT_MS = Number(process.env.TILEFORGE_JOB_TIMEOUT_MS ?? 10 * 60 * 1000);
const DEFAULT_MAX_ATTEMPTS = Number(process.env.TILEFORGE_JOB_MAX_ATTEMPTS ?? 1);
const MAX_JOB_LOG_LINES = Math.max(50, Math.min(Number(process.env.TILEFORGE_MAX_JOB_LOG_LINES ?? 300), 2000));
function trimJobForStorage(job: JobRecord) {
  if (Array.isArray(job.logs) && job.logs.length > MAX_JOB_LOG_LINES) {
    job.logs = job.logs.slice(-MAX_JOB_LOG_LINES);
  }
  if (Array.isArray(job.stageHistory) && job.stageHistory.length > 300) {
    job.stageHistory = job.stageHistory.slice(-300);
  }
}

export function maxParallelJobs(): number {
  // Read .env on every check so the UI can change TILEFORGE_MAX_PARALLEL_JOBS
  // without restarting the long-running worker process. the .env value wins so changes saved from the UI are picked up
  // by both the web server and the separate worker process without restart.
  const envFile = readProjectDotEnv();
  const value = envFile.TILEFORGE_MAX_PARALLEL_JOBS
    ?? process.env.TILEFORGE_MAX_PARALLEL_JOBS
    ?? envFile.TILEFORGE_JOB_PARALLELISM
    ?? process.env.TILEFORGE_JOB_PARALLELISM
    ?? 2;
  const parsed = Number(value);
  return Math.max(1, Math.min(Number.isFinite(parsed) ? Math.floor(parsed) : 2, 32));
}
export function requestCacheKey(kind: JobKind, request: SearchRequest): string {
  return hashObject({ jobKind: kind, request });
}

function timestampSuffix(date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}${pad(date.getMonth()+1)}${pad(date.getDate())}_${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`;
}

function safeJobName(name: string): string {
  return name.trim().replace(/[^A-Za-z0-9가-힣_.-]+/g, "_").replace(/^_+|_+$/g, "") || "job";
}

function uniqueJobNameFromSet(base: string, used: Set<string>, indexHint = 0): string {
  const safe = safeJobName(base);
  if (!used.has(safe)) {
    used.add(safe);
    return safe;
  }
  const suffix = timestampSuffix();
  let i = Math.max(2, indexHint + 2);
  let candidate = `${safe}_${suffix}`;
  while (used.has(candidate)) candidate = `${safe}_${suffix}_${i++}`;
  used.add(candidate);
  return candidate;
}

async function uniqueJobName(base: string): Promise<string> {
  const jobs = await listJobsPaged({ limit: 1000 }).then(r => r.jobs).catch(() => []);
  const used = new Set(jobs.map(j => j.name).filter(Boolean) as string[]);
  return uniqueJobNameFromSet(base, used);
}

export async function createJob(kind: JobKind, request: SearchRequest, requestedName?: string): Promise<JobRecord> {
  await ensureJobRoot();
  await enforceJobQuota();
  const id = stableId("job");
  const now = nowIso();
  const rec: JobRecord = {
    id, kind, name: await uniqueJobName(requestedName || request.hardware?.name || kind), requestHash: requestCacheKey(kind, request), status: "queued", stage: "queued", progress: 0, cancelRequested: false,
    createdAt: now, updatedAt: now, request, logs: [], artifacts: [], warnings: [],
    attempts: 0, maxAttempts: DEFAULT_MAX_ATTEMPTS, timeoutMs: DEFAULT_TIMEOUT_MS,
    stageHistory: [{ stage: "queued", status: "done", at: now, detail: "created" }]
  };
  await mkdir(jobDir(id), { recursive: true });
  await saveJob(rec);
  return rec;
}

export interface BulkJobInput { kind: JobKind; request: SearchRequest; name?: string; }

export async function createJobsBulk(inputs: BulkJobInput[]): Promise<JobRecord[]> {
  await ensureJobRoot();
  if (inputs.length === 0) return [];
  await enforceJobQuota(inputs.length);
  const existing = await listJobsPaged({ limit: 1000 }).then(r => r.jobs).catch(() => []);
  const usedNames = new Set(existing.map(j => j.name).filter(Boolean) as string[]);
  const now = nowIso();
  const jobs: JobRecord[] = inputs.map((input, index) => {
    const id = stableId("job");
    const request = input.request;
    return {
      id,
      kind: input.kind,
      name: uniqueJobNameFromSet(input.name || request.hardware?.name || input.kind, usedNames, index),
      requestHash: requestCacheKey(input.kind, request),
      status: "queued",
      stage: "queued",
      progress: 0,
      cancelRequested: false,
      createdAt: now,
      updatedAt: now,
      request,
      logs: [],
      artifacts: [],
      warnings: [],
      attempts: 0,
      maxAttempts: DEFAULT_MAX_ATTEMPTS,
      timeoutMs: DEFAULT_TIMEOUT_MS,
      stageHistory: [{ stage: "queued", status: "done", at: now, detail: "bulk-created" }],
    };
  });
  for (const job of jobs) {
    await mkdir(jobDir(job.id), { recursive: true });
    await saveJob(job);
  }
  return jobs;
}

const jobSaveQueues = new Map<string, Promise<void>>();

export async function saveJob(job: JobRecord) {
  job.updatedAt = nowIso();
  const id = job.id;
  const previous = jobSaveQueues.get(id) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(async () => {
    trimJobForStorage(job);
    await mkdir(jobDir(id), { recursive: true });
    await atomicWriteFile(path.join(jobDir(id), "job.json"), JSON.stringify(job, null, 2));
    try {
      saveJobSqlite(job);
    } catch (error) {
      console.warn(`[tileforge] sqlite mirror save failed for job ${id}:`, error);
    }
  });
  jobSaveQueues.set(id, next);
  try {
    await next;
  } finally {
    if (jobSaveQueues.get(id) === next) jobSaveQueues.delete(id);
  }
}

export async function readJob(id: string): Promise<JobRecord> {
  const fromDb = sqlitePrimary() ? readJobSqlite(id) : undefined;
  if (fromDb) return fromDb;
  return JSON.parse(await readFile(path.join(jobDir(id), "job.json"), "utf8"));
}

export async function listJobs(): Promise<JobRecord[]> {
  await ensureJobRoot();
  const merged = new Map<string, JobRecord>();
  const dbJobs = sqlitePrimary() ? listJobsSqlite() : undefined;
  for (const j of dbJobs ?? []) merged.set(j.id, j);
  const dirs = await readdir(getJobRoot(), { withFileTypes: true });
  for (const d of dirs) if (d.isDirectory()) {
    try {
      const fileJob = JSON.parse(await readFile(path.join(jobDir(d.name), "job.json"), "utf8"));
      if (!merged.has(fileJob.id)) merged.set(fileJob.id, fileJob);
    } catch {}
  }
  return [...merged.values()].sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
}

export async function hasRunningJob(): Promise<boolean> {
  const n = sqlitePrimary() ? countJobsSqlite("running") : undefined;
  if (n !== undefined) return n > 0;
  return (await listJobs()).some(j => j.status === "running");
}

export async function runningJobCount(): Promise<number> {
  const n = sqlitePrimary() ? countJobsSqlite("running") : undefined;
  if (n !== undefined) return n;
  return (await listJobs()).filter(j => j.status === "running").length;
}

export async function findQueued(excludeIds: string[] = []): Promise<JobRecord | undefined> {
  const running = await runningJobCount();
  if (running >= maxParallelJobs()) return undefined;
  const sqliteCandidates = sqlitePrimary() ? selectQueuedJobsSqlite(1, excludeIds) : undefined;
  if (sqliteCandidates) return sqliteCandidates[0];
  const jobs = await listJobs();
  const excluded = new Set(excludeIds);
  return jobs.reverse().find(j => j.status === "queued" && !excluded.has(j.id));
}

export async function claimQueuedJob(excludeIds: string[] = []): Promise<JobRecord | undefined> {
  const running = await runningJobCount();
  if (running >= maxParallelJobs()) return undefined;
  const sqliteCandidates = sqlitePrimary() ? selectQueuedJobsSqlite(64, excludeIds) : undefined;
  const candidates = sqliteCandidates ?? (() => {
    return [] as JobRecord[];
  })();
  const fallbackCandidates = async () => {
    const jobs = await listJobs();
    const excluded = new Set(excludeIds);
    return jobs.reverse().filter(j => j.status === "queued" && !excluded.has(j.id));
  };
  for (const job of (sqliteCandidates ?? await fallbackCandidates())) {
    const locked = await acquireJobLock(job);
    if (!locked) continue;
    job.status = "running";
    job.stage = "queued";
    job.startedAt = job.startedAt ?? nowIso();
    appendLogSync(job, "worker가 job을 큐에서 가져와 실행 슬롯을 예약했습니다.");
    await saveJob(job);
    return job;
  }
  return undefined;
}


export async function recoverStaleRunningJobs(): Promise<number> {
  const jobs = await listJobs();
  const now = Date.now();
  let recovered = 0;
  for (const job of jobs) {
    if (job.status !== "running") continue;
    const ageMs = now - Date.parse(job.updatedAt || job.createdAt || new Date(0).toISOString());
    const staleMs = Math.max(Number(job.timeoutMs ?? DEFAULT_TIMEOUT_MS) + 30_000, 90_000);
    if (!Number.isFinite(ageMs) || ageMs < staleMs) continue;
    job.status = "failed";
    job.stage = "failed" as any;
    job.progress = Math.max(job.progress ?? 0, 95);
    job.finishedAt = nowIso();
    job.error = JSON.stringify({
      code: "STALE_RUNNING_JOB",
      message: `worker가 종료되었거나 응답하지 않아 ${Math.round(ageMs / 1000)}초 동안 갱신되지 않은 running job을 실패 처리했습니다.`,
    }, null, 2);
    appendLogSync(job, "오래 갱신되지 않은 running job을 실패 처리하고 큐를 계속 진행합니다.");
    await saveJob(job);
    recovered++;
  }
  return recovered;
}

export async function updateJobStatus(job: JobRecord, status: JobStatus, log?: string) {
  assertTransition(job.status, status);
  job.status = status;
  if (isTerminalStatus(status)) job.finishedAt = nowIso();
  void appendJobEvent(job.id, { level: status === "failed" ? "error" : "info", stage: job.stage, code: `STATUS_${status.toUpperCase()}`, message: log ?? `status=${status}` });
  if (log) appendLogSync(job, log);
  await saveJob(job);
}

function appendLogSync(job: JobRecord, log: string) {
  const at = nowIso();
  const line = `[${at}] ${log}`;
  job.logs.push(line);
  if (job.logs.length > MAX_JOB_LOG_LINES) job.logs.splice(0, job.logs.length - MAX_JOB_LOG_LINES);
  mirrorLog(job.id, line, at);
  void appendJobEvent(job.id, { level: log.startsWith("WARNING") ? "warn" : "info", stage: job.stage, message: log });
}


function saveJobSnapshotSync(job: JobRecord) {
  job.updatedAt = nowIso();
  const dir = jobDir(job.id);
  mkdirSync(dir, { recursive: true });
  trimJobForStorage(job);
  const tmp = path.join(dir, "job.json.tmp");
  writeFileSync(tmp, JSON.stringify(job, null, 2), "utf8");
  renameSync(tmp, path.join(dir, "job.json"));
  try {
    saveJobSqlite(job);
  } catch (error) {
    console.warn(`[tileforge] sqlite mirror sync save failed for job ${job.id}:`, error);
  }
}

export function addLogImmediate(job: JobRecord, log: string) {
  appendLogSync(job, log);
  saveJobSnapshotSync(job);
}

export function updateProgressImmediate(job: JobRecord, stage: JobStage, progress: number, log?: string) {
  job.stage = stage;
  job.progress = progress;
  const at = nowIso();
  job.stageHistory = [...(job.stageHistory ?? []), { stage, status: progress >= 100 ? "done" : "running", at, detail: log }];
  markStageSqlite(job.id, stage, progress >= 100 ? "done" : "running", at, log);
  void appendJobEvent(job.id, { level: "info", stage, code: "STAGE_PROGRESS", message: log ?? `progress=${progress}`, data: { progress } });
  if (log) appendLogSync(job, log);
  saveJobSnapshotSync(job);
}

export async function addLog(job: JobRecord, log: string) { appendLogSync(job, log); await saveJob(job); }
export async function addWarning(job: JobRecord, warning: string) { job.warnings = [...(job.warnings ?? []), warning]; await addLog(job, `WARNING: ${warning}`); }

export async function requestCancel(id: string) {
  const job = await readJob(id);
  job.cancelRequested = true;
  if (job.status === "queued") { job.status = "cancelled"; job.stage = "cancelled"; job.progress = 100; job.finishedAt = nowIso(); }
  appendLogSync(job, "Cancellation requested");
  await saveJob(job);
  return job;
}

export async function updateProgress(job: JobRecord, stage: JobStage, progress: number, log?: string) {
  job.stage = stage; job.progress = progress;
  const at = nowIso();
  job.stageHistory = [...(job.stageHistory ?? []), { stage, status: progress >= 100 ? "done" : "running", at, detail: log }];
  markStageSqlite(job.id, stage, progress >= 100 ? "done" : "running", at, log);
  void appendJobEvent(job.id, { level: "info", stage, code: "STAGE_PROGRESS", message: log ?? `progress=${progress}`, data: { progress } });
  if (log) appendLogSync(job, log);
  await saveJob(job);
}

export async function markStageDone(job: JobRecord, stage: JobStage, detail?: string) {
  const at = nowIso();
  job.stageHistory = [...(job.stageHistory ?? []), { stage, status: "done", at, detail }];
  markStageSqlite(job.id, stage, "done", at, detail);
  await saveJob(job);
}

export async function acquireJobLock(job: JobRecord): Promise<boolean> {
  const lock = path.join(jobDir(job.id), "job.lock");
  try {
    await writeFile(lock, JSON.stringify({ pid: process.pid, acquiredAt: nowIso() }), { flag: "wx" });
    return true;
  } catch {
    try {
      const s = await stat(lock);
      const ageMs = Date.now() - s.mtimeMs;
      if (ageMs > Math.max(job.timeoutMs ?? DEFAULT_TIMEOUT_MS, 60_000)) {
        await rm(lock, { force: true });
        await writeFile(lock, JSON.stringify({ pid: process.pid, acquiredAt: nowIso(), recoveredStale: true }), { flag: "wx" });
        await addLog(job, "Recovered stale job lock");
        return true;
      }
    } catch {}
    return false;
  }
}
export async function releaseJobLock(job: JobRecord) { await rm(path.join(jobDir(job.id), "job.lock"), { force: true }); }


function isNoisyPythonNotFoundLine(line: string): boolean {
  const lower = line.toLowerCase();
  return lower.includes("python3") && (
    lower.includes("9009") ||
    lower.includes("not recognized") ||
    lower.includes("not found") ||
    lower.includes("command not found") ||
    lower.includes("python was not found")
  );
}

function sanitizeTextForDisplay(text: string): string {
  const lines = text.split(/\r?\n/);
  const kept = lines.filter(line => !isNoisyPythonNotFoundLine(line));
  const hidden = lines.length - kept.length;
  if (hidden > 0) kept.push(`(${hidden}개 Windows python3 명령 미탐색 오류는 작업 현황에서 숨겼습니다.)`);
  return kept.join("\n");
}

function sanitizeErrorForDisplay(error: string): string {
  try {
    const parsed = JSON.parse(error);
    const message = typeof parsed?.message === "string" ? sanitizeTextForDisplay(parsed.message) : undefined;
    const next = { ...parsed };
    if (message !== undefined) next.message = message;
    if (typeof parsed?.hint === "string") next.hint = sanitizeTextForDisplay(parsed.hint);
    return JSON.stringify(next, null, 2);
  } catch {
    return sanitizeTextForDisplay(error);
  }
}

function sanitizeJobForDisplay(job: JobRecord): JobRecord {
  return {
    ...job,
    logs: (job.logs ?? []).map(sanitizeTextForDisplay).filter(line => line.trim().length > 0),
    error: job.error ? sanitizeErrorForDisplay(job.error) : job.error
  };
}

export interface ListJobsOptions { limit?: number; cursor?: string; status?: JobStatus; since?: string; dashboard?: boolean; page?: number; }

function jobCounts(jobs: JobRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const job of jobs) counts[job.status] = (counts[job.status] ?? 0) + 1;
  return counts;
}

function updatedDesc(a: JobRecord, b: JobRecord): number {
  return (b.updatedAt || b.createdAt).localeCompare(a.updatedAt || a.createdAt);
}

function createdAsc(a: JobRecord, b: JobRecord): number {
  return a.createdAt.localeCompare(b.createdAt);
}

export function dashboardJobs(all: JobRecord[], limit: number): JobRecord[] {
  const running = all.filter((j) => j.status === "running").sort(updatedDesc);
  const queued = all.filter((j) => j.status === "queued").sort(createdAsc);
  const terminal = all.filter((j) => isTerminalStatus(j.status)).sort(updatedDesc);

  const picked = new Map<string, JobRecord>();
  const push = (job: JobRecord) => { if (!picked.has(job.id) && picked.size < limit) picked.set(job.id, job); };
  for (const job of running) push(job);
  const queuedBudget = Math.max(10, limit - picked.size - Math.min(20, terminal.length));
  for (const job of queued.slice(0, queuedBudget)) push(job);
  for (const job of terminal) push(job);
  for (const job of queued) push(job);
  return [...picked.values()];
}

export async function listJobsPaged(options: ListJobsOptions = {}): Promise<{ jobs: JobRecord[]; nextCursor?: string; total: number; counts: Record<string, number>; view?: string; page?: number; pageSize?: number; totalPages?: number }> {
  const limit = Math.max(1, Math.min(options.limit ?? 50, 1000));
  const page = Math.max(1, Math.floor(options.page ?? 1));
  if (options.dashboard && !options.cursor && !options.status && !options.since && sqlitePrimary()) {
    const dash = listDashboardJobsSqlite(limit);
    if (dash) return { jobs: dash.jobs.map(sanitizeJobForDisplay), total: dash.total, counts: dash.counts, view: "dashboard", page: 1, pageSize: limit, totalPages: Math.max(1, Math.ceil(dash.total / limit)) };
  }
  if (!options.dashboard && !options.cursor && !options.since && sqlitePrimary()) {
    const paged = listJobsPageSqlite(limit, page, options.status);
    if (paged) return { jobs: paged.jobs.map(sanitizeJobForDisplay), total: paged.total, counts: paged.counts, page, pageSize: limit, totalPages: Math.max(1, Math.ceil(paged.total / limit)) };
  }
  const all = (await listJobs()).filter(job => {
    if (options.status && job.status !== options.status) return false;
    if (options.since && job.createdAt < options.since) return false;
    return true;
  });
  const counts = jobCounts(all);
  if (options.dashboard && !options.cursor && !options.status) {
    return { jobs: dashboardJobs(all, limit).map(sanitizeJobForDisplay), total: all.length, counts, view: "dashboard", page: 1, pageSize: limit, totalPages: Math.max(1, Math.ceil(all.length / limit)) };
  }
  const start = options.cursor ? Math.max(0, all.findIndex(j => j.id === options.cursor) + 1) : (page - 1) * limit;
  const jobs = all.slice(start, start + limit).map(sanitizeJobForDisplay);
  const nextCursor = start + limit < all.length ? jobs.at(-1)?.id : undefined;
  return { jobs, nextCursor, total: all.length, counts, page, pageSize: limit, totalPages: Math.max(1, Math.ceil(all.length / limit)) };
}

export async function deleteJob(id: string): Promise<void> {
  await rm(jobDir(id), { recursive: true, force: true });
  deleteJobSqlite(id);
}

export async function enforceJobQuota(incoming = 1) {
  const { quotaConfig } = await import("@/lib/quotas");
  const quota = quotaConfig();
  const queuedFromDb = sqlitePrimary() ? countJobsSqlite("queued") : undefined;
  const queued = queuedFromDb ?? (await listJobs()).filter(j => j.status === "queued").length;
  if (queued + Math.max(1, incoming) - 1 >= quota.maxQueuedJobs) {
    throw new Error(`JOB_QUOTA_EXCEEDED: queued jobs ${queued} + incoming ${incoming} >= ${quota.maxQueuedJobs}`);
  }
}
