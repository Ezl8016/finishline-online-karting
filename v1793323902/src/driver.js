// The driver: a seated figure in a race suit, hands on the wheel (they turn
// with it), head leaning against the cornering load, and a helmet painted
// from the lobby's helmet settings.
//
// Built in the kart holder's frame: origin at the kart's centre of mass,
// -Z forward, +Y up, ground at y = -KART.cgHeight.

import * as THREE from 'three';
import { TESTERS } from './shop.js';

export const HELMET_DEFAULT = {
  design: 'stripe', primary: '#e2574c', secondary: '#f4f4f4', accent: '#1d2733',
  visor: 'smoke', finish: 'gloss', number: '7', suit: '#1d2733', gloves: '#e2574c',
  suitDesign: 'classic', suit2: '#e2574c', suit3: '#f4f4f4',       // suits.js
  hat: 'none', hatColor: '',          // hats.js; hatColor '' = the helmet's main colour
};

export const DESIGNS = { solid: 'Solid', stripe: 'Racing stripe', twin: 'Twin stripes', halo: 'Halo band',
  split: 'Split', checker: 'Chequered crown', flames: 'Flames', stars: 'Stars', chevron: 'Chevrons', tricolour: 'Tricolour',
  arrow: 'Arrow', wings: 'Wings', bolt: 'Lightning', tiger: 'Tiger', camo: 'Camo', hex: 'Honeycomb', speed: 'Speed lines',
  halftone: 'Halftone', swirl: 'Swirl', quarters: 'Quarters', drip: 'Paint drip', splatter: 'Splatter' };
export const VISORS = { clear: 'Clear', smoke: 'Smoke', dark: 'Dark', gold: 'Gold mirror', blue: 'Blue mirror',
  red: 'Red mirror', iridium: 'Iridescent' };
export const FINISHES = { gloss: 'Gloss', matte: 'Matte', metallic: 'Metallic' };
export const ADMIN_FINISHES = { gold: 'Gold (admin)' };
// one account's own helmet: only its owner can pick it (others still see it on them)
export const OWN_DESIGNS = { shark: 'Shark jaw (yours)' };
const DESIGN_OWNERS = { shark: new Set(['8c894d35-d15a-44ad-875a-587d0fe6bfc9']) };   // Ezra_Langley
// the shop's designs (shop.js): bought with points, kept for good
export const SHOP_DESIGNS = { scales: 'Dragon scale', circuit: 'Circuit', galaxy: 'Galaxy', shatter: 'Shattered',
  topo: 'Topographic', zebra: 'Zebra', digital: 'Digital camo', inferno: 'Inferno' };
// limited designs: for accounts made by a date (Halloween 2026's pumpkin: by the
// end of 1 November, Central time), kept for good by them
export const LIMITED_DESIGNS = { pumpkin: 'Pumpkin (Halloween 2026)' };
export const LIMITED_UNTIL = { pumpkin: Date.parse('2026-11-02T06:00:00Z') };
// may this account wear this design? created: when the account was made
// (undefined: someone else's look, shown as they have it; null: not signed in)
export function designAllowed(d, uid, created) {
  if (uid && TESTERS.has(uid)) return true;
  if (LIMITED_UNTIL[d]) return created === undefined || (!!uid && !!created && Date.parse(created) < LIMITED_UNTIL[d]);
  return !DESIGN_OWNERS[d] || (!!uid && DESIGN_OWNERS[d].has(uid));
}

// seat, wheel and limb layout (m)
const HIPS = new THREE.Vector3(0, -0.13, 0.20);
const NECK = new THREE.Vector3(0, 0.40, 0.27);
const SHOULDER = new THREE.Vector3(0.19, 0.34, 0.27);   // right; left is mirrored
const WHEEL = new THREE.Vector3(0, 0.20, -0.18);
const WHEEL_R = 0.15;
const WHEEL_N = new THREE.Vector3(0, Math.cos(1.0), Math.sin(1.0));   // faces the driver
const UPPER_ARM = 0.30, FOREARM = 0.31;
const HIP_JOINT = new THREE.Vector3(0.10, -0.12, 0.12);
const KNEE = new THREE.Vector3(0.15, 0.02, -0.28);
const ANKLE = new THREE.Vector3(0.13, -0.16, -0.68);

const Y = new THREE.Vector3(0, 1, 0);

// A tapered cylinder that can be stretched between two points.
function limb(r0, r1, mat) {
  const g = new THREE.CylinderGeometry(r1, r0, 1, 10, 1);
  g.translate(0, 0.5, 0);
  const m = new THREE.Mesh(g, mat);
  m.castShadow = true;
  return m;
}
const dir = new THREE.Vector3();
function stretch(m, a, b) {
  dir.subVectors(b, a);
  const len = dir.length();
  m.position.copy(a);
  m.quaternion.setFromUnitVectors(Y, dir.divideScalar(len || 1));
  m.scale.set(1, len, 1);
}
function joint(r, mat) {
  const m = new THREE.Mesh(new THREE.SphereGeometry(r, 12, 8), mat);
  m.castShadow = true;
  return m;
}

// Two-bone IK: elbow position for shoulder S reaching hand H, bending towards pole.
const _d = new THREE.Vector3(), _p = new THREE.Vector3();
function elbow(S, H, pole, out) {
  _d.subVectors(H, S);
  const dist = Math.min(_d.length(), UPPER_ARM + FOREARM - 1e-3);
  _d.normalize();
  const along = (UPPER_ARM ** 2 - FOREARM ** 2 + dist ** 2) / (2 * dist);
  const h = Math.sqrt(Math.max(0, UPPER_ARM ** 2 - along ** 2));
  _p.copy(pole).addScaledVector(_d, -pole.dot(_d)).normalize();
  return out.copy(S).addScaledVector(_d, along).addScaledVector(_p, h);
}

// ---------------------------------------------------------------- helmet paint
// Painted per pixel on the sphere's equirectangular UVs: u = 0 left side,
// 0.25 back, 0.5 right side, 0.75 front (visor); v = 0 top.
export function paintHelmet(cfg, W = 1024, H = 512) {
  if (cfg.design === 'shark') return paintShark();
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d');
  const img = g.createImageData(W, H);
  const rgb = (hex) => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
  const P = rgb(cfg.primary), S = rgb(cfg.secondary), A = rgb(cfg.accent);
  const COL = [P, S, A];
  // stars: centres on the shell, sizes, and a frame on the shell at each
  const stars = [];
  for (let i = 0; i < 9; i++) {
    const a = i * 2.4 + 0.7, y = 0.85 - (i % 5) * 0.22, r = Math.sqrt(1 - y * y);
    const cx = Math.cos(a) * r, cz = Math.sin(a) * r;
    const t1 = new THREE.Vector3(-cz, 0, cx).normalize(), n = new THREE.Vector3(cx, y, cz);
    stars.push({ n, t1, t2: new THREE.Vector3().crossVectors(n, t1), R: 0.15 + (i % 3) * 0.05, turn: i * 0.7 });
  }
  const K = Math.PI * 2 / 5;
  // 1 inside a five-pointed star of radius R (inner radius 0.42 R), by angle and distance
  const inStar = (r, ang, R) => {
    let m = ((ang % K) + K) % K; m = Math.abs(m - K / 2); m = K / 2 - m;       // 0 at a point, K/2 between
    const ax = R, ay = 0, ri = R * 0.42, bx = ri * Math.cos(K / 2), by = ri * Math.sin(K / 2);
    const dx = Math.cos(m), dy = Math.sin(m), ex = bx - ax, ey = by - ay;
    const t = (ax * ey - ay * ex) / (dx * ey - dy * ex);
    return r < t;
  };
  const p = new THREE.Vector3();
  // splatter: blobs of paint, each with a few drops flung round it
  const blobs = [];
  for (let i = 0; i < 24; i++) {
    const a = hash(i, 1, 9) * Math.PI * 2, y = hash(i, 2, 9) * 1.2 - 0.25, r = Math.sqrt(Math.max(0, 1 - y * y));
    blobs.push({ n: new THREE.Vector3(-Math.cos(a) * r, y, Math.sin(a) * r), R: 0.16 + hash(i, 3, 9) * 0.2, k: i % 3 === 0 ? 2 : 1 });
  }
  const fr = (v) => v - Math.floor(v);
  // shattered: points scattered over the shell, a shard round each
  const shards = [];
  for (let i = 0; i < 30; i++) {
    const yy = hash(i, 4, 2) * 2 - 1, a = hash(i, 5, 2) * Math.PI * 2, r = Math.sqrt(1 - yy * yy);
    shards.push({ n: new THREE.Vector3(-Math.cos(a) * r, yy, Math.sin(a) * r), fill: hash(i, 6, 2) < 0.5 });
  }
  // the hexagon a point (u, v) is in: its centre's offset, and how near its edge (0 at the edge)
  const hexAt = (u, v) => {
    const ax = fr(u) - 0.5, ay = fr(v / 1.732) * 1.732 - 0.866, bx = fr(u - 0.5) - 0.5, by = fr((v - 0.866) / 1.732) * 1.732 - 0.866;
    const [gx, gy] = ax * ax + ay * ay < bx * bx + by * by ? [ax, ay] : [bx, by];
    return { cx: u - gx, cy: v - gy, e: 0.5 - Math.max(Math.abs(gx) * 0.866 + Math.abs(gy) * 0.5, Math.abs(gy)) };
  };
  // which colour a point of the shell is: 0 primary, 1 secondary, 2 accent.
  // (On the shell: y up, -z the front where the visor is, x the driver's left)
  const region = (x, y, z, th, ph) => {
    const over = Math.atan2(y, -z);                       // round the top from the front (0) over to the back (pi)
    switch (cfg.design) {
      case 'chevron': {
        if (y < -0.15 || Math.abs(x) > 0.6) return 0;
        const f = fr((over + Math.abs(x) * 1.2) / 0.5);
        return f < 0.3 ? 1 : f < 0.38 ? 2 : 0;
      }
      case 'tricolour': return z < -0.3 ? 1 : z > 0.35 ? 2 : 0;          // front, middle and back
      case 'arrow': {
        if (y < 0.05) return 0;
        const f = -z, ax = Math.abs(x);
        const inside = (k) => (f > 0.15 - k * 0.06 && f < 0.78 + k * 0.05 && ax < (0.78 - f) * 0.8 + k * 0.05) || (f <= 0.15 && f > -0.9 && ax < 0.1 + k * 0.05);
        return inside(0) ? 1 : inside(1) ? 2 : 0;
      }
      case 'wings': {
        const ax = Math.abs(x);
        if (ax < 0.2) return 0;
        const f = (0.65 + z) / 1.6;                        // 0 at the front of the wing .. 1 at its back
        if (f < 0 || f > 1) return 0;
        const top = 0.2 + 0.28 * f, feather = 0.07 * fr(f * 5), bot = 0.1 - 0.12 * f + feather;
        if (y < top && y > bot) return 1;
        if (y < top + 0.04 && y > bot - 0.04) return 2;
        return 0;
      }
      case 'bolt': {
        if (Math.abs(x) < 0.3) return 0;
        const u = (1 - z) / 2, zz = 0.1 * (Math.abs(fr(u * 3) - 0.5) * 4 - 1), d = Math.abs(y - 0.22 - zz);
        return d < 0.06 ? 1 : d < 0.095 ? 2 : 0;
      }
      case 'tiger': {
        const f = Math.sin(over * 12 + Math.abs(x) * 5 + fbm(x * 2.5 + 4, y * 2.5, z * 2.5) * 7);
        const k = fbm(x * 3, y * 3 + 2, z * 3);
        return f > 0.45 && k > 0.38 ? 2 : 0;
      }
      case 'camo': {
        if (fbm(x * 3.2 + 1, y * 3.2, z * 3.2) > 0.56) return 1;
        return fbm(x * 3.2 + 9, y * 3.2 + 4, z * 3.2) > 0.6 ? 2 : 0;
      }
      case 'hex': {
        if (y < -0.3) return 0;
        const s = 1 / (1.35 + y), h = hexAt(x * s * 5.2, z * s * 5.2);
        if (h.e < 0.06) return 2;
        return hash(Math.round(h.cx * 2), Math.round(h.cy * 2), 3) < 0.35 ? 1 : 0;
      }
      case 'speed': {
        if (Math.abs(x) < 0.25 || y < 0.0 || y > 0.68) return 0;
        const row = Math.floor(y / 0.075), inRow = fr(y / 0.075);
        if (inRow > 0.5) return 0;
        const L = 0.5 + hash(row, 7, 1) * 1.1, start = 1 - L;
        if (z < start) return 0;
        return z < start + 0.07 ? 2 : 1;
      }
      case 'halftone': {
        const s = 1 / (1.35 + y), u = x * s * 9, v = z * s * 9;
        const r = 0.48 * Math.min(1, Math.max(0, (z + 0.95) / 1.7));
        return Math.hypot(fr(u) - 0.5, fr(v) - 0.5) < r ? 1 : 0;
      }
      case 'swirl': {
        if (y < -0.35) return 0;
        const a = Math.atan2(x, -z), r = Math.acos(Math.min(1, y));
        const f = fr((a + r * 3.2) / (Math.PI * 2 / 3));
        return f < 0.3 ? 1 : f < 0.36 ? 2 : 0;
      }
      case 'quarters': {
        if (y < -0.45) return 0;
        return (x > 0) !== (z > 0) ? 1 : 0;
      }
      case 'drip': {
        const col = Math.floor(ph / (Math.PI * 2) * 30), len = Math.pow(hash(col, 5, 2), 2) * 0.55;
        const w = fr(ph / (Math.PI * 2) * 30), round = 0.04 * Math.sqrt(Math.max(0, 1 - Math.pow((w - 0.5) * 2, 2)));
        const edge = 0.45 - len * (0.4 + 0.6 * Math.sqrt(Math.max(0, 1 - Math.pow((w - 0.5) * 2, 2)))) - round;
        return y > edge ? 1 : y > edge - 0.03 ? 2 : 0;
      }
      // ---- the shop's designs
      case 'scales': {
        const a = ph / (Math.PI * 2) * 26, b = th / Math.PI * 13, row = Math.floor(b), xx = a + 0.5 * (row % 2);
        const fx = fr(xx) - 0.5, fy = fr(b), d = Math.hypot(fx, fy * 1.15);
        if (d > 0.4 && d < 0.5) return 2;
        return d <= 0.4 && hash(Math.floor(xx), row, 8) < 0.45 ? 1 : 0;
      }
      case 'circuit': {
        const a = ph / (Math.PI * 2) * 40, b = th / Math.PI * 20, ca = Math.floor(a), cb = Math.floor(b), fa = fr(a), fb = fr(b);
        const pad = hash(ca, cb, 7) > 0.82, pd = Math.hypot(fa - 0.5, fb - 0.5);
        if (pad && pd < 0.24) return pd < 0.14 ? 0 : 2;
        if (hash(ca, cb, 3) > 0.55 && Math.abs(fb - 0.5) < 0.1) return 1;
        if (hash(ca, cb, 4) > 0.6 && Math.abs(fa - 0.5) < 0.1) return 1;
        return 0;
      }
      case 'galaxy': {
        const a = ph / (Math.PI * 2) * 90, b = th / Math.PI * 45;
        if (hash(Math.floor(a), Math.floor(b), 11) > 0.97 && Math.hypot(fr(a) - 0.5, fr(b) - 0.5) < 0.3) return 2;
        return fbm(x * 2.2 + 5, y * 2.2, z * 2.2) > 0.55 ? 1 : 0;
      }
      case 'shatter': {
        p.set(x, y, z);
        let d1 = -9, d2 = -9, best = null;
        for (const sh of shards) { const d = p.dot(sh.n); if (d > d1) { d2 = d1; d1 = d; best = sh; } else if (d > d2) d2 = d; }
        if (d1 - d2 < 0.012) return 2;
        return best.fill ? 1 : 0;
      }
      case 'topo': {
        const n = fbm(x * 1.8 + 2, y * 1.8, z * 1.8) * 14, f = Math.abs(fr(n) - 0.5);
        if (f < 0.42) return 0;
        return Math.round(n) % 5 === 0 ? 2 : 1;
      }
      case 'zebra': {
        const f = Math.sin(over * 9 + x * 5 + (fbm(x * 2.4, y * 2.4 + 6, z * 2.4) - 0.5) * 9);
        return f > 0.3 ? 1 : 0;
      }
      case 'digital': {
        const a = Math.floor(ph / (Math.PI * 2) * 64), b = Math.floor(th / Math.PI * 32);
        const n1 = noise(a / 5, b / 5, 1) + hash(a, b, 1) * 0.18, n2 = noise(a / 5 + 9, b / 5, 2) + hash(a, b, 2) * 0.12;
        return n1 > 0.62 ? 1 : n2 > 0.7 ? 2 : 0;
      }
      case 'inferno': {
        const tongue = Math.pow(Math.abs(((ph * 5 / Math.PI) % 2) - 1), 1.8);
        const edge = -0.25 + 0.65 * tongue + 0.18 * Math.abs(((ph * 13 / Math.PI) % 2) - 1) + 0.08 * noise(x * 6, y * 6, z * 6);
        return y < edge - 0.05 ? 1 : y < edge ? 2 : 0;
      }
      case 'splatter': {
        p.set(x, y, z);
        for (const b of blobs) {
          const d = 1 - p.dot(b.n);
          const rr = b.R * b.R * 0.5 * (1 + 0.35 * Math.sin(Math.atan2(p.y - b.n.y, p.x - b.n.x) * 7 + b.R * 40));
          if (d < rr) return b.k;
          // a few drops
          const dd = noise(x * 40 + b.R * 50, y * 40, z * 40);
          if (d < rr * 3.2 && dd > 0.82) return b.k;
        }
        return 0;
      }
      case 'stripe': { const ax = Math.abs(x); return ax < 0.16 ? 1 : ax < 0.21 ? 2 : 0; }
      case 'twin': { const ax = Math.abs(x); return ax > 0.1 && ax < 0.2 ? 1 : ax > 0.2 && ax < 0.24 ? 2 : 0; }
      case 'halo': { const d = Math.abs(y - 0.28); return d < 0.11 ? 1 : d < 0.15 ? 2 : 0; }
      case 'split': { const d = y + 0.45 * z - 0.05; return d < -0.035 ? 1 : d < 0.035 ? 2 : 0; }
      case 'checker': {
        if (y > 0.42) return (Math.floor(th / (Math.PI / 18)) + Math.floor(ph / (Math.PI / 9))) % 2 ? 1 : 2;
        return y > 0.37 ? 2 : 0;
      }
      case 'flames': {
        // tongues licking back from the chin and visor, outlined in the accent
        const t = (1 - z) / 2;
        const tongue = Math.pow(Math.abs(((ph * 7 / Math.PI) % 2) - 1), 1.6);
        const edge = -0.58 + t * (0.72 + 0.42 * tongue) + 0.03 * Math.sin(ph * 31);
        return y < edge - 0.03 ? 1 : y < edge ? 2 : 0;
      }
      case 'stars': {
        p.set(x, y, z);
        for (const st of stars) {
          if (p.dot(st.n) < 0.8) continue;
          const a = p.dot(st.t1), b = p.dot(st.t2), r = Math.hypot(a, b);
          if (r > st.R) continue;
          const ang = Math.atan2(b, a) + st.turn;
          if (inStar(r, ang, st.R * 0.78)) return 1;
          if (inStar(r, ang, st.R)) return 2;
        }
        return 0;
      }
    }
    return 0;
  };
  // each pixel's colour; where colours meet, from four samples (smooth
  // edges). Then a fine accent pinstripe wherever the main colours meet, and
  // a little light from above
  const reg = new Uint8Array(W * H);
  const at = (i, j, sx, sy) => {
    const th = Math.PI * (j + sy) / H, ph = 2 * Math.PI * (i + sx) / W;
    // three.js SphereGeometry: x = -cos(phi) sin(theta), y = cos(theta), z = sin(phi) sin(theta)
    return region(-Math.cos(ph) * Math.sin(th), Math.cos(th), Math.sin(ph) * Math.sin(th), th, ph);
  };
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) reg[j * W + i] = at(i, j, 0.5, 0.5);
  const sub = [[0.25, 0.25], [0.75, 0.25], [0.25, 0.75], [0.75, 0.75]];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const k = reg[j * W + i], o = (j * W + i) * 4;
      const edge = (j > 0 && reg[(j - 1) * W + i] !== k) || (j < H - 1 && reg[(j + 1) * W + i] !== k)
        || reg[j * W + (i + 1) % W] !== k || reg[j * W + (i - 1 + W) % W] !== k;
      let r = COL[k][0], gg = COL[k][1], b = COL[k][2];
      if (edge) {
        r = gg = b = 0;
        for (const [sx, sy] of sub) { const col = COL[at(i, j, sx, sy)]; r += col[0] / 4; gg += col[1] / 4; b += col[2] / 4; }
      }
      img.data[o] = r; img.data[o + 1] = gg; img.data[o + 2] = b; img.data[o + 3] = 255;
    }
  }
  for (let j = 2; j < H - 2; j++) {
    for (let i = 0; i < W; i++) {
      const k = reg[j * W + i];
      if (k === 2) continue;
      const nb = [reg[(j - 2) * W + i], reg[(j + 2) * W + i], reg[j * W + (i + 2) % W], reg[j * W + (i - 2 + W) % W]];
      if (!nb.some(n => n !== k && n !== 2)) continue;
      const o = (j * W + i) * 4;
      img.data[o] = (img.data[o] + A[0] * 3) / 4; img.data[o + 1] = (img.data[o + 1] + A[1] * 3) / 4; img.data[o + 2] = (img.data[o + 2] + A[2] * 3) / 4;
    }
  }
  for (let j = 0; j < H; j++) {
    const y = Math.cos(Math.PI * (j + 0.5) / H);
    // light from above, and the dark rubber trim round the bottom edge
    const lit = 0.9 + 0.1 * Math.max(0, y + 0.3);
    for (let i = 0; i < W; i++) {
      const o = (j * W + i) * 4;
      if (y < -0.62) { img.data[o] = 22; img.data[o + 1] = 24; img.data[o + 2] = 27; continue; }
      img.data[o] *= lit; img.data[o + 1] *= lit; img.data[o + 2] *= lit;
    }
  }
  g.putImageData(img, 0, 0);
  // race number on both sides (u = 0.5 right, u = 0 / 1 left): heavy italic,
  // outlined in the accent with a soft shadow
  const num = String(cfg.number || '').slice(0, 3);
  if (num) {
    g.font = `italic 900 ${Math.round(H * 0.15)}px "Arial Black", "Helvetica Neue", -apple-system, sans-serif`;
    g.textAlign = 'center'; g.textBaseline = 'middle'; g.lineJoin = 'round';
    for (const cx of [0, W / 2, W]) {
      g.save(); g.translate(cx, H * 0.57); g.scale(0.9, 1);
      g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = H * 0.012; g.shadowOffsetY = H * 0.006;
      g.lineWidth = H * 0.03; g.strokeStyle = cfg.accent; g.strokeText(num, 0, 0);
      g.shadowColor = 'transparent';
      g.fillStyle = cfg.secondary === cfg.primary ? cfg.accent === cfg.primary ? '#f4f4f4' : cfg.accent : cfg.secondary;
      g.fillText(num, 0, 0);
      g.restore();
    }
  }
  // the Gridline logo on the back, low down (u = 0.25)
  if (sharkLogo.naturalWidth) {
    const w = W * 0.13, h = w * sharkLogo.naturalHeight / sharkLogo.naturalWidth;
    g.drawImage(sharkLogo, W * 0.25 - w / 2, H * 0.6 - h / 2, w, h);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

// ---- the shark helmet (Ezra's real one): chrome blue and black under grey
// grunge, a shark's jaw round the visor, claws at the back and the Gridline
// Online Karting logo. Fixed colours; the texture also carries its own
// roughness/metalness map (userData.metalRough) so the blue is chrome.
const hash = (x, y, z) => {
  let h = Math.imul(x, 374761393) ^ Math.imul(y, 668265263) ^ Math.imul(z, 1440662683);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
};
function noise(x, y, z) {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const s = (t) => t * t * (3 - 2 * t), fx = s(x - xi), fy = s(y - yi), fz = s(z - zi);
  const l = (a, b, t) => a + (b - a) * t;
  const c = (dx, dy, dz) => hash(xi + dx, yi + dy, zi + dz);
  return l(l(l(c(0, 0, 0), c(1, 0, 0), fx), l(c(0, 1, 0), c(1, 1, 0), fx), fy),
           l(l(c(0, 0, 1), c(1, 0, 1), fx), l(c(0, 1, 1), c(1, 1, 1), fx), fy), fz);
}
const fbm = (x, y, z) => noise(x, y, z) * 0.6 + noise(x * 2.1 + 7, y * 2.1, z * 2.1) * 0.3 + noise(x * 4.3, y * 4.3 + 3, z * 4.3) * 0.1;

const sharkLogo = new Image();
export const sharkReady = new Promise((res) => { sharkLogo.onload = res; sharkLogo.onerror = res; });
sharkLogo.src = 'models/hats/cap-logo.png';

const SH = { black: [12, 13, 17], grey: [140, 143, 148], light: [190, 193, 197], blue: [52, 96, 235] };
function paintShark(W = 1024, H = 512) {
  const c = document.createElement('canvas'), m = document.createElement('canvas');
  c.width = m.width = W; c.height = m.height = H;
  const g = c.getContext('2d'), gm = m.getContext('2d');
  const img = g.createImageData(W, H), mr = gm.createImageData(W, H);
  for (let j = 0; j < H; j++) {
    const th = Math.PI * (j + 0.5) / H;
    for (let i = 0; i < W; i++) {
      const ph = 2 * Math.PI * (i + 0.5) / W;
      const x = -Math.cos(ph) * Math.sin(th), y = Math.cos(th), z = Math.sin(ph) * Math.sin(th);
      const a = Math.abs(Math.atan2(x, -z));            // 0 front, pi back
      // streaks running front to back, splatter and scratches over them
      const n = fbm(x * 2.6 + 3, y * 2.6, z * 0.8);
      let col, rough = 0.3, metal = 0;
      if (y < -0.25) col = n > 0.5 ? SH.blue : SH.black;
      else col = n > 0.54 ? SH.blue : n < 0.4 ? SH.grey : SH.black;
      if (col === SH.grey && fbm(x * 9, y * 9, z * 9) > 0.62) col = SH.light;
      const sp = noise(x * 55, y * 55, z * 55);
      if (col !== SH.black && sp > 0.8) col = SH.black;
      else if (col === SH.black && y > -0.25 && sp < 0.1) col = SH.grey;
      if (Math.abs(noise(x * 7 + 11, y * 7, z * 7) - 0.5) < 0.01 && y > -0.3) col = col === SH.black ? SH.light : SH.black;
      // chrome round the chin and the back of the neck
      if ((a < 0.55 && y < -0.5) || (a > 2.55 && y < -0.3)) col = SH.blue;
      if (col === SH.blue) { rough = 0.12; metal = 1; } else if (col !== SH.black) rough = 0.45;
      if (y < -0.62) { col = [22, 24, 27]; rough = 0.6; metal = 0; }
      const k = (j * W + i) * 4;
      img.data[k] = col[0]; img.data[k + 1] = col[1]; img.data[k + 2] = col[2]; img.data[k + 3] = 255;
      mr.data[k] = 0; mr.data[k + 1] = rough * 255; mr.data[k + 2] = metal * 255; mr.data[k + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0); gm.putImageData(mr, 0, 0);

  // drawing on the sphere: a = around from the front (+ right side), e = up from the brim line
  const P = (a, e) => [(0.75 - a / (2 * Math.PI)) * W, (0.5 - e / Math.PI) * H];
  // each shape on both sides, and again a turn over where it crosses the seam
  const paint = (draw) => {
    for (const s of [1, -1]) for (const off of [0, -W, W]) for (const [ctx, flat] of [[g, false], [gm, true]]) {
      ctx.save(); ctx.translate(off, 0); draw(ctx, s, flat); ctx.restore();
    }
  };
  const poly = (ctx, s, pts) => { ctx.beginPath(); pts.forEach(([a, e], k) => ctx[k ? 'lineTo' : 'moveTo'](...P(s * a, e))); ctx.closePath(); };
  const GLOSS = 'rgb(0,77,0)';                           // the metal map's colour for gloss paint

  // the jaws: gums from the front of the visor back to the corner of the mouth
  const jaw = (t, upper) => upper ? [0.2 + 1.65 * t, 0.5 - 0.42 * Math.pow(t, 1.3)] : [0.3 + 1.55 * t, -0.7 + 0.22 * Math.pow(t, 0.8)];
  paint((ctx, s, flat) => {
    for (const upper of [true, false]) {
      // big rounded fangs, like the real helmet's: fat at the gum, curving to a point
      const N = 7, dir = upper ? -1 : 1;
      for (let k = 0; k < N; k++) {
        const t0 = (k + 0.04) / N, t1 = (k + 0.96) / N, tm = (t0 + t1) / 2;
        const [a0, e0] = jaw(t0, upper), [a1, e1] = jaw(t1, upper), [am, em] = jaw(tm, upper);
        const len = (0.26 - 0.1 * tm) * (k % 2 ? 0.8 : 1);
        const tip = [am + 0.06, em + dir * len];
        ctx.beginPath();
        ctx.moveTo(...P(s * a0, e0));
        ctx.quadraticCurveTo(...P(s * (a0 - 0.01), em + dir * len * 0.75), ...P(s * tip[0], tip[1]));
        ctx.quadraticCurveTo(...P(s * (a1 + 0.02), em + dir * len * 0.45), ...P(s * a1, e1));
        ctx.closePath();
        ctx.fillStyle = flat ? GLOSS : '#f1f1ec'; ctx.fill();
        ctx.lineWidth = 4; ctx.strokeStyle = flat ? GLOSS : '#050506'; ctx.stroke();
        if (!flat) {
          // grey shade down one side, and scuffs
          ctx.beginPath();
          ctx.moveTo(...P(s * am, em));
          ctx.quadraticCurveTo(...P(s * (a1 + 0.01), em + dir * len * 0.45), ...P(s * tip[0], tip[1]));
          ctx.quadraticCurveTo(...P(s * (am + 0.04), em + dir * len * 0.5), ...P(s * am, em));
          ctx.fillStyle = '#b9bcc0'; ctx.fill();
          ctx.fillStyle = '#1a1b1e';
          for (let q = 0; q < 3; q++) {
            const u = hash(k, q, upper ? 1 : 2), w = hash(q, k, 9);
            const [qx, qy] = P(s * (a0 + (a1 - a0) * (0.2 + 0.6 * u)), em + dir * len * (0.15 + 0.4 * w));
            ctx.fillRect(qx, qy, 3 + 4 * w, 2);
          }
        }
      }
      // the gum line
      ctx.beginPath();
      for (let t = 0; t <= 1.001; t += 0.05) { const [a, e] = jaw(t, upper); ctx.lineTo(...P(s * a, e - dir * 0.012)); }
      ctx.lineWidth = 7; ctx.strokeStyle = flat ? GLOSS : '#050506'; ctx.stroke();
    }
  });

  // claws: three cream talons curling round each side of the back
  paint((ctx, s, flat) => {
    for (let k = 0; k < 3; k++) {
      const a = 2.3 + k * 0.06, e = -0.07 - k * 0.15;
      ctx.beginPath();
      // fanned out like fingers: the top one reaching up, the bottom one down
      const f = (1 - k) * 0.07;
      ctx.moveTo(...P(s * a, e + 0.13));
      ctx.quadraticCurveTo(...P(s * (a + 0.4), e + 0.09 + f), ...P(s * (a + 0.5), e - 0.1 + 1.6 * f));
      ctx.quadraticCurveTo(...P(s * (a + 0.28), e - 0.02 + f), ...P(s * (a - 0.02), e - 0.03));
      ctx.closePath();
      ctx.fillStyle = flat ? GLOSS : '#e9dfae'; ctx.fill();
      ctx.lineWidth = 4; ctx.strokeStyle = flat ? GLOSS : '#050506'; ctx.stroke();
      if (!flat) {
        ctx.beginPath();
        ctx.moveTo(...P(s * (a + 0.05), e - 0.01));
        ctx.quadraticCurveTo(...P(s * (a + 0.3), e + 0.02 + f), ...P(s * (a + 0.45), e - 0.08 + 1.6 * f));
        ctx.lineWidth = 3; ctx.strokeStyle = '#8f8b78'; ctx.stroke();
      }
    }
  });

  // the logo: forehead and back
  if (sharkLogo.naturalWidth) {
    const r = sharkLogo.naturalHeight / sharkLogo.naturalWidth, R = W / (2 * Math.PI);
    const logo = (ctx, flat, a, e, w, rot = 0) => {
      const [px, py] = P(a, e);
      ctx.save(); ctx.translate(px, py); ctx.rotate(rot); ctx.scale(1 / Math.cos(e), 1);
      const ww = w * R, hh = ww * r;
      if (flat) { ctx.fillStyle = GLOSS; ctx.fillRect(-ww / 2, -hh / 2, ww, hh); }
      else ctx.drawImage(sharkLogo, -ww / 2, -hh / 2, ww, hh);
      ctx.restore();
    };
    for (const off of [0, -W, W]) for (const [ctx, flat] of [[g, false], [gm, true]]) {
      ctx.save(); ctx.translate(off, 0);
      logo(ctx, flat, 0, 0.62, 0.95);
      logo(ctx, flat, Math.PI, 0.22, 0.95);
      ctx.restore();
    }
  }

  const t = new THREE.CanvasTexture(c), tm = new THREE.CanvasTexture(m);
  t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = tm.anisotropy = 4;
  tm.wrapS = THREE.RepeatWrapping;
  t.userData.metalRough = tm;
  return t;
}

export function visorMaterial(kind) {
  const m = new THREE.MeshPhysicalMaterial({ roughness: 0.05, metalness: 0, clearcoat: 1, transparent: true });
  const set = {
    clear:   { color: 0xdfe8ee, opacity: 0.35, metalness: 0.2 },
    smoke:   { color: 0x2c3238, opacity: 0.8, metalness: 0.4 },
    dark:    { color: 0x0a0c0e, opacity: 0.95, metalness: 0.5 },
    gold:    { color: 0xd8a640, opacity: 1, metalness: 1, roughness: 0.12 },
    blue:    { color: 0x2f7fe0, opacity: 1, metalness: 1, roughness: 0.12 },
    red:     { color: 0xd8402e, opacity: 1, metalness: 1, roughness: 0.12 },
    iridium: { color: 0x3a2a5a, opacity: 1, metalness: 0.9, roughness: 0.1, iridescence: 1, iridescenceIOR: 1.6 },
  }[kind] || {};
  const { color, ...rest } = set;
  m.color.set(color ?? 0x2c3238);
  Object.assign(m, rest);
  return m;
}

export class Driver {
  constructor() {
    this.object = new THREE.Group();
    this.object.name = 'driver';
    this.suit = new THREE.MeshStandardMaterial({ color: HELMET_DEFAULT.suit, roughness: 0.85 });
    const glove = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.7 });
    const shoe = new THREE.MeshStandardMaterial({ color: 0x202226, roughness: 0.6 });

    // upper body pivots at the hips so it can lean in corners
    this.upper = new THREE.Group();
    this.upper.position.copy(HIPS);
    this.object.add(this.upper);
    const local = (v) => v.clone().sub(HIPS);
    this.torso = limb(0.15, 0.17, this.suit);
    stretch(this.torso, local(HIPS), local(NECK));
    this.torso.scale.x = 1.0;
    this.upper.add(this.torso);
    const neck = limb(0.05, 0.05, this.suit);
    stretch(neck, local(NECK), local(NECK).add(new THREE.Vector3(0, 0.1, -0.01)));
    this.upper.add(neck);
    for (const s of [-1, 1]) {
      const sh = joint(0.07, this.suit);
      sh.position.copy(local(SHOULDER)).multiply(new THREE.Vector3(s, 1, 1));
      this.upper.add(sh);
    }

    // helmet: painted shell, visor, small rear spoiler
    this.head = new THREE.Group();
    this.head.position.copy(local(NECK)).add(new THREE.Vector3(0, 0.22, -0.02));
    this.upper.add(this.head);
    this.shellMat = new THREE.MeshPhysicalMaterial({ roughness: 0.3, clearcoat: 1, clearcoatRoughness: 0.08 });
    const shell = new THREE.Mesh(new THREE.SphereGeometry(1, 48, 32), this.shellMat);
    shell.scale.set(0.145, 0.155, 0.168);
    shell.castShadow = true;
    // the visor opening sits round the front at eye level
    this.visorMesh = new THREE.Mesh(
      new THREE.SphereGeometry(1.015, 32, 12, 1.5 * Math.PI - 0.95, 1.9, Math.PI * 0.36, Math.PI * 0.2), visorMaterial('smoke'));
    this.visorMesh.scale.copy(shell.scale);
    this.spoiler = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.018, 0.06), this.shellMat);
    this.spoiler.position.set(0, 0.075, 0.165);
    this.spoiler.rotation.x = -0.35;
    this.spoiler.castShadow = true;
    this.head.add(shell, this.visorMesh, this.spoiler);

    // arms: shoulder and elbow joints, upper arm, forearm, glove
    this.arms = [-1, 1].map((s) => {
      const a = {
        side: s, upper: limb(0.055, 0.045, this.suit), fore: limb(0.045, 0.038, this.suit),
        elbowJ: joint(0.048, this.suit), hand: joint(0.045, glove),
        S: new THREE.Vector3(), E: new THREE.Vector3(), H: new THREE.Vector3(),
        pole: new THREE.Vector3(s * 1, -0.7, 0.3).normalize(),
      };
      a.hand.scale.set(1, 0.8, 1.3);
      this.object.add(a.upper, a.fore, a.elbowJ, a.hand);
      return a;
    });

    // legs reach forward to the pedals
    for (const s of [-1, 1]) {
      const m = (v) => v.clone().multiply(new THREE.Vector3(s, 1, 1));
      const thigh = limb(0.08, 0.065, this.suit); stretch(thigh, m(HIP_JOINT), m(KNEE));
      const shin = limb(0.06, 0.05, this.suit); stretch(shin, m(KNEE), m(ANKLE));
      const knee = joint(0.065, this.suit); knee.position.copy(m(KNEE));
      const foot = new THREE.Mesh(new THREE.BoxGeometry(0.09, 0.08, 0.24), shoe);
      foot.position.copy(m(ANKLE)).add(new THREE.Vector3(0, 0.02, -0.08));
      foot.rotation.x = 0.5;
      foot.castShadow = true;
      this.object.add(thigh, shin, knee, foot);
    }

    this._e1 = new THREE.Vector3(1, 0, 0);
    this._e2 = new THREE.Vector3().crossVectors(WHEEL_N, this._e1).normalize();   // 12 o'clock
    this._m = new THREE.Matrix4();
    this.setHelmet(HELMET_DEFAULT);
    this.update(0, 0, 'MENU');
  }

  setHelmet(cfg) {
    this.cfg = { ...HELMET_DEFAULT, ...cfg };
    const c = this.cfg;
    this.shellMat.map?.dispose();
    this.shellMat.map = paintHelmet(c);
    const fin = { gloss: [0.3, 0, 1], matte: [0.8, 0, 0], metallic: [0.35, 0.6, 0.6] }[c.finish] || [0.3, 0, 1];
    this.shellMat.roughness = fin[0]; this.shellMat.metalness = fin[1]; this.shellMat.clearcoat = fin[2];
    this.shellMat.needsUpdate = true;
    const old = this.visorMesh.material;
    this.visorMesh.material = visorMaterial(c.visor);
    this.visorMesh.material.envMap = old.envMap;
    this.visorMesh.material.envMapIntensity = 1;
    old.dispose();
    this.suit.color.set(c.suit);
  }

  setEnvMap(env) {
    this.shellMat.envMap = env; this.shellMat.envMapIntensity = 0.6; this.shellMat.needsUpdate = true;
    this.visorMesh.material.envMap = env; this.visorMesh.material.needsUpdate = true;
  }

  // (the same build for every weight: see RacingDriver.setWeight)
  setWeight() {
    this.torso.scale.x = 1.03;
    this.torso.scale.z = 0.74;
  }

  // world position of the helmet, for the lobby close-up
  headPosition(out) { return this.head.getWorldPosition(out); }

  // steer: -1..1 of full lock; latG: lateral g (+ = turning right)
  update(steer, latG, camMode) {
    // body and head lean against the load, head looks into the corner
    const lean = THREE.MathUtils.clamp(latG, -1.6, 1.6);
    this.upper.rotation.z = lean * 0.05;
    this.head.rotation.set(-0.08, -steer * 0.3, lean * 0.08);
    // from the cockpit camera you'd be looking out of the helmet
    this.head.visible = camMode !== 'COCKPIT';
    this.object.updateMatrixWorld(true);
    this._m.copy(this.object.matrixWorld).invert().multiply(this.upper.matrixWorld);
    const rot = -steer * 1.6;   // the wheel turns ~90 degrees at full lock
    for (const a of this.arms) {
      a.S.copy(SHOULDER).sub(HIPS).multiply(new THREE.Vector3(a.side, 1, 1)).applyMatrix4(this._m);
      const th = (a.side > 0 ? 0.26 : Math.PI - 0.26) + rot;
      a.H.copy(WHEEL).addScaledVector(this._e1, Math.cos(th) * WHEEL_R).addScaledVector(this._e2, Math.sin(th) * WHEEL_R);
      elbow(a.S, a.H, a.pole, a.E);
      stretch(a.upper, a.S, a.E);
      stretch(a.fore, a.E, a.H);
      a.elbowJ.position.copy(a.E);
      a.hand.position.copy(a.H);
      a.hand.quaternion.copy(a.fore.quaternion);
    }
  }
}
