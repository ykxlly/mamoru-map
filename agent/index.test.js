import test from 'node:test';
import assert from 'node:assert/strict';
import { agentEnabled, analyze, assertSafeChange, builderEnabled, canAutoFix, fingerprint, observe, releaseGate } from './index.js';

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
