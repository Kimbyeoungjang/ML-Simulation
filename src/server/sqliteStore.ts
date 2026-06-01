import { mkdirSync } from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import type { JobListItem, JobRecord } from "@/types/job";
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
  d.prepare(`INSERT INTO jobs(id,status,kind,name,request_hash,stage,progress,created_at,updated_at,started_at,finished_at,json)
    VALUES(@id,@status,@kind,@name,@requestHash,@stage,@progress,@createdAt,@updatedAt,@startedAt,@finishedAt,@json)
    ON CONFLICT(id) DO UPDATE SET status=excluded.status, kind=excluded.kind, name=excluded.name, request_hash=excluded.request_hash, stage=excluded.stage, progress=excluded.progress, updated_at=excluded.updated_at, started_at=excluded.started_at, finished_at=excluded.finished_at, json=excluded.json`).run({
      id: job.id, status: job.status, kind: job.kind, stage: job.stage ?? null, progress: job.progress ?? 0,
      name: job.name ?? null, requestHash: job.requestHash ?? null,
      createdAt: job.createdAt, updatedAt: job.updatedAt, startedAt: job.startedAt ?? null, finishedAt: job.finishedAt ?? null, json: JSON.stringify(job)
    });
  const insertArtifact = d.prepare(`INSERT OR IGNORE INTO artifacts(job_id,name,created_at,path) VALUES(?,?,?,?)`);
  for (const a of job.artifacts ?? []) insertArtifact.run(job.id, a, job.updatedAt, a);
}

export function readJobSqlite(id: string): JobRecord | undefined {
  const d = getSqliteDb();
  if (!d) return undefined;
  const row = d.prepare(`SELECT json FROM jobs WHERE id=?`).get(id);
  return row ? JSON.parse(row.json) : undefined;
}

export function listJobsSqlite(): JobRecord[] | undefined {
  const d = getSqliteDb();
  if (!d) return undefined;
  const rows = d.prepare(`SELECT json FROM jobs ORDER BY created_at DESC`).all();
  return rows.map((r: any) => JSON.parse(r.json));
}

export function countJobsSqlite(status?: string): number | undefined {
  const d = getSqliteDb();
  if (!d) return undefined;
  if (!status) return Number(d.prepare(`SELECT COUNT(*) AS n FROM jobs`).get().n ?? 0);
  return Number(d.prepare(`SELECT COUNT(*) AS n FROM jobs WHERE status=?`).get(status).n ?? 0);
}

export function selectQueuedJobsSqlite(limit = 50, excludeIds: string[] = []): JobRecord[] | undefined {
  const d = getSqliteDb();
  if (!d) return undefined;
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
}

export function countJobsByStatusSqlite(): Record<string, number> | undefined {
  const d = getSqliteDb();
  if (!d) return undefined;
  const rows = d.prepare(`SELECT status, COUNT(*) AS n FROM jobs GROUP BY status`).all();
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.status)] = Number(r.n ?? 0);
  return out;
}

function parseArtifactPreview(value: unknown): string[] {
  if (!value) return [];
  return String(value).split("\n").map((x) => x.trim()).filter(Boolean);
}

function mapJobListRow(row: any): JobListItem {
  const artifactCount = Number(row.artifactCount ?? row.artifact_count ?? 0);
  const artifacts = parseArtifactPreview(row.artifactPreview ?? row.artifact_preview);
  return {
    id: String(row.id),
    kind: row.kind,
    name: row.name ?? undefined,
    requestHash: row.requestHash ?? row.request_hash ?? undefined,
    status: row.status,
    stage: row.stage ?? undefined,
    progress: Number(row.progress ?? 0),
    createdAt: row.createdAt ?? row.created_at,
    updatedAt: row.updatedAt ?? row.updated_at,
    startedAt: row.startedAt ?? row.started_at ?? undefined,
    finishedAt: row.finishedAt ?? row.finished_at ?? undefined,
    artifactCount,
    hasArtifacts: artifactCount > 0,
    hasReport: Boolean(row.hasReport ?? row.has_report),
    artifacts,
  };
}

const JOB_LIST_COLUMNS = `
  j.id,
  j.status,
  j.kind,
  COALESCE(j.name, json_extract(j.json, '$.name'), j.id) AS name,
  COALESCE(j.request_hash, json_extract(j.json, '$.requestHash')) AS requestHash,
  j.stage,
  j.progress,
  j.created_at AS createdAt,
  j.updated_at AS updatedAt,
  j.started_at AS startedAt,
  j.finished_at AS finishedAt,
  COALESCE((SELECT COUNT(*) FROM artifacts a WHERE a.job_id = j.id), 0) AS artifactCount,
  EXISTS(SELECT 1 FROM artifacts a WHERE a.job_id = j.id AND a.name = 'report.md') AS hasReport,
  (SELECT GROUP_CONCAT(name, char(10)) FROM (SELECT a.name AS name FROM artifacts a WHERE a.job_id = j.id ORDER BY a.name LIMIT 30)) AS artifactPreview
`;

export function listDashboardJobsSqlite(limit = 80): { jobs: JobListItem[]; total: number; counts: Record<string, number> } | undefined {
  const d = getSqliteDb();
  if (!d) return undefined;
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 500));
  const counts = countJobsByStatusSqlite() ?? {};
  const total = Number(d.prepare(`SELECT COUNT(*) AS n FROM jobs`).get().n ?? 0);
  const picked = new Map<string, JobListItem>();
  const addRows = (rows: any[]) => {
    for (const r of rows) {
      if (picked.size >= safeLimit) break;
      const job = mapJobListRow(r);
      if (!picked.has(job.id)) picked.set(job.id, job);
    }
  };
  addRows(d.prepare(`SELECT ${JOB_LIST_COLUMNS} FROM jobs j WHERE j.status='running' ORDER BY j.updated_at DESC LIMIT ?`).all(safeLimit));
  addRows(d.prepare(`SELECT ${JOB_LIST_COLUMNS} FROM jobs j WHERE j.status='queued' ORDER BY j.created_at ASC LIMIT ?`).all(Math.max(10, safeLimit)));
  addRows(d.prepare(`SELECT ${JOB_LIST_COLUMNS} FROM jobs j WHERE j.status IN ('succeeded','succeeded_with_warnings','failed','cancelled') ORDER BY j.updated_at DESC LIMIT ?`).all(safeLimit));
  return { jobs: [...picked.values()], total, counts };
}

export function listJobsPageSqlite(limit = 80, page = 1, status?: string): { jobs: JobListItem[]; total: number; counts: Record<string, number> } | undefined {
  const d = getSqliteDb();
  if (!d) return undefined;
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), 500));
  const safePage = Math.max(1, Math.floor(page));
  const counts = countJobsByStatusSqlite() ?? {};
  const params: any[] = [];
  let where = "";
  if (status) {
    where = " WHERE status=?";
    params.push(status);
  }
  const total = Number(d.prepare(`SELECT COUNT(*) AS n FROM jobs${where}`).get(...params).n ?? 0);
  const offset = (safePage - 1) * safeLimit;
  const rows = d.prepare(`SELECT ${JOB_LIST_COLUMNS} FROM jobs j${where.replace("status", "j.status")} ORDER BY j.created_at DESC LIMIT ? OFFSET ?`).all(...params, safeLimit, offset);
  return { jobs: rows.map(mapJobListRow), total, counts };
}

export function listJobArtifactsSqlite(jobId: string): Array<{ name: string; path?: string; size?: number; url?: string }> | undefined {
  const d = getSqliteDb();
  if (!d) return undefined;
  const rows = d.prepare(`SELECT name, path, size_bytes AS size FROM artifacts WHERE job_id=? ORDER BY name`).all(jobId);
  return rows.map((r: any) => ({ name: String(r.name), path: r.path ?? String(r.name), size: r.size == null ? undefined : Number(r.size) }));
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
