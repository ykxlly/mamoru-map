import { cp, mkdir, writeFile } from 'node:fs/promises';
await mkdir('artifacts/agent/preview/site', { recursive: true });
await cp('public', 'artifacts/agent/preview/site', { recursive: true });
await writeFile('artifacts/agent/preview/verification.json', JSON.stringify({ stage: 2, commit: process.env.GITHUB_SHA || null, productionDeployment: false, productionEnvironmentUsed: false, approvalRequired: true, checks: ['agent-tests', 'existing-tests', 'diff-check', 'wrangler-dry-run'] }, null, 2));

