// The car park west of the clubhouse, full of parked cars (models/cars.glb,
// made by tools/cars2glb.py from the generic passenger car pack). The rows of
// spaces are traced from the aerial: one along the guardrail, one down the
// west edge, a double row down the middle and one down the east side. About
// two spaces in three are taken, each car a type and colour of its own (most
// white, black, grey or silver, as in a real car park), some backed in.
// Always the same cars (a fixed seed), so everyone sees the same car park.
// Drawn as one instanced mesh per car type and part, so dozens of cars cost
// a few draw calls; each car is a solid box to drive into.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const STALL = 2.7;               // m between space lines
// rows of spaces: from [x, z] to [x, z], the way the cars face (yaw: 0 = north,
// -Z; PI/2 = west, -X; -PI/2 = east)
const ROWS = [
  { from: [-55, 91.5], to: [-40.5, 91.5], yaw: 0 },               // along the guardrail
  { from: [-67.5, 101], to: [-67.5, 164], yaw: Math.PI / 2 },      // the west edge
  { from: [-52.6, 105], to: [-52.6, 160], yaw: -Math.PI / 2 },     // the middle, west side
  { from: [-47.6, 105], to: [-47.6, 160], yaw: Math.PI / 2 },      // the middle, east side
  { from: [-37.6, 106], to: [-37.6, 148], yaw: -Math.PI / 2 },     // the east side
];
// car types, how common, and their body (width, length, height in m, without mirrors)
const TYPES = {
  sedan: [6, 1.95, 4.85, 1.5], suv: [6, 2.05, 5.1, 1.95], hatchback: [4, 1.8, 4.4, 1.55],
  pickup: [4, 2.1, 5.8, 1.9], wagon: [3, 1.95, 4.9, 1.55], minivan: [3, 1.95, 5.15, 1.95],
  compact: [2, 1.65, 3.65, 1.5], coupe: [2, 1.9, 4.7, 1.45], offroad: [2, 2.0, 4.4, 1.8], sport: [1, 1.95, 4.4, 1.2],
};
const COLOURS = [
  [25, '#f1f1ef'], [20, '#18191b'], [17, '#5d6166'], [14, '#b4b8bc'], [9, '#1f3f7a'],
  [8, '#9c1b22'], [3, '#24402e'], [2, '#c9b48e'], [2, '#5a3a28'],
];
const TAKEN = 0.68;

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) >>> 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t ^= t + Math.imul(t ^ (t >>> 7), 61 | t); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const pick = (r, list) => { let n = r() * list.reduce((s, x) => s + x[0], 0); for (const x of list) if ((n -= x[0]) < 0) return x; return list[0]; };

// every parked car: { type, x, z, yaw, colour, w, l, h }
export const PARKED = (() => {
  const r = rng(206), out = [], types = Object.entries(TYPES).map(([k, v]) => [v[0], k]);
  for (const row of ROWS) {
    const [ax, az] = row.from, [bx, bz] = row.to, len = Math.hypot(bx - ax, bz - az), n = Math.floor(len / STALL);
    for (let i = 0; i <= n; i++) {
      if (r() > TAKEN) continue;
      const t = i / Math.max(1, n), type = pick(r, types)[1], [, w, l, h] = TYPES[type];
      // (a little off the middle of the space, not quite square, some backed in)
      const back = r() < 0.25 ? Math.PI : 0, side = (r() - 0.5) * 0.3, deep = (r() - 0.5) * 0.5;
      const yaw = row.yaw + back + (r() - 0.5) * 0.07;
      const ux = -Math.sin(row.yaw), uz = -Math.cos(row.yaw);           // into the space
      const sx = (bx - ax) / len, sz = (bz - az) / len;                 // along the row
      out.push({ type, yaw, colour: pick(r, COLOURS)[1], w, l, h,
        x: ax + (bx - ax) * t + sx * side + ux * deep, z: az + (bz - az) * t + sz * side + uz * deep });
    }
  }
  return out;
})();

// the cars, once their models have loaded
export async function buildParking(groundAt, envMap) {
  const group = new THREE.Group();
  group.name = 'parking';
  const gltf = await new GLTFLoader().loadAsync('models/cars.glb');
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1), c = new THREE.Color();
  for (const type of Object.keys(TYPES)) {
    const src = gltf.scene.getObjectByName(type), cars = PARKED.filter(p => p.type === type);
    if (!src || !cars.length) continue;
    src.updateMatrixWorld(true);
    const inv = src.matrixWorld.clone().invert();
    src.traverse((o) => {
      if (!o.isMesh) return;
      const local = inv.clone().multiply(o.matrixWorld);
      const mat = o.material.clone();
      if (envMap) { mat.envMap = envMap; mat.envMapIntensity = 0.5; }
      const paint = mat.name.endsWith('_paint');
      const mesh = new THREE.InstancedMesh(o.geometry, mat, cars.length);
      cars.forEach((p, i) => {
        m.compose(new THREE.Vector3(p.x, groundAt(p.x, p.z), p.z), q.setFromAxisAngle(Y, p.yaw), one).multiply(local);
        mesh.setMatrixAt(i, m);
        if (paint) mesh.setColorAt(i, c.set(p.colour));
      });
      mesh.castShadow = mesh.receiveShadow = true;
      mesh.computeBoundingSphere();
      group.add(mesh);
    });
  }
  return group;
}
