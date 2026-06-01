import { mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { JobRecord } from "@/types/job";
import { getWorkspaceRoot } from "./workspace";
import { runSqliteMigrations } from "./dbMigrations";
import type { ArtifactIntegrity } from "./artifactIntegrity";

let db: any | undefined;
let enabled = false;
let failedReason: string | undefined;

export function sqliteRequested() { return process.env.TILEFORGE_DISABLE_SQLITE !== "1" && process.env.TILEFORGE_DISABLE_SQLITE !== "true"; }
export function sqlitePrimary() { return sqliteRequested() && process.env.TILEFORGE_SQLITE_PRIMARY !== "0"; }
export function sqliteEnabled() { return !!getSqliteDb(); }

export function getSqliteDb() {
  if (!sqliteRequested()) return undefined;
  if (db) return db;
  try {
    const require = createRequire(import.meta.url);
    const Database = require("better-sqlite3");
    const root = getWorkspaceRoot();
    mkdirSync(root, { recursive: true });
    db = new Database(path.join(root, "tileforge.db"));
    db.pragma("journal_mode = WAL");
    runSqliteMigrations(db);
    enabled = true;
    return db;
  } catch (e:any) {
    failedReason = e?.message ?? String(e);
    return undefined;
  }
}

export function saveJobSqlite(job: JobRecord) {
  const d = getSqliteDb();
  if (!d) return;
  d.prepare(`INSERT INTO jobs(id,status,kind,stage,progress,created_at,updated_at,started_at,finished_at,json)
    VALUES(@id,@status,@kind,@stage,@progress,@createdAt,@updatedAt,@startedAt,@finishedAt,@json)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status, kind=excluded.kind, stage=excluded.stage, progress=excluded.progress, updated_at=excluded.updated_at, started_at=excluded.started_at, finished_at=excluded.finished_at, json=excluded.json`).run({
      id: job.id, status: job.status, kind: job.kind, stage: job.stage ?? null, progress: job.progress ?? 0,
      createdAt: job.createdAt, updatedAt: job.updatedAt, startedAt: job.startedAt ?? null, finishedAt: job.finishedAt ?? null, json: JSON.stringify(job)
    });
  const insertArtifact = d.prepare(`INSERT OR IGNORE INTO artifacts(job_id,name,created_at,path) VALUES(?,?,?,?)`);
  for (const a of job.artifacts ?? []) insertArtifact.run(job.id, a, job.updatedAt, a);
}

export function readJobSqlite(id: string): JobRecord | undefined {
  const d = getSqliteDb();
  if (!d) return undefined;
  try {
    const row = d.prepare(`SELECT json FROM jobs WHERE id=?`).get(id);
    return row ? JSON.parse(row.json) : undefined;
  } catch {
    return undefined;
  }
}

export function listJobsSqlite(): JobRecord[] | undefined {
  const d = getSqliteDb();
  if (!d) return undefined;
  try {
    const rows = d.prepare(`SELECT json FROM jobs ORDER BY created_at DESC`).all();
    return rows.map((r: any) => JSON.parse(r.json));
  } catch {
    return undefined;
  }
}

export function countJobsSqlite(status?: string): number | undefined {
  const d = getSqliteDb();
  if (!d) return undefined;
  try {
    if (!status) return Number(d.prepare(`SELECT COUNT(*) AS n FROM jobs`).get().n ?? 0);
    return Number(d.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status=?`).get(status).n ?? 0);
  } catch {
    return undefined;
  }
}

export function selectQueuedJobsSqlite(limit = 50, excludeIds: string[] = []): JobRecord[] | undefined {
  const d = getSqliteDb();
  if (!d) return undefined;
  try {
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), 500));
    let sql = `SELECT json FROM jobs WHERE status='queued'`;
    const params: string[] = [];
    if (excludeIds.length > 0) {
      const ids = excludeIds.slice(0, 250);
      sql += ` AND id NOT IN (${ids.map(() => '?').join(',')})`;
      params.push(...ids);
    }
    sql += ` ORDER BY created_at ASC LIMIT ${safeLimit}`;
    const rows = d.prepare(sql).all(...params);
    return rows.map((r: any) => JSON.parse(r.json));
  } catch {
    return undefined;
  }
}

export function countJobsByStatusSqlite(): Record<string, number> | undefined {
  const d = getSqliteDb();
  if (!d) return undefined;
  try {
    const rows = d.prepare(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`).all();
    const out: Record<string, number> = {};
    for (const r of rows) out[String(r.status)] = Number(r.n ?? 0);
    return out;
  } catch {
    return undefined;
  }
}

function jobSummaryFromRow(row: any): JobRecord {
  const artifacts: string[] = [];
  if (Number(row.has_report ?? 0) > 0) artifacts.push("report.md");
  return {
    id: String(row.id),
    kind: String(row.kind ?? "full-pipeline") as JobRecord["kind"],
    name: row.name ? String(row.name) : undefined,
    requestHash: row.request_hash ? String(row.request_hash) : undefined,
    status: String(row.status) as JobRecord["status"],
    stage: row.stage ? String(row.stage) as JobRecord["stage"] : undefined,
    progress: Number(row.progress ?? 0),
    createdAt: String(row.created_at ?? row.updated_at ?? ""),
    updatedAt: String(row.updated_at ?? row.created_at ?? ""),
    startedAt: row.started_at ? String(row.started_at) : undefined,
    finishedAt: row.finished_at ? String(row.finished_at) : undefined,
    request: {} as JobRecord["request"],
    logs: [],
    artifacts,
    warnings: [],
    // UI-only summary fields. They are intentionally not part of JobRecord's
    // persistent schema, but are useful for large queues without reading json.
    artifactCount: Number(row.artifact_count ?? artifacts.length),
    hasReport: Number(row.has_report ?? 0) > 0,
  } as JobRecord & { artifactCount: number; hasReport: boolean };
}

const ARTIFACT_SUMMARY_JOIN = `
  LEFT JOIN (
    SELECT job_id, COUNT(*) AS artifact_count, MAX(CASE WHEN name='report.md' THEN 1 ELSE 0 END) AS has_report
    FROM artifacts
    GROUP BY job_id
  ) a ON a.job_id = j.id
`;

const JOB_SUMMARY_COLUMNS = `
  j.id, j.status, j.kind, j.stage, j.progress, j.created_at, j.updated_at, j.started_at, j.finished_at,
  json_extract(j.json, '$.name') AS name,
  json_extract(j.json, '$.requestHash') AS request_hash,
  COALESCE(a.artifact_count, 0) AS artifact_count,
  COALESCE(a.has_report, 0) AS has_report
`;

function summaryRowsToJobs(rows: any[]): JobRecord[] {
  return rows.map(jobSummaryFromRow);
}

export function listDashboardJobsSqlite(limit = 80): { jobs: JobRecord[]; total: number; counts: Record<string, number> } | undefined {
  const d = getSqliteDb();
  if (!d) return undefined;
  try {
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), 500));
    const counts = countJobsByStatusSqlite() ?? {};
    const total = Number(d.prepare(`SELECT COUNT(*) AS n FROM jobs`).get().n ?? 0);
    const picked = new Map<string, JobRecord>();
    const addRows = (rows: any[]) => {
      for (const job of summaryRowsToJobs(rows)) {
        if (picked.size >= safeLimit) break;
        if (!picked.has(job.id)) picked.set(job.id, job);
      }
    };
    addRows(d.prepare(`SELECT ${JOB_SUMMARY_COLUMNS} FROM jobs j ${ARTIFACT_SUMMARY_JOIN} WHERE j.status='running' ORDER BY j.updated_at DESC LIMIT ?`).all(safeLimit));
    addRows(d.prepare(`SELECT ${JOB_SUMMARY_COLUMNS} FROM jobs j ${ARTIFACT_SUMMARY_JOIN} WHERE j.status='queued' ORDER BY j.created_at ASC LIMIT ?`).all(Math.max(10, safeLimit)));
    addRows(d.prepare(`SELECT ${JOB_SUMMARY_COLUMNS} FROM jobs j ${ARTIFACT_SUMMARY_JOIN} WHERE j.status IN ('succeeded','succeeded_with_warnings','failed','cancelled') ORDER BY j.updated_at DESC LIMIT ?`).all(safeLimit));
    return { jobs: [...picked.values()], total, counts };
  } catch {
    return undefined;
  }
}

export function listJobsPageSqlite(limit = 80, page = 1, status?: string): { jobs: JobRecord[]; total: number; counts: Record<string, number> } | undefined {
  const d = getSqliteDb();
  if (!d) return undefined;
  try {
    const safeLimit = Math.max(1, Math.min(Math.floor(limit), 1000));
    const safePage = Math.max(1, Math.floor(page));
    const counts = countJobsByStatusSqlite() ?? {};
    const params: any[] = [];
    let where = "";
    if (status) {
      where = " WHERE j.status=?";
      params.push(status);
    }
    const countWhere = status ? " WHERE status=?" : "";
    const total = Number(d.prepare(`SELECT COUNT(*) AS n FROM jobs${countWhere}`).get(...params).n ?? 0);
    const offset = (safePage - 1) * safeLimit;
    const rows = d.prepare(`SELECT ${JOB_SUMMARY_COLUMNS} FROM jobs j ${ARTIFACT_SUMMARY_JOIN}${where} ORDER BY j.created_at DESC LIMIT ? OFFSET ?`).all(...params, safeLimit, offset);
    return { jobs: summaryRowsToJobs(rows), total, counts };
  } catch {
    return undefined;
  }
}

export function mirrorJob(job: JobRecord) { saveJobSqlite(job); }

export function mirrorLog(jobId: string, message: string, createdAt: string) {
  const d = getSqliteDb();
  if (!d) return;
  d.prepare(`INSERT INTO job_logs(job_id,created_at,message) VALUES(?,?,?)`).run(jobId, createdAt, message);
}

export function markStageSqlite(jobId: string, stage: string, status: string, updatedAt: string, detail?: string) {
  const d = getSqliteDb();
  if (!d) return;
  d.prepare(`INSERT INTO job_stage_status(job_id,stage,status,updated_at,detail)
    VALUES(?,?,?,?,?) ON CONFLICT(job_id,stage) DO UPDATE SET status=excluded.status, updated_at=excluded.updated_at, detail=excluded.detail`).run(jobId, stage, status, updatedAt, detail ?? null);
}


export function recordArtifactSqlite(jobId: string, artifact: ArtifactIntegrity) {
  const d = getSqliteDb();
  if (!d) return;
  d.prepare(`INSERT OR REPLACE INTO artifacts(job_id,name,created_at,path,size_bytes,sha256,schema_version,verified_at)
    VALUES(?,?,?,?,?,?,?,?)`).run(jobId, artifact.name, artifact.verifiedAt ?? new Date().toISOString(), artifact.path, artifact.sizeBytes, artifact.sha256, artifact.schemaVersion ?? null, artifact.verifiedAt ?? null);
}

export function listArtifactIntegritySqlite(jobId: string): ArtifactIntegrity[] {
  const d = getSqliteDb();
  if (!d) return [];
  return d.prepare(`SELECT name,path,size_bytes as sizeBytes,sha256,schema_version as schemaVersion,verified_at as verifiedAt FROM artifacts WHERE job_id=? ORDER BY name`).all(jobId);
}

export function sqliteMigrationVersions(): number[] {
  const d = getSqliteDb();
  if (!d) return [];
  return d.prepare(`SELECT version FROM schema_migrations ORDER BY version`).all().map((r: any) => Number(r.version));
}

export function sqliteStatus() { return { requested: sqliteRequested(), primary: sqlitePrimary(), enabled, failedReason }; }

export function deleteJobSqlite(jobId: string) {
  const d = getSqliteDb();
  if (!d) return;
  const tables = ["job_logs", "job_stage_status", "artifacts", "jobs"];
  for (const table of tables) {
    try {
      const column = table === "jobs" ? "id" : "job_id";
      d.prepare(`DELETE FROM ${table} WHERE ${column}=?`).run(jobId);
    } catch {
      // Older SQLite schemas may not have every auxiliary table.
    }
  }
}
