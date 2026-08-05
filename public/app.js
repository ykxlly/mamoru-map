const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };
const PRIORITY_ORDER = { emergency: 0, high: 1, medium: 2 };
const PRIORITY_LABELS = { emergency: '緊急', high: '高', medium: '中' };
const VERIFICATION_LABELS = {
  verified: '確認済み',
  auto_unverified: '自動公開・未確認',
  reference_unverified: '報道・参考（未確認）'
};
const LIFECYCLE_LABELS = { active: '発生中', ongoing: '継続', resolved: '解消', expired: '期限切れ', needs_review: '要再確認' };
const INFORMATION_CLASS_LABELS = { official: '公式', media: '報道', reference: '参考' };
const LOCATION_PRECISION_LABELS = { exact: '正確な地点', representative: '地域代表点', estimated: '推定位置', unknown: '位置不明' };
const TYPE_LABELS = {
  warning: '警報・注意',
  damage: '被害',
  road: '道路・交通',
  shelter: '避難所',
  support: '支援',
  other: 'その他'
};

const isLocalStaticServer = ['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port !== '8787';
const apiBase = isLocalStaticServer ? `${window.location.protocol}//${window.location.hostname}:8787` : window.location.origin;
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const state = {
  reports: [],
  filtered: [],
  map: null,
  mapReady: false,
  fitted: false,
  popup: null,
  selectedId: null,
  renderFrame: null,
  dates: [],
  selectedDate: null,
  onsetDate: null,
  allDates: false
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function element(tag, className = '', text = '') {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== '') node.textContent = text;
  return node;
}

function mapStyle() {
  return {
    version: 8,
    sources: {
      'gsi-pale': {
        type: 'raster',
        tiles: ['https://cyberjapandata.gsi.go.jp/xyz/pale/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院</a>'
      },
      'gsi-standard': {
        type: 'raster',
        tiles: ['https://cyberjapandata.gsi.go.jp/xyz/std/{z}/{x}/{y}.png'],
        tileSize: 256,
        attribution: '<a href="https://maps.gsi.go.jp/development/ichiran.html" target="_blank" rel="noreferrer">国土地理院</a>'
      }
    },
    layers: [
      { id: 'gsi-pale', type: 'raster', source: 'gsi-pale' },
      { id: 'gsi-standard', type: 'raster', source: 'gsi-standard', layout: { visibility: 'none' } }
    ]
  };
}

function initializeMap() {
  if (!window.maplibregl) {
    setConnectionState('error', '地図読込失敗');
    return;
  }
  const map = new maplibregl.Map({
    container: 'map',
    style: mapStyle(),
    center: [130.78, 32.79],
    zoom: 9.2,
    minZoom: 5,
    maxZoom: 18,
    attributionControl: false
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.on('load', () => {
    map.addSource('reports', { type: 'geojson', data: EMPTY_GEOJSON });
    map.addLayer({
      id: 'report-halo',
      type: 'circle',
      source: 'reports',
      paint: {
        'circle-radius': 13,
        'circle-color': priorityColorExpression(),
        'circle-opacity': 0.18
      }
    });
    map.addLayer({
      id: 'report-points',
      type: 'circle',
      source: 'reports',
      paint: {
        'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 5.5, 13, 8.5],
        'circle-color': priorityColorExpression(),
        'circle-opacity': ['case',
          ['==', ['get', 'verification_status'], 'reference_unverified'], 0.58,
          ['in', ['get', 'lifecycle_status'], ['literal', ['resolved', 'expired']]], 0.46,
          ['in', ['get', 'location_precision'], ['literal', ['representative', 'estimated']]], 0.72,
          1
        ],
        'circle-stroke-width': ['case', ['==', ['get', 'verification_status'], 'reference_unverified'], 3.5, 2.5],
        'circle-stroke-color': ['case', ['==', ['get', 'verification_status'], 'reference_unverified'], '#7b5f16', '#ffffff']
      }
    });
    map.on('mouseenter', 'report-points', () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', 'report-points', () => { map.getCanvas().style.cursor = ''; });
    map.on('click', 'report-points', (event) => {
      const id = String(event.features?.[0]?.properties?.id ?? '');
      const report = state.reports.find((item) => String(item.id) === id);
      if (report) selectReport(report, false);
    });
    state.mapReady = true;
    updateMap();
    fitInitialBounds();
  });
  map.on('error', (event) => {
    if (event?.error) $('#live').textContent = '地図タイルの一部を読み込めませんでした。';
  });
  state.map = map;
}

function priorityColorExpression() {
  return ['match', ['get', 'priority'], 'emergency', '#c83e35', 'high', '#e47a22', '#2777a8'];
}

function normalizeReport(report) {
  const latitude = report.latitude === null || report.latitude === undefined || report.latitude === '' ? Number.NaN : Number(report.latitude);
  const longitude = report.longitude === null || report.longitude === undefined || report.longitude === '' ? Number.NaN : Number(report.longitude);
  const verificationStatus = VERIFICATION_LABELS[report.verification_status]
    ? report.verification_status
    : report.auto_published ? 'auto_unverified' : 'verified';
  const lifecycleStatus = LIFECYCLE_LABELS[report.lifecycle_status]
    ? report.lifecycle_status : report.record_status === 'expired' ? 'expired' : report.record_status === 'review' ? 'needs_review' : 'active';
  const informationClass = INFORMATION_CLASS_LABELS[report.information_class]
    ? report.information_class : report.category === 'official' ? 'official' : verificationStatus === 'reference_unverified' ? 'reference' : 'media';
  const locationPrecision = LOCATION_PRECISION_LABELS[report.location_precision]
    ? report.location_precision : Number.isFinite(latitude) && Number.isFinite(longitude) ? 'estimated' : 'unknown';
  return {
    ...report,
    id: String(report.id),
    title: String(report.title || '無題'),
    summary: String(report.summary || '詳細は原文をご確認ください。'),
    area: String(report.area && report.area !== 'unknown' ? report.area : '地域不明'),
    category: report.category === 'official' ? 'official' : 'news',
    report_type: TYPE_LABELS[report.report_type] ? report.report_type : 'other',
    priority: PRIORITY_LABELS[report.priority] ? report.priority : derivePriority(report),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    verification_status: verificationStatus,
    lifecycle_status: lifecycleStatus,
    information_class: informationClass,
    location_precision: locationPrecision,
    revision_count: Number(report.revision_count || 0),
    dateKey: dateKeyJst(report.published_at || report.retrieved_at),
    statusLabel: VERIFICATION_LABELS[verificationStatus],
    lifecycleLabel: LIFECYCLE_LABELS[lifecycleStatus],
    informationClassLabel: INFORMATION_CLASS_LABELS[informationClass],
    locationPrecisionLabel: LOCATION_PRECISION_LABELS[locationPrecision]
  };
}

function derivePriority(report) {
  const text = `${report.title || ''} ${report.summary || ''}`;
  if (/救助|行方不明|閉じ込め|生き埋め|倒壊|火災|大津波警報|緊急安全確保/.test(text)) return 'emergency';
  if (/避難指示|津波警報|土砂災害|通行止め|停電|断水|震度[67]/.test(text) || ['warning', 'damage'].includes(report.report_type)) return 'high';
  return 'medium';
}

function selectedPriorities() {
  return new Set($$('.priority-toggle:checked').map((input) => input.value));
}

function selectedVerifications() {
  return new Set($$('.verification-toggle:checked').map((input) => input.value));
}

function selectedLifecycles() {
  return new Set($$('.lifecycle-toggle:checked').map((input) => input.value));
}

function setLifecycleSelection(values) {
  const selected = new Set(values);
  $$('.lifecycle-toggle').forEach((input) => { input.checked = selected.has(input.value); });
}

function filterReports() {
  const query = $('#search-query').value.trim().toLocaleLowerCase('ja');
  const area = $('#filter-area').value;
  const type = $('#filter-type').value;
  const sort = $('#filter-sort').value;
  const emergencyOnly = $('#emergency-only').checked;
  const priorities = selectedPriorities();
  const verifications = selectedVerifications();
  const lifecycles = selectedLifecycles();

  const filtered = state.reports.filter((report) => {
    const haystack = [report.title, report.summary, report.area, report.source_name, TYPE_LABELS[report.report_type]].join(' ').toLocaleLowerCase('ja');
    return priorities.has(report.priority)
      && verifications.has(report.verification_status)
      && lifecycles.has(report.lifecycle_status)
      && (state.allDates || !state.selectedDate || report.dateKey === state.selectedDate)
      && (!emergencyOnly || report.priority === 'emergency')
      && (!query || haystack.includes(query))
      && (!area || report.area === area)
      && (!type || report.report_type === type);
  });

  filtered.sort((a, b) => {
    if (sort === 'priority') return PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || timestamp(b.published_at) - timestamp(a.published_at);
    if (sort === 'updated') return timestamp(b.retrieved_at) - timestamp(a.retrieved_at);
    return timestamp(b.published_at || b.retrieved_at) - timestamp(a.published_at || a.retrieved_at);
  });
  return filtered;
}

function timestamp(value) {
  const time = Date.parse(value || '');
  return Number.isNaN(time) ? 0 : time;
}

function dateKeyJst(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function formatDateKey(value) {
  if (!value) return '日時不明';
  const [year, month, day] = value.split('-').map(Number);
  return `${year}年${month}月${day}日`;
}

function initializeTimeline() {
  state.dates = [...new Set(state.reports.map((report) => report.dateKey).filter(Boolean))].sort();
  const quakeReports = state.reports
    .filter((report) => report.dateKey && /地震|震度|余震|緊急地震/.test(`${report.title} ${report.summary}`))
    .sort((a, b) => timestamp(a.published_at) - timestamp(b.published_at));
  state.onsetDate = quakeReports[0]?.dateKey || state.dates[0] || null;
  state.selectedDate = state.dates.at(-1) || null;
  state.allDates = false;

  const slider = $('#timeline-slider');
  const enabled = state.dates.length > 0;
  slider.min = '0';
  slider.max = String(Math.max(state.dates.length - 1, 0));
  slider.value = String(Math.max(state.dates.length - 1, 0));
  slider.disabled = !enabled;
  ['#timeline-onset', '#timeline-current', '#timeline-all'].forEach((selector) => { $(selector).disabled = !enabled; });
  $('#timeline-start').textContent = state.dates[0] ? formatDateKey(state.dates[0]).replace(/年|月/g, '/').replace('日', '') : '―';
  $('#timeline-end').textContent = state.dates.at(-1) ? formatDateKey(state.dates.at(-1)).replace(/年|月/g, '/').replace('日', '') : '―';
  updateTimelineDisplay();
}

function updateTimelineDisplay() {
  const output = $('#timeline-date');
  output.textContent = state.allDates ? '全期間' : formatDateKey(state.selectedDate);
  $('#timeline-all').setAttribute('aria-pressed', String(state.allDates));
  $('#timeline-help').textContent = selectedVerifications().has('reference_unverified')
    ? '報道・参考（未確認）を含みます。発表日時と内容はリンク先の原文で確認してください。'
    : '選択した日の確認済み・自動公開情報を表示します。';
}

function render() {
  state.filtered = filterReports();
  updateTimelineDisplay();
  renderCounts();
  renderList();
  updateMap();
}

function scheduleRender() {
  if (state.renderFrame) cancelAnimationFrame(state.renderFrame);
  state.renderFrame = requestAnimationFrame(() => {
    state.renderFrame = null;
    render();
  });
}

function renderCounts() {
  const totals = { emergency: 0, high: 0, medium: 0 };
  const verifications = selectedVerifications();
  const lifecycles = selectedLifecycles();
  state.reports
    .filter((report) => verifications.has(report.verification_status) && lifecycles.has(report.lifecycle_status)
      && (state.allDates || !state.selectedDate || report.dateKey === state.selectedDate))
    .forEach((report) => { totals[report.priority] += 1; });
  Object.entries(totals).forEach(([key, value]) => { $(`#count-${key}`).textContent = value; });
  $('#visible-count').textContent = state.filtered.length;
  const mapped = state.filtered.filter(hasCoordinates).length;
  const period = state.allDates ? '全期間' : formatDateKey(state.selectedDate);
  $('#result-status').textContent = `${period}：${state.filtered.length}件を表示・地図上${mapped}件（履歴全${state.reports.length}件）`;
}

function renderList() {
  const list = $('#event-list');
  list.replaceChildren();
  if (!state.filtered.length) {
    const empty = element('div', 'empty-state');
    empty.append(element('strong', '', '条件に一致する情報はありません'));
    empty.append(element('p', '', '検索語や絞り込み条件を変更してください。'));
    list.append(empty);
    return;
  }
  const fragment = document.createDocumentFragment();
  state.filtered.forEach((report) => fragment.append(buildReportCard(report)));
  list.append(fragment);
}

function buildReportCard(report) {
  const card = element('article', 'event-card');
  card.dataset.id = report.id;
  card.dataset.selected = String(report.id === state.selectedId);

  const target = element('button', 'event-card-main');
  target.type = 'button';
  target.setAttribute('aria-label', `${PRIORITY_LABELS[report.priority]}、${report.area}、${report.title}`);
  target.addEventListener('click', () => selectReport(report, true));

  const meta = element('span', 'event-meta');
  meta.append(element('span', `priority-badge ${report.priority}`, PRIORITY_LABELS[report.priority]));
  meta.append(element('span', 'type-badge', TYPE_LABELS[report.report_type]));
  meta.append(element('span', `lifecycle-badge ${report.lifecycle_status}`, report.lifecycleLabel));
  meta.append(element('time', 'event-time', formatShortTime(report.published_at)));
  target.append(meta);
  target.append(element('span', 'event-title', report.title));
  target.append(element('span', 'event-place', `⌖ ${report.area}`));
  target.append(element('span', 'event-summary', report.summary));
  card.append(target);

  const source = element('div', 'event-source');
  source.append(element('span', 'event-source-name', `発表元：${report.source_name || '不明'}`));
  source.append(element('span', `information-badge ${report.information_class}`, report.informationClassLabel));
  source.append(element('span', `status-label ${report.verification_status}`, report.statusLabel));
  const itemUrl = safeUrl(report.item_url);
  if (itemUrl) {
    const link = element('a', '', '原文を開く');
    link.href = itemUrl;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    source.append(link);
  }
  card.append(source);

  const trust = document.createElement('details');
  trust.className = 'trust-details';
  const trustSummary = document.createElement('summary');
  trustSummary.textContent = `信頼性・日時・更新履歴（${report.revision_count}件）`;
  trust.append(trustSummary);
  const facts = element('dl', 'trust-facts');
  [
    ['状態', report.lifecycleLabel],
    ['情報区分', report.informationClassLabel],
    ['位置精度', report.locationPrecisionLabel],
    ['発表日時', formatExactTime(report.published_at)],
    ['取得日時', formatExactTime(report.retrieved_at)],
    ['最終確認', formatExactTime(report.last_verified_at)],
    ['有効期限', formatExactTime(report.valid_until)]
  ].forEach(([term, value]) => { facts.append(element('dt', '', term), element('dd', '', value)); });
  trust.append(facts);
  const historyLink = element('a', 'history-link', '更新・訂正履歴を見る');
  historyLink.href = `${apiBase}/api/reports/${encodeURIComponent(report.id)}/history`;
  historyLink.target = '_blank';
  historyLink.rel = 'noreferrer noopener';
  trust.append(historyLink);
  card.append(trust);
  return card;
}

function reportFeature(report) {
  return {
    type: 'Feature',
    id: report.id,
    geometry: { type: 'Point', coordinates: [report.longitude, report.latitude] },
    properties: {
      id: report.id,
      priority: report.priority,
      report_type: report.report_type,
      location_method: report.location_method || '',
      verification_status: report.verification_status,
      lifecycle_status: report.lifecycle_status,
      location_precision: report.location_precision
    }
  };
}

function updateMap() {
  if (!state.mapReady) return;
  const source = state.map.getSource('reports');
  if (!source) return;
  source.setData({ type: 'FeatureCollection', features: state.filtered.filter(hasCoordinates).map(reportFeature) });
}

function fitInitialBounds() {
  if (!state.mapReady || state.fitted) return;
  const positioned = state.reports.filter(hasCoordinates);
  if (!positioned.length) return;
  const bounds = new maplibregl.LngLatBounds();
  positioned.forEach((report) => bounds.extend([report.longitude, report.latitude]));
  if (positioned.length === 1) {
    state.map.jumpTo({ center: [positioned[0].longitude, positioned[0].latitude], zoom: 12 });
  } else {
    state.map.fitBounds(bounds, { padding: 70, maxZoom: 12, duration: reducedMotion ? 0 : 650 });
  }
  state.fitted = true;
}

function hasCoordinates(report) {
  return report.location_precision !== 'unknown' && Number.isFinite(report.latitude) && Number.isFinite(report.longitude);
}

function selectReport(report, moveMap) {
  state.selectedId = report.id;
  $$('.event-card').forEach((card) => { card.dataset.selected = String(card.dataset.id === report.id); });
  if (!hasCoordinates(report) || !state.mapReady) {
    $('#live').textContent = 'この情報には地図上の位置がありません。原文で場所をご確認ください。';
    return;
  }
  if (moveMap) {
    state.map.easeTo({ center: [report.longitude, report.latitude], zoom: Math.max(state.map.getZoom(), 12), duration: reducedMotion ? 0 : 500 });
  }
  showPopup(report);
  $('#live').textContent = `${report.area}の情報を地図に表示しました。`;
}

function showPopup(report) {
  if (state.popup) state.popup.remove();
  const content = element('div', 'popup-content');
  content.append(element('div', 'popup-priority', `${PRIORITY_LABELS[report.priority]}・${TYPE_LABELS[report.report_type]}`));
  content.append(element('h3', 'popup-title', report.title));
  content.append(element('p', 'popup-area', report.area));
  content.append(element('p', `popup-status ${report.verification_status}`, report.statusLabel));
  content.append(element('p', `popup-lifecycle ${report.lifecycle_status}`, `${report.lifecycleLabel}・${report.informationClassLabel}`));
  content.append(element('p', 'popup-location', `位置：${report.locationPrecisionLabel}`));
  content.append(element('p', 'popup-summary', report.summary));
  const itemUrl = safeUrl(report.item_url);
  if (itemUrl) {
    const link = element('a', 'popup-link', '一次情報を確認');
    link.href = itemUrl;
    link.target = '_blank';
    link.rel = 'noreferrer noopener';
    content.append(link);
  }
  state.popup = new maplibregl.Popup({ closeButton: true, maxWidth: '20rem' })
    .setLngLat([report.longitude, report.latitude])
    .setDOMContent(content)
    .addTo(state.map);
}

function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['http:', 'https:'].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

function formatShortTime(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '発表日時不明';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(date);
}

function formatExactTime(value) {
  const date = new Date(value || '');
  if (Number.isNaN(date.getTime())) return '不明';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false
  }).format(date);
}

function populateAreas() {
  const select = $('#filter-area');
  const current = select.value;
  const areas = [...new Set(state.reports.map((report) => report.area).filter((area) => area !== '地域不明'))].sort((a, b) => a.localeCompare(b, 'ja'));
  select.replaceChildren(new Option('すべて', ''));
  areas.forEach((area) => select.append(new Option(area, area)));
  select.value = areas.includes(current) ? current : '';
}

function setConnectionState(stateName, label) {
  const badge = $('#connection-badge');
  badge.dataset.state = stateName;
  badge.textContent = label;
}

function formatWeatherMetric(metric, digits = 1) {
  const value = Number(metric?.value);
  if (!Number.isFinite(value)) return '―';
  return `${new Intl.NumberFormat('ja-JP', { maximumFractionDigits: digits }).format(value)} ${metric?.unit || ''}`.trim();
}

async function loadWeather() {
  const panel = $('#weather-panel');
  try {
    const response = await fetch(`${apiBase}/api/weather`, {
      headers: { accept: 'application/json' },
      priority: 'low'
    });
    if (!response.ok) throw new Error(`Weather API ${response.status}`);
    const weather = await response.json();
    $('#weather-temperature').textContent = formatWeatherMetric(weather.temperature_2m);
    $('#weather-precipitation').textContent = formatWeatherMetric(weather.precipitation, 2);
    $('#weather-wind').textContent = formatWeatherMetric(weather.wind_speed_10m);
    $('#weather-time').textContent = `${formatShortTime(weather.observed_at)}時点`;
    $('#weather-notice').textContent = weather.notice || 'モデルによる参考値です。';
    panel.setAttribute('aria-busy', 'false');
    panel.dataset.state = 'ready';
  } catch {
    $('#weather-time').textContent = '取得できません';
    $('#weather-notice').textContent = '現在の気象参考情報を取得できませんでした。気象庁・自治体の発表をご確認ください。';
    panel.setAttribute('aria-busy', 'false');
    panel.dataset.state = 'error';
  }
}

async function loadReports() {
  setConnectionState('loading', '取得中');
  try {
    const response = await fetch(`${apiBase}/api/archive/reports`, { headers: { accept: 'application/json' } });
    if (!response.ok) throw new Error(`API ${response.status}`);
    const payload = await response.json();
    state.reports = (payload.reports || []).map(normalizeReport);
    initializeTimeline();
    populateAreas();
    const latest = state.reports.reduce((value, report) => timestamp(report.retrieved_at) > timestamp(value) ? report.retrieved_at : value, null);
    $('#last-updated').textContent = `データ最終取得: ${formatExactTime(latest)}`;
    setConnectionState('connected', '履歴API接続');
    render();
    fitInitialBounds();
    $('#live').textContent = `履歴APIから${state.reports.length}件を読み込みました。`;
  } catch (error) {
    state.reports = [];
    setConnectionState('error', '接続エラー');
    $('#last-updated').textContent = 'データ最終取得: 接続できません';
    $('#result-status').textContent = '公開APIに接続できませんでした。';
    render();
    $('#live').textContent = '公開情報を読み込めませんでした。時間をおいて再度お試しください。';
  }
}

function bindControls() {
  const form = $('#filter-form');
  form.addEventListener('submit', (event) => { event.preventDefault(); scheduleRender(); });
  $('#search-query').addEventListener('input', scheduleRender);
  ['#filter-area', '#filter-type', '#filter-sort', '#emergency-only'].forEach((selector) => $(selector).addEventListener('change', scheduleRender));
  $$('.priority-toggle').forEach((input) => input.addEventListener('change', scheduleRender));
  $$('.verification-toggle').forEach((input) => input.addEventListener('change', scheduleRender));
  $$('.lifecycle-toggle').forEach((input) => input.addEventListener('change', scheduleRender));
  $('#timeline-slider').addEventListener('input', (event) => {
    state.allDates = false;
    state.selectedDate = state.dates[Number(event.target.value)] || state.selectedDate;
    scheduleRender();
  });
  $('#timeline-onset').addEventListener('click', () => {
    const reference = $('.verification-toggle[value="reference_unverified"]');
    reference.checked = true;
    setLifecycleSelection(['active', 'ongoing', 'resolved', 'expired', 'needs_review']);
    state.allDates = false;
    state.selectedDate = state.onsetDate;
    $('#timeline-slider').value = String(Math.max(state.dates.indexOf(state.onsetDate), 0));
    scheduleRender();
    $('#live').textContent = `${formatDateKey(state.onsetDate)}の発生当初情報を、未確認の報道・参考情報を含めて表示します。`;
  });
  $('#timeline-current').addEventListener('click', () => {
    $('.verification-toggle[value="reference_unverified"]').checked = false;
    setLifecycleSelection(['active', 'ongoing']);
    state.allDates = false;
    state.selectedDate = state.dates.at(-1) || null;
    $('#timeline-slider').value = String(Math.max(state.dates.length - 1, 0));
    scheduleRender();
  });
  $('#timeline-all').addEventListener('click', () => {
    state.allDates = true;
    scheduleRender();
  });
  form.addEventListener('reset', () => {
    setTimeout(() => {
      $$('.priority-toggle').forEach((input) => { input.checked = true; });
      $$('.verification-toggle').forEach((input) => { input.checked = input.value !== 'reference_unverified'; });
      setLifecycleSelection(['active', 'ongoing']);
      state.allDates = false;
      state.selectedDate = state.dates.at(-1) || null;
      $('#timeline-slider').value = String(Math.max(state.dates.length - 1, 0));
      scheduleRender();
    }, 0);
  });
  $$('input[name="basemap"]').forEach((input) => input.addEventListener('change', () => {
    if (!state.mapReady) return;
    const standard = input.value === 'standard' && input.checked;
    state.map.setLayoutProperty('gsi-pale', 'visibility', standard ? 'none' : 'visible');
    state.map.setLayoutProperty('gsi-standard', 'visibility', standard ? 'visible' : 'none');
  }));
  $$('.export-row a').forEach((link) => {
    const path = new URL(link.href).pathname;
    link.href = `${apiBase}${path}`;
  });
}

bindControls();
initializeMap();
render();
loadReports();
loadWeather();
