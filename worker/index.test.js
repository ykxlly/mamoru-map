import test from 'node:test';
import assert from 'node:assert/strict';
import handler, { parseFeed, parseGeoJsonFeed, parseHtmlMedia, parseSourcePayload, parseToyotaVics, normalizeOpenMeteo, normalizePlateauPayload, createPlateauQueueMessages, extractItem, extractArticleDocument, articleTitleMatches, articleUrlAllowed, reportsToGeoJson, reportsToCsv, reportPriority, sanitizeArchiveReport, allowedHost, sameHost, shouldAutoPublish, validDiscoverySourceUrl, deriveInformationClass, deriveLocationPrecision, defaultValidUntil, normalizeLifecycleStatus } from './index.js';

function plateauDb() {
  const rows = new Map();
  const runs = [];
  return { rows, runs, prepare(sql) {
    return { bind(...args) {
      return {
        async first() {
          if (sql.includes('plateau_sync_runs') && sql.includes('status IN')) return runs.find((r) => ['queued', 'running'].includes(r.status)) || null;
          if (sql.includes("SELECT id FROM plateau_sync_runs WHERE status = 'queued'")) return runs.find((r) => r.status === 'queued') || null;
          if (sql.includes('SELECT * FROM plateau_sync_runs')) return runs.at(-1) || null;
          return { count: 0 };
        },
        async all() {
          if (sql.includes('GROUP BY municipality_code')) return { results: [...rows.values()].map((r) => ({ municipality_code: r[1], prefecture_code: r[2], prefecture_name: r[3], city_name: r[4], is_available: r[13], last_checked_at: r[15] })) };
          if (sql.includes('WHERE municipality_code')) return { results: [...rows.values()].filter((r) => r[1] === args[0]).map((r) => ({ external_dataset_id: r[0], municipality_code: r[1], prefecture_code: r[2], prefecture_name: r[3], city_name: r[4], dataset_year: r[5], specification_version: r[6], feature_types_json: r[7], source_url: r[8], distribution_url: r[9], license_name: r[10], attribution_text: r[11], is_latest: r[12], is_available: r[13], last_checked_at: r[15] })) };
          if (sql.includes('SELECT * FROM plateau_sync_runs')) return { results: [...runs].reverse().slice(0, args[0] || 20) };
          return { results: [] };
        },
        async run() {
          if (sql.includes('INSERT INTO plateau_datasets')) rows.set(args[0], args);
          else if (sql.includes('INSERT INTO plateau_sync_runs')) runs.push({ id: args[0], status: 'queued', created_at: args[1], updated_at: args[2], fetched: 0, inserted: 0, updated: 0, skipped: 0, error_count: 0 });
          else if (sql.includes("SET status = 'running'")) { const run = runs.find((r) => r.id === args[3] && r.status === 'queued'); if (run) run.status = 'running'; return { meta: { changes: run ? 1 : 0 } }; }
          else if (sql.includes("SET status = 'failed'")) { const run = runs.find((r) => r.id === args.at(-1)); if (run) run.status = 'failed'; }
          return { meta: { changes: 1, last_row_id: 1 } };
        }
      };
    }, async all() { return { results: [] }; }, async first() { if (sql.includes('plateau_sync_runs') && sql.includes('status IN')) return runs.find((r) => ['queued', 'running'].includes(r.status)) || null; if (sql.includes("SELECT id FROM plateau_sync_runs WHERE status = 'queued'")) return runs.find((r) => r.status === 'queued') || null; if (sql.includes('SELECT * FROM plateau_sync_runs')) return runs.at(-1) || null; return { count: 0 }; }, async run() { return { meta: { changes: 1 } }; } };
  } };
}

function plateauRequest(path, token = 'secret') { return new Request(`https://mamoru.test${path}`, { method: path === '/api/admin/plateau/sync' ? 'POST' : 'GET', headers: token === null ? {} : { authorization: `Bearer ${token}` } }); }

test('parseFeed extracts RSS items and strips CDATA/html', () => {
  const xml = `<rss><channel><item><guid>abc</guid><title><![CDATA[熊本市の避難所開設]]></title><description><![CDATA[<p>避難所を開設しました。</p>]]></description><link>https://example.com/a</link><pubDate>Mon, 03 Aug 2026 00:00:00 GMT</pubDate></item></channel></rss>`;
  const [item] = parseFeed(xml);
  assert.equal(item.guid, 'abc');
  assert.equal(item.title, '熊本市の避難所開設');
  assert.equal(item.summary, '避難所を開設しました。');
  assert.equal(item.link, 'https://example.com/a');
});

test('extractItem never invents missing area and classifies content', () => {
  const result = extractItem({ title: '通行止めのお知らせ', summary: '道路の安全確認中です。' }, 'official');
  assert.equal(result.reportType, 'road');
  assert.equal(result.area, 'unknown');
  assert.equal(result.confidence, 0.82);
});

test('source allowlist requires an explicitly allowed host', () => {
  assert.equal(allowedHost('https://news.example.com/feed.xml', 'example.com'), true);
  assert.equal(allowedHost('https://evil-example.com/feed.xml', 'example.com'), false);
  assert.equal(allowedHost('https://example.com/feed.xml', ''), false);
  assert.equal(sameHost('https://example.com/a', 'https://example.com/feed'), true);
  assert.equal(sameHost('https://example.com/a', 'https://other.example/feed'), false);
});

test('auto-publish policy only accepts trusted official classified items', () => {
  const source = {
    category: 'official',
    source_url: 'https://www.city.kumamoto.jp/bousai/default.html',
    feed_url: 'https://www.city.kumamoto.jp/bousai/new_list.xml'
  };
  const env = { AUTO_PUBLISH_ENABLED: 'true', AUTO_PUBLISH_MIN_CONFIDENCE: '0.82', ALLOWED_SOURCE_HOSTS: 'www.city.kumamoto.jp' };
  const safeItem = { link: 'https://www.city.kumamoto.jp/bousai/kiji.html', title: '大雨注意報', summary: '地域の状況に注意してください。', publishedAt: new Date().toISOString() };
  const positioned = { reportType: 'warning', confidence: 0.82, latitude: 32.8031, longitude: 130.7079, locationMethod: 'coarse-rule-v1' };
  assert.equal(shouldAutoPublish(source, safeItem, positioned, env), true);
  assert.equal(shouldAutoPublish(source, { ...safeItem, title: '避難指示を発令' }, positioned, env), false);
  assert.equal(shouldAutoPublish(source, { ...safeItem, publishedAt: '2016-04-16T00:00:00.000Z' }, positioned, env), false);
  assert.equal(shouldAutoPublish(source, safeItem, { ...positioned, latitude: null, longitude: null }, env), false);
  assert.equal(shouldAutoPublish(source, safeItem, { ...positioned, reportType: 'other', confidence: 0.99 }, env), false);
  assert.equal(shouldAutoPublish({ ...source, category: 'news' }, safeItem, positioned, env), false);
});

test('trust metadata helpers keep workflow, source class, position precision and validity explicit', () => {
  assert.equal(deriveInformationClass({ category: 'official', access_method: 'rss' }), 'official');
  assert.equal(deriveInformationClass({ category: 'news', access_method: 'toyota_vics' }), 'reference');
  assert.equal(deriveInformationClass({ category: 'news', access_method: 'rss' }), 'media');
  assert.equal(deriveLocationPrecision('coarse-rule-v1', 32.8, 130.7), 'representative');
  assert.equal(deriveLocationPrecision('geojson-point', 32.8, 130.7), 'estimated');
  assert.equal(deriveLocationPrecision('human-reviewed-point', 32.8, 130.7, true), 'exact');
  assert.equal(deriveLocationPrecision(null, null, null), 'unknown');
  assert.equal(normalizeLifecycleStatus(null, 'review'), 'needs_review');
  assert.equal(normalizeLifecycleStatus(null, 'expired'), 'expired');
  assert.equal(defaultValidUntil('warning', '2026-08-04T00:00:00.000Z'), '2026-08-04T12:00:00.000Z');
});

test('Solafune GeoJSON parser keeps Kumamoto metadata and excludes out-of-area events', () => {
  const payload = JSON.stringify({ type: 'FeatureCollection', features: [
    { type: 'Feature', geometry: { type: 'Point', coordinates: [130.8, 32.8] }, properties: { id: 'kuma-1', title: '熊本県熊本地方の地震', source_name: '気象庁', source_type: '公的', source_time: '2026-08-03T16:24:00+09:00', source_url: 'https://www.data.jma.go.jp/example.xml', municipality: '熊本市', kind: '地震' } },
    { type: 'Feature', geometry: { type: 'Point', coordinates: [139.4, 37.0] }, properties: { id: 'other-1', title: '福島県会津の地震', source_name: '気象庁', source_time: '2026-08-03T15:00:00+09:00', source_url: 'https://www.data.jma.go.jp/other.xml' } }
  ] });
  const items = parseGeoJsonFeed(payload);
  assert.equal(items.length, 1);
  assert.equal(items[0].guid, 'kuma-1');
  assert.equal(items[0].area, '熊本市');
  assert.equal(items[0].latitude, 32.8);
  assert.match(items[0].summary, /Solafune/);
  assert.doesNotMatch(items[0].summary, /本文/);
});

test('Toyota passable-route HTML parser extracts Kumamoto event metadata without copying map tiles', () => {
  const html = `<!doctype html><html><head><title>通れた道マップ</title></head><body>
    <div class="hd">お知らせ</div><div class="cont">7月28日の熊本県で発生した震度７の地震により表示エリアを変更しています。<br>通行実績と交通規制情報を表示しています。</div>
    <a href="#" onclick="searchList('130.697-32.65736');">熊本県宇城市震度7_202607281630</a>
    <a href="#" onclick="searchList('141.6554-40.48715');">青森県震度6強20260625</a>
    <script>const privateTile = 'https://tiles.example/private';</script>
  </body></html>`;
  const items = parseHtmlMedia(html, 'https://www.toyota.co.jp/jpn/auto/passable_route/map/', 'text/html; charset=utf-8');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'トヨタ 通れた道マップ：熊本県宇城市震度7_202607281630');
  assert.equal(items[0].area, '宇城市');
  assert.equal(items[0].longitude, 130.697);
  assert.equal(items[0].latitude, 32.65736);
  assert.equal(items[0].publishedAt, '2026-07-28T07:30:00.000Z');
  assert.match(items[0].summary, /通行可能を保証するものではありません/);
  assert.doesNotMatch(JSON.stringify(items[0]), /privateTile|tiles\.example/);
});

test('HTML media parser extracts JSON-LD articles from registered public pages', () => {
  const html = `<!doctype html><html><head><script type="application/ld+json">${JSON.stringify({
    '@type': 'NewsArticle', headline: '熊本市の避難所を開設', description: '熊本市が避難所を開設しました。',
    datePublished: '2026-08-03T12:30:00+09:00', url: '/news/1',
    contentLocation: { name: '熊本市', geo: { latitude: 32.8, longitude: 130.7 } }
  })}</script></head></html>`;
  const [item] = parseSourcePayload(html, 'html', 'https://example.jp/disaster/', 'text/html');
  assert.equal(item.link, 'https://example.jp/news/1');
  assert.equal(item.area, '熊本市');
  assert.equal(item.publishedAt, '2026-08-03T03:30:00.000Z');
});

test('Toyota VICS parser keeps only non-personal road restrictions around the Kumamoto disaster area', () => {
  const payload = JSON.stringify({ resultcode: 0, results: [
    { RegulationCode: '1', RegulationName: '通行止', RegulationDetailCode: '0', RegulationDetailName: '詳細無し', CauseCode: '9', CauseName: '災害等', CauseDetailCode: '6', CauseDetailName: '道路損壊', Lat: 32.6484, Lon: 130.7082, Vin: 'never-export', Phone: 'never-export' },
    { RegulationCode: '1', RegulationName: '通行止', CauseCode: '9', CauseName: '災害等', Lat: 35.6, Lon: 139.7 }
  ] });
  const items = parseToyotaVics(payload, 'https://www.toyota.co.jp/jpn/auto/passable_route/map/Home/GetVicsReg');
  assert.equal(items.length, 1);
  assert.equal(items[0].title, 'トヨタ道路情報：通行止（災害等・道路損壊）');
  assert.equal(items[0].locationMethod, 'toyota-vics-point');
  assert.doesNotMatch(JSON.stringify(items[0]), /never-export|Vin|Phone/);
});

test('Open-Meteo normalizer preserves zero precipitation and rejects incomplete payloads', () => {
  const weather = normalizeOpenMeteo({
    latitude: 32.8,
    longitude: 130.6875,
    timezone: 'Asia/Tokyo',
    current_units: { temperature_2m: '°C', precipitation: 'mm', wind_speed_10m: 'km/h' },
    current: { time: 1785768300, interval: 900, temperature_2m: 29.1, precipitation: 0, wind_speed_10m: 1.4 }
  });
  assert.equal(weather.location.name, '熊本市中心部');
  assert.equal(weather.precipitation.value, 0);
  assert.equal(weather.observed_at, '2026-08-03T14:45:00.000Z');
  assert.equal(normalizeOpenMeteo({ current: { time: 1 } }), null);
});

test('discovery source validation rejects generic Salesforce portal roots', () => {
  assert.equal(validDiscoverySourceUrl('https://city-kumamoto.my.salesforce-sites.com/'), null);
  assert.equal(validDiscoverySourceUrl('https://city-kumamoto.my.salesforce-sites.com/s/detail/a001'), 'https://city-kumamoto.my.salesforce-sites.com/s/detail/a001');
  assert.equal(validDiscoverySourceUrl('https://www.data.jma.go.jp/example.xml'), 'https://www.data.jma.go.jp/example.xml');
});

test('parseFeed supports Atom entries used by JMA XML feeds', () => {
  const xml = `<feed><entry><id>jma-1</id><title>熊本県に関する地震情報</title><summary>熊本県で震度を観測しました。</summary><link rel="alternate" href="https://www.jma.go.jp/event/1"/><updated>2026-08-03T12:00:00+09:00</updated></entry></feed>`;
  const [item] = parseFeed(xml);
  assert.equal(item.guid, 'jma-1');
  assert.equal(item.link, 'https://www.jma.go.jp/event/1');
  assert.match(item.summary, /熊本県/);
});

test('article extractor reads NewsArticle metadata without keeping page markup', () => {
  const html = `<!doctype html><html><head><link rel="canonical" href="https://www.fnn.jp/articles/-/1"><script type="application/ld+json">${JSON.stringify({
    '@context': 'https://schema.org', '@type': 'NewsArticle', headline: '熊本の被害状況',
    description: '熊本市で建物の被害が確認されました。自治体が詳しい状況を調査しています。',
    datePublished: '2026-08-03T12:30:00+09:00', dateModified: '2026-08-03T12:45:00+09:00'
  })}</script></head><body><script>危険な本文</script></body></html>`;
  const article = extractArticleDocument(html, 'text/html; charset=utf-8', 'https://www.fnn.jp/articles/-/1');
  assert.equal(article.extractionMethod, 'article-description-v1');
  assert.match(article.excerpt, /建物の被害/);
  assert.doesNotMatch(article.excerpt, /<script>/);
  assert.equal(article.publishedAt, '2026-08-03T03:30:00.000Z');
  assert.equal(article.modifiedAt, '2026-08-03T03:45:00.000Z');
});

test('article extractor reads JMA XML headline and report time', () => {
  const xml = `<?xml version="1.0"?><Report><Head><ReportDateTime>2026-08-03T22:24:00+09:00</ReportDateTime><Headline><Text>熊本県で地震がありました。</Text></Headline></Head><Body><Comment><Text>この地震による津波の心配はありません。</Text></Comment></Body></Report>`;
  const article = extractArticleDocument(xml, 'text/xml', 'https://www.data.jma.go.jp/example.xml');
  assert.equal(article.extractionMethod, 'article-xml-v1');
  assert.match(article.excerpt, /津波の心配はありません/);
  assert.equal(article.publishedAt, '2026-08-03T13:24:00.000Z');
});

test('article extractor rejects Warmup pages and URL policy blocks unsafe hosts', () => {
  const warmup = extractArticleDocument('<!doctype html><html><head><title>Warmup Page</title></head><body></body></html>', 'text/html', 'https://example.com/');
  assert.equal(warmup.error, 'warmup_page');
  const hosts = 'www.fnn.jp,www.data.jma.go.jp';
  assert.equal(articleUrlAllowed('https://www.fnn.jp/articles/-/1', hosts), 'https://www.fnn.jp/articles/-/1');
  assert.equal(articleUrlAllowed('http://127.0.0.1/private', '127.0.0.1'), null);
  assert.equal(articleUrlAllowed('https://evil.example/article', hosts), null);
});

test('article title matching rejects generic dashboards for specific event titles', () => {
  assert.equal(articleTitleMatches('熊本に緊急地震速報 熊本で最大震度7を観測', '熊本に緊急地震速報 熊本で最大震度7を観測｜FNNプライムオンライン'), true);
  assert.equal(articleTitleMatches('震源・震度に関する情報', '震源・震度に関する情報'), true);
  assert.equal(articleTitleMatches('甲佐 暑さ指数 35.3（危険）', '環境省熱中症予防情報サイト 暑さ指数とは？'), false);
});

test('public report exports include only coordinate GeoJSON and escape CSV formulas', () => {
  const reports = [
    { id: 1, title: '=danger', summary: '建物が倒壊', report_type: 'damage', area: '熊本市', latitude: 32.8, longitude: 130.7, priority: 'emergency' },
    { id: 2, title: '位置不明', summary: '確認中', report_type: 'other', area: '熊本県', latitude: null, longitude: null, priority: 'medium' }
  ];
  const geojson = reportsToGeoJson(reports);
  assert.equal(geojson.features.length, 1);
  assert.deepEqual(geojson.features[0].geometry.coordinates, [130.7, 32.8]);
  assert.match(reportsToCsv(reports), /"'=danger"/);
  assert.equal(reportPriority(reports[0]), 'emergency');
});

test('archive reports label review news as reference-only and do not expose internal fields', () => {
  const report = sanitizeArchiveReport({
    id: 42,
    category: 'news',
    report_type: 'damage',
    area: '宇城市',
    summary: '取得済みの記事本文',
    published_at: '2026-07-28T07:31:00.000Z',
    latitude: 32.6462,
    longitude: 130.6847,
    location_method: 'aggregator-geojson',
    auto_published: 0,
    expires_at: null,
    retrieved_at: '2026-08-03T12:00:00.000Z',
    title: '熊本に緊急地震速報',
    item_url: 'https://www.fnn.jp/articles/-/1083324',
    source_name: 'Solafune 災害情報GeoJSON',
    record_status: 'review',
    review_note: '公開してはいけない内部メモ',
    article_excerpt: '公開してはいけない記事本文'
  });
  assert.equal(report.verification_status, 'reference_unverified');
  assert.equal(report.summary, '報道・参考情報です。内容はリンク先の原文で確認してください。');
  assert.equal('review_note' in report, false);
  assert.equal('article_excerpt' in report, false);
  assert.equal('record_status' in report, false);
});

test('PLATEAU normalizer accepts official catalog fields and rejects incomplete rows', () => {
  const [item] = normalizePlateauPayload([{ id: '13101-bldg-2025', city_code: '13101', pref_code: '13', pref: '東京都', city: '千代田区', year: '2025', spec: 'bldg-lod2', layers: ['bldg'], url: 'https://example.test/data.zip', composite_url: 'https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/13101-bldg-lod2-latest/tileset.json' }], '2026-08-10T00:00:00.000Z');
  assert.equal(item.values[0], '13101-bldg-2025');
  assert.equal(item.values[1], '13101');
  assert.equal(item.values[12], 0);
  assert.equal(normalizePlateauPayload([{ id: 'bad', city_code: 'abc' }], new Date().toISOString()).length, 0);
  assert.equal(normalizePlateauPayload({ latest_citygml: [{ id: 'latest-city', city_code: '13101', year: 'latest' }] }, new Date().toISOString()).length, 1);
});

test('PLATEAU sync queues quickly, requires Bearer auth, and rejects duplicates', async () => {
  const db = plateauDb();
  const queued = [];
  const env = { DB: db, ADMIN_TOKEN: 'secret', PLATEAU_SYNC_QUEUE: { async send(message) { queued.push(message); } } };
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('must not fetch from start API'); };
  try {
    const denied = await handler.fetch(plateauRequest('/api/admin/plateau/sync', null), env);
    assert.equal(denied.status, 401);
    assert.equal(denied.headers.get('cache-control'), 'no-store');
    const first = await handler.fetch(plateauRequest('/api/admin/plateau/sync'), env);
    assert.equal(first.status, 202);
    assert.equal((await first.json()).status, 'queued');
    assert.equal(queued.length, 1);
    assert.equal(queued[0].type, 'catalog');
    const second = await handler.fetch(plateauRequest('/api/admin/plateau/sync'), env);
    assert.equal(second.status, 409);
    const status = await handler.fetch(plateauRequest('/api/admin/plateau/sync/status'), env);
    assert.equal(status.status, 200);
    assert.equal((await status.json()).run.status, 'queued');
  } finally { globalThis.fetch = originalFetch; }
});

test('PLATEAU queue messages stay within item and byte limits', () => {
  const runId = '11111111-1111-4111-8111-111111111111';
  const values = (id) => [id, '13101', '13', null, null, '2025', null, '[]', 'https://example.test/a', 'https://example.test/a', null, null, 0, 1, 'now', 'now', 'now', 'now'];
  const messages = createPlateauQueueMessages(runId, Array.from({ length: 101 }, (_, index) => ({ values: values(`dataset-${index}`) })));
  assert.equal(messages.length, 3);
  for (const message of messages) {
    assert.ok(message.body.items.length <= 50);
    assert.ok(new TextEncoder().encode(JSON.stringify(message.body)).byteLength < 120000);
  }
});

test('PLATEAU sync status runs validates limit and does not expose secrets', async () => {
  const env = { DB: plateauDb(), ADMIN_TOKEN: 'secret' };
  const invalid = await handler.fetch(plateauRequest('/api/admin/plateau/sync/runs?limit=0'), env);
  assert.equal(invalid.status, 400);
  assert.equal(invalid.headers.get('cache-control'), 'no-store');
  assert.equal((await handler.fetch(plateauRequest('/api/admin/plateau/sync/runs?limit=1'), env)).status, 200);
});

test('PLATEAU APIs validate availability inputs and set cache headers', async () => {
  const db = plateauDb();
  db.rows.set('d1', ['d1', '13101', '13', '東京都', '千代田区', 'latest', null, '[]', null, null, null, null, 1, 1, 'fetched', 'checked', 'created', 'updated']);
  const env = { DB: db, ADMIN_TOKEN: 'secret' };
  const regions = await handler.fetch(plateauRequest('/api/plateau/regions', null), env);
  assert.equal(regions.status, 200);
  assert.equal(regions.headers.get('cache-control'), 'public, max-age=300');
  assert.equal((await handler.fetch(plateauRequest('/api/plateau/availability?municipality_code=13101', null), env)).status, 200);
  assert.equal((await handler.fetch(plateauRequest('/api/plateau/availability?municipality_code=bad', null), env)).status, 400);
  const coordinates = await handler.fetch(plateauRequest('/api/plateau/availability?lat=35&lng=139', null), env);
  assert.equal(coordinates.status, 400);
  assert.equal(coordinates.headers.get('cache-control'), 'public, max-age=300');
});

test('PLATEAU hazard config exposes only allowlisted direct MVT hazards', async () => {
  const db = plateauDb();
  db.rows.set('13101_lsld', ['13101_lsld', '13101', '13', '東京都', '千代田区', 'latest', null, '["lsld"]', 'https://api.plateauview.mlit.go.jp/datacatalog/mvt/13101-lsld-latest/tilejson.json', 'https://api.plateauview.mlit.go.jp/datacatalog/mvt/13101-lsld-latest/tilejson.json', null, null, 1, 1, 'fetched', 'checked', 'created', 'updated']);
  db.rows.set('13101_bad', ['13101_bad', '13101', '13', '東京都', '千代田区', 'latest', null, '["fld"]', 'http://not-allowed.example/flood.json', 'http://not-allowed.example/flood.json', null, null, 1, 1, 'fetched', 'checked', 'created', 'updated']);
  const response = await handler.fetch(plateauRequest('/api/plateau/hazards/config?municipality_code=13101', null), { DB: db });
  assert.equal(response.status, 200);
  const body = await response.json();
  const landslide = body.hazards.find((item) => item.hazardType === 'landslide');
  const flood = body.hazards.find((item) => item.hazardType === 'flood');
  assert.equal(landslide.available, true);
  assert.equal(landslide.format, 'MVT (TileJSON)');
  assert.equal(landslide.layerName, 'lsld');
  assert.equal(landslide.tilesUrl, 'https://api.plateauview.mlit.go.jp/datacatalog/mvt/13101-lsld-latest/tilejson.json');
  assert.equal(flood.available, false);
  assert.equal(flood.tilesUrl, null);
  assert.equal((await handler.fetch(plateauRequest('/api/plateau/hazards/config?municipality_code=bad', null), { DB: db })).status, 400);
});
