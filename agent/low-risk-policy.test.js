import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluate } from './low-risk-policy.js';

const checks = Object.fromEntries(['preview','tests','nodeCheck','diffCheck','wranglerDryRun','secretScan','desktop','mobile390','console','health','reports','admin401','rollback'].map((key) => [key, true]));
test('allows a small labelled accessibility change only when every gate passes', () => {
  const result = evaluate({ files: ['public/index.html'], diff: '+<button aria-label="retry">再試行</button>', labels: ['agent-safe'], severity: 'accessibility', checks });
  assert.equal(result.decision, 'AUTO_RELEASE_ALLOWED');
});
for (const [name, input] of [
  ['protected worker path', { files: ['worker/index.js'] }],
  ['migration', { files: ['migration-014.sql'] }],
  ['too many files', { files: ['a.css','b.css','c.css','d.css'] }],
  ['too many lines', { files: ['public/index.html'], diff: Array(51).fill('+x').join('\n') }],
  ['secret', { files: ['public/index.html'], diff: '+CLOUDFLARE_API_TOKEN=secret' }],
  ['external URL', { files: ['public/index.html'], diff: '+https://evil.example' }],
  ['missing label', { files: ['public/index.html'], severity: 'minor', checks }]
]) test(`rejects ${name}`, () => {
  const result = evaluate({ severity: 'minor', labels: ['agent-safe'], checks, ...input, ...(name === 'missing label' ? { labels: [] } : {}) });
  assert.notEqual(result.decision, 'AUTO_RELEASE_ALLOWED');
});
