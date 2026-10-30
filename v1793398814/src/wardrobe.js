// Pictures of the driver for the Garage's hat and suit pickers: the driver
// standing in a small studio, wearing a look (helmet, suit, hat), drawn
// offscreen once and kept for the session. 'hat' is a close-up of the helmet
// from the front three-quarter, 'helmet' one more from the side (where most
// designs are); 'suit' the whole driver.

import * as THREE from 'three';
import { RacingDriver } from './driverModel.js';
import { hatReady } from './hats.js';

const SIZE = 256;
let renderer = null, scene = null, camera = null, model = null, ready = null;
const cache = new Map();
let queue = Promise.resolve();

// arms down, a little out from the sides, the head up
const STAND = () => ({ R: [0.1, -0.5, -0.03], L: [0.1, -0.5, -0.03] });

// soft studio reflections: a pale dome with a bright panel overhead and to each side
function studioEnv(r) {
  const s = new THREE.Scene();
  s.add(new THREE.Mesh(new THREE.SphereGeometry(10, 32, 16), new THREE.MeshBasicMaterial({ color: '#8d8b88', side: THREE.BackSide })));
  for (const [x, y, z, w, h, k] of [[0, 9, 0, 12, 12, 3], [-9, 3, 3, 4, 8, 2], [9, 3, -3, 4, 8, 1.4], [0, 2, -9, 10, 4, 0.8]]) {
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: new THREE.Color(k, k, k), side: THREE.DoubleSide }));
    p.position.set(x, y, z); p.lookAt(0, 0, 0); s.add(p);
  }
  const pm = new THREE.PMREMGenerator(r);
  const env = pm.fromScene(s, 0.02).texture;
  pm.dispose();
  return env;
}

function setup() {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(1);
  renderer.setSize(SIZE, SIZE, false);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.95;
  scene = new THREE.Scene();
  scene.add(new THREE.HemisphereLight(0xffffff, 0xcfcac2, 1.3));
  const key = new THREE.DirectionalLight(0xffffff, 2.3);
  key.position.set(-2, 4, -3);
  const rim = new THREE.DirectionalLight(0xffe8dc, 1.1);
  rim.position.set(3, 2.5, 3);
  scene.add(key, rim);
  camera = new THREE.PerspectiveCamera(28, 1, 0.02, 30);
  model = new RacingDriver();
  scene.environment = studioEnv(renderer);
  model.setEnvMap(scene.environment);
  model.stand(STAND, 0);
  scene.add(model.object);
  // (the model, and its suit's picture and masks)
  const loaded = () => model.ready && model.suitTexReady && model.suitU.every(u => u.uMask.value?.image) && model.gloveU.every(u => u.uMask.value?.image);
  ready = new Promise((res) => { const t = setInterval(() => { if (loaded()) { clearInterval(t); res(); } }, 50); });
}

// a data URL picture of the driver in `look`, framed for `view`
export function lookPicture(look, view = 'hat') {
  const key = `${view}:${JSON.stringify(look)}`;
  if (cache.has(key)) return cache.get(key);
  const job = queue.then(async () => {
    if (!renderer) setup();
    await ready;
    model.setHelmet(look);
    model.stand(STAND, 0);
    await hatReady(look.hat);
    if (look.design === 'pumpkin') await model.pumpkin;
    model.object.updateMatrixWorld(true);
    if (view === 'hat' || view === 'helmet') {
      // the helmet and the hat on it, filling the picture
      const box = new THREE.Box3().setFromObject(model.head);
      const c = model.head.localToWorld(model.hatAt.c.clone());
      box.min.y = Math.max(box.min.y, c.y - 0.13);
      const s = box.getBoundingSphere(new THREE.Sphere());
      camera.position.copy(s.center).add((view === 'helmet' ? new THREE.Vector3(-0.85, 0.3, -0.45) : new THREE.Vector3(-0.42, 0.34, -0.75)).setLength(s.radius / Math.sin(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.92));
      camera.lookAt(s.center);
    } else {
      camera.position.set(-1.55, 1.3, -3.4);
      camera.lookAt(0, 0.9, 0);
    }
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  });
  queue = job.catch(() => {});
  cache.set(key, job);
  return job;
}
