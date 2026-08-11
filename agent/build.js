import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { builderEnabled, canAutoFix, assertSafeChange } from './policy.js';

if (!builderEnabled(process.env.MAMORU_AGENT_BUILDER_ENABLED)) {
  console.log(JSON.stringify({ disabled: true, changedFiles: 0 }));
  process.exit(0);
}

const issue = JSON.parse(await readFile(process.env.ISSUE_FILE, 'utf8'));
const labels = (issue.labels || []).map((label) => typeof label === 'string' ? label : label.name);
const safe = labels.includes('agent-safe') && /accessibility|aria/i.test(`${issue.title}\n${issue.body || ''}`);
const candidate = { severity: 'minor', category: 'accessibility', autoFixable: safe, humanApprovalRequired: false };
if (!canAutoFix(candidate)) throw new Error('issue_not_allowlisted_for_builder');

const relativePath = `agent/generated/issue-${issue.number}-accessibility.json`;
assertSafeChange({ files: [{ path: relativePath }] });
await mkdir('agent/generated', { recursive: true });
await writeFile(relativePath, JSON.stringify({ issueId: issue.number, category: 'accessibility', status: 'preview', approvalRequired: true, productionDeploy: false }, null, 2));
console.log(JSON.stringify({ issueId: issue.number, changedFiles: 1, path: relativePath }));
