// Race suit designs. Each is drawn on the driver's body itself (not on the
// suit's texture map): every vertex of the suit knows where it was on the
// standing driver, which way it faced, which part of the body it's on and
// how far down its arm or leg (suitAttributes), so a stripe runs straight
// down the side of a leg, a two-tone split sits at the waist and flames lick
// up from the cuffs. A design paints the suit's coloured panels (the ones
// the main suit colour already paints, so the harness, logos and white
// trim keep theirs) in the suit's second and third colours, with the
// texture's folds and shading kept.
//
// The standing driver (driverModel.js): metres, feet on y = 0, facing -Z,
// +X the driver's right. Waist about 1.0 m up, shoulders 1.45 m.

import * as THREE from 'three';

export const SUITS = {
  classic: 'Classic', twotone: 'Two-tone', sides: 'Side stripes', chevron: 'Chevron', sash: 'Sash',
  shoulders: 'Shoulder panels', flames: 'Flames', fade: 'Fade', chequer: 'Chequered bands', bolt: 'Lightning',
  bands: 'Chest bands', camo: 'Camo', pinstripe: 'Pinstripes', split: 'Split', twin: 'Twin stripes', tiger: 'Tiger',
  argyle: 'Argyle', hex: 'Honeycomb', stars: 'Stars', waves: 'Waves', dots: 'Halftone', drip: 'Paint drip', flag: 'Chequered flag',
};
// the shop's suits (shop.js): bought with points, kept for good
export const SHOP_SUITS = { scales: 'Dragon scale', circuit: 'Circuit', galaxy: 'Galaxy', shatter: 'Shattered',
  topo: 'Topographic', zebra: 'Zebra', digital: 'Digital camo', inferno: 'Inferno' };
const ID = Object.fromEntries(Object.keys({ ...SUITS, ...SHOP_SUITS }).map((k, i) => [k, i]));
export const SUIT_DEFAULT = { suitDesign: 'classic', suit2: '#e2574c', suit3: '#f4f4f4' };

// body parts
export const PART = { torso: 0, upperArm: 1, forearm: 2, thigh: 3, shin: 4, foot: 5 };

// Per-vertex: suitP (where on the standing driver), suitN (facing), suitL
// (part, t along the limb from shoulder or hip 0 to wrist or ankle 1, angle
// round the limb: 0 straight out to the side, + towards the front).
// chain: [start, end] joints of the whole limb (arm or leg); side: +1 right, -1 left
export function suitAttributes(geo, part, chain = null, side = 1) {
  const p = geo.attributes.position;
  if (!geo.attributes.normal) geo.computeVertexNormals();
  const n = geo.attributes.normal, L = new Float32Array(p.count * 3);
  const v = new THREE.Vector3(), nn = new THREE.Vector3(), ax = new THREE.Vector3(), out = new THREE.Vector3(), fwd = new THREE.Vector3();
  let len2 = 1;
  if (chain) {
    ax.subVectors(chain[1], chain[0]); len2 = ax.lengthSq(); ax.normalize();
    out.set(side, 0, 0).addScaledVector(ax, -ax.x * side).normalize();
    fwd.crossVectors(ax, out).normalize();
    if (fwd.z > 0) fwd.negate();                               // (towards -Z, the front)
  }
  for (let i = 0; i < p.count; i++) {
    v.fromBufferAttribute(p, i); nn.fromBufferAttribute(n, i);
    let t = 0, a = 0;
    if (chain) {
      t = v.clone().sub(chain[0]).dot(ax) * Math.sqrt(1 / len2);
      nn.addScaledVector(ax, -nn.dot(ax));
      a = Math.atan2(nn.dot(fwd), nn.dot(out));
    }
    L[i * 3] = part; L[i * 3 + 1] = THREE.MathUtils.clamp(t, 0, 1); L[i * 3 + 2] = a;
  }
  geo.setAttribute('suitP', p.clone());
  geo.setAttribute('suitN', n.clone());
  geo.setAttribute('suitL', new THREE.BufferAttribute(L, 3));
}

const GLSL = /* glsl */`
uniform int uSD; uniform vec3 uS2; uniform vec3 uS3;
varying vec3 vSP; varying vec3 vSN; varying vec3 vSL;
float sBand(float x, float c, float w) { float aa = max(fwidth(x), 1e-4); return 1.0 - smoothstep(w - aa, w + aa, abs(x - c)); }
float sAbove(float x, float c) { float aa = max(fwidth(x), 1e-4); return smoothstep(c - aa, c + aa, x); }
float sHash(vec3 p) { return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453); }
float sNoise(vec3 p) {
  vec3 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(mix(sHash(i), sHash(i + vec3(1, 0, 0)), f.x), mix(sHash(i + vec3(0, 1, 0)), sHash(i + vec3(1, 1, 0)), f.x), f.y),
             mix(mix(sHash(i + vec3(0, 0, 1)), sHash(i + vec3(1, 0, 1)), f.x), mix(sHash(i + vec3(0, 1, 1)), sHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// x: how much of the second colour, y: of the third (on top)
vec2 suitDesign(vec3 p, vec3 n, vec3 l) {
  float part = l.x, t = l.y, ar = l.z;
  bool torso = part < 0.5, arm = part > 0.5 && part < 2.5, leg = part > 2.5 && part < 4.5, boot = part > 4.5;
  float sx = abs(p.x);
  vec2 w = vec2(0.0);
  if (uSD == 1) {                       // two-tone: below the waist, a pinstripe on the split
    w.x = 1.0 - sAbove(p.y, 1.0);
    w.y = sBand(p.y, 1.0, 0.012);
  } else if (uSD == 2) {                // side stripes: down the body's sides, the arms' and legs' outsides
    float s = torso ? abs(n.x) : (boot ? 0.0 : cos(ar));
    w.x = smoothstep(0.62, 0.7, s);
    w.y = smoothstep(0.5, 0.56, s) * (1.0 - smoothstep(0.6, 0.64, s));
  } else if (uSD == 3) {                // chevron: a V on the chest and back, the arms' cuffs to match
    float v = p.y - (1.36 - sx * 1.1);
    if (torso) { w.x = sBand(v, 0.0, 0.05); w.y = sBand(v, -0.075, 0.012) + sBand(v, 0.075, 0.012); }
    if (arm) { w.x = sAbove(t, 0.86); w.y = sBand(t, 0.83, 0.012); }
  } else if (uSD == 4) {                // sash: a band from the right shoulder to the left hip
    float d = (p.y - 1.18) + p.x * 1.05;
    if (torso) { w.x = sBand(d, 0.0, 0.07); w.y = sBand(d, 0.09, 0.012) + sBand(d, -0.09, 0.012); }
  } else if (uSD == 5) {                // shoulder panels: shoulders and upper arms, an edge on the chest
    if (torso) { w.x = sAbove(p.y, 1.39); w.y = sBand(p.y, 1.375, 0.01); }
    if (arm) { w.x = 1.0 - sAbove(t, 0.42); w.y = sBand(t, 0.43, 0.012); }
    if (leg) { float s = cos(ar); w.y = smoothstep(0.85, 0.9, s); }
  } else if (uSD == 6) {                // flames: up the legs from the boots, along the arms from the cuffs
    if (leg || arm) {
      float u = leg ? 1.0 - (part > 3.5 ? 0.5 + t * 0.5 : t * 0.5) : 1.0 - t;   // 0 at the cuff
      float tongue = 0.5 + 0.2 * sin(ar * 5.0 + 1.3) + 0.1 * sin(ar * 11.0 + 0.4);
      float f = tongue - u * (leg ? 1.0 : 0.8);
      w.x = sAbove(f, 0.0);
      w.y = sAbove(f, 0.0) * (1.0 - sAbove(f, 0.035));
    }
    if (boot) w.x = 1.0;
  } else if (uSD == 7) {                // fade: from the main colour at the shoulders to the second at the feet
    w.x = smoothstep(1.35, 0.35, p.y);
  } else if (uSD == 8) {                // chequered bands: at the waist and the cuffs
    float ch = mod(floor(p.x / 0.035) + floor(p.y / 0.035) + floor(p.z / 0.035), 2.0);
    float inBand = torso ? sBand(p.y, 1.0, 0.05) : (arm ? sAbove(t, 0.84) : (leg ? sAbove(p.y, 0.12) * (1.0 - sAbove(p.y, 0.2)) : 0.0));
    w.y = inBand * ch;
    w.x = inBand * (1.0 - ch);
  } else if (uSD == 9) {                // lightning: a bolt down each side, shoulder to ankle
    float s = torso ? p.z : (boot ? 99.0 : -sin(ar) * 0.09);
    float zz = 0.035 * (abs(fract(p.y * 3.2) - 0.5) * 4.0 - 1.0);
    bool side = torso ? abs(n.x) > 0.35 : cos(ar) > 0.0;
    if (side) { w.x = sBand(s, zz, 0.018); w.y = sBand(s, zz, 0.03) * (1.0 - sBand(s, zz, 0.018)); }
  } else if (uSD == 10) {               // chest bands: three across the chest and back
    if (torso) {
      float y = p.y;
      w.x = sBand(y, 1.24, 0.03) + sBand(y, 1.33, 0.02);
      w.y = sBand(y, 1.185, 0.008) + sBand(y, 1.285, 0.008) + sBand(y, 1.37, 0.008);
    }
  } else if (uSD == 11) {               // camo: blotches in the second and third colours
    float a = sNoise(p * 9.0) * 0.7 + sNoise(p * 23.0) * 0.3;
    float b = sNoise(p * 9.0 + 17.3) * 0.7 + sNoise(p * 23.0 + 5.1) * 0.3;
    w.x = smoothstep(0.52, 0.56, a); w.y = smoothstep(0.6, 0.64, b);
  } else if (uSD == 12) {               // pinstripes: fine stripes all over, in the third colour
    float s = torso ? p.x / 0.03 : ar / 0.3;
    w.y = sBand(fract(s), 0.5, 0.06);
  } else if (uSD == 13) {               // split: the right half in the second colour, a line down the middle
    w.x = sAbove(p.x, 0.0);
    if (torso) w.y = sBand(p.x, 0.0, 0.008);
  } else if (uSD == 14) {               // twin stripes: down the middle front and back, and the fronts of the legs
    if (torso) { float d = abs(sx - 0.05); w.x = sBand(d, 0.0, 0.022); w.y = sBand(d, 0.032, 0.006); }
    if (leg) { float d = abs(ar - 1.57); w.x = sBand(d, 0.0, 0.3); w.y = sBand(d, 0.42, 0.08); }
  } else if (uSD == 15) {               // tiger: dark stripes, bent this way and that
    float f = sin(p.y * 30.0 + sNoise(p * 7.0) * 5.0 + sx * 6.0);
    w.y = smoothstep(0.55, 0.65, f) * smoothstep(0.25, 0.45, sNoise(p * 4.0 + 3.0));
  } else if (uSD == 16) {               // argyle: diamonds, thin lines across them
    float u = p.x / 0.09 + (p.z > 0.0 ? 0.5 : 0.0), v = (p.y - 1.0) / 0.13;
    w.x = mod(floor(u + v) + floor(u - v), 2.0);
    w.y = sBand(fract(u + v + 0.5), 0.5, 0.025) + sBand(fract(u - v + 0.5), 0.5, 0.025);
  } else if (uSD == 17) {               // honeycomb: hexagons, outlined
    vec2 q = vec2(p.x + p.z * 0.4, p.y) / 0.045;
    vec2 r = vec2(1.0, 1.732), h = r * 0.5;
    vec2 a = mod(q, r) - h, b = mod(q - h, r) - h;
    vec2 g = dot(a, a) < dot(b, b) ? a : b;
    float e = 0.5 - max(abs(g.x) * 0.866 + abs(g.y) * 0.5, abs(g.y));
    w.x = sAbove(e, 0.06) * step(0.5, sHash(vec3(floor((q - g) * 2.0 + 0.5), 0.0)));
    w.y = 1.0 - sAbove(e, 0.05);
  } else if (uSD == 18) {               // stars: scattered five-pointed stars
    vec2 q = vec2(p.x + p.z, p.y) / 0.11, c = floor(q), f = fract(q) - 0.5;
    f -= (vec2(sHash(vec3(c, 1.0)), sHash(vec3(c, 2.0))) - 0.5) * 0.3;
    float ang = atan(f.y, f.x), rr = length(f), k = 0.16 + 0.1 * sHash(vec3(c, 3.0));
    float star = k * (0.55 + 0.45 * cos(5.0 * (ang - 1.5708)));
    w.x = 1.0 - sAbove(rr, star * 1.0 + k * 0.25);
  } else if (uSD == 19) {               // waves: rolling bands round the body
    float f = sin(p.y * 16.0 + sin(p.x * 22.0 + p.z * 12.0) * 1.3);
    w.x = sAbove(f, 0.45); w.y = sBand(f, 0.3, 0.05);
  } else if (uSD == 20) {               // halftone: dots, growing towards the feet
    vec2 q = vec2(p.x + p.z * 0.5, p.y) / 0.03, f = fract(q) - 0.5;
    float r = 0.48 * smoothstep(1.45, 0.25, p.y);
    w.x = 1.0 - sAbove(length(f), r);
  } else if (uSD == 21) {               // paint drip: poured over the shoulders, running down
    float col = floor((p.x + p.z * 0.7) / 0.035);
    float len = pow(sHash(vec3(col, 7.0, 1.0)), 2.0) * 0.4;
    float edge = 1.3 - len - 0.03 * sin(p.x * 40.0);
    w.x = sAbove(p.y, edge);
    w.y = sBand(p.y, edge - 0.012, 0.006);
  } else if (uSD == 22) {               // chequered flag: the body in the second and third colours' squares
    if (torso) {
      float ch = mod(floor((p.x + 0.5) / 0.05) + floor(p.y / 0.05) + (p.z > 0.0 ? 1.0 : 0.0), 2.0);
      w.x = 1.0 - ch; w.y = ch;
    }
    if (arm || leg) w.y = sBand(cos(ar), 1.0, 0.12);
  }
  // ---- the shop's suits
  vec2 bq = vec2(p.x + p.z * 0.7, p.y);                 // across and up the body
  if (uSD == 23) {                      // dragon scale
    vec2 q = bq / 0.045; float row = floor(q.y), x = q.x + 0.5 * mod(row, 2.0);
    vec2 f = vec2(fract(x) - 0.5, fract(q.y)); float d = length(vec2(f.x, f.y * 1.15));
    w.x = (1.0 - sAbove(d, 0.4)) * step(0.55, sHash(vec3(floor(x), row, 1.0)));
    w.y = sBand(d, 0.45, 0.04);
  } else if (uSD == 24) {               // circuit
    vec2 q = bq / 0.03, c = floor(q), f = fract(q);
    float k = max(sBand(f.y, 0.5, 0.09) * step(0.55, sHash(vec3(c, 1.0))), sBand(f.x, 0.5, 0.09) * step(0.6, sHash(vec3(c, 2.0))));
    float pd = length(f - 0.5), pad = step(0.82, sHash(vec3(c, 3.0)));
    w.x = max(k, pad * (1.0 - sAbove(pd, 0.22))); w.y = pad * sBand(pd, 0.27, 0.04);
  } else if (uSD == 25) {               // galaxy
    float n = sNoise(p * 7.0) * 0.6 + sNoise(p * 15.0 + 3.0) * 0.4;
    vec3 c = floor(p / 0.012);
    w.x = smoothstep(0.5, 0.58, n); w.y = step(0.985, sHash(c));
  } else if (uSD == 26) {               // shattered
    vec2 q = bq / 0.08, c = floor(q); float d1 = 9.0, d2 = 9.0; vec2 id = vec2(0.0);
    for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
      vec2 g = c + vec2(float(i), float(j)), o = g + vec2(sHash(vec3(g, 4.0)), sHash(vec3(g, 5.0)));
      float d = length(q - o);
      if (d < d1) { d2 = d1; d1 = d; id = g; } else if (d < d2) d2 = d;
    }
    w.x = step(0.5, sHash(vec3(id, 6.0))); w.y = 1.0 - sAbove(d2 - d1, 0.06);
  } else if (uSD == 27) {               // topographic
    float n = (sNoise(p * 4.0) * 0.7 + sNoise(p * 9.0 + 2.0) * 0.3) * 14.0, d = abs(fract(n) - 0.5);
    float bold = step(4.5, mod(floor(n + 0.5), 5.0) + 0.5);
    w.x = sAbove(d, 0.43) * (1.0 - bold); w.y = sAbove(d, 0.4) * bold;
  } else if (uSD == 28) {               // zebra
    float f = sin(p.y * 20.0 + sx * 9.0 + (sNoise(p * 5.0) - 0.5) * 9.0);
    w.x = sAbove(f, 0.25);
  } else if (uSD == 29) {               // digital camo
    vec3 c = floor(p / 0.025);
    float a = sNoise(c * 0.22) + sHash(c) * 0.18, b = sNoise(c * 0.22 + 9.0) + sHash(c + 1.0) * 0.12;
    w.x = step(0.62, a); w.y = step(0.7, b) * (1.0 - w.x);
  } else if (uSD == 30) {               // inferno: flames from the boots right up the body
    float around = torso ? p.x * 9.0 + (p.z > 0.0 ? 3.0 : 0.0) : ar * 2.0 + p.x * 4.0;
    float edge = 0.75 + 0.22 * abs(fract(around * 0.5) - 0.5) * 2.0 + 0.1 * abs(fract(around * 1.3) - 0.5) * 2.0 + 0.06 * sNoise(p * 12.0);
    w.x = 1.0 - sAbove(p.y, edge);
    w.y = sBand(p.y, edge + 0.012, 0.012);
  }
  return clamp(w, 0.0, 1.0);
}
`;

// Adds the designs to the suit's material (already painted in the main
// colour by paint.js's maskShader, whose mask and uniforms it shares).
export function suitShader(m) {
  const u = { uSD: { value: 0 }, uS2: { value: new THREE.Color() }, uS3: { value: new THREE.Color() } };
  const prev = m.onBeforeCompile;
  m.onBeforeCompile = (sh, r) => {
    prev?.(sh, r);
    Object.assign(sh.uniforms, u);
    sh.vertexShader = sh.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec3 suitP; attribute vec3 suitN; attribute vec3 suitL; varying vec3 vSP; varying vec3 vSN; varying vec3 vSL;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvSP = suitP; vSN = suitN; vSL = suitL;');
    sh.fragmentShader = sh.fragmentShader
      .replace('#include <common>', '#include <common>\n' + GLSL)
      .replace('#include <color_fragment>', `#include <color_fragment>
        if (uSD > 0) {
          float k = uOn * texture2D(uMask, vMapUv).r;
          if (k > 0.0) {
            vec4 tx = texture2D(map, vMapUv);
            float shade = clamp(dot(tx.rgb, vec3(0.2126, 0.7152, 0.0722)) / uRef, 0.0, 2.5);
            vec2 d = suitDesign(vSP, normalize(vSN), vSL);
            vec3 c = mix(mix(diffuseColor.rgb, uS2 * shade, d.x), uS3 * min(shade, 1.2), d.y);
            diffuseColor.rgb = mix(diffuseColor.rgb, c, k);
          }
        }`);
  };
  const key = m.customProgramCacheKey;
  m.customProgramCacheKey = () => `${key ? key.call(m) : ''}suit1`;
  m.needsUpdate = true;
  return u;
}

export function setSuit(u, look) {
  u.uSD.value = ID[look.suitDesign] ?? 0;
  u.uS2.value.set(look.suit2 || SUIT_DEFAULT.suit2);
  u.uS3.value.set(look.suit3 || SUIT_DEFAULT.suit3);
}
