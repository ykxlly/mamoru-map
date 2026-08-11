import { execFileSync } from 'node:child_process';

export const MAX_FILES = 3;
export const MAX_LINES = 50;
const PROTECTED = [
  /^worker\//, /^migration[^/]*$/, /^wrangler\.toml$/, /^public\/sw\.js$/,
  /^package(-lock)?\.json$/, /^\.github\/workflows\//, /^agent\/policy\.js$/,
  /^agent\/low-risk-policy\.js$/
];
const ALLOWED = [
  /\.(css|html|md|txt)$/i, /^public\/(app|admin)\.js$/,
  /^app\.js$/, /^admin\.js$/, /\.test\.[cm]?[jt]s$/i, /(^|\/)test[s]?\//i
];
const SECRET = /(AWS_SECRET|CLOUDFLARE_API_TOKEN|PRIVATE_KEY|BEGIN (RSA|OPENSSH|EC) PRIVATE KEY|api[_-]?key\s*[:=])/i;
const EXTERNAL_URL = /https?:\/\//i;
const DEPENDENCY = /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|bun\.lockb)$/i;

export function changedFiles(diff) {
  return [...new Set(String(diff).split(/\r?\n/).filter(Boolean).map((line) => line.trim()))];
}

export function countChangedLines(diff) {
  return String(diff).split(/\r?\n/).filter((line) => /^[+-][^+-]/.test(line)).length;
}

export function evaluate({ files = [], diff = '', labels = [], severity, checks = {} }) {
  const names = changedFiles(files.join('\n'));
  const reasons = [];
  if (!labels.includes('agent-safe')) reasons.push('missing_agent_safe_label');
  if (!['minor', 'accessibility'].includes(severity)) reasons.push('severity_not_allowed');
  if (!names.length || names.length > MAX_FILES) reasons.push('file_count_limit');
  if (countChangedLines(diff) > MAX_LINES) reasons.push('line_count_limit');
  if (names.some((file) => PROTECTED.some((pattern) => pattern.test(file)))) reasons.push('protected_path');
  if (names.some((file) => !ALLOWED.some((pattern) => pattern.test(file)))) reasons.push('file_type_not_allowlisted');
  if (names.some((file) => DEPENDENCY.test(file))) reasons.push('dependency_change');
  if (SECRET.test(diff)) reasons.push('secret_detected');
  if (EXTERNAL_URL.test(diff)) reasons.push('external_url_detected');
  const required = ['preview', 'tests', 'nodeCheck', 'diffCheck', 'wranglerDryRun', 'secretScan', 'desktop', 'mobile390', 'console', 'health', 'reports', 'admin401', 'rollback'];
  for (const check of required) if (checks[check] !== true) reasons.push(`check_failed:${check}`);
  const denied = reasons.some((reason) => ['protected_path', 'dependency_change', 'secret_detected', 'external_url_detected', 'file_count_limit', 'line_count_limit'].includes(reason));
  return { decision: denied ? 'RELEASE_DENIED' : reasons.length ? 'HUMAN_APPROVAL_REQUIRED' : 'AUTO_RELEASE_ALLOWED', reasons, files: names, changedLines: countChangedLines(diff) };
}

export function gitDiff(base = 'HEAD^') {
  return execFileSync('git', ['diff', '--unified=0', base, '--'], { encoding: 'utf8' });
}
