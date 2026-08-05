PRAGMA foreign_keys = ON;

CREATE TABLE sources (
  id INTEGER PRIMARY KEY,
  category TEXT NOT NULL,
  access_method TEXT NOT NULL
);

CREATE TABLE raw_items (
  id INTEGER PRIMARY KEY,
  source_id INTEGER NOT NULL REFERENCES sources(id)
);

CREATE TABLE extracted_items (
  id INTEGER PRIMARY KEY,
  raw_item_id INTEGER NOT NULL REFERENCES raw_items(id),
  category TEXT NOT NULL,
  report_type TEXT NOT NULL,
  area TEXT NOT NULL DEFAULT 'unknown',
  summary TEXT NOT NULL,
  published_at TEXT,
  status TEXT NOT NULL DEFAULT 'review',
  auto_published INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  extraction_method TEXT NOT NULL DEFAULT 'rss-rule-v1',
  confidence REAL NOT NULL DEFAULT 0,
  latitude REAL,
  longitude REAL,
  location_method TEXT,
  reviewer TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  extracted_item_id INTEGER,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

INSERT INTO sources (id, category, access_method) VALUES
  (1, 'official', 'rss'),
  (2, 'news', 'geojson');
INSERT INTO raw_items (id, source_id) VALUES (1, 1), (2, 2), (3, 1), (4, 1);
INSERT INTO extracted_items
  (id, raw_item_id, category, report_type, summary, published_at, status, auto_published, expires_at,
   latitude, longitude, location_method, reviewer, reviewed_at, created_at)
VALUES
  (1, 1, 'official', 'warning', '公式警報', '2026-08-04T00:00:00Z', 'published', 0, NULL,
   32.8031, 130.7079, 'human-reviewed-point', 'admin', '2026-08-04T00:10:00Z', '2026-08-04T00:00:00Z'),
  (2, 2, 'news', 'road', '参考道路情報', '2016-04-16T00:00:00Z', 'review', 0, NULL,
   32.8, 130.7, 'aggregator-geojson', NULL, NULL, '2016-04-16T00:00:00Z'),
  (3, 3, 'official', 'support', '期限切れ支援', '2016-04-16T00:00:00Z', 'published', 1, '2016-04-19T00:00:00Z',
   32.8, 130.7, 'coarse-rule-v1', 'system-auto', '2016-04-16T00:00:00Z', '2016-04-16T00:00:00Z'),
  (4, 4, 'official', 'warning', '位置不明の自動公開情報', datetime('now'), 'published', 1, datetime('now', '+72 hours'),
   NULL, NULL, NULL, 'system-auto', datetime('now'), datetime('now'));
