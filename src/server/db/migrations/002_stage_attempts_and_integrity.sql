-- TileForge v0.10 migration 002: resumability, cache metadata, and validation runs.
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
CREATE TABLE IF NOT EXISTS validation_runs (
  id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  dataset TEXT NOT NULL,
  metrics_json TEXT NOT NULL,
  passed INTEGER NOT NULL
);
