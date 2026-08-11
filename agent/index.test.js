import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { agentEnabled, analyze, assertSafeChange, builderEnabled, canAutoFix, fingerprint, OBSERVATION_TARGETS, observe, releaseGate } from './index.js';
import {
  NATIONAL_OPTION, PREFECTURES, REGIONS, orderedPrefectureOptions, prefectureFrom,
  prefecturesForRegion, regionForPrefecture, sortPlateauRegions, validateRegionConfiguration
} from '../public/region-order.js';

test('fingerprint is stable and includes the required dimensions', () => assert.equal(fingerprint({ environment: 'preview', targetId: '/api/health', category: 'major', errorCode: 'http_500', status: 500 }), 'preview:/api/health:major:http_500:500'));
test('protected changes cannot be auto-applied', () => assert.throws(() => assertSafeChange({ files: [{ path: '/api/reports' }] }), /protected_target/));
test('only low-risk explicitly fixable issues are eligible', () => { assert.equal(canAutoFix({ severity: 'minor', category: 'accessibility', autoFixable: true }), true); assert.equal(canAutoFix({ severity: 'critical', category: 'accessibility', autoFixable: true }), false); });
test('analyst escalates health failures', () => { const issues = analyze({ observerRunId: 'run', results: [{ targetId: '/api/health', environment: 'preview', success: false, status: 500, errorCode: 'http_500' }] }); assert.equal(issues[0].severity, 'critical'); assert.equal(issues[0].humanApprovalRequired, true); });
test('release gate requires every condition', () => { assert.equal(releaseGate({ enabled: true, approval: true, previewPassed: true, commit: 'abc', deploymentId: 'dep' }).allowed, true); assert.equal(releaseGate({ enabled: true, approval: false, previewPassed: true, commit: 'abc', deploymentId: 'dep' }).allowed, false); });
test('kill switches are opt-in only', () => { assert.equal(agentEnabled('false'), false); assert.equal(agentEnabled('true'), true); assert.equal(builderEnabled('false'), false); assert.equal(builderEnabled('true'), true); });

test('observer retries transient 5xx once without reading response bodies', async () => {
  let calls = 0;
  const result = await observe('https://preview.example', async () => {
    calls += 1;
    return new Response(null, { status: calls === 1 ? 503 : 200, headers: { 'content-type': calls <= 2 ? 'text/html' : 'application/json' } });
  });
  assert.equal(result.results[0].recovered, true);
  assert.equal(result.results[0].attempts, 2);
  assert.equal(result.results[0].recoveryAction, 'bounded_retry_no_store');
});

test('observer distinguishes DNS, TLS, and normal aborts', async () => {
  for (const [code, expected] of [['ENOTFOUND', 'dns_error'], ['CERT_HAS_EXPIRED', 'tls_error']]) {
    const error = new TypeError('fetch failed', { cause: { code } });
    const result = await observe('https://preview.example', async () => { throw error; }, { maxRetries: 0 });
    assert.equal(result.results[0].errorCode, expected);
  }
  const aborted = await observe('https://preview.example', async () => { throw new DOMException('cancelled', 'AbortError'); }, { maxRetries: 0 });
  assert.equal(aborted.results[0].errorCode, 'request_aborted');
  assert.equal(aborted.results[0].ignored, true);
  assert.equal(analyze(aborted).length, 0);
});

test('external dependency failures do not become core connectivity failures', () => {
  const issues = analyze({ observerRunId: 'run', results: [{ targetId: '/api/weather?lat=1&lon=1', environment: 'production', dependency: 'external', success: false, status: 502, errorCode: 'http_502' }] });
  assert.equal(issues[0].category, 'external_dependency');
  assert.equal(issues[0].severity, 'minor');
});

test('observer periodically checks the PLATEAU experience without reading response bodies', () => {
  assert.ok(OBSERVATION_TARGETS.includes('/api/plateau/regions'));
  assert.ok(OBSERVATION_TARGETS.includes('/api/plateau/availability?municipality_code=13101'));
  assert.ok(OBSERVATION_TARGETS.includes('/api/plateau/hazards/config?municipality_code=13101'));
  assert.ok(OBSERVATION_TARGETS.includes('/api/plateau/3d/config?municipality_code=13101'));
  assert.ok(OBSERVATION_TARGETS.includes('/plateau-3d.js'));
  assert.ok(OBSERVATION_TARGETS.includes('/plateau-location.js'));
  assert.ok(OBSERVATION_TARGETS.includes('/region-order.js'));
});

const EXPECTED_REGIONS = ['北海道', '東北', '関東', '中部', '近畿', '中国', '四国', '九州・沖縄'];
const EXPECTED_PREFECTURES = [
  '北海道', '青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県',
  '茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県',
  '新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県',
  '三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県',
  '鳥取県', '島根県', '岡山県', '広島県', '山口県',
  '徳島県', '香川県', '愛媛県', '高知県',
  '福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県'
];

test('地域と47都道府県は全国を先頭に標準地理順で定義される', () => {
  assert.equal(NATIONAL_OPTION.regionName, '全国');
  assert.deepEqual(REGIONS.map((item) => item.regionName), EXPECTED_REGIONS);
  assert.deepEqual(PREFECTURES.map((item) => item.prefectureName), EXPECTED_PREFECTURES);
  assert.deepEqual(PREFECTURES.map((item) => item.prefectureCode), Array.from({ length: 47 }, (_, index) => String(index + 1).padStart(2, '0')));
  assert.equal(new Set(PREFECTURES.map((item) => item.prefectureName)).size, 47);
  assert.equal(validateRegionConfiguration().valid, true);
});

test('各地方は指定された都道府県だけを標準順で返す', () => {
  const expected = [
    ['北海道'], ['青森県', '岩手県', '宮城県', '秋田県', '山形県', '福島県'],
    ['茨城県', '栃木県', '群馬県', '埼玉県', '千葉県', '東京都', '神奈川県'],
    ['新潟県', '富山県', '石川県', '福井県', '山梨県', '長野県', '岐阜県', '静岡県', '愛知県'],
    ['三重県', '滋賀県', '京都府', '大阪府', '兵庫県', '奈良県', '和歌山県'],
    ['鳥取県', '島根県', '岡山県', '広島県', '山口県'],
    ['徳島県', '香川県', '愛媛県', '高知県'],
    ['福岡県', '佐賀県', '長崎県', '熊本県', '大分県', '宮崎県', '鹿児島県', '沖縄県']
  ];
  REGIONS.forEach((region, index) => assert.deepEqual(prefecturesForRegion(region.regionId).map((item) => item.prefectureName), expected[index]));
});

test('件数表示と0件除外は都道府県順を変えず東京都は関東と整合する', () => {
  const counts = new Map([['01', 3], ['03', 2], ['04', 5], ['47', 9]]);
  assert.deepEqual(orderedPrefectureOptions(counts).slice(0, 4).map((item) => [item.prefectureName, item.count]), [['北海道', 3], ['青森県', 0], ['岩手県', 2], ['宮城県', 5]]);
  assert.deepEqual(orderedPrefectureOptions(counts, { onlyWithReports: true }).map((item) => item.prefectureName), ['北海道', '岩手県', '宮城県', '沖縄県']);
  assert.equal(prefectureFrom('東京都').regionId, 'kanto');
  assert.equal(regionForPrefecture('13').regionName, '関東');
});

test('PLATEAU自治体は都道府県コードと自治体コード順になり災害選択とは別UIである', async () => {
  const sorted = sortPlateauRegions([
    { prefecture_code: '47', municipality_code: '47201', prefecture_name: '沖縄県' },
    { prefecture_code: '13', municipality_code: '13102', prefecture_name: '東京都' },
    { prefecture_code: '01', municipality_code: '01100', prefecture_name: '北海道' },
    { prefecture_code: '13', municipality_code: '13101', prefecture_name: '東京都' }
  ]);
  assert.deepEqual(sorted.map((item) => item.municipality_code), ['01100', '13101', '13102', '47201']);
  const html = await readFile('public/index.html', 'utf8');
  const app = await readFile('public/app.js', 'utf8');
  for (const id of ['filter-region', 'filter-area', 'plateau-region-select', 'plateau-prefecture-select']) assert.match(html, new RegExp(`id="${id}"`));
  const plateauSelection = app.match(/function selectPlateauRegion[\s\S]*?\n}\n\nfunction selectReport/)?.[0] || '';
  assert.doesNotMatch(plateauSelection, /#filter-(?:region|area)/);
});

test('地域選択UIは390px・キーボード・ARIA契約を満たす', async () => {
  const html = await readFile('public/index.html', 'utf8');
  const css = await readFile('public/styles.css', 'utf8');
  for (const id of ['filter-region', 'filter-area', 'plateau-region-select', 'plateau-prefecture-select']) {
    assert.match(html, new RegExp(`<label[^>]+for="${id}"`));
    assert.match(html, new RegExp(`<select[^>]+id="${id}"`));
  }
  assert.match(html, /id="selected-region-status"/);
  assert.match(html, /id="region-reset"[^>]+type="button"/);
  assert.match(css, /@media \(max-width: 38rem\)[\s\S]*?\.filter-grid \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /@media \(max-width: 38rem\)[\s\S]*?\.plateau-selection \{ grid-template-columns: 1fr; \}/);
  assert.match(css, /\.filter-grid select \{[\s\S]*?min-block-size: 2\.75rem/);
  assert.match(css, /\.plateau-area-picker select \{ min-block-size: 2\.75rem/);
});

test('Observerは地域順UI regressionを独立検出する', async () => {
  const observation = await observe('https://preview.example', async (url) => {
    const path = new URL(url).pathname;
    const type = path.endsWith('.css') ? 'text/css' : path.endsWith('.json') || path.startsWith('/api/') ? 'application/json' : path === '/' ? 'text/html' : 'application/javascript';
    return new Response(null, { status: path === '/api/admin/reports' ? 401 : 200, headers: { 'content-type': type } });
  }, { maxRetries: 0 });
  const audit = observation.results.find((item) => item.targetId === '/__region-navigation__');
  assert.equal(audit.success, true);
  assert.equal(audit.prefectureCount, 47);
  assert.deepEqual(audit.checks, ['standard_order', 'unique_47', 'region_membership']);
  const [issue] = analyze({ observerRunId: 'run', results: [{ targetId: '/__region-navigation__', environment: 'preview', dependency: 'core', success: false, status: null, errorCode: 'region_order_mismatch' }] });
  assert.equal(issue.category, 'ui_regression');
});
