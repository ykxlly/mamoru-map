import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchJsonWithRecovery, plateauCenterFromTileset } from './plateau-location.js';

test('公式tilesetのregion境界から中心を算出する', () => {
  const radians = (degrees) => degrees * Math.PI / 180;
  const center = plateauCenterFromTileset({ root: { boundingVolume: { region: [radians(139), radians(35), radians(141), radians(37), 0, 100] } } });
  assert.deepEqual(center.map((value) => Math.round(value)), [140, 36]);
});

test('日本域外または境界なしのデータを推測に利用しない', () => {
  assert.throws(() => plateauCenterFromTileset({ root: {} }), /plateau_bounds_missing/);
  assert.throws(() => plateauCenterFromTileset({ root: { boundingVolume: { region: [0, 0, 0.1, 0.1, 0, 1] } } }), /plateau_bounds_outside_japan/);
});

test('一時的な接続失敗を1回だけ再試行する', async () => {
  let calls = 0;
  const result = await fetchJsonWithRecovery('https://example.invalid/tileset.json', {
    attempts: 2,
    fetchImpl: async () => {
      calls += 1;
      if (calls === 1) throw new TypeError('temporary connection error');
      return { ok: true, json: async () => ({ root: {} }) };
    }
  });
  assert.equal(calls, 2);
  assert.deepEqual(result, { root: {} });
});
