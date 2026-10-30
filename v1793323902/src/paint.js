// Kart paint: recolours any kart model's bodywork. A model's coloured
// materials are its paint and its light grey / white plastics are its trim;
// the model's own shading between them (light and dark panels) is kept.
// A catalog entry can instead name its paint and trim materials outright
// (paintMaterials / trimMaterials): those take the chosen colour exactly,
// textured ones as a tint over their (white) texture. Or, for a livery
// painted into the texture, a mask (masks: [{ material, url, slot, ref }])
// picks out the panels to recolour; logos and numbers keep their colours and
// the texture's light and shade stay (scaled from ref, the masked area's
// typical linear luminance). A mask with refMap: true also carries a
// brightness of its own in green (ref * 2 * g^2), so dark and light panels
// both come out the chosen colour, keeping only their fine detail.

import * as THREE from 'three';

const maskTex = new Map();
const loadMask = (url) => {
  if (!maskTex.has(url)) {
    const t = new THREE.TextureLoader().load(url);
    t.colorSpace = THREE.NoColorSpace;
    t.flipY = false;                 // glTF textures aren't flipped; the mask must line up with them
    maskTex.set(url, t);
  }
  return maskTex.get(url);
};

// Liveries: designs in a second colour over the paint, edged with a fine
// pinstripe (black or white, whichever stands out), drawn in the kart's own
// space (left to right, bottom to top, nose to tail, each 0 to 1 over the
// painted bodywork) rather than in a texture, so the same design fits every
// model. Side-facing panels and top/front-facing ones each get their version.
export const LIVERIES = { none: 'None', factory: 'Factory stripes', retro: 'Retro band', speed: 'Speed lines',
  shark: 'Shark teeth', bolt: 'Lightning', chevron: 'Chevrons', wave: 'Wave', hex: 'Hex fade',
  chequer: 'Chequered fade', tiger: 'Tiger', flames: 'Flames', camo: 'Splinter camo', stars: 'Stars',
  argyle: 'Argyle', pinstripes: 'Pinstripes', splash: 'Paint splash' };
// the old designs' names, for karts saved with them
const OLD = { stripe: 'retro', twin: 'factory', split: 'wave', fade: 'hex', checker: 'chequer', sash: 'wave', arrow: 'chevron', slash: 'speed' };
// the shop's liveries (shop.js): bought with points, kept for good
export const SHOP_LIVERIES = { scales: 'Dragon scale', circuit: 'Circuit', galaxy: 'Galaxy', shatter: 'Shattered',
  topo: 'Topographic', zebra: 'Zebra', digital: 'Digital camo', inferno: 'Inferno' };
export const liveryKey = (k) => (LIVERIES[k] || SHOP_LIVERIES[k] ? k : OLD[k] ?? 'none');
const LIV_ID = Object.fromEntries(Object.keys({ ...LIVERIES, ...SHOP_LIVERIES }).map((k, i) => [k, i]));

const LIVERY_GLSL = `
uniform sampler2D uMask; uniform float uOn, uRef, uRefMap, uHasMask, uPat; uniform vec3 uCol, uCol2, uCol3, uDim;
varying vec3 vLivP; varying vec3 vLivN;
// inside a band of half-width w around d = 0 (smooth at the pixel scale)
float band(float d, float w) { float f = fwidth(d) + 1e-4; return 1.0 - smoothstep(w - f, w + f, d); }
// below an edge, and a pinstripe of width t along it
float below(float d) { float f = fwidth(d) + 1e-4; return 1.0 - smoothstep(-f, f, d); }
float pin(float d, float t) { return band(abs(d), t); }
float tri(float x) { return abs(fract(x) - 0.5) * 2.0; }
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x), mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x), f.y);
}
// a five-pointed star of radius R around the origin: inside < 0
float star5(vec2 q, float R) {
  float K = 6.2831853 / 5.0, a = atan(q.y, q.x) + 1.5708, r = length(q);
  float m = abs(mod(a, K) - K * 0.5);
  vec2 A = vec2(R, 0.0), B = 0.42 * R * vec2(cos(K * 0.5), sin(K * 0.5)), d = vec2(cos(K * 0.5 - m), sin(K * 0.5 - m)), e = B - A;
  return r - (A.x * e.y - A.y * e.x) / (d.x * e.y - d.y * e.x);
}
// (x: the design's colour; y: the pinstripe)
vec2 livery(vec3 P, vec3 N) {
  float side = step(0.55, abs(N.x));
  float u = P.z, cx = abs(P.x - 0.5), v = side > 0.5 ? P.y : 1.0 - cx * 2.0;
  int p = int(uPat + 0.5);
  float T = 0.006;                                    // pinstripe half-width
  // factory stripes: a broad stripe and a thin one, offset
  if (p == 1) {
    float a = side > 0.5 ? abs(P.y - 0.56) : abs(cx - 0.07);
    float b = side > 0.5 ? abs(P.y - 0.4) : abs(cx - 0.17);
    float wa = side > 0.5 ? 0.075 : 0.05, wb = side > 0.5 ? 0.022 : 0.016;
    return vec2(max(band(a, wa), band(b, wb)), max(pin(a - wa - 0.012, T), pin(b - wb - 0.01, T)));
  }
  // retro band: a wide band round the middle, two pinstripes either side
  if (p == 2) {
    float d = side > 0.5 ? abs(P.y - 0.5) : cx;
    float w = side > 0.5 ? 0.13 : 0.11;
    return vec2(band(d, w), max(pin(d - w - 0.02, T * 1.4), pin(d - w - 0.045, T)));
  }
  // speed lines: three lines tapering from the nose, the top one longest
  if (p == 3) {
    float k = 0.0, q = 0.0;
    for (int i = 0; i < 3; i++) {
      float fi = float(i);
      float c = side > 0.5 ? 0.36 + fi * 0.13 : 0.06 + fi * 0.09;
      float d = side > 0.5 ? abs(P.y - c) : abs(cx - c);
      float len = 0.55 + fi * 0.12, t = clamp(u / len, 0.0, 1.0);
      float w = (0.045 - fi * 0.008) * (1.0 - t) * step(0.04, u);
      k = max(k, band(d, w) * step(u, len));
      q = max(q, pin(d - w - 0.008, T) * step(u, len * 0.97) * step(0.04, u));
    }
    return vec2(k, q);
  }
  // shark teeth: a jagged lower half (sides) and a toothed nose (top)
  if (p == 4) {
    float e = side > 0.5 ? P.y - (0.34 + 0.13 * tri(u * 9.0 + 0.5)) : u - (0.24 + 0.08 * tri(P.x * 7.0));
    return vec2(below(e), pin(e - 0.008, T));
  }
  // lightning: a bolt zig-zagging nose to tail
  if (p == 5) {
    float z = fract(u * 2.2);
    float c = side > 0.5 ? 0.5 + (z < 0.6 ? -0.12 + z * 0.4 : 0.12 - (z - 0.6) * 0.6) : 0.12 * (z < 0.6 ? z / 0.6 : 1.0 - (z - 0.6) / 0.4);
    float d = side > 0.5 ? abs(P.y - c) : abs(cx - c);
    float w = 0.05 * (1.0 - 0.5 * u);
    return vec2(band(d, w) * step(0.05, u), pin(d - w - 0.01, T) * step(0.05, u));
  }
  // chevrons: arrows pointing forward, fading out to the back
  if (p == 6) {
    float t = u + (side > 0.5 ? abs(P.y - 0.5) * 0.9 : cx * 1.3);
    float s = abs(fract(t * 4.0) - 0.5);
    float w = 0.2 * (1.0 - smoothstep(0.35, 0.95, u));
    return vec2(band(s, w), pin(s - w - 0.03, T * 1.2) * step(0.02, w));
  }
  // wave: a band that swells and sweeps back along the kart
  if (p == 7) {
    float lo = (side > 0.5 ? 0.3 : 0.0) + 0.08 * sin(u * 7.0 + 0.5) + 0.12 * u;
    float hi = lo + 0.06 + 0.14 * u;
    float d = v - (lo + hi) * 0.5, w = (hi - lo) * 0.5;
    return vec2(band(d, w), max(pin(d - w - 0.015, T), pin(d + w + 0.015, T)));
  }
  // hex fade: a honeycomb filling in towards the back
  if (p == 8) {
    vec2 q = side > 0.5 ? vec2(u * uDim.z, P.y * uDim.y) : vec2(P.x * uDim.x, u * uDim.z);
    q /= 0.07;
    vec2 r = vec2(1.0, 1.732), h = r * 0.5;
    vec2 a = mod(q, r) - h, b = mod(q - h, r) - h;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    vec2 id = q - g;
    float edge = max(abs(g.x) * 0.866 + abs(g.y) * 0.5, abs(g.y));   // hexagon distance
    float fill = step(hash(id), smoothstep(0.15, 0.95, u) * 1.15 - 0.08);
    return vec2(fill * band(edge, 0.4), fill * pin(edge - 0.45, 0.03));
  }
  // chequered fade: flag squares thinning out towards the back
  if (p == 9) {
    vec2 q = side > 0.5 ? vec2(u * uDim.z, P.y * uDim.y) : vec2(P.x * uDim.x, u * uDim.z);
    vec2 c = floor(q / 0.075), f = fract(q / 0.075) - 0.5;
    float on = mod(c.x + c.y, 2.0) * step(hash(c) * 0.9, 1.0 - smoothstep(0.25, 0.9, u));
    return vec2(on * band(max(abs(f.x), abs(f.y)), 0.5), 0.0);
  }
  // tiger: tapering stripes up from the bottom (sides), across the top
  if (p == 10) {
    float s = abs(fract(u * 7.0 + 0.18 * sin(v * 9.0) + 0.3 * sin(u * 3.0)) - 0.5);
    float w = 0.22 * (1.0 - smoothstep(0.1, 0.85, v));
    return vec2(band(s, w), 0.0);
  }
  // flames: tongues licking back from the nose, outlined
  if (p == 11) {
    float y = side > 0.5 ? P.y : P.x;
    float e = u - (0.22 + 0.2 * pow(tri(y * 3.5 + 0.25), 3.0) + 0.06 * tri(y * 9.0));
    return vec2(below(e), pin(e - 0.012, T * 1.3));
  }
  // the kart's surface in metres, for patterns that shouldn't stretch
  vec2 m = side > 0.5 ? vec2(u * uDim.z, P.y * uDim.y) : vec2(P.x * uDim.x, u * uDim.z);
  // splinter camo: hard-edged shards on a slanted grid
  if (p == 12) {
    vec2 q = mat2(0.87, 0.5, -0.5, 0.87) * m * 5.0;
    vec2 c = floor(q), f = fract(q);
    float k = step(f.x + f.y * 0.6, 0.8) > 0.5 ? hash(c) : hash(c + 17.0);
    return vec2(step(0.55, k), 0.0);
  }
  // stars: scattered, thickest at the back
  if (p == 13) {
    vec2 q = m / 0.16, c = floor(q), f = fract(q) - 0.5;
    float on = step(hash(c + 3.0), 0.25 + 0.6 * smoothstep(0.2, 0.9, u));
    vec2 o = (vec2(hash(c + 7.0), hash(c + 11.0)) - 0.5) * 0.4;
    float R = 0.22 + 0.16 * hash(c + 5.0), d = star5(f - o, R);
    return vec2(on * below(d), on * pin(d - 0.045, 0.02));
  }
  // argyle: diamonds in the design colour, crossed by fine diagonal lines
  if (p == 14) {
    vec2 q = m / 0.13;
    float a = q.x + q.y, b = q.x - q.y;
    vec2 c = floor(vec2(a, b));
    float d = abs(fract(a) - 0.5) + abs(fract(b) - 0.5);
    float on = mod(c.x + c.y, 2.0) * step(0.15, u);
    float lines = max(pin(fract(a + 0.5) - 0.5, 0.035), pin(fract(b + 0.5) - 0.5, 0.035));
    return vec2(on * band(d, 0.48), lines * step(0.15, u));
  }
  // pinstripes: a run of fine lines sweeping back and up the sides, along the top
  if (p == 15) {
    float t = side > 0.5 ? P.y - (u - 0.2) * 0.35 : cx * 2.0;
    float k = 0.0;
    for (int i = 0; i < 5; i++) k = max(k, band(abs(t - 0.32 - float(i) * 0.06), 0.012 + 0.004 * float(i == 2)));
    return vec2(k * step(0.06, u), 0.0);
  }
  // paint splash: drips and blots, heavier towards the back
  if (p == 16) {
    float n = vnoise(m * 6.0) * 0.6 + vnoise(m * 13.0 + 4.0) * 0.3 + vnoise(m * 29.0 + 9.0) * 0.1;
    float e = n - (0.78 - 0.35 * smoothstep(0.1, 0.95, u));
    return vec2(1.0 - below(e), pin(e, 0.012));
  }
  // ---- the shop's liveries
  // dragon scale: overlapping scales, outlined, some filled
  if (p == 17) {
    vec2 q = m / 0.07;
    float row = floor(q.y), x = q.x + 0.5 * mod(row, 2.0);
    vec2 f = vec2(fract(x) - 0.5, fract(q.y)), c = vec2(floor(x), row);
    float d = length(vec2(f.x, f.y * 1.15));
    return vec2(band(d, 0.42) * step(0.55, hash(c)), pin(d - 0.47, 0.035));
  }
  // circuit: traces along a grid, pads where they meet
  if (p == 18) {
    vec2 q = m / 0.045, c = floor(q), f = fract(q);
    float k = max(band(abs(f.y - 0.5), 0.09) * step(0.55, hash(c)), band(abs(f.x - 0.5), 0.09) * step(0.6, hash(c + 3.0)));
    float pad = step(0.8, hash(c + 7.0)) * band(length(f - 0.5), 0.22);
    return vec2(max(k, pad), step(0.8, hash(c + 7.0)) * pin(length(f - 0.5) - 0.3, 0.05));
  }
  // galaxy: clouds of colour, pricked with stars
  if (p == 19) {
    float n = vnoise(m * 3.5) * 0.6 + vnoise(m * 8.0 + 3.0) * 0.3 + vnoise(m * 19.0) * 0.1;
    vec2 q = m / 0.018, c = floor(q);
    float star = step(0.965, hash(c)) * band(length(fract(q) - 0.5), 0.25);
    return vec2(smoothstep(0.5, 0.6, n), star);
  }
  // shattered: shards with cracks between them
  if (p == 20) {
    vec2 q = m / 0.11, c = floor(q);
    float d1 = 9.0, d2 = 9.0; vec2 id = vec2(0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = c + vec2(float(i), float(j)), o = g + vec2(hash(g), hash(g + 5.0));
      float d = length(q - o);
      if (d < d1) { d2 = d1; d1 = d; id = g; } else if (d < d2) d2 = d;
    }
    return vec2(step(0.5, hash(id + 9.0)), pin(d2 - d1, 0.06));
  }
  // topographic: contour lines, every fifth one bold
  if (p == 21) {
    float n = (vnoise(m * 2.5) * 0.7 + vnoise(m * 6.0 + 2.0) * 0.3) * 12.0;
    float d = abs(fract(n) - 0.5);
    float bold = step(4.5, mod(floor(n + 0.5), 5.0) + 0.5);
    return vec2(band(0.5 - d, 0.06) * (1.0 - bold), band(0.5 - d, 0.1) * bold);
  }
  // zebra: bold stripes that bend and fork
  if (p == 22) {
    float s = abs(fract(m.x * 2.6 + m.y * 1.2 + (vnoise(m * 2.5) - 0.5) * 2.2) - 0.5);
    return vec2(band(s, 0.16 + 0.06 * vnoise(m * 6.0)), 0.0);
  }
  // digital camo: blocky pixels in two shades
  if (p == 23) {
    vec2 c = floor(m / 0.035);
    float a = vnoise(c * 0.22) + hash(c) * 0.18, b = vnoise(c * 0.22 + 9.0) + hash(c + 1.0) * 0.12;
    return vec2(step(0.62, a), step(0.7, b) * (1.0 - step(0.62, a)));
  }
  // inferno: flames from the bottom, high and wild
  if (p == 24) {
    float t = side > 0.5 ? u : P.x;
    float e = v - (0.42 + 0.22 * pow(tri(t * 4.0 + 0.2), 2.0) + 0.1 * tri(t * 11.0) + 0.06 * vnoise(m * 9.0));
    return vec2(below(e), pin(e - 0.014, T * 1.4));
  }
  return vec2(0.0);
}`;

// Paint and livery in a material's shader; returns its uniforms. spec: a
// mask { url, ref } for liveries painted into a texture, or null to paint
// the whole material.
export function maskShader(m, spec) {
  if (m.userData.maskU) return m.userData.maskU;
  const u = { uMask: { value: spec ? loadMask(spec.url) : null }, uHasMask: { value: spec ? 1 : 0 }, uOn: { value: 0 },
    uCol: { value: new THREE.Color() }, uCol2: { value: new THREE.Color() }, uCol3: { value: new THREE.Color() }, uPat: { value: 0 },
    uRef: { value: spec?.ref || 0.2 }, uRefMap: { value: spec?.refMap ? 1 : 0 }, uDim: { value: new THREE.Vector3(1.4, 0.5, 1.8) } };
  const usesMap = !!m.map;
  m.onBeforeCompile = (sh) => {
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 livPos; attribute vec3 livNrm; varying vec3 vLivP; varying vec3 vLivN;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvLivP = livPos; vLivN = livNrm;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + LIVERY_GLSL)
      .replace('#include <map_fragment>', `#include <map_fragment>
        {
          vec4 mk = ${usesMap ? 'texture2D(uMask, vMapUv)' : 'vec4(0.0)'};
          float k = uOn * (uHasMask > 0.5 ? mk.r : 1.0);
          float ref = uRefMap > 0.5 ? max(uRef * 2.0 * mk.g * mk.g, 1e-3) : uRef;
          if (k > 0.0) {
            float lum = dot(diffuseColor.rgb, vec3(0.2126, 0.7152, 0.0722));
            float cl = max(dot(uCol, vec3(0.2126, 0.7152, 0.0722)), 1e-3);
            // the texture's light and shade, relative to the paint colour
            float shade = clamp(uHasMask > 0.5 ? lum / ref : lum / cl, 0.0, 2.5);
            vec3 base = uHasMask > 0.5 ? uCol * shade : diffuseColor.rgb;
            vec2 lv = livery(vLivP, vLivN);
            vec3 c = mix(mix(base, uCol2 * shade, lv.x), uCol3 * min(shade, 1.2), lv.y);
            diffuseColor.rgb = mix(diffuseColor.rgb, c, k);
          }
        }`);
  };
  m.customProgramCacheKey = () => `paintlivery3${spec ? 'm' : ''}${usesMap ? 't' : ''}`;
  m.needsUpdate = true;
  m.userData.maskU = u;
  return u;
}

// Each painted mesh's vertices in the kart's frame, scaled 0..1 over all the
// painted bodywork, plus their normals: what the livery designs are drawn in.
function bakeLivery(object, meshes) {
  object.updateMatrixWorld(true);
  const toKart = new THREE.Matrix4().copy(object.matrixWorld).invert();
  const lo = new THREE.Vector3(Infinity, Infinity, Infinity), hi = new THREE.Vector3(-Infinity, -Infinity, -Infinity);
  const done = new Set(), v = new THREE.Vector3(), nrm = new THREE.Vector3(), nm = new THREE.Matrix3();
  const jobs = [];
  for (const mesh of meshes) {
    if (done.has(mesh.geometry)) mesh.geometry = mesh.geometry.clone();   // shared with a differently placed mesh
    done.add(mesh.geometry);
    const g = mesh.geometry, pos = g.attributes.position, nor = g.attributes.normal;
    const M = new THREE.Matrix4().multiplyMatrices(toKart, mesh.matrixWorld);
    nm.getNormalMatrix(M);
    const P = new Float32Array(pos.count * 3), Nn = new Float32Array(pos.count * 3);
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).applyMatrix4(M);
      P.set([v.x, v.y, v.z], i * 3);
      lo.min(v); hi.max(v);
      if (nor) { nrm.fromBufferAttribute(nor, i).applyMatrix3(nm).normalize(); Nn.set([nrm.x, nrm.y, nrm.z], i * 3); }
    }
    jobs.push([g, P, Nn]);
  }
  const size = new THREE.Vector3().subVectors(hi, lo).max(new THREE.Vector3(1e-3, 1e-3, 1e-3));
  for (const [g, P, Nn] of jobs) {
    for (let i = 0; i < P.length; i += 3) {
      P[i] = (P[i] - lo.x) / size.x; P[i + 1] = (P[i + 1] - lo.y) / size.y; P[i + 2] = (P[i + 2] - lo.z) / size.z;
    }
    g.setAttribute('livPos', new THREE.BufferAttribute(P, 3));
    g.setAttribute('livNrm', new THREE.BufferAttribute(Nn, 3));
  }
  return size;
}

export const PAINT_DEFAULT = { paintOn: false, paint: '#d42a2a', trimOn: false, trim: '#f4f4f4', finish: 'original', livery: 'none', livery2: '#f4f4f4' };
export const PAINT_FINISHES = { original: 'As modelled', gloss: 'Gloss', satin: 'Satin', matte: 'Matte', metallic: 'Metallic' };
const FINISH = { gloss: [0.22, 0], satin: [0.5, 0], matte: [0.85, 0], metallic: [0.3, 0.75] };

const hsl = { h: 0, s: 0, l: 0 };

// Returns how many paint and trim materials the model has.
export function applyPaint(object, cfg, named = null) {
  const mats = new Set();
  object.traverse((o) => { if (o.isMesh) for (const m of [].concat(o.material)) if (m?.color) mats.add(m); });
  // classify once, remembering the model's own look
  for (const m of mats) {
    if (m.userData.orig) continue;
    m.color.getHSL(hsl);
    const max = Math.max(m.color.r, m.color.g, m.color.b);
    const kind = named
      ? (named.paint?.includes(m.name) ? 'paint' : named.trim?.includes(m.name) ? 'trim' : 'other')
      : m.map ? 'other' : hsl.s > 0.35 && max > 0.1 ? 'paint' : hsl.s < 0.15 && hsl.l > 0.25 ? 'trim' : 'other';
    m.userData.orig = { color: m.color.clone(), roughness: m.roughness, metalness: m.metalness, l: hsl.l, kind, exact: !!named };
  }
  // livery masks
  const masked = { paint: [], trim: [] };
  for (const spec of named?.masks || []) {
    for (const m of mats) if (m.name === spec.material) masked[spec.slot].push(maskShader(m, spec));
  }
  const of = (kind) => [...mats].filter(m => m.userData.orig.kind === kind);
  const paint = of('paint'), trim = of('trim');
  // liveries go on everything painted: whole materials and masked panels
  const whole = paint.map(m => maskShader(m, null));
  if (!object.userData.liveryDim) {
    const painted = new Set([...paint, ...[...mats].filter(m => masked.paint.includes(m.userData.maskU))]);
    const meshes = [];
    object.traverse((o) => { if (o.isMesh && [].concat(o.material).some(m => painted.has(m))) meshes.push(o); });
    object.userData.liveryDim = meshes.length ? bakeLivery(object, meshes) : new THREE.Vector3(1, 1, 1);
  }
  const pat = cfg.paintOn ? LIV_ID[liveryKey(cfg.livery)] ?? 0 : 0;
  // the pinstripe: black on light paint, white on dark
  const lum = (h) => { const c = new THREE.Color(h); return 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b; };
  const pinCol = (lum(cfg.paint) + lum(cfg.livery2 || '#f4f4f4')) / 2 > 0.3 ? '#101010' : '#f4f4f4';
  for (const [list, on, hex] of [[masked.paint, cfg.paintOn, cfg.paint], [masked.trim, cfg.trimOn, cfg.trim], [whole, cfg.paintOn, cfg.paint]]) {
    for (const u of list) {
      u.uOn.value = on ? 1 : 0; u.uCol.value.set(hex);
      u.uPat.value = list === masked.trim ? 0 : pat;
      u.uCol2.value.set(cfg.livery2 || '#f4f4f4');
      u.uCol3.value.set(pinCol);
      u.uDim.value.copy(object.userData.liveryDim);
    }
  }
  const recolour = (list, on, hex) => {
    const ref = Math.max(...list.map(m => m.userData.orig.l), 1e-3);
    const t = new THREE.Color(hex).getHSL({ h: 0, s: 0, l: 0 });
    for (const m of list) {
      const o = m.userData.orig;
      if (on && o.exact) m.color.set(hex);
      else if (on) m.color.setHSL(t.h, t.s, Math.min(0.95, t.l * o.l / ref));
      else m.color.copy(o.color);
    }
  };
  recolour(paint, cfg.paintOn, cfg.paint);
  recolour(trim, cfg.trimOn, cfg.trim);
  const f = FINISH[cfg.finish];
  for (const m of paint) {
    if (m.roughness === undefined) continue;
    m.roughness = f ? f[0] : m.userData.orig.roughness;
    m.metalness = f ? f[1] : m.userData.orig.metalness;
  }
  return { paint: paint.length + masked.paint.length, trim: trim.length + masked.trim.length };
}
