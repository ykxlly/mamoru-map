import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.183.0/build/three.module.js';
import { TilesRenderer } from 'https://cdn.jsdelivr.net/npm/3d-tiles-renderer@0.4.21/build/index.three.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.183.0/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'https://cdn.jsdelivr.net/npm/three@0.183.0/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'https://cdn.jsdelivr.net/npm/three@0.183.0/examples/jsm/loaders/KTX2Loader.js';

const LAYER_ID = 'plateau-building-3d';
let active = null;
let diagnostics = {};
function renderDebugPanel() {
  if (new URLSearchParams(location.search).get('debug3d') !== '1') return;
  let panel = document.getElementById('mamoru-3d-diagnostics');
  if (!panel) {
    panel = document.createElement('output');
    panel.id = 'mamoru-3d-diagnostics';
    panel.setAttribute('aria-live', 'polite');
    panel.style.cssText = 'position:fixed;right:8px;bottom:8px;z-index:1000;max-width:300px;padding:8px;background:#102a43;color:#fff;font:12px/1.4 monospace;white-space:pre-wrap;border-radius:6px';
    document.body.append(panel);
  }
  const { lastError, ...safe } = diagnostics;
  panel.textContent = JSON.stringify({ ...safe, lastError: lastError ? 'rendering_failed' : null }, null, 1);
}
function resetDiagnostics() {
  diagnostics = { status: 'idle', moduleLoaded: true, customLayerAdded: false, rootTilesetLoaded: false, rootChildren: 0, requestedTiles: 0, loadedTiles: 0, visibleTiles: 0, renderedObjects: 0, renderedFrames: 0, cameraPosition: null, modelCenter: null, modelRadius: null, lastCheckpoint: 'module_loaded', lastError: null };
  window.MAMORU_3D_DIAGNOSTICS = diagnostics;
  renderDebugPanel();
}
function checkpoint(name, values = {}) { diagnostics = { ...diagnostics, ...values, lastCheckpoint: name }; window.MAMORU_3D_DIAGNOSTICS = diagnostics; renderDebugPanel(); }
function safeError(error) { return String(error?.message || error || 'rendering_failed').replace(/https?:\/\/[^\s]+/g, 'external_resource'); }
function countMeshes(root) { let total = 0; root?.traverse?.(node => { if (node.isMesh) total += 1; }); return total; }
resetDiagnostics();

function ecefToLngLatAlt(x, y, z) {
  const a = 6378137, e2 = 6.69437999014e-3, b = a * Math.sqrt(1 - e2), ep2 = (a * a - b * b) / (b * b);
  const p = Math.sqrt(x * x + y * y), th = Math.atan2(a * z, b * p), lon = Math.atan2(y, x);
  const lat = Math.atan2(z + ep2 * b * Math.sin(th) ** 3, p - e2 * a * Math.cos(th) ** 3);
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) ** 2);
  return { lng: lon * 180 / Math.PI, lat: lat * 180 / Math.PI, alt: p / Math.cos(lat) - n };
}

function localTransform(map, coordinate) {
  const mercator = window.maplibregl.MercatorCoordinate.fromLngLat([coordinate[0], coordinate[1]], coordinate[2]);
  const scale = mercator.meterInMercatorCoordinateUnits();
  return new THREE.Matrix4().makeTranslation(mercator.x, mercator.y, mercator.z)
    .scale(new THREE.Vector3(scale, -scale, scale))
    .multiply(new THREE.Matrix4().makeRotationX(Math.PI / 2));
}

function ecefToThreeLocalRotation(lng, lat) {
  const lon = lng * Math.PI / 180, phi = lat * Math.PI / 180;
  const sinLon = Math.sin(lon), cosLon = Math.cos(lon), sinLat = Math.sin(phi), cosLat = Math.cos(phi);
  return new THREE.Matrix4().set(
    -sinLon, cosLon, 0, 0,
    cosLat * cosLon, cosLat * sinLon, sinLat, 0,
    sinLat * cosLon, sinLat * sinLon, -cosLat, 0,
    0, 0, 0, 1
  );
}

export async function showPlateauBuildings(map, tilesetUrl, options = {}) {
  if (!map?.isStyleLoaded?.() || !/^https:\/\/api\.plateauview\.mlit\.go\.jp\/datacatalog\/3dtiles\//.test(tilesetUrl)) throw new Error('invalid_3d_tileset');
  hidePlateauBuildings(map);
  resetDiagnostics(); checkpoint('map_ready', { status: 'loading' });
  let resolveReady; let rejectReady; let settled = false;
  const ready = new Promise((resolve, reject) => { resolveReady = resolve; rejectReady = reject; });
  const finish = (error) => {
    if (settled) return;
    settled = true; clearTimeout(runtime.timeout);
    if (error) rejectReady(error); else resolveReady();
  };
  const runtime = { map, scene: null, renderer: null, tiles: null, tilesCamera: null, disposed: false, positioned: false, transform: null, timeout: null };
  runtime.timeout = setTimeout(() => finish(new Error('plateau_tileset_timeout')), Number(options.timeoutMs) || 15000);
  const layer = {
    id: LAYER_ID, type: 'custom', renderingMode: '3d',
    onAdd(mapInstance, gl) {
      try {
      const scene = runtime.scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 2.5));
      const renderer = runtime.renderer = new THREE.WebGLRenderer({ canvas: mapInstance.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
      const tilesCamera = runtime.tilesCamera = new THREE.PerspectiveCamera();
      runtime.transform = localTransform(mapInstance, [0, 0, 0]);
      const tiles = runtime.tiles = new TilesRenderer(tilesetUrl);
      checkpoint('camera_registered');
      checkpoint('tileset_request_started');
      tiles.manager.onStart = () => checkpoint('child_tile_requested', { requestedTiles: diagnostics.requestedTiles + 1 });
      tiles.manager.onError = (url) => {
        checkpoint('rendering_failed', { status: 'error', lastError: safeError(url) });
        if (!diagnostics.rootTilesetLoaded) finish(new Error('plateau_tileset_connection_failed'));
      };
      tiles.addEventListener('load-model', () => {
        checkpoint('child_tile_loaded', { status: 'loading', loadedTiles: diagnostics.loadedTiles + 1, renderedObjects: countMeshes(tiles.group) });
      });
      scene.add(tiles.group); tiles.setCamera(tilesCamera); tiles.setResolutionFromRenderer(tilesCamera, renderer);
      const loader = new GLTFLoader(); const draco = new DRACOLoader();
      draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.183.0/examples/jsm/libs/draco/'); loader.setDRACOLoader(draco);
      const ktx2 = new KTX2Loader(); ktx2.setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.183.0/examples/jsm/libs/basis/'); ktx2.detectSupport(renderer); loader.setKTX2Loader(ktx2);
      loader.register(parser => ({
        name: 'MAMORU_CESIUM_RTC',
        afterRoot(gltf) {
          const center = parser.json.extensions?.CESIUM_RTC?.center;
          if (Array.isArray(center) && center.length === 3 && center.every(Number.isFinite)) gltf.scene.position.fromArray(center);
        }
      }));
      tiles.manager.addHandler(/\.(gltf|glb)$/i, loader);
      tiles.addEventListener('load-tileset', () => {
        if (runtime.disposed || runtime.positioned) return;
        checkpoint('tileset_json_loaded');
        const sphere = new THREE.Sphere(); tiles.getBoundingSphere(sphere);
        const center = sphere.center.clone();
        const origin = ecefToLngLatAlt(center.x, center.y, center.z); runtime.transform = localTransform(mapInstance, [origin.lng, origin.lat, origin.alt]); runtime.positioned = true;
        checkpoint('tileset_parsed', { rootTilesetLoaded: true, rootChildren: tiles.root?.children?.length || 0 });
        checkpoint('root_tile_created');
        mapInstance.easeTo({ center: [origin.lng, origin.lat], zoom: Math.max(mapInstance.getZoom(), 15), pitch: Math.max(mapInstance.getPitch(), 55), bearing: mapInstance.getBearing(), duration: 0 });
        const rotation = ecefToThreeLocalRotation(origin.lng, origin.lat);
        tiles.group.matrix.copy(new THREE.Matrix4().multiplyMatrices(rotation, new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z)));
        tiles.group.matrixAutoUpdate = false; tiles.group.updateMatrixWorld(true); mapInstance.triggerRepaint();
        checkpoint('model_bounds_computed', { modelCenter: [origin.lng, origin.lat, origin.alt], modelRadius: sphere.radius });
        checkpoint('camera_moved_to_model', { rootTilesetLoaded: true, rootChildren: tiles.root?.children?.length || 0, modelCenter: [origin.lng, origin.lat, origin.alt], modelRadius: sphere.radius, cameraPosition: mapInstance.getCenter().toArray(), renderedObjects: tiles.group.children.length });
        finish();
      });
      checkpoint('renderer_initialized');
      } catch (error) { checkpoint('rendering_failed', { status: 'error', lastError: safeError(error) }); finish(error); }
    },
    render(_gl, args) {
      if (runtime.disposed || !runtime.renderer || !runtime.scene || !runtime.transform) return;
      try {
      const camera = new THREE.PerspectiveCamera(); camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix); camera.projectionMatrix.multiply(runtime.transform);
      const p = new THREE.Matrix4().fromArray(args.projectionMatrix), view = new THREE.Matrix4().multiplyMatrices(p.clone().invert(), camera.projectionMatrix);
      const tilesCamera = runtime.tilesCamera; tilesCamera.projectionMatrix.copy(p); tilesCamera.matrixWorldInverse.copy(view); tilesCamera.matrixWorld.copy(view).invert();
      runtime.renderer.resetState(); runtime.renderer.render(runtime.scene, camera); runtime.tiles.update();
      const visibleTiles = runtime.tiles.visibleTiles?.size || runtime.tiles.visibleTiles?.length || 0;
      const renderedFrames = diagnostics.renderedFrames + 1;
      checkpoint(visibleTiles > 0 ? 'tile_visible' : renderedFrames === 1 ? 'first_frame_rendered' : 'update_loop_started', { status: visibleTiles > 0 ? 'ready' : diagnostics.status, visibleTiles, renderedObjects: countMeshes(runtime.tiles.group), renderedFrames });
      runtime.map.triggerRepaint();
      } catch (error) { checkpoint('rendering_failed', { status: 'error', lastError: safeError(error) }); }
    },
    onRemove() { runtime.disposed = true; clearTimeout(runtime.timeout); runtime.tiles?.dispose(); runtime.renderer?.dispose(); diagnostics.status = 'idle'; }
  };
  map.addLayer(layer); active = runtime; checkpoint('custom_layer_added', { customLayerAdded: true });
  await ready;
}

export function hidePlateauBuildings(map) {
  if (map?.getLayer?.(LAYER_ID)) map.removeLayer(LAYER_ID);
  active = null; checkpoint('disabled', { status: 'idle', visibleTiles: 0 });
}
export function getDiagnostics() { return { ...diagnostics }; }
