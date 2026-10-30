// Ghost lap (an option in Settings): your best valid lap on this layout, way
// round and kart, replayed as a see-through kart to chase. Each lap is
// recorded as it's driven, 20 times a second; a new best replaces the ghost,
// which is kept on this computer.

import * as THREE from 'three';

const STORE = 'tidalturns.ghost.v1.';
const EVERY = 0.05;                  // s between samples

export class Ghost {
  constructor(scene) {
    this.scene = scene;
    this.rec = [];                   // the lap being driven: [t, x, y, z, qx, qy, qz, qw, ...]
    this.at = -1;
    this.key = null;
    this.best = null;                // { time, s: Float32Array }
    this.object = null;
    this.from = null;                // which kart model the ghost is made of
  }

  // the board this ghost belongs to (layout, way round, kart)
  use(key) {
    if (key === this.key) return;
    this.key = key; this.best = null;
    try {
      const g = JSON.parse(localStorage.getItem(STORE + key));
      if (g?.s?.length) this.best = { time: g.time, s: Float32Array.from(g.s) };
    } catch { /* no ghost yet */ }
  }

  // a see-through copy of the kart (made again when the kart changes)
  setModel(object, id) {
    if (this.from === id && this.object) return;
    if (this.object) this.scene.remove(this.object);
    this.from = id;
    this.object = object.clone(true);
    this.object.traverse((o) => {
      if (!o.isMesh) return;
      o.material = new THREE.MeshBasicMaterial({ color: 0x9fd4ff, transparent: true, opacity: 0.28, depthWrite: false });
      o.castShadow = o.receiveShadow = false;
    });
    this.object.visible = false;
    this.scene.add(this.object);
  }

  // each step of a lap in progress: t, seconds into the lap
  record(t, p, q) {
    if (t < this.at + EVERY - 1e-6) return;
    this.at = t;
    this.rec.push(t, p.x, p.y, p.z, q.x, q.y, q.z, q.w);
  }

  // a lap's done: keep it if it's the best valid one. Then a new lap starts.
  lap(valid, time) {
    if (valid && this.key && (!this.best || time < this.best.time) && this.rec.length > 80) {
      this.best = { time, s: Float32Array.from(this.rec) };
      try { localStorage.setItem(STORE + this.key, JSON.stringify({ time, s: Array.from(this.best.s, v => Math.round(v * 1000) / 1000) })); } catch { /* full */ }
    }
    this.restart();
  }
  restart() { this.rec = []; this.at = -1; }

  // where the ghost is t seconds into its lap (hidden off its lap)
  show(on, t) {
    const g = this.best, o = this.object;
    if (!o) return;
    o.visible = !!(on && g && t != null && t >= 0 && t <= g.time);
    if (!o.visible) return;
    const s = g.s, n = s.length / 8;
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (s[m * 8] <= t) lo = m; else hi = m; }
    const a = lo * 8, b = hi * 8, k = s[b] > s[a] ? Math.min(1, Math.max(0, (t - s[a]) / (s[b] - s[a]))) : 0;
    o.position.set(s[a + 1] + (s[b + 1] - s[a + 1]) * k, s[a + 2] + (s[b + 2] - s[a + 2]) * k, s[a + 3] + (s[b + 3] - s[a + 3]) * k);
    qa.set(s[a + 4], s[a + 5], s[a + 6], s[a + 7]); qb.set(s[b + 4], s[b + 5], s[b + 6], s[b + 7]);
    o.quaternion.slerpQuaternions(qa, qb, k);
  }
}
const qa = new THREE.Quaternion(), qb = new THREE.Quaternion();
