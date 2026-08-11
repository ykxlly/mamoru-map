ALTER TABLE plateau_sync_runs ADD COLUMN next_offset INTEGER NOT NULL DEFAULT 0;
ALTER TABLE plateau_sync_runs ADD COLUMN payload_total INTEGER NOT NULL DEFAULT 0;
