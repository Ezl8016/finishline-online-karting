// The racing driver model (models/driver.glb): a low-poly driver in a GP suit,
// gloves, HANS collar and full-face helmet, built from separate rigid pieces
// (upper arm, forearm, glove, thigh, shin, boot...). The model stands; here
// each piece is pivoted at its joint and posed in the seat: legs reach the
// pedals, hands grip the wheel and turn it, the body leans against the
// cornering load and the head looks into the turn.
//
// Customised from the Garage: the suit's red panels and the gloves' red take
// their own colours (through masks, so logos, stripes and the harness keep
// theirs), the helmet shell wears the helmet design, colours, finish and
// race number, and its visor the chosen visor. Driver weight fills out the
// body. Until the model has loaded (or if it can't), the simple figure from
// driver.js stands in.
//
// Kart frame, as for the kart model: origin at the kart's centre of mass,
// -Z forward, +X right, +Y up.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { Driver, HELMET_DEFAULT, paintHelmet, visorMaterial, sharkReady } from './driver.js';
import { buildHat } from './hats.js';
import { maskShader } from './paint.js';
import { suitShader, setSuit, suitAttributes, PART } from './suits.js';
import { pumpkinHelmet } from './pumpkin.js';

const URL = 'models/driver.glb';
const HEIGHT = 1.78;                                   // standing height (m)
const SUIT_MASK = { url: 'models/driver-suit-mask.png', ref: 0.1187 };
// the suit texture rebranded with the Gridline Online Karting logo in place
// of the model's Alpinestars marks (built by tools/brand_suit.py)
const SUIT_TEXTURE = 'models/driver-suit.png';
const GLOVE_MASK = { url: 'models/driver-gloves-mask.png', ref: 0.0459 };

// seat and controls in the kart frame (m)
const HIPS = new THREE.Vector3(0, -0.13, 0.14);       // between the hip joints
const RECLINE = 0.32;                                  // seat back angle from upright (rad)
const ANKLE = new THREE.Vector3(0.13, -0.17, -0.64);  // right; left mirrored
const WHEEL = new THREE.Vector3(0, 0.20, -0.18);
const WHEEL_R = 0.15;
const WHEEL_N = new THREE.Vector3(0, Math.cos(1.0), Math.sin(1.0));   // faces the driver

const PIECES = {
  head: ['head', 'HELMET_SUB0', 'HELMET_SUB1', 'HELMET_GLASS_SUB0', 'HELMET_GLASS_SUB1', 'COLLARE_HANS1'],
  chest: ['polymsh_detached4'], belly: ['polymsh_detached2'], pelvis: ['polymsh_detached3'],
  upperArm: ['polymsh_detached1', 'polymsh_detached5'], forearm: ['polymsh_extracted', 'polymsh_extracted4'],
  glove: ['polymsh_extracted3', 'polymsh_extracted5'],
  thigh: ['Driver_Body', 'Driver_Body1'], shin: ['polymsh_extracted6', 'polymsh_extracted8'],
  foot: ['polymsh_extracted7', 'polymsh_extracted9'],
};

const v3 = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);

// Two-bone IK: the middle joint for a chain root->end of lengths a, b,
// bending towards pole.
function bend(root, end, a, b, pole, out) {
  const d = v3().subVectors(end, root);
  const dist = Math.min(d.length(), a + b - 1e-3);
  d.normalize();
  const along = (a * a - b * b + dist * dist) / (2 * dist);
  const h = Math.sqrt(Math.max(0, a * a - along * along));
  const p = pole.clone().addScaledVector(d, -pole.dot(d)).normalize();
  return out.copy(root).addScaledVector(d, along).addScaledVector(p, h);
}

// The two ends of a piece along its longest extent (principal axis).
function ends(geo) {
  const p = geo.attributes.position, n = p.count, c = v3();
  for (let i = 0; i < n; i++) c.add(v3().fromBufferAttribute(p, i));
  c.divideScalar(n);
  let xx = 0, xy = 0, xz = 0, yy = 0, yz = 0, zz = 0;
  const q = v3();
  for (let i = 0; i < n; i++) {
    q.fromBufferAttribute(p, i).sub(c);
    xx += q.x * q.x; xy += q.x * q.y; xz += q.x * q.z; yy += q.y * q.y; yz += q.y * q.z; zz += q.z * q.z;
  }
  // power iteration for the main axis
  let ax = v3().set(0.3, 1, 0.2).normalize();
  for (let k = 0; k < 30; k++) {
    ax = v3().set(xx * ax.x + xy * ax.y + xz * ax.z, xy * ax.x + yy * ax.y + yz * ax.z, xz * ax.x + yz * ax.y + zz * ax.z).normalize();
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < n; i++) { const t = q.fromBufferAttribute(p, i).sub(c).dot(ax); lo = Math.min(lo, t); hi = Math.max(hi, t); }
  return [c.clone().addScaledVector(ax, lo), c.clone().addScaledVector(ax, hi), c];
}

// Spherical texture coordinates for the helmet shell, as on a three.js
// sphere, so the painted helmet designs (driver.js) fit it: visor at u 0.75.
function sphereUVs(geo, centre, half) {
  const g = geo.index ? geo.toNonIndexed() : geo;
  const p = g.attributes.position, uv = new Float32Array(p.count * 2), d = v3();
  for (let i = 0; i < p.count; i++) {
    d.fromBufferAttribute(p, i).sub(centre).divide(half).normalize();
    const th = Math.acos(THREE.MathUtils.clamp(d.y, -1, 1));
    let ph = Math.atan2(d.z, -d.x); if (ph < 0) ph += Math.PI * 2;
    uv[i * 2] = ph / (Math.PI * 2); uv[i * 2 + 1] = 1 - th / Math.PI;
  }
  // triangles straddling the seam: lift their low side by one turn (the texture repeats)
  for (let t = 0; t < p.count; t += 3) {
    const u = [uv[t * 2], uv[t * 2 + 2], uv[t * 2 + 4]];
    if (Math.max(...u) - Math.min(...u) > 0.5) for (let k = 0; k < 3; k++) if (u[k] < 0.5) uv[(t + k) * 2] += 1;
  }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// the model into the game's frame: metres, feet on y = 0, facing -Z
function fitMatrix(scene) {
  const box = new THREE.Box3().setFromObject(scene);
  const s = HEIGHT / (box.max.y - box.min.y);
  return new THREE.Matrix4().makeRotationY(Math.PI)
    .multiply(new THREE.Matrix4().makeScale(s, s, s))
    .multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
}

// The helmet on its own, for display (the clubhouse's helmet walls): the
// shell (with the paint's texture coordinates, two pieces), the visor's strip
// and its glass, centred on the helmet and facing -Z; half: its half-size.
let helmetParts = null;
export function loadHelmetParts() {
  return helmetParts ??= new Promise((res, rej) => new GLTFLoader().load(URL, (gltf) => {
    const scene = gltf.scene;
    scene.updateMatrixWorld(true);
    const meshes = {};
    scene.traverse((o) => { if (o.isMesh) meshes[o.name] = o; });
    const fit = fitMatrix(scene);
    const geo = (n) => { const g = meshes[n].geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(fit, meshes[n].matrixWorld)); g.computeBoundingBox(); return g; };
    const shells = ['HELMET_SUB0', 'HELMET_SUB1'].map(geo), b = new THREE.Box3();
    for (const g of shells) b.union(g.boundingBox);
    const c = b.getCenter(v3()), half = b.getSize(v3()).multiplyScalar(0.5);
    const centre = (g) => { g.translate(-c.x, -c.y, -c.z); g.computeVertexNormals(); return g; };
    res({ shells: shells.map(g => sphereUVs(centre(g), v3(), half)), strip: centre(geo('HELMET_GLASS_SUB0')), glass: centre(geo('HELMET_GLASS_SUB1')), half });
  }, undefined, rej));
}

// Podium celebrations. Each returns the pose at time t: hand targets [x, y, z]
// relative to the shoulder (x outwards, y up, z back; -z is in front), plus
// body motion. Unlisted hands hang at the sides.
const DOWN = [0.06, -0.52, -0.04];
const sn = Math.sin, ab = Math.abs;
export const EMOTES = {
  // walking (t: the stride's phase in radians): arms swinging, a bob
  walk: (t) => ({ R: [0.08, -0.5, -0.04 + 0.16 * Math.sin(t)], L: [0.08, -0.5, -0.04 - 0.16 * Math.sin(t)], hop: 0.02 * Math.abs(Math.sin(t)), twist: 0.06 * Math.sin(t) }),
  idle: () => ({ R: [0.08, -0.52, -0.02], L: [0.08, -0.52, -0.02] }),
  wave: (t) => ({ R: [0.26 + 0.09 * sn(t * 7), 0.36, -0.06], L: DOWN, look: 0.15 * sn(t * 1.3) }),
  fistPump: (t) => { const k = Math.max(0, sn(t * 5)); return { R: [0.1, 0.12 + 0.34 * k, -0.12], L: DOWN, nod: -0.08 * k, sway: 0.04 * k }; },
  victory: (t) => ({ both: [0.3, 0.42 + 0.04 * sn(t * 3), -0.02], nod: -0.12, lean: -0.04 }),
  jump: (t) => { const k = Math.max(0, sn(t * 4.5)); return { both: [0.28, 0.2 + 0.25 * k, -0.04], hop: 0.18 * k, nod: -0.06 * k }; },
  dance: (t) => ({ R: [0.12, -0.12 + 0.12 * sn(t * 4), -0.28], L: [0.12, -0.12 - 0.12 * sn(t * 4), -0.28],
    sway: 0.12 * sn(t * 4), swayX: 0.04 * sn(t * 4), twist: 0.15 * sn(t * 2), knees: 0.06 * ab(sn(t * 4)) }),
  clap: (t) => { const k = ab(sn(t * 6)); return { R: [-0.12 - 0.08 * k, -0.18, -0.34], L: [-0.12 - 0.08 * k, -0.18, -0.34], nod: 0.05 * k }; },
  point: (t) => ({ R: [0.02, 0.02 + 0.03 * sn(t * 2), -0.58], L: [0.12, -0.2, -0.12], look: 0.05 * sn(t * 2) }),
};

export class RacingDriver {
  constructor() {
    this.object = new THREE.Group();
    this.object.name = 'driver';
    this.fallback = new Driver();
    this.object.add(this.fallback.object);
    this.cfg = { ...HELMET_DEFAULT };
    this.lb = 175;
    this.env = null;
    this.ready = false;
    new GLTFLoader().load(URL, (gltf) => {
      try { this.build(gltf.scene); } catch (e) { console.error('driver model:', e); }
    }, undefined, (e) => console.error('driver model:', e));
  }

  build(scene) {
    scene.updateMatrixWorld(true);
    // bake every piece into one frame: metres, feet on y = 0, facing -Z
    const meshes = {};
    scene.traverse((o) => { if (o.isMesh) meshes[o.name] = o; });
    const fit = fitMatrix(scene);
    const geo = {}, mat = {};
    for (const [name, m] of Object.entries(meshes)) {
      const g = m.geometry.clone().applyMatrix4(new THREE.Matrix4().multiplyMatrices(fit, m.matrixWorld));
      g.computeBoundingBox();
      geo[name] = g; mat[name] = m.material;
    }
    // sides: +X is the driver's right
    const side = (names) => {
      const [a, b] = names.map(n => geo[n]);
      return a.boundingBox.getCenter(v3()).x > b.boundingBox.getCenter(v3()).x ? { R: names[0], L: names[1] } : { R: names[1], L: names[0] };
    };
    const S = {}; for (const k of ['upperArm', 'forearm', 'glove', 'thigh', 'shin', 'foot']) S[k] = side(PIECES[k]);

    // ---- joints in the standing (rest) pose
    const J = { R: {}, L: {} };
    for (const sd of ['R', 'L']) {
      const t = geo[S.thigh[sd]].boundingBox, sh = geo[S.shin[sd]].boundingBox;
      const tc = t.getCenter(v3()), shc = sh.getCenter(v3());
      J[sd].hip = v3().set(tc.x, t.max.y - 0.04, tc.z);
      J[sd].knee = v3().set(shc.x, (t.min.y + sh.max.y) / 2, shc.z);
      J[sd].ankle = v3().set(shc.x, sh.min.y + 0.04, shc.z);
      const [a, b] = ends(geo[S.upperArm[sd]]);
      const torsoX = 0;
      const [sho, elb] = Math.abs(a.x - torsoX) < Math.abs(b.x - torsoX) ? [a, b] : [b, a];
      J[sd].shoulder = sho; J[sd].elbow = elb;
      J[sd].hand = geo[S.glove[sd]].boundingBox.getCenter(v3());
      J[sd].lens = {
        thigh: J[sd].hip.distanceTo(J[sd].knee), shin: J[sd].knee.distanceTo(J[sd].ankle),
        upper: sho.distanceTo(elb), lower: elb.distanceTo(J[sd].hand),
      };
    }
    const hipC = v3().addVectors(J.R.hip, J.L.hip).multiplyScalar(0.5);
    const chestBox = geo[PIECES.chest[0]].boundingBox;
    const neck = v3().set(0, chestBox.max.y - 0.02, chestBox.getCenter(v3()).z);
    this.J = J;
    // where each bit of the suit is on the body, for the suit designs (suits.js)
    for (const k of ['chest', 'belly', 'pelvis']) suitAttributes(geo[PIECES[k][0]], PART.torso);
    for (const sd of ['R', 'L']) {
      const s = sd === 'R' ? 1 : -1, arm = [J[sd].shoulder, J[sd].hand], leg = [J[sd].hip, J[sd].ankle];
      suitAttributes(geo[S.upperArm[sd]], PART.upperArm, arm, s); suitAttributes(geo[S.forearm[sd]], PART.forearm, arm, s);
      suitAttributes(geo[S.thigh[sd]], PART.thigh, leg, s); suitAttributes(geo[S.shin[sd]], PART.shin, leg, s);
      suitAttributes(geo[S.foot[sd]], PART.foot, leg, s);
    }

    // ---- materials: suit and glove colours through masks, painted helmet
    this.suitU = []; this.gloveU = [];
    const suitMat = mat[PIECES.chest[0]].clone(), gloveMat = mat[S.glove.R].clone();
    this.suitMat = suitMat;
    new THREE.TextureLoader().load(SUIT_TEXTURE, (t) => {
      const o = suitMat.map;
      t.flipY = false;                                 // glTF texture orientation
      t.colorSpace = THREE.SRGBColorSpace;
      if (o) { t.wrapS = o.wrapS; t.wrapT = o.wrapT; t.anisotropy = o.anisotropy; }
      suitMat.map = t;
      suitMat.needsUpdate = true;
      this.suitTexReady = true;
    });
    this.suitU.push(maskShader(suitMat, { ...SUIT_MASK, material: suitMat.name, slot: 'paint' }));
    this.gloveU.push(maskShader(gloveMat, { ...GLOVE_MASK, material: gloveMat.name, slot: 'paint' }));
    this.suitD = suitShader(suitMat);
    this.shellMat = new THREE.MeshPhysicalMaterial({ roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 });
    this.visorMesh = null;
    const hans = mat.COLLARE_HANS1.clone(); hans.alphaTest = 0.5; hans.transparent = false;
    const strip = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.4 });

    // ---- rigid pieces, each pivoted at its joint
    const piece = (name, pivot, material) => {
      const g = geo[name].clone().translate(-pivot.x, -pivot.y, -pivot.z);
      g.computeVertexNormals();
      const m = new THREE.Mesh(g, material || mat[name]);
      m.castShadow = true; m.receiveShadow = true;
      return m;
    };
    const holder = new THREE.Group();
    // upper body: pivots at the hips, reclined into the seat
    this.upper = new THREE.Group();
    this.upper.position.copy(HIPS);
    for (const k of ['chest', 'belly', 'pelvis']) this.upper.add(piece(PIECES[k][0], hipC, suitMat));
    this.torsoMeshes = [...this.upper.children];
    // head: helmet, face, visor, HANS, pivoting at the neck
    this.head = new THREE.Group();
    this.head.position.copy(neck).sub(hipC);
    this.upper.add(this.head);
    const helmetBox = new THREE.Box3();
    for (const n of ['HELMET_SUB0', 'HELMET_SUB1']) helmetBox.union(geo[n].boundingBox);
    const hc = helmetBox.getCenter(v3()).sub(neck), hh = helmetBox.getSize(v3()).multiplyScalar(0.5);
    // where a hat goes: centred on the helmet, scaled to it (hats.js builds them for a 0.14 m helmet)
    this.hatAt = { c: hc.clone(), s: new THREE.Vector3(hh.x / 0.14, hh.y / 0.14, hh.z / 0.14) };
    this.hat = null; this.hatKey = '';
    this.shell = [];                 // the helmet's shell, visor and visor strip (a pumpkin hides them)
    this.pumpkin = null;
    for (const n of PIECES.head) {
      let m;
      if (n === 'HELMET_SUB0' || n === 'HELMET_SUB1') {
        m = piece(n, neck, this.shellMat);
        m.geometry = sphereUVs(m.geometry, hc, hh);
      } else if (n === 'HELMET_GLASS_SUB1') m = this.visorMesh = piece(n, neck, visorMaterial(this.cfg.visor));
      else if (n === 'HELMET_GLASS_SUB0') m = piece(n, neck, strip);
      else if (n === 'COLLARE_HANS1') m = piece(n, neck, hans);
      else m = piece(n, neck);
      if (n.startsWith('HELMET')) this.shell.push(m);
      this.head.add(m);
    }
    this.helmetBox = { c: hc.clone(), h: hh.clone() };
    holder.add(this.upper);
    // limbs
    this.limbs = {};
    for (const sd of ['R', 'L']) {
      const L = this.limbs[sd] = {};
      const mk = (name, pivot, material) => { const g = new THREE.Group(); g.add(piece(name, pivot, material)); holder.add(g); return g; };
      L.thigh = mk(S.thigh[sd], J[sd].hip, suitMat);
      L.shin = mk(S.shin[sd], J[sd].knee, suitMat);
      L.foot = mk(S.foot[sd], J[sd].ankle, suitMat);
      L.upperArm = mk(S.upperArm[sd], J[sd].shoulder, suitMat);
      L.lowerArm = mk(S.forearm[sd], J[sd].elbow, suitMat);
      L.lowerArm.add(piece(S.glove[sd], J[sd].elbow, gloveMat));
      // rest directions of each bone
      L.rest = {
        thigh: v3().subVectors(J[sd].knee, J[sd].hip).normalize(),
        shin: v3().subVectors(J[sd].ankle, J[sd].knee).normalize(),
        upper: v3().subVectors(J[sd].elbow, J[sd].shoulder).normalize(),
        lower: v3().subVectors(J[sd].hand, J[sd].elbow).normalize(),
      };
      L.shoulderRest = J[sd].shoulder.clone().sub(hipC);   // relative to the hips, in the upper body
    }
    this.holder = holder;
    this.hipC = hipC.clone();
    this.hipOff = { R: v3().subVectors(J.R.hip, hipC), L: v3().subVectors(J.L.hip, hipC) };

    this.object.remove(this.fallback.object);
    this.object.add(holder);
    this.ready = true;
    this.setHelmet(this.cfg);
    if (this.env) this.setEnvMap(this.env);
    this.setWeight(this.lb);
    if (this.standing) this.stand(this.standing, 0); else this.update(0, 0, 'MENU');
  }

  setHelmet(cfg) {
    this.cfg = { ...HELMET_DEFAULT, ...cfg };
    this.fallback.setHelmet(this.cfg);
    if (!this.ready) return;
    const c = this.cfg;
    this.shellMat.map?.dispose();
    const t = paintHelmet(c);
    t.wrapS = THREE.RepeatWrapping;
    this.shellMat.map = t;
    const fin = { gloss: [0.3, 0, 1], matte: [0.8, 0, 0], metallic: [0.35, 0.6, 0.6], gold: [0.22, 1, 1] }[c.finish] || [0.3, 0, 1];
    this.shellMat.roughness = fin[0]; this.shellMat.metalness = fin[1]; this.shellMat.clearcoat = fin[2];
    // (a helmet with its own chrome and gloss: those come from its map)
    this.shellMat.roughnessMap?.dispose();
    const mr = t.userData.metalRough ?? null;
    this.shellMat.roughnessMap = this.shellMat.metalnessMap = mr;
    if (mr) { this.shellMat.roughness = 1; this.shellMat.metalness = 1; this.shellMat.clearcoat = 1; }
    // (the logo on the helmet comes in a moment later: paint it again then)
    if (!this.sharkWait) this.sharkWait = sharkReady.then(() => this.setHelmet(this.cfg));
    // (the admin's gold helmet: polished gold all over, the design under it)
    this.shellMat.color.set(c.finish === 'gold' ? '#e8b84a' : '#ffffff');
    this.shellMat.needsUpdate = true;
    // the Halloween pumpkin, over the head in place of the helmet
    const pumpkin = c.design === 'pumpkin';
    for (const m of this.shell) m.visible = !pumpkin;
    if (pumpkin && !this.pumpkin) {
      this.pumpkin = pumpkinHelmet().then((g) => {
        // big enough all round that the helmet never shows through, sitting a little high
        const { c: hc, h } = this.helmetBox;
        g.scale.multiplyScalar(Math.max(h.x * 2 * 1.16, h.z * 2 * 1.08));
        g.position.copy(hc).add(new THREE.Vector3(0, h.y * 0.12, 0));
        if (this.env) g.traverse((o) => { if (o.isMesh && !o.material.envMap) { o.material.envMap = this.env; o.material.envMapIntensity = 0.5; } });
        this.head.add(g);
        g.visible = this.cfg.design === 'pumpkin';
        this.pumpkinObj = g;
        this.liftHat();
        return g;
      }).catch((e) => { console.warn('pumpkin helmet', e); });
    }
    if (this.pumpkinObj) this.pumpkinObj.visible = pumpkin;
    this.liftHat();
    // the hat, rebuilt only when it changes
    const key = `${c.hat}|${c.hatColor || c.primary}|${c.secondary}`;
    if (key !== this.hatKey) {
      this.hatKey = key;
      if (this.hat) { this.head.remove(this.hat); this.hat.traverse(o => { if (o.isMesh) { o.geometry.dispose(); o.material.dispose(); } }); }
      this.hat = buildHat(c.hat, c.hatColor || c.primary, c.secondary);
      if (this.hat) {
        this.hat.position.copy(this.hatAt.c); this.hat.scale.copy(this.hatAt.s);
        this.spin = this.hat.getObjectByName('spin');
        this.liftHat();
        // (reflections for its metal and gloss where the scene has none of its own, as in the Garage)
        if (this.env) this.hat.traverse((o) => { if (o.isMesh && !o.material.envMap && o.material.isMeshStandardMaterial) { o.material.envMap = this.env; o.material.envMapIntensity = 0.6; } });
        this.head.add(this.hat);
      } else this.spin = null;
    }
    const old = this.visorMesh.material;
    this.visorMesh.material = visorMaterial(c.visor);
    this.visorMesh.material.envMap = this.env;
    old.dispose();
    for (const u of this.suitU) { u.uOn.value = 1; u.uCol.value.set(c.suit); }
    setSuit(this.suitD, c);
    for (const u of this.gloveU) { u.uOn.value = 1; u.uCol.value.set(c.gloves || c.primary); }
  }

  // a hat sits on the pumpkin, higher than on the helmet
  liftHat() {
    if (!this.hat) return;
    this.hat.position.copy(this.hatAt.c);
    if (this.cfg.design === 'pumpkin' && this.pumpkinObj) {
      const top = new THREE.Box3().setFromObject(this.pumpkinObj.children[0]);
      this.head.updateMatrixWorld(true);
      const local = this.head.worldToLocal(top.max.clone());
      this.hat.position.y += Math.max(0, local.y - (this.hatAt.c.y + this.helmetBox.h.y)) * 0.75;
    }
  }

  setEnvMap(env) {
    this.env = env;
    this.fallback.setEnvMap(env);
    if (!this.ready) return;
    this.shellMat.envMap = env; this.shellMat.envMapIntensity = 0.6; this.shellMat.needsUpdate = true;
    this.visorMesh.material.envMap = env; this.visorMesh.material.needsUpdate = true;
  }

  // The driver's weight is in the physics only: every driver keeps the same
  // build, however heavy (it used to fill out the suit).
  setWeight(lb) {
    this.lb = lb;
    this.fallback.setWeight(lb);
    if (!this.ready) return;
    for (const m of this.torsoMeshes) m.scale.set(1.02, 1, 0.97);
  }

  // Standing on the podium, celebrating. t: seconds. In this pose the driver
  // stands at the origin (feet on y = 0) facing -Z. emote: a name in EMOTES,
  // or a pose function of its own. this.hands: where the hands are, in the
  // holder's space (to give one something to hold).
  stand(emote, t) {
    this.standing = emote;
    if (!this.ready) { this.fallback.object.visible = false; return; }
    const e = typeof emote === 'function' ? emote : EMOTES[emote] || EMOTES.wave;
    const p = e(t);
    this.hands ||= {};
    this.holder.position.set(0, p.hop || 0, 0);
    this.upper.position.copy(this.hipC).add(v3(p.swayX || 0, 0, 0));
    this.upper.rotation.set(p.lean || 0, p.twist || 0, p.sway || 0, 'XZY');
    this.head.visible = true;
    this.head.rotation.set(p.nod || 0, p.look || 0, 0, 'XYZ');
    this.upper.updateMatrix();
    const mid = v3();
    for (const sd of ['R', 'L']) {
      const L = this.limbs[sd], J = this.J[sd], s = sd === 'R' ? 1 : -1;
      // legs straight, as modelled (a slight knee bend when dancing)
      const hip = this.hipC.clone().add(this.hipOff[sd]).add(v3(p.swayX || 0, 0, 0));
      const ankle = J.ankle.clone();
      const knee = bend(hip, ankle, J.lens.thigh, J.lens.shin, v3(0, 0.2, -1), mid.clone());
      if (p.knees) knee.z -= p.knees;
      L.thigh.position.copy(hip);
      L.thigh.quaternion.setFromUnitVectors(L.rest.thigh, v3().subVectors(knee, hip).normalize());
      L.shin.position.copy(knee);
      L.shin.quaternion.setFromUnitVectors(L.rest.shin, v3().subVectors(ankle, knee).normalize());
      L.foot.position.copy(ankle);
      L.foot.quaternion.identity();
      // arms: each hand's target relative to its shoulder (x mirrored for the left)
      const sh = L.shoulderRest.clone().applyMatrix4(this.upper.matrix);
      const h = p[sd] || p.both || [0.06, -0.52, -0.04];
      const hand = sh.clone().add(v3(h[0] * s, h[1], h[2]));
      this.hands[sd] = hand;
      const elb = bend(sh, hand, J.lens.upper, J.lens.lower, v3(s, -0.6, 0.5).normalize(), mid.clone());
      L.upperArm.position.copy(sh);
      L.upperArm.quaternion.setFromUnitVectors(L.rest.upper, v3().subVectors(elb, sh).normalize());
      L.lowerArm.position.copy(elb);
      L.lowerArm.quaternion.setFromUnitVectors(L.rest.lower, v3().subVectors(hand, elb).normalize());
    }
  }

  headPosition(out) { return (this.ready ? this.head : this.fallback.head).getWorldPosition(out); }

  // steer: -1..1 of full lock; latG: lateral g (+ = turning right)
  update(steer, latG, camMode) {
    if (!this.ready) { this.fallback.update(steer, latG, camMode); return; }
    const lean = THREE.MathUtils.clamp(latG, -1.6, 1.6);
    // (back in the seat after standing: stand() moves these)
    this.holder.position.set(0, 0, 0);
    this.upper.position.copy(HIPS);
    // +x rotation tips the top back (towards +Z): the seat's recline
    this.upper.rotation.set(RECLINE, 0, lean * 0.05, 'XZY');
    // the head comes most of the way back upright to look down the track
    this.head.rotation.set(-RECLINE * 0.75, -steer * 0.3, lean * 0.08, 'XYZ');
    // from the cockpit camera you'd be looking out of the helmet
    this.head.visible = camMode !== 'COCKPIT';
    if (this.spin) this.spin.rotation.y += 0.25;          // the propeller cap's propeller
    this.upper.updateMatrix();
    const q = new THREE.Quaternion(), mid = v3(), e1 = v3(1, 0, 0), e2 = v3().crossVectors(WHEEL_N, e1).normalize();
    const rot = -steer * 1.6;                       // the wheel turns ~90 degrees at full lock
    for (const sd of ['R', 'L']) {
      const L = this.limbs[sd], J = this.J[sd], s = sd === 'R' ? 1 : -1;
      // legs: hips in the seat, feet on the pedals, knees bent up
      const hip = HIPS.clone().add(this.hipOff[sd]);
      const ankle = v3(ANKLE.x * s, ANKLE.y, ANKLE.z);
      const knee = bend(hip, ankle, J.lens.thigh, J.lens.shin, v3(0.15 * s, 1, 0.1), mid.clone());
      L.thigh.position.copy(hip);
      L.thigh.quaternion.setFromUnitVectors(L.rest.thigh, v3().subVectors(knee, hip).normalize());
      L.shin.position.copy(knee);
      L.shin.quaternion.setFromUnitVectors(L.rest.shin, v3().subVectors(ankle, knee).normalize());
      L.foot.position.copy(ankle);
      L.foot.quaternion.copy(L.shin.quaternion);
      // arms: shoulders ride with the upper body, hands grip the rim
      const sh = L.shoulderRest.clone().applyMatrix4(this.upper.matrix);
      const th = (sd === 'R' ? 0.35 : Math.PI - 0.35) + rot;
      const hand = WHEEL.clone().addScaledVector(e1, Math.cos(th) * WHEEL_R).addScaledVector(e2, Math.sin(th) * WHEEL_R);
      const elb = bend(sh, hand, J.lens.upper, J.lens.lower, v3(s, -0.8, 0.4).normalize(), mid.clone());
      L.upperArm.position.copy(sh);
      L.upperArm.quaternion.setFromUnitVectors(L.rest.upper, v3().subVectors(elb, sh).normalize());
      L.lowerArm.position.copy(elb);
      q.setFromUnitVectors(L.rest.lower, v3().subVectors(hand, elb).normalize());
      L.lowerArm.quaternion.copy(q);
    }
  }
}
