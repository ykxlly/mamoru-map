import { fingerprint } from './policy.js';

export function analyze(observation) {
  const issues = [];
  for (const result of observation.results) {
    if (result.success) continue;
    const category = result.errorCode === 'timeout' ? 'external_dependency' : 'major';
    const severity = result.targetId === '/api/health' || result.status >= 500 ? 'critical' : 'major';
    issues.push({ issueId: `${observation.observerRunId}-${issues.length + 1}`, fingerprint: fingerprint({ environment: result.environment, targetId: result.targetId, category, errorCode: result.errorCode, status: result.status }), severity, category, evidence: result, target: { path: result.targetId }, autoFixable: false, humanApprovalRequired: true, status: 'detected' });
  }
  return issues;
}
