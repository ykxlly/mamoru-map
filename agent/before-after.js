import { readFile, writeFile } from 'node:fs/promises';
const before = JSON.parse(await readFile(process.argv[2], 'utf8'));
const after = JSON.parse(await readFile(process.argv[3], 'utf8'));
const report = { generatedAt: new Date().toISOString(), before: { issueCount: before.issues?.length ?? 0, failedTargets: before.observation.results.filter((r) => !r.success).map((r) => r.targetId) }, after: { issueCount: after.issues?.length ?? 0, failedTargets: after.observation.results.filter((r) => !r.success).map((r) => r.targetId) }, resolvedFingerprints: (before.issues || []).map((i) => i.fingerprint).filter((f) => !(after.issues || []).some((i) => i.fingerprint === f)) };
await writeFile(process.argv[4] || 'artifacts/agent/before-after.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));
