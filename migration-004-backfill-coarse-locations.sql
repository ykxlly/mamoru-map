UPDATE extracted_items
SET latitude = CASE
  WHEN EXISTS (SELECT 1 FROM raw_items r WHERE r.id = raw_item_id AND (r.title || ' ' || COALESCE(r.summary, '')) LIKE '%熊本市%') THEN 32.8031
  WHEN EXISTS (SELECT 1 FROM raw_items r WHERE r.id = raw_item_id AND (r.title || ' ' || COALESCE(r.summary, '')) LIKE '%益城町%') THEN 32.7909
  WHEN EXISTS (SELECT 1 FROM raw_items r WHERE r.id = raw_item_id AND (r.title || ' ' || COALESCE(r.summary, '')) LIKE '%西原村%') THEN 32.8338
  WHEN EXISTS (SELECT 1 FROM raw_items r WHERE r.id = raw_item_id AND (r.title || ' ' || COALESCE(r.summary, '')) LIKE '%南阿蘇村%') THEN 32.8211
  WHEN EXISTS (SELECT 1 FROM raw_items r WHERE r.id = raw_item_id AND (r.title || ' ' || COALESCE(r.summary, '')) LIKE '%大津町%') THEN 32.8775
  WHEN EXISTS (SELECT 1 FROM raw_items r WHERE r.id = raw_item_id AND (r.title || ' ' || COALESCE(r.summary, '')) LIKE '%菊陽町%') THEN 32.8616
  WHEN EXISTS (SELECT 1 FROM raw_items r WHERE r.id = raw_item_id AND (r.title || ' ' || COALESCE(r.summary, '')) LIKE '%宇城市%') THEN 32.6462
  WHEN EXISTS (SELECT 1 FROM raw_items r WHERE r.id = raw_item_id AND (r.title || ' ' || COALESCE(r.summary, '')) LIKE '%熊本県%') THEN 32.7898
END,
longitude = CASE
  WHEN EXISTS (SELECT 1 FROM raw_items r WHERE r.id = raw_item_id AND (r.title || ' ' || COALESCE(r.summary, '')) LIKE '%熊本市%') THEN 130.7079
  WHEN EXISTS (SELECT 1 FROM raw_items r WHERE r.id = raw_item_id AND (r.title || ' ' || COALESCE(r.summary, '')) LIKE '%益城町%') THEN 130.8175
  WHEN EXISTS (SELECT 1 FROM raw_items r WHERE r.id = raw_item_id AND (r.title || ' ' || COALESCE(r.summary, '')) LIKE '%西原村%') THEN 130.9022
  WHEN EXISTS (SELECT 1 FROM raw_items r WHERE r.id = raw_item_id AND (r.title || ' ' || COALESCE(r.summary, '')) LIKE '%南阿蘇村%') THEN 131.0684
  WHEN EXISTS (SELECT 1 FROM raw_items r WHERE r.id = raw_item_id AND (r.title || ' ' || COALESCE(r.summary, '')) LIKE '%大津町%') THEN 130.8662
  WHEN EXISTS (SELECT 1 FROM raw_items r WHERE r.id = raw_item_id AND (r.title || ' ' || COALESCE(r.summary, '')) LIKE '%菊陽町%') THEN 130.8285
  WHEN EXISTS (SELECT 1 FROM raw_items r WHERE r.id = raw_item_id AND (r.title || ' ' || COALESCE(r.summary, '')) LIKE '%宇城市%') THEN 130.6847
  WHEN EXISTS (SELECT 1 FROM raw_items r WHERE r.id = raw_item_id AND (r.title || ' ' || COALESCE(r.summary, '')) LIKE '%熊本県%') THEN 130.7417
END,
location_method = 'coarse-rule-v1'
WHERE status IN ('published', 'review')
  AND latitude IS NULL
  AND longitude IS NULL
  AND EXISTS (
    SELECT 1 FROM raw_items r WHERE r.id = raw_item_id
      AND (r.title || ' ' || COALESCE(r.summary, '')) LIKE '%熊本%'
  );

INSERT INTO audit_events (extracted_item_id, event_type, actor, detail)
SELECT e.id, 'location_backfill', 'system', 'coarse-rule-v1; source text matched a named Kumamoto area'
FROM extracted_items e
WHERE e.location_method = 'coarse-rule-v1'
  AND NOT EXISTS (
    SELECT 1 FROM audit_events a
    WHERE a.extracted_item_id = e.id AND a.event_type = 'location_backfill'
  );
