// AI drivers. Each drives a real kart (KartPhysics, the same as yours) round
// a racing line (racingLine, below): it plans how fast each part of the lap can be
// taken (from how tight it is and how hard the kart can brake towards it),
// steers for a point ahead on its own line through the corners, and moves
// over to get round, or out of the way of, the kart in front. Skill scales
// how close to the kart's limit it drives.

const G = 9.81;

// A racing line: the centreline pulled straight wherever the track's width
// allows (each point eased towards the middle of its neighbours, at
// shrinking scales, never closer than `margin` to the edge), so it sweeps
// wide into a corner, clips the inside and runs wide out of it.
export function racingLine(center, width, margin = 0.7) {
  const n = center.length, half = width / 2 - margin;
  const nx = new Float32Array(n), nz = new Float32Array(n), off = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const a = center[(i - 1 + n) % n], b = center[(i + 1) % n];
    const tx = b[0] - a[0], tz = b[1] - a[1], tl = Math.hypot(tx, tz) || 1;
    nx[i] = -tz / tl; nz[i] = tx / tl;               // right of travel
  }
  let step = 0;
  for (let i = 0; i < n; i++) { const a = center[i], b = center[(i + 1) % n]; step += Math.hypot(b[0] - a[0], b[1] - a[1]); }
  step /= n;
  const P = (i) => { const c = center[i]; return [c[0] + nx[i] * off[i], c[1] + nz[i] * off[i]]; };
  for (const span of [14, 9, 6, 4]) {
    const k = Math.max(1, Math.round(span / step));
    for (let it = 0; it < 120; it++) {
      for (let i = 0; i < n; i++) {
        const a = P((i - k + n) % n), b = P((i + k) % n), c = center[i];
        const want = ((a[0] + b[0]) / 2 - c[0]) * nx[i] + ((a[1] + b[1]) / 2 - c[1]) * nz[i];
        off[i] = Math.max(-half, Math.min(half, off[i] + (want - off[i]) * 0.5));
      }
    }
  }
  return Array.from({ length: n }, (_, i) => P(i));
}

export class AIDriver {
  // line: the centreline [[x, z], ...] in driving order; opts: skill (0.8
  // easy .. 1 the limit), grip (the kart's cornering grip in g), lane (m off
  // the line, + right), width (of the track, m)
  constructor(line, opts = {}) {
    this.skill = opts.skill ?? 0.9;
    this.grip = opts.grip ?? 1.4;
    this.home = opts.lane ?? 0;        // where it likes to be across the track
    this.lane = this.home;
    this.width = opts.width ?? 6.8;
    this.react = opts.react ?? 0.1;    // s it looks ahead on its speed plan (a moment to react)
    this.brakeG = opts.brake ?? 0.55;  // how hard the kart can brake (g; rear brakes only)
    this.idx = 0;
    this.setLine(line);
  }

  setLine(line) {
    const n = this.n = line.length;
    this.line = line;
    // distance along, heading, and curvature (smoothed over a few metres)
    const s = this.s = new Float32Array(n + 1), hd = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const a = line[i], b = line[(i + 1) % n];
      s[i + 1] = s[i] + Math.hypot(b[0] - a[0], b[1] - a[1]);
      hd[i] = Math.atan2(b[0] - a[0], b[1] - a[1]);
    }
    this.len = s[n];
    const step = this.len / n, w = Math.max(2, Math.round(4 / step));
    const k = this.k = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      let d = hd[(i + w) % n] - hd[(i - w + n) % n];
      d = Math.atan2(Math.sin(d), Math.cos(d));
      k[i] = d / (2 * w * step);       // + turning left (heading measured from +Z towards +X)
    }
    this.plan();
    this.idx = 0;
  }

  // how fast each point can be taken: cornering grip, then braking back from
  // every slower point ahead
  plan() {
    const n = this.n, v = this.v = new Float32Array(n);
    const aLat = this.grip * G * this.skill, aBrk = this.brakeG * G * this.skill;
    for (let i = 0; i < n; i++) v[i] = Math.min(40, Math.sqrt(aLat / Math.max(Math.abs(this.k[i]), 1e-3)));
    for (let pass = 0; pass < 2; pass++) {
      for (let i = n - 1; i >= 0; i--) {
        const j = (i + 1) % n, ds = this.len / n;
        v[i] = Math.min(v[i], Math.sqrt(v[j] * v[j] + 2 * aBrk * ds));
      }
    }
  }

  // nearest point on the line, searching near the last one
  locate(x, z) {
    let best = Infinity, bi = this.idx;
    const span = this.lost ? this.n : 40;
    for (let d = -span; d <= span; d++) {
      const i = ((this.idx + d) % this.n + this.n) % this.n, p = this.line[i];
      const e = (p[0] - x) ** 2 + (p[1] - z) ** 2;
      if (e < best) { best = e; bi = i; }
    }
    this.lost = best > 400;
    this.idx = bi;
    return bi;
  }

  // a point on its line, `ahead` metres on from index i
  target(i, ahead) {
    const n = this.n;
    let j = i, d = 0;
    while (d < ahead) { const a = this.line[j], b = this.line[(j + 1) % n]; d += Math.hypot(b[0] - a[0], b[1] - a[1]); j = (j + 1) % n; }
    const a = this.line[j], b = this.line[(j + 1) % n];
    const tx = b[0] - a[0], tz = b[1] - a[1], tl = Math.hypot(tx, tz) || 1;
    // (the right of travel along (tx, tz), as for a kart: right = (-forward z, forward x))
    const rx = -tz / tl, rz = tx / tl;
    return [a[0] + rx * this.lane, a[1] + rz * this.lane, j];
  }

  // this step's controls. kart: KartPhysics; others: [{ x, z, vx, vz }]
  control(kart, others = []) {
    const t = kart.body.translation(), q = kart.body.rotation(), v = kart.body.linvel();
    const fx = -2 * (q.x * q.z + q.w * q.y), fz = -(1 - 2 * (q.x * q.x + q.y * q.y));     // forward (-Z of the kart)
    const fl = Math.hypot(fx, fz) || 1, ux = fx / fl, uz = fz / fl, rx = -uz, rz = ux;   // right
    const speed = Math.hypot(v.x, v.z);
    const i = this.locate(t.x, t.z);
    // traffic: a kart close ahead and slower, or alongside: move over
    let want = this.home;
    for (const o of others) {
      const dx = o.x - t.x, dz = o.z - t.z, along = dx * ux + dz * uz, side = dx * rx + dz * rz;
      if (along < -1.5 || along > 9 || Math.abs(side) > 2.2) continue;
      const closing = speed - (o.vx * ux + o.vz * uz);
      if (along > 2 && closing < 0.5) continue;
      want = Math.max(-this.width * 0.36, Math.min(this.width * 0.36, this.lane + (side > 0 ? -1.8 : 1.8)));
    }
    this.lane += (want - this.lane) * 0.02;
    // steering: pure pursuit of a point ahead
    const L = 2.2 + speed * 0.2;
    const [tx, tz] = this.target(i, L);
    const dx = tx - t.x, dz = tz - t.z;
    const alpha = Math.atan2(dx * rx + dz * rz, dx * ux + dz * uz);
    const wb = 1.05;
    const delta = Math.atan2(2 * wb * Math.sin(alpha), Math.max(L, 1));
    const steer = Math.max(-1, Math.min(1, delta / 0.45));
    // speed: the plan a little ahead (it needs time to brake)
    const look = Math.min(this.n - 1, Math.round((speed * this.react) / (this.len / this.n)));
    let vt = Infinity;
    for (let k = 0; k <= look + 1; k++) vt = Math.min(vt, this.v[(i + k) % this.n]);
    if (this.lost) vt = Math.min(vt, 6);
    let throttle = 0, brake = 0;
    if (speed < vt + 0.6) throttle = Math.max(0, Math.min(1, 0.55 + (vt - speed) * 0.9));
    else brake = Math.min(1, (speed - vt - 0.6) / 3);
    // sliding: ease off
    const slip = speed > 3 ? Math.abs(v.x * rx + v.z * rz) / speed : 0;
    if (slip > 0.22) throttle *= 0.5;
    return { steer, throttle, brake };
  }

  // laps done and how far round: for the timing (0..1 of a lap)
  get frac() { return this.s[this.idx] / this.len; }
}
