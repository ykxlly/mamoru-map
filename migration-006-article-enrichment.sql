ALTER TABLE raw_items ADD COLUMN article_excerpt TEXT;
ALTER TABLE raw_items ADD COLUMN article_content_hash TEXT;
ALTER TABLE raw_items ADD COLUMN article_fetch_status TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE raw_items ADD COLUMN article_fetched_at TEXT;
ALTER TABLE raw_items ADD COLUMN article_published_at TEXT;
ALTER TABLE raw_items ADD COLUMN article_modified_at TEXT;
ALTER TABLE raw_items ADD COLUMN canonical_url TEXT;
ALTER TABLE raw_items ADD COLUMN article_extraction_method TEXT;
ALTER TABLE raw_items ADD COLUMN article_http_status INTEGER;
ALTER TABLE raw_items ADD COLUMN article_fetch_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE raw_items ADD COLUMN article_error TEXT;

CREATE INDEX IF NOT EXISTS idx_raw_article_fetch_status ON raw_items(article_fetch_status, article_fetch_attempts);
