const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };
const ARTICLE_MAX_BYTES = 1_000_000;
const SOURCE_MAX_BYTES = 5_000_000;
const ARTICLE_EXCERPT_MAX = 1_000;
const ARTICLE_BATCH_DEFAULT = 5;
const ARTICLE_BATCH_MAX = 10;
const LIFECYCLE_STATUSES = new Set(['active', 'ongoing', 'resolved', 'expired', 'needs_review']);
const INFORMATION_CLASSES = new Set(['official', 'media', 'reference']);
const LOCATION_PRECISIONS = new Set(['exact', 'representative', 'estimated', 'unknown']);
const ROAD_STATUSES = new Set(['recently_passed', 'restricted', 'closed', 'unknown']);
const PREFECTURE_CENTERS = [
  ['北海道', 43.0642, 141.3469], ['青森県', 40.8244, 140.7400], ['岩手県', 39.7036, 141.1527],
  ['宮城県', 38.2688, 140.8721], ['秋田県', 39.7186, 140.1024], ['山形県', 38.2404, 140.3633],
  ['福島県', 37.7503, 140.4676], ['茨城県', 36.3418, 140.4468], ['栃木県', 36.5657, 139.8836],
  ['群馬県', 36.3912, 139.0609], ['埼玉県', 35.8569, 139.6489], ['千葉県', 35.6047, 140.1233],
  ['東京都', 35.6895, 139.6917], ['神奈川県', 35.4478, 139.6425], ['新潟県', 37.9026, 139.0232],
  ['富山県', 36.6953, 137.2113], ['石川県', 36.5947, 136.6256], ['福井県', 36.0652, 136.2216],
  ['山梨県', 35.6642, 138.5684], ['長野県', 36.6513, 138.1810], ['岐阜県', 35.3912, 136.7223],
  ['静岡県', 34.9769, 138.3831], ['愛知県', 35.1802, 136.9066], ['三重県', 34.7303, 136.5086],
  ['滋賀県', 35.0045, 135.8686], ['京都府', 35.0214, 135.7556], ['大阪府', 34.6863, 135.5200],
  ['兵庫県', 34.6913, 135.1830], ['奈良県', 34.6851, 135.8329], ['和歌山県', 34.2260, 135.1675],
  ['鳥取県', 35.5039, 134.2383], ['島根県', 35.4723, 133.0505], ['岡山県', 34.6618, 133.9350],
  ['広島県', 34.3966, 132.4596], ['山口県', 34.1861, 131.4705], ['徳島県', 34.0658, 134.5593],
  ['香川県', 34.3401, 134.0434], ['愛媛県', 33.8416, 132.7657], ['高知県', 33.5597, 133.5311],
  ['福岡県', 33.6064, 130.4183], ['佐賀県', 33.2494, 130.2988], ['長崎県', 32.7448, 129.8737],
  ['熊本県', 32.7898, 130.7417], ['大分県', 33.2382, 131.6126], ['宮崎県', 31.9111, 131.4239],
  ['鹿児島県', 31.5602, 130.5581], ['沖縄県', 26.2124, 127.6809]
];

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });
    try {
      const response = await route(request, env, url);
      return withCors(response);
    } catch (error) {
      console.error(error);
      return withCors(json({ error: 'internal_error', message: '処理に失敗しました。' }, 500));
    }
  },
  async scheduled(controller, env, ctx) {
    ctx.waitUntil(runIngestionLoop(env.DB, env).then(async (result) => {
      const lifecycle = await refreshLifecycleStatuses(env.DB);
      console.log(JSON.stringify({ event: 'scheduled_ingest', ...result }));
      console.log(JSON.stringify({ event: 'scheduled_lifecycle', ...lifecycle }));
    }));
  }
};

async function route(request, env, url) {
  if (!url.pathname.startsWith('/api/')) return json({ error: 'not_found' }, 404);
  if (!env.DB) return json({ error: 'database_not_configured', message: 'D1 binding DB が設定されていません。' }, 503);

  if (request.method === 'GET' && url.pathname === '/api/health') return json({ ok: true, env: env.APP_ENV || 'unknown', version: env.APP_VERSION || 'unknown' });
  const protectedRoute = (request.method === 'POST' && url.pathname === '/api/sources')
    || (request.method === 'POST' && /^\/api\/sources\/\d+\/ingest$/.test(url.pathname))
    || (request.method === 'POST' && url.pathname === '/api/automation/run')
    || (request.method === 'POST' && url.pathname === '/api/automation/approve-existing')
    || (request.method === 'POST' && url.pathname === '/api/automation/backfill-locations')
    || (request.method === 'POST' && url.pathname === '/api/automation/enrich-articles')
    || (request.method === 'GET' && url.pathname === '/api/review-queue')
    || (request.method === 'POST' && /^\/api\/review\/\d+$/.test(url.pathname))
    || (request.method === 'GET' && url.pathname === '/api/admin/reports')
    || (request.method === 'GET' && /^\/api\/admin\/reports\/\d+\/history$/.test(url.pathname))
    || (request.method === 'POST' && /^\/api\/admin\/reports\/\d+\/state$/.test(url.pathname));
  if (protectedRoute) {
    const auth = await authorize(request, env, url.pathname);
    if (auth) return auth;
  }
  if (request.method === 'GET' && url.pathname === '/api/sources') return listSources(env.DB);
  if (request.method === 'POST' && url.pathname === '/api/sources') return createSource(request, env.DB, env);
  if (request.method === 'POST' && /^\/api\/sources\/\d+\/ingest$/.test(url.pathname)) return ingest(request, env.DB, Number(url.pathname.split('/')[3]), env);
  if (request.method === 'POST' && url.pathname === '/api/automation/run') return json(await runIngestionLoop(env.DB, env));
  if (request.method === 'POST' && url.pathname === '/api/automation/approve-existing') return json(await approveExistingAutoPublish(env.DB, env));
  if (request.method === 'POST' && url.pathname === '/api/automation/backfill-locations') return json(await backfillCoarseLocations(env.DB));
  if (request.method === 'POST' && url.pathname === '/api/automation/enrich-articles') return json(await enrichPendingArticles(env.DB, env, await readJson(request)));
  if (request.method === 'GET' && url.pathname === '/api/review-queue') return listReviewQueue(env.DB);
  if (request.method === 'GET' && url.pathname === '/api/reports') return listReports(env.DB);
  if (request.method === 'GET' && /^\/api\/reports\/\d+\/history$/.test(url.pathname)) return publicReportHistory(env.DB, Number(url.pathname.split('/')[3]));
  if (request.method === 'GET' && url.pathname === '/api/archive/reports') return listArchiveReports(env.DB);
  if (request.method === 'GET' && url.pathname === '/api/weather') return currentWeather();
  if (request.method === 'GET' && url.pathname === '/api/reports.geojson') return downloadReportsGeoJson(env.DB);
  if (request.method === 'GET' && url.pathname === '/api/reports.csv') return downloadReportsCsv(env.DB);
  if (request.method === 'POST' && /^\/api\/review\/\d+$/.test(url.pathname)) return review(request, env.DB, Number(url.pathname.split('/')[3]));
  if (request.method === 'GET' && url.pathname === '/api/admin/reports') return listAdminReports(env.DB);
  if (request.method === 'GET' && /^\/api\/admin\/reports\/\d+\/history$/.test(url.pathname)) return adminReportHistory(env.DB, Number(url.pathname.split('/')[4]));
  if (request.method === 'POST' && /^\/api\/admin\/reports\/\d+\/state$/.test(url.pathname)) return updateReportState(request, env.DB, Number(url.pathname.split('/')[4]));
  return json({ error: 'not_found' }, 404);
}

async function listSources(db) {
  const { results } = await db.prepare('SELECT * FROM sources ORDER BY created_at DESC').all();
  return json({ sources: results });
}

async function createSource(request, db, env) {
  const body = await readJson(request);
  const name = clean(body.name, 120);
  const sourceUrl = validUrl(body.source_url);
  const feedUrl = validUrl(body.feed_url);
  const category = body.category;
  const accessMethod = clean(body.access_method, 30) || 'rss';
  if (!name || !sourceUrl || !feedUrl || !['official', 'news'].includes(category)
    || !['rss', 'atom', 'geojson', 'html', 'toyota_vics'].includes(accessMethod)) {
    return json({ error: 'validation_error', message: 'name、source_url、feed_url、category は必須です。' }, 400);
  }
  if (!sameHost(sourceUrl, feedUrl) || !allowedHost(sourceUrl, env.ALLOWED_SOURCE_HOSTS)) {
    return json({ error: 'source_host_not_allowed', message: '許可リストに登録された同一ホストのURLだけ登録できます。' }, 400);
  }
  const result = await db.prepare('INSERT INTO sources (name, category, source_url, feed_url, access_method) VALUES (?, ?, ?, ?, ?)')
    .bind(name, category, sourceUrl, feedUrl, accessMethod).run();
  return json({ id: result.meta.last_row_id, message: '情報源を登録しました。' }, 201);
}

async function ingest(_request, db, sourceId, env) {
  const source = await db.prepare('SELECT * FROM sources WHERE id = ? AND enabled = 1').bind(sourceId).first();
  if (!source) return json({ error: 'source_not_found' }, 404);
  const retrievedAt = new Date().toISOString();
  let response;
  try {
    response = await fetch(source.feed_url, { headers: {
      accept: 'text/html, application/geo+json, application/json, application/rss+xml, application/atom+xml, application/xml, text/xml',
      'accept-language': 'ja-JP,ja;q=0.9',
      'user-agent': 'MamoruMap/1.0 (+https://mamoru-map-api.krin6525.workers.dev/)'
    } });
  } catch {
    await markSourceFailure(db, sourceId);
    return json({ error: 'fetch_failed', message: '情報源を取得できませんでした。' }, 502);
  }
  if (!response.ok) {
    await markSourceFailure(db, sourceId);
    return json({ error: 'source_http_error', status: response.status }, 502);
  }
  let payload;
  try {
    payload = await readResponseTextLimited(response, SOURCE_MAX_BYTES, response.headers.get('content-type') || '');
  } catch (error) {
    await markSourceFailure(db, sourceId);
    return json({ error: 'source_payload_invalid', message: clean(error?.message, 120) || '情報源の応答を読み取れませんでした。' }, 502);
  }
  const items = parseSourcePayload(payload, source.access_method, response.url || source.feed_url, response.headers.get('content-type') || '');
  const itemLimit = ['geojson', 'toyota_vics'].includes(source.access_method) ? 500 : 50;
  const { results: existingRawItems } = await db.prepare('SELECT source_id, external_id, item_url FROM raw_items').all();
  const existingUrls = new Set(existingRawItems.map((item) => item.item_url));
  const existingSourceItems = new Set(existingRawItems.filter((item) => item.source_id === sourceId).map((item) => item.external_id));
  let created = 0;
  let autoPublished = 0;
  for (const item of items.slice(0, itemLimit)) {
    const externalId = item.guid || item.link || `${item.title}:${item.publishedAt || ''}`;
    if (existingSourceItems.has(externalId)) {
      if (source.access_method === 'toyota_vics') {
        await db.prepare('UPDATE raw_items SET retrieved_at = ? WHERE source_id = ? AND external_id = ?')
          .bind(retrievedAt, sourceId, externalId).run();
      }
      continue;
    }
    if (existingUrls.has(item.link) && source.access_method !== 'toyota_vics') continue;
    const raw = await db.prepare('INSERT OR IGNORE INTO raw_items (source_id, external_id, title, summary, item_url, published_at, retrieved_at, raw_hash) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(sourceId, externalId, item.title, item.summary, item.link, item.publishedAt, retrievedAt, await sha256(`${externalId}:${item.title}:${item.summary}`)).run();
    if (!raw.meta.changes) continue;
    existingUrls.add(item.link);
    existingSourceItems.add(externalId);
    const baseExtracted = extractItem(item, source.category);
    const itemLocation = Number.isFinite(item.latitude) && Number.isFinite(item.longitude)
      ? { latitude: item.latitude, longitude: item.longitude, locationMethod: item.locationMethod || `${source.access_method}-point` }
      : locationFields(`${item.title} ${item.summary || ''}`);
    const extracted = { ...baseExtracted, area: item.area || baseExtracted.area, ...itemLocation };
    const roadStatus = extracted.reportType === 'road'
      ? normalizeRoadStatus(item.roadStatus || deriveRoadStatus(`${item.title} ${item.summary || ''}`)) : 'unknown';
    const autoPublish = shouldAutoPublish(source, item, extracted, env);
    const autoPublishedAt = autoPublish ? new Date().toISOString() : null;
    const validUntil = autoPublish ? defaultValidUntil(extracted.reportType, autoPublishedAt) : null;
    const extractionMethod = `${source.access_method || 'rss'}-rule-v1`;
    const informationClass = deriveInformationClass(source);
    const locationPrecision = deriveLocationPrecision(extracted.locationMethod, extracted.latitude, extracted.longitude, false);
    const lifecycleStatus = autoPublish ? 'active' : 'needs_review';
    const inserted = await db.prepare(`INSERT INTO extracted_items
      (raw_item_id, category, report_type, area, summary, published_at, status, auto_published, expires_at,
       extraction_method, confidence, lifecycle_status, information_class, location_precision, last_verified_at,
       valid_until, last_changed_at, reviewer, reviewed_at, review_note, road_status, road_observed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`) 
      .bind(raw.meta.last_row_id, source.category, extracted.reportType, extracted.area, extracted.summary, item.publishedAt,
        autoPublish ? 'published' : 'review', autoPublish ? 1 : 0, validUntil, extractionMethod, extracted.confidence,
        lifecycleStatus, informationClass, locationPrecision, null, validUntil, autoPublishedAt || retrievedAt,
        autoPublish ? 'system-auto' : null, autoPublishedAt,
        autoPublish ? '自動公開・未確認。信頼性ポリシーv2の条件を満たした公式情報。' : null,
        roadStatus, normalizeTimestamp(item.roadObservedAt) || item.publishedAt || null).run();
    if (extracted.latitude !== null && extracted.longitude !== null) {
      await db.prepare('UPDATE extracted_items SET latitude = ?, longitude = ?, location_method = ? WHERE id = ?')
        .bind(extracted.latitude, extracted.longitude, extracted.locationMethod, inserted.meta.last_row_id).run();
    }
    await db.prepare('INSERT INTO audit_events (extracted_item_id, event_type, actor, detail) VALUES (?, ?, ?, ?)')
      .bind(inserted.meta.last_row_id, autoPublish ? 'auto_publish' : 'extracted', autoPublish ? 'system-auto' : 'system', autoPublish ? `policy-v2; lifecycle=active; valid_until=${validUntil}` : `${extractionMethod}; lifecycle=needs_review`).run();
    await addRevision(db, inserted.meta.last_row_id, {
      revisionType: autoPublish ? 'published' : 'created',
      changedFields: ['lifecycle_status', 'information_class', 'location_precision', 'valid_until', 'road_status'],
      newValues: { lifecycle_status: lifecycleStatus, information_class: informationClass, location_precision: locationPrecision, valid_until: validUntil, road_status: roadStatus },
      actor: autoPublish ? 'system-auto' : 'system',
      publicNote: autoPublish ? '公式情報を条件付きで自動公開しました。' : null,
      detail: autoPublish ? 'policy-v2' : extractionMethod,
      createdAt: autoPublishedAt || retrievedAt
    });
    created += 1;
    if (autoPublish) autoPublished += 1;
  }
  await db.prepare('UPDATE sources SET last_success_at = ?, last_failure_at = NULL WHERE id = ?').bind(retrievedAt, sourceId).run();
  return json({ source_id: sourceId, access_method: source.access_method, payload_bytes: payload.length, fetched: items.length, created, auto_published: autoPublished, status: 'review_required' });
}

async function runIngestionLoop(db, env) {
  const { results: sources } = await db.prepare('SELECT id, name FROM sources WHERE enabled = 1 ORDER BY id').all();
  const results = [];
  for (const source of sources) {
    try {
      const response = await ingest(null, db, source.id, env);
      const payload = await response.json();
      results.push({ name: source.name, ...payload });
    } catch (error) {
      console.error(JSON.stringify({ event: 'source_ingest_error', source_id: source.id, message: error?.message }));
      await markSourceFailure(db, source.id);
      results.push({ source_id: source.id, name: source.name, error: 'unexpected_ingest_error', status: 'failed' });
    }
  }
  const articleEnrichment = await enrichPendingArticles(db, env, { limit: ARTICLE_BATCH_DEFAULT });
  return {
    status: 'review_required',
    mode: env.APP_ENV || 'unknown',
    sources: results,
    created: results.reduce((total, result) => total + Number(result.created || 0), 0),
    auto_published: results.reduce((total, result) => total + Number(result.auto_published || 0), 0),
    failed: results.filter((result) => result.status === 'failed').length,
    article_enrichment: articleEnrichment
  };
}

async function enrichPendingArticles(db, env, options = {}) {
  const requestedLimit = Number(options.limit || ARTICLE_BATCH_DEFAULT);
  const limit = Math.min(Math.max(Number.isFinite(requestedLimit) ? Math.floor(requestedLimit) : ARTICLE_BATCH_DEFAULT, 1), ARTICLE_BATCH_MAX);
  const requestedSourceId = Number(options.source_id);
  const sourceId = Number.isInteger(requestedSourceId) && requestedSourceId > 0 ? requestedSourceId : null;
  const requestedRawId = Number(options.raw_id);
  const rawId = Number.isInteger(requestedRawId) && requestedRawId > 0 ? requestedRawId : null;
  const filters = [];
  const filterBindings = [];
  if (sourceId) { filters.push('r.source_id = ?'); filterBindings.push(sourceId); }
  if (rawId) { filters.push('r.id = ?'); filterBindings.push(rawId); }
  const selectionFilter = filters.length ? `AND ${filters.join(' AND ')}` : '';
  const statement = db.prepare(`SELECT r.id AS raw_id, r.title, r.summary AS feed_summary, r.item_url,
      COALESCE(r.article_fetch_attempts, 0) AS article_fetch_attempts, s.category, s.name AS source_name,
      e.id AS extracted_id, e.status, e.report_type, e.area, e.confidence
    FROM raw_items r
    JOIN sources s ON s.id = r.source_id
    JOIN extracted_items e ON e.raw_item_id = r.id
    WHERE e.status IN ('review', 'published')
      AND COALESCE(r.article_fetch_status, 'pending') IN ('pending', 'retry')
      AND COALESCE(r.article_fetch_attempts, 0) < 3
      ${selectionFilter}
    ORDER BY CASE e.status WHEN 'review' THEN 0 ELSE 1 END, COALESCE(r.published_at, r.retrieved_at) DESC
    LIMIT ?`);
  const { results: items } = await statement.bind(...filterBindings, limit).all();
  const result = { status: 'completed', scanned: items.length, enriched: 0, retry: 0, skipped: 0, failed: 0 };
  for (const item of items) {
    const article = await fetchArticleContent(item.item_url, env, fetch, item.title);
    const attempts = Number(item.article_fetch_attempts || 0) + 1;
    const finalStatus = article.status === 'retry' && attempts >= 3 ? 'failed' : article.status;
    const fetchedAt = article.fetchedAt || new Date().toISOString();
    await db.prepare(`UPDATE raw_items SET article_excerpt = ?, article_content_hash = ?, article_fetch_status = ?,
        article_fetched_at = ?, article_published_at = ?, article_modified_at = ?, canonical_url = ?,
        article_extraction_method = ?, article_http_status = ?, article_fetch_attempts = ?, article_error = ?,
        retrieved_at = CASE WHEN ? = 'success' THEN ? ELSE retrieved_at END,
        published_at = CASE WHEN ? = 'success' THEN COALESCE(?, published_at) ELSE published_at END
      WHERE id = ?`)
      .bind(article.excerpt || null, article.contentHash || null, finalStatus, fetchedAt,
        article.publishedAt || null, article.modifiedAt || null, article.canonicalUrl || null,
        article.extractionMethod || null, article.httpStatus || null, attempts, clean(article.error, 200) || null,
        finalStatus, fetchedAt, finalStatus, article.publishedAt || null, item.raw_id).run();
    if (finalStatus === 'success') {
      const extracted = extractItem({ title: item.title, summary: article.excerpt }, item.category);
      const reportType = extracted.reportType === 'other' ? item.report_type : extracted.reportType;
      const area = extracted.area === 'unknown' ? item.area : extracted.area;
      const confidence = Math.max(Number(item.confidence || 0), extracted.confidence);
      const roadStatus = reportType === 'road' ? deriveRoadStatus(`${item.title} ${article.excerpt}`) : 'unknown';
      await db.prepare(`UPDATE extracted_items SET summary = ?, report_type = ?, area = ?, confidence = ?,
          published_at = COALESCE(?, published_at), extraction_method = ?, road_status = ?
        WHERE id = ? AND status = 'review'`)
        .bind(extracted.summary, reportType, area, confidence, article.publishedAt || null, article.extractionMethod, roadStatus, item.extracted_id).run();
      await db.prepare('INSERT INTO audit_events (extracted_item_id, event_type, actor, detail) VALUES (?, ?, ?, ?)')
        .bind(item.extracted_id, 'article_enriched', 'system', `${article.extractionMethod}; excerpt_chars=${article.excerpt.length}; source=${new URL(item.item_url).hostname}`).run();
      result.enriched += 1;
    } else {
      const bucket = finalStatus === 'retry' ? 'retry' : finalStatus === 'skipped' ? 'skipped' : 'failed';
      result[bucket] += 1;
      if (finalStatus !== 'retry') {
        await db.prepare('INSERT INTO audit_events (extracted_item_id, event_type, actor, detail) VALUES (?, ?, ?, ?)')
          .bind(item.extracted_id, 'article_fetch_failed', 'system', `${finalStatus}; ${clean(article.error, 160)}`).run();
      }
    }
  }
  return result;
}

async function approveExistingAutoPublish(db, env) {
  const { results: items } = await db.prepare(`SELECT e.id, e.category, e.report_type, e.confidence, e.latitude, e.longitude,
      e.location_method, r.item_url, r.title, r.summary, r.published_at, s.source_url, s.feed_url, s.access_method
    FROM extracted_items e
    JOIN raw_items r ON r.id = e.raw_item_id
    JOIN sources s ON s.id = r.source_id
    WHERE e.status = 'review'`).all();
  const eligible = items.filter((item) => shouldAutoPublish(
    { category: item.category, source_url: item.source_url, feed_url: item.feed_url, access_method: item.access_method },
    { link: item.item_url, title: item.title, summary: item.summary, publishedAt: item.published_at },
    { reportType: item.report_type, confidence: item.confidence, latitude: item.latitude, longitude: item.longitude, locationMethod: item.location_method },
    env
  ));
  const now = new Date().toISOString();
  const statements = [];
  for (const item of eligible) {
    const validUntil = defaultValidUntil(item.report_type, now);
    const locationPrecision = deriveLocationPrecision(item.location_method, item.latitude, item.longitude, false);
    statements.push(db.prepare(`UPDATE extracted_items
      SET status = 'published', auto_published = 1, expires_at = ?, lifecycle_status = 'active',
          information_class = 'official', location_precision = ?, valid_until = ?, last_changed_at = ?,
          reviewer = 'system-auto', reviewed_at = ?, review_note = '自動公開・未確認。既存レビュー待ちをpolicy-v2の条件で承認。'
      WHERE id = ? AND status = 'review'`).bind(validUntil, locationPrecision, validUntil, now, now, item.id));
    statements.push(db.prepare('INSERT INTO audit_events (extracted_item_id, event_type, actor, detail) VALUES (?, ?, ?, ?)')
      .bind(item.id, 'auto_publish', 'system-auto', `policy-v2; existing-review; lifecycle=active; valid_until=${validUntil}`));
    statements.push(revisionStatement(db, item.id, {
      revisionType: 'published', changedFields: ['lifecycle_status', 'valid_until', 'location_precision'],
      newValues: { lifecycle_status: 'active', valid_until: validUntil, location_precision: locationPrecision },
      actor: 'system-auto', publicNote: '公式情報を条件付きで自動公開しました。', detail: 'policy-v2', createdAt: now
    }));
  }
  if (statements.length) await db.batch(statements);
  return { status: 'review_required', matched: items.length, auto_published: eligible.length, failed: 0 };
}

async function backfillCoarseLocations(db) {
  const { results: items } = await db.prepare(`SELECT e.id, e.latitude, e.longitude, r.title, r.summary
    FROM extracted_items e JOIN raw_items r ON r.id = e.raw_item_id
    WHERE e.status IN ('published', 'review') AND e.latitude IS NULL AND e.longitude IS NULL`).all();
  const statements = [];
  for (const item of items) {
    const location = findCoordinates(`${item.title} ${item.summary || ''}`);
    if (!location) continue;
    statements.push(db.prepare(`UPDATE extracted_items
      SET latitude = ?, longitude = ?, location_method = ?, location_precision = 'representative', last_changed_at = ?
      WHERE id = ? AND latitude IS NULL AND longitude IS NULL`)
      .bind(location.latitude, location.longitude, 'coarse-rule-v1', new Date().toISOString(), item.id));
    statements.push(db.prepare('INSERT INTO audit_events (extracted_item_id, event_type, actor, detail) VALUES (?, ?, ?, ?)')
      .bind(item.id, 'location_backfill', 'system', `coarse-rule-v1; label=${location.label}`));
  }
  if (statements.length) await db.batch(statements);
  return { status: 'completed', scanned: items.length, updated: statements.length / 2 };
}

async function listReviewQueue(db) {
  const { results } = await db.prepare(`SELECT e.*, r.title, r.item_url, r.summary AS source_summary, r.retrieved_at,
      r.article_excerpt, r.article_fetch_status, r.article_fetched_at, r.article_published_at, r.article_modified_at,
      r.canonical_url, r.article_extraction_method, r.article_http_status, r.article_error, s.name AS source_name
    FROM extracted_items e JOIN raw_items r ON r.id = e.raw_item_id JOIN sources s ON s.id = r.source_id
    WHERE e.status = 'review' ORDER BY e.created_at DESC`).all();
  return json({ items: results });
}

async function review(request, db, itemId) {
  const body = await readJson(request);
  const decision = body.decision;
  if (!['publish', 'reject'].includes(decision)) return json({ error: 'validation_error', message: 'decision は publish または reject です。' }, 400);
  const existing = await db.prepare(`SELECT e.*, r.item_url, s.name AS source_name
    FROM extracted_items e JOIN raw_items r ON r.id = e.raw_item_id JOIN sources s ON s.id = r.source_id
    WHERE e.id = ? AND e.status = 'review'`).bind(itemId).first();
  if (!existing) return json({ error: 'review_item_not_found_or_already_reviewed' }, 404);
  const status = decision === 'publish' ? 'published' : 'rejected';
  const reviewer = clean(body.reviewer, 80) || 'human-reviewer';
  const now = new Date().toISOString();
  const latitude = coordinate(body.latitude, -90, 90);
  const longitude = coordinate(body.longitude, -180, 180);
  if ((body.latitude !== '' && body.latitude !== undefined && latitude === null) || (body.longitude !== '' && body.longitude !== undefined && longitude === null)) return json({ error: 'validation_error', message: '緯度・経度は有効な数値で入力してください。' }, 400);
  if ((latitude === null) !== (longitude === null)) return json({ error: 'validation_error', message: '緯度と経度はセットで入力してください。' }, 400);
  const requestedLifecycle = clean(body.lifecycle_status, 30);
  const lifecycleStatus = decision === 'publish' && ['active', 'ongoing', 'resolved'].includes(requestedLifecycle)
    ? requestedLifecycle : decision === 'publish' ? 'active' : 'resolved';
  const requestedPrecision = clean(body.location_precision, 30);
  let locationPrecision = LOCATION_PRECISIONS.has(requestedPrecision)
    ? requestedPrecision : deriveLocationPrecision('human-review', latitude, longitude, true);
  if (latitude === null || longitude === null) locationPrecision = 'unknown';
  if (locationPrecision === 'unknown' && latitude !== null) return json({ error: 'validation_error', message: '位置不明の場合は緯度・経度を空欄にしてください。' }, 400);
  const requestedValidUntil = normalizeFutureTimestamp(body.valid_until, now);
  if (body.valid_until && !requestedValidUntil) return json({ error: 'validation_error', message: '有効期限は現在より後の日時を指定してください。' }, 400);
  const validUntil = decision === 'publish' ? (requestedValidUntil || defaultValidUntil(existing.report_type, now)) : null;
  const result = await db.prepare(`UPDATE extracted_items
    SET status = ?, lifecycle_status = ?, location_precision = ?, last_verified_at = ?, valid_until = ?, expires_at = ?,
        last_changed_at = ?, reviewer = ?, reviewed_at = ?, review_note = ?, latitude = ?, longitude = ?,
        location_method = CASE WHEN ? IS NULL THEN NULL ELSE 'human-reviewed-point' END
    WHERE id = ? AND status = 'review'`)
    .bind(status, lifecycleStatus, locationPrecision, decision === 'publish' ? now : null, validUntil, validUntil,
      now, reviewer, now, clean(body.note, 500), latitude, longitude, latitude, itemId).run();
  if (!result.meta.changes) return json({ error: 'review_item_not_found_or_already_reviewed' }, 404);
  await db.prepare('INSERT INTO audit_events (extracted_item_id, event_type, actor, detail) VALUES (?, ?, ?, ?)')
    .bind(itemId, decision, reviewer, clean(body.note, 500)).run();
  await addRevision(db, itemId, {
    revisionType: decision === 'publish' ? 'published' : 'status_change',
    changedFields: ['status', 'lifecycle_status', 'location_precision', 'last_verified_at', 'valid_until', 'latitude', 'longitude'],
    previousValues: trustSnapshot(existing),
    newValues: { status, lifecycle_status: lifecycleStatus, location_precision: locationPrecision, last_verified_at: decision === 'publish' ? now : null, valid_until: validUntil, latitude, longitude },
    actor: reviewer,
    publicNote: clean(body.public_note, 240) || (decision === 'publish' ? '原文を確認して公開しました。' : null),
    detail: clean(body.note, 500), createdAt: now
  });
  return json({ id: itemId, status, lifecycle_status: lifecycleStatus, location_precision: locationPrecision, valid_until: validUntil, reviewed_at: now });
}

async function listReports(db) {
  return json({ reports: await publishedReports(db) });
}

async function listAdminReports(db) {
  const { results } = await db.prepare(`SELECT e.*, r.title, r.item_url, r.retrieved_at,
      s.name AS source_name, (SELECT COUNT(*) FROM report_revisions rr WHERE rr.extracted_item_id = e.id) AS revision_count
    FROM extracted_items e
    JOIN raw_items r ON r.id = e.raw_item_id
    JOIN sources s ON s.id = r.source_id
    WHERE e.status IN ('published', 'expired', 'rejected')
    ORDER BY COALESCE(e.last_changed_at, e.reviewed_at, e.created_at) DESC
    LIMIT 150`).all();
  return json({ items: results });
}

async function updateReportState(request, db, itemId) {
  const body = await readJson(request);
  const existing = await db.prepare(`SELECT e.*, r.item_url, s.name AS source_name
    FROM extracted_items e JOIN raw_items r ON r.id = e.raw_item_id JOIN sources s ON s.id = r.source_id
    WHERE e.id = ?`).bind(itemId).first();
  if (!existing) return json({ error: 'report_not_found' }, 404);
  const lifecycleStatus = clean(body.lifecycle_status, 30);
  if (!LIFECYCLE_STATUSES.has(lifecycleStatus)) return json({ error: 'validation_error', message: '有効な状態を選択してください。' }, 400);
  const informationClass = body.information_class === undefined
    ? normalizeInformationClass(existing.information_class, existing.category, false)
    : clean(body.information_class, 30);
  if (!INFORMATION_CLASSES.has(informationClass)) return json({ error: 'validation_error', message: '有効な情報区分を選択してください。' }, 400);
  const locationPrecision = body.location_precision === undefined
    ? normalizeLocationPrecision(existing.location_precision, existing.location_method, existing.latitude, existing.longitude)
    : clean(body.location_precision, 30);
  if (!LOCATION_PRECISIONS.has(locationPrecision)) return json({ error: 'validation_error', message: '有効な位置精度を選択してください。' }, 400);
  if (locationPrecision !== 'unknown' && (!Number.isFinite(Number(existing.latitude)) || !Number.isFinite(Number(existing.longitude)))) {
    return json({ error: 'validation_error', message: '座標がない情報の位置精度は「位置不明」にしてください。' }, 400);
  }
  const now = new Date().toISOString();
  const requestedValidUntil = body.valid_until ? normalizeFutureTimestamp(body.valid_until, now) : null;
  if (body.valid_until && !requestedValidUntil && ['active', 'ongoing'].includes(lifecycleStatus)) {
    return json({ error: 'validation_error', message: '発生中・継続の有効期限は現在より後にしてください。' }, 400);
  }
  const validUntil = ['active', 'ongoing'].includes(lifecycleStatus)
    ? (requestedValidUntil || normalizeFutureTimestamp(existing.valid_until, now) || defaultValidUntil(existing.report_type, now))
    : (body.valid_until ? normalizeTimestamp(body.valid_until) : existing.valid_until);
  const workflowStatus = lifecycleStatus === 'needs_review' ? 'review' : lifecycleStatus === 'expired' ? 'expired' : 'published';
  const reviewer = clean(body.reviewer, 80) || 'admin-console';
  const publicNote = clean(body.public_note, 240) || lifecyclePublicNote(lifecycleStatus);
  const internalNote = clean(body.note, 500);
  const latitude = locationPrecision === 'unknown' ? null : existing.latitude;
  const longitude = locationPrecision === 'unknown' ? null : existing.longitude;
  const previousValues = trustSnapshot(existing);
  const newValues = {
    status: workflowStatus, lifecycle_status: lifecycleStatus, information_class: informationClass,
    location_precision: locationPrecision, last_verified_at: lifecycleStatus === 'needs_review' ? null : now,
    valid_until: validUntil, latitude, longitude
  };
  const changedFields = Object.keys(newValues).filter((key) => String(previousValues[key] ?? '') !== String(newValues[key] ?? ''));
  if (!changedFields.length && !internalNote && !body.public_note) return json({ error: 'no_changes', message: '変更内容がありません。' }, 400);
  await db.prepare(`UPDATE extracted_items SET status = ?, lifecycle_status = ?, information_class = ?, location_precision = ?,
      last_verified_at = ?, valid_until = ?, expires_at = ?, last_changed_at = ?, reviewer = ?, reviewed_at = ?,
      review_note = ?, latitude = ?, longitude = ? WHERE id = ?`)
    .bind(workflowStatus, lifecycleStatus, informationClass, locationPrecision,
      lifecycleStatus === 'needs_review' ? null : now, validUntil, validUntil, now, reviewer, now,
      internalNote || existing.review_note, latitude, longitude, itemId).run();
  await db.prepare('INSERT INTO audit_events (extracted_item_id, event_type, actor, detail) VALUES (?, ?, ?, ?)')
    .bind(itemId, 'trust_metadata_update', reviewer, `${changedFields.join(',')}; ${internalNote}`).run();
  await addRevision(db, itemId, {
    revisionType: changedFields.includes('lifecycle_status') ? 'status_change' : 'correction',
    changedFields, previousValues, newValues, actor: reviewer, publicNote, detail: internalNote, createdAt: now
  });
  return json({ id: itemId, ...newValues, changed_fields: changedFields, updated_at: now });
}

async function publicReportHistory(db, itemId) {
  const visible = await db.prepare(`SELECT e.id FROM extracted_items e
    WHERE e.id = ? AND e.status IN ('published', 'expired', 'review')`)
    .bind(itemId).first();
  if (!visible) return json({ error: 'report_not_found' }, 404);
  const { results } = await db.prepare(`SELECT revision_type, changed_fields, public_note, created_at
    FROM report_revisions WHERE extracted_item_id = ? ORDER BY created_at DESC, id DESC LIMIT 50`).bind(itemId).all();
  return json({ item_id: itemId, revisions: results.map((entry) => ({
    revision_type: entry.revision_type,
    changed_fields: parseJsonList(entry.changed_fields),
    note: entry.public_note || revisionPublicLabel(entry.revision_type),
    created_at: entry.created_at
  })) });
}

async function adminReportHistory(db, itemId) {
  const { results } = await db.prepare(`SELECT id, revision_type, changed_fields, previous_values, new_values,
      actor, public_note, detail, created_at FROM report_revisions
    WHERE extracted_item_id = ? ORDER BY created_at DESC, id DESC LIMIT 100`).bind(itemId).all();
  return json({ item_id: itemId, revisions: results.map((entry) => ({
    ...entry, changed_fields: parseJsonList(entry.changed_fields),
    previous_values: parseJsonObject(entry.previous_values), new_values: parseJsonObject(entry.new_values)
  })) });
}

async function refreshLifecycleStatuses(db, limit = 200) {
  const now = new Date().toISOString();
  const { results } = await db.prepare(`SELECT id, status, lifecycle_status, valid_until, expires_at
    FROM extracted_items
    WHERE status = 'published' AND lifecycle_status IN ('active', 'ongoing')
      AND COALESCE(valid_until, expires_at) IS NOT NULL
      AND datetime(COALESCE(valid_until, expires_at)) <= datetime('now')
    ORDER BY COALESCE(valid_until, expires_at) LIMIT ?`).bind(limit).all();
  if (!results.length) return { status: 'completed', expired: 0 };
  const statements = [];
  for (const item of results) {
    statements.push(db.prepare(`UPDATE extracted_items
      SET status = 'expired', lifecycle_status = 'expired', last_changed_at = ?
      WHERE id = ? AND status = 'published'`).bind(now, item.id));
    statements.push(db.prepare('INSERT INTO audit_events (extracted_item_id, event_type, actor, detail) VALUES (?, ?, ?, ?)')
      .bind(item.id, 'expired', 'system-lifecycle', `valid_until=${item.valid_until || item.expires_at}`));
    statements.push(revisionStatement(db, item.id, {
      revisionType: 'expiry', changedFields: ['status', 'lifecycle_status'],
      previousValues: { status: item.status, lifecycle_status: item.lifecycle_status },
      newValues: { status: 'expired', lifecycle_status: 'expired' }, actor: 'system-lifecycle',
      publicNote: '有効期限を過ぎたため、期限切れになりました。', detail: 'scheduled-expiry', createdAt: now
    }));
  }
  await db.batch(statements);
  return { status: 'completed', expired: results.length };
}

async function currentWeather() {
  const endpoint = new URL('https://api.open-meteo.com/v1/forecast');
  endpoint.search = new URLSearchParams({
    latitude: '32.8031',
    longitude: '130.7079',
    current: 'temperature_2m,precipitation,wind_speed_10m',
    timezone: 'Asia/Tokyo',
    timeformat: 'unixtime',
    forecast_days: '1'
  }).toString();
  let response;
  try {
    response = await fetch(endpoint, {
      headers: { accept: 'application/json', 'user-agent': 'MamoruMap/1.0 (+https://mamoru-map-api.krin6525.workers.dev/)' },
      signal: AbortSignal.timeout(8_000),
      cf: { cacheEverything: true, cacheTtl: 600 }
    });
  } catch {
    return json({ error: 'weather_fetch_failed', message: '現在の気象情報を取得できませんでした。' }, 502);
  }
  if (!response.ok) return json({ error: 'weather_source_error', status: response.status }, 502);
  let source;
  try { source = await response.json(); } catch { return json({ error: 'weather_invalid_json' }, 502); }
  const weather = normalizeOpenMeteo(source);
  if (!weather) return json({ error: 'weather_invalid_payload' }, 502);
  return new Response(JSON.stringify(weather), { headers: {
    ...JSON_HEADERS,
    'cache-control': 'public, max-age=300, s-maxage=600',
    'x-content-type-options': 'nosniff'
  } });
}

function normalizeOpenMeteo(source) {
  const current = source?.current;
  const units = source?.current_units;
  const observedEpoch = Number(current?.time);
  const temperature = finiteNumber(current?.temperature_2m);
  const precipitation = finiteNumber(current?.precipitation);
  const windSpeed = finiteNumber(current?.wind_speed_10m);
  if (!Number.isFinite(observedEpoch) || temperature === null || precipitation === null || windSpeed === null) return null;
  return {
    location: { name: '熊本市中心部', latitude: Number(source.latitude), longitude: Number(source.longitude) },
    observed_at: new Date(observedEpoch * 1000).toISOString(),
    interval_seconds: Number(current.interval) || null,
    temperature_2m: { value: temperature, unit: String(units?.temperature_2m || '°C') },
    precipitation: { value: precipitation, unit: String(units?.precipitation || 'mm') },
    wind_speed_10m: { value: windSpeed, unit: String(units?.wind_speed_10m || 'km/h') },
    model_timezone: String(source.timezone || 'Asia/Tokyo'),
    source: {
      name: 'Open-Meteo',
      url: 'https://open-meteo.com/',
      licence: 'CC BY 4.0',
      licence_url: 'https://creativecommons.org/licenses/by/4.0/'
    },
    notice: 'モデルによる参考値です。避難判断には気象庁・自治体の発表を優先してください。'
  };
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

async function listArchiveReports(db) {
  const reports = await archivedReports(db);
  return json({
    reports,
    meta: {
      historical: true,
      timezone: 'Asia/Tokyo',
      reference_policy: 'source_metadata_only',
      reference_notice: '報道・参考情報は未確認です。内容は必ずリンク先の原文で確認してください。'
    }
  });
}

async function publishedReports(db) {
  const { results } = await db.prepare(`SELECT e.id, e.category, e.report_type, e.area, e.summary, e.published_at, e.latitude, e.longitude, e.location_method,
      e.extraction_method, e.reviewer, e.reviewed_at, e.auto_published, e.expires_at,
      e.lifecycle_status, e.information_class, e.location_precision, e.last_verified_at, e.valid_until, e.last_changed_at,
      e.road_status, e.road_observed_at,
      r.retrieved_at, r.title, r.item_url, s.name AS source_name,
      (SELECT COUNT(*) FROM report_revisions rr WHERE rr.extracted_item_id = e.id) AS revision_count,
      (SELECT MAX(rr.created_at) FROM report_revisions rr WHERE rr.extracted_item_id = e.id) AS last_revision_at
    FROM extracted_items e JOIN raw_items r ON r.id = e.raw_item_id JOIN sources s ON s.id = r.source_id
    WHERE e.status = 'published' AND e.lifecycle_status IN ('active', 'ongoing')
      AND (e.valid_until IS NULL OR datetime(e.valid_until) > datetime('now'))
    ORDER BY COALESCE(e.published_at, e.created_at) DESC LIMIT 500`).all();
  return results.map(sanitizePublishedReport);
}

async function archivedReports(db) {
  const { results } = await db.prepare(`SELECT e.id, e.category, e.report_type, e.area, e.summary,
      COALESCE(e.published_at, r.published_at, r.retrieved_at) AS published_at,
      e.latitude, e.longitude, e.location_method, e.auto_published, e.expires_at,
      e.lifecycle_status, e.information_class, e.location_precision, e.last_verified_at, e.valid_until, e.last_changed_at,
      e.road_status, e.road_observed_at,
      r.retrieved_at, r.title, r.item_url, s.name AS source_name, e.status AS record_status,
      (SELECT COUNT(*) FROM report_revisions rr WHERE rr.extracted_item_id = e.id) AS revision_count,
      (SELECT MAX(rr.created_at) FROM report_revisions rr WHERE rr.extracted_item_id = e.id) AS last_revision_at
    FROM extracted_items e
    JOIN raw_items r ON r.id = e.raw_item_id
    JOIN sources s ON s.id = r.source_id
    WHERE e.status IN ('published', 'expired', 'review')
    ORDER BY COALESCE(e.published_at, r.published_at, r.retrieved_at, e.created_at) DESC
    LIMIT 2000`).all();
  return results.map(sanitizeArchiveReport);
}

function sanitizeArchiveReport(report) {
  const reference = report.record_status === 'review';
  const verificationStatus = reference
    ? 'reference_unverified'
    : report.auto_published ? 'auto_unverified' : 'verified';
  const safeReport = {
    id: report.id,
    category: report.category,
    report_type: report.report_type,
    area: report.area,
    summary: reference ? '報道・参考情報です。内容はリンク先の原文で確認してください。' : report.summary,
    published_at: report.published_at,
    latitude: report.latitude,
    longitude: report.longitude,
    location_method: report.location_method,
    auto_published: Boolean(report.auto_published),
    expires_at: report.expires_at,
    lifecycle_status: normalizeLifecycleStatus(report.lifecycle_status, report.record_status),
    information_class: normalizeInformationClass(report.information_class, report.category, reference),
    location_precision: normalizeLocationPrecision(report.location_precision, report.location_method, report.latitude, report.longitude),
    last_verified_at: report.last_verified_at,
    valid_until: report.valid_until || report.expires_at,
    last_changed_at: report.last_changed_at || report.last_revision_at || report.retrieved_at,
    revision_count: Number(report.revision_count || 0),
    retrieved_at: report.retrieved_at,
    title: report.title,
    item_url: report.item_url,
    source_name: report.source_name,
    verification_status: verificationStatus
  };
  return { ...safeReport, road_status: normalizeRoadStatus(report.road_status), road_observed_at: report.road_observed_at, ...deriveEventMetadata(safeReport), priority: reportPriority(safeReport) };
}

function sanitizePublishedReport(report) {
  const safeReport = {
    ...report,
    auto_published: Boolean(report.auto_published),
    lifecycle_status: normalizeLifecycleStatus(report.lifecycle_status, 'published'),
    information_class: normalizeInformationClass(report.information_class, report.category, false),
    location_precision: normalizeLocationPrecision(report.location_precision, report.location_method, report.latitude, report.longitude),
    valid_until: report.valid_until || report.expires_at,
    last_changed_at: report.last_changed_at || report.last_revision_at || report.retrieved_at,
    revision_count: Number(report.revision_count || 0),
    verification_status: report.auto_published ? 'auto_unverified' : 'verified',
    road_status: normalizeRoadStatus(report.road_status),
    road_observed_at: report.road_observed_at
  };
  return { ...safeReport, ...deriveEventMetadata(safeReport), priority: reportPriority(safeReport) };
}

async function downloadReportsGeoJson(db) {
  const body = JSON.stringify(reportsToGeoJson(await publishedReports(db)));
  return new Response(body, { headers: {
    'content-type': 'application/geo+json; charset=utf-8',
    'content-disposition': 'attachment; filename="mamoru-map-reports.geojson"',
    'cache-control': 'public, max-age=60'
  } });
}

async function downloadReportsCsv(db) {
  const body = `\uFEFF${reportsToCsv(await publishedReports(db))}`;
  return new Response(body, { headers: {
    'content-type': 'text/csv; charset=utf-8',
    'content-disposition': 'attachment; filename="mamoru-map-reports.csv"',
    'cache-control': 'public, max-age=60'
  } });
}

function reportsToGeoJson(reports) {
  return {
    type: 'FeatureCollection',
    features: reports.filter(hasReportCoordinates).map((report) => ({
      type: 'Feature',
      id: report.id,
      geometry: { type: 'Point', coordinates: [Number(report.longitude), Number(report.latitude)] },
      properties: {
        id: report.id, title: report.title, summary: report.summary, area: report.area, category: report.category,
        report_type: report.report_type, priority: report.priority || reportPriority(report), published_at: report.published_at,
        retrieved_at: report.retrieved_at, source_name: report.source_name, item_url: report.item_url,
        location_method: report.location_method, location_precision: report.location_precision,
        lifecycle_status: report.lifecycle_status, information_class: report.information_class,
        last_verified_at: report.last_verified_at, valid_until: report.valid_until,
        road_status: report.road_status, road_observed_at: report.road_observed_at,
        event_key: report.event_key, event_name: report.event_name, event_kind: report.event_kind,
        revision_count: Number(report.revision_count || 0), auto_published: Boolean(report.auto_published)
      }
    }))
  };
}

function hasReportCoordinates(report) {
  if (report.latitude === null || report.latitude === undefined || report.latitude === ''
    || report.longitude === null || report.longitude === undefined || report.longitude === '') return false;
  const latitude = Number(report.latitude);
  const longitude = Number(report.longitude);
  return Number.isFinite(latitude) && latitude >= -90 && latitude <= 90
    && Number.isFinite(longitude) && longitude >= -180 && longitude <= 180;
}

function reportsToCsv(reports) {
  const columns = ['id', 'priority', 'report_type', 'lifecycle_status', 'information_class', 'area', 'title', 'summary',
    'published_at', 'retrieved_at', 'last_verified_at', 'valid_until', 'source_name', 'item_url',
    'latitude', 'longitude', 'location_method', 'location_precision', 'road_status', 'road_observed_at',
    'event_key', 'event_name', 'event_kind', 'revision_count'];
  const rows = reports.map((report) => columns.map((column) => csvCell(report[column])).join(','));
  return [columns.join(','), ...rows].join('\r\n');
}

function csvCell(value) {
  let text = String(value ?? '');
  if (/^[=+\-@]/.test(text)) text = `'${text}`;
  return `"${text.replace(/"/g, '""')}"`;
}

function reportPriority(report) {
  const text = `${report.title || ''} ${report.summary || ''}`;
  if (/救助|行方不明|閉じ込め|生き埋め|倒壊|火災|大津波警報|緊急安全確保/.test(text)) return 'emergency';
  if (/避難指示|津波警報|土砂災害|通行止め|停電|断水|震度[67]/.test(text) || ['warning', 'damage'].includes(report.report_type)) return 'high';
  return 'medium';
}

function extractItem(item, category) {
  const text = `${item.title} ${item.summary}`;
  const rules = [['shelter', /避難所|避難場所|開設/], ['road', /通行止め|道路|通行規制|迂回/], ['warning', /警報|注意報|土砂災害|津波/], ['damage', /被害|倒壊|浸水|停電|断水/], ['support', /支援|物資|ボランティア|受入/]];
  const match = rules.find(([, pattern]) => pattern.test(text));
  return { reportType: match?.[0] || 'other', area: findArea(text), summary: trim(text, 280), confidence: match ? (category === 'official' ? 0.82 : 0.68) : 0.35 };
}

function shouldAutoPublish(source, item, extracted, env) {
  const enabled = String(env?.AUTO_PUBLISH_ENABLED || '').toLowerCase() === 'true';
  const minimumConfidence = Number(env?.AUTO_PUBLISH_MIN_CONFIDENCE || 0.82);
  const publishedTime = Date.parse(item?.publishedAt || '');
  const age = Date.now() - publishedTime;
  const freshPublication = Number.isFinite(publishedTime) && age >= -30 * 60 * 1000 && age <= 24 * 60 * 60 * 1000;
  const text = `${item?.title || ''} ${item?.summary || ''}`;
  const highImpact = /救助要請|救助依頼|行方不明|閉じ込め|生き埋め|緊急安全確保|避難指示|高齢者等避難|通行止め|通行可否|孤立/.test(text);
  const locationPrecision = deriveLocationPrecision(extracted.locationMethod, extracted.latitude, extracted.longitude, false);
  return enabled
    && source.category === 'official'
    && ['shelter', 'damage', 'road', 'warning', 'support'].includes(extracted.reportType)
    && extracted.confidence >= minimumConfidence
    && freshPublication
    && !highImpact
    && locationPrecision !== 'unknown'
    && validUrl(item.link)
    && sameHost(source.source_url, item.link)
    && sameHost(source.source_url, source.feed_url)
    && allowedHost(source.feed_url, env.ALLOWED_SOURCE_HOSTS);
}

function deriveInformationClass(source) {
  if (source?.category === 'official') return 'official';
  if (['geojson', 'toyota_vics'].includes(source?.access_method)) return 'reference';
  return 'media';
}

function deriveLocationPrecision(locationMethod, latitude, longitude, humanVerified = false) {
  if (latitude === null || latitude === undefined || latitude === '' || longitude === null || longitude === undefined || longitude === ''
    || !Number.isFinite(Number(latitude)) || !Number.isFinite(Number(longitude))) return 'unknown';
  if (humanVerified || locationMethod === 'human-reviewed-point') return 'exact';
  if (locationMethod === 'coarse-rule-v1') return 'representative';
  return 'estimated';
}

function defaultValidityHours(reportType) {
  return ({ warning: 12, road: 24, shelter: 24, support: 72, damage: 168, other: 24 })[reportType] || 24;
}

function defaultValidUntil(reportType, from = new Date().toISOString()) {
  const timestamp = Date.parse(from);
  const base = Number.isFinite(timestamp) ? timestamp : Date.now();
  return new Date(base + defaultValidityHours(reportType) * 60 * 60 * 1000).toISOString();
}

function locationFields(text) {
  const location = findCoordinates(text);
  return location ? { latitude: location.latitude, longitude: location.longitude, locationMethod: 'coarse-rule-v1' } : { latitude: null, longitude: null, locationMethod: null };
}

function findCoordinates(text) {
  const locations = [
    ['熊本市', 32.8031, 130.7079],
    ['益城町', 32.7909, 130.8175],
    ['西原村', 32.8338, 130.9022],
    ['南阿蘇村', 32.8211, 131.0684],
    ['大津町', 32.8775, 130.8662],
    ['菊陽町', 32.8616, 130.8285],
    ['宇城市', 32.6462, 130.6847]
  ];
  const match = locations.find(([label]) => text.includes(label));
  if (match) return { label: match[0], latitude: match[1], longitude: match[2] };
  const prefecture = PREFECTURE_CENTERS.find(([label]) => String(text || '').includes(label));
  return prefecture ? { label: prefecture[0], latitude: prefecture[1], longitude: prefecture[2] } : null;
}

function isInJapan(latitude, longitude) {
  return Number.isFinite(Number(latitude)) && Number.isFinite(Number(longitude))
    && Number(latitude) >= 20 && Number(latitude) <= 46.5
    && Number(longitude) >= 122 && Number(longitude) <= 154.5;
}

function nearestPrefecture(latitude, longitude) {
  if (!isInJapan(latitude, longitude)) return 'unknown';
  let nearest = null;
  for (const [label, centerLatitude, centerLongitude] of PREFECTURE_CENTERS) {
    const latitudeScale = Math.cos((Number(latitude) * Math.PI) / 180);
    const distance = ((Number(latitude) - centerLatitude) ** 2)
      + (((Number(longitude) - centerLongitude) * latitudeScale) ** 2);
    if (!nearest || distance < nearest.distance) nearest = { label, distance };
  }
  return nearest?.label || 'unknown';
}

async function fetchArticleContent(value, env, fetchImpl = fetch, expectedTitle = '') {
  const fetchedAt = new Date().toISOString();
  const url = articleUrlAllowed(value, env?.ARTICLE_SOURCE_HOSTS);
  if (!url) return { status: 'skipped', fetchedAt, error: 'article_url_not_allowed' };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8_000);
  let response;
  try {
    response = await fetchImpl(url, {
      redirect: 'follow',
      signal: controller.signal,
      headers: { accept: 'text/html,application/xhtml+xml,application/xml,text/xml,text/plain;q=0.8,*/*;q=0.1' }
    });
  } catch (error) {
    clearTimeout(timeout);
    return { status: 'retry', fetchedAt, error: error?.name === 'AbortError' ? 'article_fetch_timeout' : 'article_fetch_error' };
  }
  const httpStatus = response.status;
  if (httpStatus === 429 || httpStatus >= 500) { clearTimeout(timeout); return { status: 'retry', fetchedAt, httpStatus, error: `article_http_${httpStatus}` }; }
  if (!response.ok) { clearTimeout(timeout); return { status: 'failed', fetchedAt, httpStatus, error: `article_http_${httpStatus}` }; }
  const finalUrl = articleUrlAllowed(response.url || url, env?.ARTICLE_SOURCE_HOSTS);
  if (!finalUrl) { clearTimeout(timeout); return { status: 'skipped', fetchedAt, httpStatus, error: 'article_redirect_not_allowed' }; }
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  if (contentType && !/(?:html|xml|text\/plain)/.test(contentType)) {
    clearTimeout(timeout);
    return { status: 'skipped', fetchedAt, httpStatus, error: 'article_content_type_not_supported' };
  }
  let body;
  try {
    body = await readResponseTextLimited(response, ARTICLE_MAX_BYTES, contentType);
  } catch (error) {
    clearTimeout(timeout);
    return { status: 'failed', fetchedAt, httpStatus, error: error?.message === 'article_too_large' ? 'article_too_large' : 'article_body_read_failed' };
  }
  clearTimeout(timeout);
  const extracted = extractArticleDocument(body, contentType, finalUrl);
  if (!extracted.excerpt) return { status: 'failed', fetchedAt, httpStatus, error: extracted.error || 'article_text_not_found' };
  if (expectedTitle && extracted.title && !articleTitleMatches(expectedTitle, extracted.title)) {
    return { status: 'skipped', fetchedAt, httpStatus, error: 'article_title_mismatch' };
  }
  return {
    status: 'success',
    fetchedAt,
    httpStatus,
    ...extracted,
    contentHash: await sha256(`${extracted.excerpt}:${extracted.publishedAt || ''}:${extracted.modifiedAt || ''}`)
  };
}

async function readResponseTextLimited(response, maxBytes, contentType = '') {
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > maxBytes) throw new Error('article_too_large');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new Error('article_too_large');
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const charset = contentType.match(/charset\s*=\s*["']?([^;"'\s]+)/i)?.[1] || 'utf-8';
  try { return new TextDecoder(charset).decode(bytes); } catch { return new TextDecoder('utf-8').decode(bytes); }
}

function extractArticleDocument(body, contentType = '', sourceUrl = '') {
  const pageTitle = decode(body.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.replace(/<[^>]+>/g, ' ') || '');
  if (/^Warmup Page$/i.test(normalizeArticleText(pageTitle))) return { error: 'warmup_page' };
  const isXml = /xml/.test(contentType) || /^\s*<\?xml\b/i.test(body);
  if (isXml) return extractXmlArticle(body, sourceUrl);

  const records = extractJsonLdRecords(body);
  const article = records.find((record) => jsonLdTypes(record).some((type) => /^(?:NewsArticle|Article|Report|LiveBlogPosting)$/i.test(type))) || {};
  const articleBody = stringValue(article.articleBody);
  const description = stringValue(article.description) || metaContent(body, 'og:description') || metaContent(body, 'description');
  const title = normalizeArticleText(stringValue(article.headline) || metaContent(body, 'og:title') || pageTitle);
  const fallback = extractMainHtmlText(body);
  const text = normalizeArticleText(articleBody || description || fallback);
  if (text.length < 20) return { error: 'article_text_not_found' };
  const canonicalCandidate = stringValue(article.url)
    || stringValue(article.mainEntityOfPage?.['@id'])
    || stringValue(article.mainEntityOfPage)
    || canonicalLink(body)
    || sourceUrl;
  const canonicalUrl = validUrl(canonicalCandidate) || sourceUrl;
  const extractionMethod = articleBody ? 'article-jsonld-body-v1' : description ? 'article-description-v1' : 'article-html-main-v1';
  return {
    excerpt: excerptArticleText(text, ARTICLE_EXCERPT_MAX),
    title,
    publishedAt: normalizeTimestamp(article.datePublished || metaContent(body, 'article:published_time')),
    modifiedAt: normalizeTimestamp(article.dateModified || metaContent(body, 'article:modified_time')),
    canonicalUrl,
    extractionMethod
  };
}

function extractXmlArticle(xml, sourceUrl) {
  const tags = ['Headline', 'Text', 'Description', 'Comment', 'FreeFormComment'];
  const pieces = tags.flatMap((tag) => [...xml.matchAll(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'gi'))]
    .map((match) => normalizeArticleText(decode(match[1].replace(/<[^>]+>/g, ' '))))
    .filter(Boolean));
  const text = [...new Set(pieces)].join(' ');
  if (text.length < 10) return { error: 'article_text_not_found' };
  const publishedAt = normalizeTimestamp(textTag(xml, 'ReportDateTime') || textTag(xml, 'TargetDateTime'));
  return {
    excerpt: excerptArticleText(text, ARTICLE_EXCERPT_MAX),
    title: normalizeArticleText(decode(textTag(xml, 'Title'))),
    publishedAt,
    modifiedAt: null,
    canonicalUrl: sourceUrl,
    extractionMethod: 'article-xml-v1'
  };
}

function extractJsonLdRecords(html) {
  const records = [];
  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      const parsed = JSON.parse(match[1].replace(/^\s*<!--|-->\s*$/g, '').trim());
      const roots = Array.isArray(parsed) ? parsed : [parsed];
      for (const root of roots) {
        if (root && typeof root === 'object') records.push(root, ...(Array.isArray(root['@graph']) ? root['@graph'] : []));
      }
    } catch { /* Ignore malformed publisher metadata and continue with HTML fallbacks. */ }
  }
  return records;
}

function jsonLdTypes(record) { return (Array.isArray(record?.['@type']) ? record['@type'] : [record?.['@type']]).filter(Boolean).map(String); }
function stringValue(value) { return typeof value === 'string' ? value : ''; }
function htmlAttribute(tag, name) { return decode(tag.match(new RegExp(`\\b${name}\\s*=\\s*["']([^"']*)["']`, 'i'))?.[1] || ''); }
function metaContent(html, name) {
  for (const match of html.matchAll(/<meta\b[^>]*>/gi)) {
    const tag = match[0];
    const key = htmlAttribute(tag, 'property') || htmlAttribute(tag, 'name');
    if (key.toLowerCase() === name.toLowerCase()) return htmlAttribute(tag, 'content');
  }
  return '';
}
function canonicalLink(html) {
  for (const match of html.matchAll(/<link\b[^>]*>/gi)) {
    const tag = match[0];
    if (htmlAttribute(tag, 'rel').toLowerCase().split(/\s+/).includes('canonical')) return htmlAttribute(tag, 'href');
  }
  return '';
}
function extractMainHtmlText(html) {
  const container = html.match(/<article\b[^>]*>([\s\S]*?)<\/article>/i)?.[1]
    || html.match(/<main\b[^>]*>([\s\S]*?)<\/main>/i)?.[1]
    || html.match(/<body\b[^>]*>([\s\S]*?)<\/body>/i)?.[1]
    || '';
  return normalizeArticleText(decode(container
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<(?:script|style|noscript|svg|nav|header|footer|aside|form|dialog)\b[\s\S]*?<\/(?:script|style|noscript|svg|nav|header|footer|aside|form|dialog)>/gi, ' ')
    .replace(/<(?:br|p|div|section|li|h[1-6]|tr)\b[^>]*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')));
}
function normalizeArticleText(value) { return String(value || '').replace(/[\u200B-\u200D\uFEFF]/g, '').replace(/\s+/g, ' ').trim(); }
function excerptArticleText(value, max) {
  const text = normalizeArticleText(value);
  if (text.length <= max) return text;
  const slice = text.slice(0, max + 1);
  const sentenceEnd = Math.max(slice.lastIndexOf('。'), slice.lastIndexOf('！'), slice.lastIndexOf('？'));
  return (sentenceEnd >= Math.floor(max * 0.55) ? slice.slice(0, sentenceEnd + 1) : slice.slice(0, max)).trim();
}

function articleTitleMatches(expected, actual) {
  const normalize = (value) => normalizeArticleText(value).toLocaleLowerCase('ja').replace(/[\s\p{P}\p{S}]/gu, '');
  const expectedText = normalize(expected);
  const actualText = normalize(actual);
  if (!expectedText || !actualText || expectedText.length < 6) return true;
  if (actualText.includes(expectedText) || expectedText.includes(actualText)) return true;
  const grams = (value) => new Set(Array.from({ length: Math.max(value.length - 2, 0) }, (_, index) => value.slice(index, index + 3)));
  const expectedGrams = grams(expectedText);
  const actualGrams = grams(actualText);
  if (!expectedGrams.size) return true;
  const overlap = [...expectedGrams].filter((gram) => actualGrams.has(gram)).length;
  return overlap / expectedGrams.size >= 0.4;
}

function articleUrlAllowed(value, allowlist) {
  const normalized = validDiscoverySourceUrl(value);
  if (!normalized || !allowedHost(normalized, allowlist)) return null;
  const hostname = new URL(normalized).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (hostname === 'localhost' || hostname.endsWith('.local') || hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') return null;
  const ipv4 = hostname.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/)?.slice(1).map(Number);
  if (ipv4 && (ipv4.some((part) => part > 255) || ipv4[0] === 10 || ipv4[0] === 127 || ipv4[0] === 0
    || (ipv4[0] === 169 && ipv4[1] === 254) || (ipv4[0] === 172 && ipv4[1] >= 16 && ipv4[1] <= 31)
    || (ipv4[0] === 192 && ipv4[1] === 168))) return null;
  return normalized;
}

function parseSourcePayload(value, accessMethod, sourceUrl, contentType = '') {
  if (accessMethod === 'geojson') return parseGeoJsonFeed(value);
  if (accessMethod === 'toyota_vics') return parseToyotaVics(value, sourceUrl);
  if (accessMethod === 'html') return parseHtmlMedia(value, sourceUrl, contentType);
  return parseFeed(value);
}

function parseToyotaVics(value, _sourceUrl) {
  let document;
  try { document = JSON.parse(value); } catch { return []; }
  if (!Array.isArray(document?.results)) return [];
  const officialPage = 'https://www.toyota.co.jp/jpn/auto/passable_route/map/';
  return document.results.flatMap((record) => {
    const latitude = coordinate(record?.Lat, -90, 90);
    const longitude = coordinate(record?.Lon, -180, 180);
    if (!isInJapan(latitude, longitude)) return [];
    const regulation = trim([record.RegulationName, record.RegulationDetailName].filter((part) => part && part !== '詳細無し').join('・') || '交通規制', 100);
    const cause = trim([record.CauseName, record.CauseDetailName].filter((part) => part && part !== '詳細無し').join('・') || '原因情報なし', 100);
    const title = trim(`トヨタ道路情報：${regulation}（${cause}）`, 200);
    const summary = trim(`トヨタ「通れた道マップ」掲載の交通規制情報。規制: ${regulation} / 原因: ${cause}。JARTIC・VICSセンター提供情報をトヨタコネクティッドが表示しています。現地の規制と道路管理者の情報を優先してください。`, 500);
    return [{
      guid: `toyota-vics:${contentFingerprint(`${record.RegulationCode}|${record.RegulationDetailCode}|${record.CauseCode}|${record.CauseDetailCode}|${latitude.toFixed(6)}|${longitude.toFixed(6)}`)}`,
      title,
      summary,
      link: officialPage,
      publishedAt: null,
      area: nearestPrefecture(latitude, longitude),
      latitude,
      longitude,
      locationMethod: 'toyota-vics-point',
      roadStatus: /通行止|進入禁止|入口閉鎖/.test(regulation) ? 'closed' : 'restricted'
    }];
  });
}

function parseHtmlMedia(html, sourceUrl, contentType = 'text/html') {
  if (!/html/i.test(contentType) && !/<(?:!doctype\s+html|html)\b/i.test(html)) return [];
  const toyotaItems = parseToyotaPassableRoute(html, sourceUrl);
  if (toyotaItems.length) return toyotaItems;

  const jsonLdItems = extractJsonLdRecords(html).flatMap((record) => {
    if (!jsonLdTypes(record).some((type) => /^(?:NewsArticle|Article|Report|LiveBlogPosting)$/i.test(type))) return [];
    const title = trim(stringValue(record.headline) || stringValue(record.name), 200);
    const summary = trim(stringValue(record.description) || stringValue(record.articleBody), 500);
    const link = resolveUrl(stringValue(record.url) || stringValue(record.mainEntityOfPage?.['@id'])
      || stringValue(record.mainEntityOfPage) || canonicalLink(html) || sourceUrl, sourceUrl);
    if (!title || !summary || !link) return [];
    const place = record.contentLocation || record.location || {};
    const latitude = coordinate(place?.geo?.latitude, -90, 90);
    const longitude = coordinate(place?.geo?.longitude, -180, 180);
    const publishedAt = normalizeTimestamp(record.datePublished || record.dateModified);
    return [{
      guid: `html-jsonld:${contentFingerprint(`${link}|${publishedAt || ''}|${title}|${summary}`)}`,
      title,
      summary,
      link,
      publishedAt,
      area: trim(stringValue(place.name), 80) || 'unknown',
      latitude,
      longitude
    }];
  });
  if (jsonLdItems.length) return jsonLdItems;

  const article = extractArticleDocument(html, contentType, sourceUrl);
  if (article.error) return [];
  const link = resolveUrl(article.canonicalUrl || sourceUrl, sourceUrl);
  const title = trim(article.title, 200);
  const summary = trim(article.excerpt, 500);
  if (!link || !title || !summary) return [];
  return [{
    guid: `html-page:${contentFingerprint(`${link}|${article.publishedAt || article.modifiedAt || ''}|${title}|${summary}`)}`,
    title,
    summary,
    link,
    publishedAt: article.publishedAt || article.modifiedAt || null
  }];
}

function parseToyotaPassableRoute(html, sourceUrl) {
  let source;
  try { source = new URL(sourceUrl); } catch { return []; }
  if (!(source.hostname === 'toyota.co.jp' || source.hostname.endsWith('.toyota.co.jp'))
    || !source.pathname.includes('/auto/passable_route/map')) return [];
  const noticeHtml = html.match(/<div\b[^>]*class=["'][^"']*hd[^"']*["'][^>]*>\s*お知らせ\s*<\/div>\s*<div\b[^>]*class=["'][^"']*cont[^"']*["'][^>]*>([\s\S]*?)<\/div>/i)?.[1] || '';
  const notice = stripHtmlText(noticeHtml);
  const pageLink = resolveUrl(canonicalLink(html) || sourceUrl, sourceUrl);
  if (!pageLink) return [];
  const items = [];
  for (const match of html.matchAll(/searchList\(\s*["']([0-9.]+)-([0-9.]+)["']\s*\)\s*;?[^>]*>([\s\S]*?)<\/a>/gi)) {
    const longitude = Number(match[1]);
    const latitude = Number(match[2]);
    const label = trim(stripHtmlText(match[3]), 200);
    if (!label || !isInJapan(latitude, longitude)) continue;
    const area = findArea(label) !== 'unknown' ? findArea(label) : nearestPrefecture(latitude, longitude);
    const publishedAt = timestampFromCompactJst(label.match(/(?:_|\b)(\d{12})(?:\b|$)/)?.[1]);
    const summary = trim(`${notice || 'トヨタ「通れた道マップ」で災害時道路情報を提供しています。'} 通行実績は通行可能を保証するものではありません。現地の規制と道路管理者の情報を優先してください。`, 500);
    items.push({
      guid: `toyota-passable:${contentFingerprint(`${label}|${longitude}|${latitude}|${summary}`)}`,
      title: `トヨタ 通れた道マップ：${label}`,
      summary,
      link: pageLink,
      publishedAt,
      area,
      latitude,
      longitude,
      locationMethod: 'toyota-passable-event-point',
      roadStatus: 'recently_passed',
      roadObservedAt: publishedAt
    });
  }
  return items;
}

function stripHtmlText(value) {
  return normalizeArticleText(decode(String(value || '')
    .replace(/<(?:script|style)\b[^>]*>[\s\S]*?<\/(?:script|style)>/gi, ' ')
    .replace(/<br\s*\/?\s*>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')));
}

function timestampFromCompactJst(value) {
  if (!/^\d{12}$/.test(String(value || ''))) return null;
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const hour = Number(value.slice(8, 10));
  const minute = Number(value.slice(10, 12));
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const timestamp = Date.UTC(year, month - 1, day, hour - 9, minute);
  return new Date(timestamp).toISOString();
}

function resolveUrl(value, base) {
  try { const url = new URL(value, base); return ['http:', 'https:'].includes(url.protocol) ? url.toString() : null; } catch { return null; }
}

function contentFingerprint(value) {
  let hash = 2166136261;
  for (const character of String(value || '')) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

function parseGeoJsonFeed(value) {
  let document;
  try { document = JSON.parse(value); } catch { return []; }
  if (!Array.isArray(document?.features)) return [];
  return document.features.flatMap((feature) => {
    const properties = feature?.properties || {};
    const coordinates = feature?.geometry?.type === 'Point' ? feature.geometry.coordinates : null;
    const longitude = Number(coordinates?.[0]);
    const latitude = Number(coordinates?.[1]);
    const link = validDiscoverySourceUrl(properties.source_url);
    const title = trim(properties.title, 200);
    if (!isInJapan(latitude, longitude) || !link || !title) return [];
    const metadata = [properties.source_name, properties.kind, properties.municipality, properties.severity]
      .filter(Boolean).join(' / ');
    return [{
      guid: trim(properties.id || feature.id || `${link}:${properties.source_time || ''}`, 240),
      title,
      summary: trim(`発見元: Solafune / 元情報: ${metadata}`, 500),
      link,
      publishedAt: normalizeTimestamp(properties.source_time),
      area: trim(properties.municipality, 80) || 'unknown',
      latitude,
      longitude
    }];
  });
}

function parseFeed(xml) {
  const blocks = [...xml.matchAll(/<(?:item|entry)\b[\s\S]*?<\/(?:item|entry)>/gi)].map((m) => m[0]);
  return blocks.map((block) => ({
    guid: textTag(block, 'guid') || textTag(block, 'id'),
    title: trim(decode(textTag(block, 'title') || '無題'), 200),
    summary: trim(decode(textTag(block, 'description') || textTag(block, 'summary') || textTag(block, 'content') || ''), 500),
    link: atomLink(block) || textTag(block, 'link'),
    publishedAt: normalizeTimestamp(textTag(block, 'pubDate') || textTag(block, 'published') || textTag(block, 'updated'))
  })).filter((item) => item.title && validUrl(item.link));
}

function textTag(xml, tag) { const match = xml.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, 'i')); return match?.[1]?.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, '').trim() || ''; }
function normalizeTimestamp(value) { if (!value) return null; const timestamp = Date.parse(value); return Number.isNaN(timestamp) ? null : new Date(timestamp).toISOString(); }
function atomLink(xml) { const match = xml.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i); return match?.[1] || ''; }
function findArea(text) {
  const value = String(text || '');
  const prefecture = PREFECTURE_CENTERS.find(([label]) => value.includes(label))?.[0];
  if (!prefecture) return 'unknown';
  const start = value.indexOf(prefecture);
  const suffix = value.slice(start + prefecture.length).match(/^\s*([一-龯ぁ-んァ-ン0-9・ヶ]{1,16}(?:市|区|町|村))/)?.[1];
  return trim(`${prefecture}${suffix || ''}`, 80);
}
function decode(value) { return String(value || '').replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16))).replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code))).replace(/&nbsp;/gi, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"); }
function trim(value, max) { return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max); }
function clean(value, max) { return trim(value, max); }
function validUrl(value) { try { const u = new URL(value); return ['http:', 'https:'].includes(u.protocol) ? u.toString() : null; } catch { return null; } }
function validDiscoverySourceUrl(value) {
  const normalized = validUrl(value);
  if (!normalized) return null;
  const url = new URL(normalized);
  const isSalesforceSite = url.hostname.toLowerCase().endsWith('.salesforce-sites.com');
  const isSiteRoot = url.pathname === '/' && !url.search && !url.hash;
  return isSalesforceSite && isSiteRoot ? null : normalized;
}
function normalizeLifecycleStatus(value, workflowStatus = '') {
  if (LIFECYCLE_STATUSES.has(value)) return value;
  if (workflowStatus === 'expired') return 'expired';
  if (workflowStatus === 'review') return 'needs_review';
  if (workflowStatus === 'rejected') return 'resolved';
  return 'active';
}
function normalizeInformationClass(value, category = '', reference = false) {
  if (INFORMATION_CLASSES.has(value)) return value;
  if (reference) return 'reference';
  return category === 'official' ? 'official' : 'media';
}
function normalizeLocationPrecision(value, method, latitude, longitude) {
  if (LOCATION_PRECISIONS.has(value)) return value;
  return deriveLocationPrecision(method, latitude, longitude, method === 'human-reviewed-point');
}
function normalizeRoadStatus(value) { return ROAD_STATUSES.has(value) ? value : 'unknown'; }
function deriveRoadStatus(text) {
  const value = String(text || '');
  if (/通行止|進入禁止|入口閉鎖|全面通行止/.test(value)) return 'closed';
  if (/通行実績|通れた道|車両が通行/.test(value)) return 'recently_passed';
  if (/交通規制|通行規制|片側交互通行|車線規制|チェーン規制|規制中/.test(value)) return 'restricted';
  return 'unknown';
}
function deriveEventMetadata(report) {
  const text = `${report?.title || ''} ${report?.summary || ''}`;
  const definitions = [
    ['earthquake', '地震', /地震|震度|余震|緊急地震/],
    ['tsunami', '津波', /津波/],
    ['volcano', '火山', /噴火|火山/],
    ['typhoon', '台風', /台風/],
    ['rain_flood', '大雨・洪水', /大雨|洪水|浸水|土砂/],
    ['snow', '大雪・暴風雪', /大雪|暴風雪|凍結/],
    ['road', '道路障害', /通行止|交通規制|道路障害/]
  ];
  const definition = definitions.find(([, , pattern]) => pattern.test(text));
  const timestamp = normalizeTimestamp(report?.published_at || report?.retrieved_at);
  if (!definition || !timestamp) return { event_key: null, event_name: null, event_kind: null };
  const parts = new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(new Date(timestamp));
  const datePart = (type) => parts.find((part) => part.type === type)?.value || '';
  const dateKey = `${datePart('year')}-${datePart('month')}-${datePart('day')}`;
  const area = report?.area && report.area !== 'unknown' ? report.area : '日本国内';
  return {
    event_key: `${definition[0]}:${area}:${dateKey}`,
    event_name: `${Number(datePart('year'))}年${Number(datePart('month'))}月${Number(datePart('day'))}日 ${area} ${definition[1]}`,
    event_kind: definition[0]
  };
}
function normalizeFutureTimestamp(value, from = new Date().toISOString()) {
  const normalized = normalizeTimestamp(value);
  return normalized && Date.parse(normalized) > Date.parse(from) ? normalized : null;
}
function trustSnapshot(item) {
  return {
    status: item.status ?? null,
    lifecycle_status: item.lifecycle_status ?? null,
    information_class: item.information_class ?? null,
    location_precision: item.location_precision ?? null,
    last_verified_at: item.last_verified_at ?? null,
    valid_until: item.valid_until ?? item.expires_at ?? null,
    latitude: item.latitude ?? null,
    longitude: item.longitude ?? null
  };
}
function revisionStatement(db, itemId, revision) {
  return db.prepare(`INSERT INTO report_revisions
    (extracted_item_id, revision_type, changed_fields, previous_values, new_values, actor, public_note, detail, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).bind(
    itemId,
    revision.revisionType,
    JSON.stringify(revision.changedFields || []),
    revision.previousValues ? JSON.stringify(revision.previousValues) : null,
    revision.newValues ? JSON.stringify(revision.newValues) : null,
    clean(revision.actor, 80) || 'system',
    clean(revision.publicNote, 240) || null,
    clean(revision.detail, 500) || null,
    revision.createdAt || new Date().toISOString()
  );
}
async function addRevision(db, itemId, revision) { await revisionStatement(db, itemId, revision).run(); }
function parseJsonList(value) { try { const parsed = JSON.parse(value || '[]'); return Array.isArray(parsed) ? parsed : []; } catch { return []; } }
function parseJsonObject(value) { try { const parsed = JSON.parse(value || 'null'); return parsed && typeof parsed === 'object' ? parsed : null; } catch { return null; } }
function lifecyclePublicNote(status) {
  return ({
    active: '発生中として確認しました。', ongoing: '継続中として再確認しました。',
    resolved: '解消を確認しました。', expired: '有効期限切れに変更しました。',
    needs_review: '再確認が必要な状態に変更しました。'
  })[status] || '状態を更新しました。';
}
function revisionPublicLabel(type) {
  return ({
    created: '情報を登録しました。', published: '情報を公開しました。', status_change: '状態を更新しました。',
    correction: '情報を訂正しました。', expiry: '有効期限を過ぎました。', migration: '信頼性表示を追加しました。'
  })[type] || '情報を更新しました。';
}
function coordinate(value, min, max) { if (value === '' || value === undefined || value === null) return null; const number = Number(value); return Number.isFinite(number) && number >= min && number <= max ? number : null; }
function sameHost(a, b) { try { return new URL(a).hostname === new URL(b).hostname; } catch { return false; } }
function allowedHost(value, allowlist) {
  const hosts = String(allowlist || '').split(',').map((host) => host.trim().toLowerCase()).filter(Boolean);
  if (!hosts.length) return false;
  const hostname = new URL(value).hostname.toLowerCase();
  return hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`));
}
async function authorize(request, env, route) {
  if (!env.ADMIN_TOKEN) return json({ error: 'admin_token_not_configured', message: '管理APIの認証設定がありません。' }, 503);
  const authorization = request.headers.get('authorization') || '';
  const expected = `Bearer ${env.ADMIN_TOKEN}`;
  if (authorization.length !== expected.length || !constantTimeEqual(authorization, expected)) {
    return json({ error: 'unauthorized', message: '管理APIにはBearerトークンが必要です。' }, 401);
  }
  const clientKey = request.headers.get('CF-Connecting-IP') || request.headers.get('x-forwarded-for') || 'local-client';
  const limited = await enforceRateLimit(env.DB, clientKey, route);
  return limited ? json({ error: 'rate_limited', message: 'リクエスト回数が上限に達しました。しばらく待ってください。' }, 429) : null;
}
async function enforceRateLimit(db, clientKey, route) {
  const now = Date.now();
  const cutoff = new Date(now - 60_000).toISOString();
  const count = await db.prepare('SELECT COUNT(*) AS count FROM request_events WHERE client_key = ? AND created_at >= ?').bind(clientKey, cutoff).first();
  if (Number(count?.count || 0) >= 30) return true;
  await db.prepare('INSERT INTO request_events (client_key, route, created_at) VALUES (?, ?, ?)').bind(clientKey, route, new Date(now).toISOString()).run();
  return false;
}
function constantTimeEqual(a, b) { let result = a.length ^ b.length; const max = Math.max(a.length, b.length); for (let i = 0; i < max; i += 1) result |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0); return result === 0; }
async function sha256(value) { const bytes = new TextEncoder().encode(value); const hash = await crypto.subtle.digest('SHA-256', bytes); return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join(''); }
async function markSourceFailure(db, sourceId) { await db.prepare('UPDATE sources SET last_failure_at = ? WHERE id = ?').bind(new Date().toISOString(), sourceId).run(); }
async function readJson(request) { try { return await request.json(); } catch { return {}; } }
function json(value, status = 200) { return new Response(JSON.stringify(value), { status, headers: JSON_HEADERS }); }
function corsHeaders() { return { 'access-control-allow-origin': '*', 'access-control-allow-methods': 'GET,POST,OPTIONS', 'access-control-allow-headers': 'content-type, authorization' }; }
function withCors(response) { const headers = new Headers(response.headers); Object.entries(corsHeaders()).forEach(([key, value]) => headers.set(key, value)); return new Response(response.body, { status: response.status, headers }); }

export { parseFeed, parseGeoJsonFeed, parseHtmlMedia, parseSourcePayload, parseToyotaVics, normalizeOpenMeteo, extractItem, extractArticleDocument, articleTitleMatches, articleUrlAllowed, reportsToGeoJson, reportsToCsv, reportPriority, sanitizeArchiveReport, allowedHost, sameHost, shouldAutoPublish, validDiscoverySourceUrl, deriveInformationClass, deriveLocationPrecision, defaultValidUntil, normalizeLifecycleStatus, runIngestionLoop, enrichPendingArticles, backfillCoarseLocations, refreshLifecycleStatuses };
