// The picture's finish: the scene is drawn into a high-range image (light
// brighter than white kept), with its depth. Corners and crevices darken
// where little sky light can reach (ambient occlusion: where a wall meets the
// ground, under and round the karts, between trees), worked out from the
// depth at half size. Then bright highlights bloom (the sun, chrome,
// wet tarmac, glowing things spill a soft glow round them, as through a real
// lens), the light is tone-mapped like film (ACES, at the scene's exposure),
// graded a touch warmer and richer, and the corners darken a little. The
// bloom is a chain of half-size images blurred down and back up.

import * as THREE from 'three';

const TRI = new THREE.BufferGeometry();
TRI.setAttribute('position', new THREE.Float32BufferAttribute([-1, -1, 0, 3, -1, 0, -1, 3, 0], 3));
TRI.setAttribute('uv', new THREE.Float32BufferAttribute([0, 0, 2, 0, 0, 2], 2));
const VS = 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }';

// downsample with a 13-tap filter (smooth, no flicker), the first pass keeping only the bright parts
const DOWN = /* glsl */`
uniform sampler2D tIn; uniform vec2 uTexel; uniform float uFirst, uThreshold, uExposure;
varying vec2 vUv;
vec3 s(vec2 o) { return texture2D(tIn, vUv + o * uTexel).rgb; }
void main() {
  vec3 c = s(vec2(0.0)) * 0.125;
  c += (s(vec2(-1.0, -1.0)) + s(vec2(1.0, -1.0)) + s(vec2(-1.0, 1.0)) + s(vec2(1.0, 1.0))) * 0.125;
  c += (s(vec2(-2.0, -2.0)) + s(vec2(2.0, -2.0)) + s(vec2(-2.0, 2.0)) + s(vec2(2.0, 2.0))) * 0.03125;
  c += (s(vec2(-2.0, 0.0)) + s(vec2(2.0, 0.0)) + s(vec2(0.0, -2.0)) + s(vec2(0.0, 2.0))) * 0.0625;
  if (uFirst > 0.5) {
    c *= uExposure;
    float l = max(c.r, max(c.g, c.b));
    c *= max(0.0, l - uThreshold) / max(l, 1e-4);          // only what's brighter than the threshold
    c = min(c, vec3(40.0));
  }
  gl_FragColor = vec4(c, 1.0);
}`;
// upsample with a tent filter, added onto the next size up
const UP = /* glsl */`
uniform sampler2D tIn; uniform vec2 uTexel; uniform float uRadius;
varying vec2 vUv;
void main() {
  vec2 d = uTexel * uRadius;
  vec3 c = texture2D(tIn, vUv).rgb * 4.0;
  c += (texture2D(tIn, vUv + vec2(d.x, 0.0)).rgb + texture2D(tIn, vUv - vec2(d.x, 0.0)).rgb + texture2D(tIn, vUv + vec2(0.0, d.y)).rgb + texture2D(tIn, vUv - vec2(0.0, d.y)).rgb) * 2.0;
  c += texture2D(tIn, vUv + d).rgb + texture2D(tIn, vUv - d).rgb + texture2D(tIn, vUv + vec2(d.x, -d.y)).rgb + texture2D(tIn, vUv + vec2(-d.x, d.y)).rgb;
  gl_FragColor = vec4(c / 16.0, 1.0);
}`;
// ambient occlusion: for each pixel, points round it in the half-sphere
// above its surface; the more of them are inside something, the darker
const AO = /* glsl */`
uniform sampler2D tDepth; uniform mat4 uProj, uInvProj; uniform vec2 uTexel; uniform float uRadius;
varying vec2 vUv;
vec3 viewAt(vec2 uv) {
  float d = texture2D(tDepth, uv).r;
  vec4 p = uInvProj * vec4(uv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);
  return p.xyz / p.w;
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  float d = texture2D(tDepth, vUv).r;
  if (d >= 0.99999) { gl_FragColor = vec4(1.0); return; }          // the sky
  vec3 P = viewAt(vUv);
  vec3 N = normalize(cross(viewAt(vUv + vec2(uTexel.x, 0.0)) - P, viewAt(vUv + vec2(0.0, uTexel.y)) - P));
  if (dot(N, P) > 0.0) N = -N;
  // nearer things get a smaller radius on screen; far away (past ~80 m) none at all
  float fade = 1.0 - smoothstep(40.0, 80.0, -P.z);
  if (fade <= 0.0) { gl_FragColor = vec4(1.0); return; }
  float a0 = hash(gl_FragCoord.xy) * 6.2831853, occ = 0.0;
  vec3 T = normalize(abs(N.y) < 0.9 ? cross(N, vec3(0.0, 1.0, 0.0)) : cross(N, vec3(1.0, 0.0, 0.0))), B = cross(N, T);
  const int K = 12;
  for (int i = 0; i < K; i++) {
    float fi = float(i), r = uRadius * (0.25 + 0.75 * fract(fi * 0.618 + hash(gl_FragCoord.xy + fi)));
    float a = a0 + fi * 2.3999632, h = 0.15 + 0.85 * fract(fi * 0.381966);
    vec3 S = P + (T * cos(a) * sqrt(1.0 - h * h) + B * sin(a) * sqrt(1.0 - h * h) + N * h) * r;
    vec4 c = uProj * vec4(S, 1.0);
    vec2 uv = c.xy / c.w * 0.5 + 0.5;
    if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) continue;
    float sz = viewAt(uv).z;
    float range = smoothstep(0.0, 1.0, uRadius / max(abs(P.z - sz), 1e-3));
    occ += step(S.z + 0.02, sz) * range;
  }
  float ao = 1.0 - occ / float(K) * fade;
  gl_FragColor = vec4(vec3(ao), 1.0);
}`;

// the scene and its bloom, tone-mapped, graded, to the screen
const FINAL = /* glsl */`
uniform sampler2D tScene, tBloom, tAO; uniform float uExposure, uBloom, uVignette, uSat, uTime, uAO, uContrast; uniform vec2 uRes, uAOTexel;
varying vec2 vUv;
vec3 filmFit(vec3 v) { vec3 a = v * (v + 0.0245786) - 0.000090537; vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081; return a / b; }
vec3 filmTone(vec3 c) {
  const mat3 I = mat3(vec3(0.59719, 0.07600, 0.02840), vec3(0.35458, 0.90834, 0.13383), vec3(0.04823, 0.01566, 0.83777));
  const mat3 O = mat3(vec3(1.60475, -0.10208, -0.00327), vec3(-0.53108, 1.10813, -0.07276), vec3(-0.07367, -0.00605, 1.07602));
  return clamp(O * filmFit(I * (c / 0.6)), 0.0, 1.0);
}
vec3 toSRGB(vec3 c) { return mix(pow(c, vec3(1.0 / 2.4)) * 1.055 - 0.055, c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308)))); }
void main() {
  vec3 c = texture2D(tScene, vUv).rgb * uExposure;
  // the occlusion, softened over its neighbours
  float ao = 0.0;
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) ao += texture2D(tAO, vUv + vec2(float(i), float(j)) * uAOTexel * 1.5).r;
  c *= mix(1.0, ao / 9.0, uAO);
  c += texture2D(tBloom, vUv).rgb * uBloom;
  c = filmTone(c);
  // grade: an S-curve for contrast, colour a little richer but the grass less
  // neon, warmth in the light and cool in the shade
  c = mix(c, c * c * (3.0 - 2.0 * c), uContrast);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  float green = clamp((c.g - max(c.r, c.b)) * 4.0, 0.0, 1.0);
  c = mix(c, mix(vec3(l), c, 0.78) * vec3(1.02, 0.97, 0.9), green * 0.6);
  c *= mix(vec3(0.995, 0.995, 1.005), vec3(1.04, 1.0, 0.95), smoothstep(0.12, 0.65, l));
  // the corners a little darker, as through a lens
  vec2 q = vUv - 0.5; q.x *= uRes.x / uRes.y;
  c *= 1.0 - uVignette * smoothstep(0.35, 1.05, length(q));
  c = toSRGB(clamp(c, 0.0, 1.0));
  // a whisper of noise against banding in the sky
  c += (fract(sin(dot(gl_FragCoord.xy + uTime, vec2(12.9898, 78.233))) * 43758.5453) - 0.5) / 255.0;
  gl_FragColor = vec4(c, 1.0);
}`;

export class Post {
  constructor(renderer) {
    this.r = renderer;
    this.on = true;
    this.bloomOn = true;
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    this.quad = new THREE.Mesh(TRI);
    this.quad.frustumCulled = false;
    this.scene = new THREE.Scene();
    this.scene.add(this.quad);
    const mk = (fs, u) => new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: fs, uniforms: u, depthTest: false, depthWrite: false });
    this.down = mk(DOWN, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() }, uFirst: { value: 0 }, uThreshold: { value: 1.0 }, uExposure: { value: 1 } });
    this.up = mk(UP, { tIn: { value: null }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 1 } });
    this.up.blending = THREE.AdditiveBlending; this.up.transparent = true;
    this.final = mk(FINAL, { tScene: { value: null }, tBloom: { value: null }, tAO: { value: null }, uExposure: { value: 1 }, uBloom: { value: 0.14 },
      uVignette: { value: 0.3 }, uSat: { value: 1.1 }, uTime: { value: 0 }, uRes: { value: new THREE.Vector2(1, 1) },
      uAO: { value: 0.85 }, uAOTexel: { value: new THREE.Vector2() }, uContrast: { value: 0.35 } });
    this.ao = mk(AO, { tDepth: { value: null }, uProj: { value: new THREE.Matrix4() }, uInvProj: { value: new THREE.Matrix4() }, uTexel: { value: new THREE.Vector2() }, uRadius: { value: 0.7 } });
    this.aoOn = true;
    this.white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1); this.white.needsUpdate = true;
    this.target = null; this.mips = [];
    this.samples = 4; this.levels = 5;
  }

  // quality: 'high' (4x smoothing, full bloom) | 'medium' (2x, a smaller bloom) | 'low' (off: drawn straight to the screen)
  setQuality(q) {
    this.on = q !== 'low';
    this.samples = q === 'high' ? 4 : 2;
    this.aoOn = q === 'high';
    this.levels = q === 'high' ? 5 : 4;
    this.dispose();
  }

  dispose() { this.target?.dispose(); this.aoTarget?.dispose(); for (const m of this.mips) m.dispose(); this.target = null; this.aoTarget = null; this.mips = []; }

  ensure() {
    const s = this.r.getDrawingBufferSize(new THREE.Vector2());
    if (this.target && this.target.width === s.x && this.target.height === s.y) return s;
    this.dispose();
    const opt = { type: THREE.HalfFloatType, colorSpace: THREE.LinearSRGBColorSpace, depthBuffer: false };
    this.target = new THREE.WebGLRenderTarget(s.x, s.y, { type: THREE.HalfFloatType, samples: this.samples });
    this.target.depthTexture = new THREE.DepthTexture(s.x, s.y, THREE.FloatType);
    this.aoTarget = new THREE.WebGLRenderTarget(Math.max(1, s.x >> 1), Math.max(1, s.y >> 1), opt);
    this.aoTarget.texture.minFilter = this.aoTarget.texture.magFilter = THREE.LinearFilter;
    let w = s.x, h = s.y;
    for (let i = 0; i < this.levels; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      const t = new THREE.WebGLRenderTarget(w, h, opt);
      t.texture.minFilter = t.texture.magFilter = THREE.LinearFilter;
      this.mips.push(t);
    }
    return s;
  }

  pass(mat, target) {
    this.quad.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.scene, this.cam);
  }

  render(scene, camera, time = 0) {
    if (!this.on) { this.r.render(scene, camera); return; }
    const s = this.ensure();
    const r = this.r, auto = r.autoClear;
    r.setRenderTarget(this.target);
    r.render(scene, camera);
    const exposure = r.toneMappingExposure;
    // bloom: down the chain from the scene, then back up, adding as it goes
    let src = this.target.texture, sw = s.x, sh = s.y;
    for (let i = 0; i < this.mips.length; i++) {
      const u = this.down.uniforms;
      u.tIn.value = src; u.uTexel.value.set(1 / sw, 1 / sh); u.uFirst.value = i === 0 ? 1 : 0; u.uExposure.value = exposure;
      this.pass(this.down, this.mips[i]);
      src = this.mips[i].texture; sw = this.mips[i].width; sh = this.mips[i].height;
    }
    r.autoClear = false;
    for (let i = this.mips.length - 1; i > 0; i--) {
      const u = this.up.uniforms, from = this.mips[i];
      u.tIn.value = from.texture; u.uTexel.value.set(1 / from.width, 1 / from.height); u.uRadius.value = 1;
      this.pass(this.up, this.mips[i - 1]);
    }
    r.autoClear = auto;
    // ambient occlusion from the depth (High only)
    if (this.aoOn) {
      const a = this.ao.uniforms;
      a.tDepth.value = this.target.depthTexture;
      a.uProj.value.copy(camera.projectionMatrix); a.uInvProj.value.copy(camera.projectionMatrixInverse);
      a.uTexel.value.set(1 / this.aoTarget.width, 1 / this.aoTarget.height);
      this.pass(this.ao, this.aoTarget);
    }
    const f = this.final.uniforms;
    f.tAO.value = this.aoOn ? this.aoTarget.texture : this.white;
    f.uAOTexel.value.set(1 / this.aoTarget.width, 1 / this.aoTarget.height);
    f.tScene.value = this.target.texture; f.tBloom.value = this.mips[0].texture;
    f.uExposure.value = exposure; f.uTime.value = time % 1000; f.uRes.value.set(s.x, s.y);
    this.pass(this.final, null);
  }
}
