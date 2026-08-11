export const OBSERVATION_TARGETS = [
  '/', '/api/health', '/api/reports?limit=1', '/api/weather?lat=37.75&lon=140.47',
  '/api/plateau/regions', '/api/plateau/hazards', '/api/plateau/3d/config?municipality_code=13101',
  '/app.js', '/styles.css', '/sw.js', '/manifest.json'
];

export async function observe(baseUrl, fetchImpl = fetch) {
  const observerRunId = crypto.randomUUID();
  const results = [];
  for (const targetId of OBSERVATION_TARGETS) {
    const started = performance.now();
    try {
      const response = await fetchImpl(new URL(targetId, baseUrl));
      results.push({ observerRunId, targetId, environment: new URL(baseUrl).hostname.includes('workers.dev') ? 'preview' : 'unknown', observedAt: new Date().toISOString(), status: response.status, contentType: response.headers.get('content-type'), contentLength: response.headers.get('content-length'), cacheControl: response.headers.get('cache-control'), cfRay: response.headers.get('cf-ray'), durationMs: Math.round(performance.now() - started), success: response.ok || (targetId.startsWith('/api/') && response.status === 401), errorCode: response.ok ? null : `http_${response.status}` });
    } catch (error) {
      results.push({ observerRunId, targetId, environment: 'preview', observedAt: new Date().toISOString(), status: null, durationMs: Math.round(performance.now() - started), success: false, errorCode: error.name === 'AbortError' ? 'timeout' : 'network_error' });
    }
  }
  return { observerRunId, results };
}
