ALTER TABLE plateau_sync_runs ADD COLUMN total_batches INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plateau_sync_runs ADD COLUMN completed_batches INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS plateau_sync_batches (
  message_id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL,
  batch_number INTEGER NOT NULL,
  item_count INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed')),
  error_code TEXT,
  processed_at TEXT NOT NULL,
  UNIQUE(run_id, batch_number)
);

CREATE INDEX IF NOT EXISTS idx_plateau_sync_batches_run_status
  ON plateau_sync_batches(run_id, status);
