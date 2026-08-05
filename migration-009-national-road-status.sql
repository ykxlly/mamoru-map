PRAGMA foreign_keys = ON;

ALTER TABLE extracted_items ADD COLUMN road_status TEXT NOT NULL DEFAULT 'unknown'
  CHECK (road_status IN ('recently_passed', 'restricted', 'closed', 'unknown'));
ALTER TABLE extracted_items ADD COLUMN road_observed_at TEXT;

UPDATE extracted_items
SET road_status = CASE
  WHEN report_type <> 'road' THEN 'unknown'
  WHEN summary LIKE '%通行止%' OR summary LIKE '%進入禁止%' OR summary LIKE '%入口閉鎖%' THEN 'closed'
  WHEN summary LIKE '%通行実績%' OR summary LIKE '%通れた道%' THEN 'recently_passed'
  ELSE 'restricted'
END,
road_observed_at = CASE WHEN report_type = 'road' THEN COALESCE(published_at, reviewed_at, created_at) ELSE NULL END;

INSERT INTO report_revisions
  (extracted_item_id, revision_type, changed_fields, actor, public_note, detail, created_at)
SELECT id, 'migration', '["road_status","road_observed_at"]', 'system-migration',
  '全国道路状態表示を追加しました。', 'migration-009-national-road-status', datetime('now')
FROM extracted_items
WHERE report_type = 'road';

CREATE INDEX IF NOT EXISTS idx_extracted_road_status ON extracted_items(road_status, road_observed_at);
