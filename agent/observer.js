export const OBSERVATION_TARGETS = [
  '/', '/api/health', '/api/reports?limit=1', '/api/weather?lat=37.75&lon=140.47',
  '/api/plateau/regions', '/api/plateau/hazards', '/api/plateau/3d/config?municipality_code=13101',
  '/app.js', '/styles.css', '/sw.js', '/manifest.json', '/plateau-3d.js', '/api/admin/reports'
];

const EXTERNAL_DEPENDENCY_PATHS = new Set([
  '/api/weather', '/api/plateau/regions', '/api/plateau/hazards', '/api/plateau/3d/config'
]);
const STATIC_CONTENT_TYPES = new Map([
  ['/', ['text/html']], ['/app.js', ['javascript']], ['/styles.css', ['text/css']], ['/sw.js', ['javascript']],
  ['/manifest.json', ['application/manifest+json', 'application/json']], ['/plateau-3d.js', ['javascript']]
]);

function safeErrorCode(error, timedOut) {
  if (timedOut) return 'timeout';
  if (error?.name === 'AbortError') return 'request_aborted';
  const code = String(error?.cause?.code || error?.code || '').toUpperCase();
  if (['ENOTFOUND', 'EAI_AGAIN'].includes(code)) return 'dns_error';
  if (code.startsWith('CERT_') || code.includes('TLS') || code.includes('SSL')) return 'tls_error';
  if (['ECONNREFUSED', 'ECONNRESET', 'EHOSTUNREACH', 'ENETUNREACH'].includes(code)) return 'network_error';
  return 'network_error';
}

function pathOnly(targetId) {
  return targetId.split('?')[0];
}

function expectedStatus(targetId, status) {
  return pathOnly(targetId) === '/api/admin/reports' ? status === 401 : status >= 200 && status < 300;
}

function classifyHttp(targetId, response) {
  if (!expectedStatus(targetId, response.status)) return `http_${response.status}`;
  const expectedTypes = STATIC_CONTENT_TYPES.get(pathOnly(targetId));
  const actualType = response.headers.get('content-type') || '';
  if (expectedTypes && !expectedTypes.some((type) => actualType.toLowerCase().includes(type))) return 'content_type_mismatch';
  return null;
}

function retryable(errorCode) {
  return ['timeout', 'dns_error', 'tls_error', 'network_error', 'http_429'].includes(errorCode) || /^http_5\d\d$/.test(errorCode);
}

async function probe(baseUrl, targetId, fetchImpl, timeoutMs) {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; controller.abort(); }, timeoutMs);
  const started = performance.now();
  try {
    const requestedUrl = new URL(targetId, baseUrl);
    const response = await fetchImpl(requestedUrl, {
      method: 'GET', redirect: 'follow', cache: 'no-store', signal: controller.signal,
      headers: { accept: pathOnly(targetId).startsWith('/api/') ? 'application/json' : '*/*', 'x-mamoru-observer': 'connectivity-v1' }
    });
    const errorCode = classifyHttp(targetId, response);
    return {
      status: response.status, durationMs: Math.round(performance.now() - started), success: !errorCode,
      errorCode, dnsResolved: true, tlsConnected: requestedUrl.protocol === 'https:' ? true : null,
      redirected: response.redirected, redirectCount: response.redirected ? 1 : 0,
      contentType: response.headers.get('content-type'), contentLength: response.headers.get('content-length'),
      cacheControl: response.headers.get('cache-control'), etag: response.headers.get('etag'),
      cfRay: response.headers.get('cf-ray'), version: response.headers.get('x-mamoru-version')
    };
  } catch (error) {
    const errorCode = safeErrorCode(error, timedOut);
    return {
      status: null, durationMs: Math.round(performance.now() - started), success: false, errorCode,
      dnsResolved: errorCode === 'dns_error' ? false : null, tlsConnected: errorCode === 'tls_error' ? false : null,
      redirected: false, redirectCount: 0, contentType: null, contentLength: null, cacheControl: null,
      etag: null, cfRay: null, version: null, ignored: errorCode === 'request_aborted'
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function observe(baseUrl, fetchImpl = fetch, options = {}) {
  const observerRunId = crypto.randomUUID();
  const timeoutMs = options.timeoutMs ?? 8_000;
  const maxRetries = Math.min(Math.max(options.maxRetries ?? 1, 0), 1);
  const environment = options.environment || (new URL(baseUrl).hostname === 'mamoru-map-api.krin6525.workers.dev' ? 'production' : 'preview');
  const results = [];
  for (const targetId of OBSERVATION_TARGETS) {
    let result = await probe(baseUrl, targetId, fetchImpl, timeoutMs);
    const initialErrorCode = result.errorCode;
    let attempts = 1;
    if (!result.ignored && !result.success && retryable(result.errorCode) && maxRetries) {
      result = await probe(baseUrl, targetId, fetchImpl, timeoutMs);
      attempts += 1;
    }
    results.push({
      observerRunId, targetId, environment, observedAt: new Date().toISOString(), ...result, attempts,
      recovered: attempts > 1 && result.success, initialErrorCode,
      dependency: EXTERNAL_DEPENDENCY_PATHS.has(pathOnly(targetId)) ? 'external' : 'core',
      recoveryAction: attempts > 1 ? 'bounded_retry_no_store' : 'none'
    });
  }
  const versions = [...new Set(results.filter((item) => STATIC_CONTENT_TYPES.has(pathOnly(item.targetId))).map((item) => item.version).filter(Boolean))];
  if (versions.length > 1) results.push({ observerRunId, targetId: '/__asset-version__', environment, observedAt: new Date().toISOString(), status: null, success: false, errorCode: 'asset_version_mismatch', versions: versions.length, dependency: 'core', attempts: 1, recovered: false, recoveryAction: 'none' });
  return { observerRunId, results };
}
