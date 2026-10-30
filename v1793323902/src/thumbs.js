// Small pictures of each kart for the Garage list, rendered once offscreen
// with studio light and kept for the session, and of a kart in each livery.

import * as THREE from 'three';
import { loadKartModel } from './kartModel.js';
import { applyPaint } from './paint.js';

const W = 360, H = 200;
let renderer = null, scene = null, camera = null;
const cache = new Map();

function setup() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(W, H, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.9;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfcac2, 1.7));
  const key = new THREE.DirectionalLight(0xffffff, 2.2);
  key.position.set(2.5, 4, 3);
  const rim = new THREE.DirectionalLight(0xffe2d6, 1.0);
  rim.position.set(-3, 2, -4);
  scene.add(key, rim);
  camera = new THREE.PerspectiveCamera(30, W / H, 0.05, 50);
}

// Returns a data URL picture of the kart (front three-quarter view).
// source/options are what Garage.source() gives loadKartModel.
export async function kartThumb(key, source, options, envMap) {
  if (cache.has(key)) return cache.get(key);
  const job = (async () => {
    if (!renderer) setup();
    const v = await loadKartModel(source, options);
    const obj = v.object;
    obj.traverse((o) => {
      if (!o.isMesh) return;
      for (const m of [].concat(o.material)) if (m.isMeshStandardMaterial && envMap) { m.envMap = envMap; m.envMapIntensity = 0.35; }
    });
    scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
    // kart faces -Z: look at its front left quarter
    const dir = new THREE.Vector3(-0.75, 0.42, -0.85).normalize();
    camera.position.copy(c).addScaledVector(dir, r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.66);
    camera.lookAt(c);
    renderer.render(scene, camera);
    const url = renderer.domElement.toDataURL('image/png');
    scene.remove(obj);
    obj.traverse((o) => { if (o.isMesh) o.geometry.dispose(); });
    return url;
  })();
  cache.set(key, job);
  try { return await job; } catch (e) { cache.delete(key); throw e; }
}

// A picture of a kart in a paint scheme (for the Garage's livery picker):
// the model's loaded once per kart and kept, repainted for each picture.
// named: the catalog's paint materials (main.js paintNames); number: its race number.
const painted = new Map();               // kart key -> loaded model
const pics = new Map();
let picQueue = Promise.resolve();
export function kartPicture(key, source, options, paint, named, number, envMap) {
  const id = `${key}|${number}|${JSON.stringify(paint)}`;
  if (pics.has(id)) return pics.get(id);
  const job = picQueue.then(async () => {
    if (!renderer) setup();
    if (!painted.has(key)) {
      const v = await loadKartModel(source, options);
      v.object.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of [].concat(o.material)) if (m.isMeshStandardMaterial && envMap) { m.envMap = envMap; m.envMapIntensity = 0.35; }
      });
      painted.set(key, v);
    }
    const v = painted.get(key), obj = v.object;
    applyPaint(obj, paint, named);
    v.setNumber?.(number);
    scene.add(obj);
    const box = new THREE.Box3().setFromObject(obj);
    const c = box.getCenter(new THREE.Vector3()), r = box.getSize(new THREE.Vector3()).length() / 2;
    // side-on from the front quarter and a little above, where liveries show
    const dir = new THREE.Vector3(-0.95, 0.5, -0.55).normalize();
    camera.position.copy(c).addScaledVector(dir, r / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.62);
    camera.lookAt(c);
    renderer.render(scene, camera);
    scene.remove(obj);
    return renderer.domElement.toDataURL('image/png');
  });
  picQueue = job.catch(() => {});
  pics.set(id, job);
  return job;
}
