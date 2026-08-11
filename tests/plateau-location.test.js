import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchJsonWithRecovery, plateauCenterFromTileset, plateauGroundHeightFromTileset, resolvePlateauGroundHeight } from '../public/plateau-location.js';

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

test('公式tilesetのregion最低標高を地図面補正値に使う', () => {
  assert.equal(plateauGroundHeightFromTileset({ root: { boundingVolume: { region: [1, 2, 3, 4, 33.49761090107872, 236] } } }), 33.49761090107872);
  assert.throws(() => plateauGroundHeightFromTileset({ root: { boundingVolume: { region: [1, 2, 3, 4] } } }), /plateau_ground_height_missing/);
});

test('カタログtilesetから公式配信元の実データ境界を追跡する', async () => {
  const responses = new Map([
    ['https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/example/tileset.json', { root: { boundingVolume: { region: [1, 2, 3, 4, -50, 500] }, children: [{ content: { uri: 'https://assets.cms.plateau.reearth.io/example/tileset.json' } }] } }],
    ['https://assets.cms.plateau.reearth.io/example/tileset.json', { root: { boundingVolume: { region: [1, 2, 3, 4, 33.5, 236] } } }]
  ]);
  const height = await resolvePlateauGroundHeight('https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/example/tileset.json', {
    attempts: 1,
    fetchImpl: async (url) => ({ ok: true, json: async () => responses.get(String(url)) })
  });
  assert.equal(height, 33.5);
});

test('未許可ホストの外部tilesetは追跡しない', async () => {
  await assert.rejects(
    resolvePlateauGroundHeight('https://api.plateauview.mlit.go.jp/datacatalog/3dtiles/example/tileset.json', {
      attempts: 1,
      fetchImpl: async () => ({ ok: true, json: async () => ({ root: { boundingVolume: { region: [1, 2, 3, 4, 0, 1] }, content: { uri: 'https://example.com/tileset.json' } } }) })
    }),
    /plateau_tileset_host_not_allowed/
  );
});
