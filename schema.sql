PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('official', 'news')),
  source_url TEXT NOT NULL,
  feed_url TEXT NOT NULL,
  access_method TEXT NOT NULL DEFAULT 'rss',
  enabled INTEGER NOT NULL DEFAULT 1,
  last_success_at TEXT,
  last_failure_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS raw_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source_id INTEGER NOT NULL REFERENCES sources(id),
  external_id TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT,
  item_url TEXT NOT NULL,
  published_at TEXT,
  retrieved_at TEXT NOT NULL,
  raw_hash TEXT NOT NULL,
  article_excerpt TEXT,
  article_content_hash TEXT,
  article_fetch_status TEXT NOT NULL DEFAULT 'pending',
  article_fetched_at TEXT,
  article_published_at TEXT,
  article_modified_at TEXT,
  canonical_url TEXT,
  article_extraction_method TEXT,
  article_http_status INTEGER,
  article_fetch_attempts INTEGER NOT NULL DEFAULT 0,
  article_error TEXT,
  UNIQUE(source_id, external_id)
);

CREATE TABLE IF NOT EXISTS extracted_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  raw_item_id INTEGER NOT NULL REFERENCES raw_items(id),
  category TEXT NOT NULL CHECK (category IN ('official', 'news')),
  report_type TEXT NOT NULL CHECK (report_type IN ('shelter', 'damage', 'road', 'warning', 'support', 'other')),
  area TEXT NOT NULL DEFAULT 'unknown',
  summary TEXT NOT NULL,
  published_at TEXT,
  status TEXT NOT NULL DEFAULT 'review' CHECK (status IN ('review', 'published', 'rejected', 'expired')),
  auto_published INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  extraction_method TEXT NOT NULL DEFAULT 'rss-rule-v1',
  confidence REAL NOT NULL DEFAULT 0,
  latitude REAL,
  longitude REAL,
  location_method TEXT,
  lifecycle_status TEXT NOT NULL DEFAULT 'needs_review' CHECK (lifecycle_status IN ('active', 'ongoing', 'resolved', 'expired', 'needs_review')),
  information_class TEXT NOT NULL DEFAULT 'reference' CHECK (information_class IN ('official', 'media', 'reference')),
  location_precision TEXT NOT NULL DEFAULT 'unknown' CHECK (location_precision IN ('exact', 'representative', 'estimated', 'unknown')),
  road_status TEXT NOT NULL DEFAULT 'unknown' CHECK (road_status IN ('recently_passed', 'restricted', 'closed', 'unknown')),
  road_observed_at TEXT,
  last_verified_at TEXT,
  valid_until TEXT,
  last_changed_at TEXT,
  reviewer TEXT,
  reviewed_at TEXT,
  review_note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS audit_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  extracted_item_id INTEGER,
  event_type TEXT NOT NULL,
  actor TEXT NOT NULL,
  detail TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

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

CREATE TABLE IF NOT EXISTS request_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  client_key TEXT NOT NULL,
  route TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_extracted_status ON extracted_items(status);
CREATE INDEX IF NOT EXISTS idx_extracted_lifecycle ON extracted_items(lifecycle_status, valid_until);
CREATE INDEX IF NOT EXISTS idx_extracted_information_class ON extracted_items(information_class);
CREATE INDEX IF NOT EXISTS idx_extracted_road_status ON extracted_items(road_status, road_observed_at);
CREATE INDEX IF NOT EXISTS idx_report_revisions_item_time ON report_revisions(extracted_item_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_raw_source ON raw_items(source_id);
CREATE INDEX IF NOT EXISTS idx_raw_article_fetch_status ON raw_items(article_fetch_status, article_fetch_attempts);
CREATE INDEX IF NOT EXISTS idx_request_events_client_time ON request_events(client_key, created_at);
