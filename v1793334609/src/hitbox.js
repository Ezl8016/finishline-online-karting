// A kart's hitbox, shaped like its model: the model cut into a grid (four
// bands front to back, three across) and each piece wrapped tight in a
// convex shape, so the nose, sidepods, bumpers and wheels are where they look.
// Used for the player's own kart (walls, barriers and other karts) and for
// every other player's kart (main.js). Points are in the kart body's frame:
// -Z forward, +Y up, origin at the centre of mass.

import * as THREE from 'three';
import { KART } from './physics/kart.js';

const ROWS = 4, COLS = 3;
const CLEAR = 0.04;              // m above the ground: never scrapes the track
const TOP = 0.75;                // m above the ground: the kart, not the steering wheel and seat back
// directions a piece is wrapped from (a 26-sided hull around its points)
const DIRS = [];
for (let x = -1; x <= 1; x++) for (let y = -1; y <= 1; y++) for (let z = -1; z <= 1; z++) {
  if (x || y || z) DIRS.push(new THREE.Vector3(x, y, z).normalize());
}

const cache = new Map();         // kart id -> hulls

// hulls: [Float32Array of x, y, z, ...] for each piece. object: the kart
// model (loadKartModel's object), in the body's frame
export function hitboxOf(id, object) {
  if (cache.has(id)) return cache.get(id);
  if (!object) return null;
  const ground = -KART.cgHeight;
  const pts = [];
  object.updateMatrixWorld(true);
  const toKart = object.matrixWorld.clone().invert(), m = new THREE.Matrix4(), v = new THREE.Vector3();
  object.traverse((o) => {
    if (!o.isMesh || !o.visible || !o.geometry?.attributes.position) return;
    m.multiplyMatrices(toKart, o.matrixWorld);
    const p = o.geometry.attributes.position;
    const stride = Math.max(1, Math.floor(p.count / 6000));
    for (let i = 0; i < p.count; i += stride) {
      v.fromBufferAttribute(p, i).applyMatrix4(m);
      if (v.y > ground + TOP) continue;
      pts.push(v.x, Math.max(v.y, ground + CLEAR), v.z);
    }
  });
  if (pts.length < 12) return null;
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < pts.length; i += 3) { x0 = Math.min(x0, pts[i]); x1 = Math.max(x1, pts[i]); z0 = Math.min(z0, pts[i + 2]); z1 = Math.max(z1, pts[i + 2]); }
  // the cells: four equal bands along, and a third across each
  const cells = Array.from({ length: ROWS * COLS }, () => []);
  for (let i = 0; i < pts.length; i += 3) {
    const r = Math.min(ROWS - 1, Math.floor((pts[i + 2] - z0) / (z1 - z0) * ROWS));
    const c = Math.min(COLS - 1, Math.floor((pts[i] - x0) / (x1 - x0) * COLS));
    cells[r * COLS + c].push(pts[i], pts[i + 1], pts[i + 2]);
  }
  const hulls = [];
  const p = new THREE.Vector3();
  for (const cell of cells) {
    if (cell.length < 12) continue;
    // the piece's outermost point in each direction
    const out = [];
    for (const d of DIRS) {
      let best = -Infinity, bi = 0;
      for (let i = 0; i < cell.length; i += 3) {
        const s = p.set(cell[i], cell[i + 1], cell[i + 2]).dot(d);
        if (s > best) { best = s; bi = i; }
      }
      out.push(cell[bi], cell[bi + 1], cell[bi + 2]);
    }
    // (and a little height, so a flat piece is still solid)
    let ylo = Infinity, yhi = -Infinity;
    for (let i = 1; i < out.length; i += 3) { ylo = Math.min(ylo, out[i]); yhi = Math.max(yhi, out[i]); }
    if (yhi - ylo < 0.06) for (let i = 1; i < out.length; i += 3) if (out[i] === yhi) out[i] = ylo + 0.06;
    hulls.push(Float32Array.from(out));
  }
  cache.set(id, hulls);
  return hulls;
}

// before a model's loaded: its catalog footprint as one box
export function boxHull(fp) {
  const [w, l, cz] = fp || [1.40, 1.94, 0.02];
  const h = KART.cgHeight, y0 = CLEAR - h, y1 = 0.3 - h;
  const out = [];
  for (const x of [-w / 2, w / 2]) for (const y of [y0, y1]) for (const z of [cz - l / 2, cz + l / 2]) out.push(x, y, z);
  return [Float32Array.from(out)];
}
