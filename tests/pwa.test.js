import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile('public/manifest.json', 'utf8'));
const index = await readFile('public/index.html', 'utf8');
const app = await readFile('public/app.js', 'utf8');
const serviceWorker = await readFile('public/sw.js', 'utf8');
const plateauLoader = await readFile('public/plateau-3d.js', 'utf8');

test('manifest has the required installability metadata', () => {
  assert.equal(manifest.start_url, '/?source=pwa');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.lang, 'ja');
  assert.ok(manifest.name && manifest.short_name && manifest.description);
  for (const size of ['192x192', '512x512']) {
    assert.ok(manifest.icons.some((icon) => icon.sizes === size && String(icon.purpose || 'any').includes('any')));
    assert.ok(manifest.icons.some((icon) => icon.sizes === size && String(icon.purpose || '').includes('maskable')));
  }
});

test('document and app expose manifest, Apple icon, service worker, and install UI', () => {
  assert.match(index, /rel="manifest" href="\/manifest\.json"/);
  assert.match(index, /rel="apple-touch-icon" href="\/icon-192\.png"/);
  assert.match(index, /id="pwa-install"/);
  assert.match(app, /serviceWorker\.register\('\/sw\.js'\)/);
  assert.match(app, /beforeinstallprompt/);
});

test('offline shell contains every local module and install icon', () => {
  for (const asset of ['/app.js', '/plateau-3d.js', '/plateau-location.js', '/manifest.json', '/icon-192.png', '/icon-512.png', '/icon-maskable-512.png']) {
    assert.ok(serviceWorker.includes(`'${asset}'`), `${asset} is missing from the offline shell`);
  }
});

test('PLATEAU loader applies only the verified tileset ground-height offset', () => {
  assert.match(plateauLoader, /resolvePlateauGroundHeight/);
  assert.match(plateauLoader, /origin\.alt - runtime\.groundHeight/);
  assert.match(plateauLoader, /verticalOffset/);
});
