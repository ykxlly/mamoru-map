const BLOCKED_PATHS = [
  '/api/admin', '/api/auth', '/api/reports', '/api/archive',
  '/api/plateau/sync', '/api/plateau/sync/status'
];

export function fingerprint({ environment, targetId, category, errorCode, status }) {
  return [environment, targetId, category, errorCode, status ?? 'none'].join(':').toLowerCase();
}

export function canAutoFix(issue) {
  return issue?.severity === 'minor' &&
    ['accessibility', 'cosmetic', 'performance'].includes(issue.category) &&
    issue.autoFixable === true && issue.humanApprovalRequired !== true;
}

export function agentEnabled(value) {
  return value === 'true';
}

export function builderEnabled(value) {
  return value === 'true';
}

export function isProtectedTarget(target = {}) {
  const path = String(target.path || '');
  return BLOCKED_PATHS.some((prefix) => path === prefix || path.startsWith(`${prefix}/`)) ||
    target.production === true || target.migration === true || target.queue === true || target.cron === true;
}

export function assertSafeChange(change) {
  if (!change || !change.files?.length) throw new Error('change_without_files');
  if (change.files.some((file) => isProtectedTarget(file))) throw new Error('protected_target');
  if (change.migrations?.length || change.productionDeployment || change.dataMutation || change.queueMutation || change.cronMutation) {
    throw new Error('privileged_change_requires_human_approval');
  }
  return true;
}
