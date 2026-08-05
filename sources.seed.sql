-- Confirmed official feeds checked on 2026-08-03.
-- Run after schema.sql. Re-running this file does not duplicate existing feeds.

INSERT INTO sources (name, category, source_url, feed_url, access_method)
SELECT '熊本市 防災サイト RSS', 'official',
  'https://www.city.kumamoto.jp/bousai/default.html',
  'https://www.city.kumamoto.jp/bousai/new_list.xml', 'rss'
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE feed_url = 'https://www.city.kumamoto.jp/bousai/new_list.xml');

INSERT INTO sources (name, category, source_url, feed_url, access_method)
SELECT '熊本市 公式サイト新着情報 RSS', 'official',
  'https://www.city.kumamoto.jp/kiji00361867/index.html',
  'https://www.city.kumamoto.jp/new_list.xml', 'rss'
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE feed_url = 'https://www.city.kumamoto.jp/new_list.xml');

INSERT INTO sources (name, category, source_url, feed_url, access_method)
SELECT '気象庁 防災情報XML 地震・火山', 'official',
  'https://www.data.jma.go.jp/developer/',
  'https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml', 'atom'
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE feed_url = 'https://www.data.jma.go.jp/developer/xml/feed/eqvol.xml');

INSERT INTO sources (name, category, source_url, feed_url, access_method)
SELECT '気象庁 防災情報XML 随時', 'official',
  'https://www.data.jma.go.jp/developer/',
  'https://www.data.jma.go.jp/developer/xml/feed/extra.xml', 'atom'
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE feed_url = 'https://www.data.jma.go.jp/developer/xml/feed/extra.xml');

INSERT INTO sources (name, category, source_url, feed_url, access_method)
SELECT '気象庁 防災情報XML 定時', 'official',
  'https://www.data.jma.go.jp/developer/',
  'https://www.data.jma.go.jp/developer/xml/feed/regular.xml', 'atom'
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE feed_url = 'https://www.data.jma.go.jp/developer/xml/feed/regular.xml');

-- Discovery-only aggregate feed. Metadata and original source links only; no SNS body/media.
-- Category is news so this source can never pass the official-source auto-publish policy.
INSERT INTO sources (name, category, source_url, feed_url, access_method)
SELECT 'Solafune 災害情報GeoJSON（発見用・要レビュー）', 'news',
  'https://alert.solafune.com/',
  'https://alert.solafune.com/data/events.geojson', 'geojson'
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE feed_url = 'https://alert.solafune.com/data/events.geojson');

-- Official public HTML. Road layer tiles are not copied; only page notice, disaster-area label,
-- coordinates, timestamp, and the official page URL are extracted as review-required metadata.
INSERT INTO sources (name, category, source_url, feed_url, access_method, enabled)
SELECT 'トヨタ 通れた道マップ（公開HTML・要レビュー）', 'news',
  'https://www.toyota.co.jp/jpn/auto/passable_route/map/',
  'https://www.toyota.co.jp/jpn/auto/passable_route/map/', 'html', 0
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE feed_url = 'https://www.toyota.co.jp/jpn/auto/passable_route/map/');

-- Structured traffic restrictions used by the official map. Only non-personal regulation fields
-- in the Kumamoto disaster area are retained; support-vehicle and photo media are not copied.
INSERT INTO sources (name, category, source_url, feed_url, access_method)
SELECT 'トヨタ 通れた道マップ 交通規制JSON（要レビュー）', 'news',
  'https://www.toyota.co.jp/jpn/auto/passable_route/map/',
  'https://www.toyota.co.jp/jpn/auto/passable_route/map/Home/GetVicsReg', 'toyota_vics'
WHERE NOT EXISTS (SELECT 1 FROM sources WHERE feed_url = 'https://www.toyota.co.jp/jpn/auto/passable_route/map/Home/GetVicsReg');
