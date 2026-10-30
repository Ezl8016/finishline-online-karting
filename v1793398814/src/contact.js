// Contact between karts. Each kart's hitbox is its model's own shape
// (hitbox.js). Every other player's kart is in our physics world as that
// shape, moved each step to where it is now; it pushes nothing by itself, but
// where it touches ours we work the hit out as two real karts colliding (both
// masses, how fast they close, where on each kart it lands) and our kart
// takes its share. Their game does the same for theirs. So a tap on the back
// pushes the kart in front on and slows the one behind, a hit on a rear corner
// turns the kart (a PIT), and the push stays flat: nobody gets launched.

import * as THREE from 'three';
import { KART } from './physics/kart.js';

// pushMax: the most the overlap is fixed by in one step (m): their kart's
// shown a little off where it really is (it takes time to hear where it
// went), so nose to tail the overlap comes back every step; unlimited, fixing
// it every step carried the kart in front along like a boost
export const CONTACT = { e: 0.25, mu: 0.7, slop: 0.004, push: 0.8, pushMax: 0.002, driverKg: 75 };
const yawI = (kg) => KART.inertia.yaw * kg / (KART.chassisMass + KART.driverMass);
const q1 = new THREE.Quaternion(), wp = new THREE.Vector3(), nn = new THREE.Vector3();

export class Contacts {
  constructor(RAPIER, world) {
    this.R = RAPIER; this.world = world;
    this.solids = new Map();           // their id -> { body, cols, key }
    this.hitAt = new Map();            // their id -> when we last took a hit from them (per kart of ours: `${kart.contactKey}|${id}`)
    this.stats = { hits: 0, peakJ: 0, touch: 0 };
  }

  // their kart's body in our world, in the shape `hulls` (key: which shape)
  solidOf(id, hulls, key) {
    let s = this.solids.get(id);
    if (s && s.key === key) return s;
    if (!s) {
      s = { body: this.world.createRigidBody(this.R.RigidBodyDesc.kinematicPositionBased()), cols: [], key };
      this.solids.set(id, s);
    }
    for (const c of s.cols) this.world.removeCollider(c, false);
    s.key = key;
    s.cols = hulls.map(pts => this.R.ColliderDesc.convexHull(pts))
      .filter(Boolean).map(d => this.world.createCollider(d.setSolverGroups(0), s.body));
    return s;
  }
  drop(id) {
    const s = this.solids.get(id);
    if (s) this.world.removeRigidBody(s.body);
    this.solids.delete(id);
    for (const k of [...this.hitAt.keys()]) if (k.endsWith(`|${id}`)) this.hitAt.delete(k);
  }

  // One physics step for our kart against the others: each other is
  // { id, hulls, key, solid, p: Vector3, q: Quaternion (where it is now),
  //   v: [x, y, z], w: yaw rate, kg, sent: when their newest news was sent }.
  // now: the time, on the same clock as `sent`. onHit(id, closing m/s, nx,
  // nz, other) for each hit that pushed us.
  //
  // After a hit, what we know of them is from before it (it takes a moment to
  // hear how it moved them), so it's not taken again: we wait for news sent
  // after the hit before they can push us any more.
  step(kart, others, now, onHit) {
    const t = kart.body.translation(), v = kart.body.linvel(), w = kart.body.angvel();
    for (const o of others) {
      const s = this.solidOf(o.id, o.hulls, o.key);
      s.body.setNextKinematicTranslation({ x: o.p.x, y: o.p.y, z: o.p.z });
      s.body.setNextKinematicRotation({ x: o.q.x, y: o.q.y, z: o.q.z, w: o.q.w });
      for (const c of s.cols) c.setEnabled(o.solid);
      if (!o.solid) continue;
      const hk = `${kart.contactKey ?? ''}|${o.id}`;
      if (o.sent < (this.hitAt.get(hk) ?? -Infinity)) continue;
      // every touching point between our pieces and theirs: the deepest, and
      // the average place and way apart (from us towards them)
      let deep = 0, n = 0, nx = 0, nz = 0, px = 0, pz = 0;
      for (const a of kart.hitColliders) for (const b of s.cols) {
        this.world.contactPair(a, b, (mf, flipped) => {
          const k = mf.numContacts();
          if (!k) return;
          // (in the first shape's own space: turned into the world's)
          const c1 = flipped ? b : a, ct = c1.translation(), cr = c1.rotation(), sg = flipped ? -1 : 1;
          q1.set(cr.x, cr.y, cr.z, cr.w);
          const ln = mf.localNormal1();
          nn.set(ln.x, ln.y, ln.z).applyQuaternion(q1);
          for (let i = 0; i < k; i++) {
            const d = mf.contactDist(i);
            if (d > 0.002) continue;
            const lp = mf.localContactPoint1(i);
            wp.set(lp.x, lp.y, lp.z).applyQuaternion(q1);
            const wgt = Math.max(0.001, -d);
            nx += nn.x * sg * wgt; nz += nn.z * sg * wgt;
            px += (wp.x + ct.x) * wgt; pz += (wp.z + ct.z) * wgt; n += wgt;
            deep = Math.max(deep, -d);
          }
        });
      }
      if (!n) continue;
      this.stats.touch++;
      const nl = Math.hypot(nx, nz);
      if (nl < 1e-6) continue;
      nx /= nl; nz /= nl; px /= n; pz /= n;
      // the two karts at the contact point
      const m1 = kart.mass, m2 = o.kg, I1 = yawI(m1), I2 = yawI(m2);
      const r1x = px - t.x, r1z = pz - t.z, r2x = px - o.p.x, r2z = pz - o.p.z;
      // (velocity of a point: v + w x r, about the vertical)
      const v1x = v.x + w.y * r1z, v1z = v.z - w.y * r1x;
      const v2x = o.v[0] + o.w * r2z, v2z = o.v[2] - o.w * r2x;
      const rvx = v1x - v2x, rvz = v1z - v2z, vn = rvx * nx + rvz * nz;
      if (vn > 0) {
        const c1 = r1z * nx - r1x * nz, c2 = r2z * nx - r2x * nz;
        const j = (1 + CONTACT.e) * vn / (1 / m1 + 1 / m2 + c1 * c1 / I1 + c2 * c2 / I2);
        let jx = -j * nx, jz = -j * nz;
        // rubbing: sideways friction at the contact, up to mu of the hit
        const tx = rvx - vn * nx, tz = rvz - vn * nz, tl = Math.hypot(tx, tz);
        if (tl > 1e-4) {
          const ux = tx / tl, uz = tz / tl, d1 = r1z * ux - r1x * uz, d2 = r2z * ux - r2x * uz;
          const jt = Math.min(CONTACT.mu * j, tl / (1 / m1 + 1 / m2 + d1 * d1 / I1 + d2 * d2 / I2));
          jx -= jt * ux; jz -= jt * uz;
        }
        kart.body.applyImpulseAtPoint({ x: jx, y: 0, z: jz }, { x: px, y: t.y, z: pz }, true);
        this.stats.hits++; this.stats.peakJ = Math.max(this.stats.peakJ, j);
        this.hitAt.set(hk, now);
        onHit?.(o.id, vn, nx, nz, o);
      }
      // out of each other: our share of the overlap
      if (deep > CONTACT.slop) {
        const k = Math.min(CONTACT.pushMax, (deep - CONTACT.slop) * CONTACT.push * m2 / (m1 + m2));     // (at most ~0.5 m/s)
        kart.body.setTranslation({ x: t.x - nx * k, y: t.y, z: t.z - nz * k }, true);
      }
    }
  }
}
