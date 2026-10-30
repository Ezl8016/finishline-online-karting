// Inside the clubhouse, where people check in for a session and wait for it.
// The building (buildings.js clubhouse) is one-sided from outside; in here
// its own walls line it, with the windows and doors cut through, so you look
// out at the track. You come in through the main entrance at the west end,
// into reception (the check-in desk, the session times); through a door from
// there is the waiting area in the centre (chairs facing the live TV and the
// Fastest Drivers board, walls of helmets, the shut front doors to the pits
// and back door), with stairs at the back up to a floor over it: the viewing
// area by the big gable window, and the admins' office (its door only opens
// for an admin). Through the waiting area's other door, the bar and arcade.
//
// buildInterior(spec) returns { group, lights, seats, walls, floorAt, tv,
// photos, office, spawn }: what to draw, where you can sit, the walls you walk
// into, the floor's height, the TV's screen, and frames for photos.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { packedNormal } from './packed.js';
import { loadHelmetParts } from './driverModel.js';
import { DESIGNS, VISORS, HELMET_DEFAULT, paintHelmet, visorMaterial } from './driver.js';

const T = 0.12;                  // the lining's inset from the outside wall (m)
const OAK = 1.7;                 // m: the oak floor's texture tile
const UP = 3.1;                  // the upstairs floor, above the ground floor (the gable window's at eye height up there)

// ---- materials
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
  return t;
}
function materials() {
  // oak boards: a scanned floor (tools/import_textures.py), roughness in its normal map's blue
  const L = new THREE.TextureLoader(), oak = ['albedo', 'normal'].map((k) => {
    const t = L.load(`assets/buildings/floor_${k}.jpg`);
    t.colorSpace = k === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  });
  // painted shiplap walls
  const shiplap = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = '#ecebe6'; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += h / 6) { g.fillStyle = 'rgba(0,0,0,0.12)'; g.fillRect(0, y, w, 2); g.fillStyle = 'rgba(255,255,255,0.5)'; g.fillRect(0, y + 2, w, 1); }
  });
  return {
    floor: packedNormal(new THREE.MeshStandardMaterial({ map: oak[0], normalMap: oak[1], roughness: 1.1, metalness: 0 })),
    wall: new THREE.MeshStandardMaterial({ map: shiplap, roughness: 0.85 }),
    ceiling: new THREE.MeshStandardMaterial({ color: 0xf3f1ec, roughness: 0.9, side: THREE.DoubleSide }),
    beam: new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 0.7 }),
    trim: new THREE.MeshStandardMaterial({ color: 0x2a2b2d, roughness: 0.5, metalness: 0.3 }),
    glass: new THREE.MeshPhysicalMaterial({ color: 0xdfeaf0, roughness: 0.02, metalness: 0, transmission: 0, transparent: true, opacity: 0.12, envMapIntensity: 1.5, side: THREE.DoubleSide, depthWrite: false }),
    leather: new THREE.MeshStandardMaterial({ color: 0x3a2c25, roughness: 0.6 }),
    fabric: new THREE.MeshStandardMaterial({ color: 0x556070, roughness: 0.95 }),
    counter: new THREE.MeshStandardMaterial({ color: 0x1d1e20, roughness: 0.35, metalness: 0.2 }),
    top: new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.4 }),
    steel: new THREE.MeshStandardMaterial({ color: 0x9aa0a6, metalness: 0.85, roughness: 0.35 }),
    red: new THREE.MeshStandardMaterial({ color: 0xd42a2a, roughness: 0.5 }),
    rug: new THREE.MeshStandardMaterial({ color: 0x2c3138, roughness: 1 }),
    screen: new THREE.MeshBasicMaterial({ color: 0x111111 }),
    plant: new THREE.MeshStandardMaterial({ color: 0x3f6b36, roughness: 0.9 }),
    pot: new THREE.MeshStandardMaterial({ color: 0x2b2b2b, roughness: 0.8 }),
  };
}

// a wall from a to b (x, z), h0 to h1 high, with rectangular holes
// ([u centre along the wall, v centre up, w, h]), facing `inward` (into the room)
function wall(group, M, a, b, h0, h1, holes = [], y0 = 0, inset = T) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
  const shape = new THREE.Shape([new THREE.Vector2(0, h0), new THREE.Vector2(L, h0), new THREE.Vector2(L, h1), new THREE.Vector2(0, h1)]);
  for (const [u, v, w, h] of holes) shape.holes.push(new THREE.Path([new THREE.Vector2(u - w / 2, v - h / 2), new THREE.Vector2(u - w / 2, v + h / 2), new THREE.Vector2(u + w / 2, v + h / 2), new THREE.Vector2(u + w / 2, v - h / 2)]));
  const geo = new THREE.ShapeGeometry(shape);
  const m = new THREE.Matrix4().makeBasis(new THREE.Vector3(ux, 0, uz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz))
    .setPosition(a[0] + nx * inset, y0, a[1] + nz * inset);
  geo.applyMatrix4(m);
  const mesh = new THREE.Mesh(geo, M.wall);
  mesh.receiveShadow = true;
  group.add(mesh);
  // a frame and glass in each hole
  for (const [u, v, w, h, kind] of holes) {
    const c = new THREE.Vector3(a[0] + ux * u + nx * inset, y0 + v, a[1] + uz * u + nz * inset), yaw = Math.atan2(nx, nz);
    if (kind !== 'open') {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(w, h), M.glass);
      g.position.copy(c).addScaledVector(new THREE.Vector3(nx, 0, nz), -0.06); g.rotation.y = yaw; group.add(g);
    }
    for (const [fw, fh, ox, oy] of [[w + 0.1, 0.05, 0, h / 2], [w + 0.1, 0.08, 0, -h / 2], [0.05, h, -w / 2, 0], [0.05, h, w / 2, 0]]) {
      if (kind === 'open' && oy < 0) continue;
      const f = new THREE.Mesh(new THREE.BoxGeometry(fw, fh, 0.14), M.trim);
      f.position.copy(c).add(new THREE.Vector3(ux * ox, oy, uz * ox)); f.rotation.y = yaw; group.add(f);
    }
  }
  return { a, b, ux, uz, nx, nz, L, holes };
}
// a gable's triangle above the eave, with an optional hole
function gable(group, M, a, b, eave, ridge, y0, hole = null) {
  const dx = b[0] - a[0], dz = b[1] - a[1], L = Math.hypot(dx, dz), ux = dx / L, uz = dz / L, nx = -uz, nz = ux;
  const shape = new THREE.Shape([new THREE.Vector2(0, eave), new THREE.Vector2(L, eave), new THREE.Vector2(L / 2, ridge)]);
  if (hole) { const [u, v, w, h] = hole; shape.holes.push(new THREE.Path([new THREE.Vector2(u - w / 2, v - h / 2), new THREE.Vector2(u - w / 2, v + h / 2), new THREE.Vector2(u + w / 2, v + h / 2), new THREE.Vector2(u + w / 2, v - h / 2)])); }
  const geo = new THREE.ShapeGeometry(shape);
  geo.applyMatrix4(new THREE.Matrix4().makeBasis(new THREE.Vector3(ux, 0, uz), new THREE.Vector3(0, 1, 0), new THREE.Vector3(nx, 0, nz)).setPosition(a[0] + nx * T, y0, a[1] + nz * T));
  group.add(new THREE.Mesh(geo, M.wall));
}
const box = (M, mat, w, h, d, x, y, z, ry = 0) => { const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat); m.position.set(x, y + h / 2, z); m.rotation.y = ry; m.castShadow = m.receiveShadow = true; return m; };

// a sofa (seats along it, facing +z before turning by yaw)
function sofa(group, M, x, y, z, yaw, len, seats, mat) {
  const g = new THREE.Group();
  g.add(box(M, mat, len, 0.42, 0.9, 0, 0, 0));
  g.add(box(M, mat, len, 0.45, 0.22, 0, 0.42, -0.34));
  for (const s of [-1, 1]) g.add(box(M, mat, 0.2, 0.22, 0.9, s * (len / 2 - 0.1), 0.42, 0));
  for (let i = 0; i < Math.round(len / 0.75); i++) { const cx = -len / 2 + 0.375 + i * 0.75; g.add(box(M, mat, 0.7, 0.1, 0.7, cx, 0.42, 0.06)); }
  g.position.set(x, y, z); g.rotation.y = yaw; group.add(g);
  const n = Math.max(1, Math.round((len - 0.4) / 0.8));
  for (let i = 0; i < n; i++) {
    const lx = -len / 2 + 0.2 + (i + 0.5) * (len - 0.4) / n, c = Math.cos(yaw), s = Math.sin(yaw);
    seats.push({ x: x + lx * c, z: z - lx * s, y: y + 0.48, yaw, seat: true });
  }
  return { x, z, w: len, d: 0.9, yaw };
}
function stool(group, M, x, y, z, seats, yaw) {
  group.add(box(M, M.steel, 0.05, 0.72, 0.05, x, y, z));
  const top = new THREE.Mesh(new THREE.CylinderGeometry(0.2, 0.2, 0.07, 18), M.leather); top.position.set(x, y + 0.76, z); top.castShadow = true; group.add(top);
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.17, 0.012, 6, 18), M.steel); ring.rotation.x = Math.PI / 2; ring.position.set(x, y + 0.3, z); group.add(ring);
  seats.push({ x, z, y: y + 0.8, yaw, seat: true, high: true });
}
// Furniture: Poly Haven models (CC0, models/club/), loaded once each and
// placed as they arrive; yaw turns the model's front (FRONT corrects each
// model's own facing to +z).
const loader = new GLTFLoader(), furniture = new Map();
const FRONT = { SchoolChair_01: 0, modern_arm_chair_01: 0, coffee_table_round_01: 0, potted_plant_02: 0, modern_ceiling_lamp_01: 0, steel_frame_shelves_01: 0, desk_lamp_arm_01: 0 };
// hang: y is the ceiling it hangs from (its top goes there), not the floor it
// stands on; scale: a factor, or { height } in metres (for a model not built to size)
function furnish(group, id, x, y, z, yaw = 0, scale = 1, hang = false) {
  if (!furniture.has(id)) furniture.set(id, loader.loadAsync(`models/club/${id}/${id}.gltf`).then((g) => lighter(g.scene)));
  furniture.get(id).then((m) => {
    const o = m.clone(true);
    if (typeof scale === 'object') { const b = new THREE.Box3().setFromObject(m); scale = scale.height / (b.max.y - b.min.y); }
    o.position.set(x, y, z); o.rotation.y = yaw + (FRONT[id] || 0); o.scale.setScalar(scale);
    if (hang) o.position.y = y - new THREE.Box3().setFromObject(m).max.y * scale;
    // (shadows from the furniture only while someone's inside: main.js clubShadows)
    o.traverse((c) => { if (c.isMesh) { c.receiveShadow = true; c.castShadow = !!group.userData.shadows; } });
    group.add(o);
  }).catch((e) => console.warn('furniture', id, e));
}
// the potted plant's soil is a 54,000-triangle scan nobody looks at: a plain disc of it at the same size instead
function lighter(scene) {
  scene.traverse((c) => {
    if (!c.isMesh || !/dirt/i.test(c.name)) return;
    c.geometry.computeBoundingBox();
    const b = c.geometry.boundingBox, r = Math.min(b.max.x - b.min.x, b.max.z - b.min.z) / 2, h = b.max.y - b.min.y;
    const disc = new THREE.CylinderGeometry(r, r * 0.9, h, 20);
    disc.translate((b.min.x + b.max.x) / 2, (b.min.y + b.max.y) / 2, (b.min.z + b.max.z) / 2);
    c.geometry.dispose(); c.geometry = disc;
  });
  return scene;
}
function plant(group, M, x, y, z) { furnish(group, 'potted_plant_02', x, y, z, (x * 7.1 + z * 3.3) % 6.28); }

export function buildInterior(spec) {
  const { X0, X1, Z0, Z1, cx0, cx1, wz0, wz1, y0, C, Wg, wins, door, entrance, backDoor, gable: GW } = spec;
  const M = materials();
  M.wall2 = M.wall.clone(); M.wall2.side = THREE.DoubleSide;
  const group = new THREE.Group();
  group.name = 'clubhouse interior';
  const walls = [];           // collision, both floors: [x0, z0, x1, z1]
  const upWalls = [];         // only upstairs
  const lowWalls = [];        // only downstairs
  const solids = [];          // collision (downstairs): boxes { x, z, w, d, yaw }
  const seats = [];
  const mx = (cx0 + cx1) / 2, mz = (wz0 + wz1) / 2, F = y0 + 0.06, UF = F + UP;   // the floors
  const seg = (a, b, list = walls) => list.push([a[0], a[1], b[0], b[1]]);
  // the vaulted ceiling's height at x (just under it)
  const vE = y0 + C.eave - 0.05, vR = y0 + C.ridge - 0.25, vHalf = mx - (cx0 + T);
  const vault = (x) => vR - (vR - vE) * Math.min(1, Math.abs(x - mx) / vHalf);
  // ---- floors and ceilings
  const floor = (x0, z0, x1, z1, y = F) => {
    const f = new THREE.Mesh(new THREE.PlaneGeometry(x1 - x0, z1 - z0).rotateX(-Math.PI / 2), M.floor);
    const uv = f.geometry.attributes.uv; for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * (x1 - x0) / OAK, uv.getY(i) * (z1 - z0) / OAK);
    f.position.set((x0 + x1) / 2, y, (z0 + z1) / 2); f.receiveShadow = true; group.add(f);
  };
  floor(cx0, Z0, cx1, Z1); floor(X0, wz0, cx0, wz1); floor(cx1, wz0, X1, wz1);
  for (const [a, b] of [[X0, cx0], [cx1, X1]]) {
    const c = new THREE.Mesh(new THREE.PlaneGeometry(b - a, wz1 - wz0).rotateX(Math.PI / 2), M.ceiling);
    c.position.set((a + b) / 2, y0 + Wg.eave - 0.02, (wz0 + wz1) / 2); group.add(c);
  }
  // the centre's vaulted ceiling, under its roof: two sloping panels, eave to ridge; collar ties well over your head upstairs
  {
    const za = Z0 + T, zb = Z1 - T, xa = cx0 + T, xb = cx1 - T;
    const pos = [xa, vE, za, mx, vR, za, mx, vR, zb, xa, vE, za, mx, vR, zb, xa, vE, zb,
      xb, vE, za, xb, vE, zb, mx, vR, zb, xb, vE, za, mx, vR, zb, mx, vR, za];
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    group.add(new THREE.Mesh(g, M.ceiling));
    const ty = y0 + C.eave + 2.1, tl = 2 * vHalf * (vR - ty) / (vR - vE);
    for (let z = Z0 + 3; z < Z1 - 1; z += 3) group.add(box(M, M.beam, tl, 0.16, 0.14, mx, ty, z));
  }
  // ---- the outside walls, lined, openings cut
  const winH = 1.3, winV = 1.6;
  const wingWins = (a, b) => wins.filter(x => x > Math.min(a, b) && x < Math.max(a, b)).map(x => [Math.abs(x - a), winV, 1.3, winH]);
  // centre: the front doors (to the pits) and the back door, glass, kept shut
  seg([cx0, Z0 + T], [cx1, Z0 + T]); seg([cx1, Z1 - T], [cx0, Z1 - T]);
  wall(group, M, [cx0, Z0], [cx1, Z0], 0, C.eave, [[mx - cx0, door.h / 2, door.w, door.h]], y0);
  gable(group, M, [cx0, Z0], [cx1, Z0], C.eave, C.ridge, y0, [mx - cx0, GW.y, GW.w, GW.h]);
  wall(group, M, [cx1, Z1], [cx0, Z1], 0, C.eave, [[cx1 - backDoor.x, backDoor.h / 2, backDoor.w, backDoor.h]], y0);
  gable(group, M, [cx1, Z1], [cx0, Z1], C.eave, C.ridge, y0);
  for (const [a, b] of [[[cx0, Z1], [cx0, wz1]], [[cx0, wz0], [cx0, Z0]], [[cx1, Z0], [cx1, wz0]], [[cx1, wz1], [cx1, Z1]]]) {
    const w = wall(group, M, a, b, 0, C.eave, [], y0); seg([a[0] + w.nx * T, a[1] + w.nz * T], [b[0] + w.nx * T, b[1] + w.nz * T]);
  }
  // (over each wing's opening, both faces: the centre's flush with its other walls, so no slit at the corners)
  for (const [a, b, inset] of [[[cx0, wz1], [cx0, wz0], T], [[cx0, wz0], [cx0, wz1], 0.02], [[cx1, wz0], [cx1, wz1], T], [[cx1, wz1], [cx1, wz0], 0.02]]) wall(group, M, a, b, Wg.eave, C.eave, [], y0, inset);
  // wings: front and back (windows), the end (and its gable); the west end has the main entrance
  for (const [a, b, end] of [[X0, cx0, X0], [cx1, X1, X1]]) {
    const west = end === X0;
    wall(group, M, [a, wz0], [b, wz0], 0, Wg.eave, wingWins(a, b), y0);
    seg([a, wz0 + T], [b, wz0 + T]);
    wall(group, M, [b, wz1], [a, wz1], 0, Wg.eave, wingWins(b, a), y0);
    seg([a, wz1 - T], [b, wz1 - T]);
    const e = west ? [[end, wz1], [end, wz0]] : [[end, wz0], [end, wz1]];
    wall(group, M, e[0], e[1], 0, Wg.eave, west ? [[wz1 - entrance.z, entrance.h / 2, entrance.w, entrance.h, 'open']] : [], y0);
    gable(group, M, e[0], e[1], Wg.eave, Wg.ridge, y0);
    const ex = end + (west ? T : -T);
    if (west) { seg([ex, wz0], [ex, entrance.z - entrance.w / 2]); seg([ex, entrance.z + entrance.w / 2], [ex, wz1]); } else seg([ex, wz0], [ex, wz1]);
  }
  // ---- the waiting area (the centre) is closed off from the wings: a door each side, reception's and the bar's
  const wdz = mz, wdw = 1.1;
  for (const x of [cx0, cx1]) {
    // (the waiting area's face flush with its other walls, so no slit at the corners)
    const inW = x === cx0 ? [[x, wz1], [x, wz0]] : [[x, wz0], [x, wz1]], outW = [inW[1], inW[0]];
    wall(group, M, inW[0], inW[1], 0, Wg.eave + 0.02, [[Math.abs(wdz - inW[0][1]), 1.05, wdw, 2.1, 'open']], y0, T);
    wall(group, M, outW[0], outW[1], 0, Wg.eave, [[Math.abs(wdz - outW[0][1]), 1.05, wdw, 2.1, 'open']], y0, 0.03);
    seg([x, wz0], [x, wdz - wdw / 2], lowWalls); seg([x, wdz + wdw / 2], [x, wz1], lowWalls);
    seg([x, wz0], [x, wz1], upWalls);
  }
  // ---- stairs: up the east wall at the back of the waiting area, climbing towards the back, a landing at the top
  const st = { x0: cx1 - T - 1.1, x1: cx1 - T, zBot: Z1 - T - 0.9 - UP / 0.68, zTop: Z1 - T - 0.9 };
  const steps = Math.round(UP / 0.18), run = (st.zTop - st.zBot) / steps;
  for (let i = 0; i < steps; i++) group.add(box(M, M.beam, st.x1 - st.x0, 0.06, run + 0.02, (st.x0 + st.x1) / 2, F + (i + 1) * UP / steps - 0.06, st.zBot + (i + 0.5) * run));
  {
    // (a solid side to the flight)
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute([st.x0, F, st.zBot, st.x0, F, st.zTop, st.x0, F + UP, st.zTop, st.x0, F, st.zTop, st.x0, F, Z1 - T, st.x0, F + UP, Z1 - T, st.x0, F, st.zTop, st.x0, F + UP, Z1 - T, st.x0, F + UP, st.zTop], 3));
    g.computeVertexNormals();
    group.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x5b4330, roughness: 0.7, side: THREE.DoubleSide })));
  }
  seg([st.x0, st.zBot + 0.4], [st.x0, Z1 - T], lowWalls);
  // ---- upstairs: a whole floor over the waiting area, open round the stairwell (a rail)
  const slab = (x0, z0, x1, z1) => {
    // (oak boards on top, a plastered ceiling underneath for the waiting area, plain edges)
    group.add(box(M, M.ceiling, x1 - x0, 0.17, z1 - z0, (x0 + x1) / 2, UF - 0.175, (z0 + z1) / 2));
    floor(x0, z0, x1, z1, UF);
  };
  slab(cx0 + T, Z0 + T, cx1 - T, st.zBot); slab(cx0 + T, st.zBot, st.x0, Z1 - T); slab(st.x0, st.zTop, cx1 - T, Z1 - T);
  for (let z = st.zBot + 0.1; z < st.zTop; z += 0.12) group.add(box(M, M.trim, 0.025, 1.0, 0.025, st.x0 - 0.05, UF, z));
  for (let x = st.x0; x < st.x1; x += 0.12) group.add(box(M, M.trim, 0.025, 1.0, 0.025, x, UF, st.zBot));
  group.add(box(M, M.top, 0.08, 0.06, st.zTop - st.zBot, st.x0 - 0.05, UF + 1.0, (st.zBot + st.zTop) / 2), box(M, M.top, st.x1 - st.x0, 0.06, 0.08, (st.x0 + st.x1) / 2, UF + 1.0, st.zBot));
  seg([st.x0 - 0.05, st.zBot], [st.x0 - 0.05, st.zTop], upWalls); seg([st.x0 - 0.05, st.zBot], [cx1, st.zBot], upWalls);
  // the viewing area at the front, by the gable window: benches and a high table
  for (const dx of [-1.6, 1.6]) {
    for (const sx of [-0.45, 0.45]) {
      furnish(group, 'modern_arm_chair_01', mx + dx + sx, UF, Z0 + 2.4, Math.PI);
      seats.push({ x: mx + dx + sx, z: Z0 + 2.4, y: UF + 0.45, yaw: Math.PI, seat: true });
    }
  }
  group.add(box(M, M.top, 1.2, 0.04, 0.6, mx, UF + 1.05, Z0 + 4.2), box(M, M.steel, 0.06, 1.05, 0.06, mx, UF, Z0 + 4.2));
  // ---- the admins' office: upstairs at the back, west of the stairs; its door opens only for an admin
  const ox1 = st.x0 - 1.4, oz0 = st.zBot - 0.4, odoor = { x: ox1, z: (oz0 + Z1) / 2 + 0.6, w: 0.95 };
  {
    // front partition, up to the roof where it's lower than 2.6 m
    const top = (x) => Math.min(UF + 2.6, vault(x) - 0.02), pts = [new THREE.Vector2(cx0 + T, UF), new THREE.Vector2(ox1, UF)];
    for (let i = 0; i <= 16; i++) { const x = ox1 - (ox1 - cx0 - T) * i / 16; pts.push(new THREE.Vector2(x, top(x))); }
    const g = new THREE.ShapeGeometry(new THREE.Shape(pts)); g.translate(0, 0, oz0);
    const m = new THREE.Mesh(g, M.wall2); m.receiveShadow = true; group.add(m);
    wall(group, M, [ox1, oz0], [ox1, Z1 - T], UF - y0, UF - y0 + 2.6, [[odoor.z - oz0, UF - y0 + 1.05, odoor.w, 2.1, 'open']], y0, 0);
    wall(group, M, [ox1, Z1 - T], [ox1, oz0], UF - y0, UF - y0 + 2.6, [[Z1 - T - odoor.z, UF - y0 + 1.05, odoor.w, 2.1, 'open']], y0, 0);
    seg([cx0, oz0], [ox1, oz0], upWalls); seg([ox1, oz0], [ox1, odoor.z - odoor.w / 2], upWalls); seg([ox1, odoor.z + odoor.w / 2], [ox1, Z1], upWalls);
  }
  const officeDoor = new THREE.Mesh(new THREE.BoxGeometry(0.06, 2.1, odoor.w), new THREE.MeshStandardMaterial({ color: 0x4a3526, roughness: 0.6 }));
  officeDoor.position.set(ox1, UF + 1.05, odoor.z); group.add(officeDoor);
  const sign = canvasTex(256, 64, (g, w, h) => { g.fillStyle = '#1a1a1c'; g.fillRect(0, 0, w, h); g.fillStyle = '#e2b33c'; g.font = 'bold 34px Arial'; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText('ADMIN OFFICE', w / 2, h / 2); });
  const plate = new THREE.Mesh(new THREE.PlaneGeometry(0.6, 0.15), new THREE.MeshBasicMaterial({ map: sign })); plate.position.set(ox1 + 0.04, UF + 2.3, odoor.z); plate.rotation.y = Math.PI / 2; group.add(plate);
  {
    const ocx = (cx0 + ox1) / 2 + 0.6, dz = Z1 - T - 1.1;
    group.add(box(M, M.top, 1.8, 0.05, 0.8, ocx, UF + 0.73, dz), box(M, M.counter, 0.06, 0.73, 0.7, ocx - 0.85, UF, dz), box(M, M.counter, 0.06, 0.73, 0.7, ocx + 0.85, UF, dz));
    for (const dx of [-0.35, 0.35]) { group.add(box(M, M.counter, 0.62, 0.38, 0.04, ocx + dx, UF + 0.95, dz + 0.25)); const sc = new THREE.Mesh(new THREE.PlaneGeometry(0.58, 0.34), new THREE.MeshBasicMaterial({ color: 0x1e3a5f })); sc.position.set(ocx + dx, UF + 1.14, dz + 0.225); sc.rotation.y = Math.PI; group.add(sc); }
    furnish(group, 'modern_arm_chair_01', ocx, UF, dz - 0.9, 0); seats.push({ x: ocx, z: dz - 0.9, y: UF + 0.45, yaw: 0, seat: true, office: true });
    // shelving against the partition, inside, where the sloping roof leaves room for it (its model is built ten times too big: sized to 1.8 m)
    furnish(group, 'steel_frame_shelves_01', mx - 2.4, UF, oz0 + 0.3, 0, { height: 1.8 });
    furnish(group, 'desk_lamp_arm_01', ocx + 0.7, UF + 0.755, dz + 0.15, Math.PI * 0.85);
    plant(group, M, mx - 1.2, UF, oz0 + 0.45);
  }
  // ---- the waiting area: chairs facing the live TV and the Fastest Drivers board on the west wall, helmets on the walls at the front
  const tvW = 2.6, tvH = tvW * 9 / 16, tvZ = Z1 - T - 4.4, tvX = cx0 + T + 0.05;
  group.add(box(M, M.counter, 0.08, tvH + 0.1, tvW + 0.1, tvX, F + 1.15 - 0.05, tvZ));
  const tvScreen = new THREE.Mesh(new THREE.PlaneGeometry(tvW, tvH), M.screen);
  tvScreen.position.set(tvX + 0.05, F + 1.15 + tvH / 2, tvZ); tvScreen.rotation.y = Math.PI / 2; group.add(tvScreen);
  const board = new THREE.Mesh(new THREE.PlaneGeometry(2.0, 1.25), new THREE.MeshBasicMaterial({ color: 0x111111 }));
  board.position.set(tvX + 0.05, F + 1.85, Z1 - T - 1.6); board.rotation.y = Math.PI / 2; group.add(board);
  for (const x of [cx0 + 2.3, cx0 + 3.6, cx0 + 4.9]) {
    for (let z = tvZ - 1.2; z <= Z1 - T - 1.0; z += 0.8) chair(group, M, x, F, z, -Math.PI / 2, seats);
    solids.push({ x, z: (tvZ - 1.2 + Z1 - T - 1.0) / 2, w: 0.55, d: Z1 - T - 1.0 - tvZ + 1.7, yaw: 0 });
  }
  helmetWall(group, M, cx0 + T, 1, Z0 + T + 0.45, wz0 - 0.35, F);
  helmetWall(group, M, cx1 - T, -1, Z0 + T + 0.45, wz0 - 0.35, F);
  plant(group, M, mx - 2.2, F, Z0 + T + 0.4); plant(group, M, mx + 2.2, F, Z0 + T + 0.4);
  // ---- reception (the west wing): the main entrance in the end wall, the check-in desk, the session times
  const dx0 = X0 + 3.4, dx1 = X0 + 7.6, dz = wz1 - T - 1.6;
  group.add(box(M, M.counter, dx1 - dx0, 1.05, 0.6, (dx0 + dx1) / 2, F, dz), box(M, M.top, dx1 - dx0 + 0.1, 0.05, 0.75, (dx0 + dx1) / 2, F + 1.05, dz + 0.05));
  solids.push({ x: (dx0 + dx1) / 2, z: dz, w: dx1 - dx0, d: 0.8, yaw: 0 });
  for (const x of [dx0 + 0.9, dx1 - 0.9]) { group.add(box(M, M.counter, 0.45, 0.3, 0.04, x, F + 1.1, dz + 0.1)); }
  const times = sessionTimes();
  for (const [x, tex] of [[X0 + 4.5, times]]) {                                  // (between the windows)
    const s = new THREE.Mesh(new THREE.PlaneGeometry(1.5, 0.85), new THREE.MeshBasicMaterial({ map: tex, toneMapped: false }));
    s.position.set(x, F + 1.75, wz1 - T - 0.03); s.rotation.y = Math.PI; group.add(s);
    group.add(box(M, M.counter, 1.56, 0.91, 0.04, x, F + 1.75 - 0.455, wz1 - T - 0.01));
  }
  // two armchairs each side of a small round table, under the front windows
  for (const x of [X0 + 2.5, X0 + 6.5]) {
    const z = wz0 + T + 0.55;
    for (const dx of [-0.75, 0.75]) { furnish(group, 'modern_arm_chair_01', x + dx, F, z, 0); seats.push({ x: x + dx, z, y: F + 0.45, yaw: 0, seat: true }); }
    furnish(group, 'coffee_table_round_01', x, F, z + 0.1, 0);
    solids.push({ x, z, w: 2.3, d: 0.8, yaw: 0 });
  }
  plant(group, M, X0 + T + 0.4, F, entrance.z - entrance.w / 2 - 0.5); plant(group, M, X0 + T + 0.4, F, entrance.z + entrance.w / 2 + 0.5);
  plant(group, M, cx0 - 0.5, F, wz0 + T + 0.4);
  // ---- the bar (the east wing): along the back, stools, a TV over it (between the windows), arcade cabinets on the end wall
  const bx0 = cx1 + 0.8, bx1 = X1 - 1.4, bz = wz1 - T - 0.45;
  group.add(box(M, M.counter, bx1 - bx0, 1.05, 0.6, (bx0 + bx1) / 2, F, bz), box(M, M.top, bx1 - bx0 + 0.1, 0.05, 0.75, (bx0 + bx1) / 2, F + 1.05, bz - 0.05));
  solids.push({ x: (bx0 + bx1) / 2, z: bz, w: bx1 - bx0, d: 0.8, yaw: 0 });
  for (let x = bx0 + 0.5; x < bx1 - 0.3; x += 0.9) stool(group, M, x, F, bz - 0.85, seats, 0);
  for (let i = 0; i < 3; i++) {
    const ax = X1 - T - 0.45, az = wz0 + T + 0.9 + i * 1.0;
    group.add(box(M, M.counter, 0.7, 1.8, 0.75, ax, F, az));
    const scr = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.55), new THREE.MeshBasicMaterial({ color: [0xaa2233, 0x2255aa, 0x22aa66][i] })); scr.position.set(ax - 0.36, F + 1.35, az); scr.rotation.y = -Math.PI / 2; group.add(scr);
    group.add(box(M, M.red, 0.3, 0.12, 0.75, ax - 0.3, F + 1.0, az));
    solids.push({ x: ax, z: az, w: 0.75, d: 0.75, yaw: 0 });
  }
  const ew = wins.filter(x => x > cx1).sort((a, b) => a - b), tv2x = (ew[0] + ew[1]) / 2;
  const tv2 = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 0.9), M.screen);
  tv2.position.set(tv2x, F + 2.3, wz1 - T - 0.04); tv2.rotation.y = Math.PI; group.add(tv2);
  // ---- photo frames (the photos come later), none over a window
  const photos = [];
  const frame = (x, y, z, ry, w, h) => {
    const f = box(M, M.trim, w + 0.08, h + 0.08, 0.04, x, y - (h + 0.08) / 2, z, ry); group.add(f);
    const p = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshStandardMaterial({ color: 0xcfcac2, roughness: 0.6 }));
    p.position.set(x + Math.sin(ry) * 0.025, y, z + Math.cos(ry) * 0.025); p.rotation.y = ry; group.add(p); photos.push(p);
  };
  for (const z of [entrance.z - 2.4, entrance.z + 2.4]) frame(X0 + T + 0.03, F + 1.7, z, Math.PI / 2, 1.0, 0.7);
  frame(X0 + 8.5, F + 1.7, wz1 - T - 0.03, Math.PI, 1.1, 0.75);             // (between the windows)
  for (const x of [cx0 + 1.4, cx1 - 1.4]) frame(x, F + 1.7, Z0 + T + 0.03, 0, 1.0, 0.7);
  // ---- light: warm ceiling lights (only while someone's inside)
  const lights = [];
  // [x, z, the light's height, the ceiling its lamp hangs from] (heights above y0)
  for (const [x, z, y, top] of [[mx, Z0 + 6, UP - 0.25, UP - 0.18], [mx - 1.5, Z1 - 4, UP - 0.25, UP - 0.18], [X0 + 5, mz, Wg.eave - 0.3, Wg.eave - 0.02],
    [(cx1 + X1) / 2, mz, Wg.eave - 0.3, Wg.eave - 0.02], [mx, Z0 + 8, C.eave + 0.8, vault(mx) - y0 - 0.05]]) {
    const l = new THREE.PointLight(0xffe2bd, 0, 12, 1.5); l.visible = false; l.position.set(x, y0 + y, z); lights.push(l); group.add(l);
    furnish(group, 'modern_ceiling_lamp_01', x, y0 + top + 0.06, z, 0, 1, true);   // (+0.06: its mounting tucked into the ceiling)
  }
  // ---- where the floor is: the ground floor, upstairs over the waiting area, the stairs between
  function floorAt(x, z, y) {
    if (x > st.x0 - 0.05 && x < st.x1 + 0.05 && z > st.zBot && z < st.zTop) return F + UP * Math.min(1, Math.max(0, (z - st.zBot) / (st.zTop - st.zBot)));
    if (x > cx0 && x < cx1 && z > Z0 && z < Z1 && y > F + UP / 2) return UF;
    return F;
  }
  return {
    group, lights, seats, walls, upWalls, lowWalls, solids, floorAt, photos, F, UP,
    tv: tvScreen, tv2, board,
    office: { door: odoor, mesh: officeDoor },
    inside: (x, z) => (x > cx0 && x < cx1 && z > Z0 && z < Z1) || (x > X0 && x < X1 && z > wz0 && z < wz1),
    spawn: { x: X0 + 1.4, z: entrance.z, yaw: -Math.PI / 2 },     // (just inside the main entrance, facing in)
    entrance: { x: X0, z: entrance.z },
  };
}

// a waiting-room chair, facing (sin yaw, cos yaw)
function chair(group, M, x, y, z, yaw, seats) {
  furnish(group, 'SchoolChair_01', x, y, z, yaw);
  seats.push({ x, z, y: y + 0.48, yaw, seat: true });
}
// a wall of helmets on shelves (wall at x, the room towards side s), from
// z0 to z1: the drivers' own helmet model, in the game's helmet designs
const RACK = [1.0, 1.45, 1.9, 2.35];                    // shelf heights (m)
function helmetWall(group, M, x, s, z0, z1, F) {
  const n = Math.floor((z1 - z0) / 0.55), dz = (z1 - z0) / n;
  for (const h of RACK) group.add(box(M, M.top, 0.3, 0.03, z1 - z0 + 0.2, x + s * 0.16, F + h - 0.03, (z0 + z1) / 2));
  const spots = [];
  RACK.forEach((h, r) => { for (let i = 0; i < n; i++) spots.push({ x: x + s * 0.17, y: F + h, z: z0 + (i + 0.5) * dz, k: i * 5 + r * 3 + (s > 0 ? 0 : 7) }); });
  loadHelmetParts().then((P) => {
    const looks = helmetLooks(), m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
    const strip = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.4 });
    const stripMesh = new THREE.InstancedMesh(P.strip, strip, spots.length);
    looks.forEach((look, li) => {
      const mine = spots.filter(sp => sp.k % looks.length === li);
      if (!mine.length) return;
      const t = paintHelmet(look, 512, 256); t.wrapS = THREE.RepeatWrapping;
      const shell = new THREE.MeshPhysicalMaterial({ map: t, roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 });
      const parts = [...P.shells.map(g => new THREE.InstancedMesh(g, shell, mine.length)), new THREE.InstancedMesh(P.glass, visorMaterial(look.visor), mine.length)];
      mine.forEach((sp, j) => {
        // facing the room, each turned a little differently
        q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), -s * Math.PI / 2 + (((sp.k * 37) % 9) - 4) * 0.06);
        m.compose(p.set(sp.x, sp.y + P.half.y, sp.z), q, one);
        for (const part of parts) part.setMatrixAt(j, m);
        stripMesh.setMatrixAt(spots.indexOf(sp), m);
      });
      for (const part of parts) { part.castShadow = true; group.add(part); }
    });
    group.add(stripMesh);
  }).catch((e) => console.warn('helmet wall', e));
}
// the helmets on the walls: a dozen of the game's designs in team colours
function helmetLooks() {
  const designs = Object.keys(DESIGNS).filter(d => d !== 'solid'), visors = Object.keys(VISORS);
  const cols = [['#d42a2a', '#f4f4f4', '#111111'], ['#1f5fd1', '#f2b705', '#0d1b3d'], ['#111111', '#e2b33c', '#f4f4f4'], ['#f4f4f4', '#d42a2a', '#1d2733'],
    ['#2aa84a', '#111111', '#f4f4f4'], ['#ff6a13', '#1d2733', '#f4f4f4'], ['#7a2ad4', '#00c2e0', '#111111'], ['#f2b705', '#111111', '#d42a2a'],
    ['#00a3c4', '#f4f4f4', '#0d1b3d'], ['#c0c4c8', '#d42a2a', '#111111'], ['#0d1b3d', '#ff6a13', '#f4f4f4'], ['#e2574c', '#f4f4f4', '#1d2733']];
  return cols.map(([primary, secondary, accent], i) => ({ ...HELMET_DEFAULT, design: designs[(i * 5) % designs.length], primary, secondary, accent,
    visor: visors[i % visors.length], number: String((i * 7) % 99 + 1) }));
}
// the reception's screen: today's sessions, every quarter hour
function sessionTimes() {
  return canvasTex(512, 290, (g, w, h) => {
    g.fillStyle = '#0d0f12'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#e2b33c'; g.font = 'bold 34px Arial'; g.textBaseline = 'top'; g.fillText('SESSION TIMES', 24, 18);
    g.font = '24px Arial';
    const d = new Date(); d.setMinutes(Math.ceil(d.getMinutes() / 15) * 15, 0, 0);
    for (let i = 0; i < 5; i++) {
      const t = new Date(d.getTime() + i * 15 * 60000), y = 74 + i * 42;
      g.fillStyle = i ? '#e8e8e8' : '#7fe08a';
      g.fillText(t.toTimeString().slice(0, 5), 24, y);
      g.fillText(i ? 'Arrive & Drive · 10 laps' : 'Now checking in', 130, y);
      g.fillStyle = '#8a8f96'; g.fillText(i ? `${4 + ((i * 5) % 7)} of 11` : '', 420, y);
    }
  });
}
