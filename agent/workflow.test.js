import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

for (const file of ['agent-preview.yml', 'agent-observer.yml', 'agent-builder.yml', 'agent-release.yml']) {
  test(`${file} has explicit trigger and runnable job`, async () => {
    const yaml = await readFile(`.github/workflows/${file}`, 'utf8');
    assert.match(yaml, /^name: .+$/m);
    assert.match(yaml, /^"on":$/m);
    assert.match(yaml, /^jobs:$/m);
    assert.match(yaml, /runs-on: ubuntu-latest/);
  });
}

test('non-release workflows cannot access production environment or secrets', async () => {
  for (const file of ['agent-preview.yml', 'agent-observer.yml', 'agent-builder.yml']) {
    const yaml = await readFile(`.github/workflows/${file}`, 'utf8');
    assert.doesNotMatch(yaml, /environment:\s*production/);
    assert.doesNotMatch(yaml, /secrets\./);
    assert.doesNotMatch(yaml, /wrangler deploy(?! --dry-run)/);
  }
});

