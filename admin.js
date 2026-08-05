const isLocalStaticServer = ['localhost', '127.0.0.1'].includes(window.location.hostname) && window.location.port !== '8787';
const defaultApiBase = isLocalStaticServer ? `${window.location.protocol}//${window.location.hostname}:8787` : window.location.origin;
const LIFECYCLE_LABELS = { active: '発生中', ongoing: '継続', resolved: '解消', expired: '期限切れ', needs_review: '要再確認' };
const state = {
  apiBase: defaultApiBase,
  token: '',
  reviewItems: [],
  adminItems: [],
  filtersReady: false
};

const $ = (selector) => document.querySelector(selector);
$('#api-base').value = defaultApiBase;
const status = (message, kind = '') => {
  $('#status').textContent = message;
  $('#status').className = `status ${kind}`;
  $('#live').textContent = message;
};

const api = async (path, options = {}) => {
  const headers = {
    ...(options.body ? { 'content-type': 'application/json' } : {}),
    ...(state.token ? { authorization: `Bearer ${state.token}` } : {})
  };
  const response = await fetch(`${state.apiBase}${path}`, { ...options, headers });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(payload.message || payload.error || `HTTP ${response.status}`);
  return payload;
};

function text(tag, value, className = '') {
  const node = document.createElement(tag);
  node.textContent = value ?? '';
  if (className) node.className = className;
  return node;
}

function link(label, href) {
  const node = document.createElement('a');
  node.textContent = label;
  node.href = href;
  node.target = '_blank';
  node.rel = 'noreferrer noopener';
  return node;
}

function selectField(labelText, name, options, value) {
  const label = document.createElement('label');
  label.textContent = labelText;
  const select = document.createElement('select');
  select.name = name;
  options.forEach(([optionValue, optionLabel]) => select.append(new Option(optionLabel, optionValue)));
  select.value = value || options[0][0];
  label.append(select);
  return { label, select };
}

function inputField(labelText, name, type = 'text') {
  const label = document.createElement('label');
  label.textContent = labelText;
  const input = document.createElement('input');
  input.name = name;
  input.type = type;
  label.append(input);
  return { label, input };
}

function ensureReviewTools() {
  if (state.filtersReady) return;
  const panel = $('.review-panel');
  const head = panel?.querySelector('.panel-head');
  if (!panel || !head) return;

  const tools = document.createElement('div');
  tools.className = 'review-tools';
  tools.innerHTML = `
    <form class="review-filter-form" role="search">
      <div class="filter-field filter-search">
        <label for="review-search">レビュー待ちを検索</label>
        <input id="review-search" name="q" type="search" autocomplete="off" placeholder="タイトル・地域・情報源">
      </div>
      <div class="filter-field">
        <label for="review-source">情報源</label>
        <select id="review-source" name="source"><option value="">すべて</option></select>
      </div>
      <div class="filter-field">
        <label for="review-type">分類</label>
        <select id="review-type" name="type">
          <option value="">すべて</option>
          <option value="warning">警報・注意</option>
          <option value="damage">被害</option>
          <option value="road">道路・交通</option>
          <option value="shelter">避難所</option>
          <option value="support">支援</option>
          <option value="other">その他</option>
        </select>
      </div>
      <button id="run-automation" class="secondary automation-button" type="button">自動取得を今すぐ実行</button>
    </form>
    <p id="review-filter-summary" class="filter-summary" aria-live="polite"></p>
  `;
  head.insertAdjacentElement('afterend', tools);
  $('#review-search').addEventListener('input', renderFilteredReview);
  $('#review-source').addEventListener('change', renderFilteredReview);
  $('#review-type').addEventListener('change', renderFilteredReview);
  $('#run-automation').addEventListener('click', runAutomation);
  state.filtersReady = true;
}

async function loadSources() {
  const list = $('#sources');
  list.replaceChildren(text('li', '読み込み中…', 'empty'));
  try {
    const { sources } = await api('/api/sources');
    list.replaceChildren();
    if (!sources.length) list.append(text('li', '情報源が登録されていません。', 'empty'));
    sources.forEach((source) => {
      const item = document.createElement('li');
      const head = document.createElement('div');
      head.className = 'source-head';
      head.append(text('strong', source.name));
      head.append(text('span', source.category === 'official' ? '公式' : '報道', `badge ${source.category}`));
      item.append(head);
      item.append(text('small', source.feed_url, 'url'));
      item.append(text('small', `最終取得: ${source.last_success_at || '未実行'}`, 'meta'));
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'secondary ingest';
      button.textContent = '個別取得';
      button.addEventListener('click', () => ingest(source, button));
      item.append(button);
      list.append(item);
    });
  } catch (error) {
    list.replaceChildren(text('li', error.message, 'error'));
  }
}

async function ingest(source, button) {
  button.disabled = true;
  button.textContent = '取得中…';
  try {
    const result = await api(`/api/sources/${source.id}/ingest`, { method: 'POST' });
    status(`${source.name}: ${result.created}件をレビュー待ちに追加しました。`, 'success');
    await Promise.all([loadSources(), loadReview()]);
  } catch (error) {
    status(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '個別取得';
  }
}

async function runAutomation() {
  const button = $('#run-automation');
  button.disabled = true;
  button.textContent = '自動取得中…';
  try {
    const result = await api('/api/automation/run', { method: 'POST' });
    status(`自動取得完了: ${result.created}件をレビュー待ちに追加。公開はされていません。`, 'success');
    await Promise.all([loadSources(), loadReview()]);
  } catch (error) {
    status(error.message, 'error');
  } finally {
    button.disabled = false;
    button.textContent = '自動取得を今すぐ実行';
  }
}

async function loadReview() {
  ensureReviewTools();
  const queue = $('#review-queue');
  queue.replaceChildren(text('p', '読み込み中…', 'empty'));
  try {
    const { items } = await api('/api/review-queue');
    state.reviewItems = items;
    updateSourceFilter(items);
    renderFilteredReview();
  } catch (error) {
    queue.replaceChildren(text('p', error.message, 'error'));
  }
}

function updateSourceFilter(items) {
  const select = $('#review-source');
  if (!select) return;
  const current = select.value;
  const names = [...new Set(items.map((item) => item.source_name).filter(Boolean))].sort((a, b) => a.localeCompare(b, 'ja'));
  select.replaceChildren(new Option('すべて', ''));
  names.forEach((name) => select.append(new Option(name, name)));
  select.value = names.includes(current) ? current : '';
}

function renderFilteredReview() {
  const queue = $('#review-queue');
  const query = ($('#review-search')?.value || '').trim().toLocaleLowerCase('ja');
  const source = $('#review-source')?.value || '';
  const type = $('#review-type')?.value || '';
  const items = state.reviewItems.filter((item) => {
    const haystack = [item.title, item.summary, item.source_summary, item.area, item.source_name].join(' ').toLocaleLowerCase('ja');
    return (!query || haystack.includes(query)) && (!source || item.source_name === source) && (!type || item.report_type === type);
  });
  $('#review-count').textContent = state.reviewItems.length;
  $('#review-filter-summary').textContent = `${items.length}件を表示（レビュー待ち合計 ${state.reviewItems.length}件）`;
  queue.replaceChildren();
  if (!items.length) {
    queue.append(text('p', state.reviewItems.length ? '条件に一致するレビュー項目はありません。' : 'レビュー待ちの情報はありません。', 'empty'));
    return;
  }
  items.forEach((item) => queue.append(reviewCard(item)));
}

function formatExactTime(value) {
  if (!value) return '不明';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '不明';
  return new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date);
}

function toDateTimeLocal(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Tokyo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}T${values.hour}:${values.minute}`;
}

function reviewCard(item) {
  const card = document.createElement('article');
  card.className = 'review-card';
  const header = document.createElement('div');
  header.className = 'review-meta';
  header.append(text('span', item.category === 'official' ? '公式発表' : '報道情報', `badge ${item.category}`));
  header.append(text('time', `発表日時: ${formatExactTime(item.published_at)} / データ最終取得: ${formatExactTime(item.retrieved_at)}`));
  card.append(header);
  card.append(text('h3', item.title));
  card.append(text('p', item.summary || item.source_summary || '要約なし'));
  const source = document.createElement('p');
  source.className = 'source-line';
  source.append(text('span', `情報源: ${item.source_name} `));
  source.append(link('原文を開く', item.item_url));
  card.append(source);
  const details = document.createElement('dl');
  details.className = 'facts';
  [['地域', item.area], ['分類', item.report_type], ['情報区分', item.information_class || (item.category === 'official' ? '公式' : '報道')], ['抽出', `${item.extraction_method} / 信頼度 ${item.confidence}`]].forEach(([term, value]) => {
    details.append(text('dt', term));
    details.append(text('dd', value));
  });
  card.append(details);

  const location = document.createElement('fieldset');
  location.className = 'location-fields';
  const legend = document.createElement('legend');
  legend.textContent = '地図上の位置（確認できた場合のみ）';
  location.append(legend);
  location.append(text('p', '個人宅などを特定する位置は入力せず、市区町村・施設周辺など粗い位置にしてください。', 'field-hint'));
  const precisionField = selectField('位置精度', `location-precision-${item.id}`, [
    ['unknown', '位置不明'], ['representative', '地域代表点'], ['estimated', '推定位置'], ['exact', '正確な地点']
  ], item.location_precision || (item.latitude && item.longitude ? 'estimated' : 'unknown'));
  location.append(precisionField.label);
  const latLabel = document.createElement('label');
  latLabel.textContent = '緯度';
  const lat = document.createElement('input');
  lat.type = 'number'; lat.step = 'any'; lat.min = '-90'; lat.max = '90'; lat.name = `latitude-${item.id}`; lat.placeholder = '例: 32.803';
  lat.value = item.latitude ?? '';
  latLabel.append(lat);
  const lngLabel = document.createElement('label');
  lngLabel.textContent = '経度';
  const lng = document.createElement('input');
  lng.type = 'number'; lng.step = 'any'; lng.min = '-180'; lng.max = '180'; lng.name = `longitude-${item.id}`; lng.placeholder = '例: 130.707';
  lng.value = item.longitude ?? '';
  lngLabel.append(lng);
  location.append(latLabel, lngLabel);
  card.append(location);

  const trustFields = document.createElement('fieldset');
  trustFields.className = 'trust-fields';
  trustFields.append(text('legend', '公開時の状態と期限'));
  const lifecycleField = selectField('状態', `lifecycle-${item.id}`, [
    ['active', '発生中'], ['ongoing', '継続'], ['resolved', '解消']
  ], 'active');
  const validField = inputField('有効期限', `valid-until-${item.id}`, 'datetime-local');
  validField.input.value = toDateTimeLocal(new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
  trustFields.append(lifecycleField.label, validField.label);
  card.append(trustFields);

  const note = document.createElement('label');
  note.textContent = 'レビュー記録';
  const textarea = document.createElement('textarea');
  textarea.rows = 2; textarea.maxLength = 500; textarea.name = `note-${item.id}`; textarea.placeholder = '確認した根拠・修正点';
  note.append(textarea);
  card.append(note);

  const publicNote = document.createElement('label');
  publicNote.textContent = '公開する更新理由';
  const publicTextarea = document.createElement('textarea');
  publicTextarea.rows = 2; publicTextarea.maxLength = 240; publicTextarea.name = `public-note-${item.id}`; publicTextarea.placeholder = '例：自治体の原文と位置を確認しました。';
  publicNote.append(publicTextarea);
  card.append(publicNote);

  const actions = document.createElement('div');
  actions.className = 'actions';
  const reject = document.createElement('button');
  reject.type = 'button'; reject.className = 'secondary'; reject.textContent = '公開しない';
  reject.addEventListener('click', () => submitReview(item.id, 'reject', textarea.value, publicTextarea.value, '', '', 'resolved', 'unknown', '', reject));
  const publish = document.createElement('button');
  publish.type = 'button'; publish.className = 'primary'; publish.textContent = '確認して公開';
  publish.addEventListener('click', () => submitReview(item.id, 'publish', textarea.value, publicTextarea.value, lat.value, lng.value, lifecycleField.select.value, precisionField.select.value, validField.input.value, publish));
  actions.append(reject, publish);
  card.append(actions);
  return card;
}

async function submitReview(id, decision, note, publicNote, latitude, longitude, lifecycleStatus, locationPrecision, validUntil, button) {
  button.disabled = true;
  try {
    await api(`/api/review/${id}`, { method: 'POST', body: JSON.stringify({
      decision, note, public_note: publicNote, latitude, longitude,
      lifecycle_status: lifecycleStatus, location_precision: locationPrecision,
      valid_until: validUntil ? new Date(validUntil).toISOString() : null, reviewer: 'admin-console'
    }) });
    status(decision === 'publish' ? '確認済みとして公開しました。' : 'レビュー対象を公開しない状態にしました。', 'success');
    await Promise.all([loadReview(), loadAdminReports()]);
  } catch (error) {
    status(error.message, 'error');
    button.disabled = false;
  }
}

async function loadAdminReports() {
  const list = $('#admin-report-list');
  list.replaceChildren(text('p', '読み込み中…', 'empty'));
  try {
    const { items } = await api('/api/admin/reports');
    state.adminItems = items;
    list.replaceChildren();
    if (!items.length) list.append(text('p', '状態を管理できる情報はありません。', 'empty'));
    items.forEach((item) => list.append(adminReportCard(item)));
  } catch (error) {
    list.replaceChildren(text('p', error.message, 'error'));
  }
}

function adminReportCard(item) {
  const card = document.createElement('article');
  card.className = 'admin-report-card';
  const heading = document.createElement('div');
  heading.className = 'admin-report-heading';
  heading.append(text('h3', item.title));
  heading.append(text('span', LIFECYCLE_LABELS[item.lifecycle_status] || '要再確認', `state-badge ${item.lifecycle_status || 'needs_review'}`));
  card.append(heading);
  card.append(text('p', `発表元：${item.source_name} / 発表：${formatExactTime(item.published_at)} / 最終確認：${formatExactTime(item.last_verified_at)}`, 'admin-report-meta'));

  const form = document.createElement('form');
  form.className = 'state-form';
  form.method = 'post';
  form.action = `/api/admin/reports/${item.id}/state`;
  const lifecycle = selectField('状態', 'lifecycle_status', [
    ['active', '発生中'], ['ongoing', '継続'], ['resolved', '解消'], ['expired', '期限切れ'], ['needs_review', '要再確認']
  ], item.lifecycle_status || 'needs_review');
  const infoClass = selectField('情報区分', 'information_class', [
    ['official', '公式'], ['media', '報道'], ['reference', '参考']
  ], item.information_class || (item.category === 'official' ? 'official' : 'media'));
  const precision = selectField('位置精度', 'location_precision', [
    ['exact', '正確な地点'], ['representative', '地域代表点'], ['estimated', '推定位置'], ['unknown', '位置不明']
  ], item.location_precision || 'unknown');
  const validUntil = inputField('有効期限', 'valid_until', 'datetime-local');
  validUntil.input.value = toDateTimeLocal(item.valid_until || item.expires_at);
  const controls = document.createElement('div');
  controls.className = 'state-controls';
  controls.append(lifecycle.label, infoClass.label, precision.label, validUntil.label);
  form.append(controls);

  const publicNote = inputField('公開する変更理由（必須）', 'public_note');
  publicNote.input.required = true;
  publicNote.input.maxLength = 240;
  publicNote.input.placeholder = '例：自治体の更新で解消を確認しました。';
  const internalNote = inputField('内部メモ', 'note');
  internalNote.input.maxLength = 500;
  form.append(publicNote.label, internalNote.label);

  const actions = document.createElement('div');
  actions.className = 'actions';
  const historyButton = document.createElement('button');
  historyButton.type = 'button'; historyButton.className = 'secondary'; historyButton.textContent = `履歴 ${Number(item.revision_count || 0)}件`;
  const submit = document.createElement('button');
  submit.type = 'submit'; submit.className = 'primary'; submit.textContent = '状態を保存';
  actions.append(historyButton, submit);
  form.append(actions);
  const history = document.createElement('div');
  history.className = 'revision-history';
  history.hidden = true;
  historyButton.addEventListener('click', () => loadReportHistory(item.id, history, historyButton));
  form.addEventListener('submit', (event) => submitReportState(event, item.id, submit));
  card.append(form, history);
  return card;
}

async function submitReportState(event, id, button) {
  event.preventDefault();
  const form = event.currentTarget;
  if (!form.reportValidity()) return;
  const data = new FormData(form);
  const localValidUntil = data.get('valid_until');
  button.disabled = true;
  button.textContent = '保存中…';
  try {
    await api(`/api/admin/reports/${id}/state`, { method: 'POST', body: JSON.stringify({
      lifecycle_status: data.get('lifecycle_status'), information_class: data.get('information_class'),
      location_precision: data.get('location_precision'),
      valid_until: localValidUntil ? new Date(localValidUntil).toISOString() : null,
      public_note: data.get('public_note'), note: data.get('note'), reviewer: 'admin-console'
    }) });
    status('状態を更新し、変更履歴を保存しました。', 'success');
    await Promise.all([loadAdminReports(), loadReview()]);
  } catch (error) {
    status(error.message, 'error');
    button.disabled = false;
    button.textContent = '状態を保存';
  }
}

async function loadReportHistory(id, container, button) {
  if (!container.hidden) { container.hidden = true; return; }
  button.disabled = true;
  try {
    const { revisions } = await api(`/api/admin/reports/${id}/history`);
    container.replaceChildren();
    if (!revisions.length) container.append(text('p', '履歴はありません。', 'empty'));
    const list = document.createElement('ol');
    revisions.forEach((revision) => {
      const item = document.createElement('li');
      item.append(text('strong', revision.public_note || revision.revision_type));
      item.append(text('small', `${formatExactTime(revision.created_at)} / ${revision.changed_fields.join(', ') || '記録のみ'}`));
      list.append(item);
    });
    if (revisions.length) container.append(list);
    container.hidden = false;
  } catch (error) {
    status(error.message, 'error');
  } finally {
    button.disabled = false;
  }
}

$('#auth-form').addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!event.currentTarget.reportValidity()) return;
  state.apiBase = $('#api-base').value.replace(/\/$/, '');
  state.token = $('#admin-token').value;
  status('接続を確認中…');
  try {
    await api('/api/health');
    await Promise.all([loadSources(), loadReview(), loadAdminReports()]);
    status('接続しました。', 'success');
  } catch (error) {
    status(error.message, 'error');
  }
});

$('#refresh-sources').addEventListener('click', loadSources);
$('#refresh-review').addEventListener('click', loadReview);
$('#refresh-admin-reports').addEventListener('click', loadAdminReports);
