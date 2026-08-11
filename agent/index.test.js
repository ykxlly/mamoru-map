import test from 'node:test';
import assert from 'node:assert/strict';
import { agentEnabled, analyze, assertSafeChange, builderEnabled, canAutoFix, fingerprint, releaseGate } from './index.js';

test('fingerprint is stable and includes the required dimensions', () => assert.equal(fingerprint({ environment: 'preview', targetId: '/api/health', category: 'major', errorCode: 'http_500', status: 500 }), 'preview:/api/health:major:http_500:500'));
test('protected changes cannot be auto-applied', () => assert.throws(() => assertSafeChange({ files: [{ path: '/api/reports' }] }), /protected_target/));
test('only low-risk explicitly fixable issues are eligible', () => { assert.equal(canAutoFix({ severity: 'minor', category: 'accessibility', autoFixable: true }), true); assert.equal(canAutoFix({ severity: 'critical', category: 'accessibility', autoFixable: true }), false); });
test('analyst escalates health failures', () => { const issues = analyze({ observerRunId: 'run', results: [{ targetId: '/api/health', environment: 'preview', success: false, status: 500, errorCode: 'http_500' }] }); assert.equal(issues[0].severity, 'critical'); assert.equal(issues[0].humanApprovalRequired, true); });
test('release gate requires every condition', () => { assert.equal(releaseGate({ enabled: true, approval: true, previewPassed: true, commit: 'abc', deploymentId: 'dep' }).allowed, true); assert.equal(releaseGate({ enabled: true, approval: false, previewPassed: true, commit: 'abc', deploymentId: 'dep' }).allowed, false); });
test('kill switches are opt-in only', () => { assert.equal(agentEnabled('false'), false); assert.equal(agentEnabled('true'), true); assert.equal(builderEnabled('false'), false); assert.equal(builderEnabled('true'), true); });
