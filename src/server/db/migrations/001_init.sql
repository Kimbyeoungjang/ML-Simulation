-- TileForge v0.10 migration 001: initial metadata store.
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
