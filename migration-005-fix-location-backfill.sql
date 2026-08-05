UPDATE audit_events
SET event_type = 'location_backfill_skipped', detail = 'coarse-rule-v1; no named area matched; no pin assigned'
WHERE event_type = 'location_backfill'
  AND extracted_item_id IN (
    SELECT id FROM extracted_items
    WHERE location_method = 'coarse-rule-v1' AND (latitude IS NULL OR longitude IS NULL)
  );

UPDATE extracted_items
SET location_method = NULL
WHERE location_method = 'coarse-rule-v1'
  AND (latitude IS NULL OR longitude IS NULL);
