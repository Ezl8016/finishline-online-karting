// Walking round the clubhouse and its patio, first person: WASD or the
// arrows (Shift to hurry), the mouse to look (click to take it; Esc lets it
// go), E to sit down on a free seat near you and again to stand; or a
// controller: left stick to walk, right stick to look, A to sit or stand.
// You can't walk through walls, furniture or the patio fence, out of the
// patio and the walkway, or (unless you're an admin) into the office.

import * as THREE from 'three';

const EYE = 1.62, SIT_EYE = 0.72, R = 0.28, WALK = 1.5, RUN = 3.2;

export class Walker {
  // I: the interior (clubhouse.js); out: { inPatio(x, z), fences: [[x0, z0, x1, z1]], groundAt }; admin: may open the office
  constructor(I, out, canvas) {
    this.I = I; this.out = out; this.canvas = canvas;
    this.x = I.spawn.x; this.z = I.spawn.z; this.y = I.F; this.yaw = I.spawn.yaw; this.pitch = 0;
    this.seat = null; this.admin = false; this.step = 0; this.moving = 0;
    this.heading = this.yaw;         // the way the body faces: the way you last walked
    this.look = (e) => {
      if (document.pointerLockElement !== canvas) return;
      this.yaw -= e.movementX * 0.0024;
      this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch - e.movementY * 0.0024));
    };
    this.lock = () => { if (!this.paused) canvas.requestPointerLock?.(); };
    addEventListener('mousemove', this.look);
    canvas.addEventListener('click', this.lock);
  }

  dispose() {
    removeEventListener('mousemove', this.look);
    this.canvas.removeEventListener('click', this.lock);
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
  }

  // every wall segment that applies here (upstairs or down; the office door, upstairs, unless you're an admin)
  walls() {
    const I = this.I, up = this.y > I.F + I.UP / 2, list = [...I.walls, ...this.out.fences];
    if (up) list.push(...I.upWalls); else list.push(...(I.lowWalls || []));
    if (up && !this.admin) { const d = I.office.door; list.push([d.x, d.z - d.w / 2, d.x, d.z + d.w / 2]); }
    return list;
  }

  // push (x, z) out of walls and furniture
  collide(x, z) {
    for (let it = 0; it < 3; it++) {
      for (const [ax, az, bx, bz] of this.walls()) {
        const dx = bx - ax, dz = bz - az, L2 = dx * dx + dz * dz || 1;
        const t = Math.max(0, Math.min(1, ((x - ax) * dx + (z - az) * dz) / L2));
        const px = ax + dx * t, pz = az + dz * t, d = Math.hypot(x - px, z - pz);
        if (d < R && d > 1e-6) { x = px + (x - px) / d * R; z = pz + (z - pz) / d * R; }
      }
      if (this.y < this.I.F + this.I.UP / 2) for (const s of this.I.solids) {
        const c = Math.cos(s.yaw || 0), sn = Math.sin(s.yaw || 0);
        const lx = (x - s.x) * c - (z - s.z) * sn, lz = (x - s.x) * sn + (z - s.z) * c;
        const hx = s.w / 2 + R, hz = s.d / 2 + R;
        if (Math.abs(lx) < hx && Math.abs(lz) < hz) {
          const px = hx - Math.abs(lx), pz = hz - Math.abs(lz);
          let nx = lx, nz = lz;
          if (px < pz) nx = Math.sign(lx) * hx; else nz = Math.sign(lz) * hz;
          x = s.x + nx * c + nz * sn; z = s.z - nx * sn + nz * c;
        }
      }
    }
    return [x, z];
  }

  // the nearest free seat within reach
  nearSeat(taken = new Set()) {
    let best = null, bd = 1.3;
    for (const s of this.I.seats) {
      if (taken.has(s) || (s.office && !this.admin)) continue;
      if (Math.abs(s.y - (this.y + 0.5)) > 1.2) continue;
      const d = Math.hypot(s.x - this.x, s.z - this.z);
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  sitOrStand() {
    if (this.seat) {
      // stand up a step in front of the seat (or, if that's no good, where you sat down from)
      const s = this.seat; this.seat = null;
      const [x, z] = this.collide(s.x + Math.sin(s.yaw) * 0.7, s.z + Math.cos(s.yaw) * 0.7);
      if (this.I.inside(x, z) || this.out.inPatio(x, z)) { this.x = x; this.z = z; }
      return;
    }
    const s = this.nearSeat();
    if (s) { this.seat = s; this.yaw = this.heading = s.yaw + Math.PI; this.pitch = -0.05; }
  }

  // keys: a Set of KeyboardEvent codes; pad: { x, y, lx, ly } sticks (or null)
  update(dt, keys, pad) {
    if (pad) { this.yaw -= pad.rx * 2.4 * dt; this.pitch = Math.max(-1.3, Math.min(1.3, this.pitch - pad.ry * 1.8 * dt)); }
    this.moving = 0;
    if (this.seat) return;
    let f = 0, s = 0;
    if (keys.has('KeyW') || keys.has('ArrowUp')) f += 1;
    if (keys.has('KeyS') || keys.has('ArrowDown')) f -= 1;
    if (keys.has('KeyA') || keys.has('ArrowLeft')) s -= 1;
    if (keys.has('KeyD') || keys.has('ArrowRight')) s += 1;
    if (pad) { f -= pad.ly; s += pad.lx; }
    const mag = Math.hypot(f, s);
    if (mag > 0.15) {
      const run = keys.has('ShiftLeft') || keys.has('ShiftRight') || mag > 1.2;
      const sp = (run ? RUN : WALK) * Math.min(1, mag) / Math.max(1, mag);
      const fx = -Math.sin(this.yaw), fz = -Math.cos(this.yaw), rx = -fz, rz = fx;
      const dx = fx * f + rx * s, dz = fz * f + rz * s;
      this.heading = Math.atan2(-dx, -dz);
      let x = this.x + dx * sp * dt, z = this.z + dz * sp * dt;
      [x, z] = this.collide(x, z);
      // outside: the patio and the walkway only
      if (!this.I.inside(x, z) && !this.out.inPatio(x, z)) { x = this.x; z = this.z; }
      this.x = x; this.z = z;
      this.moving = sp;
      this.step += sp * dt;
    }
    // the floor (or the patio) under you, eased onto (stairs)
    const want = this.I.inside(this.x, this.z) ? this.I.floorAt(this.x, this.z, this.y) : this.out.groundAt(this.x, this.z) + 0.03;
    this.y += (want - this.y) * Math.min(1, dt * 12);
  }

  // where your eyes are, and the way you're looking
  camera(cam) {
    const s = this.seat, eye = s ? s.y + SIT_EYE : this.y + EYE + Math.sin(this.step * 5.5) * 0.025 * Math.min(1, this.moving);
    cam.position.set(s ? s.x : this.x, eye, s ? s.z : this.z);
    cam.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
  }

  // what others see: where you stand (feet), which way your body faces, sitting
  get state() { const s = this.seat; return { x: s ? s.x : this.x, y: s ? s.y : this.y, z: s ? s.z : this.z, yaw: this.heading, sit: !!s, moving: this.moving }; }
}
