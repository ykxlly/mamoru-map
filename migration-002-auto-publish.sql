ALTER TABLE extracted_items ADD COLUMN auto_published INTEGER NOT NULL DEFAULT 0;
ALTER TABLE extracted_items ADD COLUMN expires_at TEXT;
