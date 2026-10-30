// Hats on the driver's helmet: built from simple shapes, around a helmet of
// radius R centred at the origin (-Z forward, +Y up), in the hat's colour
// (some keep their own: a traffic cone is orange). driverModel.js puts the
// result on the helmet, scaled to it. Some are only for certain players:
// 'goldcrown' for admins, the yarmulke for Sidney (by account, never by name).

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';
import { TESTERS } from './shop.js';

export const HATS = {
  none: 'None', cap: 'Gridline cap', beanie: 'Beanie', bucket: 'Bucket hat', beret: 'Beret', fedora: 'Fedora',
  cowboy: 'Cowboy hat', tophat: 'Top hat', sombrero: 'Sombrero', party: 'Party hat', wizard: 'Wizard hat',
  chef: 'Chef hat', grad: 'Graduation cap', crown: 'Crown',
  viking: 'Viking horns', propeller: 'Propeller cap', sharkfin: 'Shark fin', mohawk: 'Mohawk', bunny: 'Bunny ears',
  cat: 'Cat ears', unicorn: 'Unicorn horn', antennae: 'Antennae', headphones: 'Headphones', halo: 'Halo',
  cone: 'Traffic cone', yarmulke: 'Yarmulke', goldcrown: 'Gold crown (admin)',
  fcowboy: 'Gridline cowboy hat (Beta tester)',
};
export const ADMIN_HATS = new Set(['goldcrown']);
// hats only certain accounts may wear: hat -> account ids
export const HAT_OWNERS = {
  yarmulke: new Set(['f7c6b2fb-6d75-4b98-813c-f50dc8f12e11']),     // Sidney
  // the beta testers: every account there was on 25 Oct 2026
  fcowboy: new Set(['4ee0b4a5-512c-4bff-9ca6-5465337d91cf', '61e5ddc1-fca8-4fd4-be03-489fd10855bf',
    '16f4f44f-b8cc-43d3-9ef4-42823ad57f97', 'f7c6b2fb-6d75-4b98-813c-f50dc8f12e11', '0026734c-fbf4-45a1-9ed2-7a3cf27ad84c',
    'dcbbcb26-1cdd-48db-988e-d8fe01c742e9', '0dbd04a0-a615-4ba9-a93c-2deaf741980c', '8c894d35-d15a-44ad-875a-587d0fe6bfc9']),
};
// may this account wear this hat? (a hat that's no longer in the list: no)
export function hatAllowed(hat, uid, admin) {
  if (!HATS[hat]) return false;
  if (uid && TESTERS.has(uid)) return true;
  if (ADMIN_HATS.has(hat)) return !!admin;
  if (HAT_OWNERS[hat]) return !!uid && HAT_OWNERS[hat].has(uid);
  return true;
}

const R = 0.14;                      // the helmet radius the hats are built for (m)
// where a brimmed hat sits: perched on the top of the helmet, its crown's
// opening the size of the helmet there
const SEAT = 0.5 * R, OPEN = 0.9 * R;

const shade = (hex, k) => '#' + new THREE.Color(hex).multiplyScalar(k).getHexString();
const tint = (hex, k) => '#' + new THREE.Color(hex).lerp(new THREE.Color('#ffffff'), k).getHexString();
const lum = (hex) => { const c = new THREE.Color(hex); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };

// ---- surface textures, drawn once: a height field turned into a normal map
// (tiling), or a picture
const TEX = {};
const fract = (x) => x - Math.floor(x);
const hash = (x, y) => fract(Math.sin(x * 127.1 + y * 311.7) * 43758.5453);
// smooth value noise, tiling every `p` cells
function vnoise(x, y, p) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const h = (a, b) => hash(((a % p) + p) % p, ((b % p) + p) % p);
  const sx = xf * xf * (3 - 2 * xf), sy = yf * yf * (3 - 2 * yf);
  const a = h(xi, yi) + (h(xi + 1, yi) - h(xi, yi)) * sx, b = h(xi, yi + 1) + (h(xi + 1, yi + 1) - h(xi, yi + 1)) * sx;
  return a + (b - a) * sy;
}
function normalTex(key, size, height, strength = 2) {
  if (TEX[key]) return TEX[key];
  const H = new Float32Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) H[y * size + x] = height(x / size, y / size);
  const c = document.createElement('canvas'); c.width = c.height = size;
  const g = c.getContext('2d'), img = g.createImageData(size, size);
  const at = (x, y) => H[((y + size) % size) * size + ((x + size) % size)];
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const dx = (at(x + 1, y) - at(x - 1, y)) * strength, dy = (at(x, y + 1) - at(x, y - 1)) * strength;
    const l = Math.hypot(dx, dy, 1), i = (y * size + x) * 4;
    img.data[i] = (-dx / l * 0.5 + 0.5) * 255; img.data[i + 1] = (dy / l * 0.5 + 0.5) * 255; img.data[i + 2] = (1 / l * 0.5 + 0.5) * 255; img.data[i + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.NoColorSpace;
  return (TEX[key] = t);
}
function pictureTex(key, w, h, draw) {
  if (TEX[key]) return TEX[key];
  const c = document.createElement('canvas'); c.width = w; c.height = h;
  draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return (TEX[key] = t);
}
// knitted rib: columns of V stitches
const KNIT = () => normalTex('knit', 128, (x, y) => {
  const cx = fract(x * 8), cy = fract(y * 12 + (cx < 0.5 ? 0 : 0.5));
  const lobe = (c) => Math.exp(-(((cx - c) - (cy - 0.5) * (c < 0.5 ? 0.45 : -0.45)) ** 2) / 0.012 - ((cy - 0.5) ** 2) / 0.09);
  return 0.6 * (lobe(0.27) + lobe(0.73)) + 0.15 * Math.cos(cx * Math.PI * 2) + 0.05 * vnoise(x * 32, y * 32, 32);
}, 3);
// felt: soft, fine and uneven
const FELT = () => normalTex('felt', 128, (x, y) => vnoise(x * 16, y * 16, 16) * 0.6 + vnoise(x * 48, y * 48, 48) * 0.4, 1.2);
// woven cotton: threads over and under
const WEAVE = () => normalTex('weave', 128, (x, y) => {
  const u = x * 32, v = y * 32, over = (Math.floor(u) + Math.floor(v)) % 2;
  return (over ? Math.sin(fract(v) * Math.PI) : Math.sin(fract(u) * Math.PI)) * 0.5 + 0.1 * vnoise(x * 64, y * 64, 64);
}, 2.2);
// grosgrain ribbon: fine ribs across it
const RIBBON = () => normalTex('ribbon', 64, (x, y) => Math.sin(y * 64 * Math.PI) * 0.5 + 0.1 * vnoise(x * 16, y * 16, 16), 2);
// beaten metal
const HAMMERED = () => normalTex('hammered', 128, (x, y) => {
  let best = 9;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    const cx = Math.floor(x * 10) + i, cy = Math.floor(y * 10) + j;
    const px = cx + hash(((cx % 10) + 10) % 10, ((cy % 10) + 10) % 10), py = cy + hash(((cy % 10) + 10) % 10 + 5, ((cx % 10) + 10) % 10 + 3);
    best = Math.min(best, Math.hypot(x * 10 - px, y * 10 - py));
  }
  return -best * best * 0.6;
}, 1.6);
// fur and fluff
const FUZZ = () => normalTex('fuzz', 128, (x, y) => vnoise(x * 64, y * 64, 64) * 0.7 + vnoise(x * 24, y * 24, 24) * 0.3, 3);
// plastic, a little scuffed
const SCUFF = () => normalTex('scuff', 128, (x, y) => vnoise(x * 8, y * 8, 8) * 0.3 + Math.max(0, vnoise(x * 40, y * 4, 40) - 0.75) * 0.6, 1.5);

// materials: cloth (with sheen, so it catches the light like fabric), metal, plastic
function cloth(colour, normal, { repeat = [8, 4], rough = 0.9, sheen = 0.35, bump = 0.7, map = null } = {}) {
  const m = new THREE.MeshPhysicalMaterial({ color: colour, roughness: rough, sheen, sheenRoughness: 0.6, sheenColor: tint(colour, 0.2), side: THREE.DoubleSide });
  if (normal) { m.normalMap = normal.clone(); m.normalMap.repeat.set(...repeat); m.normalScale.set(bump, bump); }
  if (map) m.map = map;
  return m;
}
const metal = (colour, rough = 0.28, normal = null) => {
  const m = new THREE.MeshPhysicalMaterial({ color: colour, metalness: 1, roughness: rough, clearcoat: 0.3, clearcoatRoughness: 0.2 });
  if (normal) { m.normalMap = normal.clone(); m.normalMap.repeat.set(3, 3); m.normalScale.set(0.35, 0.35); }
  return m;
};
const plastic = (colour, rough = 0.45) => new THREE.MeshPhysicalMaterial({ color: colour, roughness: rough, clearcoat: 0.4, clearcoatRoughness: 0.3 });
const gem = (colour) => new THREE.MeshPhysicalMaterial({ color: colour, roughness: 0.05, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0, sheen: 0.3, sheenColor: tint(colour, 0.6), emissive: colour, emissiveIntensity: 0.12 });

// ---- shapes
// a solid of revolution from a profile [[radius, height], ...] (smoothed
// through the points unless sharp), seam at the back
function lathe(points, material, { seg = 64, n = 40, sharp = false } = {}) {
  const pts = sharp ? points.map(([r, y]) => new THREE.Vector2(Math.max(r, 1e-4), y))
    : new THREE.SplineCurve(points.map(([r, y]) => new THREE.Vector2(r, y))).getPoints(n).map(p => new THREE.Vector2(Math.max(p.x, 1e-4), p.y));
  return new THREE.Mesh(new THREE.LatheGeometry(pts, seg), material);
}
// move every point of a mesh's geometry (fn(v: Vector3) changes v), then
// light it again, the seam's two edges together
function deform(mesh, fn) {
  const g = mesh.geometry, p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i); fn(v); p.setXYZ(i, v.x, v.y, v.z); }
  p.needsUpdate = true;
  smoothNormals(g);
  return mesh;
}
// normals averaged over points in the same place (closes lathe seams)
function smoothNormals(g) {
  g.computeVertexNormals();
  const p = g.attributes.position, n = g.attributes.normal, by = new Map();
  for (let i = 0; i < p.count; i++) {
    const k = `${Math.round(p.getX(i) * 1e5)},${Math.round(p.getY(i) * 1e5)},${Math.round(p.getZ(i) * 1e5)}`;
    (by.get(k) || by.set(k, []).get(k)).push(i);
  }
  const s = new THREE.Vector3();
  for (const ids of by.values()) {
    if (ids.length < 2) continue;
    s.set(0, 0, 0);
    for (const i of ids) s.x += n.getX(i), s.y += n.getY(i), s.z += n.getZ(i);
    s.normalize();
    for (const i of ids) n.setXYZ(i, s.x, s.y, s.z);
  }
  n.needsUpdate = true;
}
// a tube along a curve, its radius r(t, around) (t 0..1 along), coloured
// along its length by col(t) if given
function tube(curve, r, material, { segs = 48, radial = 18, col = null, capStart = true } = {}) {
  const frames = curve.computeFrenetFrames(segs, false), pos = [], colours = [], idx = [];
  const P = new THREE.Vector3(), c = new THREE.Color();
  for (let i = 0; i <= segs; i++) {
    const t = i / segs;
    curve.getPointAt(t, P);
    const N = frames.normals[i], B = frames.binormals[i];
    if (col) c.set(col(t));
    for (let j = 0; j <= radial; j++) {
      const a = j / radial * Math.PI * 2, rr = r(t, a);
      pos.push(P.x + (N.x * Math.cos(a) + B.x * Math.sin(a)) * rr, P.y + (N.y * Math.cos(a) + B.y * Math.sin(a)) * rr, P.z + (N.z * Math.cos(a) + B.z * Math.sin(a)) * rr);
      if (col) colours.push(c.r, c.g, c.b);
    }
  }
  for (let i = 0; i < segs; i++) for (let j = 0; j < radial; j++) {
    const a = i * (radial + 1) + j, b = a + radial + 1;
    idx.push(a, b, a + 1, b, b + 1, a + 1);
  }
  if (capStart) {
    curve.getPointAt(0, P);
    const ci = pos.length / 3;
    pos.push(P.x, P.y, P.z);
    if (col) { c.set(col(0)); colours.push(c.r, c.g, c.b); }
    for (let j = 0; j < radial; j++) idx.push(ci, j + 1, j);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (col) g.setAttribute('color', new THREE.Float32BufferAttribute(colours, 3));
  g.setIndex(idx);
  smoothNormals(g);
  return new THREE.Mesh(g, material);
}
// an ear (or fin-like flap): L long, W wide at its widest (width(u) along
// it), the front cupped by `cup`, the back rounded out by `thick`; the inner
// part of the front in `inner`. fold: { at (0..1), angle } bends the top over.
function ear(L, W, width, cup, thick, outer, inner, fold = null) {
  const nu = 28, nv = 14, pos = [], cols = [], idx = [];
  const co = new THREE.Color(outer), ci = new THREE.Color(inner), c = new THREE.Color();
  const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
  for (const back of [0, 1]) {
    for (let i = 0; i <= nu; i++) {
      const u = i / nu, w = W * width(u), s = Math.pow(Math.sin(Math.PI * Math.min(u, 0.999)), 0.5);
      for (let j = 0; j <= nv; j++) {
        const v = -1 + 2 * j / nv;
        let x = v * w, y = u * L, z = back ? (cup + thick) * Math.sqrt(Math.max(0, 1 - v * v)) * s : cup * (1 - v * v) * s;
        if (fold && u > fold.at) {
          const d = y - fold.at * L, a = fold.angle * Math.min(1, d / (L * 0.3));
          [y, z] = [fold.at * L + d * Math.cos(a) + z * Math.sin(a), z * Math.cos(a) - d * Math.sin(a)];
        }
        pos.push(x, y, z);
        const k = back ? 0 : sm(0.8, 0.45, Math.abs(v)) * sm(0.04, 0.2, u) * sm(0.97, 0.8, u);
        c.copy(co).lerp(ci, k);
        cols.push(c.r, c.g, c.b);
      }
    }
  }
  const off = (nu + 1) * (nv + 1);
  for (let i = 0; i < nu; i++) for (let j = 0; j < nv; j++) {
    const a = i * (nv + 1) + j, b = a + nv + 1;
    idx.push(a, a + 1, b, b, a + 1, b + 1);                      // front (faces -Z)
    idx.push(off + a, off + b, off + a + 1, off + b, off + b + 1, off + a + 1);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  const m = new THREE.MeshPhysicalMaterial({ color: '#ffffff', vertexColors: true, roughness: 0.85, sheen: 1, sheenRoughness: 0.4, sheenColor: tint(outer, 0.5), side: THREE.DoubleSide });
  m.normalMap = FUZZ().clone(); m.normalMap.repeat.set(2, 4); m.normalScale.set(0.4, 0.4);
  return new THREE.Mesh(g, m);
}
// a headband over the top of the helmet, from ear to ear (for ears, antennae)
function headband(m, y = 0.0, w = 0.16) {
  const b = new THREE.Mesh(new THREE.TorusGeometry(R * 1.035, R * 0.035, 10, 64, Math.PI), m);
  b.scale.z = w / 0.07; b.position.y = y;
  return b;
}
// a fluffy ball (a pom-pom)
function pompom(colour, r) {
  const g = new THREE.IcosahedronGeometry(r, 5), p = g.attributes.position, v = new THREE.Vector3();
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i);
    const n = v.clone().normalize();
    const k = 0.82 + 0.3 * hash(Math.round(n.x * 40), Math.round(n.y * 40 + n.z * 17));
    v.copy(n).multiplyScalar(r * k); p.setXYZ(i, v.x, v.y, v.z);
  }
  smoothNormals(g);
  const m = new THREE.MeshPhysicalMaterial({ color: colour, roughness: 1, sheen: 1, sheenRoughness: 0.3, sheenColor: tint(colour, 0.6) });
  m.normalMap = FUZZ().clone(); m.normalMap.repeat.set(4, 4); m.normalScale.set(1.2, 1.2);
  return new THREE.Mesh(g, m);
}
// a brim: a ring from `inner` to `outer` radius with a rolled edge, `thick`
// thick, then shaped by lift(x, z, k) (k: 0 at the crown .. 1 at the edge)
function brimMesh(m, inner, outer, y, thick, lift = () => 0, seg = 96) {
  const t = thick / 2, e = outer - inner;
  const prof = [[inner, y + t], [inner + e * 0.5, y + t], [outer - t * 1.5, y + t * 0.8], [outer, y], [outer - t * 1.5, y - t * 0.8], [inner + e * 0.5, y - t], [inner, y - t]];
  return deform(lathe(prof, m, { seg, n: 48 }), (v) => {
    const r = Math.hypot(v.x, v.z), k = Math.max(0, (r - inner) / e);
    v.y += lift(v.x / (r || 1), v.z / (r || 1), k);
  });
}
const cyl = (m, rTop, rBot, h, y, seg = 48) => { const c = new THREE.Mesh(new THREE.CylinderGeometry(rTop, rBot, h, seg), m); c.position.y = y; return c; };
const ball = (m, r, x, y, z) => { const b = new THREE.Mesh(new THREE.SphereGeometry(r, 24, 16), m); b.position.set(x, y, z); return b; };
// a band round a crown: a short, slightly proud lathe from y0 to y1 at radius r(y)
function band(m, r0, r1, y0, y1, proud = 0.006) {
  return lathe([[r0 + proud, y0], [r0 + proud * 1.3, y0 + (y1 - y0) * 0.1], [r1 + proud * 1.3, y1 - (y1 - y0) * 0.1], [r1 + proud, y1]], m, { sharp: true });
}

// ---- the Gridline cap: a real cap model (models/hats/cap.glb, made by
// tools/cap2glb.py), its fabric tinted the hat's colour, with the Gridline
// Online Karting logo printed on the front of the crown (a decal, so it keeps
// its own colours on any cap)
// how the cap sits on a helmet of radius R: size, height, forward, tipped back (rad)
export const CAP = { scale: 1.3, y: 0.09, z: -0.015, tilt: 0.08 };
let capModel = null;
const capLoad = () => (capModel ||= new GLTFLoader().loadAsync('models/hats/cap.glb').then(g => g.scene));
let capLogo = null;
const logoTex = () => {
  if (!capLogo) { capLogo = new THREE.TextureLoader().load('models/hats/cap-logo.png'); capLogo.colorSpace = THREE.SRGBColorSpace; capLogo.anisotropy = 4; }
  return capLogo;
};
function gridlineCap(g, colour) {
  capLoad().then((src) => {
    const cap = src.clone(true);
    cap.rotation.set(CAP.tilt, Math.PI, 0);            // its peak to the front (-Z), tipped back a little
    cap.scale.setScalar(CAP.scale);
    cap.position.set(0, CAP.y, CAP.z);
    let crown = null;
    cap.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      if (o.material?.name === 'fabric') { o.material = o.material.clone(); o.material.color.set(colour); }
      if (o.name === 'mainCap' || o.parent?.name === 'mainCap') crown = o;
    });
    // (built in a group of its own, off any driver, so the logo's placed in the
    // cap's own space; the hat may be on a head already by the time it loads)
    const own = new THREE.Group();
    own.add(cap);
    own.updateMatrixWorld(true);
    g.add(own);
    // the logo: projected onto the front of the crown, where a ray from the front meets it
    if (!crown) return;
    const box = new THREE.Box3().setFromObject(crown), mid = box.min.y + (box.max.y - box.min.y) * 0.42;
    const ray = new THREE.Raycaster(new THREE.Vector3(0, mid + R * 0.36, -R * 3), new THREE.Vector3(0, -0.12, 1).normalize());
    const hit = ray.intersectObject(crown, false)[0];
    if (!hit) return;
    const n = hit.face.normal.clone().transformDirection(crown.matrixWorld);
    const look = new THREE.Object3D(); look.position.copy(hit.point); look.lookAt(hit.point.clone().add(n));
    const w = R * 0.95 * CAP.scale / 1.75;
    const geo = new DecalGeometry(crown, hit.point, look.rotation, new THREE.Vector3(w, w * 271 / 1052, R));
    const decal = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: logoTex(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.8 }));
    own.add(decal);
  }).catch((e) => console.warn('cap model', e));
}

// ---- the Gridline cowboy hat (beta testers'): a real hat model
// (models/hats/cowboy.glb, made by tools/cowboy2glb.py), its felt tinted the
// hat's colour, the band and skulls their own, the logo on the front of the crown
// how it sits on a helmet of radius R: brim width (x R), bottom of the hat, forward, tipped back (rad)
export const COWBOY = { width: 2.6, y: 0.62, z: 0, tilt: 0, logoAt: 0.52, logoW: 0.8 };
let cowboyModel = null;
const cowboyLoad = () => (cowboyModel ||= new GLTFLoader().loadAsync('models/hats/cowboy.glb').then(g => g.scene));
function gridlineCowboy(g, colour) {
  cowboyLoad().then((src) => {
    const hat = src.clone(true);
    // centred over the head, bottom at 0, brim COWBOY.width x R across
    const b = new THREE.Box3().setFromObject(src), size = b.getSize(new THREE.Vector3()), mid = b.getCenter(new THREE.Vector3());
    const k = COWBOY.width * R / size.x;
    hat.position.set(-mid.x, -b.min.y, -mid.z);
    const pivot = new THREE.Group();
    pivot.add(hat);
    pivot.scale.setScalar(k);
    pivot.rotation.set(COWBOY.tilt, 0, 0);
    pivot.position.set(0, COWBOY.y * R, COWBOY.z * R);
    let crown = null;
    hat.traverse((o) => {
      if (!o.isMesh) return;
      o.castShadow = true;
      if (o.material?.name === 'felt') { o.material = o.material.clone(); o.material.color.set(colour); }
      if (/^HAT/i.test(o.name) || /^HAT/i.test(o.parent?.name ?? '')) crown = o;
    });
    const own = new THREE.Group();
    own.add(pivot);
    own.updateMatrixWorld(true);
    g.add(own);
    if (!crown) return;
    // the logo, where a ray from the front meets the crown, above the band
    const box = new THREE.Box3().setFromObject(crown);
    const y = box.min.y + (box.max.y - box.min.y) * COWBOY.logoAt;
    const ray = new THREE.Raycaster(new THREE.Vector3(0, y, -R * 4), new THREE.Vector3(0, 0, 1));
    const hit = ray.intersectObject(crown, false).find(h => h.point.y > box.min.y + (box.max.y - box.min.y) * 0.3);
    if (!hit) return;
    const n = hit.face.normal.clone().transformDirection(crown.matrixWorld);
    const look = new THREE.Object3D(); look.position.copy(hit.point); look.lookAt(hit.point.clone().add(n));
    const w = R * COWBOY.logoW;
    const geo = new DecalGeometry(crown, hit.point, look.rotation, new THREE.Vector3(w, w * 271 / 1052, R * 0.5));
    own.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ map: logoTex(), transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -4, roughness: 0.8 })));
  }).catch((e) => console.warn('cowboy model', e));
}

// once a hat's model and logo have loaded (the ones built from shapes are ready at once)
export function hatReady(id) {
  const tex = () => new Promise((res) => { const t = logoTex(); if (t.image) res(); else { const i = setInterval(() => { if (t.image) { clearInterval(i); res(); } }, 30); } });
  if (id === 'cap') return Promise.all([capLoad(), tex()]).catch(() => {});
  if (id === 'fcowboy') return Promise.all([cowboyLoad(), tex()]).catch(() => {});
  return Promise.resolve();
}

// colour: the hat's main colour; accent: a second colour (helmet secondary)
export function buildHat(id, colour = '#d42a2a', accent = '#f4f4f4') {
  const g = new THREE.Group();
  const add = (...o) => { g.add(...o); return o[0]; };
  switch (id) {
    case 'cap': gridlineCap(g, colour); break;
    case 'fcowboy': gridlineCowboy(g, colour); break;

    // a ribbed knit beanie, its cuff turned up, a pom-pom on top
    case 'beanie': {
      const knit = cloth(colour, KNIT(), { repeat: [16, 5], bump: 0.9 });
      add(lathe([[R * 1.05, R * 0.48], [R * 1.05, R * 0.68], [R * 0.97, R * 0.94], [R * 0.76, R * 1.14], [R * 0.42, R * 1.27], [0, R * 1.31]], knit));
      add(lathe([[R * 1.0, R * 0.27], [R * 1.07, R * 0.29], [R * 1.09, R * 0.41], [R * 1.08, R * 0.54], [R * 1.04, R * 0.57]], cloth(colour, KNIT(), { repeat: [18, 1.3], bump: 1 })));
      add(pompom(accent, R * 0.27)).position.set(0, R * 1.45, 0);
      break;
    }
    // cotton canvas bucket hat: rows of stitching round the brim, two eyelets a side
    case 'bucket': {
      const cot = cloth(colour, WEAVE(), { repeat: [24, 6], bump: 0.5 });
      // (rows of stitching round the brim: dents in the cloth, a shade darker)
      const stitches = pictureTex('stitch', 512, 128, (c, w, h) => {
        c.fillStyle = '#ffffff'; c.fillRect(0, 0, w, h); c.fillStyle = 'rgba(0,0,0,0.28)';
        for (let r = 0; r < 7; r++) for (let x = 0; x < w; x += 8) c.fillRect(x, Math.round(h * (0.08 + r * 0.115)), 5, 2);
      });
      const stitched = cloth(colour, normalTex('bucketBrim', 256, (x, y) => {
        const line = [0, 1, 2, 3, 4, 5, 6].some(r => Math.abs(y - (0.08 + r * 0.115)) < 0.008) && fract(x * 64) < 0.6 ? -0.6 : 0;
        return line + 0.2 * Math.sin(fract(x * 96) * Math.PI) * Math.sin(fract(y * 48) * Math.PI);
      }, 2), { repeat: [1, 1], bump: 0.8, map: (() => { const t = stitches.clone(); t.repeat.set(8, 1); return t; })() });
      add(lathe([[OPEN, SEAT], [R * 0.86, R * 0.68], [R * 0.79, R * 0.9], [R * 0.74, R * 0.98], [R * 0.6, R * 1.02], [R * 0.3, R * 1.035], [0, R * 1.035]], cot));
      add(brimMesh(stitched, OPEN, R * 1.55, SEAT, R * 0.04, (x, z, k) => -k * R * 0.28 - k * k * R * 0.05));
      const ring = metal('#b9bcc0', 0.3);
      for (const sd of [-1, 1]) for (const dz of [-0.18, 0.18]) {
        const e = new THREE.Mesh(new THREE.TorusGeometry(R * 0.05, R * 0.012, 8, 20), ring);
        const a = Math.PI / 2 * sd + dz, y = R * 0.8, r = R * 0.815;
        e.position.set(Math.sin(a) * r, y, Math.cos(a) * r); e.lookAt(e.position.clone().multiplyScalar(2).setY(y)); add(e);
      }
      break;
    }
    // a wool beret, worn to one side, a leather band and a little stalk on top
    case 'beret': {
      const wool = cloth(colour, FELT(), { repeat: [6, 3], bump: 0.6 });
      const b = new THREE.Group();
      b.add(lathe([[R * 0.86, R * 0.02], [R * 1.05, R * 0.08], [R * 1.28, R * 0.2], [R * 1.34, R * 0.3], [R * 1.22, R * 0.42], [R * 0.85, R * 0.5], [R * 0.3, R * 0.53], [0, R * 0.53]], wool));
      const lea = new THREE.Mesh(new THREE.TorusGeometry(R * 0.865, R * 0.035, 10, 64), new THREE.MeshPhysicalMaterial({ color: '#2a1d16', roughness: 0.45, clearcoat: 0.3 }));
      lea.rotation.x = Math.PI / 2; lea.scale.z = 1.4; b.add(lea);
      b.add(cyl(wool, R * 0.02, R * 0.035, R * 0.12, R * 0.58, 12));
      b.position.set(R * 0.12, R * 0.62, R * 0.04); b.rotation.set(0.12, 0, -0.26);
      add(b);
      break;
    }
    // a felt fedora: pinched front, a crease down the crown, the brim snapped
    // down at the front and up at the back, a grosgrain band with a bow
    case 'fedora':
    case 'cowboy':
    case 'tophat': {
      const cow = id === 'cowboy', top = id === 'tophat';
      const felt = top ? new THREE.MeshPhysicalMaterial({ color: colour, roughness: 0.32, sheen: 1, sheenRoughness: 0.25, sheenColor: tint(colour, 0.5), clearcoat: 0.35, clearcoatRoughness: 0.35, side: THREE.DoubleSide })
        : cloth(colour, FELT(), { repeat: [6, 3], bump: 0.5, rough: 0.85 });
      const H = top ? R * 1.5 : cow ? R * 0.95 : R * 0.72;          // crown height above the seat
      const prof = top
        ? [[OPEN * 0.95, SEAT], [R * 0.82, SEAT + H * 0.3], [R * 0.86, SEAT + H * 0.75], [R * 0.9, SEAT + H * 0.985], [R * 0.86, SEAT + H], [R * 0.4, SEAT + H], [0, SEAT + H]]
        : [[OPEN * 0.96, SEAT], [R * 0.85, SEAT + H * 0.45], [R * 0.79, SEAT + H * 0.82], [R * 0.66, SEAT + H * 0.98], [R * 0.35, SEAT + H * 1.02], [0, SEAT + H]];
      const crown = add(lathe(prof, felt, { sharp: top }));
      if (!top) {
        deform(crown, (v) => {
          const h = Math.max(0, (v.y - SEAT) / H);
          // the crease down the middle, front to back
          v.y -= R * (cow ? 0.26 : 0.2) * Math.exp(-(v.x * v.x) / (R * R * 0.09)) * Math.pow(h, 3);
          // pinched in at the front (both sides), more towards the top
          if (v.z < 0) v.x *= 1 - (cow ? 0.12 : 0.18) * Math.pow(h, 1.5) * Math.min(1, -v.z / (R * 0.6));
          // a cattleman's two side dents
          if (cow) v.x *= 1 - 0.07 * Math.exp(-((v.z + R * 0.1) ** 2) / (R * R * 0.12)) * h;
          v.z *= 1.08;
        });
      }
      // the brim
      const W = top ? R * 1.38 : cow ? R * 1.95 : R * 1.6;
      const lift = top ? (x, z, k) => R * 0.16 * k * k * x * x - R * 0.04 * k * z * z
        : cow ? (x, z, k) => R * 0.62 * k * k * x * x - R * 0.06 * k * z * z - R * 0.04 * k
          : (x, z, k) => (z < 0 ? -R * 0.16 * k * k * z * z : R * 0.13 * k * k * z * z) + R * 0.05 * k * x * x;
      const brim = add(brimMesh(felt, OPEN * 0.95, W, SEAT, R * 0.035, lift));
      brim.scale.z = cow ? 1.12 : 1.06; if (!top) crown.scale.z = 1;
      // the band
      const bandM = cow ? new THREE.MeshPhysicalMaterial({ color: '#3b2416', roughness: 0.5, clearcoat: 0.4, normalMap: FELT(), normalScale: new THREE.Vector2(0.3, 0.3) })
        : cloth(top ? accent : shade(colour, 0.3), RIBBON(), { repeat: [1, 1], rough: 0.6, sheen: 0.4 });
      const bh = top ? R * 0.26 : R * 0.2;
      const bd = add(band(bandM, OPEN * 0.955, R * 0.86, SEAT + R * 0.015, SEAT + bh, R * 0.008));
      bd.scale.z = cow ? 1.08 : 1.07;
      if (top) bd.scale.z = 1;
      if (!top && !cow) {
        // the bow, on the left side
        const bow = new THREE.Group();
        for (const sd of [-1, 1]) {
          const l = new THREE.Mesh(new THREE.SphereGeometry(R * 0.09, 16, 10), bandM);
          l.scale.set(0.35, 0.75, 1.1); l.position.set(0, 0, sd * R * 0.08); bow.add(l);
        }
        bow.add(new THREE.Mesh(new THREE.SphereGeometry(R * 0.04, 12, 8), bandM));
        bow.position.set(-R * 0.9, SEAT + bh * 0.55, R * 0.05); add(bow);
      }
      if (cow) {
        // a silver concho on the band at the front left
        const c = new THREE.Mesh(new THREE.CylinderGeometry(R * 0.075, R * 0.075, R * 0.025, 24), metal('#d8dade', 0.22, HAMMERED()));
        c.rotation.x = Math.PI / 2; c.position.set(-R * 0.38, SEAT + bh * 0.5, -R * 0.86); c.lookAt(c.position.clone().multiplyScalar(2)); c.rotateX(Math.PI / 2); add(c);
      }
      g.rotation.x = top ? 0.06 : 0.1;                               // worn a little back
      break;
    }
    // a woven straw sombrero: wide upturned brim, a coloured woven band
    case 'sombrero': {
      const straw = pictureTex('straw', 256, 256, (c, w, h) => {
        c.fillStyle = '#e6d7a8'; c.fillRect(0, 0, w, h);
        for (let y = 0; y < h; y += 8) for (let x = 0; x < w; x += 16) {
          const o = ((y / 8) % 2) * 8;
          const gr = c.createLinearGradient(x + o, 0, x + o + 16, 0);
          gr.addColorStop(0, '#b7a170'); gr.addColorStop(0.5, '#f1e4bb'); gr.addColorStop(1, '#b7a170');
          c.fillStyle = gr; c.fillRect(x + o, y + 1, 15, 6);
        }
      });
      const tinted = '#' + new THREE.Color('#f0e2b6').lerp(new THREE.Color(colour), 0.45).getHexString();
      const st = cloth(tinted, normalTex('strawN', 128, (x, y) => { const o = Math.floor(y * 32) % 2 ? 0.5 : 0; return Math.sin(fract(x * 16 + o) * Math.PI) * 0.6 + Math.sin(fract(y * 32) * Math.PI) * 0.4; }, 2.5),
        { repeat: [20, 6], bump: 0.6, rough: 0.8, sheen: 0.3, map: (() => { const t = straw.clone(); t.repeat.set(20, 6); return t; })() });
      add(lathe([[OPEN, SEAT], [R * 0.84, SEAT + R * 0.3], [R * 0.68, SEAT + R * 0.85], [R * 0.42, SEAT + R * 1.22], [R * 0.16, SEAT + R * 1.36], [0, SEAT + R * 1.38]], st));
      const brim = lathe([[OPEN, SEAT + R * 0.02], [R * 1.5, SEAT - R * 0.04], [R * 2.0, SEAT + R * 0.02], [R * 2.4, SEAT + R * 0.22], [R * 2.62, SEAT + R * 0.48], [R * 2.66, SEAT + R * 0.56],
        [R * 2.6, SEAT + R * 0.52], [R * 2.36, SEAT + R * 0.18], [R * 1.98, SEAT - R * 0.01], [R * 1.5, SEAT - R * 0.07], [OPEN, SEAT - R * 0.02]], st, { seg: 96, n: 60 });
      add(brim);
      const pattern = pictureTex(`zig:${accent}`, 256, 32, (c, w, h) => {
        c.fillStyle = '#1a1a1a'; c.fillRect(0, 0, w, h);
        const cs = [accent, '#d42a2a', '#1f8a4c', '#f2c200'];
        for (let i = 0; i < 16; i++) {
          c.fillStyle = cs[i % 4]; c.beginPath();
          c.moveTo(i * 16, h - 4); c.lineTo(i * 16 + 8, 4); c.lineTo(i * 16 + 16, h - 4); c.closePath(); c.fill();
        }
        c.fillStyle = '#f4f4f4'; c.fillRect(0, 0, w, 3); c.fillRect(0, h - 3, w, 3);
      });
      const bm = new THREE.MeshPhysicalMaterial({ map: (() => { const t = pattern.clone(); t.repeat.set(6, 1); return t; })(), roughness: 0.8, sheen: 0.6, sheenColor: '#ffffff' });
      add(band(bm, OPEN, R * 0.83, SEAT + R * 0.02, SEAT + R * 0.3, R * 0.012));
      // little woven balls round the rim
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * Math.PI * 2;
        add(pompom(['#d42a2a', accent, '#1f8a4c', '#f2c200'][i % 4], R * 0.06)).position.set(Math.sin(a) * R * 2.64, SEAT + R * 0.5, Math.cos(a) * R * 2.64);
      }
      g.rotation.x = 0.08;
      break;
    }
    // a paper party hat: stripes and dots, a ruffled foil trim, a foil tuft on top
    case 'party': {
      const p = pictureTex(`party:${colour}:${accent}`, 256, 256, (c, w, h) => {
        c.fillStyle = colour; c.fillRect(0, 0, w, h);
        c.fillStyle = accent;
        for (let i = -4; i < 8; i++) { c.beginPath(); c.moveTo(i * 64, h); c.lineTo(i * 64 + 32, h); c.lineTo(i * 64 + 32 + 128, 0); c.lineTo(i * 64 + 128, 0); c.closePath(); c.fill(); }
        c.fillStyle = '#f2c200';
        for (let i = 0; i < 26; i++) { c.beginPath(); c.arc(hash(i, 3) * w, hash(i, 7) * h, 5, 0, Math.PI * 2); c.fill(); }
      });
      const paper = new THREE.MeshPhysicalMaterial({ map: (() => { const t = p.clone(); t.repeat.set(3, 1.5); return t; })(), roughness: 0.55, clearcoat: 0.5, clearcoatRoughness: 0.2, side: THREE.DoubleSide });
      const foil = new THREE.MeshPhysicalMaterial({ color: '#f2c200', metalness: 1, roughness: 0.22, side: THREE.DoubleSide });
      const hat = new THREE.Group(), rb = R * 0.56, H = R * 1.5;
      hat.add(lathe([[rb, 0], [R * 0.015, H]], paper, { sharp: true }));
      // the trim: a crinkled foil ruffle round the bottom edge
      const trim = deform(new THREE.Mesh(new THREE.TorusGeometry(rb, R * 0.05, 8, 96), foil), (v) => {
        const a = Math.atan2(v.y, v.x), r = Math.hypot(v.x, v.y), k = 1 + 0.25 * Math.sin(a * 36) * Math.max(0, (r - rb) / (R * 0.05));
        v.x = Math.cos(a) * (rb + (r - rb) * k); v.y = Math.sin(a) * (rb + (r - rb) * k); v.z *= 1 + 0.4 * Math.cos(a * 36);
      });
      trim.rotation.x = Math.PI / 2; trim.position.y = R * 0.02; hat.add(trim);
      // the tuft: curled foil strips
      for (let i = 0; i < 22; i++) {
        const a = i / 22 * Math.PI * 2 + hash(i, 5), up = 0.35 + hash(i, 2) * 0.9, len = R * (0.2 + hash(i, 1) * 0.12);
        const c = new THREE.QuadraticBezierCurve3(new THREE.Vector3(0, H - R * 0.02, 0),
          new THREE.Vector3(Math.cos(a) * len * 0.5 * Math.sin(up), H + len * 0.7 * Math.cos(up) + R * 0.04, Math.sin(a) * len * 0.5 * Math.sin(up)),
          new THREE.Vector3(Math.cos(a) * len * Math.sin(up) * 1.1, H + len * Math.cos(up) * 0.6 - R * 0.02, Math.sin(a) * len * Math.sin(up) * 1.1));
        const t = tube(c, () => R * 0.012, foil, { segs: 10, radial: 4 }); t.scale.z = 1; hat.add(t);
      }
      hat.position.set(R * 0.1, R * 0.88, R * 0.05); hat.rotation.z = -0.16;
      add(hat);
      break;
    }
    // a wizard's hat: a tall cone that flops over at the tip, a floppy brim,
    // gold stars and moons
    case 'wizard': {
      const sky = pictureTex(`wiz:${colour}`, 256, 256, (c, w, h) => {
        c.fillStyle = colour; c.fillRect(0, 0, w, h);
        const star = (x, y, r) => { c.beginPath(); for (let i = 0; i < 10; i++) { const a = i / 10 * Math.PI * 2 - Math.PI / 2, rr = i % 2 ? r * 0.42 : r; c.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); } c.closePath(); c.fill(); };
        c.fillStyle = '#ffd84a';
        for (let i = 0; i < 9; i++) star(hash(i, 5) * w, hash(i, 9) * h, 8 + hash(i, 4) * 8);
        for (let i = 0; i < 3; i++) { const x = hash(i, 13) * w, y = hash(i, 17) * h; c.beginPath(); c.arc(x, y, 12, 0, Math.PI * 2); c.fill(); c.fillStyle = colour; c.beginPath(); c.arc(x + 6, y - 3, 11, 0, Math.PI * 2); c.fill(); c.fillStyle = '#ffd84a'; }
      });
      const cloak = cloth(colour, FELT(), { repeat: [4, 4], bump: 0.4, map: (() => { const t = sky.clone(); t.repeat.set(3, 2); return t; })() });
      const H = R * 2.1;
      const cone = add(lathe([[OPEN, SEAT], [R * 0.78, SEAT + H * 0.25], [R * 0.5, SEAT + H * 0.55], [R * 0.22, SEAT + H * 0.85], [R * 0.02, SEAT + H]], cloak, { n: 60 }));
      deform(cone, (v) => { const h = Math.max(0, (v.y - SEAT) / H - 0.45) / 0.55; v.z += R * 0.75 * h * h; v.y -= R * 0.35 * h * h * h; });
      add(brimMesh(cloak, OPEN, R * 1.6, SEAT, R * 0.03, (x, z, k) => R * 0.06 * k * Math.sin(Math.atan2(x, z) * 5) - R * 0.12 * k * k));
      add(band(cloth('#2a1d3a', RIBBON(), { rough: 0.6 }), OPEN, R * 0.82, SEAT + R * 0.01, SEAT + R * 0.18, R * 0.008));
      const buckle = new THREE.Mesh(new THREE.TorusGeometry(R * 0.08, R * 0.018, 6, 4), metal('#e2b33c', 0.25));
      buckle.position.set(0, SEAT + R * 0.1, -R * 0.89); buckle.rotation.z = Math.PI / 4; buckle.scale.set(1, 0.8, 1); add(buckle);
      break;
    }
    // a chef's toque: a pleated white band and a puffed-up top
    case 'chef': {
      const white = cloth('#fbfbf8', WEAVE(), { repeat: [30, 6], bump: 0.35, rough: 0.92, sheen: 0.4 });
      add(deform(lathe([[R * 0.98, R * 0.3], [R * 0.98, R * 0.62], [R * 1.0, R * 0.95], [R * 1.08, R * 1.15]], white, { seg: 96 }), (v) => {
        if (v.y < R * 0.62) return;
        const a = Math.atan2(v.x, v.z), k = 1 + 0.035 * Math.abs(Math.sin(a * 12)) * Math.min(1, (v.y - R * 0.62) / (R * 0.2));
        v.x *= k; v.z *= k;
      }));
      add(deform(lathe([[R * 1.08, R * 1.12], [R * 1.25, R * 1.25], [R * 1.28, R * 1.4], [R * 1.12, R * 1.58], [R * 0.6, R * 1.7], [0, R * 1.72]], white, { seg: 96 }), (v) => {
        const a = Math.atan2(v.x, v.z), k = 1 + 0.07 * Math.cos(a * 8) * Math.sin(Math.min(1, (v.y - R * 1.1) / (R * 0.5)) * Math.PI);
        v.x *= k; v.z *= k;
      }));
      add(lathe([[R * 0.985, R * 0.3], [R * 0.995, R * 0.3], [R * 0.995, R * 0.48], [R * 0.985, R * 0.48]], cloth('#f1f1ee', RIBBON(), { rough: 0.7 }), { sharp: true }));
      break;
    }
    // a mortarboard: a fitted cap under a square board, a button and a gold tassel
    case 'grad': {
      const blk = cloth(colour, WEAVE(), { repeat: [10, 10], bump: 0.4, rough: 0.8 });
      add(lathe([[R * 1.04, R * 0.38], [R * 1.04, R * 0.62], [R * 0.93, R * 0.88], [R * 0.66, R * 1.0], [0, R * 1.02]], blk));
      const s = new THREE.Shape(), a = R * 1.05, cr = R * 0.04;
      s.moveTo(-a + cr, -a); s.lineTo(a - cr, -a); s.quadraticCurveTo(a, -a, a, -a + cr); s.lineTo(a, a - cr); s.quadraticCurveTo(a, a, a - cr, a);
      s.lineTo(-a + cr, a); s.quadraticCurveTo(-a, a, -a, a - cr); s.lineTo(-a, -a + cr); s.quadraticCurveTo(-a, -a, -a + cr, -a);
      const board = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: R * 0.03, bevelEnabled: true, bevelThickness: R * 0.008, bevelSize: R * 0.008, bevelSegments: 2 }), blk);
      board.rotation.x = -Math.PI / 2; board.position.y = R * 1.01; add(board);
      const gold = cloth('#e8c33a', RIBBON(), { rough: 0.5, sheen: 1, repeat: [1, 6] });
      add(cyl(blk, R * 0.07, R * 0.08, R * 0.035, R * 1.07, 20));
      const cord = new THREE.CatmullRomCurve3([new THREE.Vector3(0, R * 1.08, 0), new THREE.Vector3(R * 0.55, R * 1.075, -R * 0.38), new THREE.Vector3(R * 1.03, R * 1.06, -R * 0.68), new THREE.Vector3(R * 1.09, R * 0.88, -R * 0.74), new THREE.Vector3(R * 1.1, R * 0.62, -R * 0.74)]);
      add(tube(cord, () => R * 0.014, gold, { segs: 40, radial: 8 }));
      const tas = new THREE.Group();
      for (let i = 0; i < 26; i++) {
        const t = cyl(gold, R * 0.008, R * 0.008, R * 0.36, 0, 5); const a2 = i / 26 * Math.PI * 2, rr = R * 0.04 * hash(i, 2);
        t.position.set(Math.cos(a2) * rr, -R * 0.18, Math.sin(a2) * rr); t.rotation.set(Math.sin(a2) * 0.06, 0, Math.cos(a2) * 0.06); tas.add(t);
      }
      tas.add(cyl(gold, R * 0.045, R * 0.06, R * 0.08, 0, 16));
      tas.position.set(R * 1.1, R * 0.6, -R * 0.74); add(tas);
      break;
    }
    // a crown: a jewelled band with pearl-tipped points round a velvet cap
    // (the admins' gold crown has arches, an orb and cross, and an ermine trim)
    case 'crown':
    case 'goldcrown': {
      const gold = id === 'goldcrown';
      const m = metal(gold ? '#e8b84a' : colour, 0.22, HAMMERED());
      const velvet = cloth('#6e0c1a', FELT(), { repeat: [4, 4], sheen: 0.8, rough: 0.95 });
      const y0 = R * 0.55, r0 = R * 0.86, hb = R * 0.3;
      if (!gold) {
        // one piece of metal: a band rising into eight rounded points, flaring out a little
        const P = R * 0.42, ring = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 1, 192, 12, true), m.clone());
        ring.material.side = THREE.DoubleSide;                                 // (seen from inside, across the head)
        deform(ring, (v) => {
          const a = Math.atan2(v.x, v.z), k = v.y + 0.5;                       // 0 at the bottom .. 1 at the top
          const f = fract(a * 8 / (Math.PI * 2) + 0.5), tri = 1 - Math.abs(f - 0.5) * 2;
          const peak = tri > 0.85 ? 0.85 + 0.15 * Math.sin((tri - 0.85) / 0.15 * Math.PI / 2) : tri;
          const y = y0 + k * (hb + P * peak), r = r0 + R * 0.035 + (y - y0) * 0.12;
          v.set(Math.sin(a) * r, y, Math.cos(a) * r);
        });
        add(ring);
        add(lathe([[r0 * 0.95, y0 + hb * 0.4], [R * 0.84, y0 + hb + R * 0.12], [R * 0.5, y0 + hb + R * 0.28], [0, y0 + hb + R * 0.31]], velvet));
        const pearl = new THREE.MeshPhysicalMaterial({ color: '#f6f1e4', roughness: 0.2, sheen: 1, sheenColor: '#ffffff', clearcoat: 1, iridescence: 0.6 });
        for (let i = 0; i < 8; i++) {
          const a = i / 8 * Math.PI * 2, y = y0 + hb + P, r = r0 + R * 0.035 + (hb + P) * 0.12;
          add(ball(pearl, R * 0.05, Math.sin(a) * r, y + R * 0.03, Math.cos(a) * r));
          const a2 = a + Math.PI / 8, r2 = r0 + R * 0.05;
          const s2 = ball(gem(i % 2 ? '#1d4ed8' : '#c1121f'), R * 0.06, Math.sin(a2) * r2, y0 + hb * 0.55, Math.cos(a2) * r2);
          s2.scale.set(0.85, 1.1, 0.5); s2.lookAt(0, s2.position.y, 0); add(s2);
          const st = new THREE.Mesh(new THREE.TorusGeometry(R * 0.065, R * 0.012, 6, 20), m);
          st.position.copy(s2.position); st.lookAt(0, s2.position.y, 0); st.scale.set(0.85, 1.1, 1); add(st);
          // a small gem low in each point
          add(ball(gem('#0f8a4a'), R * 0.03, Math.sin(a) * (r0 + R * 0.06), y0 + hb + P * 0.3, Math.cos(a) * (r0 + R * 0.06)));
        }
        for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2, rr = r0 + R * 0.045; add(ball(m, R * 0.02, Math.sin(a) * rr, y0 + R * 0.015, Math.cos(a) * rr)); }
        g.rotation.x = 0.05;
        break;
      }
      add(lathe([[r0, y0], [r0 + R * 0.03, y0 + R * 0.01], [r0 + R * 0.04, y0 + hb * 0.5], [r0 * 0.97 + R * 0.03, y0 + hb - R * 0.01], [r0 * 0.97, y0 + hb]], m, { sharp: true }));
      add(lathe([[r0 * 0.96, y0 + hb * 0.7], [R * 0.82, y0 + hb + R * 0.16], [R * 0.45, y0 + hb + R * 0.34], [0, y0 + hb + R * 0.38]], velvet));
      const pearl = new THREE.MeshPhysicalMaterial({ color: '#f6f1e4', roughness: 0.2, sheen: 1, sheenColor: '#ffffff', clearcoat: 1, iridescence: 0.6 });
      // beads along the top and bottom edges
      for (const [yy, rr] of [[y0 + R * 0.01, r0 + R * 0.035], [y0 + hb - R * 0.005, r0 * 0.97 + R * 0.03]]) {
        for (let i = 0; i < 40; i++) { const a = i / 40 * Math.PI * 2; add(ball(m, R * 0.022, Math.sin(a) * rr, yy, Math.cos(a) * rr)); }
      }
      const gems = gold ? ['#c1121f', '#1d4ed8', '#0f8a4a', '#c1121f', '#1d4ed8', '#0f8a4a', '#c1121f', '#1d4ed8'] : ['#c1121f', '#1d4ed8', '#c1121f', '#1d4ed8', '#c1121f', '#1d4ed8', '#c1121f', '#1d4ed8'];
      for (let i = 0; i < 8; i++) {
        const a = (i + 0.5) / 8 * Math.PI * 2, rr = r0 + R * 0.05;
        const s = ball(gem(gems[i]), R * 0.065, Math.sin(a) * rr, y0 + hb * 0.5, Math.cos(a) * rr);
        s.scale.set(i % 2 ? 1 : 0.8, i % 2 ? 0.8 : 1.15, 0.5); s.lookAt(0, s.position.y, 0); add(s);
        const set = new THREE.Mesh(new THREE.TorusGeometry(R * 0.07, R * 0.012, 6, 20), m);
        set.position.copy(s.position); set.lookAt(0, s.position.y, 0); set.scale.set(i % 2 ? 1 : 0.8, i % 2 ? 0.8 : 1.15, 1); add(set);
      }
      // the points: a cross-pattée (or fleur) tall one and a short pearl one, in turn
      const fleur = new THREE.Shape();
      fleur.moveTo(-R * 0.16, 0); fleur.quadraticCurveTo(-R * 0.1, R * 0.12, -R * 0.13, R * 0.22); fleur.quadraticCurveTo(-R * 0.06, R * 0.2, -R * 0.04, R * 0.26);
      fleur.quadraticCurveTo(-R * 0.1, R * 0.36, 0, R * 0.46); fleur.quadraticCurveTo(R * 0.1, R * 0.36, R * 0.04, R * 0.26); fleur.quadraticCurveTo(R * 0.06, R * 0.2, R * 0.13, R * 0.22);
      fleur.quadraticCurveTo(R * 0.1, R * 0.12, R * 0.16, 0); fleur.lineTo(-R * 0.16, 0);
      const fg = new THREE.ExtrudeGeometry(fleur, { depth: R * 0.025, bevelEnabled: true, bevelThickness: R * 0.008, bevelSize: R * 0.008, bevelSegments: 2, curveSegments: 10 });
      fg.translate(0, 0, -R * 0.0125); fg.scale(1.15, 1.35, 1);
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * Math.PI * 2, rr = r0 * 0.97 + R * 0.02;
        if (i % 2 === 0) {
          const f = new THREE.Mesh(fg, m); f.position.set(Math.sin(a) * rr, y0 + hb - R * 0.02, Math.cos(a) * rr); f.rotation.y = a; f.rotateX(-0.12); add(f);
          add(ball(pearl, R * 0.035, Math.sin(a) * (rr - R * 0.08), y0 + hb + R * 0.6, Math.cos(a) * (rr - R * 0.08)));
        } else {
          const st = cyl(m, R * 0.014, R * 0.035, R * 0.3, 0, 10); st.position.set(Math.sin(a) * rr, y0 + hb + R * 0.13, Math.cos(a) * rr); st.rotation.set(Math.cos(a) * -0.12, 0, Math.sin(a) * 0.12); add(st);
          add(ball(pearl, R * 0.05, Math.sin(a) * (rr - R * 0.035), y0 + hb + R * 0.3, Math.cos(a) * (rr - R * 0.035)));
        }
      }
      if (gold) {
        // two arches over the top, an orb and a cross where they meet
        for (const rot of [0, Math.PI / 2]) {
          const arch = new THREE.Mesh(new THREE.TorusGeometry(R * 0.8, R * 0.035, 10, 48, Math.PI), m);
          arch.scale.set(1, 0.72, 1); arch.position.y = y0 + hb + R * 0.08; arch.rotation.y = rot; add(arch);
          for (let i = 1; i < 10; i++) { const t = i / 10 * Math.PI; add(ball(pearl, R * 0.022, Math.cos(t) * R * 0.8 * Math.cos(rot), y0 + hb + R * 0.08 + Math.sin(t) * R * 0.8 * 0.72 + R * 0.035, -Math.cos(t) * R * 0.8 * Math.sin(rot))); }
        }
        const top = y0 + hb + R * 0.08 + R * 0.8 * 0.72;
        add(ball(m, R * 0.1, 0, top + R * 0.08, 0));
        const crossBar = new THREE.Mesh(new THREE.BoxGeometry(R * 0.04, R * 0.22, R * 0.04), m); crossBar.position.y = top + R * 0.27; add(crossBar);
        const crossArm = new THREE.Mesh(new THREE.BoxGeometry(R * 0.15, R * 0.04, R * 0.04), m); crossArm.position.y = top + R * 0.3; add(crossArm);
        // ermine: white fur with black tails round the bottom
        const ermine = pictureTex('ermine', 256, 64, (c, w, h) => {
          c.fillStyle = '#f7f5ef'; c.fillRect(0, 0, w, h); c.fillStyle = '#111';
          for (let i = 0; i < 8; i++) { const x = i * 32 + 16; c.beginPath(); c.moveTo(x, 18); c.lineTo(x - 5, 46); c.lineTo(x, 40); c.lineTo(x + 5, 46); c.closePath(); c.fill(); c.fillRect(x - 2, 14, 4, 8); }
        });
        const em = cloth('#ffffff', FUZZ(), { repeat: [12, 1], bump: 0.8, rough: 1, sheen: 1, map: (() => { const t = ermine.clone(); t.repeat.set(3, 1); return t; })() });
        add(lathe([[r0 - R * 0.01, y0 - R * 0.09], [r0 + R * 0.08, y0 - R * 0.07], [r0 + R * 0.1, y0 + R * 0.0], [r0 + R * 0.07, y0 + R * 0.06], [r0, y0 + R * 0.07]], em));
      }
      g.rotation.x = 0.05;
      break;
    }
    // a Norse helmet: beaten steel, riveted bands, curling horns
    case 'viking': {
      const steel = metal('#9ba1a6', 0.38, HAMMERED());
      add(lathe([[R * 1.08, R * 0.2], [R * 1.09, R * 0.45], [R * 1.0, R * 0.82], [R * 0.72, R * 1.1], [R * 0.3, R * 1.24], [0, R * 1.27]], steel));
      const bandM = metal('#6d6259', 0.45, HAMMERED());
      add(lathe([[R * 1.1, R * 0.18], [R * 1.125, R * 0.2], [R * 1.13, R * 0.34], [R * 1.11, R * 0.36]], bandM, { sharp: true }));
      for (const rot of [0, Math.PI / 2]) {
        const s = new THREE.Mesh(new THREE.TorusGeometry(R * 1.1, R * 0.03, 6, 48, Math.PI), bandM);
        s.scale.set(1, 1.07, 2.2); s.rotation.y = rot; s.position.y = R * 0.16; s.scale.y = 1.0; add(s);
      }
      const riv = metal('#c9ccd0', 0.3);
      for (let i = 0; i < 16; i++) { const a = i / 16 * Math.PI * 2; add(ball(riv, R * 0.02, Math.sin(a) * R * 1.135, R * 0.27, Math.cos(a) * R * 1.135)); }
      for (const sd of [-1, 1]) {
        const curve = new THREE.CatmullRomCurve3([new THREE.Vector3(sd * R * 0.95, R * 0.62, 0), new THREE.Vector3(sd * R * 1.35, R * 0.78, -R * 0.05),
          new THREE.Vector3(sd * R * 1.62, R * 1.15, -R * 0.2), new THREE.Vector3(sd * R * 1.62, R * 1.55, -R * 0.42), new THREE.Vector3(sd * R * 1.45, R * 1.8, -R * 0.55)]);
        const ivory = new THREE.Color('#efe6cf'), tip = new THREE.Color('#5a4630'), cc = new THREE.Color();
        add(tube(curve, (t) => R * (0.21 * Math.pow(1 - t, 0.85) + 0.012) * (1 + 0.035 * Math.sin(t * 60)), new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.5, clearcoat: 0.3 }),
          { col: (t) => cc.copy(ivory).lerp(tip, Math.pow(Math.max(0, t - 0.55) / 0.45, 1.5)).getStyle(), segs: 60 }));
        add(lathe([[R * 0.24, -R * 0.04], [R * 0.25, 0], [R * 0.25, R * 0.06], [R * 0.23, R * 0.08]], bandM, { sharp: true, seg: 24 })).position.set(sd * R * 1.02, R * 0.64, 0);
        g.children[g.children.length - 1].rotation.z = -sd * 1.2;
      }
      break;
    }
    // a propeller beanie: six panels in turn, a button, and a three-bladed propeller that spins
    case 'propeller': {
      const panels = pictureTex(`prop:${colour}:${accent}`, 256, 16, (c, w, h) => {
        for (let i = 0; i < 6; i++) { c.fillStyle = i % 2 ? accent : colour; c.fillRect(i * w / 6, 0, w / 6, h); }
        c.fillStyle = 'rgba(0,0,0,0.35)'; for (let i = 0; i < 6; i++) c.fillRect(i * w / 6 - 1, 0, 2, h);
      });
      add(lathe([[R * 1.07, R * 0.28], [R * 1.07, R * 0.5], [R * 0.96, R * 0.85], [R * 0.68, R * 1.1], [R * 0.3, R * 1.22], [0, R * 1.24]], cloth('#ffffff', WEAVE(), { repeat: [18, 6], bump: 0.4, map: panels })));
      add(lathe([[R * 1.075, R * 0.25], [R * 1.1, R * 0.27], [R * 1.1, R * 0.34], [R * 1.075, R * 0.36]], cloth(accent, RIBBON(), { rough: 0.7 }), { sharp: true }));
      add(ball(plastic(accent), R * 0.07, 0, R * 1.25, 0));
      add(cyl(metal('#c8cacc', 0.3), R * 0.016, R * 0.016, R * 0.3, R * 1.4, 10));
      const prop = new THREE.Group(); prop.name = 'spin';      // (driverModel.js spins it)
      prop.add(ball(plastic('#f2c200'), R * 0.06, 0, 0, 0));
      const bl = new THREE.Shape();
      bl.moveTo(0, -R * 0.05); bl.quadraticCurveTo(R * 0.4, -R * 0.12, R * 0.78, -R * 0.07); bl.quadraticCurveTo(R * 0.86, 0, R * 0.78, R * 0.07); bl.quadraticCurveTo(R * 0.4, R * 0.1, 0, R * 0.05);
      ['#d42a2a', '#1f5fd0', '#f2c200'].forEach((c2, i) => {
        const geo = new THREE.ExtrudeGeometry(bl, { depth: R * 0.012, bevelEnabled: true, bevelThickness: R * 0.004, bevelSize: R * 0.004, bevelSegments: 1, curveSegments: 12 });
        geo.rotateX(-Math.PI / 2);
        const p = geo.attributes.position;
        for (let k = 0; k < p.count; k++) { const x = p.getX(k), tw = 0.5 * (1 - x / (R * 0.86)), y = p.getY(k), z = p.getZ(k); p.setY(k, y * Math.cos(tw) - z * Math.sin(tw)); p.setZ(k, y * Math.sin(tw) + z * Math.cos(tw)); }
        geo.computeVertexNormals();
        const b = new THREE.Mesh(geo, plastic(c2, 0.35)); b.rotation.y = i / 3 * Math.PI * 2; prop.add(b);
      });
      prop.position.y = R * 1.56; add(prop);
      break;
    }
    // a shark's dorsal fin, smooth and tapering, darker on top
    case 'sharkfin': {
      const s = new THREE.Shape();
      s.moveTo(-R * 0.75, 0); s.bezierCurveTo(-R * 0.35, R * 0.15, R * 0.05, R * 0.6, R * 0.45, R * 1.05);
      s.quadraticCurveTo(R * 0.52, R * 1.1, R * 0.5, R * 1.0); s.bezierCurveTo(R * 0.3, R * 0.7, R * 0.3, R * 0.35, R * 0.7, 0); s.lineTo(-R * 0.75, 0);
      const geo = new THREE.ExtrudeGeometry(s, { depth: R * 0.05, bevelEnabled: true, bevelThickness: R * 0.05, bevelSize: R * 0.04, bevelSegments: 6, curveSegments: 24 });
      geo.translate(0, 0, -R * 0.025);
      const p = geo.attributes.position, cols = [], dark = new THREE.Color(shade(colour, 0.6)), light = new THREE.Color(tint(colour, 0.2)), c = new THREE.Color();
      for (let i = 0; i < p.count; i++) {
        const h = Math.max(0, p.getY(i)) / R;
        p.setZ(i, p.getZ(i) * (1 - 0.65 * Math.min(1, h)));               // thinner towards the tip
        c.copy(light).lerp(dark, Math.min(1, h * 0.9)); cols.push(c.r, c.g, c.b);
      }
      geo.setAttribute('color', new THREE.Float32BufferAttribute(cols, 3));
      geo.computeVertexNormals();
      const f = new THREE.Mesh(geo, new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.42, clearcoat: 0.6, clearcoatRoughness: 0.3, normalMap: SCUFF(), normalScale: new THREE.Vector2(0.2, 0.2) }));
      f.rotation.y = Math.PI / 2; f.position.set(0, R * 0.9, R * 0.05);
      // the fin's root follows the helmet's curve
      deform(f, (v) => { v.y -= R * 0.45 * (v.x / R) ** 2; });
      add(f);
      break;
    }
    // a mohawk: clumped spikes of hair, dark at the roots
    case 'mohawk': {
      const root = new THREE.Color(shade(colour, 0.35)), tipC = new THREE.Color(tint(colour, 0.25)), cc = new THREE.Color();
      const hair = new THREE.MeshPhysicalMaterial({ vertexColors: true, roughness: 0.55, sheen: 1, sheenRoughness: 0.35, sheenColor: tint(colour, 0.5) });
      const N = 10;
      for (let i = 0; i < N; i++) {
        const a = -0.55 + i * (2.0 / (N - 1)), len = R * (0.5 + 0.25 * Math.sin((i / (N - 1)) * Math.PI));
        const base = new THREE.Vector3(0, Math.cos(a) * R * 1.0, Math.sin(a) * R * 1.0), out = base.clone().normalize();
        for (let k = 0; k < 9; k++) {
          const off = new THREE.Vector3((hash(i, k) - 0.5) * R * 0.18, 0, (hash(k, i) - 0.5) * R * 0.14);
          const tipP = base.clone().addScaledVector(out, len).add(new THREE.Vector3((hash(i + 3, k) - 0.5) * R * 0.05, 0, R * 0.08));
          const curve = new THREE.QuadraticBezierCurve3(base.clone().add(off), base.clone().add(off.multiplyScalar(0.5)).addScaledVector(out, len * 0.5), tipP);
          add(tube(curve, (t) => R * 0.06 * (1 - t) + R * 0.003, hair, { segs: 10, radial: 6, col: (t) => cc.copy(root).lerp(tipC, t).getStyle() }));
        }
      }
      break;
    }
    // bunny ears on a headband, one flopped over
    case 'bunny': {
      add(headband(cloth(colour, FUZZ(), { repeat: [8, 1], bump: 0.6 }), R * 0.02));
      for (const sd of [-1, 1]) {
        const e = ear(R * 1.05, R * 0.26, (u) => Math.pow(Math.sin(Math.PI * (0.18 + 0.82 * u)), 0.6), R * 0.06, R * 0.05, colour, '#f2a7b8', sd > 0 ? { at: 0.5, angle: 1.0 } : null);
        e.position.set(sd * R * 0.38, R * 0.9, 0); e.rotation.set(0.1, sd * 0.25, -sd * 0.16); add(e);
      }
      break;
    }
    // cat ears on a headband: rounded points, fluffy pink insides
    case 'cat': {
      add(headband(cloth(colour, FUZZ(), { repeat: [8, 1], bump: 0.6 }), R * 0.02));
      for (const sd of [-1, 1]) {
        const e = ear(R * 0.48, R * 0.3, (u) => Math.pow(1 - u, 0.8) * (0.85 + 0.15 * Math.sin(u * Math.PI)), R * 0.07, R * 0.06, colour, '#f4b9c6');
        e.position.set(sd * R * 0.56, R * 0.78, -R * 0.02); e.rotation.set(0.1, sd * 0.35, -sd * 0.42); add(e);
      }
      break;
    }
    // a unicorn's horn: spiralled, pearly, on a gold collar
    case 'unicorn': {
      const pearl = new THREE.MeshPhysicalMaterial({ color: '#fbf3ff', roughness: 0.22, metalness: 0.1, iridescence: 1, iridescenceIOR: 1.6, iridescenceThicknessRange: [200, 600], clearcoat: 1, sheen: 0.5, sheenColor: '#ffd6f5' });
      const horn = new THREE.Group();
      horn.add(tube(new THREE.LineCurve3(new THREE.Vector3(0, -R * 0.1, 0), new THREE.Vector3(0, R * 1.3, 0)),
        (t, a) => R * (0.19 * Math.pow(1 - t, 0.9) + 0.008) * (1 + 0.12 * Math.sin(2 * a + t * 26)), pearl, { segs: 90, radial: 32 }));
      horn.add(lathe([[R * 0.2, -R * 0.1], [R * 0.245, -R * 0.08], [R * 0.25, R * 0.0], [R * 0.235, R * 0.06], [R * 0.205, R * 0.08], [R * 0.17, R * 0.08]], metal('#e2b33c', 0.25), { seg: 32 }));
      horn.position.set(0, R * 0.8, -R * 0.55); horn.rotation.x = -0.5; add(horn);
      // a few flowers round the collar
      for (let i = 0; i < 5; i++) {
        const fl = new THREE.Group(), cA = ['#f7a8c8', '#c7b2ff', '#a8e6ff', '#fff3a8', '#b5f2c4'][i];
        for (let k = 0; k < 5; k++) { const pt = ball(cloth(cA, null, { sheen: 1 }), R * 0.04, Math.cos(k / 5 * Math.PI * 2) * R * 0.04, 0, Math.sin(k / 5 * Math.PI * 2) * R * 0.04); pt.scale.y = 0.4; fl.add(pt); }
        fl.add(ball(cloth('#f2c200', null), R * 0.025, 0, R * 0.01, 0));
        const a = -0.9 + i * 0.45;
        fl.position.set(Math.sin(a) * R * 0.5, R * 0.92 + Math.cos(a * 2) * R * 0.02, -R * 0.52 + Math.cos(a) * R * 0.2 - R * 0.05);
        fl.lookAt(fl.position.clone().multiplyScalar(2)); fl.rotateX(Math.PI / 2); add(fl);
      }
      break;
    }
    // springy antennae on a headband, glowing balls on top
    case 'antennae': {
      add(headband(plastic('#202020', 0.4), R * 0.02, 0.1));
      for (const sd of [-1, 1]) {
        const base = new THREE.Vector3(sd * R * 0.42, R * 0.95, 0);
        const helix = new (class extends THREE.Curve { getPoint(t, o = new THREE.Vector3()) { const a = t * Math.PI * 2 * 6; return o.set(base.x + Math.cos(a) * R * 0.05 + sd * t * R * 0.12, base.y + t * R * 0.55, base.z + Math.sin(a) * R * 0.05); } })();
        add(tube(helix, () => R * 0.012, metal('#c8cacc', 0.25), { segs: 160, radial: 6, capStart: false }));
        const bb = add(ball(new THREE.MeshPhysicalMaterial({ color: colour, emissive: colour, emissiveIntensity: 0.55, roughness: 0.1, clearcoat: 1 }), R * 0.13, base.x + sd * R * 0.12, base.y + R * 0.66, base.z));
        bb.add(ball(new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.6 }), R * 0.035, -R * 0.05, R * 0.06, -R * 0.08));
      }
      break;
    }
    // over-ear headphones: a padded band over the top, a yoke round each cup,
    // leather cushions against the helmet, the cups' outsides in the second
    // colour inside a chrome ring
    case 'headphones': {
      const shell = plastic(colour, 0.35), lea = new THREE.MeshPhysicalMaterial({ color: '#1b1b1d', roughness: 0.6, sheen: 0.3, normalMap: FELT(), normalScale: new THREE.Vector2(0.4, 0.4), side: THREE.DoubleSide });
      const chrome = metal('#d9dbde', 0.15), grille = new THREE.MeshStandardMaterial({ color: '#2a2a2c', roughness: 0.9, side: THREE.DoubleSide });
      const cx = R * 1.16, cy = -R * 0.04, yoke = R * 0.46, top = R * 1.32;
      // the band: half an ellipse from yoke to yoke over the top
      const ends = cy + yoke, rad = cx, sy = (top - ends) / rad;
      const band = new THREE.Mesh(new THREE.TorusGeometry(rad, R * 0.045, 12, 64, Math.PI), shell);
      band.scale.set(1, sy, 2.2); band.position.y = ends; add(band);
      const pad = new THREE.Mesh(new THREE.TorusGeometry(rad - R * 0.06, R * 0.045, 12, 48, Math.PI * 0.5).rotateZ(Math.PI * 0.25), lea);
      pad.scale.set(1, (top - ends - R * 0.06) / (rad - R * 0.06), 1.8); pad.position.y = ends; add(pad);
      for (const sd of [-1, 1]) {
        // the yoke: an arch over the cup from front to back, a chrome slider into the band
        const y = new THREE.Mesh(new THREE.TorusGeometry(yoke, R * 0.03, 8, 32, Math.PI), chrome);
        y.rotation.y = Math.PI / 2; y.position.set(sd * cx, cy, 0); add(y);
        add(cyl(chrome, R * 0.03, R * 0.03, R * 0.16, 0, 12)).position.set(sd * cx, ends + R * 0.06, 0);
        // the cup: its axis outwards along x
        const cup = new THREE.Group();
        cup.add(lathe([[R * 0.001, R * 0.17], [R * 0.24, R * 0.165], [R * 0.36, R * 0.13], [R * 0.41, R * 0.06], [R * 0.42, 0], [R * 0.41, -R * 0.03]], shell));
        cup.add(lathe([[R * 0.39, -R * 0.03], [R * 0.43, -R * 0.06], [R * 0.43, -R * 0.13], [R * 0.37, -R * 0.18], [R * 0.25, -R * 0.17], [R * 0.24, -R * 0.12]], lea));
        cup.add(cyl(grille, R * 0.245, R * 0.245, R * 0.005, -R * 0.12, 32));
        const ring = new THREE.Mesh(new THREE.TorusGeometry(R * 0.3, R * 0.02, 8, 48), chrome); ring.rotation.x = Math.PI / 2; ring.position.y = R * 0.16; cup.add(ring);
        cup.add(cyl(plastic(accent, 0.3), R * 0.28, R * 0.28, R * 0.015, R * 0.17, 48));
        cup.rotation.z = -sd * Math.PI / 2; cup.position.set(sd * (cx - R * 0.02), cy, 0); add(cup);
      }
      break;
    }
    // a halo: a glowing gold ring, softly lit around
    case 'halo': {
      const h = new THREE.Mesh(new THREE.TorusGeometry(R * 0.72, R * 0.06, 16, 64), new THREE.MeshStandardMaterial({ color: '#ffe9a0', emissive: '#ffcf3a', emissiveIntensity: 1.6, roughness: 0.2, metalness: 0.3 }));
      h.rotation.x = Math.PI / 2; h.position.y = R * 1.5; add(h);
      const glowT = pictureTex('glow', 128, 128, (c, w) => {
        const gr = c.createRadialGradient(w / 2, w / 2, w * 0.3, w / 2, w / 2, w / 2);
        gr.addColorStop(0, 'rgba(255,214,90,0)'); gr.addColorStop(0.35, 'rgba(255,214,90,0.55)'); gr.addColorStop(0.55, 'rgba(255,214,90,0.15)'); gr.addColorStop(1, 'rgba(255,214,90,0)');
        c.fillStyle = gr; c.fillRect(0, 0, w, w);
      });
      const glow = new THREE.Mesh(new THREE.PlaneGeometry(R * 2.6, R * 2.6), new THREE.MeshBasicMaterial({ map: glowT, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide }));
      glow.rotation.x = -Math.PI / 2; glow.position.y = R * 1.5; add(glow);
      g.rotation.x = 0.15;
      break;
    }
    // a traffic cone: rubbery orange, two reflective collars, a square base
    case 'cone': {
      const or = new THREE.MeshPhysicalMaterial({ color: '#ff5a0a', roughness: 0.55, clearcoat: 0.25, normalMap: SCUFF(), normalScale: new THREE.Vector2(0.3, 0.3) });
      const refl = new THREE.MeshPhysicalMaterial({ color: '#f4f6f8', roughness: 0.25, metalness: 0.35, clearcoat: 1 });
      const yb = R * 0.82, H = R * 1.55, rB = R * 0.58, rT = R * 0.09;
      const rAt = (y) => rB + (rT - rB) * ((y - yb) / H);
      add(lathe([[rB, yb], [rT, yb + H], [rT * 0.8, yb + H + R * 0.02], [0, yb + H + R * 0.025]], or, { sharp: true }));
      for (const [a, b] of [[0.42, 0.56], [0.68, 0.76]]) {
        const y0 = yb + H * a, y1 = yb + H * b;
        add(lathe([[rAt(y0) + R * 0.006, y0], [rAt(y1) + R * 0.006, y1]], refl, { sharp: true }));
      }
      const s = new THREE.Shape(), a = R * 0.78, cr = R * 0.12;
      s.moveTo(-a + cr, -a); s.lineTo(a - cr, -a); s.quadraticCurveTo(a, -a, a, -a + cr); s.lineTo(a, a - cr); s.quadraticCurveTo(a, a, a - cr, a);
      s.lineTo(-a + cr, a); s.quadraticCurveTo(-a, a, -a, a - cr); s.lineTo(-a, -a + cr); s.quadraticCurveTo(-a, -a, -a + cr, -a);
      s.holes.push(new THREE.Path().absarc(0, 0, rB * 0.98, 0, Math.PI * 2, true));
      const base = new THREE.Mesh(new THREE.ExtrudeGeometry(s, { depth: R * 0.07, bevelEnabled: true, bevelThickness: R * 0.015, bevelSize: R * 0.015, bevelSegments: 2 }), or);
      base.rotation.x = -Math.PI / 2; base.position.y = yb - R * 0.04; add(base);
      g.rotation.set(0.08, 0.2, -0.12);
      break;
    }
    // a yarmulke: a small, shallow knitted cap on the crown, a little toward
    // the back, with a woven border round its edge
    case 'yarmulke': {
      const border = pictureTex(`kippah:${colour}:${accent}`, 256, 64, (c, w, h) => {
        c.fillStyle = colour; c.fillRect(0, 0, w, h);
        c.fillStyle = accent;
        for (let i = 0; i < 16; i++) { const x = i * 16; c.beginPath(); c.moveTo(x, 40); c.lineTo(x + 8, 50); c.lineTo(x + 16, 40); c.lineTo(x + 8, 30); c.closePath(); c.fill(); }
        c.fillRect(0, 56, w, 4); c.fillRect(0, 22, w, 3);
      });
      const theta = Math.acos(0.8);
      const cap = new THREE.Mesh(new THREE.SphereGeometry(R * 1.06, 48, 12, 0, Math.PI * 2, 0, theta),
        cloth('#ffffff', KNIT(), { repeat: [24, 2], bump: 0.6, map: (() => { const t = border.clone(); t.repeat.set(4, 1); return t; })() }));
      // (the border round the cap's edge: the outer part of the cap, v 0 at the edge)
      const uv = cap.geometry.attributes.uv;
      for (let i = 0; i < uv.count; i++) { const v = uv.getY(i); uv.setY(i, v < 0.45 ? 0.06 + v / 0.45 * 0.6 : 0.66 + (v - 0.45) / 0.55 * 0.34); }
      cap.rotation.x = 0.28; add(cap);
      const rr = Math.sin(theta) * R * 1.065;
      const rim = new THREE.Mesh(new THREE.TorusGeometry(rr, 0.0035, 6, 48), cloth(accent, null));
      rim.rotation.x = Math.PI / 2; rim.position.y = R * 0.8 * 1.06;
      const holder = new THREE.Group(); holder.rotation.x = 0.28; holder.add(rim); add(holder);
      break;
    }
    default: return null;
  }
  g.traverse(o => { if (o.isMesh) o.castShadow = true; });
  return g;
}
