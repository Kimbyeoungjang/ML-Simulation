export type Migration = { version: number; name: string; sql: string };

export const SQLITE_MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: "init",
    sql: `
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL,
  kind TEXT NOT NULL,
  stage TEXT,
  progress REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS job_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  message TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  job_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  path TEXT,
  size_bytes INTEGER,
  sha256 TEXT,
  schema_version TEXT,
  verified_at TEXT,
  PRIMARY KEY(job_id, name)
);
CREATE TABLE IF NOT EXISTS job_stage_status (
  job_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  detail TEXT,
  PRIMARY KEY(job_id, stage)
);
CREATE TABLE IF NOT EXISTS cache_entries (
  cache_key TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  accessed_at TEXT,
  path TEXT NOT NULL,
  size_bytes INTEGER DEFAULT 0,
  hit_count INTEGER DEFAULT 0
);
`
  },
  {
    version: 2,
    name: "stage-attempts-and-integrity",
    sql: `
CREATE TABLE IF NOT EXISTS stage_attempts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  error_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_stage_attempts_job ON stage_attempts(job_id, stage, attempt);
CREATE TABLE IF NOT EXISTS validation_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  dataset TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  passed INTEGER NOT NULL
);
`
  }
];

export function runSqliteMigrations(db: any) {
  db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);`);
  const applied = new Set<number>(db.prepare(`SELECT version FROM schema_migrations`).all().map((r: any) => Number(r.version)));
  const tx = db.transaction(() => {
    for (const m of SQLITE_MIGRATIONS) {
      if (applied.has(m.version)) continue;
      db.exec(m.sql);
      db.prepare(`INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,datetime('now'))`).run(m.version, m.name);
    }
  });
  tx();
}
