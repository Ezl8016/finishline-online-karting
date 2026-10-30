// The AI drivers in a server: "Race the AI" (offline), or added by the host
// of an online server, next to the players. The room lists them (room.bots,
// made by botSpec); each is a player as far as the rest of the game knows:
// its kart is drawn like anyone's (RemoteKart, from the state it sends), it
// qualifies, lines up on the grid, races, and its finish goes out like a
// player's. The host's computer drives them: their karts are real ones in
// its physics world (so you can bump them, and they you), each driven by an
// AIDriver (ai.js). When the host changes, the new host takes them over from
// where they are.

import * as THREE from 'three';
import { KartPhysics, draftOf } from './physics/kart.js';
import { AIDriver, racingLine } from './ai.js';
import { HELMET_DEFAULT, DESIGNS, VISORS } from './driver.js';
import { SUITS } from './suits.js';
import { LIVERIES } from './paint.js';
import { hitboxOf } from './hitbox.js';

export const DIFFICULTY = { easy: 0.86, medium: 0.93, hard: 1.0 };
const SEND = { offline: 1 / 30, online: 1 / 20 };     // s between position packets
// each kart's cornering grip (g), measured on the skidpad (tools: weight test)
const GRIP = { r25: 1.42, honda: 1.45, lo206: 1.44, ka100: 1.59 };
const NAMES = ['Castillo', 'Okafor', 'Lindqvist', 'Moreau', 'Tanaka', 'Brennan', 'Petrov', 'Alvarez', 'Novak', 'Haddad', 'Kowalski', 'Ferreira'];
const COLOURS = ['#c8102e', '#0d2c6c', '#141414', '#f4f4f4', '#1f7a3a', '#f28c00', '#5b2a86', '#f2c200', '#1f5fd0', '#8a1c2b', '#2e9e9e', '#d94f9b'];
const r3 = (x) => Math.round(x * 1000) / 1000;
const pickOf = (a) => a[Math.floor(Math.random() * a.length)];
const pickKey = (o) => pickOf(Object.keys(o).filter(x => x !== 'none'));

// A new AI driver for a room's list: a name not taken yet (`taken`: names in
// the room), its kart (null: the room's), weight, helmet, suit and paint
export function botSpec(kart, taken = []) {
  const free = NAMES.filter(n => !taken.some(t => t.startsWith(n)));
  const col = () => pickOf(COLOURS), kg = 68 + Math.random() * 26;
  return {
    id: `ai-${Math.random().toString(36).slice(2, 7)}`, name: `${pickOf(free.length ? free : NAMES)} (AI)`, uid: null, kart, lb: Math.round(kg * 2.2046),
    edge: Math.random() * 0.035,               // (a little slower than the level, some more than others)
    look: { ...HELMET_DEFAULT, design: pickKey(DESIGNS), visor: pickKey(VISORS), primary: col(), secondary: col(), accent: '#141414',
      suit: col(), suitDesign: pickKey(SUITS), suit2: col(), suit3: pickOf(['#141414', '#f4f4f4']), gloves: col(), number: String(10 + Math.floor(Math.random() * 89)), hat: 'none' },
    paint: { paintOn: true, paint: col(), trimOn: false, trim: '#f4f4f4', finish: 'gloss', livery: pickKey(LIVERIES), livery2: col() },
  };
}

export class Bots {
  // ctx: { RAPIER, world, surfaceAt, groundAt, garage, remote(id), race(),
  //   line(), trackWidth, gridPose(slot), CP, simTime(), msg(m), state(id, d),
  //   send({ id: state }), wet(), online }
  constructor(ctx) {
    this.ctx = ctx;
    this.list = [];
    this.sendAt = 0;
  }

  has(id) { return this.list.some(b => b.id === id); }

  // drive the room's AI drivers: specs from room.bots, all at `level`, in
  // `roomKart` (or each their own). New ones start on a grid spot, or where
  // their kart is now if someone else was driving them (`remote`).
  sync(specs, level, roomKart) {
    const c = this.ctx, want = new Set(specs.map(s => s.id));
    for (const b of this.list.filter(x => !want.has(x.id))) this.remove(b);
    specs.forEach((spec, i) => {
      let b = this.list.find(x => x.id === spec.id);
      const e = c.garage.entries.find(x => x.id === (roomKart || spec.kart)) || c.garage.current();
      if (!b) b = this.add(spec, e, i);
      else if (b.kartId !== e.id) this.setKart(b, e);
      const skill = (DIFFICULTY[level] ?? DIFFICULTY.medium) - (spec.edge ?? 0);
      if (b.ai.skill !== skill) { b.ai.skill = skill; b.ai.plan(); }
    });
  }

  add(spec, e, i) {
    const c = this.ctx, kg = (spec.lb || 175) / 2.2046;
    const k = new KartPhysics(c.RAPIER, c.world, c.surfaceAt, c.groundAt);
    k.contactKey = spec.id;
    const ai = new AIDriver(racingLine(c.line(), c.trackWidth), { skill: DIFFICULTY.medium, grip: GRIP[e.id] ?? 1.42, lane: (i % 3 - 1) * 0.6, width: c.trackWidth });
    const b = { id: spec.id, k, ai, kg, kartId: null, race: null, laps: 0, prevIdx: 0, lapAt: null, qBest: null, stuck: 0, hulls: false };
    this.setKart(b, e);
    this.list.push(b);
    if (!this.takeOver(b)) this.place(b, c.gridPose(i + 1));     // (spread out on the grid for practice)
    return b;
  }

  setKart(b, e) {
    const k = b.k;
    k.pt.setEngine(e.engine); k.setChassisMass(e.chassisKg); k.setDragArea(e.dragArea); k.setTyreGrip(e.tyreGrip);
    k.setFootprint(e.footprint); k.setDriverMass(b.kg);
    b.kartId = e.id; b.hulls = false;
    b.ai.grip = GRIP[e.id] ?? 1.42; b.ai.plan();
  }

  // carry on from the last we heard of it (another host was driving it)
  takeOver(b) {
    const c = this.ctx, r = c.remote(b.id), d = r?.last;
    if (!d || r.age > 3) return false;
    const [qx, qy, qz, qw] = d.q;
    b.k.place(d.p[0], d.p[2], Math.atan2(2 * (qx * qz + qw * qy), 1 - 2 * (qx * qx + qy * qy)));
    b.k.body.setLinvel({ x: d.v[0], y: 0, z: d.v[2] }, true);
    b.ai.idx = 0; b.ai.lost = true; b.ai.locate(d.p[0], d.p[2]); b.prevIdx = b.ai.idx;
    const race = c.race();
    if (race && d.r === race.id) {
      const grid = race.phase !== 'quali' && !!race.grid?.includes(b.id), pr = d.pr ?? 0;
      b.race = { id: race.id, quali: race.phase === 'quali', grid, laps: grid ? Math.max(0, Math.floor(pr)) : 0, ci: d.ci ?? null,
        cps: new Map(r.cps || []), best: null, done: race.fin?.has(b.id) ?? false };
      b.laps = pr >= 0 ? Math.floor(pr) + 1 : 0;
      b.qBest = d.qb ?? null;
      // (its lap so far, roughly, so the next time over the line still counts)
      if (b.laps) b.lapAt = c.simTime() - (pr - Math.floor(pr)) * 30;
    }
    return true;
  }

  remove(b) {
    this.ctx.world.removeRigidBody(b.k.body);
    this.list.splice(this.list.indexOf(b), 1);
  }
  clear() { for (const b of [...this.list]) this.remove(b); }

  place(b, pose) {
    b.k.place(pose.x, pose.z, pose.heading);
    b.ai.idx = 0; b.ai.lost = true;
    b.ai.locate(pose.x, pose.z);
    b.prevIdx = b.ai.idx;
  }

  // the layout changed
  setLine(center) {
    const line = racingLine(center, this.ctx.trackWidth);
    for (const b of this.list) { b.ai.setLine(line); b.ai.lost = true; }
  }

  // each physics step. drivers: the players' karts ({ id, x, z, vx, vz }), to drive round
  step(dt, drivers = []) {
    const c = this.ctx, race = c.race(), wet = c.wet();
    const others = this.list.map(b => { const t = b.k.body.translation(), v = b.k.body.linvel(); return { id: b.id, x: t.x, z: t.z, vx: v.x, vz: v.z }; });
    others.push(...drivers);
    for (const b of this.list) {
      if (b.k.wet !== wet) { b.k.wet = wet; b.ai.grip = (GRIP[b.kartId] ?? 1.42) * (wet ? 0.74 : 1); b.ai.plan(); }
      const rest = others.filter(o => o.id !== b.id);
      let cmd = b.ai.control(b.k, rest);
      // in someone's slipstream, as a player's kart is
      { const me = others.find(o => o.id === b.id); b.k.draft = (b.k.draft || 0) + (draftOf(me, rest) - (b.k.draft || 0)) * Math.min(1, dt * 1.2); }
      // held on the grid until the lights go out; easing off after the flag
      if (b.race?.grid && race?.goAt == null) cmd = { steer: 0, throttle: 0, brake: 1 };
      else if (b.race?.done) cmd = { ...cmd, throttle: Math.min(cmd.throttle, 0.4) };
      b.k.step(dt, cmd);
      // over the line (checked every step, so lap times are exact)
      const n = b.ai.n;
      if (b.prevIdx > n * 0.8 && b.ai.idx < n * 0.2) this.crossed(b, c.simTime());
      b.prevIdx = b.ai.idx;
    }
  }

  // each frame: laps, timing, what each sends, and getting unstuck
  frame(dt, now) {
    const c = this.ctx, race = c.race(), sim = c.simTime(), out = {};
    this.sendAt -= dt;
    const send = this.sendAt <= 0;
    if (send) this.sendAt = c.online ? SEND.online : SEND.offline;
    for (const b of this.list) {
      // its own kart's shape, once its model's in
      if (!b.hulls) { const r = c.remote(b.id), h = r?.visual && hitboxOf(b.kartId, r.visual.object); if (h) { b.k.setHitbox(h); b.hulls = true; } }
      // into this session: qualifying, or onto its grid spot (also when
      // qualifying turns into the race: the same session, now on the grid)
      if (race && (b.race?.id !== race.id || (b.race.quali && race.phase !== 'quali'))) {
        const slot = race.grid ? race.grid.indexOf(b.id) : -1;
        b.race = { id: race.id, quali: race.phase === 'quali', grid: slot >= 0 && race.phase !== 'quali', laps: 0, ci: null, cps: new Map(), best: null, done: false };
        b.qBest = null; b.lapAt = null; b.laps = 0;
        if (b.race.grid) this.place(b, c.gridPose(slot));
      }
      if (!race) b.race = null;
      const n = b.ai.n, idx = b.ai.idx, t = b.k.body.translation();
      // stuck (or lost far off the track): back on its line
      const sp = b.k.speed;
      b.stuck = sp < 0.8 && !(b.race?.grid && race?.goAt == null) ? b.stuck + dt : 0;
      const p = b.ai.line[idx];
      if (b.stuck > 4 || Math.hypot(p[0] - t.x, p[1] - t.z) > 14) {
        const q = b.ai.line[(idx + 3) % n];
        this.place(b, { x: p[0], z: p[1], heading: Math.atan2(-(q[0] - p[0]), -(q[1] - p[1])) });
        b.stuck = 0;
      }
      // its progress and timing, as a player's game sends them
      const f = idx / n, prog = b.laps === 0 ? (f > 0.5 ? f - 1 : f) : b.laps - 1 + f;
      const racing = b.race?.grid && race?.goAt != null && race.phase === 'race';
      if (racing && !b.race.done) {
        const ci = Math.floor(prog * c.CP);
        if (b.race.ci == null) b.race.ci = ci;
        while (b.race.ci < ci) { b.race.ci++; b.race.cps.set(b.race.ci, sim - race.goAt); }
      }
      if (send) {
        const q = b.k.body.rotation(), v = b.k.body.linvel(), w = b.k.body.angvel();
        out[b.id] = { t: Math.round(now), p: [r3(t.x), r3(t.y), r3(t.z)], q: [r3(q.x), r3(q.y), r3(q.z), r3(q.w)], v: [r3(v.x), r3(v.y), r3(v.z)], w: r3(w.y),
          st: r3(b.k.steer), sp: r3(b.k.forwardSpeed), lg: r3(b.k.accel.x), g: 0,
          r: b.race && (b.race.quali || b.race.grid) ? b.race.id : 0,
          pr: b.race?.grid ? (b.race.done ? race.laps + 1 : prog) : 0,
          ci: b.race?.grid ? b.race.ci : null, ct: b.race?.grid && b.race.ci != null ? b.race.cps.get(b.race.ci) ?? 0 : null,
          qb: b.race?.quali ? b.qBest : null };
        c.state(b.id, out[b.id]);
      }
    }
    if (send && this.list.length) c.send(out);
  }

  // over the line: a lap done (the first crossing starts lap 1)
  crossed(b, sim) {
    const c = this.ctx, race = c.race();
    if (b.lapAt != null) {
      const lap = sim - b.lapAt;
      if (b.race?.quali && race?.phase === 'quali') b.qBest = Math.min(b.qBest ?? Infinity, lap);
      if (b.race?.grid && race?.goAt != null && !b.race.done) {
        b.race.laps++;
        b.race.best = Math.min(b.race.best ?? Infinity, lap);
        if (b.race.laps >= race.laps) {
          b.race.done = true;
          c.msg({ type: 'fin', from: b.id, race: race.id, name: c.name(b.id), time: sim - race.goAt, best: b.race.best });
        }
      }
    }
    b.lapAt = sim;
    b.laps++;
  }
}
