import { execFileSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';
import { evaluate } from './low-risk-policy.js';

const base = process.env.BASE_COMMIT || 'HEAD^';
const files = execFileSync('git', ['diff', '--name-only', base, 'HEAD', '--'], { encoding: 'utf8' }).trim().split(/\r?\n/).filter(Boolean);
const diff = execFileSync('git', ['diff', '--unified=0', base, 'HEAD', '--'], { encoding: 'utf8' });
const requiredChecks = ['preview','tests','nodeCheck','diffCheck','wranglerDryRun','secretScan','desktop','mobile390','console','health','reports','admin401','rollback'];
const checks = Object.fromEntries(requiredChecks.map((name) => [name, process.env[`CHECK_${name.toUpperCase()}`] === 'true']));
const result = evaluate({ files, diff, labels: (process.env.ISSUE_LABELS || '').split(','), severity: process.env.SEVERITY, checks });
const artifact = { ...result, issueId: Number(process.env.ISSUE_NUMBER), fingerprint: process.env.FINGERPRINT, commit: execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim() };
writeFileSync('auto-release-policy.json', `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify(artifact));
if (result.decision !== 'AUTO_RELEASE_ALLOWED') process.exit(1);
