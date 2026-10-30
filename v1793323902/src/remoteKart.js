// Another player's kart: their kart model in their paint, their driver in
// their helmet and suit, and a name tag. (Hitting it is worked out in
// main.js: its shape is in our physics world, but the hit is shared out by
// both karts' masses, not taken like a wall.)
//
// Positions arrive 20 times a second, a little late. The kart is drawn (and
// bumped) where it should be *now*: the newest position carried on
// at its speed and turn rate, with any jump from a correction smoothed out
// over a tenth of a second, so what you see is what you hit.

import * as THREE from 'three';
import { loadKartModel, finishKart } from './kartModel.js';
import { RacingDriver } from './driverModel.js';
import { applyPaint } from './paint.js';
import { KART } from './physics/kart.js';

const Y = new THREE.Vector3(0, 1, 0);
const qTmp = new THREE.Quaternion();
const WHEEL_R = 0.14;            // m, for spinning the wheels from the speed
const SMOOTH = 0.1;              // s to blend away a correction
const SNAP = 4;                  // m: further off than this, jump straight there

function nameTag(text, gold = false) {
  const c = document.createElement('canvas');
  c.width = 512; c.height = 96;
  const g = c.getContext('2d');
  g.font = 'italic 900 52px "Arial Black", Arial, sans-serif';
  const w = Math.min(500, g.measureText(text).width + 48);
  g.fillStyle = gold ? 'rgba(40,30,8,0.85)' : 'rgba(12,16,20,0.7)';
  g.beginPath(); g.roundRect((512 - w) / 2, 10, w, 76, 14); g.fill();
  if (gold) { g.strokeStyle = '#e2b33c'; g.lineWidth = 5; g.stroke(); }
  g.fillStyle = gold ? '#e2b33c' : '#d42a2a'; g.fillRect((512 - w) / 2 + 14, 22, 6, 52);
  g.fillStyle = gold ? '#ffd76a' : '#fff'; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.fillText(text, 256 + 6, 50, 450);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: t, depthWrite: false, transparent: true }));
  s.scale.set(1.6, 0.3, 1);
  s.position.set(0, 1.25, 0);
  s.renderOrder = 10;
  return s;
}

export class RemoteKart {
  constructor({ id, meta, scene, envMap, garage, kart }) {
    this.id = id;
    this.meta = meta;
    this.name = meta.name;
    this.scene = scene;
    this.group = new THREE.Group();
    this.group.visible = false;               // until the first position
    scene.add(this.group);
    this.driver = new RacingDriver();
    this.driver.setEnvMap(envMap);
    this.driver.setHelmet(meta.look || {});
    this.driver.setWeight(meta.lb || 175);
    this.group.add(this.driver.object);
    this.tag = nameTag(meta.name);
    this.group.add(this.tag);
    this.visual = null;
    this.ghost = false;
    this.last = null;                          // newest state
    this.off = null;                           // their clock -> ours (ms)
    this.errP = new THREE.Vector3();
    this.errQ = new THREE.Quaternion();
    this.p = new THREE.Vector3();
    this.q = new THREE.Quaternion();
    this.fake = { wheels: [0, 1, 2, 3].map(() => ({ angle: 0, steer: 0 })) };
    this.solid = false;              // can be bumped (not see-through)
    this.hidden = false;             // stewarding: out of their kart
    this.garage = garage; this.envMap = envMap;
    this.setKart(kart ?? meta.kart);
  }

  // which kart they're in: their own, or the one the host picked for everyone
  setKart(id) {
    if (id === this.kartId) return;
    this.kartId = id;
    this.load(this.garage, this.envMap, id);
  }

  async load(garage, envMap, id) {
    // their kart if it's one of the bundled ones (an imported model only exists on their computer)
    const bundled = garage.entries.filter(e => e.kind === 'bundled');
    const e = bundled.find(x => x.id === id) || bundled[0];
    if (!e) return;
    const seq = this.loadSeq = (this.loadSeq ?? 0) + 1;
    const opts = { yawDegrees: e.yawDegrees ?? 180 };
    if (e.textures) opts.textures = e.textures;
    if (e.sideLogos) opts.sideLogos = e.sideLogos;
    if (e.numbers) opts.numbers = e.numbers;
    if (e.numberBoxes) opts.numberBoxes = e.numberBoxes;
    try {
      const v = await loadKartModel(e.file, opts);
      if (this.disposed || seq !== this.loadSeq) return;
      if (this.visual) this.group.remove(this.visual.object);
      v.object.traverse((o) => {
        if (o.isMesh) o.material = Array.isArray(o.material) ? o.material.map(m => m.clone()) : o.material.clone();
      });
      finishKart(v.object, envMap);
      const named = e.paintMaterials || e.paintMasks ? { paint: e.paintMaterials || [], trim: e.trimMaterials || [], masks: e.paintMasks } : null;
      if (this.meta.paint) applyPaint(v.object, this.meta.paint, named);
      v.setNumber(this.meta.look?.number);
      this.visual = v;
      this.shownId = e.id;             // (the kart shown: an imported one shows as a bundled one)
      this.group.add(v.object);
      this.setGhost(this.ghost, true);
    } catch (err) { console.warn('remote kart', err); }
  }

  // a state packet: { t, p, q, v, w, st, sp, ... }
  push(d, now) {
    if (!d?.p) return;
    const sample = now - d.t;
    this.off = this.off == null || sample < this.off ? sample : this.off + (sample - this.off) * 0.002;
    // where we were showing it vs where the new state says it is now: keep
    // the difference and blend it away
    const shown = this.last ? this.p.clone() : null, shownQ = this.q.clone();
    this.last = d;
    this.predict(now, this.p, this.q, false);
    if (shown && shown.distanceTo(this.p) < SNAP) {
      this.errP.copy(shown).sub(this.p);
      this.errQ.copy(this.q).invert().premultiply(shownQ);   // shown = err * predicted
    } else { this.errP.set(0, 0, 0); this.errQ.identity(); }
    this.group.visible = true;
  }

  get age() { return this.last ? (performance.now() - this.off - this.last.t) / 1000 : Infinity; }

  // where the kart is at time `now` (ms, our clock)
  predict(now, outP, outQ, withErr = true) {
    const d = this.last;
    const age = Math.min(0.3, Math.max(0, (now - this.off - d.t) / 1000));
    outP.set(d.p[0] + d.v[0] * age, d.p[1] + d.v[1] * age, d.p[2] + d.v[2] * age);
    outQ.set(d.q[0], d.q[1], d.q[2], d.q[3]).premultiply(qTmp.setFromAxisAngle(Y, (d.w || 0) * age));
    if (withErr) { outP.add(this.errP); outQ.premultiply(this.errQ); }
  }

  setSolid(on) { this.solid = on; }

  // a confirmed admin: gold name tag, and their admin-only helmet and hat
  setAdmin(look) {
    this.group.remove(this.tag);
    this.tag.material.map.dispose();
    this.tag = nameTag(this.name, true);
    this.group.add(this.tag);
    if (look) this.driver.setHelmet(look);
  }

  // see-through while it can't be hit (just joined, reset, or not in this race)
  setGhost(on, force = false) {
    if (on === this.ghost && !force) return;
    this.ghost = on;
    this.group.traverse((o) => {
      if (!o.isMesh || o === this.tag) return;
      for (const m of [].concat(o.material)) {
        const base = m.userData.base ??= { t: m.transparent, o: m.opacity, dw: m.depthWrite };
        m.transparent = on || base.t;
        m.opacity = on ? 0.35 * base.o : base.o;
        m.depthWrite = on ? false : base.dw;
        m.needsUpdate = true;
      }
      o.castShadow = !on;
    });
  }

  render(dt, now) {
    if (!this.last) return;
    const k = Math.exp(-dt / SMOOTH);
    this.errP.multiplyScalar(k);
    this.errQ.slerp(new THREE.Quaternion(), 1 - k);
    this.predict(now, this.p, this.q);
    this.group.position.copy(this.p);
    this.group.quaternion.copy(this.q);
    const d = this.last, steer = d.st || 0;
    for (const [i, w] of this.fake.wheels.entries()) {
      w.angle += ((d.sp || 0) / WHEEL_R) * dt;
      w.steer = i < 2 ? steer : 0;
    }
    // the driver model loads after the kart: give it the same see-through look
    if (this.driver.ready !== this._driverReady) { this._driverReady = this.driver.ready; this.setGhost(this.ghost, true); }
    // out of the kart, in the clubhouse: walking about (wk 1) or sitting down (wk 2)
    if (d.wk) {
      if (this.visual) this.visual.object.visible = false;
      this.group.quaternion.setFromAxisAngle(Y, d.yaw || 0);
      this.tag.position.y = 2.15;
      if (d.wk === 2) { this.group.position.y += 0.2; this.driver.update(0, 0, 'CHASE'); }
      else { this.stride = (this.stride || 0) + (d.mv || 0) * dt * 5.5; this.driver.stand(d.mv > 0.1 ? 'walk' : 'idle', this.stride); }
      this.group.visible = this.age < 3 && !this.hidden;
      return;
    }
    if (this.visual) { this.visual.object.visible = true; this.visual.animate(this.fake, steer / KART.maxSteer); }
    this.tag.position.y = 1.25;
    this.driver.update(steer / KART.maxSteer, d.lg || 0, 'CHASE');
    // long silence (they tabbed away or lost connection): hide them
    this.group.visible = this.age < 3 && !this.hidden;
  }

  dispose() {
    this.disposed = true;
    this.scene.remove(this.group);
    this.tag.material.map.dispose();
  }
}
