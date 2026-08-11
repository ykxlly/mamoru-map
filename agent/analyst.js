import { fingerprint } from './policy.js';

export function analyze(observation) {
  const issues = [];
  for (const result of observation.results) {
    if (result.success || result.ignored) continue;
    const category = result.dependency === 'external' ? 'external_dependency' : result.errorCode === 'content_type_mismatch' || result.errorCode === 'asset_version_mismatch' ? 'asset_integrity' : 'connectivity';
    const severity = result.dependency === 'external' ? 'minor' : result.targetId === '/api/health' || result.targetId === '/' || result.status >= 500 ? 'critical' : 'major';
    issues.push({ issueId: `${observation.observerRunId}-${issues.length + 1}`, fingerprint: fingerprint({ environment: result.environment, targetId: result.targetId, category, errorCode: result.errorCode, status: result.status }), severity, category, evidence: result, target: { path: result.targetId }, autoFixable: false, humanApprovalRequired: true, status: 'detected' });
  }
  return issues;
}
