// Buildings from OpenStreetMap footprints: walls in a finish suited to the
// building's size (painted plaster with real windows and a front door for
// houses and mid-size buildings, corrugated metal for the big sheds), flat
// roofs coloured from the satellite photo with air-conditioning units on
// them, and small rectangular buildings a pitched roof of shingles and a
// condenser beside them. (The clubhouse is modelled separately.)

import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { packedNormal } from './packed.js';

const BAY = 4.0, FLOOR = 3.2;             // facade texture repeat (m)

// Wall and roof finishes: scanned textures (tools/import_textures.py), the
// walls a plain light grey so each building's paint colour tints them. UVs
// are in facade units (BAY x FLOOR) for walls, metres for roofs.
let FINISH = null;
function finishes() {
  if (FINISH) return FINISH;
  const L = new THREE.TextureLoader(), size = { plaster: 2.0, metal: 2.7, shingles: 8.0 };   // m (assets/buildings/textures.json)
  const tex = (name, rx, ry) => ['albedo', 'normal'].map((k) => {
    const t = L.load(`assets/buildings/${name}_${k}.jpg`);
    t.colorSpace = k === 'albedo' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8; t.repeat.set(rx, ry);
    return t;
  });
  FINISH = {
    plaster: tex('plaster', BAY / size.plaster, FLOOR / size.plaster),
    metal: tex('metal', BAY / size.metal, FLOOR / size.metal),
    shingles: tex('shingles', 1 / size.shingles, 1 / size.shingles),
  };
  return FINISH;
}

// A window as it sits in a wall, facing +z: a white frame standing a little
// proud of the wall with a cross of glazing bars, a sill, and the glass
// (separate, so it can reflect the sky). w x h: the glass.
function windowParts(w = 1.2, h = 1.3) {
  const F = 0.07, D = 0.1, parts = [];
  const bar = (bw, bh, bd, x, y, z) => parts.push(new THREE.BoxGeometry(bw, bh, bd).translate(x, y, z));
  bar(w + 2 * F, F, D, 0, (h + F) / 2, D / 2); bar(w + 2 * F, F, D, 0, -(h + F) / 2, D / 2);
  bar(F, h, D, -(w + F) / 2, 0, D / 2); bar(F, h, D, (w + F) / 2, 0, D / 2);
  bar(0.035, h, 0.04, 0, 0, 0.03); bar(w, 0.035, 0.04, 0, 0, 0.03);
  bar(w + 2 * F + 0.1, 0.05, 0.17, 0, -(h / 2 + F + 0.025), 0.085);
  return { frame: mergeGeometries(parts), glass: new THREE.PlaneGeometry(w, h).translate(0, 0, 0.012) };
}

// Smallest-area bounding rectangle (axis along one of the edges).
function obb(ring) {
  let best = null;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], b = ring[(i + 1) % ring.length];
    const ux = b[0] - a[0], uz = b[1] - a[1], ul = Math.hypot(ux, uz);
    if (ul < 1e-6) continue;
    const u = [ux / ul, uz / ul], v = [-u[1], u[0]];
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity;
    for (const p of ring) {
      const pu = p[0] * u[0] + p[1] * u[1], pv = p[0] * v[0] + p[1] * v[1];
      u0 = Math.min(u0, pu); u1 = Math.max(u1, pu); v0 = Math.min(v0, pv); v1 = Math.max(v1, pv);
    }
    const area = (u1 - u0) * (v1 - v0);
    if (!best || area < best.area) best = { area, u, v, u0, u1, v0, v1 };
  }
  // ridge along the long side
  if (best.v1 - best.v0 > best.u1 - best.u0) {
    best = { area: best.area, u: best.v, v: [-best.u[0], -best.u[1]], u0: best.v0, u1: best.v1, v0: -best.u1, v1: -best.u0 };
  }
  return best;
}

// ---------------------------------------------------------------- clubhouse
// Gridline's clubhouse, from a photo: white board-and-batten walls, a light
// grey standing-seam metal roof, a tall centre section whose steep gable
// faces the track (big window up in the gable, the entrance below) and lower
// wings either side, gabled side to side. Fitted to its OSM outline (a cross).
function clubhouseTextures() {
  const tex = (w, h, draw) => {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    draw(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = 8;
    return t;
  };
  // 1 m x 1 m of siding: battens every 40 cm
  const siding = tex(256, 256, (g, w, h) => {
    g.fillStyle = '#f2f1ec'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += w * 0.4) { g.fillStyle = '#d8d7d1'; g.fillRect(x, 0, 7, h); g.fillStyle = '#ffffff'; g.fillRect(x + 7, 0, 4, h); }
  });
  // 1 m of roof across the slope: standing seams every 45 cm
  const roof = tex(256, 64, (g, w, h) => {
    g.fillStyle = '#c9cbcb'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += w * 0.45) { g.fillStyle = '#e4e6e6'; g.fillRect(x, 0, 6, h); g.fillStyle = '#a9abab'; g.fillRect(x + 6, 0, 3, h); }
  });
  // the siding's relief: battens standing proud of the boards (a bump map)
  const sidingBump = tex(256, 256, (g, w, h) => {
    g.fillStyle = '#404040'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += w * 0.4) { const gr = g.createLinearGradient(x - 2, 0, x + 13, 0); gr.addColorStop(0, '#404040'); gr.addColorStop(0.2, '#e0e0e0'); gr.addColorStop(0.8, '#e0e0e0'); gr.addColorStop(1, '#404040'); g.fillStyle = gr; g.fillRect(x - 2, 0, 15, h); }
    // the grain of painted wood
    for (let i = 0; i < 400; i++) { g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},0.05)`; g.fillRect(Math.random() * w, Math.random() * h, 1, 8 + Math.random() * 30); }
  });
  sidingBump.colorSpace = THREE.NoColorSpace;
  // the roof's ribs, raised
  const roofBump = tex(256, 64, (g, w, h) => {
    g.fillStyle = '#303030'; g.fillRect(0, 0, w, h);
    for (let x = 0; x < w; x += w * 0.45) { g.fillStyle = '#f0f0f0'; g.fillRect(x, 0, 8, h); }
  });
  roofBump.colorSpace = THREE.NoColorSpace;
  const glass = tex(128, 128, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    const grd = g.createLinearGradient(0, 0, 0, h); grd.addColorStop(0, '#6f8190'); grd.addColorStop(1, '#27313a');
    g.fillStyle = grd; g.fillRect(8, 8, w - 16, h - 16);
    g.fillStyle = '#ffffff'; g.fillRect(w / 2 - 3, 8, 6, h - 16); g.fillRect(8, h / 2 - 3, w - 16, 6);
  });
  return { siding, sidingBump, roof, roofBump, glass };
}

// the upstairs viewing area's window in the front gable (m: width, height, centre above the floor)
const GABLE_WIN = { w: 3.6, h: 1.9, y: 5.6 };
function clubhouse(ring, groundAt) {
  const xs = ring.map(p => p[0]), zs = ring.map(p => p[1]);
  const X0 = Math.min(...xs), X1 = Math.max(...xs), Z0 = Math.min(...zs), Z1 = Math.max(...zs);
  // centre section: the x-span of the corners at the front (min z); wings:
  // the z-span of the corners at the west end (min x)
  const front = ring.filter(p => Math.abs(p[1] - Z0) < 0.5).map(p => p[0]);
  const west = ring.filter(p => Math.abs(p[0] - X0) < 0.5).map(p => p[1]);
  const cx0 = Math.min(...front), cx1 = Math.max(...front), wz0 = Math.min(...west), wz1 = Math.max(...west);
  const y0 = Math.min(...ring.map(([x, z]) => groundAt(x, z)));
  const C = { eave: 4.4, ridge: 8.6 }, Wg = { eave: 3.3, ridge: 6.0 }, O = 0.45;
  const T = clubhouseTextures();
  const wall = { pos: [], uv: [] }, roof = { pos: [], uv: [] }, trim = { pos: [] };
  const add = (m, pts, uvs) => { for (const p of pts) m.pos.push(p[0], p[1] + y0, p[2]); if (uvs) m.uv.push(...uvs); };
  const quadWall = (a, b, h0, h1) => {          // vertical wall a->b from h0 to h1 (uv in metres)
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]);
    add(wall, [[a[0], h0, a[1]], [b[0], h0, b[1]], [b[0], h1, b[1]], [a[0], h0, a[1]], [b[0], h1, b[1]], [a[0], h1, a[1]]],
      [0, h0, L, h0, L, h1, 0, h0, L, h1, 0, h1]);
  };
  const gableEnd = (a, b, eave, ridge) => {     // triangle above the eave
    const L = Math.hypot(b[0] - a[0], b[1] - a[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    add(wall, [[a[0], eave, a[1]], [b[0], eave, b[1]], [m[0], ridge, m[1]]], [0, eave, L, eave, L / 2, ridge]);
  };
  // a gable roof over [x0,x1]x[z0,z1] with the ridge along x (alongX) or z;
  // ox0, ox1: its overhang past x0 and x1 (none where a wing meets the centre)
  const gableRoof = (x0, x1, z0, z1, eave, ridge, alongX, ox0 = O, ox1 = O) => {
    const half = alongX ? (z1 - z0) / 2 : (x1 - x0) / 2;
    const drop = (eave - ridge) * O / half;            // the overhang continues the slope down
    const slope = Math.hypot(half + O, ridge - eave - drop);
    const sides = alongX
      ? [[[x0 - ox0, eave + drop, z0 - O], [x1 + ox1, eave + drop, z0 - O], [x1 + ox1, ridge, (z0 + z1) / 2], [x0 - ox0, ridge, (z0 + z1) / 2]],
         [[x1 + ox1, eave + drop, z1 + O], [x0 - ox0, eave + drop, z1 + O], [x0 - ox0, ridge, (z0 + z1) / 2], [x1 + ox1, ridge, (z0 + z1) / 2]]]
      : [[[x0 - O, eave + drop, z1 + O], [x0 - O, eave + drop, z0 - O], [(x0 + x1) / 2, ridge, z0 - O], [(x0 + x1) / 2, ridge, z1 + O]],
         [[x1 + O, eave + drop, z0 - O], [x1 + O, eave + drop, z1 + O], [(x0 + x1) / 2, ridge, z1 + O], [(x0 + x1) / 2, ridge, z0 - O]]];
    const len = alongX ? x1 - x0 + ox0 + ox1 : z1 - z0 + 2 * O;
    for (const [a, b, c, d] of sides) add(roof, [a, b, c, a, c, d], [0, 0, len, 0, len, slope, 0, 0, len, slope, 0, slope]);
  };
  // centre section (ridge front-to-back)
  quadWall([cx0, Z0], [cx1, Z0], 0, C.eave); quadWall([cx1, Z1], [cx0, Z1], 0, C.eave);
  // (its side walls only where there's no wing: the wings open into it)
  quadWall([cx0, Z1], [cx0, wz1], 0, C.eave); quadWall([cx0, wz0], [cx0, Z0], 0, C.eave);
  quadWall([cx1, Z0], [cx1, wz0], 0, C.eave); quadWall([cx1, wz1], [cx1, Z1], 0, C.eave);
  quadWall([cx0, wz1], [cx0, wz0], Wg.eave, C.eave); quadWall([cx1, wz0], [cx1, wz1], Wg.eave, C.eave);
  gableEnd([cx0, Z0], [cx1, Z0], C.eave, C.ridge); gableEnd([cx1, Z1], [cx0, Z1], C.eave, C.ridge);
  gableRoof(cx0, cx1, Z0, Z1, C.eave, C.ridge, false);
  // wings (ridge side-to-side), each from its outer end to the centre section
  for (const [a, b] of [[X0, cx0], [cx1, X1]]) {
    quadWall([a, wz0], [b, wz0], 0, Wg.eave); quadWall([b, wz1], [a, wz1], 0, Wg.eave);
    // (the end walls wound the same way round as the rest: the west end runs back to front, the east front to back)
    const e = a === X0 ? [[a, wz1], [a, wz0]] : [[b, wz0], [b, wz1]];
    quadWall(e[0], e[1], 0, Wg.eave);
    gableEnd(e[0], e[1], Wg.eave, Wg.ridge);
    gableRoof(a, b, wz0, wz1, Wg.eave, Wg.ridge, true, a === X0 ? O : 0, a === X0 ? 0 : O);
  }
  const mesh = (m, mat) => {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(m.pos, 3));
    if (m.uv.length) g.setAttribute('uv', new THREE.Float32BufferAttribute(m.uv, 2));
    g.computeVertexNormals();
    const o = new THREE.Mesh(g, mat);
    o.castShadow = o.receiveShadow = true;
    return o;
  };
  const group = new THREE.Group();
  // (one-sided, seen from outside only: the walls are wound facing in, so BackSide;
  // inside, the interior's own walls (clubhouse.js) have the windows cut through)
  const wallMat = new THREE.MeshStandardMaterial({ map: T.siding, bumpMap: T.sidingBump, bumpScale: 2.5, roughness: 0.78, side: THREE.BackSide });
  // weathering: dirt splashed up the bottom of the walls, faint streaks down them
  wallMat.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <map_fragment>', `#include <map_fragment>
      {
        float hgt = vMapUv.y, n = fract(sin(dot(floor(vMapUv * vec2(9.0, 3.0)), vec2(12.9898, 78.233))) * 43758.5453);
        diffuseColor.rgb *= mix(vec3(0.72, 0.68, 0.6), vec3(1.0), smoothstep(0.0, 0.55 + 0.25 * n, hgt));
        diffuseColor.rgb *= 1.0 - 0.05 * smoothstep(0.6, 1.0, fract(vMapUv.x * 0.37 + n * 0.3)) * smoothstep(0.5, 3.0, hgt);
      }`);
  };
  group.add(mesh(wall, wallMat));
  const roofMat = new THREE.MeshStandardMaterial({ map: T.roof, bumpMap: T.roofBump, bumpScale: 3, roughness: 0.45, metalness: 0.5, color: 0xd6d6d4, side: THREE.DoubleSide });
  group.add(mesh(roof, roofMat));
  // front of the centre section: the big window up in the gable, glass
  // entrance doors below under a small porch roof
  const glassMat = new THREE.MeshStandardMaterial({ map: T.glass, roughness: 0.05, metalness: 0.35, envMapIntensity: 1.4 });
  const mx = (cx0 + cx1) / 2;
  // (the upstairs viewing area's window, in the gable)
  const win = new THREE.Mesh(new THREE.PlaneGeometry(GABLE_WIN.w, GABLE_WIN.h), glassMat);
  win.position.set(mx, y0 + GABLE_WIN.y, Z0 - 0.03); win.rotation.y = Math.PI;
  const doors = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.5), glassMat);
  doors.position.set(mx, y0 + 1.25, Z0 - 0.03); doors.rotation.y = Math.PI;
  // the main entrance, glass doors in the west end (towards the walkway); and a back door, under the Fastest Drivers board
  const entrance = { z: (wz0 + wz1) / 2, w: 1.8, h: 2.4 }, backDoor = { x: mx, w: 1.8, h: 2.3 };
  const ent = new THREE.Mesh(new THREE.PlaneGeometry(entrance.w, entrance.h), glassMat);
  ent.position.set(X0 - 0.03, y0 + entrance.h / 2, entrance.z); ent.rotation.y = -Math.PI / 2;
  const back = new THREE.Mesh(new THREE.PlaneGeometry(backDoor.w, backDoor.h), glassMat);
  back.position.set(backDoor.x, y0 + backDoor.h / 2, Z1 + 0.03);
  group.add(ent, back);
  const porch = new THREE.Mesh(new THREE.BoxGeometry(4.6, 0.18, 2.0), new THREE.MeshStandardMaterial({ color: 0xd4d6d6, roughness: 0.5, metalness: 0.3 }));
  porch.position.set(mx, y0 + 2.95, Z0 - 1.0);
  const postMat = new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: 0.7 });
  for (const dx of [-2.1, 2.1]) {
    const post = new THREE.Mesh(new THREE.BoxGeometry(0.16, 2.9, 0.16), postMat);
    post.position.set(mx + dx, y0 + 1.45, Z0 - 1.85);
    post.castShadow = true;
    group.add(post);
  }
  // windows along the wings' front walls (towards the track) and back walls (the patio)
  const wins = [];
  for (const [a, b] of [[X0, cx0], [cx1, X1]]) {
    for (let x = a + 2.5; x < b - 1.5; x += 4) {
      for (const [z, ry] of [[wz0 - 0.03, Math.PI], [wz1 + 0.03, 0]]) {
        const w = new THREE.Mesh(new THREE.PlaneGeometry(1.3, 1.3), glassMat);
        w.position.set(x, y0 + 1.6, z); w.rotation.y = ry;
        group.add(w);
      }
      wins.push(x);
    }
  }
  porch.castShadow = true;
  group.add(win, doors, porch);
  group.name = 'clubhouse';
  // for the inside (clubhouse.js): the outline, heights and where the openings are
  group.userData.spec = { X0, X1, Z0, Z1, cx0, cx1, wz0, wz1, y0, C, Wg, O, wins, door: { x: mx, w: 3.2, h: 2.5 }, entrance, backDoor, gable: GABLE_WIN };
  return group;
}

export function buildBuildings(list, wideRect, wideTex, groundAt, special = {}) {
  const [x0, z0, x1, z1] = wideRect;
  const roofUV = (x, z) => [(x - x0) / (x1 - x0), 1 - (z - z0) / (z1 - z0)];
  const KINDS = ['house', 'block', 'metal'];
  const walls = Object.fromEntries(KINDS.map(k => [k, { pos: [], uv: [], col: [] }]));
  const roof = { pos: [], uv: [] }, shingle = { pos: [], uv: [] }, trim = { pos: [], col: [] };
  const wins = [];                         // [x, y, z, yaw] of each window
  const doors = [], acs = [];              // [x, y, z, yaw, colour hash]; [x, y, z, yaw, size] of each air-conditioning unit
  const tint = new THREE.Color();
  // Gulf Coast paint: whites and creams, sand and tan, pale blue-grey and sage, a soft brick
  const PAINTS = [[0.93, 0.92, 0.88], [0.92, 0.87, 0.76], [0.84, 0.76, 0.62], [0.74, 0.79, 0.84], [0.76, 0.80, 0.70],
    [0.80, 0.62, 0.52], [0.68, 0.68, 0.66], [0.90, 0.84, 0.70], [0.70, 0.74, 0.78]];
  const tri = (arr, ...pts) => { for (const p of pts) arr.push(...p); };

  const group = new THREE.Group();
  for (const b of list) {
    let ring = b.ring.slice();
    // the clubhouse is modelled from a photo instead
    if (special.clubhouse) {
      const cxz = ring.reduce((a, p) => [a[0] + p[0] / ring.length, a[1] + p[1] / ring.length], [0, 0]);
      if (Math.hypot(cxz[0] - special.clubhouse[0], cxz[1] - special.clubhouse[1]) < 8) { group.add(clubhouse(ring, groundAt)); continue; }
    }
    if (ring.length > 1 && ring[0][0] === ring[ring.length - 1][0] && ring[0][1] === ring[ring.length - 1][1]) ring.pop();
    if (ring.length < 3) continue;
    // counter-clockwise in x/z seen from above
    let area = 0;
    for (let i = 0; i < ring.length; i++) { const a = ring[i], c = ring[(i + 1) % ring.length]; area += a[0] * c[1] - c[0] * a[1]; }
    if (area > 0) ring.reverse();
    area = Math.abs(area) / 2;
    const kind = area < 250 ? 'house' : area < 1500 ? 'block' : 'metal';
    const y0 = Math.min(...ring.map(([x, z]) => groundAt(x, z)));
    const top = y0 + b.h;
    const hsh = Math.abs(Math.sin(ring[0][0] * 12.99 + ring[0][1] * 78.23) * 43758.5) % 1;
    tint.setRGB(...PAINTS[Math.floor(hsh * PAINTS.length)]);
    if (kind === 'metal') tint.setRGB(0.86, 0.86, 0.84);
    const W = walls[kind];
    const cx = ring.reduce((s, p) => s + p[0], 0) / ring.length, cz = ring.reduce((s, p) => s + p[1], 0) / ring.length;
    const box = obb(ring);
    const pitched = kind === 'house' && area / box.area > 0.85 && ring.length <= 8;
    // walls, textured by distance round the footprint and height
    let run = 0, doorAt = { len: 0, i: -1 };
    for (let i = 0; i < ring.length; i++) {
      const a = ring[i], c = ring[(i + 1) % ring.length];
      const len = Math.hypot(c[0] - a[0], c[1] - a[1]);
      const ua = run / BAY, uc = (run + len) / BAY, vt = b.h / FLOOR;
      run += len;
      tri(W.pos, [a[0], y0, a[1]], [c[0], y0, c[1]], [c[0], top, c[1]], [a[0], y0, a[1]], [c[0], top, c[1]], [a[0], top, a[1]]);
      W.uv.push(ua, 0, uc, 0, uc, vt, ua, 0, uc, vt, ua, vt);
      for (let k = 0; k < 6; k++) W.col.push(tint.r, tint.g, tint.b);
      const ux = (c[0] - a[0]) / (len || 1), uz = (c[1] - a[1]) / (len || 1);
      let nx = uz, nz = -ux;                                     // outward: away from the middle
      if (((a[0] + c[0]) / 2 - cx) * nx + ((a[1] + c[1]) / 2 - cz) * nz < 0) { nx = -nx; nz = -nz; }
      // a darker plinth where the wall meets the ground, and (flat roofs) a coping round the top
      const band = (h0, h1, off, col, cap) => {
        const A = [a[0] + nx * off, a[1] + nz * off], Cc = [c[0] + nx * off, c[1] + nz * off];
        tri(trim.pos, [A[0], h0, A[1]], [Cc[0], h0, Cc[1]], [Cc[0], h1, Cc[1]], [A[0], h0, A[1]], [Cc[0], h1, Cc[1]], [A[0], h1, A[1]]);
        for (let k = 0; k < 6; k++) trim.col.push(...col);
        if (cap) {                                               // its top, back to the wall
          tri(trim.pos, [a[0], h1, a[1]], [Cc[0], h1, Cc[1]], [c[0], h1, c[1]], [a[0], h1, a[1]], [A[0], h1, A[1]], [Cc[0], h1, Cc[1]]);
          for (let k = 0; k < 6; k++) trim.col.push(...col);
        }
      };
      band(y0 - 0.2, y0 + 0.45, 0.03, [tint.r * 0.62, tint.g * 0.6, tint.b * 0.57], true);
      if (!pitched) band(top - 0.32, top + 0.12, 0.09, [tint.r * 1.02, tint.g * 1.02, tint.b * 1.02], true);
      // a window in the middle of each whole bay, on each floor (not on the big sheds)
      if (kind !== 'metal' && len >= BAY) {
        const n = Math.floor(len / BAY), m0 = (len - n * BAY) / 2;
        for (let f = 0; f < Math.max(1, Math.floor(b.h / FLOOR)); f++) {
          for (let k = 0; k < n; k++) {
            const d = m0 + (k + 0.5) * BAY;
            if (f === 0 && len > doorAt.len && k === Math.floor(n / 2)) doorAt = { len, i: wins.length };   // (the middle bay of the longest wall: the door)
            wins.push([a[0] + ux * d, y0 + f * FLOOR + 1.65, a[1] + uz * d, Math.atan2(nx, nz)]);
          }
        }
      }
    }
    // the front door, in place of the ground-floor window in the middle of the longest wall
    if (doorAt.i >= 0) { const [x, y, z, yaw] = wins[doorAt.i]; doors.push([x, y - 1.65, z, yaw, hsh]); wins[doorAt.i] = null; }
    // air conditioning: units on a flat roof, or a condenser on the ground beside a house
    if (!pitched) {
      const units = kind === 'metal' ? 3 : area > 600 ? 2 : 1;
      for (let k = 0; k < units; k++) {
        const t = (k + 1) / (units + 1), along = box.u0 + (box.u1 - box.u0) * t, across = box.v0 + (box.v1 - box.v0) * (0.35 + 0.3 * ((hsh * 7 + k) % 1));
        acs.push([along * box.u[0] + across * box.v[0], top, along * box.u[1] + across * box.v[1], Math.atan2(box.u[0], box.u[1]), 1.4]);
      }
    } else {
      const along = box.u0 + 0.9, across = box.v1 + 0.55;
      acs.push([along * box.u[0] + across * box.v[0], y0, along * box.u[1] + across * box.v[1], Math.atan2(box.u[0], box.u[1]), 0.8]);
    }
    // roof: pitched over small near-rectangular footprints, else flat
    if (pitched) {
      const wv = box.v1 - box.v0, rise = Math.min(2.5, wv * 0.28);
      const P = (u, v, y) => [u * box.u[0] + v * box.v[0], y, u * box.u[1] + v * box.v[1]];
      const vm = (box.v0 + box.v1) / 2, o = 0.35;                       // eaves overhang
      const e00 = P(box.u0 - o, box.v0 - o, top), e10 = P(box.u1 + o, box.v0 - o, top);
      const e01 = P(box.u0 - o, box.v1 + o, top), e11 = P(box.u1 + o, box.v1 + o, top);
      const r0 = P(box.u0 - o, vm, top + rise), r1 = P(box.u1 + o, vm, top + rise);
      // (shingles: u along the ridge, v down the slope, in metres)
      const su = (p) => p[0] * box.u[0] + p[2] * box.u[1], sv = (p) => Math.hypot(p[0] * box.v[0] + p[2] * box.v[1] - vm, top + rise - p[1]);
      for (const t of [[e00, r1, e10], [e00, r0, r1], [e01, e11, r1], [e01, r1, r0]]) {
        tri(shingle.pos, ...t);
        for (const p of t) shingle.uv.push(su(p), sv(p));
      }
      // gable ends, in the wall's finish
      for (const [a, c, r] of [[P(box.u0, box.v0, top), P(box.u0, box.v1, top), P(box.u0, vm, top + rise)],
                               [P(box.u1, box.v1, top), P(box.u1, box.v0, top), P(box.u1, vm, top + rise)]]) {
        tri(W.pos, a, r, c);
        W.uv.push(0, b.h / FLOOR, 0.5, (b.h + rise) / FLOOR, 1, b.h / FLOOR);
        for (let k = 0; k < 3; k++) W.col.push(tint.r, tint.g, tint.b);
      }
    } else {
      const contour = ring.map(p => new THREE.Vector2(p[0], p[1]));
      for (const t of THREE.ShapeUtils.triangulateShape(contour, [])) {
        for (const idx of [t[0], t[2], t[1]]) {
          const p = ring[idx];
          roof.pos.push(p[0], top, p[1]);
          roof.uv.push(...roofUV(p[0], p[1]));
        }
      }
    }
  }

  for (const k of KINDS) {
    const W = walls[k];
    if (!W.pos.length) continue;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(W.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(W.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(W.col, 3));
    g.computeVertexNormals();
    const [map, normalMap] = finishes()[k === 'metal' ? 'metal' : 'plaster'];
    const m = new THREE.Mesh(g, packedNormal(new THREE.MeshStandardMaterial({ map, normalMap, vertexColors: true, roughness: 1, metalness: k === 'metal' ? 0.3 : 0, side: THREE.DoubleSide })));
    m.castShadow = m.receiveShadow = true;
    group.add(m);
  }
  if (shingle.pos.length) {
    const sg = new THREE.BufferGeometry();
    sg.setAttribute('position', new THREE.Float32BufferAttribute(shingle.pos, 3));
    sg.setAttribute('uv', new THREE.Float32BufferAttribute(shingle.uv, 2));
    sg.computeVertexNormals();
    const [map, normalMap] = finishes().shingles;
    const sm = new THREE.Mesh(sg, packedNormal(new THREE.MeshStandardMaterial({ map, normalMap, roughness: 1, side: THREE.DoubleSide })));
    sm.castShadow = sm.receiveShadow = true;
    group.add(sm);
  }
  {
    const tg = new THREE.BufferGeometry();
    tg.setAttribute('position', new THREE.Float32BufferAttribute(trim.pos, 3));
    tg.setAttribute('color', new THREE.Float32BufferAttribute(trim.col, 3));
    tg.computeVertexNormals();
    const tm = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.85, side: THREE.DoubleSide }));
    tm.castShadow = tm.receiveShadow = true;
    group.add(tm);
  }
  // front doors: a white frame and a painted panel, a step up
  if (doors.length) {
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
    const frame = mergeGeometries([new THREE.BoxGeometry(1.15, 0.08, 0.1).translate(0, 2.18, 0.05), new THREE.BoxGeometry(0.08, 2.18, 0.1).translate(-0.535, 1.09, 0.05),
      new THREE.BoxGeometry(0.08, 2.18, 0.1).translate(0.535, 1.09, 0.05), new THREE.BoxGeometry(1.4, 0.15, 0.45).translate(0, 0.075, 0.22)]);
    const panel = new THREE.BoxGeometry(0.97, 2.12, 0.05).translate(0, 1.07, 0.03);
    const frames = new THREE.InstancedMesh(frame, new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: 0.6 }), doors.length);
    const panels = new THREE.InstancedMesh(panel, new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.45 }), doors.length);
    const DOOR = [0x7a2a22, 0x1d2733, 0x2f4a3a, 0xf2f1ec, 0x5a4636, 0x274a6e], col = new THREE.Color();
    doors.forEach(([x, y, z, yaw, h], i) => {
      mtx.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(Y, yaw), one);
      frames.setMatrixAt(i, mtx); panels.setMatrixAt(i, mtx);
      panels.setColorAt(i, col.setHex(DOOR[Math.floor(h * DOOR.length * 7) % DOOR.length]));
    });
    frames.castShadow = panels.castShadow = true; frames.receiveShadow = panels.receiveShadow = true;
    group.add(frames, panels);
  }
  // air conditioning: grey cabinets with a dark fan grille on top
  if (acs.length) {
    const mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), sc = new THREE.Vector3();
    const body = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 0.75, 0.8).translate(0, 0.375, 0), new THREE.MeshStandardMaterial({ color: 0xb9bcbd, roughness: 0.5, metalness: 0.4 }), acs.length);
    const fan = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.3, 0.3, 0.02, 20).translate(0, 0.76, 0), new THREE.MeshStandardMaterial({ color: 0x2a2c2e, roughness: 0.7 }), acs.length);
    acs.forEach(([x, y, z, yaw, s], i) => {
      mtx.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(Y, yaw), sc.setScalar(s));
      body.setMatrixAt(i, mtx); fan.setMatrixAt(i, mtx);
    });
    body.castShadow = body.receiveShadow = true;
    group.add(body, fan);
  }
  // the windows: frames and sills, and glass that mirrors the sky (each pane a little different: blinds, rooms)
  for (let i = wins.length - 1; i >= 0; i--) if (!wins[i]) wins.splice(i, 1);
  if (wins.length) {
    const { frame, glass } = windowParts(), mtx = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), Y = new THREE.Vector3(0, 1, 0);
    const frames = new THREE.InstancedMesh(frame, new THREE.MeshStandardMaterial({ color: 0xf2f1ec, roughness: 0.55 }), wins.length);
    const panes = new THREE.InstancedMesh(glass, new THREE.MeshPhysicalMaterial({ color: 0xffffff, roughness: 0.04, metalness: 0, specularIntensity: 1, envMapIntensity: 1.6 }), wins.length);
    const col = new THREE.Color();
    wins.forEach(([x, y, z, yaw], i) => {
      mtx.compose(new THREE.Vector3(x, y, z), q.setFromAxisAngle(Y, yaw), one);
      frames.setMatrixAt(i, mtx); panes.setMatrixAt(i, mtx);
      const r = Math.abs(Math.sin(x * 12.9 + z * 78.2 + y * 3.1) * 43758.5) % 1;
      panes.setColorAt(i, col.setRGB(0.05 + r * 0.06, 0.06 + r * 0.06, 0.07 + r * 0.05));
    });
    frames.castShadow = true; frames.receiveShadow = true;
    group.add(frames, panes);
  }
  const rg = new THREE.BufferGeometry();
  rg.setAttribute('position', new THREE.Float32BufferAttribute(roof.pos, 3));
  rg.setAttribute('uv', new THREE.Float32BufferAttribute(roof.uv, 2));
  rg.computeVertexNormals();
  const roofs = new THREE.Mesh(rg, new THREE.MeshStandardMaterial({ map: wideTex, roughness: 0.75, side: THREE.DoubleSide }));
  roofs.castShadow = roofs.receiveShadow = true;
  group.add(roofs);
  return group;
}

// ---------------------------------------------------------------- flag stand
// The starter's stand beside the finish line: a raised, roofed platform on
// four posts with a waist-high front and sides, steps up the back, and the
// flags in a holder at the front corner. The flag marshal (flagman.js) stands
// on it, waving the session's flag.
// Built facing the track: local -Z points at `facing` (a world x/z point).
const FLAGS = [['#111111', '#f4f4f4'], ['#1f9e3a'], ['#f2c200'], ['#f4f4f4'], ['#d42a2a'], ['#1f5fd0'], ['#111111']];

function chequer(n = 8) {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d');
  for (let i = 0; i < n; i++) for (let j = 0; j < n; j++) { g.fillStyle = (i + j) % 2 ? '#111' : '#f4f4f4'; g.fillRect(i * 64 / n, j * 64 / n, 64 / n, 64 / n); }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.magFilter = THREE.NearestFilter;
  return t;
}

export function buildFlagStand(at, facing, groundAt) {
  const g = new THREE.Group();
  const white = new THREE.MeshStandardMaterial({ color: 0xeeeeea, roughness: 0.6, metalness: 0.2 });
  const steel = new THREE.MeshStandardMaterial({ color: 0x9aa0a4, roughness: 0.45, metalness: 0.7 });
  const deck = new THREE.MeshStandardMaterial({ color: 0x8a8c88, roughness: 0.85 });
  const roofM = new THREE.MeshStandardMaterial({ color: 0xd8dada, roughness: 0.4, metalness: 0.5 });
  const box = (w, h, d, m, x, y, z) => {
    const o = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
    o.position.set(x, y, z); o.castShadow = o.receiveShadow = true; g.add(o); return o;
  };
  const W = 1.5, D = 1.7, FLOOR = 1.5, RAIL = 1.05, ROOF = 3.7;
  // posts and deck
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) box(0.08, ROOF, 0.08, steel, sx * (W / 2 - 0.04), ROOF / 2, sz * (D / 2 - 0.04));
  box(W, 0.08, D, deck, 0, FLOOR, 0);
  // front and side panels (white), with a chequered band along the front
  box(W, RAIL, 0.04, white, 0, FLOOR + RAIL / 2, -D / 2);
  for (const sx of [-1, 1]) box(0.04, RAIL, D, white, sx * W / 2, FLOOR + RAIL / 2, 0);
  const band = new THREE.Mesh(new THREE.PlaneGeometry(W, 0.18), new THREE.MeshStandardMaterial({ map: chequer(), roughness: 0.6 }));
  band.material.map.repeat.set(4, 0.5); band.material.map.wrapS = band.material.map.wrapT = THREE.RepeatWrapping;
  band.position.set(0, FLOOR + RAIL - 0.12, -D / 2 - 0.025); band.rotation.y = Math.PI; g.add(band);
  // the Gridline Online Karting logo on the front, below the band, and on both sides
  const logo = new THREE.TextureLoader().load('models/hats/cap-logo.png');
  logo.colorSpace = THREE.SRGBColorSpace; logo.anisotropy = 4;
  const logoM = new THREE.MeshStandardMaterial({ map: logo, transparent: true, roughness: 0.6, polygonOffset: true, polygonOffsetFactor: -2 });
  const sign = (w, x, y, z, ry) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w * 271 / 1052), logoM); m.position.set(x, y, z); m.rotation.y = ry; g.add(m); };
  sign(W - 0.16, 0, FLOOR + RAIL * 0.45, -D / 2 - 0.025, Math.PI);
  for (const sx of [-1, 1]) sign(D - 0.3, sx * (W / 2 + 0.025), FLOOR + RAIL * 0.5, 0, sx * Math.PI / 2);
  // back rail, leaving the stair opening
  box(W * 0.45, 0.04, 0.04, steel, -W * 0.27, FLOOR + RAIL, D / 2);
  // roof, sloping slightly to the back
  const roof = box(W + 0.5, 0.06, D + 0.5, roofM, 0, ROOF + 0.05, 0.05);
  roof.rotation.x = -0.06;
  // steps up the back
  const steps = 6, run = 0.26;
  for (let i = 0; i < steps; i++) {
    const y = (FLOOR / steps) * (i + 0.5);
    box(0.62, 0.05, 0.24, deck, W * 0.2, y, D / 2 + (steps - i) * run - 0.05);
  }
  for (const sx of [-1, 1]) {
    const len = Math.hypot(FLOOR, steps * run);
    // rails follow the steps: top at the deck, foot out at the bottom step
    const s = box(0.04, len, 0.05, steel, W * 0.2 + sx * 0.33, FLOOR / 2 + 0.45, D / 2 + steps * run / 2);
    s.rotation.x = -Math.atan2(steps * run, FLOOR);
  }
  // flag holder at the front-left corner, flags rolled
  const hx = -W / 2 + 0.18, hz = -D / 2 + 0.18;
  box(0.12, 0.4, 0.12, steel, hx, FLOOR + 0.2, hz);
  FLAGS.slice(1).forEach(([col], i) => {
    const a = (i / 6) * Math.PI * 2;
    const stick = box(0.015, 0.95, 0.015, steel, hx + Math.cos(a) * 0.035, FLOOR + 0.6, hz + Math.sin(a) * 0.035);
    stick.rotation.z = Math.cos(a) * 0.08; stick.rotation.x = Math.sin(a) * 0.08;
    const roll = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.45, 8), new THREE.MeshStandardMaterial({ color: col, roughness: 0.8 }));
    roll.position.set(stick.position.x, FLOOR + 0.85, stick.position.z); roll.rotation.copy(stick.rotation);
    roll.castShadow = true; g.add(roll);
  });
  // place and face the track
  g.position.set(at[0], groundAt(at[0], at[1]), at[1]);
  g.rotation.y = Math.atan2(-(facing[0] - at[0]), -(facing[1] - at[1]));
  return g;
}

// ---------------------------------------------------------------- cones
// Traffic cones closing the full track off from the short track: orange,
// two reflective white bands, on a black square base.
export function buildCones(list, groundAt) {
  const c = document.createElement('canvas'); c.width = 8; c.height = 128;
  const g = c.getContext('2d');
  g.fillStyle = '#ff5a14'; g.fillRect(0, 0, 8, 128);
  g.fillStyle = '#f2f2ee'; g.fillRect(0, 34, 8, 16); g.fillRect(0, 62, 8, 12);
  const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
  const body = new THREE.CylinderGeometry(0.025, 0.14, 0.44, 16, 1, true);
  body.translate(0, 0.25, 0);
  const tip = new THREE.CircleGeometry(0.025, 12).rotateX(-Math.PI / 2).translate(0, 0.47, 0);
  const base = new THREE.BoxGeometry(0.36, 0.03, 0.36).translate(0, 0.015, 0);
  const coneMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.55, side: THREE.DoubleSide });
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x141414, roughness: 0.8 });
  const g2 = new THREE.Group();
  const meshes = [new THREE.InstancedMesh(body, coneMat, list.length), new THREE.InstancedMesh(tip, coneMat, list.length),
    new THREE.InstancedMesh(base, baseMat, list.length)];
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), p = new THREE.Vector3();
  list.forEach(([x, z], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), (x * 3.7 + z * 1.3) % 6.28);
    m.compose(p.set(x, groundAt(x, z), z), q, s);
    for (const mesh of meshes) mesh.setMatrixAt(i, m);
  });
  for (const mesh of meshes) { mesh.castShadow = mesh.receiveShadow = true; mesh.computeBoundingSphere(); g2.add(mesh); }
  return g2;
}

// ---------------------------------------------------------------- barriers and tyre walls
// Plastic barrier blocks, alternating red and white, standing in a row
// across each opening to the full track. list: [x, z, heading]. The blocks
// are Kenney's Racing Kit barriers (CC0, models/props/), scaled to a real
// 1.15 m x 0.8 m block; plain moulded boxes stand in if they can't load.
async function barrierGeometry(url) {
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  const gltf = await new GLTFLoader().loadAsync(url);
  gltf.scene.updateMatrixWorld(true);
  let geo = null, mat = null;
  gltf.scene.traverse((o) => {
    if (o.isMesh && !geo) { geo = o.geometry.clone().applyMatrix4(o.matrixWorld); mat = o.material; }
  });
  geo.computeBoundingBox();
  const b = geo.boundingBox, c = b.getCenter(new THREE.Vector3()), sz = b.getSize(new THREE.Vector3());
  geo.translate(-c.x, -b.min.y, -c.z);
  geo.scale(1.15 / sz.x, 0.8 / sz.y, 0.45 / sz.z);
  geo.rotateY(Math.PI / 2);                 // its length along the row
  geo.computeVertexNormals();
  return { geo, mat };
}

function boxBarrier() {
  const geo = new THREE.BoxGeometry(0.45, 0.8, 1.15);
  geo.translate(0, 0.4, 0);
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i++) if (p.getY(i) > 0.5) p.setX(i, p.getX(i) * 0.7);
  geo.computeVertexNormals();
  return geo;
}

export async function buildBarriers(list, groundAt) {
  const g = new THREE.Group();
  const kinds = [['models/props/barrierRed.glb', 0xd42a2a], ['models/props/barrierWhite.glb', 0xf2f2ee]];
  for (let pick = 0; pick < 2; pick++) {
    const mine = list.filter((_, i) => i % 2 === pick);
    if (!mine.length) continue;
    let geo, mat;
    // the model's shape with our own paint: its materials come out pale under this lighting
    try { ({ geo } = await barrierGeometry(kinds[pick][0])); mat = new THREE.MeshStandardMaterial({ color: kinds[pick][1], roughness: 0.5 }); }
    catch (e) { console.warn('barrier model:', e); geo = boxBarrier(); mat = new THREE.MeshStandardMaterial({ color: kinds[pick][1], roughness: 0.55 }); }
    const mesh = new THREE.InstancedMesh(geo, mat, mine.length);
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
    mine.forEach(([x, z, h], i) => {
      q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), h);
      m.compose(v.set(x, groundAt(x, z), z), q, s);
      mesh.setMatrixAt(i, m);
    });
    mesh.castShadow = mesh.receiveShadow = true;
    mesh.computeBoundingSphere();
    g.add(mesh);
  }
  return g;
}

// Tyre walls: stacks of three old kart tyres. list: [x, z].
// a car tyre's cross-section, turned round its axle: the bead, the sidewalls
// bulging out to rounded shoulders, a flat tread (16 sides: there are thousands)
export function tyreGeometry() {
  const P = [[0.172, -0.062], [0.19, -0.08], [0.23, -0.087], [0.262, -0.083], [0.281, -0.066], [0.288, -0.035], [0.29, 0], [0.288, 0.035],
    [0.281, 0.066], [0.262, 0.083], [0.23, 0.087], [0.19, 0.08], [0.172, 0.062], [0.166, 0.02], [0.166, -0.02], [0.172, -0.062]];
  return new THREE.LatheGeometry(P.map(([r, y]) => new THREE.Vector2(r, y)), 16);
}

export function buildTyres(list, groundAt) {
  const tyre = tyreGeometry();
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.82 });
  const mesh = new THREE.InstancedMesh(tyre, mat, list.length * 3);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), tilt = new THREE.Quaternion(), s = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3(), col = new THREE.Color();
  const Y = new THREE.Vector3(0, 1, 0), X = new THREE.Vector3(1, 0, 0);
  list.forEach(([x, z], i) => {
    const y = groundAt(x, z);
    for (let k = 0; k < 3; k++) {
      // each tyre sits a little off-centre and not quite flat, as real stacks do; old rubber fades grey-brown
      const h = Math.sin(i * 12.9 + k * 7.1), j = h * 0.03;
      q.setFromAxisAngle(Y, i * 1.7 + k).multiply(tilt.setFromAxisAngle(X, Math.sin(i * 3.7 + k * 1.3) * 0.035));
      m.compose(v.set(x + j, y + 0.087 + k * 0.174, z - j), q, s);
      mesh.setMatrixAt(i * 3 + k, m);
      const f = (Math.abs(Math.sin(i * 5.3 + k * 2.9)) * 0.5 + (k === 2 ? 0.5 : 0)) * 0.035;
      mesh.setColorAt(i * 3 + k, col.setRGB(0.022 + f, 0.021 + f * 0.95, 0.02 + f * 0.85));
    }
  });
  mesh.castShadow = mesh.receiveShadow = true;
  mesh.computeBoundingSphere();
  return mesh;
}

// Guardrail: galvanised W-beam steel on posts every 1.9 m, the rail on the
// car-park side (right of the line's direction, walking from its first point).
// lines: [[x, z], ...] each.
export function buildRailing(lines, groundAt) {
  const g = new THREE.Group();
  const steel = new THREE.MeshStandardMaterial({ color: 0xb4babe, metalness: 0.75, roughness: 0.42 });
  const postMat = new THREE.MeshStandardMaterial({ color: 0x8e9498, metalness: 0.6, roughness: 0.55 });
  // the W profile (0.31 m tall, 0.08 m deep), drawn in the beam's cross-section
  const w = new THREE.Shape();
  const prof = [[0, 0], [0.03, 0.05], [0.0, 0.1], [0.04, 0.155], [0.0, 0.21], [0.03, 0.26], [0, 0.31],
    [0.012, 0.31], [0.042, 0.26], [0.012, 0.21], [0.052, 0.155], [0.012, 0.1], [0.042, 0.05], [0.012, 0]];
  prof.forEach(([x, y], i) => (i ? w.lineTo(x, y) : w.moveTo(x, y)));
  const POST = 1.9, BEAM_Y = 0.45, POST_H = 0.78;
  const postGeo = new THREE.BoxGeometry(0.1, POST_H, 0.15);
  const posts = [];
  for (const line of lines) {
    for (let k = 1; k < line.length; k++) {
      const [ax, az] = line[k - 1], [bx, bz] = line[k];
      const len = Math.hypot(bx - ax, bz - az), n = Math.max(1, Math.round(len / POST));
      const dx = (bx - ax) / len, dz = (bz - az) / len;
      const lx = -dz, lz = dx;                       // the car-park side of the line (south, for these lines)
      const yaw = Math.atan2(dx, dz);
      for (let i = 0; i < n; i++) {
        const t0 = i / n, t1 = (i + 1) / n;
        const x0 = ax + (bx - ax) * t0, z0 = az + (bz - az) * t0, x1 = ax + (bx - ax) * t1, z1 = az + (bz - az) * t1;
        if (i > 0 || k === 1) posts.push([x0, z0, yaw]);
        // one rail panel between two posts, at the ground's height there
        const y0 = groundAt(x0, z0), y1 = groundAt(x1, z1);
        const seg = Math.hypot(x1 - x0, z1 - z0) + 0.06;
        const beam = new THREE.Mesh(new THREE.ExtrudeGeometry(w, { depth: seg, bevelEnabled: false }), steel);
        // profile: x across (toward the car park), y up; extruded along +z
        beam.position.set(x0 + lx * 0.09 - dx * 0.03, (y0 + y1) / 2 + BEAM_Y, z0 + lz * 0.09 - dz * 0.03);
        beam.rotation.set(0, yaw, 0);
        // the shape's +x points to the beam's right, so mirror it to face the car park
        beam.scale.x = -1;
        beam.castShadow = beam.receiveShadow = true;
        g.add(beam);
      }
      if (k === line.length - 1) posts.push([bx, bz, yaw]);
    }
  }
  const pm = new THREE.InstancedMesh(postGeo, postMat, posts.length);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), one = new THREE.Vector3(1, 1, 1), v = new THREE.Vector3();
  posts.forEach(([x, z, yaw], i) => {
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
    m.compose(v.set(x, groundAt(x, z) + POST_H / 2 - 0.04, z), q, one);
    pm.setMatrixAt(i, m);
  });
  pm.castShadow = pm.receiveShadow = true;
  pm.computeBoundingSphere();
  g.add(pm);
  return g;
}

// The clubhouse patio's tables (from the aerial: six on the west side): a
// round black metal-mesh table, four chairs round it and a market umbrella
// over it. One instanced mesh per part, so they cost a few draw calls.
// list: [[x, z], ...]
// where they stand (world m, traced from aerial_detail.jpg)
export const PATIO_TABLES = [[-2.42, 80.2], [3.11, 80.2], [0.54, 82.78], [-5.26, 82.52], [-4.36, 86.52], [5.04, 83.3]];
export function buildPatio(list, groundAt) {
  const group = new THREE.Group();
  group.name = 'patio';
  const metal = new THREE.MeshStandardMaterial({ color: 0x1c1d1f, metalness: 0.6, roughness: 0.45 });
  const canvas = new THREE.MeshStandardMaterial({ color: 0x23443a, roughness: 0.92, side: THREE.DoubleSide });
  const wood = new THREE.MeshStandardMaterial({ color: 0x8a6a4a, roughness: 0.8 });
  const parts = [];
  const add = (geo, mat, place) => parts.push({ geo, mat, place });
  const cyl = (rt, rb, h, seg = 16) => new THREE.CylinderGeometry(rt, rb, h, seg);
  // table: top, centre post, foot
  add(cyl(0.5, 0.5, 0.03, 28).translate(0, 0.74, 0), metal, () => [[0, 0, 0]]);
  add(cyl(0.035, 0.035, 0.72).translate(0, 0.37, 0), metal, () => [[0, 0, 0]]);
  add(cyl(0.28, 0.3, 0.04, 20).translate(0, 0.02, 0), metal, () => [[0, 0, 0]]);
  // umbrella: pole, eight-panel canopy, a finial
  add(cyl(0.02, 0.02, 2.3).translate(0, 1.15, 0), wood, () => [[0, 0, 0]]);
  const cone = new THREE.ConeGeometry(1.25, 0.45, 8, 1, true).translate(0, 2.2, 0);
  add(cone, canvas, () => [[0, 0, 0]]);
  add(new THREE.SphereGeometry(0.04, 8, 6).translate(0, 2.45, 0), wood, () => [[0, 0, 0]]);
  // chairs: seat, back, four legs; four round the table, facing it
  const seat = new THREE.BoxGeometry(0.44, 0.03, 0.42).translate(0, 0.45, 0);
  const back = new THREE.BoxGeometry(0.44, 0.42, 0.03).translate(0, 0.68, 0.2);
  const legs = [];
  for (const [lx, lz] of [[-0.19, -0.18], [0.19, -0.18], [-0.19, 0.19], [0.19, 0.19]]) legs.push(cyl(0.012, 0.012, 0.45, 6).translate(lx, 0.225, lz));
  const chairAt = () => [0, 1, 2, 3].map(k => { const a = k * Math.PI / 2 + 0.35; return [Math.sin(a) * 0.82, Math.cos(a) * 0.82, a]; });
  add(seat, metal, chairAt); add(back, metal, chairAt);
  for (const l of legs) add(l, metal, chairAt);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  for (const part of parts) {
    const per = part.place().length, mesh = new THREE.InstancedMesh(part.geo, part.mat, list.length * per);
    let k = 0;
    list.forEach(([x, z], ti) => {
      const turn = ti * 0.7;
      for (const [ox, oz, a] of part.place()) {
        const c = Math.cos(turn), s = Math.sin(turn), px = x + ox * c + oz * s, pz = z - ox * s + oz * c;
        mesh.setMatrixAt(k++, m.compose(new THREE.Vector3(px, groundAt(px, pz), pz), q.setFromAxisAngle(Y, (a ?? 0) + turn), one));
      }
    });
    mesh.castShadow = true; mesh.receiveShadow = true;
    group.add(mesh);
  }
  return group;
}

// The black metal picket fence round the tables on the clubhouse patio, and along the walkway
// (from the aerial: they're in the corner north-west of the building, closed
// in by the fence on two sides and the building on the others), open at
// the front by the building and at the back where the walkway comes in. Returns { group, segments: [[x0, z0, x1, z1], ...] } for colliders.
// runs of fence (world m): round the tables (open at the front by the
// building), and both sides of the walkway, the full length from the patio
// to the car park
export const FENCE_RUNS = [
  [[6.2, 79.5], [-4.2, 79.5], [-7.0, 82.3], [-7.0, 87.75]],
  [[-7.0, 87.75], [-15.45, 87.75], [-15.45, 106]],
  [[-7.0, 91.45], [-12.55, 91.45], [-12.55, 106]],
];
export function buildPatioFence(groundAt) {
  const segs = [];
  for (const run of FENCE_RUNS) for (let i = 0; i < run.length - 1; i++) {
    const [ax, az] = run[i], [bx, bz] = run[i + 1], n = Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5);
    for (let j = 0; j < n; j++) segs.push([ax + (bx - ax) * j / n, az + (bz - az) * j / n, ax + (bx - ax) * (j + 1) / n, az + (bz - az) * (j + 1) / n]);
  }
  const H = 1.07, metal = new THREE.MeshStandardMaterial({ color: 0x141516, metalness: 0.55, roughness: 0.5 });
  const picket = new THREE.BoxGeometry(0.02, H - 0.05, 0.02).translate(0, (H - 0.05) / 2, 0);
  const post = new THREE.BoxGeometry(0.06, H + 0.08, 0.06).translate(0, (H + 0.08) / 2, 0);
  const rail = new THREE.BoxGeometry(1, 0.035, 0.03);
  let nPick = 0, nPost = 0;
  for (const [ax, az, bx, bz] of segs) { const L = Math.hypot(bx - ax, bz - az); nPick += Math.max(1, Math.round(L / 0.12)); nPost++; }
  const pickets = new THREE.InstancedMesh(picket, metal, nPick), posts = new THREE.InstancedMesh(post, metal, nPost), rails = new THREE.InstancedMesh(rail, metal, segs.length * 2);
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), Y = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
  let ip = 0, iq = 0, ir = 0;
  for (const [ax, az, bx, bz] of segs) {
    const L = Math.hypot(bx - ax, bz - az), yaw = Math.atan2(-(bz - az), bx - ax), n = Math.max(1, Math.round(L / 0.12));
    for (let j = 0; j < n; j++) { const t = (j + 0.5) / n, x = ax + (bx - ax) * t, z = az + (bz - az) * t; pickets.setMatrixAt(ip++, m.compose(new THREE.Vector3(x, groundAt(x, z), z), q.setFromAxisAngle(Y, yaw), one)); }
    posts.setMatrixAt(iq++, m.compose(new THREE.Vector3(ax, groundAt(ax, az), az), q.setFromAxisAngle(Y, yaw), one));
    const mx = (ax + bx) / 2, mz = (az + bz) / 2, g = groundAt(mx, mz);
    for (const h of [0.1, H - 0.08]) rails.setMatrixAt(ir++, m.compose(new THREE.Vector3(mx, g + h, mz), q.setFromAxisAngle(Y, yaw), new THREE.Vector3(L + 0.02, 1, 1)));
  }
  const group = new THREE.Group();
  group.name = 'patio fence';
  for (const im of [pickets, posts, rails]) { im.castShadow = true; im.receiveShadow = true; group.add(im); }
  return { group, segments: segs };
}

// The walkway up to the clubhouse patio from the car park (traced from the
// aerial: an L, a 3.4 m path from the patio's west side, then a 2.6 m one
// south to the car park): poured concrete slabs with tooled joints, a broom
// finish, a little weathering, its edge standing just proud of the grass.
// Rectangles [x0, z0, x1, z1] (world m).
export const WALKWAY = [[-15.3, 87.9, -7.0, 91.3], [-15.3, 91.3, -12.7, 106]];
// the patio: its outline (a rounded rectangle, world m), the same concrete
export const PATIO_SLAB = { x0: -7.19, z0: 79.3, x1: 38.65, z1: 100.43, r: 3.1 };
let concreteMat = null;
function slabMaterial() {
  if (concreteMat) return concreteMat;
  const c = document.createElement('canvas'); c.width = c.height = 512;
  const g = c.getContext('2d');
  g.fillStyle = '#bdbab2'; g.fillRect(0, 0, 512, 512);
  // mottling and the broom finish (fine strokes across the slab)
  for (let i = 0; i < 2600; i++) { const v = 150 + Math.random() * 70; g.fillStyle = `rgba(${v},${v - 3},${v - 9},0.08)`; g.fillRect(Math.random() * 512, Math.random() * 512, 30 + Math.random() * 60, 1); }
  for (let i = 0; i < 40; i++) { const x = Math.random() * 512, y = Math.random() * 512, r = 10 + Math.random() * 40, gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, 'rgba(90,85,75,0.12)'); gr.addColorStop(1, 'rgba(90,85,75,0)'); g.fillStyle = gr; g.fillRect(x - r, y - r, 2 * r, 2 * r); }
  // the joint: one 1.5 m slab per tile, tooled edges
  g.fillStyle = 'rgba(60,58,54,0.85)'; g.fillRect(0, 0, 512, 3); g.fillRect(0, 0, 3, 512);
  g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(0, 3, 512, 2); g.fillRect(3, 0, 2, 512);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; tex.wrapS = tex.wrapT = THREE.RepeatWrapping; tex.anisotropy = 8;
  return (concreteMat = new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0 }));
}
const edgeMat = new THREE.MeshStandardMaterial({ color: 0xa9a59c, roughness: 0.9, side: THREE.DoubleSide });
const SLAB = 1.5, T = 0.025;
// a slab's edge, from a to b, down into the ground
function slabEdge(group, groundAt, ax, az, bx, bz) {
  const n = Math.max(2, Math.ceil(Math.hypot(bx - ax, bz - az) / 0.5)), pos = [];
  for (let i = 0; i < n; i++) {
    const t0 = i / n, t1 = (i + 1) / n, xa = ax + (bx - ax) * t0, za = az + (bz - az) * t0, xb = ax + (bx - ax) * t1, zb = az + (bz - az) * t1;
    const ya = groundAt(xa, za), yb = groundAt(xb, zb);
    pos.push(xa, ya + T, za, xb, yb + T, zb, xb, yb - 0.05, zb, xa, ya + T, za, xb, yb - 0.05, zb, xa, ya - 0.05, za);
  }
  const eg = new THREE.BufferGeometry(); eg.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); eg.computeVertexNormals();
  group.add(new THREE.Mesh(eg, edgeMat));
}
// the patio: one slab over its rounded outline, 2 m bays, following the ground
export function buildPatioSlab(groundAt) {
  const { x0, z0, x1, z1, r } = PATIO_SLAB, pts = [];
  const arc = (cx, cz, a0) => { for (let i = 0; i <= 8; i++) { const a = a0 + i / 8 * Math.PI / 2; pts.push([cx + Math.cos(a) * r, cz + Math.sin(a) * r]); } };
  arc(x1 - r, z1 - r, 0); arc(x0 + r, z1 - r, Math.PI / 2); arc(x0 + r, z0 + r, Math.PI); arc(x1 - r, z0 + r, -Math.PI / 2);
  // a fine grid over it (so it follows the ground), cut to the outline
  const inside = (x, z) => { const cx = Math.min(Math.max(x, x0 + r), x1 - r), cz = Math.min(Math.max(z, z0 + r), z1 - r); return Math.hypot(x - cx, z - cz) <= r + 1e-6; };
  const step = 0.25, pos = [], uv = [];
  const vtx = (x, z) => { pos.push(x, groundAt(x, z) + T, z); uv.push(x / 2, z / 2); };
  for (let x = x0; x < x1 - 1e-6; x += step) for (let z = z0; z < z1 - 1e-6; z += step) {
    const xa = x, xb = Math.min(x + step, x1), za = z, zb = Math.min(z + step, z1);
    if (!inside((xa + xb) / 2, (za + zb) / 2)) continue;
    vtx(xa, za); vtx(xa, zb); vtx(xb, za); vtx(xb, za); vtx(xa, zb); vtx(xb, zb);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  const group = new THREE.Group();
  group.name = 'patio slab';
  const m = new THREE.Mesh(geo, slabMaterial()); m.receiveShadow = true; group.add(m);
  // the rounded edge (the grid's own edge is stepped: the outline's skirt covers it)
  for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; slabEdge(group, groundAt, a[0], a[1], b[0], b[1]); }
  return group;
}
export function buildWalkway(groundAt) {
  const mat = slabMaterial();
  const group = new THREE.Group();
  group.name = 'walkway';
  for (const [x0, z0, x1, z1] of WALKWAY) {
    // a grid that follows the ground, the slab's top a little above it
    const nx = Math.max(2, Math.ceil((x1 - x0) / 0.5)), nz = Math.max(2, Math.ceil((z1 - z0) / 0.5));
    const geo = new THREE.PlaneGeometry(x1 - x0, z1 - z0, nx, nz).rotateX(-Math.PI / 2);
    const p = geo.attributes.position, uv = geo.attributes.uv;
    for (let i = 0; i < p.count; i++) {
      const x = p.getX(i) + (x0 + x1) / 2, z = p.getZ(i) + (z0 + z1) / 2;
      p.setXYZ(i, x, groundAt(x, z) + T, z);
      uv.setXY(i, (x - x0) / SLAB, (z - z0) / SLAB);
    }
    geo.computeVertexNormals();
    const top = new THREE.Mesh(geo, mat);
    top.receiveShadow = true;
    group.add(top);
    // the edges: the slab's sides down into the ground
    for (const [ax, az, bx, bz] of [[x0, z0, x1, z0], [x1, z0, x1, z1], [x1, z1, x0, z1], [x0, z1, x0, z0]]) slabEdge(group, groundAt, ax, az, bx, bz);
  }
  return group;
}
