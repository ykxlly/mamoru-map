import { fetchJsonWithRecovery, plateauCenterFromTileset } from './plateau-location.js';

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
  });
}

const EMPTY_GEOJSON = { type: 'FeatureCollection', features: [] };
const HAZARD_STORAGE_KEY = 'mamoru-map-hazard-layers';
const PLATEAU_3D_STORAGE_KEY = 'mamoru-map-3d-display';
const ONBOARDING_STORAGE_KEY = 'mamoru-map-onboarding-seen-v1';
const HAZARD_STYLE = {
  landslide: { color: '#8a5a2b', outline: '#5e3c1f', pattern: '斜線' }
};
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
const ROAD_STATUS_LABELS = { recently_passed: '直近に通行実績あり', restricted: '交通規制あり', closed: '通行止め', unknown: '通行状況不明' };
const MARKER_ICONS = {
  earthquake: '🫨', tsunami: '🌊', typhoon: '🌀', rain_flood: '☔', volcano: '🌋', snow: '❄️', road: '🚧',
  warning: '⚠️', damage: '🏚️', road_closed: '🚧', shelter: '🏠', support: '🤝', other: '⚠️'
};
// 「災害の記録」ドロップダウンの表示ラベル用。災害種別(event_kind)ごとの絵文字。
// バックエンドの実 event_kind: earthquake / tsunami / volcano / typhoon / rain_flood(大雨・洪水を統合) / snow / road。
// 未定義・未知の種別は ⚠️ にフォールバックする。絵文字は表示のみで value/event_key には含めない。
const EVENT_KIND_ICONS = { earthquake: '🫨', tsunami: '🌊', typhoon: '🌀', rain_flood: '☔', volcano: '🌋', snow: '❄️', road: '🚧' };
function eventKindIcon(kind) { return EVENT_KIND_ICONS[kind] || '⚠️'; }
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
  events: [],
  selectedEventKey: '',
  timeBuckets: [],
  selectedBucketIndex: null,
  plateauRequest: 0,
  hazardRequest: 0,
  hazardAbort: null,
  hazardConfigs: new Map(),
  hazardBound: new Set(),
  hazardEnabled: new Set(),
  plateau3dRequest: 0,
  plateau3dConfig: null,
  plateau3dEnabled: false,
  plateau3dRenderer: null,
  plateau3dLoadPromise: null,
  plateauRegions: [],
  selectedPlateauCode: '',
  selectedPlateauRegion: null,
  plateauVerifiedCenters: new Map(),
  plateauAvailability: null,
  plateauHazards: []
};

// 気象庁の公開タイルを、利用者が選んだときだけ取得する。雨雲は最新の観測1枚であり、
// アニメーションや予報タイルは表示しない。
const JMA_TILE_LAYERS = {
  rain: {
    id: 'jma-rain-radar', toggle: '#layer-rain', status: '#rain-status',
    index: 'https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N1.json',
    path: (time) => `https://www.jma.go.jp/bosai/jmatile/data/nowc/${time.basetime}/none/${time.validtime}/surf/hrpns/{z}/{x}/{y}.png`,
    label: '雨雲レーダー', opacity: 0.6, maxzoom: 10,
    attribution: '<a href="https://www.jma.go.jp/bosai/nowc/" target="_blank" rel="noreferrer">気象庁 ナウキャスト</a>'
  },
  land: {
    id: 'jma-risk-land', toggle: '#layer-risk-land', status: '#risk-land-status',
    index: 'https://www.jma.go.jp/bosai/jmatile/data/risk/targetTimes.json',
    path: (time) => `https://www.jma.go.jp/bosai/jmatile/data/risk/${time.basetime}/none/${time.validtime}/surf/land/{z}/{x}/{y}.png`,
    label: '土砂災害の危険度', opacity: 0.65, maxzoom: 12,
    attribution: '<a href="https://www.jma.go.jp/bosai/risk/" target="_blank" rel="noreferrer">気象庁 危険度分布</a>'
  },
  inund: {
    id: 'jma-risk-inund', toggle: '#layer-risk-inund', status: '#risk-inund-status',
    index: 'https://www.jma.go.jp/bosai/jmatile/data/risk/targetTimes.json',
    path: (time) => `https://www.jma.go.jp/bosai/jmatile/data/risk/${time.basetime}/none/${time.validtime}/surf/inund/{z}/{x}/{y}.png`,
    label: '浸水の危険度', opacity: 0.65, maxzoom: 12,
    attribution: '<a href="https://www.jma.go.jp/bosai/risk/" target="_blank" rel="noreferrer">気象庁 危険度分布</a>'
  },
  thunder: {
    id: 'jma-nowc-thunder', toggle: '#layer-thunder', status: '#thunder-status',
    index: 'https://www.jma.go.jp/bosai/jmatile/data/nowc/targetTimes_N3.json',
    path: (time) => `https://www.jma.go.jp/bosai/jmatile/data/nowc/${time.basetime}/none/${time.validtime}/surf/thns/{z}/{x}/{y}.png`,
    label: '雷の活動度', opacity: 0.6, maxzoom: 10,
    attribution: '<a href="https://www.jma.go.jp/bosai/nowc/" target="_blank" rel="noreferrer">気象庁 ナウキャスト</a>'
  }
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function formatJmaTileTime(value) {
  const digits = String(value || '');
  if (!/^\d{12,14}$/.test(digits)) return '最新';
  return `${digits.slice(0, 4)}/${digits.slice(4, 6)}/${digits.slice(6, 8)} ${digits.slice(8, 10)}:${digits.slice(10, 12)}`;
}

async function toggleJmaTileLayer(key, enabled) {
  const config = JMA_TILE_LAYERS[key];
  const status = $(config.status);
  const map = state.map;
  if (!map || !state.mapReady) {
    if (status) status.textContent = '地図の準備が完了してから表示します。';
    return;
  }
  const remove = () => {
    if (map.getLayer(config.id)) map.removeLayer(config.id);
    if (map.getSource(config.id)) map.removeSource(config.id);
  };
  remove();
  if (!enabled) {
    if (status) status.textContent = '';
    return;
  }
  if (status) status.textContent = '気象庁の最新時刻を確認しています…';
  try {
    const response = await fetch(config.index, { cache: 'no-store' });
    if (!response.ok) throw new Error(`JMA index ${response.status}`);
    const times = await response.json();
    const observed = times.find((item) => item.basetime === item.validtime) || times[0];
    if (!observed?.basetime || !observed?.validtime) throw new Error('JMA tile time missing');
    map.addSource(config.id, {
      type: 'raster', tiles: [config.path(observed)], tileSize: 256,
      maxzoom: config.maxzoom, attribution: config.attribution
    });
    const before = map.getLayer('report-halo') ? 'report-halo' : undefined;
    if (before) map.addLayer({ id: config.id, type: 'raster', source: config.id, paint: { 'raster-opacity': config.opacity } }, before);
    else map.addLayer({ id: config.id, type: 'raster', source: config.id, paint: { 'raster-opacity': config.opacity } });
    if (status) status.textContent = `${formatJmaTileTime(observed.basetime)}時点の${config.label}（気象庁）`;
  } catch {
    remove();
    const input = $(config.toggle); if (input) input.checked = false;
    if (status) status.textContent = `${config.label}を取得できませんでした。時間をおいて再度お試しください。`;
  }
}

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
    center: [138, 36],
    zoom: 4.2,
    minZoom: 3,
    maxZoom: 18,
    attributionControl: false
  });
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'bottom-right');
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.on('load', () => {
    Object.entries(MARKER_ICONS).forEach(([name, emoji]) => map.addImage(`emoji-${name}`, createEmojiImage(emoji), { pixelRatio: 2 }));
    map.addImage('emoji-shelter-facility', createEmojiImage('🏠'), { pixelRatio: 2 });
    map.addImage('emoji-water-facility', createEmojiImage('💧'), { pixelRatio: 2 });
    addReferenceLayer(map, 'shelters', '#2f7d5b');
    addReferenceLayer(map, 'water', '#2777a8');
    map.addSource('reports', { type: 'geojson', data: EMPTY_GEOJSON });
    map.addLayer({
      id: 'report-halo',
      type: 'circle',
      source: 'reports',
      layout: { visibility: 'none' },
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
      layout: { visibility: 'none' },
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
    map.addLayer({
      id: 'report-symbols',
      type: 'symbol',
      source: 'reports',
      layout: {
        'icon-image': ['concat', 'emoji-', ['get', 'marker_icon']],
        'icon-size': ['interpolate', ['linear'], ['zoom'], 4, 0.72, 10, 0.92],
        'icon-allow-overlap': true,
        'icon-ignore-placement': true
      }
    });
    const selectFeature = (event) => {
      const id = String(event.features?.[0]?.properties?.id ?? '');
      const report = state.reports.find((item) => String(item.id) === id);
      if (report) selectReport(report, false);
    };
    ['report-symbols'].forEach((layer) => {
      map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer'; });
      map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = ''; });
      map.on('click', layer, selectFeature);
    });
    state.mapReady = true;
    updateMap();
    fitInitialBounds();
  });
  map.on('error', (event) => {
    if (event?.error) $('#live').textContent = '地図タイルの一部を読み込めませんでした。';
  });
  map.on('error', (event) => {
    const sourceId = event?.sourceId || '';
    const failed = [...state.hazardConfigs.values()].find((config) => hazardIds(config.hazardType).source === sourceId);
    if (!failed) return;
    state.hazardEnabled.delete(failed.hazardType);
    [hazardIds(failed.hazardType).fill, hazardIds(failed.hazardType).line].forEach((id) => {
      if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
    });
    const input = [...document.querySelectorAll('#hazard-controls input')].find((item) => item.getAttribute('aria-label') === `${failed.label}の想定リスクを表示`);
    if (input) input.checked = false;
    const status = $('#hazard-status'); if (status) status.textContent = `${failed.label}レイヤーの配信を読み込めませんでした。現在の災害情報は引き続き表示されます。`;
    saveHazardSelection(); renderHazardLegend();
  });
  state.map = map;
}

function addReferenceLayer(map, kind, color) {
  const iconName = kind === 'water' ? 'emoji-water-facility' : 'emoji-shelter-facility';
  map.addSource(kind, { type: 'geojson', data: EMPTY_GEOJSON });
  map.addLayer({
    id: `${kind}-points`,
    type: 'circle',
    source: kind,
    layout: { visibility: 'none' },
    paint: {
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 8, 3.5, 14, 6.5],
      'circle-color': color,
      'circle-opacity': 0.85,
      'circle-stroke-width': 1.5,
      'circle-stroke-color': '#ffffff'
    }
  });
  map.addLayer({
    id: `${kind}-symbols`,
    type: 'symbol',
    source: kind,
    layout: {
      visibility: 'none',
      'icon-image': iconName,
      'icon-size': ['interpolate', ['linear'], ['zoom'], 8, 0.5, 14, 0.8],
      'icon-allow-overlap': false,
      'icon-optional': true
    }
  });
  map.on('mouseenter', `${kind}-points`, () => { map.getCanvas().style.cursor = 'pointer'; });
  map.on('mouseleave', `${kind}-points`, () => { map.getCanvas().style.cursor = ''; });
  map.on('click', `${kind}-points`, (event) => {
    const props = event.features?.[0]?.properties;
    if (!props) return;
    new maplibregl.Popup({ closeButton: true, maxWidth: '260px' })
      .setLngLat(event.lngLat)
      .setHTML(referencePopupHtml(kind, props))
      .addTo(map);
  });
}

function hazardIds(hazardType) {
  return { source: `plateau-hazard-${hazardType}`, fill: `plateau-hazard-${hazardType}-fill`, line: `plateau-hazard-${hazardType}-line` };
}

function addHazardLayer(config) {
  const map = state.map;
  if (!map || !state.mapReady || !map.isStyleLoaded() || !config?.available || config.format !== 'MVT (TileJSON)') return false;
  const ids = hazardIds(config.hazardType);
  if (!map.getSource(ids.source)) map.addSource(ids.source, { type: 'vector', url: config.tilesUrl, attribution: config.attribution || '国土交通省 PLATEAU' });
  const style = HAZARD_STYLE[config.hazardType] || HAZARD_STYLE.landslide;
  const before = map.getLayer('report-halo') ? 'report-halo' : undefined;
  const addedFill = !map.getLayer(ids.fill);
  if (addedFill) map.addLayer({
    id: ids.fill, type: 'fill', source: ids.source, 'source-layer': config.layerName, minzoom: config.minZoom ?? 0, maxzoom: config.maxZoom ?? 24,
    layout: { visibility: 'none' }, paint: { 'fill-color': style.color, 'fill-opacity': 0.28 }
  }, before);
  if (!map.getLayer(ids.line)) map.addLayer({
    id: ids.line, type: 'line', source: ids.source, 'source-layer': config.layerName, minzoom: config.minZoom ?? 0, maxzoom: config.maxZoom ?? 24,
    layout: { visibility: 'none' }, paint: { 'line-color': style.outline, 'line-width': 1.35, 'line-opacity': 0.8, 'line-dasharray': [2, 1.5] }
  }, before);
  if (addedFill && !state.hazardBound.has(config.hazardType)) {
    map.on('click', ids.fill, (event) => showHazardPopup(event, state.hazardConfigs.get(config.hazardType)));
    map.on('mouseenter', ids.fill, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', ids.fill, () => { map.getCanvas().style.cursor = ''; });
    state.hazardBound.add(config.hazardType);
  }
  return true;
}

function removeHazardLayers() {
  const map = state.map; if (!map) return;
  [...state.hazardConfigs.values()].forEach((config) => {
    const ids = hazardIds(config.hazardType);
    if (map.getLayer(ids.line)) map.removeLayer(ids.line);
    if (map.getLayer(ids.fill)) map.removeLayer(ids.fill);
    if (map.getSource(ids.source)) map.removeSource(ids.source);
  });
  state.hazardEnabled.clear();
}

function setHazardVisibility(config, visible) {
  const ids = hazardIds(config.hazardType);
  if (!addHazardLayer(config)) return false;
  [ids.fill, ids.line].forEach((id) => {
    if (state.map.getLayer(id)) state.map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none');
  });
  if (visible) state.hazardEnabled.add(config.hazardType); else state.hazardEnabled.delete(config.hazardType);
  saveHazardSelection();
  renderHazardLegend();
  return true;
}

function showHazardPopup(event, config) {
  if (!config) return;
  const props = event.features?.[0]?.properties || {};
  const content = element('div', 'popup-content');
  content.append(element('div', 'popup-priority', `${config.label}（想定リスク）`));
  const fields = [
    ['想定浸水深または区域区分', props.description || props.rank || props.areaType || 'データなし'],
    ['市区町村', props.cityName || props.municipality || config.municipalityCode || 'データなし'],
    ['整備年度', config.datasetYear || 'データなし'],
    ['出典', config.sourceName || 'データなし'],
    ['データ確認日時', config.lastCheckedAt ? formatShortTime(config.lastCheckedAt) : 'データなし']
  ];
  fields.forEach(([label, value]) => content.append(element('p', 'popup-summary', `${label}: ${value}`)));
  new maplibregl.Popup({ closeButton: true, maxWidth: '20rem' }).setLngLat(event.lngLat).setDOMContent(content).addTo(state.map);
}

function loadSavedHazardSelection() {
  try { return new Set(JSON.parse(localStorage.getItem(HAZARD_STORAGE_KEY) || '[]').filter((value) => typeof value === 'string')); } catch { return new Set(); }
}

function saveHazardSelection() {
  try { localStorage.setItem(HAZARD_STORAGE_KEY, JSON.stringify([...state.hazardEnabled])); } catch { /* storage is optional */ }
}

function referencePopupHtml(kind, props) {
  const kindLabel = kind === 'water' ? '災害時給水拠点' : '指定緊急避難場所（地震）';
  const name = escapeHtml(props.name || '名称不明');
  const address = props.address ? `<p class="ref-popup-addr">${escapeHtml(props.address)}</p>` : '';
  const remarks = props.remarks ? `<p class="ref-popup-remarks">${escapeHtml(props.remarks)}</p>` : '';
  const note = kind === 'water'
    ? '実際の給水実施は各水道局の発表を確認してください。'
    : '実際に開設されているかは各自治体の発表を確認してください。';
  return `<div class="ref-popup"><span class="ref-popup-kind">${kindLabel}</span>`
    + `<strong class="ref-popup-name">${name}</strong>${address}${remarks}`
    + `<p class="ref-popup-note">${note}</p></div>`;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]
  ));
}

function createEmojiImage(emoji) {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const context = canvas.getContext('2d');
  context.clearRect(0, 0, size, size);
  context.font = '42px "Segoe UI Emoji", "Apple Color Emoji", sans-serif';
  context.textAlign = 'center';
  context.textBaseline = 'middle';
  context.fillText(emoji, size / 2, size / 2 + 2);
  return context.getImageData(0, 0, size, size);
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
  const roadStatus = ROAD_STATUS_LABELS[report.road_status] ? report.road_status : 'unknown';
  const reportType = TYPE_LABELS[report.report_type] ? report.report_type : 'other';
  const eventKind = String(report.event_kind || '').trim();
  const markerIcon = EVENT_KIND_ICONS[eventKind] ? eventKind : (reportType === 'road' ? 'road' : 'other');
  return {
    ...report,
    id: String(report.id),
    title: String(report.title || '無題'),
    summary: String(report.summary || '詳細は原文をご確認ください。'),
    area: String(report.area && report.area !== 'unknown' ? report.area : '地域不明'),
    category: report.category === 'official' ? 'official' : 'news',
    report_type: reportType,
    priority: PRIORITY_LABELS[report.priority] ? report.priority : derivePriority(report),
    latitude: Number.isFinite(latitude) ? latitude : null,
    longitude: Number.isFinite(longitude) ? longitude : null,
    verification_status: verificationStatus,
    lifecycle_status: lifecycleStatus,
    information_class: informationClass,
    location_precision: locationPrecision,
    road_status: roadStatus,
    roadStatusLabel: ROAD_STATUS_LABELS[roadStatus],
    markerIcon,
    markerEmoji: MARKER_ICONS[markerIcon] || MARKER_ICONS.other,
    event_key: String(report.event_key || ''),
    event_name: String(report.event_name || ''),
    event_kind: String(report.event_kind || ''),
    eventTimestamp: timestamp(report.published_at || report.retrieved_at),
    bucketStart: bucketStartOf(report.published_at || report.retrieved_at),
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
      && (!state.selectedEventKey || (report.event_key === state.selectedEventKey && report.eventTimestamp < selectedBucketEnd()))
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

// 10分刻みのタイムライン。10分境界はUTC epochを丸めるだけでJSTでも:00/:10/…に一致する。
const BUCKET_MS = 10 * 60 * 1000;

function bucketStartOf(value) {
  const time = new Date(value || '').getTime();
  return Number.isNaN(time) ? null : Math.floor(time / BUCKET_MS) * BUCKET_MS;
}

function selectedBucketEnd() {
  const bucket = state.timeBuckets[state.selectedBucketIndex];
  return Number.isFinite(bucket) ? bucket + BUCKET_MS : Number.POSITIVE_INFINITY;
}

function formatBucket(value) {
  if (!Number.isFinite(value)) return '災害を選択';
  return new Intl.DateTimeFormat('ja-JP', {
    timeZone: 'Asia/Tokyo', year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false
  }).format(new Date(value));
}

function initializeTimeline() {
  const grouped = new Map();
  state.reports.filter((report) => report.event_key && Number.isFinite(report.bucketStart)).forEach((report) => {
    if (!grouped.has(report.event_key)) grouped.set(report.event_key, []);
    grouped.get(report.event_key).push(report);
  });
  state.events = [...grouped.entries()].flatMap(([key, reports]) => {
    const buckets = [...new Set(reports.map((report) => report.bucketStart))].sort((a, b) => a - b);
    if (reports.length < 2 || buckets.length < 2) return [];
    return [{ key, name: reports[0].event_name || key, reports, buckets, first: buckets[0], last: buckets.at(-1) }];
  }).sort((a, b) => b.last - a.last);
  state.selectedEventKey = '';
  state.timeBuckets = [];
  state.selectedBucketIndex = null;
  const select = $('#event-select');
  select.replaceChildren(new Option('🗺️ すべての災害', ''));
  state.events.forEach((event) => {
    const icon = eventKindIcon(event.reports[0]?.event_kind || String(event.key).split(':')[0]);
    select.append(new Option(`${icon} ${event.name}（${event.reports.length}件）`, event.key));
  });
  configureTimelineForEvent('');
}

function configureTimelineForEvent(eventKey) {
  state.selectedEventKey = eventKey;
  const event = state.events.find((item) => item.key === eventKey);
  const slider = $('#timeline-slider');
  if (event) {
    // 情報がある10分バケットだけを停留点にする（疎なタイムライン）。
    // 発生から選択時点までを累積表示するので、事故・火災が起きた順に一つの流れとして辿れる。
    state.timeBuckets = event.buckets;
    state.selectedBucketIndex = state.timeBuckets.length - 1;
  } else {
    state.timeBuckets = [];
    state.selectedBucketIndex = null;
  }
  const enabled = Boolean(event && state.timeBuckets.length);
  slider.min = '0';
  slider.max = String(Math.max(state.timeBuckets.length - 1, 0));
  slider.value = String(Math.max(state.selectedBucketIndex ?? 0, 0));
  slider.disabled = !enabled;
  ['#timeline-onset', '#timeline-current', '#timeline-clear'].forEach((selector) => { $(selector).disabled = !enabled; });
  $('#timeline-start').textContent = enabled ? formatBucket(state.timeBuckets[0]) : '―';
  $('#timeline-end').textContent = enabled ? formatBucket(state.timeBuckets.at(-1)) : '―';
  updateTimelineDisplay();
}

function updateTimelineDisplay() {
  const output = $('#timeline-date');
  output.textContent = state.selectedEventKey ? `${formatBucket(state.timeBuckets[state.selectedBucketIndex])}まで` : '災害を選択';
  $('#timeline-help').textContent = state.selectedEventKey
    ? '発生時からの出来事を10分刻みで積み上げ、一つの流れとして表示します。未確認情報は原文で確認してください。'
    : '災害を選ぶと、発生からの経過を10分刻みで表示します。';
}

function render() {
  state.filtered = filterReports();
  updateTimelineDisplay();
  renderCounts();
  renderSummary();
  renderList();
  updateMap();
}

function renderSummary() {
  const panel = $('#summary-panel');
  if (!panel) return;
  const reports = state.filtered;
  if (!reports.length) { panel.hidden = true; return; }
  panel.hidden = false;

  const priorityCounts = { emergency: 0, high: 0, medium: 0 };
  const typeCounts = {};
  reports.forEach((report) => {
    if (priorityCounts[report.priority] !== undefined) priorityCounts[report.priority] += 1;
    typeCounts[report.report_type] = (typeCounts[report.report_type] || 0) + 1;
  });

  const priorityBox = $('#summary-priority');
  priorityBox.replaceChildren();
  [['emergency', '緊急'], ['high', '高'], ['medium', '中']].forEach(([key, label]) => {
    const cell = element('div', `summary-priority-cell ${key}`);
    cell.append(element('strong', '', String(priorityCounts[key])));
    cell.append(element('small', '', label));
    priorityBox.append(cell);
  });

  const typeList = $('#summary-types');
  typeList.replaceChildren();
  Object.keys(TYPE_LABELS)
    .filter((type) => typeCounts[type])
    .sort((a, b) => typeCounts[b] - typeCounts[a])
    .forEach((type) => {
      const item = element('li', 'summary-type');
      item.append(element('span', 'summary-type-icon', MARKER_ICONS[type] || MARKER_ICONS.other));
      item.append(element('span', 'summary-type-label', TYPE_LABELS[type]));
      item.append(element('strong', 'summary-type-count', String(typeCounts[type])));
      typeList.append(item);
    });
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
      && (!state.selectedEventKey || (report.event_key === state.selectedEventKey && report.eventTimestamp < selectedBucketEnd())))
    .forEach((report) => { totals[report.priority] += 1; });
  Object.entries(totals).forEach(([key, value]) => { $(`#count-${key}`).textContent = value; });
  $('#visible-count').textContent = state.filtered.length;
  $('#drawer-visible-count').textContent = state.filtered.length;
  const mapped = state.filtered.filter(hasCoordinates).length;
  const event = state.events.find((item) => item.key === state.selectedEventKey);
  const period = event ? `${event.name}・${formatBucket(state.timeBuckets[state.selectedBucketIndex])}まで` : '現在の全国情報';
  $('#result-status').textContent = `${period}：${state.filtered.length}件を表示・地図上${mapped}件（履歴全${state.reports.length}件）`;
}

function renderList() {
  const list = $('#event-list');
  list.replaceChildren();
  list.setAttribute('aria-busy', 'false');
  if (!state.filtered.length) {
    const empty = element('div', 'empty-state');
    empty.append(element('strong', '', '条件に一致する情報はありません'));
    empty.append(element('p', '', '検索語や絞り込み条件を変更するか、「条件を解除」を選んでください。'));
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
  target.append(element('span', 'event-title', `${report.markerEmoji} ${report.title}`));
  target.append(element('span', 'event-place', `⌖ ${report.area}`));
  target.append(element('span', 'event-summary', report.summary));
  if (report.report_type === 'road') {
    const road = element('span', `road-status road-${report.road_status}`);
    road.append(element('strong', '', `🚧 ${report.roadStatusLabel}`));
    road.append(element('small', '', `確認時刻: ${formatShortTime(report.last_verified_at || report.retrieved_at)}。現在の通行可否は道路管理者の案内を確認してください。`));
    target.append(road);
  }
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
      location_precision: report.location_precision,
      marker_icon: report.markerIcon
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

async function populatePlateauAreas() {
  const prefectureSelect = $('#plateau-prefecture-select');
  if (!prefectureSelect) return;
  try {
    const response = await fetch(`${apiBase}/api/plateau/regions`, { headers: { accept: 'application/json' }, priority: 'low' });
    if (response.ok) {
      const payload = await response.json();
      state.plateauRegions = (payload.regions || []).filter((region) => region.is_available);
    }
  } catch { /* PLATEAU機能だけを利用不可にし、地図と災害情報は継続する */ }
  const prefectures = new Map();
  state.plateauRegions.forEach((region) => {
    const key = String(region.prefecture_code || region.prefecture_name || '').trim();
    if (key && !prefectures.has(key)) prefectures.set(key, region.prefecture_name || key);
  });
  prefectureSelect.replaceChildren(new Option('都道府県を選択', ''));
  [...prefectures].sort((a, b) => a[1].localeCompare(b[1], 'ja')).forEach(([value, label]) => prefectureSelect.append(new Option(label, value)));
  prefectureSelect.disabled = prefectures.size === 0;
  populatePlateauMunicipalities('');
  renderPlateauRegionBrowser();
}

function populatePlateauMunicipalities(prefectureKey, selectedCode = '') {
  const select = $('#plateau-area-select');
  if (!select) return;
  const regions = state.plateauRegions
    .filter((region) => !prefectureKey || String(region.prefecture_code || region.prefecture_name || '').trim() === prefectureKey)
    .sort((a, b) => String(a.city_name || '').localeCompare(String(b.city_name || ''), 'ja'));
  select.replaceChildren(new Option(prefectureKey ? '市区町村を選択' : '先に都道府県を選択', ''));
  regions.forEach((region) => {
    const code = String(region.municipality_code || '').trim();
    if (/^\d{5}$/.test(code)) select.append(new Option(region.city_name || code, `plateau-${code}`));
  });
  select.disabled = !prefectureKey || regions.length === 0;
  if (selectedCode && [...select.options].some((option) => option.value === `plateau-${selectedCode}`)) select.value = `plateau-${selectedCode}`;
}

function renderPlateauRegionBrowser() {
  const list = $('#plateau-region-list'); const count = $('#plateau-region-count');
  if (!list || !count) return;
  const query = String($('#plateau-region-search')?.value || '').trim().toLocaleLowerCase('ja');
  const regions = state.plateauRegions.filter((region) => `${region.prefecture_name || ''}${region.city_name || ''}`.toLocaleLowerCase('ja').includes(query));
  list.replaceChildren();
  if (!state.plateauRegions.length) { count.textContent = '対応自治体を取得できませんでした。地図または一覧から地域を選ぶと確認できます。'; return; }
  count.textContent = query ? `${regions.length}件の対応自治体` : `対応自治体 ${regions.length}件`;
  const fragment = document.createDocumentFragment();
  regions.slice(0, 80).forEach((region) => {
    const code = String(region.municipality_code || '');
    const item = element('li'); const button = element('button', '', `${region.prefecture_name || ''}${region.city_name || code}`);
    button.type = 'button'; button.addEventListener('click', () => {
      selectPlateauRegion(code);
    });
    item.append(button); fragment.append(item);
  });
  list.append(fragment);
}

function syncPlateauAreaSelection(report) {
  const code = String(report.municipality_code || report.city_code || '').trim();
  if (/^\d{5}$/.test(code)) selectPlateauRegion(code, { load: false });
}

function selectedPlateauReport(code) {
  const region = state.plateauRegions.find((item) => String(item.municipality_code || '') === code);
  if (!region) return null;
  return { id: `plateau-${code}`, area: `${region.prefecture_name || ''}${region.city_name || ''}`, municipality_code: code };
}

function updatePlateauSelectionUi() {
  const region = state.selectedPlateauRegion; const code = state.selectedPlateauCode;
  $('#plateau-selected-code').textContent = code || '未選択';
  $('#plateau-selected-region').textContent = region ? `${region.prefecture_name || ''}${region.city_name || ''}` : '未選択';
  const hasSelection = Boolean(region && /^\d{5}$/.test(code));
  $('#plateau-view-region').disabled = !hasSelection;
  $('#plateau-clear').disabled = !hasSelection;
  const selectedDisaster = state.reports.find((item) => item.id === state.selectedId);
  const disasterCode = String(selectedDisaster?.municipality_code || selectedDisaster?.city_code || '');
  $('#plateau-region-mismatch').hidden = !hasSelection || !/^\d{5}$/.test(disasterCode) || disasterCode === code;
}

function resetPlateauCapabilitySummary() {
  const values = ['data', '3d', 'landslide', 'other', 'year', 'spec', 'checked'];
  values.forEach((name) => { const target = $(`#plateau-capability-${name}`); if (target) target.textContent = '未確認'; });
  $('#plateau-open-3d').disabled = true;
  $('#plateau-open-landslide').disabled = true;
}

function selectPlateauRegion(code, options = {}) {
  const region = state.plateauRegions.find((item) => String(item.municipality_code || '') === String(code));
  if (!region) return;
  state.selectedPlateauCode = String(code); state.selectedPlateauRegion = region;
  const prefectureKey = String(region.prefecture_code || region.prefecture_name || '').trim();
  $('#plateau-prefecture-select').value = prefectureKey;
  populatePlateauMunicipalities(prefectureKey, state.selectedPlateauCode);
  updatePlateauSelectionUi(); resetPlateauCapabilitySummary();
  if (options.load === false) return;
  const report = selectedPlateauReport(state.selectedPlateauCode);
  loadPlateauAvailability(report); loadPlateau3dConfig(report); loadHazardConfig(report);
  $('#live').textContent = `${report.area}のPLATEAU対応状況を表示します。地図や3Dは操作ボタンを押したときだけ切り替わります。`;
}

function selectReport(report, moveMap) {
  state.selectedId = report.id;
  const drawer = $('#event-list-drawer');
  if (drawer && !drawer.open) drawer.open = true;
  syncPlateauAreaSelection(report);
  loadPlateauAvailability(report);
  loadPlateau3dConfig(report);
  loadHazardConfig(report);
  $$('.event-card').forEach((card) => { card.dataset.selected = String(card.dataset.id === report.id); });
  document.querySelector(`.event-card[data-id="${CSS.escape(String(report.id))}"]`)?.scrollIntoView({ block: 'nearest', behavior: reducedMotion ? 'auto' : 'smooth' });
  if (!hasCoordinates(report) || !state.mapReady) {
    $('#live').textContent = 'この情報には地図上の位置がありません。原文で場所をご確認ください。';
    return;
  }
  if (moveMap) {
    state.map.easeTo({ center: [report.longitude, report.latitude], zoom: Math.max(state.map.getZoom(), 12), duration: reducedMotion ? 0 : 500 });
  }
  showPopup(report);
  $('#live').textContent = `${report.area}の情報を地図に表示しました。PLATEAU対応状況も更新しました。`;
}

function setPlateauStatus(status, message) {
  const target = $('#plateau-status');
  if (!target) return;
  target.dataset.state = status;
  target.textContent = message;
}

function renderPlateauDetails(datasets) {
  const details = $('#plateau-details');
  if (!details) return;
  details.replaceChildren();
  const list = element('ul', 'plateau-dataset-list');
  datasets.forEach((dataset) => {
    const item = element('li');
    item.append(element('strong', '', dataset.city_name || dataset.municipality_code));
    item.append(element('span', '', `データセット: ${dataset.feature_types_json || '記載なし'}`));
    item.append(element('span', '', `整備年度: ${dataset.dataset_year || '記載なし'}`));
    item.append(element('span', '', `仕様バージョン: ${dataset.specification_version || '記載なし'}`));
    list.append(item);
  });
  details.append(list);
  details.hidden = false;
  const years = [...new Set(datasets.map((item) => item.dataset_year).filter(Boolean))].sort().reverse();
  const specs = [...new Set(datasets.map((item) => item.specification_version).filter(Boolean))].sort().reverse();
  const checked = datasets.map((item) => item.last_checked_at || item.lastCheckedAt).filter(Boolean).sort().reverse()[0];
  $('#plateau-capability-data').textContent = '対応';
  $('#plateau-capability-year').textContent = years.join('、') || '記載なし';
  $('#plateau-capability-spec').textContent = specs.join('、') || '記載なし';
  $('#plateau-capability-checked').textContent = checked ? formatShortTime(checked) : (state.selectedPlateauRegion?.last_checked_at ? formatShortTime(state.selectedPlateauRegion.last_checked_at) : '記載なし');
  const nonBuilding = datasets.filter((item) => !String(item.feature_types_json || '').toLowerCase().includes('bldg'));
  $('#plateau-capability-other').textContent = nonBuilding.length ? `${nonBuilding.length}種類` : '記載なし';
}

function setPlateau3dStatus(message) { const status = $('#plateau-3d-status'); if (status) status.textContent = message; }
function savePlateau3dPreference() { try { localStorage.setItem(PLATEAU_3D_STORAGE_KEY, JSON.stringify({ buildings: state.plateau3dEnabled })); } catch { /* optional */ } }

function renderVerifiedPlateauCenters() {
  if (!state.mapReady) return;
  const features = [...state.plateauVerifiedCenters.entries()].map(([code, item]) => ({
    type: 'Feature', properties: { code, label: item.label }, geometry: { type: 'Point', coordinates: item.center }
  }));
  const data = { type: 'FeatureCollection', features };
  const source = state.map.getSource('plateau-verified-regions');
  if (source) source.setData(data);
  else {
    state.map.addSource('plateau-verified-regions', { type: 'geojson', data });
    state.map.addLayer({ id: 'plateau-verified-regions-halo', type: 'circle', source: 'plateau-verified-regions', paint: { 'circle-radius': 9, 'circle-color': '#ffffff', 'circle-stroke-width': 2, 'circle-stroke-color': '#007b72' } });
    state.map.addLayer({ id: 'plateau-verified-regions-dot', type: 'circle', source: 'plateau-verified-regions', paint: { 'circle-radius': 4, 'circle-color': '#007b72' } });
  }
}

async function viewSelectedPlateauRegion() {
  const config = state.plateau3dConfig; const code = state.selectedPlateauCode; const region = state.selectedPlateauRegion;
  if (!config?.available || !/^https:\/\/api\.plateauview\.mlit\.go\.jp\/datacatalog\/3dtiles\//.test(config.tilesetUrl || '')) {
    throw new Error('verified_plateau_position_unavailable');
  }
  const status = $('#plateau-map-position-status'); status.textContent = '公式PLATEAUデータから地図位置を確認しています…';
  let center = state.plateauVerifiedCenters.get(code)?.center;
  if (!center) {
    const tileset = await fetchJsonWithRecovery(config.tilesetUrl, { attempts: 2 });
    center = plateauCenterFromTileset(tileset);
    state.plateauVerifiedCenters.set(code, { center, label: `${region.prefecture_name || ''}${region.city_name || ''}` });
  }
  renderVerifiedPlateauCenters();
  state.map.easeTo({ center, zoom: Math.max(state.map.getZoom(), 11), duration: reducedMotion ? 0 : 550 });
  status.textContent = '公式PLATEAUデータで位置を確認し、対応自治体を地図上に表示しました。3D通信は開始していません。';
}

async function loadPlateau3dRenderer(forceReload = false) {
  if (forceReload) { state.plateau3dRenderer = null; state.plateau3dLoadPromise = null; }
  if (state.plateau3dRenderer) return state.plateau3dRenderer;
  if (!state.plateau3dLoadPromise) {
    const moduleUrl = forceReload ? `/plateau-3d.js?recovery=${Date.now()}` : '/plateau-3d.js';
    state.plateau3dLoadPromise = import(moduleUrl)
      .then((module) => {
        if (typeof module.showPlateauBuildings !== 'function' || typeof module.hidePlateauBuildings !== 'function') throw new Error('invalid_3d_renderer_module');
        state.plateau3dRenderer = module;
        return module;
      })
      .catch((error) => { state.plateau3dLoadPromise = null; throw error; });
  }
  return state.plateau3dLoadPromise;
}
function disablePlateau3d() {
  state.plateau3dRenderer?.hidePlateauBuildings(state.map); state.plateau3dEnabled = false; savePlateau3dPreference();
  const buildings = $('#plateau-buildings-3d'); const view = $('#plateau-view-3d'); const back = $('#plateau-return-2d');
  if (buildings) buildings.checked = false; if (view) view.checked = false; if (back) back.disabled = true;
  if (state.map) state.map.easeTo({ pitch: 0, bearing: 0, duration: reducedMotion ? 0 : 250 });
}

function renderPlateau3dConfig(config) {
  const panel = $('#plateau-3d-panel'); const view = $('#plateau-view-3d'); const buildings = $('#plateau-buildings-3d'); const back = $('#plateau-return-2d'); const meta = $('#plateau-3d-meta');
  if (!panel || !view || !buildings || !back || !meta) return;
  panel.hidden = false; disablePlateau3d(); state.plateau3dConfig = config;
  view.disabled = !config.available; buildings.disabled = !config.available; back.disabled = true;
  meta.replaceChildren();
  $('#plateau-capability-3d').textContent = config.available ? '対応' : '未対応';
  $('#plateau-open-3d').disabled = !config.available;
  if (config.available) {
    if (config.datasetYear) $('#plateau-capability-year').textContent = config.datasetYear;
    if (config.specificationVersion) $('#plateau-capability-spec').textContent = config.specificationVersion;
    if (config.lastCheckedAt) $('#plateau-capability-checked').textContent = formatShortTime(config.lastCheckedAt);
  }
  if (!config.available) { setPlateau3dStatus(config.reason || 'この地域には3D建築物データがありません。'); meta.hidden = true; return; }
  setPlateau3dStatus('公式の建築物3Dモデルを利用できます。必要なときだけ表示してください。');
  [['整備年度', config.datasetYear || 'データなし'], ['仕様', config.specificationVersion || 'データなし'], ['出典', config.sourceName || 'データなし'], ['最終確認', config.lastCheckedAt ? formatShortTime(config.lastCheckedAt) : 'データなし']].forEach(([key, value]) => {
    meta.append(element('dt', '', key), element('dd', '', value));
  });
  meta.hidden = false;
}

async function enablePlateau3d() {
  const config = state.plateau3dConfig;
  if (!config?.available || !state.mapReady) throw new Error('3d_renderer_unavailable');
  let renderer; let lastError;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      setPlateau3dStatus(attempt ? '接続を再確認して3D建築物を再読み込みしています…' : '3D描画モジュールを読み込んでいます…');
      renderer = await loadPlateau3dRenderer(attempt > 0);
      setPlateau3dStatus('3D建築物を読み込んでいます…');
      await renderer.showPlateauBuildings(state.map, config.tilesetUrl, { timeoutMs: 15000 });
      lastError = null; break;
    } catch (error) {
      lastError = error; renderer?.hidePlateauBuildings(state.map);
      if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  if (lastError) throw lastError;
  state.plateau3dEnabled = true; savePlateau3dPreference();
  $('#plateau-view-3d').checked = true; $('#plateau-buildings-3d').checked = true; $('#plateau-return-2d').disabled = false;
  state.map.easeTo({ pitch: 55, bearing: state.map.getBearing(), duration: reducedMotion ? 0 : 350 });
  setPlateau3dStatus('3D建築物を表示中です。軽量な2D表示にいつでも戻せます。');
}

async function loadPlateau3dConfig(report) {
  const panel = $('#plateau-3d-panel'); const code = String(report?.municipality_code || report?.city_code || '').trim();
  disablePlateau3d(); state.plateau3dConfig = null;
  if (!/^\d{5}$/.test(code)) { if (panel) panel.hidden = true; return; }
  if (panel) panel.hidden = false; setPlateau3dStatus('3D建築物の対応状況を確認中…');
  const requestId = ++state.plateau3dRequest;
  try {
    const response = await fetch(`${apiBase}/api/plateau/3d/config?municipality_code=${encodeURIComponent(code)}`, { headers: { accept: 'application/json' }, priority: 'low' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const config = await response.json();
    if (requestId !== state.plateau3dRequest || state.selectedPlateauCode !== code) return;
    renderPlateau3dConfig(config);
  } catch {
    if (requestId === state.plateau3dRequest) setPlateau3dStatus('3D建築物の対応状況を確認できませんでした。2D地図は引き続き利用できます。');
  }
}

function renderHazardControls(hazards) {
  const panel = $('#hazard-panel'); const controls = $('#hazard-controls'); const status = $('#hazard-status');
  if (!panel || !controls || !status) return;
  panel.hidden = false; controls.replaceChildren();
  state.hazardConfigs = new Map(hazards.map((hazard) => [hazard.hazardType, hazard]));
  const available = hazards.filter((hazard) => hazard.available);
  state.plateauHazards = hazards;
  const landslide = hazards.find((hazard) => hazard.hazardType === 'landslide');
  $('#plateau-capability-landslide').textContent = landslide?.available ? '対応' : '未対応';
  $('#plateau-open-landslide').disabled = !landslide?.available;
  status.textContent = available.length ? '想定リスクは初期状態で非表示です。必要なレイヤーだけ表示してください。' : 'MapLibreで直接表示できる想定リスクデータはありません。';
  const saved = loadSavedHazardSelection();
  hazards.forEach((hazard) => {
    const label = element('label', 'hazard-control'); label.dataset.available = String(Boolean(hazard.available));
    const input = document.createElement('input'); input.type = 'checkbox'; input.disabled = !hazard.available; input.checked = false; input.dataset.hazardType = hazard.hazardType;
    input.setAttribute('aria-label', `${hazard.label}の想定リスクを表示`);
    const detail = element('small', '', hazard.available ? `整備年度: ${hazard.datasetYear || 'データなし'} / 出典: ${hazard.sourceName || 'データなし'} / 最終確認: ${hazard.lastCheckedAt ? formatShortTime(hazard.lastCheckedAt) : 'データなし'}` : hazard.reason || 'データなし');
    input.addEventListener('change', () => { if (!setHazardVisibility(hazard, input.checked)) { input.checked = false; status.textContent = `${hazard.label}レイヤーを表示できませんでした。`; } });
    label.append(input, element('strong', '', hazard.label), detail); controls.append(label);
    if (hazard.available && saved.has(hazard.hazardType)) input.checked = setHazardVisibility(hazard, true);
  });
  renderHazardLegend();
}

function renderHazardLegend() {
  const legend = $('#hazard-legend'); if (!legend) return;
  legend.replaceChildren();
  const visible = [...state.hazardEnabled].map((type) => state.hazardConfigs.get(type)).filter(Boolean);
  visible.forEach((hazard) => {
    const style = HAZARD_STYLE[hazard.hazardType] || HAZARD_STYLE.landslide;
    const item = element('div', 'hazard-legend-item'); const swatch = element('span', 'hazard-swatch'); swatch.style.color = style.outline;
    item.append(swatch, element('span', '', `${hazard.label}（半透明・${style.pattern}輪郭）`)); legend.append(item);
  });
  legend.hidden = visible.length === 0;
}

async function loadHazardConfig(report) {
  const panel = $('#hazard-panel'); const code = String(report?.municipality_code || report?.city_code || '').trim();
  if (!/^\d{5}$/.test(code)) { if (panel) panel.hidden = true; return; }
  state.hazardAbort?.abort(); removeHazardLayers(); state.hazardConfigs = new Map(); state.hazardAbort = new AbortController();
  const requestId = ++state.hazardRequest; if (panel) panel.hidden = false;
  const status = $('#hazard-status'); if (status) status.textContent = '想定リスク設定を読込中…';
  try {
    const response = await fetch(`${apiBase}/api/plateau/hazards/config?municipality_code=${encodeURIComponent(code)}`, { headers: { accept: 'application/json' }, signal: state.hazardAbort.signal, priority: 'low' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (requestId !== state.hazardRequest || state.selectedPlateauCode !== code) return;
    renderHazardControls(payload.hazards || []);
  } catch (error) {
    if (error.name === 'AbortError' || requestId !== state.hazardRequest) return;
    if (status) status.textContent = '想定リスク設定を取得できませんでした。現在の災害情報は引き続き表示されます。';
  }
}

async function loadPlateauAvailability(report) {
  const details = $('#plateau-details');
  if (details) { details.hidden = true; details.replaceChildren(); }
  const code = String(report?.municipality_code || report?.city_code || '').trim();
  if (!/^\d{5}$/.test(code)) {
    setPlateauStatus('unknown', 'この情報には自治体コードがありません。別の地域を選ぶと対応状況を確認できます。');
    return;
  }
  const requestId = ++state.plateauRequest;
  setPlateauStatus('loading', '読込中…');
  try {
    const response = await fetch(`${apiBase}/api/plateau/availability?municipality_code=${encodeURIComponent(code)}`, { headers: { accept: 'application/json' }, priority: 'low' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload = await response.json();
    if (requestId !== state.plateauRequest || state.selectedPlateauCode !== code) return;
    if (payload.supported && payload.datasets?.length) {
      state.plateauAvailability = payload;
      setPlateauStatus('supported', 'PLATEAU対応地域');
      renderPlateauDetails(payload.datasets);
    } else {
      state.plateauAvailability = payload;
      $('#plateau-capability-data').textContent = '未対応';
      setPlateauStatus('unsupported', 'PLATEAU未対応地域');
    }
  } catch {
    if (requestId !== state.plateauRequest) return;
    setPlateauStatus('error', 'PLATEAU対応状況を取得できませんでした');
  }
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
  if (report.report_type === 'road') content.append(element('p', `popup-road-status road-${report.road_status}`, `🚧 ${report.roadStatusLabel}。現在の通行可否は道路管理者の案内を確認してください。`));
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
    renderHeatIndex(weather.heat_index);
    panel.setAttribute('aria-busy', 'false');
    panel.dataset.state = 'ready';
  } catch {
    $('#weather-time').textContent = '取得できません';
    $('#weather-notice').textContent = '現在の気象参考情報を取得できませんでした。気象庁・自治体の発表をご確認ください。';
    panel.setAttribute('aria-busy', 'false');
    panel.dataset.state = 'error';
  }
}

async function toggleReferenceLayer(kind, path, visible) {
  if (!state.mapReady) return;
  const visibility = visible ? 'visible' : 'none';
  [`${kind}-points`, `${kind}-symbols`].forEach((layer) => {
    if (state.map.getLayer(layer)) state.map.setLayoutProperty(layer, 'visibility', visibility);
  });
  if (!visible) return;
  if (state.referenceLoaded?.[kind]) return;
  try {
    const response = await fetch(`${apiBase}${path}`, { headers: { accept: 'application/json' }, priority: 'low' });
    if (!response.ok) throw new Error(`Reference API ${response.status}`);
    const data = await response.json();
    const source = state.map.getSource(kind);
    if (source) source.setData({ type: 'FeatureCollection', features: data.features || [] });
    state.referenceLoaded = { ...(state.referenceLoaded || {}), [kind]: true };
    const label = kind === 'water' ? '給水拠点' : '指定緊急避難場所';
    $('#live').textContent = `${label}を${(data.features || []).length}件表示しました。位置情報であり、実施状況は各機関の発表を確認してください。`;
  } catch {
    $('#live').textContent = 'レイヤーの読み込みに失敗しました。時間をおいて再度お試しください。';
    const input = $(kind === 'water' ? '#layer-water' : '#layer-shelters');
    if (input) input.checked = false;
    [`${kind}-points`, `${kind}-symbols`].forEach((layer) => {
      if (state.map.getLayer(layer)) state.map.setLayoutProperty(layer, 'visibility', 'none');
    });
  }
}

function renderHeatIndex(heat) {
  const box = $('#heat-index');
  if (!box) return;
  if (!heat || !Number.isFinite(Number(heat.wbgt_estimate))) { box.hidden = true; return; }
  box.hidden = false;
  box.dataset.level = heat.level || 'safe';
  $('#heat-index-value').textContent = `${heat.wbgt_estimate}${heat.unit || '°C'}`;
  $('#heat-index-level').textContent = heat.level_label || '';
  $('#heat-index-note').textContent = heat.authority_note || '';
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
    populatePlateauAreas();
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
  const drawer = $('#event-list-drawer');
  if (drawer && window.matchMedia('(max-width: 58rem)').matches) drawer.open = false;
  const onboarding = $('#onboarding-dialog');
  const markOnboardingSeen = () => { try { localStorage.setItem(ONBOARDING_STORAGE_KEY, '1'); } catch { /* storage is optional */ } };
  if (onboarding) {
    let onboardingSeen = false;
    try { onboardingSeen = localStorage.getItem(ONBOARDING_STORAGE_KEY) === '1'; } catch { /* storage is optional */ }
    $('#open-onboarding')?.addEventListener('click', () => onboarding.showModal());
    onboarding.addEventListener('close', markOnboardingSeen);
    if (!onboardingSeen) window.setTimeout(() => onboarding.showModal(), 300);
  }
  const form = $('#filter-form');
  $('#plateau-region-search')?.addEventListener('input', renderPlateauRegionBrowser);
  form.addEventListener('submit', (event) => { event.preventDefault(); scheduleRender(); });
  $('#search-query').addEventListener('input', scheduleRender);
  ['#filter-area', '#filter-type', '#filter-sort', '#emergency-only'].forEach((selector) => $(selector).addEventListener('change', scheduleRender));
  $$('.priority-toggle').forEach((input) => input.addEventListener('change', scheduleRender));
  $$('.verification-toggle').forEach((input) => input.addEventListener('change', scheduleRender));
  $$('.lifecycle-toggle').forEach((input) => input.addEventListener('change', scheduleRender));
  $('#event-select').addEventListener('change', (event) => {
    const eventKey = event.target.value;
    if (eventKey) {
      $('.verification-toggle[value="reference_unverified"]').checked = true;
      setLifecycleSelection(['active', 'ongoing', 'resolved', 'expired', 'needs_review']);
    }
    configureTimelineForEvent(eventKey);
    scheduleRender();
    $('#live').textContent = eventKey ? '選択した災害を10分刻みの流れで表示します。' : '災害の時間絞り込みを解除しました。';
  });
  $('#plateau-prefecture-select').addEventListener('change', (event) => {
    populatePlateauMunicipalities(event.target.value);
  });
  $('#plateau-area-select').addEventListener('change', (event) => {
    const code = event.target.value.replace('plateau-', '');
    if (/^\d{5}$/.test(code)) selectPlateauRegion(code);
  });
  $('#timeline-slider').addEventListener('input', (event) => {
    state.selectedBucketIndex = Number(event.target.value);
    scheduleRender();
  });
  $('#timeline-onset').addEventListener('click', () => {
    state.selectedBucketIndex = 0;
    $('#timeline-slider').value = '0';
    scheduleRender();
    $('#live').textContent = '選択した災害の発生時点を表示します。';
  });
  $('#timeline-current').addEventListener('click', () => {
    state.selectedBucketIndex = state.timeBuckets.length - 1;
    $('#timeline-slider').value = String(Math.max(state.selectedBucketIndex, 0));
    scheduleRender();
  });
  $('#timeline-clear').addEventListener('click', () => {
    $('#event-select').value = '';
    configureTimelineForEvent('');
    $('.verification-toggle[value="reference_unverified"]').checked = false;
    setLifecycleSelection(['active', 'ongoing']);
    scheduleRender();
  });
  form.addEventListener('reset', () => {
    setTimeout(() => {
      $$('.priority-toggle').forEach((input) => { input.checked = true; });
      $$('.verification-toggle').forEach((input) => { input.checked = input.value !== 'reference_unverified'; });
      setLifecycleSelection(['active', 'ongoing']);
      $('#event-select').value = '';
      configureTimelineForEvent('');
      scheduleRender();
    }, 0);
  });
  $$('input[name="basemap"]').forEach((input) => input.addEventListener('change', () => {
    if (!state.mapReady) return;
    const standard = input.value === 'standard' && input.checked;
    state.map.setLayoutProperty('gsi-pale', 'visibility', standard ? 'none' : 'visible');
    state.map.setLayoutProperty('gsi-standard', 'visibility', standard ? 'visible' : 'none');
  }));
  const sheltersToggle = $('#layer-shelters');
  if (sheltersToggle) sheltersToggle.addEventListener('change', (event) => toggleReferenceLayer('shelters', '/api/shelters', event.target.checked));
  Object.entries(JMA_TILE_LAYERS).forEach(([key, config]) => {
    const toggle = $(config.toggle);
    if (toggle) toggle.addEventListener('change', (event) => toggleJmaTileLayer(key, event.target.checked));
  });
  const view3d = $('#plateau-view-3d'); const buildings3d = $('#plateau-buildings-3d'); const return2d = $('#plateau-return-2d');
  const toggle3d = async (event) => {
    if (!event.target.checked) { disablePlateau3d(); setPlateau3dStatus('軽量な2D表示に戻しました。'); return; }
    try { await enablePlateau3d(); }
    catch { disablePlateau3d(); setPlateau3dStatus('3D建築物を読み込めませんでした。軽量な2D表示を続けます。'); }
  };
  if (view3d) view3d.addEventListener('change', toggle3d);
  if (buildings3d) buildings3d.addEventListener('change', toggle3d);
  if (return2d) return2d.addEventListener('click', () => { disablePlateau3d(); setPlateau3dStatus('軽量な2D表示に戻しました。'); });
  $('#plateau-view-region')?.addEventListener('click', async () => {
    try { await viewSelectedPlateauRegion(); }
    catch { $('#plateau-map-position-status').textContent = '公式データで自治体の位置を確認できませんでした。推測では移動せず、現在の地図を維持します。もう一度お試しください。'; }
  });
  $('#plateau-open-3d')?.addEventListener('click', async () => {
    try { await enablePlateau3d(); }
    catch { disablePlateau3d(); setPlateau3dStatus('再試行しても3D建築物を読み込めませんでした。2D地図、災害マーカー、気象、一覧は引き続き利用できます。'); }
  });
  $('#plateau-open-landslide')?.addEventListener('click', () => {
    const hazard = state.plateauHazards.find((item) => item.hazardType === 'landslide' && item.available);
    const input = document.querySelector('#hazard-controls input[data-hazard-type="landslide"]');
    if (hazard && setHazardVisibility(hazard, true)) { if (input) input.checked = true; $('#hazard-status').textContent = '土砂災害の想定区域を表示しています。現在の被害状況ではありません。'; }
  });
  $('#plateau-clear')?.addEventListener('click', () => {
    disablePlateau3d(); removeHazardLayers(); state.selectedPlateauCode = ''; state.selectedPlateauRegion = null; state.plateau3dConfig = null; state.plateauAvailability = null; state.plateauHazards = [];
    $('#plateau-prefecture-select').value = ''; populatePlateauMunicipalities(''); updatePlateauSelectionUi(); resetPlateauCapabilitySummary();
    $('#plateau-details').hidden = true; $('#plateau-3d-panel').hidden = true; $('#hazard-panel').hidden = true;
    setPlateauStatus('unknown', '自治体を選ぶとPLATEAU対応状況を確認できます。');
    $('#plateau-map-position-status').textContent = '選択を解除しました。地図上の位置確認済みマーカーは参照用に維持します。';
  });
  // 給水拠点は対象エリア（熊本）の公式オープンデータが未整備のため現在UI非提供。
  // データ源が整い次第、#layer-water トグルを戻せば water ソース/レイヤーで表示できる。
  const waterToggle = $('#layer-water');
  if (waterToggle) waterToggle.addEventListener('change', (event) => toggleReferenceLayer('water', '/api/water-stations', event.target.checked));
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
