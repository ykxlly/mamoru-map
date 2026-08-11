import { mkdir, writeFile } from 'node:fs/promises';
import { analyze, observe } from './index.js';
import { agentEnabled } from './policy.js';
const baseUrl = process.env.MAMORU_AGENT_TARGET_URL || 'https://mamoru-map-api.krin6525.workers.dev';
const reportDir = process.env.MAMORU_AGENT_REPORT_DIR || 'artifacts/agent';
if (!agentEnabled(process.env.MAMORU_AGENT_ENABLED ?? 'true')) {
  await mkdir(reportDir, { recursive: true });
  await writeFile(`${reportDir}/stage-1-report.json`, JSON.stringify({ stage: 1, disabled: true, results: [], issues: [] }, null, 2));
  console.log(JSON.stringify({ disabled: true, externalRequests: 0 }));
  process.exit(0);
}
const observation = await observe(baseUrl);
const issues = analyze(observation);
const report = { stage: 1, baseUrl, observedAt: new Date().toISOString(), observation, issues, uniqueFingerprints: [...new Set(issues.map((issue) => issue.fingerprint))] };
await mkdir(reportDir, { recursive: true });
await writeFile(`${reportDir}/stage-1-report.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify({ observerRunId: observation.observerRunId, issueCount: issues.length, report: `${reportDir}/stage-1-report.json` }));
