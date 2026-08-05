PRAGMA foreign_keys = ON;

UPDATE extracted_items
SET status = 'review',
    lifecycle_status = 'needs_review',
    last_verified_at = NULL,
    valid_until = NULL,
    expires_at = NULL,
    last_changed_at = datetime('now'),
    review_note = 'policy-v2移行: 位置不明・古い・高影響など新しい自動公開条件を満たさないため要再確認。'
WHERE status = 'published'
  AND auto_published = 1
  AND (
    information_class <> 'official'
    OR location_precision = 'unknown'
    OR published_at IS NULL
    OR datetime(published_at) < datetime('now', '-24 hours')
    OR datetime(published_at) > datetime('now', '+30 minutes')
    OR summary LIKE '%救助要請%'
    OR summary LIKE '%救助依頼%'
    OR summary LIKE '%行方不明%'
    OR summary LIKE '%閉じ込め%'
    OR summary LIKE '%生き埋め%'
    OR summary LIKE '%緊急安全確保%'
    OR summary LIKE '%避難指示%'
    OR summary LIKE '%高齢者等避難%'
    OR summary LIKE '%通行止め%'
    OR summary LIKE '%通行可否%'
    OR summary LIKE '%孤立%'
  );

INSERT INTO audit_events (extracted_item_id, event_type, actor, detail)
SELECT id, 'auto_publish_revoked', 'system-migration', 'policy-v2; moved_to_review'
FROM extracted_items
WHERE status = 'review'
  AND review_note = 'policy-v2移行: 位置不明・古い・高影響など新しい自動公開条件を満たさないため要再確認。';

INSERT INTO report_revisions
  (extracted_item_id, revision_type, changed_fields, previous_values, new_values, actor, public_note, detail, created_at)
SELECT id, 'status_change', '["status","lifecycle_status","valid_until"]',
  '{"status":"published","lifecycle_status":"active"}',
  '{"status":"review","lifecycle_status":"needs_review","valid_until":null}',
  'system-migration', '新しい公開条件に基づき、要再確認へ変更しました。',
  'policy-v2-existing-auto-publish-hardening', datetime('now')
FROM extracted_items
WHERE status = 'review'
  AND review_note = 'policy-v2移行: 位置不明・古い・高影響など新しい自動公開条件を満たさないため要再確認。';
