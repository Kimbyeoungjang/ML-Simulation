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
  const row = d.prepare(`SELECT json FROM jobs WHERE id=?`).get(id);
  return row ? JSON.parse(row.json) : undefined;
}

export function listJobsSqlite(): JobRecord[] | undefined {
  const d = getSqliteDb();
  if (!d) return undefined;
  const rows = d.prepare(`SELECT json FROM jobs ORDER BY created_at DESC`).all();
  return rows.map((r: any) => JSON.parse(r.json));
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
