PRAGMA foreign_keys = ON;

ALTER TABLE extracted_items ADD COLUMN lifecycle_status TEXT NOT NULL DEFAULT 'needs_review'
  CHECK (lifecycle_status IN ('active', 'ongoing', 'resolved', 'expired', 'needs_review'));
ALTER TABLE extracted_items ADD COLUMN information_class TEXT NOT NULL DEFAULT 'reference'
  CHECK (information_class IN ('official', 'media', 'reference'));
ALTER TABLE extracted_items ADD COLUMN location_precision TEXT NOT NULL DEFAULT 'unknown'
  CHECK (location_precision IN ('exact', 'representative', 'estimated', 'unknown'));
ALTER TABLE extracted_items ADD COLUMN last_verified_at TEXT;
ALTER TABLE extracted_items ADD COLUMN valid_until TEXT;
ALTER TABLE extracted_items ADD COLUMN last_changed_at TEXT;

CREATE TABLE IF NOT EXISTS report_revisions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  extracted_item_id INTEGER NOT NULL REFERENCES extracted_items(id),
  revision_type TEXT NOT NULL CHECK (revision_type IN ('created', 'published', 'status_change', 'correction', 'expiry', 'migration')),
  changed_fields TEXT NOT NULL DEFAULT '[]',
  previous_values TEXT,
  new_values TEXT,
  actor TEXT NOT NULL,
  public_note TEXT,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

UPDATE extracted_items
SET information_class = CASE WHEN category = 'official' THEN 'official' ELSE 'media' END;

UPDATE extracted_items
SET information_class = 'reference'
WHERE raw_item_id IN (
  SELECT r.id FROM raw_items r
  JOIN sources s ON s.id = r.source_id
  WHERE s.access_method IN ('geojson', 'toyota_vics')
);

UPDATE extracted_items
SET location_precision = CASE
  WHEN latitude IS NULL OR longitude IS NULL THEN 'unknown'
  WHEN location_method = 'coarse-rule-v1' THEN 'representative'
  WHEN reviewer IS NOT NULL AND reviewer <> 'system-auto' THEN 'exact'
  ELSE 'estimated'
END;

UPDATE extracted_items
SET valid_until = COALESCE(
  expires_at,
  CASE report_type
    WHEN 'warning' THEN datetime(COALESCE(reviewed_at, published_at, created_at), '+12 hours')
    WHEN 'road' THEN datetime(COALESCE(reviewed_at, published_at, created_at), '+24 hours')
    WHEN 'shelter' THEN datetime(COALESCE(reviewed_at, published_at, created_at), '+24 hours')
    WHEN 'support' THEN datetime(COALESCE(reviewed_at, published_at, created_at), '+72 hours')
    WHEN 'damage' THEN datetime(COALESCE(reviewed_at, published_at, created_at), '+7 days')
    ELSE datetime(COALESCE(reviewed_at, published_at, created_at), '+24 hours')
  END
),
last_verified_at = CASE WHEN status = 'published' AND auto_published = 0 THEN reviewed_at ELSE NULL END,
last_changed_at = COALESCE(reviewed_at, created_at);

UPDATE extracted_items
SET lifecycle_status = CASE
  WHEN status = 'review' THEN 'needs_review'
  WHEN status = 'expired' OR (valid_until IS NOT NULL AND datetime(valid_until) <= datetime('now')) THEN 'expired'
  WHEN status = 'rejected' THEN 'resolved'
  ELSE 'active'
END;

UPDATE extracted_items
SET status = 'expired'
WHERE status = 'published' AND lifecycle_status = 'expired';

INSERT INTO report_revisions (
  extracted_item_id, revision_type, changed_fields, actor, public_note, detail, created_at
)
SELECT id, 'migration',
  '["lifecycle_status","information_class","location_precision","valid_until"]',
  'system-migration', '既存情報に信頼性表示を追加しました。', 'migration-007', datetime('now')
FROM extracted_items;

CREATE INDEX IF NOT EXISTS idx_extracted_lifecycle ON extracted_items(lifecycle_status, valid_until);
CREATE INDEX IF NOT EXISTS idx_extracted_information_class ON extracted_items(information_class);
CREATE INDEX IF NOT EXISTS idx_report_revisions_item_time ON report_revisions(extracted_item_id, created_at DESC);
