// Tyre smoke, exhaust, grass dust and skid marks.
//
// Smoke and dust are soft billboards drawn in one instanced mesh: each puff is
// born small at a tyre or the exhaust, drifts with the air the kart left
// behind, rises, spreads and fades. Tyre smoke comes from a tyre sliding on
// the pavement, the same slip that makes it squeal (audio.js), so you see
// what you hear; the kart's own exhaust leaves a faint wisp, thicker on the
// throttle. Sliding tyres also lay black rubber on the track: skid marks,
// darker the harder the slide, kept for the session (cleared when a new one starts).

import * as THREE from 'three';

const MAX = 1400;                    // puffs alive at once
const MARKS = 24000;                 // skid mark segments kept (the whole session: ~7 km of rubber)

// a soft, lumpy puff: overlapping blobs, brightest in the middle
function puffTexture() {
  const c = document.createElement('canvas'); c.width = c.height = 128;
  const g = c.getContext('2d');
  let s = 7;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < 26; i++) {
    const a = rnd() * Math.PI * 2, r = rnd() * 30, x = 64 + Math.cos(a) * r, y = 64 + Math.sin(a) * r, R = 18 + rnd() * 26;
    const gr = g.createRadialGradient(x, y, 0, x, y, R);
    gr.addColorStop(0, 'rgba(255,255,255,0.22)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.08)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace;
  return t;
}

const VERT = /* glsl */`
attribute vec3 iPos; attribute vec4 iP;  // size, alpha, spin, shade
attribute vec3 iCol;
varying vec2 vUv; varying float vA; varying vec3 vC;
#include <fog_pars_vertex>
void main() {
  vUv = uv; vA = iP.y; vC = iCol * iP.w;
  vec4 mv = modelViewMatrix * vec4(iPos, 1.0);
  float c = cos(iP.z), s = sin(iP.z);
  mv.xy += mat2(c, s, -s, c) * position.xy * iP.x;
  gl_Position = projectionMatrix * mv;
  vec4 mvPosition = mv;
  #include <fog_vertex>
}`;
const FRAG = /* glsl */`
uniform sampler2D uTex; uniform vec3 uLight;
varying vec2 vUv; varying float vA; varying vec3 vC;
#include <common>
#include <fog_pars_fragment>
void main() {
  float a = texture2D(uTex, vUv).r * vA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(vC * uLight, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

export class Effects {
  // groundAt(x, z): the ground's height
  constructor(scene, groundAt) {
    this.groundAt = groundAt;
    this.level = 1;                  // 0 off .. 1 full (from the graphics setting)
    // ---- puffs
    const geo = new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
    geo.instanceCount = 0;
    this.pos = new Float32Array(MAX * 3); this.par = new Float32Array(MAX * 4); this.col = new Float32Array(MAX * 3);
    for (const [name, arr, n] of [['iPos', this.pos, 3], ['iP', this.par, 4], ['iCol', this.col, 3]]) {
      const a = new THREE.InstancedBufferAttribute(arr, n); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(name, a);
    }
    this.mat = new THREE.ShaderMaterial({ vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false, fog: true,
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { uTex: { value: puffTexture() }, uLight: { value: new THREE.Color(1, 1, 1) } }]) });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 5;
    scene.add(this.mesh);
    // each puff: x y z, vx vy vz, age, life, size0, size1, alpha, spin, spinRate, r g b, rise
    this.P = new Float32Array(MAX * 16);
    this.n = 0;
    // ---- skid marks: quads laid flat on the track
    const mg = new THREE.BufferGeometry();
    this.mPos = new Float32Array(MARKS * 4 * 3); this.mCol = new Float32Array(MARKS * 4 * 4);
    const idx = new Uint32Array(MARKS * 6);
    for (let i = 0; i < MARKS; i++) idx.set([i * 4, i * 4 + 1, i * 4 + 2, i * 4 + 2, i * 4 + 1, i * 4 + 3], i * 6);
    mg.setAttribute('position', new THREE.BufferAttribute(this.mPos, 3).setUsage(THREE.DynamicDrawUsage));
    mg.setAttribute('color', new THREE.BufferAttribute(this.mCol, 4).setUsage(THREE.DynamicDrawUsage));
    mg.setIndex(new THREE.BufferAttribute(idx, 1));
    mg.setDrawRange(0, 0);
    // (two-sided: a segment's winding depends on which way the kart slides)
    this.marks = new THREE.Mesh(mg, new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 }));
    this.marks.frustumCulled = false;
    this.marks.renderOrder = 1;
    scene.add(this.marks);
    this.mNext = 0; this.mUsed = 0;
    this.trails = new Map();          // wheel key -> last mark point { x, y, z, sx, sz }
    this.acc = new Map();             // emitter key -> puffs owed
    this.light = new THREE.Color(1, 1, 1);
  }

  setLevel(l) { this.level = l; this.mesh.visible = this.marks.visible = l > 0; }

  // how lit the smoke is: the sun and sky's light (world.js), so it's grey at dusk and in rain
  setLight(c) { this.mat.uniforms.uLight.value.copy(c); }

  clear() { this.n = 0; this.mUsed = 0; this.mNext = 0; this.marks.geometry.setDrawRange(0, 0); this.trails.clear(); }

  puff(x, y, z, vx, vy, vz, o) {
    if (this.n >= MAX) return;
    const P = this.P, i = this.n++ * 16;
    P[i] = x; P[i + 1] = y; P[i + 2] = z; P[i + 3] = vx; P[i + 4] = vy; P[i + 5] = vz;
    P[i + 6] = 0; P[i + 7] = o.life * (0.8 + Math.random() * 0.4);
    P[i + 8] = o.size0; P[i + 9] = o.size1 * (0.8 + Math.random() * 0.4); P[i + 10] = o.alpha;
    P[i + 11] = Math.random() * 6.28; P[i + 12] = (Math.random() - 0.5) * 1.2;
    P[i + 13] = o.col[0]; P[i + 14] = o.col[1]; P[i + 15] = o.col[2];
  }

  // puffs owed to an emitter at `rate` a second over dt (fractional ones carried over)
  owed(key, rate, dt) {
    const a = (this.acc.get(key) || 0) + rate * dt * this.level;
    const n = Math.floor(a);
    this.acc.set(key, a - n);
    return n;
  }

  // a wheel's tyre: smoke (pavement) or dust (grass) and its skid mark.
  // key: the wheel; cp: where it touches [x, y, z]; slip 0..1 (as loud as the
  // squeal); v: the kart's velocity; side: the wheel's sideways direction
  // spin: 0, or how close the kart is to spinning out (0..1): only then does rubber go down
  tyre(key, cp, slip, surface, speed, v, dt, sx, sz, spin = 0) {
    if (this.level <= 0) return;
    if (surface === 'grass') {
      this.mark(key, null);
      const n = this.owed(key, speed > 2 ? Math.min(30, speed * 2.4) : 0, dt);
      for (let k = 0; k < n; k++) {
        const r = () => (Math.random() - 0.5);
        this.puff(cp[0] + r() * 0.15, cp[1] + 0.05, cp[2] + r() * 0.15, v.x * 0.35 + r() * 1.2, 0.4 + Math.random() * 0.8, v.z * 0.35 + r() * 1.2,
          { life: 1.4, size0: 0.15, size1: 0.9 + speed * 0.04, alpha: 0.32, col: [0.52, 0.45, 0.33] });
      }
      return;
    }
    if (slip < 0.04 && !spin) { this.mark(key, null); this.owed(key, 0, dt); return; }
    const n = this.owed(key, 4 * slip, dt);
    for (let k = 0; k < n; k++) {
      const r = () => (Math.random() - 0.5);
      this.puff(cp[0] + r() * 0.1, cp[1] + 0.06, cp[2] + r() * 0.1, v.x * 0.25 + r() * 0.8, 0.25 + Math.random() * 0.5, v.z * 0.25 + r() * 0.8,
        { life: 2.2, size0: 0.22, size1: 1.6 + slip * 1.6, alpha: 0.01 + 0.025 * slip, col: [0.86, 0.86, 0.88] });
    }
    // rubber only goes down when the kart's about to spin (main.js), darker the nearer it is
    if (spin > 0) this.mark(key, cp, spin, sx, sz);
    else this.mark(key, null);
  }

  // the exhaust: a faint wisp, thicker with the throttle
  exhaust(key, p, throttle, v, back, dt) {
    if (this.level <= 0) return;
    const n = this.owed(key, 2 + 5 * throttle, dt);
    for (let k = 0; k < n; k++) {
      const r = () => (Math.random() - 0.5) * 0.25;
      this.puff(p.x, p.y, p.z, v.x * 0.55 + back.x * 1.2 + r(), 0.25 + Math.random() * 0.25, v.z * 0.55 + back.z * 1.2 + r(),
        { life: 1.0 + throttle * 0.6, size0: 0.05, size1: 0.35 + throttle * 0.35, alpha: 0.012 + 0.02 * throttle, col: [0.72, 0.74, 0.78] });
    }
  }

  // a skid mark from this wheel's last point to cp (null: the mark ends)
  mark(key, cp, k = 0, sx = 1, sz = 0) {
    const last = this.trails.get(key);
    if (!cp) { if (last) this.trails.delete(key); return; }
    const y = cp[1] + 0.012;
    if (!last) { this.trails.set(key, { x: cp[0], y, z: cp[2], k }); return; }
    const dx = cp[0] - last.x, dz = cp[2] - last.z;
    if (dx * dx + dz * dz < 0.09) return;                        // a segment every 30 cm
    if (dx * dx + dz * dz > 9) { this.trails.set(key, { x: cp[0], y, z: cp[2], k }); return; }
    const w = 0.09, i = this.mNext, P = this.mPos, C = this.mCol;
    const ax = last.x + sx * w, az = last.z + sz * w, bx = last.x - sx * w, bz = last.z - sz * w;
    P.set([ax, last.y, az, bx, last.y, bz, cp[0] + sx * w, y, cp[2] + sz * w, cp[0] - sx * w, y, cp[2] - sz * w], i * 12);
    // (rubber on dark asphalt: dark and fairly solid even for a light slide, or it doesn't show)
    const a0 = 0.3 + 0.35 * last.k, a1 = 0.3 + 0.35 * k;
    C.set([0.025, 0.025, 0.028, a0, 0.025, 0.025, 0.028, a0, 0.025, 0.025, 0.028, a1, 0.025, 0.025, 0.028, a1], i * 16);
    this.mNext = (i + 1) % MARKS;
    this.mUsed = Math.min(MARKS, this.mUsed + 1);
    const g = this.marks.geometry;
    g.attributes.position.needsUpdate = true; g.attributes.color.needsUpdate = true;
    g.setDrawRange(0, this.mUsed * 6);
    this.trails.set(key, { x: cp[0], y, z: cp[2], k });
  }

  // each frame: the puffs move, rise, spread and fade
  update(dt) {
    const P = this.P;
    let j = 0;
    for (let i = 0; i < this.n; i++) {
      const o = i * 16;
      const age = P[o + 6] + dt, life = P[o + 7];
      if (age >= life) continue;
      if (j !== i) P.copyWithin(j * 16, o, o + 16);
      const q = j * 16;
      P[q + 6] = age;
      const drag = Math.exp(-2.2 * dt);
      P[q + 3] *= drag; P[q + 5] *= drag; P[q + 4] = P[q + 4] * drag + 0.35 * dt;    // slows, and rises as it warms
      P[q] += P[q + 3] * dt; P[q + 1] += P[q + 4] * dt; P[q + 2] += P[q + 5] * dt;
      P[q + 11] += P[q + 12] * dt;
      const t = age / life;
      this.pos.set([P[q], P[q + 1], P[q + 2]], j * 3);
      // grows fast then slowly; fades in quickly and out slowly
      const size = P[q + 8] + (P[q + 9] - P[q + 8]) * (1 - Math.pow(1 - t, 2.5));
      const alpha = P[q + 10] * Math.min(1, t * 8) * Math.pow(1 - t, 1.6);
      this.par.set([size, alpha, P[q + 11], 1 - 0.15 * t], j * 4);
      this.col.set([P[q + 13], P[q + 14], P[q + 15]], j * 3);
      j++;
    }
    this.n = j;
    const g = this.mesh.geometry;
    g.instanceCount = j;
    g.attributes.iPos.needsUpdate = true; g.attributes.iP.needsUpdate = true; g.attributes.iCol.needsUpdate = true;
  }
}
