// Rain: fine tapered streaks falling round the camera, leaning towards you as
// you drive into them (worked out on the graphics card, so thousands cost
// little), sheets of rain moving across the distance, and small splashes on
// the ground nearby: a ring and a little crown where each drop lands.

import * as THREE from 'three';

const STREAKS = 5000, SPLASHES = 420;
const BOX = 'vec3(44.0, 26.0, 44.0)';      // m: the box of rain that travels with the camera
const LIFE = 0.26;                         // s: a splash
const RADIUS = 20;                         // m: splashes this far from the camera

const STREAK_V = /* glsl */`
attribute vec4 iSeed;
uniform float uTime; uniform vec3 uCamVel, uWind;
varying vec2 vUv; varying float vA;
void main() {
  vUv = uv;
  vec3 B = ${BOX};
  float fall = 8.0 + iSeed.w * 4.0;
  vec3 vel = vec3(uWind.x, -fall, uWind.z);
  vec3 rel = mod(iSeed.xyz * B + vel * uTime - cameraPosition, B) - B * 0.5;
  vec3 world = cameraPosition + rel;
  // stretched along the way it moves as you see it: your own speed leans it towards you
  vec3 rv = vel - uCamVel; float s = length(rv); vec3 axis = rv / s;
  float d = length(rel);
  float len = clamp(s * 0.03, 0.3, 1.5) * (0.7 + iSeed.w * 0.6);
  vec3 side = normalize(cross(axis, -rel / max(d, 0.01)));
  float w = mix(0.005, 0.013, iSeed.w) * (1.0 + d * 0.07);        // (never thinner than a pixel, far off)
  world += axis * position.y * len + side * position.x * w;
  vA = smoothstep(0.5, 2.0, d) * (1.0 - smoothstep(15.0, 23.0, d)) * (0.55 + iSeed.w * 0.45);
  gl_Position = projectionMatrix * viewMatrix * vec4(world, 1.0);
}`;
const STREAK_F = /* glsl */`
uniform vec3 uCol; uniform float uA;
varying vec2 vUv; varying float vA;
void main() {
  float x = abs(vUv.x - 0.5) * 2.0;
  float a = (1.0 - x * x) * pow(sin(vUv.y * 3.14159), 0.8) * vA * uA;   // thin, fading at both ends
  if (a < 0.002) discard;
  gl_FragColor = vec4(uCol, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const SHEET_V = /* glsl */`
varying vec2 vUv;
void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`;
const SHEET_F = /* glsl */`
uniform float uTime, uA; uniform vec3 uCol;
varying vec2 vUv;
float h(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float n(vec2 p) { vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(h(i), h(i + vec2(1, 0)), f.x), mix(h(i + vec2(0, 1)), h(i + vec2(1, 1)), f.x), f.y); }
void main() {
  // broad sheets drifting round, fine vertical streaks falling through them
  float sheets = smoothstep(0.3, 0.8, n(vec2(vUv.x * 11.0 + uTime * 0.05, uTime * 0.04)) * 0.65 + n(vec2(vUv.x * 29.0 - uTime * 0.03, 3.0)) * 0.35);
  float fine = n(vec2(vUv.x * 420.0, vUv.y * 5.0 + uTime * 2.2));
  float a = uA * (0.45 + 0.85 * sheets) * (0.8 + 0.3 * fine) * smoothstep(0.0, 0.04, vUv.y) * (1.0 - smoothstep(0.35, 1.0, vUv.y));
  gl_FragColor = vec4(uCol, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const RING_V = /* glsl */`
attribute vec4 iS;   // x, y, z, born
uniform float uClock;
varying vec2 vUv; varying float vT;
void main() {
  vUv = uv; vT = clamp((uClock - iS.w) / ${LIFE.toFixed(2)}, 0.0, 1.0);
  vec3 p = iS.xyz + vec3(position.x, 0.0, position.y) * mix(0.03, 0.2, sqrt(vT));
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const RING_F = /* glsl */`
uniform vec3 uCol; uniform float uA;
varying vec2 vUv; varying float vT;
void main() {
  float d = length(vUv - 0.5) * 2.0;
  float a = smoothstep(0.2, 0.0, abs(d - 0.75)) * pow(1.0 - vT, 1.5) * uA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uCol, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;
const CROWN_V = /* glsl */`
attribute vec4 iS;
uniform float uClock;
varying vec2 vUv; varying float vT;
void main() {
  vUv = uv; vT = clamp((uClock - iS.w) / ${LIFE.toFixed(2)}, 0.0, 1.0);
  // upright, turned to face the camera; leaps and falls back
  vec3 to = cameraPosition - iS.xyz; to.y = 0.0;
  vec3 right = normalize(vec3(to.z, 0.0, -to.x));
  float h = 0.06 * sin(3.14159 * pow(vT, 0.7)) + 0.001;
  vec3 p = iS.xyz + right * position.x * mix(0.025, 0.07, vT) + vec3(0.0, (position.y + 0.5) * h, 0.0);
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;
const CROWN_F = /* glsl */`
uniform vec3 uCol; uniform float uA;
varying vec2 vUv; varying float vT;
void main() {
  // a thin V of water, thinning towards the tips
  float x = abs(vUv.x - 0.5) * 2.0, c = abs(x - vUv.y * 0.85);
  float a = smoothstep(0.2, 0.02, c) * (1.0 - vUv.y * 0.6) * (1.0 - vT) * uA;
  if (a < 0.003) discard;
  gl_FragColor = vec4(uCol, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const quad = () => new THREE.InstancedBufferGeometry().copy(new THREE.PlaneGeometry(1, 1));
const mat = (vertexShader, fragmentShader, uniforms, extra = {}) => new THREE.ShaderMaterial({ vertexShader, fragmentShader, uniforms, transparent: true, depthWrite: false, ...extra });

export function buildRain(groundAt) {
  const mesh = new THREE.Group();
  mesh.name = 'rain';
  mesh.visible = false;
  const col = { value: new THREE.Color(1, 1, 1) }, camVel = { value: new THREE.Vector3() }, time = { value: 0 }, clock = { value: 0 };
  // streaks
  const sg = quad();
  const seeds = new Float32Array(STREAKS * 4);
  for (let i = 0; i < seeds.length; i++) seeds[i] = Math.random();
  sg.setAttribute('iSeed', new THREE.InstancedBufferAttribute(seeds, 4));
  sg.instanceCount = STREAKS;
  const streakA = { value: 0.3 };
  const streaks = new THREE.Mesh(sg, mat(STREAK_V, STREAK_F, { uTime: time, uCamVel: camVel, uWind: { value: new THREE.Vector3(0.9, 0, 0.35) }, uCol: col, uA: streakA }));
  streaks.frustumCulled = false; streaks.renderOrder = 6;
  mesh.add(streaks);
  // sheets of rain in the distance, one nearer and one further
  const sheetCol = { value: new THREE.Color() }, sheets = [];
  for (const [r, a] of [[85, 0.12], [170, 0.2]]) {
    const m = mat(SHEET_V, SHEET_F, { uTime: time, uCol: sheetCol, uA: { value: a } }, { side: THREE.BackSide });
    const c = new THREE.Mesh(new THREE.CylinderGeometry(r, r, 110, 48, 1, true), m);
    c.frustumCulled = false; c.renderOrder = 4; c.rotation.y = r;
    mesh.add(c); sheets.push(c);
  }
  // splashes
  const at = new Float32Array(SPLASHES * 4);
  const attr = new THREE.InstancedBufferAttribute(at, 4); attr.setUsage(THREE.DynamicDrawUsage);
  const splashA = { value: 0.3 };
  const pieces = [[RING_V, RING_F], [CROWN_V, CROWN_F]].map(([v, f]) => {
    const g = quad(); g.setAttribute('iS', attr); g.instanceCount = SPLASHES;
    const m = new THREE.Mesh(g, mat(v, f, { uClock: clock, uCol: col, uA: splashA }, { side: THREE.DoubleSide }));
    m.frustumCulled = false; m.renderOrder = 3;
    mesh.add(m);
    return m;
  });
  for (let i = 0; i < SPLASHES; i++) at[i * 4 + 3] = -Math.random() * LIFE;
  let last = null, lastT = 0;
  return {
    mesh,
    indoors: false,
    // drawn less on the lower graphics settings: 0..1
    setLevel(k) { sg.instanceCount = Math.round(STREAKS * (0.4 + 0.6 * k)); for (const p of pieces) { p.geometry.instanceCount = Math.round(SPLASHES * k); p.visible = k > 0.5; } },
    // lit like the scene
    setLook(night, fog) {
      col.value.set(night ? 0x8f9aa8 : 0xdde4ec);
      streakA.value = night ? 0.32 : 0.55;
      splashA.value = night ? 0.12 : 0.2;
      sheetCol.value.set(fog).lerp(new THREE.Color(night ? 0x20262e : 0xd4dae0), 0.5);
    },
    update(cam, t) {
      if (!mesh.visible) return;
      const dt = Math.min(0.1, Math.max(0.001, t - lastT)); lastT = t;
      time.value = t % 300;
      clock.value += dt;
      // the camera's speed, smoothed
      if (last) camVel.value.lerp(new THREE.Vector3((cam.x - last.x) / dt, (cam.y - last.y) / dt, (cam.z - last.z) / dt), Math.min(1, dt * 6));
      (last ||= cam.clone()).copy(cam);
      for (const s of sheets) s.position.set(cam.x, cam.y + 40, cam.z);
      // no rain indoors
      streaks.visible = !this.indoors;
      for (const p of pieces) p.visible = !this.indoors && p.geometry.instanceCount > 0 && p.geometry.instanceCount >= SPLASHES * 0.5;
      if (this.indoors) return;
      // drops landing round the camera, each one a fresh spot
      let moved = false;
      for (let i = 0; i < SPLASHES; i++) {
        if (clock.value - at[i * 4 + 3] < LIFE) continue;
        const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * RADIUS, x = cam.x + Math.cos(a) * r, z = cam.z + Math.sin(a) * r;
        at[i * 4] = x; at[i * 4 + 1] = groundAt(x, z) + 0.02; at[i * 4 + 2] = z; at[i * 4 + 3] = clock.value;
        moved = true;
      }
      if (moved) attr.needsUpdate = true;
    },
  };
}
