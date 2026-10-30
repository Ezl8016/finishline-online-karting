// The pits made lived-in: a row of parked rental karts at the back of the
// apron (clear of the grid slots, main.js placePit, and the clubhouse porch),
// spare tyres and a stack of cones, and the mechanics' things on the concrete
// in front of the bar (tool chests, fuel drums, an oil can, a bin, boxes:
// Poly Haven models, CC0, in models/pit/); and sponsor banners, made-up names
// and our own, on the tyre walls all round the circuit (closest together
// along the start/finish straight), and free-standing boards round every
// layout where there's no tyre wall.
// buildPits resolves to { group, solids: [{ x, z, hx, hz, h, yaw }] } (boxes the karts bump into).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const KART_ROW = { z: 78.4, xs: [9.3, 11.4, 19.5, 21.8, 24.1, 26.4, 28.7] };   // parked karts, facing the track
// [model, x, z, yaw, solid half-size (x, z) or null]
const PROPS = [
  ['metal_tool_chest', 21.4, 81.0, Math.PI, [0.4, 0.3]], ['metal_tool_chest', 22.6, 80.9, Math.PI + 0.12, [0.4, 0.3]],
  ['Barrel_02', 27.6, 81.2, 0.3, [0.32, 0.32]], ['Barrel_02', 28.35, 81.55, 1.1, [0.32, 0.32]], ['Barrel_02', 27.9, 82.15, 2.0, [0.32, 0.32]],
  ['small_oil_can_01', 23.6, 80.7, 0.6, null], ['small_oil_can_01', 23.85, 80.85, 2.4, null],
  ['metal_trash_can', 29.7, 82.8, 0, [0.3, 0.3]],
  ['cardboard_box_01', 25.4, 81.3, 0.2, [0.3, 0.3]], ['cardboard_box_01', 25.9, 81.7, 1.4, [0.3, 0.3]],
];
const TYRE_PILES = [[30.5, 78.7, 5], [31.1, 78.05, 4], [31.15, 79.3, 3], [8.6, 80.9, 4]];   // [x, z, how many high]
const CONE_STACK = [7.9, 78.3, 6];
const BRANDS = [
  { text: 'GRIDLINE ONLINE KARTING', bg: '#121417', fg: '#ffffff', stripe: '#e0362c' },
  { text: 'COASTAL FUEL CO.', bg: '#1f5fd1', fg: '#ffd23f', stripe: '#ffd23f' },
  { text: 'SANDBAR TYRES', bg: '#f2c200', fg: '#111111', stripe: '#111111' },
  { text: 'BAYOU BRAKES', bg: '#f4f4f2', fg: '#c8241c', stripe: '#c8241c' },
  { text: 'PITLANE PIZZA', bg: '#1f7a3a', fg: '#ffffff', stripe: '#ffffff' },
  { text: 'TIDEWATER ENERGY DRINK', bg: '#0b2a4a', fg: '#4fe0ff', stripe: '#4fe0ff' },
  { text: 'GULF COAST CHASSIS', bg: '#2b2b2b', fg: '#ff7a1a', stripe: '#ff7a1a' },
  { text: 'SEAWALL SPARK PLUGS', bg: '#ffffff', fg: '#1f5fd1', stripe: '#e0362c' },
  { text: 'MAGNOLIA MOTOR OIL', bg: '#5b1f6e', fg: '#ffd9f2', stripe: '#ffd9f2' },
  { text: 'SHRIMP SHACK GRILL', bg: '#ff6a3d', fg: '#ffffff', stripe: '#1d2733' },
];

const loader = new GLTFLoader();
const models = new Map();
function model(id) {
  if (!models.has(id)) models.set(id, loader.loadAsync(`models/pit/${id}/${id}.gltf`).then((g) => g.scene));
  return models.get(id);
}

// a vinyl banner, its brand in bold italic capitals on a coloured ground with a stripe
function bannerTexture(b) {
  const c = document.createElement('canvas'); c.width = 1024; c.height = 154;
  const g = c.getContext('2d');
  g.fillStyle = b.bg; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = b.stripe; g.fillRect(0, c.height - 16, c.width, 10); g.fillRect(0, 6, c.width, 4);
  g.fillStyle = b.fg; g.font = 'italic 900 96px Impact, "Arial Black", sans-serif'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(b.text, c.width / 2, c.height / 2 + 2, c.width - 60);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8;
  return t;
}

export async function buildPits(track, groundAt, envMap, tyreGeometry, coneBuilder) {
  const group = new THREE.Group();
  group.name = 'pits';
  const solids = [];
  const Y = new THREE.Vector3(0, 1, 0);
  // ---- the mechanics' things
  const shadow = (o) => o.traverse((m) => { if (m.isMesh) { m.castShadow = m.receiveShadow = true; for (const mt of [].concat(m.material)) if (mt.isMeshStandardMaterial) mt.envMap = envMap; } });
  await Promise.all(PROPS.map(async ([id, x, z, yaw, solid]) => {
    try {
      const o = (await model(id)).clone(true);
      o.position.set(x, groundAt(x, z), z); o.rotation.y = yaw;
      shadow(o); group.add(o);
      if (solid) solids.push({ x, z, hx: solid[0], hz: solid[1], h: 0.5, yaw });
    } catch (e) { console.warn('pit prop', id, e); }
  }));
  // ---- spare tyres, stacked; and a stack of cones
  const n = TYRE_PILES.reduce((s, p) => s + p[2], 0);
  const tyres = new THREE.InstancedMesh(tyreGeometry, new THREE.MeshStandardMaterial({ color: 0x1c1c1c, roughness: 0.82 }), n);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  let k = 0;
  for (const [x, z, h] of TYRE_PILES) {
    for (let i = 0; i < h; i++) {
      const j = Math.sin(x * 7 + i * 3.1) * 0.03;
      m.compose(p.set(x + j, groundAt(x, z) + 0.087 + i * 0.174, z - j), q.setFromAxisAngle(Y, i * 1.3 + x), one);
      tyres.setMatrixAt(k++, m);
    }
    solids.push({ x, z, hx: 0.29, hz: 0.29, h: h * 0.174, yaw: 0 });
  }
  tyres.castShadow = tyres.receiveShadow = true;
  group.add(tyres);
  const [cx, cz, cn] = CONE_STACK;
  for (let i = 0; i < cn; i++) { const c = coneBuilder([[cx, cz]], groundAt); c.position.y += i * 0.075; group.add(c); }
  // ---- sponsor banners on the tyre walls, facing the track (the nearest bit of any layout's)
  const [fx, fz] = track.finish || [0, 0];
  const lines = (track.layouts?.length ? track.layouts : [{}]).map(l => l.centerline || track.centerline);
  const cl = lines.flat();
  const wall = track.tyres || [];
  const used = [];
  let b = 0;
  for (const [x, z] of wall) {
    if (b >= 16 || used.some(([ux, uz]) => Math.hypot(ux - x, uz - z) < (Math.hypot(x - fx, z - fz) < 32 ? 10 : 30))) continue;   // (closer together on the straight)
    // the wall's direction here: the stacks within 2 m either side
    const run = wall.filter(([wx, wz]) => Math.hypot(wx - x, wz - z) < 2.2);
    if (run.length < 6) continue;
    const mx = run.reduce((s, r) => s + r[0], 0) / run.length, mz = run.reduce((s, r) => s + r[1], 0) / run.length;
    let sxx = 0, sxz = 0, szz = 0;
    for (const [rx, rz] of run) { sxx += (rx - mx) ** 2; sxz += (rx - mx) * (rz - mz); szz += (rz - mz) ** 2; }
    const ang = 0.5 * Math.atan2(2 * sxz, sxx - szz), dx = Math.cos(ang), dz = Math.sin(ang);
    // facing the nearest bit of track
    let best = null, bd = Infinity;
    for (const c of cl) { const d = (c[0] - mx) ** 2 + (c[1] - mz) ** 2; if (d < bd) { bd = d; best = c; } }
    if (Math.sqrt(bd) > 12) continue;
    let nx = -dz, nz = dx;
    if ((best[0] - mx) * nx + (best[1] - mz) * nz < 0) { nx = -nx; nz = -nz; }
    // just clear of the furthest-out tyre along the banner's length (a tyre is 0.29 m round; stacks sit a little off-line)
    let front = 0;
    for (const [wx, wz] of wall) {
      const along = (wx - mx) * dx + (wz - mz) * dz, out = (wx - mx) * nx + (wz - mz) * nz;
      if (Math.abs(along) < 1.6 + 0.3 && Math.abs(out) < 1.0) front = Math.max(front, out);   // (this wall only)
    }
    const off = front + 0.29 + 0.06;
    const brand = BRANDS[b % BRANDS.length];
    brand.mat ??= new THREE.MeshStandardMaterial({ map: bannerTexture(brand), roughness: 0.6 });   // (one per brand, shared)
    const ban = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.48), brand.mat);
    ban.position.set(mx + nx * off, groundAt(mx, mz) + 0.3, mz + nz * off);
    ban.rotation.y = Math.atan2(nx, nz);
    ban.receiveShadow = true;
    group.add(ban);
    used.push([mx, mz]); b++;
  }
  // ---- and free-standing advertising boards all round every layout, where
  // there's no tyre wall: on the outside of the corners (where you look),
  // off every track, clear of the pits, the clubhouse and the pond
  const hw = (track.trackWidth || 6.8) / 2;
  const pond = await fetch('assets/ground/features.json').then(r => r.json()).then(f => f.pond || []).catch(() => []);
  const inPoly = (poly, x, z) => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const [xi, zi] = poly[i], [xj, zj] = poly[j]; if ((zi > z) !== (zj > z) && x < (xj - xi) * (z - zi) / (zj - zi) + xi) c = !c; } return c; };
  const clear = (x, z) => {
    if (x > -9 && x < 41 && z > 56 && z < 103) return false;                       // the pits, clubhouse, patio
    if (inPoly(pond, x, z)) return false;
    for (const c of cl) if ((c[0] - x) ** 2 + (c[1] - z) ** 2 < (hw + 2.2) ** 2) return false;   // on (or right by) a track
    for (const [tx, tz] of wall) if ((tx - x) ** 2 + (tz - z) ** 2 < 2.5 ** 2) return false;   // a tyre wall's there
    return !used.some(([ux, uz]) => Math.hypot(ux - x, uz - z) < 28);
  };
  const legMat = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, roughness: 0.5, metalness: 0.6 });
  const leg = new THREE.BoxGeometry(0.06, 0.95, 0.06), back = new THREE.BoxGeometry(3.2, 0.6, 0.03);
  let boards = 0;
  for (const line of lines) {
    const n = line.length;
    for (let i = 0; i < n; i += 6) {
      const a = line[(i - 6 + n) % n], c = line[i], e = line[(i + 6) % n];
      const tx = e[0] - a[0], tz = e[1] - a[1], tl = Math.hypot(tx, tz) || 1;
      const turn = Math.sign((c[0] - a[0]) * (e[1] - c[1]) - (c[1] - a[1]) * (e[0] - c[0])) || 1;
      for (const side of [-turn, turn]) {                                          // the outside of the bend first
        if (boards >= 10) break;
        const nx = (-tz / tl) * side, nz = (tx / tl) * side, off = hw + 3.0;
        const x = c[0] + nx * off, z = c[1] + nz * off;
        if (!clear(x, z)) continue;
        const brand = BRANDS[b % BRANDS.length];
        brand.mat ??= new THREE.MeshStandardMaterial({ map: bannerTexture(brand), roughness: 0.6 });
        const board = new THREE.Group(), y = groundAt(x, z);
        const face = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 0.6), brand.mat); face.position.set(0, 0.62, 0.02);
        const bk = new THREE.Mesh(back, legMat); bk.position.set(0, 0.62, 0);
        board.add(face, bk);
        for (const lx of [-1.4, 1.4]) { const l = new THREE.Mesh(leg, legMat); l.position.set(lx, 0.475, -0.03); board.add(l); }
        board.position.set(x, y, z);
        board.rotation.y = Math.atan2(-nx, -nz);                                   // its face towards the track
        board.traverse((o) => { if (o.isMesh) o.castShadow = o.receiveShadow = true; });
        group.add(board);
        solids.push({ x, z, hx: 1.6, hz: 0.08, h: 0.95, yaw: board.rotation.y });
        used.push([x, z]); b++; boards++;
        break;
      }
    }
  }
  return { group, solids, kartRow: KART_ROW };
}

// the parked karts: clones of one rental kart (its visual object, already finished), facing the track
export function parkKarts(group, kartObject, groundAt, cgHeight, solids) {
  for (const x of KART_ROW.xs) {
    const o = kartObject.clone(true);
    o.position.set(x, groundAt(x, KART_ROW.z) + cgHeight, KART_ROW.z);
    o.rotation.y = Math.sin(x * 3.3) * 0.06;
    o.traverse((m) => { if (m.isMesh) m.castShadow = m.receiveShadow = true; });
    group.add(o);
    solids.push({ x, z: KART_ROW.z, hx: 0.7, hz: 0.95, h: 0.6, yaw: o.rotation.y });
  }
}
