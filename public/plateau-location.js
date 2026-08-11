export function plateauCenterFromTileset(tileset) {
  const volume = tileset?.root?.boundingVolume;
  let lng;
  let lat;
  if (Array.isArray(volume?.region) && volume.region.length >= 4) {
    [lng, lat] = [
      (volume.region[0] + volume.region[2]) * 90 / Math.PI,
      (volume.region[1] + volume.region[3]) * 90 / Math.PI
    ];
  } else {
    const coordinates = Array.isArray(volume?.sphere)
      ? volume.sphere.slice(0, 3)
      : Array.isArray(volume?.box) ? volume.box.slice(0, 3) : null;
    if (!coordinates?.every(Number.isFinite)) throw new Error('plateau_bounds_missing');
    const [x, y, z] = coordinates;
    const a = 6378137;
    const e2 = 6.69437999014e-3;
    const b = a * Math.sqrt(1 - e2);
    const p = Math.sqrt(x * x + y * y);
    const theta = Math.atan2(a * z, b * p);
    const ep2 = (a * a - b * b) / (b * b);
    lng = Math.atan2(y, x) * 180 / Math.PI;
    lat = Math.atan2(z + ep2 * b * Math.sin(theta) ** 3, p - e2 * a * Math.cos(theta) ** 3) * 180 / Math.PI;
  }
  if (!Number.isFinite(lng) || !Number.isFinite(lat) || lng < 122 || lng > 154 || lat < 20 || lat > 46) {
    throw new Error('plateau_bounds_outside_japan');
  }
  return [lng, lat];
}

export function plateauGroundHeightFromTileset(tileset) {
  const region = tileset?.root?.boundingVolume?.region;
  const height = Array.isArray(region) ? Number(region[4]) : NaN;
  if (!Number.isFinite(height) || height < -500 || height > 9000) throw new Error('plateau_ground_height_missing');
  return height;
}

function nestedTilesetUrl(tileset, baseUrl) {
  const candidates = [tileset?.root?.content?.uri, ...(tileset?.root?.children || []).map((child) => child?.content?.uri)];
  const uri = candidates.find((value) => typeof value === 'string' && /\.json(?:$|\?)/i.test(value));
  if (!uri) return null;
  const resolved = new URL(uri, baseUrl);
  const allowedHosts = new Set(['api.plateauview.mlit.go.jp', 'assets.cms.plateau.reearth.io']);
  if (resolved.protocol !== 'https:' || !allowedHosts.has(resolved.hostname)) throw new Error('plateau_tileset_host_not_allowed');
  return resolved.href;
}

export async function resolvePlateauGroundHeight(tilesetUrl, options = {}) {
  let currentUrl = tilesetUrl;
  let current = await fetchJsonWithRecovery(currentUrl, options);
  for (let depth = 0; depth < 2; depth += 1) {
    const nestedUrl = nestedTilesetUrl(current, currentUrl);
    if (!nestedUrl) return plateauGroundHeightFromTileset(current);
    currentUrl = nestedUrl;
    current = await fetchJsonWithRecovery(currentUrl, options);
  }
  return plateauGroundHeightFromTileset(current);
}

export async function fetchJsonWithRecovery(url, options = {}) {
  const attempts = Number(options.attempts) || 2;
  const timeoutMs = Number(options.timeoutMs) || 10000;
  const fetchImpl = options.fetchImpl || fetch;
  let lastError;
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await fetchImpl(url, { headers: { accept: 'application/json' }, cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      lastError = error;
      if (attempt + 1 < attempts) await new Promise((resolve) => setTimeout(resolve, 25));
    } finally { clearTimeout(timer); }
  }
  throw lastError || new Error('plateau_connection_failed');
}
