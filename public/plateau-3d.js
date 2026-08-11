import * as THREE from 'https://cdn.jsdelivr.net/npm/three@0.183.0/build/three.module.js';
import { TilesRenderer } from 'https://cdn.jsdelivr.net/npm/3d-tiles-renderer@0.4.21/build/index.three.js';
import { GLTFLoader } from 'https://cdn.jsdelivr.net/npm/three@0.183.0/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from 'https://cdn.jsdelivr.net/npm/three@0.183.0/examples/jsm/loaders/DRACOLoader.js';
import { KTX2Loader } from 'https://cdn.jsdelivr.net/npm/three@0.183.0/examples/jsm/loaders/KTX2Loader.js';

const LAYER_ID = 'plateau-building-3d';
let active = null;

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

export async function showPlateauBuildings(map, tilesetUrl) {
  if (!map?.isStyleLoaded?.() || !/^https:\/\/api\.plateauview\.mlit\.go\.jp\/datacatalog\/3dtiles\//.test(tilesetUrl)) throw new Error('invalid_3d_tileset');
  hidePlateauBuildings(map);
  const runtime = { map, scene: null, renderer: null, tiles: null, tilesCamera: null, disposed: false, positioned: false, transform: null };
  const layer = {
    id: LAYER_ID, type: 'custom', renderingMode: '3d',
    onAdd(mapInstance, gl) {
      const scene = runtime.scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xffffff, 2.5));
      const renderer = runtime.renderer = new THREE.WebGLRenderer({ canvas: mapInstance.getCanvas(), context: gl, antialias: true });
      renderer.autoClear = false;
      const tilesCamera = runtime.tilesCamera = new THREE.PerspectiveCamera();
      runtime.transform = localTransform(mapInstance, [0, 0, 0]);
      const tiles = runtime.tiles = new TilesRenderer(tilesetUrl);
      scene.add(tiles.group); tiles.setCamera(tilesCamera); tiles.setResolutionFromRenderer(tilesCamera, renderer);
      const loader = new GLTFLoader(); const draco = new DRACOLoader();
      draco.setDecoderPath('https://cdn.jsdelivr.net/npm/three@0.183.0/examples/jsm/libs/draco/'); loader.setDRACOLoader(draco);
      const ktx2 = new KTX2Loader(); ktx2.setTranscoderPath('https://cdn.jsdelivr.net/npm/three@0.183.0/examples/jsm/libs/basis/'); ktx2.detectSupport(renderer); loader.setKTX2Loader(ktx2);
      tiles.manager.addHandler(/\.(gltf|glb)$/i, loader);
      tiles.addEventListener('load-tileset', () => {
        if (runtime.disposed || runtime.positioned) return;
        const sphere = new THREE.Sphere(); tiles.getBoundingSphere(sphere);
        const center = sphere.center.clone(), rootTransform = tiles.root?.transform || [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        const origin = ecefToLngLatAlt(center.x, center.y, center.z); runtime.transform = localTransform(mapInstance, [origin.lng, origin.lat, origin.alt]); runtime.positioned = true;
        const rotation = new THREE.Matrix4().setFromMatrix3(new THREE.Matrix3().set(rootTransform[0], rootTransform[1], rootTransform[2], rootTransform[8], rootTransform[9], rootTransform[10], -rootTransform[4], -rootTransform[5], -rootTransform[6]));
        tiles.group.matrix.copy(new THREE.Matrix4().multiplyMatrices(rotation, new THREE.Matrix4().makeTranslation(-center.x, -center.y, -center.z)));
        tiles.group.matrixAutoUpdate = false; tiles.group.updateMatrixWorld(true); mapInstance.triggerRepaint();
      });
    },
    render(_gl, args) {
      if (runtime.disposed || !runtime.renderer || !runtime.scene || !runtime.transform) return;
      const camera = new THREE.PerspectiveCamera(); camera.projectionMatrix.fromArray(args.defaultProjectionData.mainMatrix); camera.projectionMatrix.multiply(runtime.transform);
      const p = new THREE.Matrix4().fromArray(args.projectionMatrix), view = new THREE.Matrix4().multiplyMatrices(p.clone().invert(), camera.projectionMatrix);
      const tilesCamera = runtime.tilesCamera; tilesCamera.projectionMatrix.copy(p); tilesCamera.matrixWorldInverse.copy(view); tilesCamera.matrixWorld.copy(view).invert();
      runtime.renderer.resetState(); runtime.renderer.render(runtime.scene, camera); runtime.tiles.update(); runtime.map.triggerRepaint();
    },
    onRemove() { runtime.disposed = true; runtime.tiles?.dispose(); runtime.renderer?.dispose(); }
  };
  map.addLayer(layer); active = runtime;
}

export function hidePlateauBuildings(map) {
  if (map?.getLayer?.(LAYER_ID)) map.removeLayer(LAYER_ID);
  active = null;
}

window.Plateau3D = { show: showPlateauBuildings, hide: hidePlateauBuildings };
