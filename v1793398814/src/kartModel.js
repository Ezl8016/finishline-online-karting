// Loads a kart model (bundled, or imported by the player), fits it to the
// Viper's real dimensions and finds its wheels and steering wheel so they can
// be animated. Per-model tweaks live in models/catalog.json.

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { KART } from './physics/kart.js';
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js';

const VIPER_LENGTH = 1.84;   // m, bumper to bumper (OTK Viper rental)

const DEFAULTS = {
  yawDegrees: 180,            // glTF models usually face +Z; ours face -Z
  length: VIPER_LENGTH,
  offset: [0, 0, 0],          // metres, after fitting
  wheelPattern: 'wheel|tire|tyre|rim|rueda|ruota|felge',
  steeringPattern: 'steer|volant|lenkrad',
  credit: '',
};

export async function loadKartModel(source, options = {}) {
  const cfg = { ...DEFAULTS, ...options };
  const loader = new GLTFLoader();
  // free models are often Draco- or meshopt-compressed
  loader.setDRACOLoader(new DRACOLoader().setDecoderPath('vendor/three/addons/libs/draco/gltf/'));
  loader.setMeshoptDecoder(MeshoptDecoder);
  const gltf = await new Promise((res, rej) => {
    if (source instanceof ArrayBuffer) loader.parse(source, '', res, rej);
    else loader.load(source, res, undefined, rej);
  });
  const model = gltf.scene;
  // replacement textures (rebranded bodywork), by material name
  if (cfg.textures) {
    const tl = new THREE.TextureLoader();
    const jobs = Object.entries(cfg.textures).map(async ([matName, url]) => {
      const t = await tl.loadAsync(url);
      t.flipY = false;                          // glTF texture orientation
      t.colorSpace = THREE.SRGBColorSpace;
      model.traverse((o) => {
        if (!o.isMesh) return;
        for (const m of [].concat(o.material)) if (m?.name === matName) {
          if (m.map) { t.wrapS = m.map.wrapS; t.wrapT = m.map.wrapT; }
          m.map = t; m.needsUpdate = true;
        }
      });
    });
    await Promise.all(jobs).catch((e) => console.warn('kart texture:', e));
  }
  model.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      if (o.material && o.material.map) o.material.map.anisotropy = 8;
    }
  });

  // --- orient and scale
  const holder = new THREE.Group();           // origin = kart CG, -Z forward
  const fit = new THREE.Group();
  fit.add(model);
  holder.add(fit);
  fit.rotation.y = THREE.MathUtils.degToRad(cfg.yawDegrees);
  fit.updateMatrixWorld(true);
  let box = new THREE.Box3().setFromObject(fit);
  let size = box.getSize(new THREE.Vector3());
  // if the model's long axis is X, turn it a further 90 degrees
  if (size.x > size.z * 1.15) {
    fit.rotation.y += Math.PI / 2;
    fit.updateMatrixWorld(true);
    box = new THREE.Box3().setFromObject(fit);
    size = box.getSize(new THREE.Vector3());
  }
  const axleMid = (KART.wheelbase * KART.rearWeight - KART.wheelbase * (1 - KART.rearWeight)) / -2;
  const fitTo = (scale) => {
    // tyres on the ground, centred, wheelbase centre roughly under the physics axles
    fit.scale.setScalar(scale);
    fit.position.set(0, 0, 0);
    fit.updateMatrixWorld(true);
    const b = new THREE.Box3().setFromObject(fit);
    const c = b.getCenter(new THREE.Vector3());
    fit.position.set(-c.x, -b.min.y - KART.cgHeight, -c.z + axleMid);
    fit.updateMatrixWorld(true);
  };
  const lengthScale = cfg.length / size.z;
  fitTo(lengthScale);

  // --- wheels: named nodes first, else cut them out of a single mesh
  const re = new RegExp(cfg.wheelPattern, 'i');
  const candidates = [];
  model.traverse((o) => {
    if (o === model || !re.test(o.name)) return;
    // skip a node if an ancestor already matched (avoid double-rotating)
    let p = o.parent, nested = false;
    while (p && p !== model) { if (re.test(p.name)) nested = true; p = p.parent; }
    if (!nested) candidates.push(o);
  });
  const hb = new THREE.Box3();
  const groundY = -KART.cgHeight;
  const detect = () => {
    const named = [];
    for (const o of candidates) {
      hb.setFromObject(o);
      const sz = hb.getSize(new THREE.Vector3());
      if (sz.y < 0.12 || sz.y > 0.5) continue;            // not a road wheel
      named.push({ o, c: hb.getCenter(new THREE.Vector3()) });
    }
    return named.length ? { named, cut: [] } : { named, cut: findMeshWheels(model, groundY) };
  };
  let det = detect();
  // scale by wheelbase so the model's axles sit on the physics axles (keeping
  // the overall length believable for a kart)
  const centres = () => [...det.named, ...det.cut].map(f => f.c);
  let cs = centres();
  if (cs.some(c => c.z < 0) && cs.some(c => c.z > 0)) {
    const mean = (arr) => arr.reduce((a, c) => a + c.z, 0) / arr.length;
    const wb = mean(cs.filter(c => c.z > 0)) - mean(cs.filter(c => c.z < 0));
    let scale = lengthScale * KART.wheelbase / wb;
    scale = Math.min(Math.max(scale, lengthScale * 1.5 / cfg.length), lengthScale * 2.1 / cfg.length);
    fitTo(scale);
    det = detect();
    cs = centres();
  }
  // line the model's rear axle up with the physics rear axle
  const rears = cs.filter(c => c.z > 0);
  if (rears.length) {
    const rz = rears.reduce((a, c) => a + c.z, 0) / rears.length;
    fit.position.z += KART.wheelbase * (1 - KART.rearWeight) - rz;
  }
  fit.position.x += cfg.offset[0]; fit.position.y += cfg.offset[1]; fit.position.z += cfg.offset[2];
  fit.updateMatrixWorld(true);
  const wheels = [];
  for (const { o } of det.named) {
    hb.setFromObject(o);
    const c = hb.getCenter(new THREE.Vector3());
    // re-pivot the node around its own centre so it can spin about the axle
    const local = o.parent.worldToLocal(c.clone());
    const pivot = new THREE.Group();
    pivot.position.copy(local);
    o.parent.add(pivot);
    o.position.sub(local);
    pivot.add(o);
    const hc = holder.worldToLocal(c.clone());
    wheels.push({ pivot, front: hc.z < 0, left: hc.x < 0, baseQuat: pivot.quaternion.clone() });
  }
  for (const pivot of cutWheels(det.cut)) {
    holder.add(pivot);
    wheels.push({ pivot, front: pivot.position.z < 0, left: pivot.position.x < 0, baseQuat: pivot.quaternion.clone() });
  }
  if (cfg.sideLogos) await addSideLogos(holder, cfg.sideLogos);
  // the race number: on plates stuck to the bodywork, and/or redrawn inside
  // the number squares printed in the model's own textures
  const setters = [];
  if (cfg.numbers) setters.push(addNumbers(holder, cfg.numbers));
  if (cfg.numberBoxes) setters.push(addNumberBoxes(holder, cfg.numberBoxes));
  const setNumber = (text) => { for (const f of setters) f(text); };
  let steeringWheel = null;
  const sre = new RegExp(cfg.steeringPattern, 'i');
  model.traverse((o) => { if (!steeringWheel && sre.test(o.name)) steeringWheel = o; });
  const steeringBase = steeringWheel ? steeringWheel.quaternion.clone() : null;

  const qa = new THREE.Quaternion(), qs = new THREE.Quaternion();
  const ax = new THREE.Vector3(), up = new THREE.Vector3();
  const tmp = new THREE.Matrix4();

  return {
    object: holder,
    wheelCount: wheels.length,
    credit: cfg.credit,
    hasSteeringWheel: !!steeringWheel,
    setNumber,                      // the race number on the plates ('' hides them)
    // physics wheels: [FL, FR, RL, RR]
    animate(phys, steerInput) {
      for (const w of wheels) {
        const pw = phys.wheels[(w.front ? 0 : 2) + (w.left ? 0 : 1)];
        // axle = holder X axis, steering = holder Y axis, expressed in the pivot's parent space
        tmp.copy(w.pivot.parent.matrixWorld).invert().multiply(holder.matrixWorld);
        ax.set(1, 0, 0).transformDirection(tmp);
        up.set(0, 1, 0).transformDirection(tmp);
        qa.setFromAxisAngle(ax, -pw.angle);
        qs.setFromAxisAngle(up, w.front ? pw.steer : 0);
        w.pivot.quaternion.copy(qs).multiply(qa).multiply(w.baseQuat);
      }
      if (steeringWheel) {
        tmp.copy(steeringWheel.parent.matrixWorld).invert().multiply(holder.matrixWorld);
        // column is raked ~ 20 degrees back from vertical
        ax.set(0, Math.cos(0.35), Math.sin(0.35)).transformDirection(tmp);
        qa.setFromAxisAngle(ax, -steerInput * 1.6);
        steeringWheel.quaternion.copy(qa).multiply(steeringBase);
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Single-mesh models: split triangles into connected pieces, pick the pieces
// that look like tyres (round, touching the ground, out at the corners) plus
// anything nested inside them (rims, hubs), and move those into their own
// meshes so they can spin and steer. Works in the holder's (metre) space.

function meshTriangles(mesh) {
  const g = mesh.geometry;
  const pos = g.attributes.position;
  const index = g.index;
  const triCount = index ? index.count / 3 : pos.count / 3;
  const vid = (t, k) => (index ? index.getX(t * 3 + k) : t * 3 + k);
  mesh.updateMatrixWorld(true);
  const m = mesh.matrixWorld;
  const v = new THREE.Vector3();
  // weld by position (1 mm) so pieces split on real gaps, not on UV seams
  const key = new Map();
  const weld = new Int32Array(pos.count);
  const world = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(m);
    world[i * 3] = v.x; world[i * 3 + 1] = v.y; world[i * 3 + 2] = v.z;
    const k = `${Math.round(v.x * 1000)},${Math.round(v.y * 1000)},${Math.round(v.z * 1000)}`;
    let w = key.get(k);
    if (w === undefined) { w = key.size; key.set(k, w); }
    weld[i] = w;
  }
  const parent = new Int32Array(key.size).map((_, i) => i);
  const find = (a) => { while (parent[a] !== a) { parent[a] = parent[parent[a]]; a = parent[a]; } return a; };
  for (let t = 0; t < triCount; t++) {
    const a = find(weld[vid(t, 0)]), b = find(weld[vid(t, 1)]), c = find(weld[vid(t, 2)]);
    parent[b] = a; parent[find(c)] = a;
  }
  const comps = new Map();
  for (let t = 0; t < triCount; t++) {
    const r = find(weld[vid(t, 0)]);
    let c = comps.get(r);
    if (!c) { c = { tris: [], box: new THREE.Box3() }; comps.set(r, c); }
    c.tris.push(t);
    for (let k = 0; k < 3; k++) {
      const i = vid(t, k);
      c.box.expandByPoint(v.set(world[i * 3], world[i * 3 + 1], world[i * 3 + 2]));
    }
  }
  return { mesh, vid, comps: [...comps.values()] };
}

function findMeshWheels(model, groundY) {
  const parts = [];
  model.traverse((o) => { if (o.isMesh && !o.isSkinnedMesh) parts.push(meshTriangles(o)); });
  const all = [];
  for (const p of parts) for (const c of p.comps) all.push({ part: p, ...c });
  const size = new THREE.Vector3(), ctr = new THREE.Vector3();
  // tyre candidates
  const seeds = all.filter((c) => {
    c.box.getSize(size); c.box.getCenter(ctr);
    return c.box.min.y - groundY < 0.05 && size.y > 0.15 && size.y < 0.6 &&
      size.z > 0.12 && size.z < 0.65 && size.x < 0.36 && Math.abs(ctr.x) > 0.22 &&
      Math.abs(size.y - size.z) < 0.35 * size.y;     // round in side view
  });
  // cluster seeds per corner
  const clusters = [];
  for (const s of seeds) {
    s.box.getCenter(ctr);
    let cl = clusters.find(c => c.box.getCenter(new THREE.Vector3()).distanceTo(ctr) < 0.15);
    if (!cl) { cl = { box: new THREE.Box3(), members: [] }; clusters.push(cl); }
    cl.box.union(s.box); cl.members.push(s);
  }
  if (clusters.length < 4 || clusters.length > 6) return [];
  // rims, hubs, valve stems: anything sitting inside a tyre's box
  for (const cl of clusters) {
    const grown = cl.box.clone().expandByScalar(0.015);
    for (const c of all) if (!cl.members.includes(c) && grown.containsBox(c.box)) cl.members.push(c);
    cl.c = cl.box.getCenter(new THREE.Vector3());
  }
  return clusters;
}

// Move every wheel cluster's triangles into its own mesh, pivoting at the
// wheel centre. Each source mesh is split once so triangle indices stay valid.
function cutWheels(clusters) {
  const perPart = new Map();            // part -> Map(tri -> wheel index)
  clusters.forEach((cl, wi) => {
    for (const m of cl.members) {
      if (!perPart.has(m.part)) perPart.set(m.part, new Map());
      const label = perPart.get(m.part);
      for (const t of m.tris) if (!label.has(t)) label.set(t, wi);
    }
  });
  const pieces = clusters.map(() => []);
  const boxes = clusters.map(() => new THREE.Box3());
  for (const [part, label] of perPart) {
    const mesh = part.mesh;
    mesh.updateMatrixWorld(true);
    const out = splitGeometry(mesh.geometry, (t) => label.get(t) ?? -1, clusters.length);
    mesh.geometry = out.kept;
    out.parts.forEach((g, wi) => {
      if (!g) return;
      g.applyMatrix4(mesh.matrixWorld);          // bake into holder space
      g.computeBoundingBox();
      boxes[wi].union(g.boundingBox);
      pieces[wi].push(new THREE.Mesh(g, mesh.material));
    });
  }
  return clusters.map((_, wi) => {
    const pivot = new THREE.Group();
    const centre = boxes[wi].getCenter(new THREE.Vector3());
    pivot.position.copy(centre);
    for (const wm of pieces[wi]) {
      wm.geometry.translate(-centre.x, -centre.y, -centre.z);
      wm.castShadow = true; wm.receiveShadow = true;
      pivot.add(wm);
    }
    return pivot;
  }).filter(p => p.children.length);
}

// Split a geometry by a per-triangle label (-1 = keep in the body), keeping
// every attribute and multi-material groups.
function splitGeometry(geo, labelOf, count) {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const triCount = src.attributes.position.count / 3;
  const groups = geo.groups.length ? geo.groups : [{ start: 0, count: Infinity, materialIndex: 0 }];
  const groupOf = (t) => { for (const g of groups) if (t * 3 >= g.start && t * 3 < g.start + g.count) return g.materialIndex; return 0; };
  const buckets = new Map();
  for (let t = 0; t < triCount; t++) {
    const l = labelOf(t);
    if (!buckets.has(l)) buckets.set(l, []);
    buckets.get(l).push(t);
  }
  const make = (tris) => {
    tris.sort((a, b) => groupOf(a) - groupOf(b));
    const out = new THREE.BufferGeometry();
    for (const name of Object.keys(src.attributes)) {
      const a = src.attributes[name];
      const arr = new a.array.constructor(tris.length * 3 * a.itemSize);
      tris.forEach((t, i) => {
        for (let k = 0; k < 3; k++) for (let c = 0; c < a.itemSize; c++)
          arr[(i * 3 + k) * a.itemSize + c] = a.array[(t * 3 + k) * a.itemSize + c];
      });
      out.setAttribute(name, new THREE.BufferAttribute(arr, a.itemSize, a.normalized));
    }
    if (geo.groups.length) {
      let start = 0;
      while (start < tris.length) {
        const mi = groupOf(tris[start]);
        let end = start;
        while (end < tris.length && groupOf(tris[end]) === mi) end++;
        out.addGroup(start * 3, (end - start) * 3, mi);
        start = end;
      }
    }
    return out;
  };
  const parts = [];
  for (let i = 0; i < count; i++) parts.push(buckets.has(i) ? make(buckets.get(i)) : null);
  return { kept: make(buckets.get(-1) || []), parts };
}

// ---------------------------------------------------------------------------
// Logo decals on both sides of the bodywork (for models whose body texture is
// shared or tiled, so a logo can't be painted into it). spec: { url, material,
// width (m), z (m, + = rear), y (m above the ground) }.
let logoTex = null;
async function addSideLogos(holder, spec) {
  logoTex ??= new THREE.TextureLoader().loadAsync(spec.url).then((t) => { t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t; });
  const tex = await logoTex;
  holder.updateMatrixWorld(true);
  const targets = [];
  holder.traverse((o) => { if (o.isMesh && [].concat(o.material).some(m => m?.name === spec.material)) targets.push(o); });
  if (!targets.length) return;
  const ray = new THREE.Raycaster();
  const ground = -KART.cgHeight;
  const w = spec.width, h = w * tex.image.height / tex.image.width;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.45, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4 });
  for (const side of [1, -1]) {
    ray.set(new THREE.Vector3(side * 2, ground + spec.y, spec.z), new THREE.Vector3(-side, 0, 0));
    const hit = ray.intersectObjects(targets, false)[0];
    if (!hit) continue;
    const n = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (Math.abs(n.x) < 0.3) n.set(side, 0, 0);
    const helper = new THREE.Object3D();
    helper.position.copy(hit.point);
    helper.lookAt(hit.point.clone().add(n));
    // keep the logo upright and reading forwards on both sides
    helper.up.set(0, 1, 0);
    helper.lookAt(hit.point.clone().add(n));
    const geo = new DecalGeometry(hit.object, hit.point, helper.rotation, new THREE.Vector3(w, h, 0.1));
    // DecalGeometry works in world space; bring it into the holder's frame
    geo.applyMatrix4(new THREE.Matrix4().copy(holder.matrixWorld).invert());
    const decal = new THREE.Mesh(geo, mat);
    decal.receiveShadow = true;
    decal.name = 'sideLogo';
    holder.add(decal);
  }
}

// ---------------------------------------------------------------------------
// Race-number plates: a white plate with the driver's number, as decals on
// the nose and/or both side pods. spec: { materials (bodywork to stick to),
// front: { y, width }, side: { z, y, width }, plates: [{ from: [x, y, z],
// dir: [x, y, z], width, materials, normal }] } in metres (y above the ground, z + =
// rear); plates are any others, e.g. over a model's own printed number
// (normal: project along this instead of the surface's, for a creased panel).
// Returns setNumber(text).
function numberPlate(text) {
  const c = document.createElement('canvas');
  c.width = 256; c.height = 192;
  const g = c.getContext('2d');
  g.clearRect(0, 0, 256, 192);
  if (text) {
    g.fillStyle = '#f7f7f5';
    g.beginPath(); g.roundRect(6, 6, 244, 180, 26); g.fill();
    g.lineWidth = 6; g.strokeStyle = '#141414'; g.stroke();
    g.fillStyle = '#141414';
    g.textAlign = 'center'; g.textBaseline = 'middle';
    const size = text.length > 2 ? 118 : 150;
    g.font = `italic 900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
    g.fillText(text, 128, 100, 220);
  }
  return c;
}

function addNumbers(holder, spec) {
  const canvas = numberPlate('');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 8;
  const mat = new THREE.MeshStandardMaterial({ map: tex, transparent: true, roughness: 0.4, depthWrite: false,
    polygonOffset: true, polygonOffsetFactor: -4 });
  holder.updateMatrixWorld(true);
  const meshesOf = (names) => {
    const want = new Set(names || []), out = [];
    holder.traverse((o) => { if (o.isMesh && o.name !== 'sideLogo' && o.name !== 'numberPlate' && [].concat(o.material).some(m => want.has(m?.name))) out.push(o); });
    return out;
  };
  const targets = meshesOf(spec.materials);
  const ray = new THREE.Raycaster();
  const ground = -KART.cgHeight;
  const shots = [];
  if (spec.front) shots.push({ from: new THREE.Vector3(spec.front.x ?? 0, ground + spec.front.y, -3), dir: new THREE.Vector3(0, 0, 1), w: spec.front.width ?? 0.16 });
  if (spec.side) for (const side of [1, -1]) {
    shots.push({ from: new THREE.Vector3(side * 3, ground + spec.side.y, spec.side.z), dir: new THREE.Vector3(-side, 0, 0), w: spec.side.width ?? 0.16 });
  }
  for (const p of spec.plates || []) {
    shots.push({ from: new THREE.Vector3(p.from[0], ground + p.from[1], p.from[2]), dir: new THREE.Vector3(...p.dir).normalize(), w: p.width ?? 0.16,
      targets: p.materials ? meshesOf(p.materials) : null, normal: p.normal ? new THREE.Vector3(...p.normal).normalize() : null });
  }
  const decals = [];
  for (const s of shots) {
    ray.set(s.from, s.dir);
    const hit = ray.intersectObjects(s.targets || targets, false)[0];
    if (!hit) continue;
    const n = s.normal ? s.normal.clone() : hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
    if (n.dot(s.dir) > -0.2) n.copy(s.dir).negate();
    const helper = new THREE.Object3D();
    helper.position.copy(hit.point);
    // upright on a side or end; on a flat-lying panel, reading from the front
    // (the top of the number towards the driver)
    if (Math.abs(n.y) > 0.8) helper.up.set(0, 0, 1); else helper.up.set(0, 1, 0);
    helper.lookAt(hit.point.clone().add(n));
    // onto every piece of bodywork under the plate (a panel can be split in two)
    const size = new THREE.Vector3(s.w, s.w * 0.75, 0.12);
    const reach = new THREE.Sphere(hit.point, s.w);
    for (const mesh of s.targets || targets) {
      if (!mesh.geometry.boundingSphere) mesh.geometry.computeBoundingSphere();
      if (!reach.intersectsSphere(mesh.geometry.boundingSphere.clone().applyMatrix4(mesh.matrixWorld))) continue;
      const geo = new DecalGeometry(mesh, hit.point, helper.rotation, size);
      if (!geo.attributes.position?.count) continue;
      geo.applyMatrix4(new THREE.Matrix4().copy(holder.matrixWorld).invert());
      const decal = new THREE.Mesh(geo, mat);
      decal.receiveShadow = true;
      decal.name = 'numberPlate';
      decal.visible = false;
      holder.add(decal);
      decals.push(decal);
    }
  }
  let shown = null;
  return (text) => {
    text = String(text ?? '').trim().slice(0, 3);
    if (text === shown) return;
    shown = text;
    const fresh = numberPlate(text);
    canvas.getContext('2d').clearRect(0, 0, canvas.width, canvas.height);
    canvas.getContext('2d').drawImage(fresh, 0, 0);
    tex.needsUpdate = true;
    for (const d of decals) d.visible = !!text;
  };
}

// Number squares printed in a texture: the texture is redrawn with the
// driver's number inside each square, exactly where the model's own number
// was. spec: [{ materials, boxes: [[x0, y0, x1, y1], ...] (pixels of their
// map), bg, fg, italic }]. Returns setNumber(text).
function addNumberBoxes(holder, spec) {
  const jobs = [];
  for (const group of spec) {
    const mats = new Set();
    holder.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (group.materials.includes(m?.name) && m.map?.image) mats.add(m); });
    // one redrawn copy per texture (materials can share one)
    const byTex = new Map();
    for (const m of mats) { if (!byTex.has(m.map)) byTex.set(m.map, []); byTex.get(m.map).push(m); }
    for (const [orig, users] of byTex) {
      const img = orig.image;
      const canvas = document.createElement('canvas');
      canvas.width = img.width; canvas.height = img.height;
      const tex = new THREE.CanvasTexture(canvas);
      for (const k of ['flipY', 'wrapS', 'wrapT', 'colorSpace', 'anisotropy', 'magFilter', 'minFilter', 'channel']) tex[k] = orig[k];
      tex.offset.copy(orig.offset); tex.repeat.copy(orig.repeat); tex.rotation = orig.rotation; tex.center.copy(orig.center);
      for (const m of users) { m.map = tex; m.needsUpdate = true; }
      jobs.push({ img, canvas, tex, group });
    }
  }
  return (text) => {
    text = String(text ?? '').trim().slice(0, 3);
    for (const { img, canvas, tex, group } of jobs) {
      const g = canvas.getContext('2d');
      g.drawImage(img, 0, 0);
      if (text) for (const [x0, y0, x1, y1, rot = 0] of group.boxes) {
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1;
        g.fillStyle = group.bg || '#ffffff';
        g.fillRect(x0, y0, bw, bh);
        g.fillStyle = group.fg || '#141414';
        g.textAlign = 'center'; g.textBaseline = 'middle';
        // (a box's fifth number turns the text: 90 reads top to bottom, -90 bottom to top)
        const side = Math.abs(rot) === 90;
        const w = side ? bh : bw, h = side ? bw : bh;
        // as big as fits: 78% of the height, narrower for three digits
        let size = h * 0.78;
        g.font = `${group.italic ? 'italic ' : ''}900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`;
        const tw = g.measureText(text).width;
        if (tw > w * 0.86) { size *= (w * 0.86) / tw; g.font = `${group.italic ? 'italic ' : ''}900 ${size}px "Arial Black", "Helvetica Neue", Arial, sans-serif`; }
        g.save();
        g.translate(x0 + bw / 2, y0 + bh / 2);
        g.rotate(rot * Math.PI / 180);
        g.fillText(text, 0, size * 0.04);
        g.restore();
      }
      tex.needsUpdate = true;
    }
  };
}

// The kart's finish in the world: the sky in every surface's reflections, and
// its moulded bodywork glossy, as real kart plastic is (light-coloured, not
// metal; the tyres and dark parts stay as modelled). Paint finishes chosen in
// the garage (paint.js) still override the bodywork's.
export function finishKart(object, envMap) {
  object.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of [].concat(o.material)) {
      if (!m?.isMeshStandardMaterial) continue;
      m.envMap = envMap;
      m.envMapIntensity = 0.9;
      const lum = 0.2126 * m.color.r + 0.7152 * m.color.g + 0.0722 * m.color.b;
      if (lum > 0.12 && m.metalness < 0.5 && !m.transparent) m.roughness = Math.min(m.roughness, 0.42);
      m.needsUpdate = true;
    }
  });
}
