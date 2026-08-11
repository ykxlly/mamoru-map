CREATE TABLE IF NOT EXISTS plateau_datasets (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  external_dataset_id TEXT NOT NULL UNIQUE,
  municipality_code TEXT NOT NULL,
  prefecture_code TEXT,
  prefecture_name TEXT,
  city_name TEXT,
  dataset_year TEXT,
  specification_version TEXT,
  feature_types_json TEXT NOT NULL DEFAULT '[]',
  source_url TEXT,
  distribution_url TEXT,
  license_name TEXT,
  attribution_text TEXT,
  is_latest INTEGER NOT NULL DEFAULT 0,
  is_available INTEGER NOT NULL DEFAULT 1,
  fetched_at TEXT NOT NULL,
  last_checked_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_plateau_datasets_municipality_code ON plateau_datasets(municipality_code);
CREATE INDEX IF NOT EXISTS idx_plateau_datasets_prefecture_code ON plateau_datasets(prefecture_code);
CREATE INDEX IF NOT EXISTS idx_plateau_datasets_is_latest ON plateau_datasets(is_latest);
