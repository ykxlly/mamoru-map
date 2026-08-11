CREATE TABLE IF NOT EXISTS plateau_sync_runs (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'succeeded', 'partial_failed', 'failed')),
  lock_key TEXT NOT NULL DEFAULT 'plateau',
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  lock_expires_at TEXT,
  fetched INTEGER NOT NULL DEFAULT 0,
  inserted INTEGER NOT NULL DEFAULT 0,
  updated INTEGER NOT NULL DEFAULT 0,
  skipped INTEGER NOT NULL DEFAULT 0,
  error_count INTEGER NOT NULL DEFAULT 0,
  error_code TEXT,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_plateau_sync_runs_active ON plateau_sync_runs(lock_key) WHERE status IN ('queued', 'running');
CREATE INDEX IF NOT EXISTS idx_plateau_sync_runs_status_created ON plateau_sync_runs(status, created_at);
