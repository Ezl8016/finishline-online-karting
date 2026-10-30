// Tony Kart OTK Viper (rental) vehicle model on a Rapier rigid body.
//
// Rapier handles the chassis' rigid-body motion and collisions (bumpers vs
// tyre walls, rollovers). Everything a kart's handling depends on is modelled
// here: tyre vertical compliance standing in for chassis flex, caster jacking
// that unloads the inside rear, a SOLID rear axle (no differential), a
// centrifugal clutch, rear-only disc brake, aero drag and rolling resistance.
//
// Local frame: origin at the centre of mass, -Z forward, +X right, +Y up.

import { TyreModel, FRONT_TYRE, REAR_TYRE, SURFACES, TYRE_TEMP, gripFromTemp } from './tire.js';
import { Powertrain } from './powertrain.js';

export const KART = {
  chassisMass: 168,         // Viper w/ GX390 + chain (~160 kg with GX270 + belt per OTK)
  driverMass: 80,           // the nominal set-up; setDriverMass() changes it
  kartCg: { h: 0.17, z: -0.04 },   // kart alone: CG height, fore/aft (m, +z = rear)
  driverCg: { h: 0.48, z: 0.084 }, // seated driver's own CG
  cgHeight: 0.27,           // above ground, kart + seated driver
  rearWeight: 0.58,
  wheelbase: 1.05,
  trackFront: 1.00,         // tyre centreline to centreline
  trackRear: 1.17,
  inertia: { pitch: 46, yaw: 56, roll: 18 },   // kg m^2 incl. driver
  // N/m effective vertical rate (tyre + frame). The front is stiffer so it
  // takes a bigger share of the cornering weight transfer - the rental
  // set-up that keeps a solid-axle kart from snapping into oversteer.
  tyreK: { front: 110000, rear: 72000 },
  tyreC: 1700,              // N s/m
  casterJack: 0.06,         // m of inside-front "leg" growth per rad of steer:
                            // lifts the inside rear in corners, like a real kart
  balanceOffset: 1.0,
  maxSteer: 0.45,           // rad, centre-equivalent road-wheel angle at full lock
  ackermann: 1.0,
  CdA: 0.78, rho: 1.18,     // upright driver, ~31 C Gulf Coast air
  frontSpinI: 0.035,
};

const SUBSTEPS = 8;

// driving assists: rear wheel slip where anti-lock eases the brake and where
// traction eases the gas, the share of the rear tyres' grip the brake may
// use, the least gas traction lets through, and the speed it starts at (m/s)
const ASSIST = { lock: 0.12, spin: 0.13, brakeShare: 1.0, minGas: 0.45, tcFrom: 5 };
// rollover guard (see the end of step): tilt where it starts (rad), righting
// torque and roll/pitch damping per kg of kart + driver, and the fastest an
// impact can send the kart upward (m/s)
const ROLL_GUARD = { from: 0.35, right: 8, damp: 0.8, maxRise: 3.5 };

export class KartPhysics {
  constructor(RAPIER, world, surfaceAt, groundAt = () => 0) {
    this.R = RAPIER;
    this.world = world;
    this.surfaceAt = surfaceAt;     // (x, z) -> surface key
    this.groundAt = groundAt;       // (x, z) -> ground height (m); grass sits a little low
    this.tyreGrip = 1;              // the kart's tyre compound against the hard rental one
    this.weightGrip = 1;            // (setDriverMass)
    this.wet = false;               // a wet track: much less grip on the pavement, a little less on grass
    const k = KART;
    this.mass = k.chassisMass + k.driverMass;
    const a = k.wheelbase * k.rearWeight;          // CG -> front axle
    const b = k.wheelbase - a;                      // CG -> rear axle
    const tf = new TyreModel(FRONT_TYRE), tr = new TyreModel(REAR_TYRE);
    const h = k.cgHeight;
    // hub positions in the local frame (wheel centre)
    this.wheels = [
      { name: 'FL', front: true,  left: true,  pos: [-k.trackFront / 2, tf.radius - h, -a], tyre: tf },
      { name: 'FR', front: true,  left: false, pos: [ k.trackFront / 2, tf.radius - h, -a], tyre: tf },
      { name: 'RL', front: false, left: true,  pos: [-k.trackRear / 2,  tr.radius - h,  b], tyre: tr },
      { name: 'RR', front: false, left: false, pos: [ k.trackRear / 2,  tr.radius - h,  b], tyre: tr },
    ];
    for (const w of this.wheels) {
      Object.assign(w, { omega: 0, angle: 0, steer: 0, Fz: 0, Fx: 0, Fy: 0, alpha: 0, kappa: 0,
        util: 0, surface: 'asphalt', contact: false, compression: 0,
        temp: TYRE_TEMP.ambient, grip: gripFromTemp(TYRE_TEMP.ambient), balanceGrip: 1 });
    }
    this.setBalance(0);
    this.pt = new Powertrain();
    this.steer = 0;
    this.throttle = 0; this.brake = 0;
    // driving assists (set from main.js: on for controller, keyboard and touch)
    this.assist = null;            // { abs, tc }
    this.absK = 1; this.tcK = 1;   // how much brake / gas the assists let through
    this.rear = this.wheels.filter(w => !w.front);
    this.accel = { x: 0, z: 0 };    // local g's for the g-meter
    this.speed = 0;
    this.forwardSpeed = 0;
    this._lastV = null;

    const R = RAPIER;
    const bodyDesc = R.RigidBodyDesc.dynamic()
      .setAdditionalMassProperties(this.mass, { x: 0, y: 0, z: 0 },
        { x: k.inertia.pitch, y: k.inertia.yaw, z: k.inertia.roll }, { x: 0, y: 0, z: 0, w: 1 })
      .setCanSleep(false).setCcdEnabled(true).setAngularDamping(0.02);
    this.body = world.createRigidBody(bodyDesc);
    // floor pan + perimeter bumpers: as big as the kart (setFootprint), 40 mm
    // ground clearance so it never scrapes under a heavy driver
    this.world = world;
    this.chassis = null;
    this.setFootprint();
    // driver + seat, so rollovers land on something
    this.seat = world.createCollider(R.ColliderDesc.cuboid(0.24, 0.32, 0.30).setTranslation(0, 0.55 - h, 0.20)
      .setDensity(0).setFriction(0.5).setRestitution(0.05), this.body);
    this.setDriverMass(k.driverMass);
  }

  place(x, z, heading) {
    // heading: yaw angle so local -Z points along (sin(-h)... ) — use quaternion about Y
    const half = heading / 2;
    this.body.setTranslation({ x, y: this.groundAt(x, z) + KART.cgHeight + 0.01, z }, true);
    this.body.setRotation({ x: 0, y: Math.sin(half), z: 0, w: Math.cos(half) }, true);
    this.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    this.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    for (const w of this.wheels) { w.omega = 0; w.alpha = 0; w.kappa = 0; }
    this.pt.reset();
    this._lastV = null;
  }

  // Driver weight (kg) from the lobby. Mass, centre of gravity (moving back
  // with a heavier driver, but no higher than with the nominal one, so a
  // heavy driver can't tip a kart over) and inertia all follow; the engine
  // and tyres make up for the weight (below), so it's an even contest.
  setDriverMass(kg) {
    const k = KART, cm = this.chassisMass ?? k.chassisMass;
    const M = cm + kg;
    const hOf = (d) => (cm * k.kartCg.h + d * k.driverCg.h) / (cm + d);
    const h = Math.min(hOf(kg), hOf(k.driverMass));
    const z = (cm * k.kartCg.z + kg * k.driverCg.z) / M;
    // body origin is the nominal (80 kg) CG at cgHeight above the ground
    const f = M / (k.chassisMass + k.driverMass);
    this.mass = M;
    this.driverMass = kg;
    // a heavier driver isn't left behind: the engine pulls the extra weight
    // (a touch more than that, so heavy is slightly quicker off the corners;
    // top speed is still the governor's), and the extra load on the tyres
    // gives a little more grip
    const over = Math.max(-1, Math.min(1.5, (kg - k.driverMass) / 56));
    this.pt.boost = Math.pow(M / (cm + k.driverMass), 0.8) * (1 + 0.01 * over);
    this.weightGrip = 1 + 0.12 * over;
    this.body.setAdditionalMassProperties(M, { x: 0, y: h - k.cgHeight, z },
      { x: k.inertia.pitch * f, y: k.inertia.yaw * f, z: k.inertia.roll * f }, { x: 0, y: 0, z: 0, w: 1 }, true);
  }

  // The kart's outline on the ground (catalog "footprint": width, length and
  // where its middle is, metres), a box hitbox until setHitbox has the
  // model's own shape. Default: the Viper, 1.40 x 1.94 m.
  setFootprint(fp) {
    const [w, l, cz] = fp || [1.40, 1.94, 0.02];
    this.footprint = [w, l, cz];
    const h = KART.cgHeight;
    this.setHitbox([[[-w / 2, 0.04 - h, cz - l / 2], [w / 2, 0.30 - h, cz + l / 2]]], true);
  }

  // The hitbox for walls, barriers, tyres and other karts: convex pieces
  // around the kart's model (hitbox.js), or [min, max] corners of a box.
  setHitbox(hulls, box = false) {
    for (const c of this.hitColliders || []) this.world.removeCollider(c, true);
    this.hitColliders = [];
    for (const pts of hulls) {
      const d = box
        ? this.R.ColliderDesc.cuboid((pts[1][0] - pts[0][0]) / 2, (pts[1][1] - pts[0][1]) / 2, (pts[1][2] - pts[0][2]) / 2)
          .setTranslation((pts[0][0] + pts[1][0]) / 2, (pts[0][1] + pts[1][1]) / 2, (pts[0][2] + pts[1][2]) / 2)
        : this.R.ColliderDesc.convexHull(pts);
      if (!d) continue;
      this.hitColliders.push(this.world.createCollider(d.setDensity(0).setFriction(0.35).setRestitution(0.15), this.body));
    }
    this.chassis = this.hitColliders[0];
  }

  wetGrip(w) { return this.wet ? (w.surface === 'grass' ? 0.85 : 0.72) : 1; }

  // Drag area (m^2): a racing kart's laid-back seat and fairings cut it.
  setDragArea(cda) { this.CdA = cda || KART.CdA; }

  // Tyre compound: 1 is the hard rental tyre; a racing kart's softer tyres
  // grip harder (models/catalog.json "tyreGrip").
  setTyreGrip(g) { this.tyreGrip = g || 1; }

  // Kart weight without the driver (kg): a racing chassis is far lighter
  // than the rental Viper.
  setChassisMass(kg) {
    this.chassisMass = kg || KART.chassisMass;
    this.setDriverMass(this.driverMass);
  }

  // Handling balance from the lobby: -3 (understeer) .. +3 (oversteer).
  // Moves grip between the axles, as a kart set-up change (front/rear track
  // width, caster) would.
  // 0 is a mildly understeering rental set-up (internally balanceOffset
  // steps toward understeer from the tyres' raw balance), so flooring it at
  // the grip limit pushes wide instead of spinning; +3 lets the rear step out.
  setBalance(b) {
    this.balance = b;
    const x = b - KART.balanceOffset;
    for (const w of this.wheels) w.balanceGrip = w.front ? 1 + 0.035 * x : 1 - 0.045 * x;
  }

  // Spin the kart round where it stands (and set it back on its wheels).
  // Tyre temperatures are kept: it's the same set of tyres.
  turnAround() {
    const t = this.body.translation(), q = this.body.rotation();
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
    const temps = this.wheels.map(w => w.temp);
    this.place(t.x, t.z, yaw + Math.PI);
    this.wheels.forEach((w, i) => { w.temp = temps[i]; w.grip = gripFromTemp(w.temp); });
  }

  // Steering geometry: centre angle -> Ackermann inner/outer road-wheel angles.
  applySteer(input) {
    const k = KART;
    const d = input * k.maxSteer;
    this.steer = d;
    const fl = this.wheels[0], fr = this.wheels[1];
    if (Math.abs(d) < 1e-4) { fl.steer = fr.steer = 0; return; }
    const R = k.wheelbase / Math.tan(Math.abs(d));
    const inner = Math.atan(k.wheelbase / (R - k.trackFront / 2));
    const outer = Math.atan(k.wheelbase / (R + k.trackFront / 2));
    const innerA = Math.abs(d) + k.ackermann * (inner - Math.abs(d));
    const outerA = Math.abs(d) + k.ackermann * (outer - Math.abs(d));
    // positive input = steer right: right wheel is inner. Steering right
    // rotates the wheel heading clockwise seen from above = negative yaw.
    if (d > 0) { fr.steer = -innerA; fl.steer = -outerA; }
    else { fl.steer = innerA; fr.steer = outerA; }
  }

  step(dt, input) {
    const k = KART;
    // OTK "cut-off": throttle and brake can't be applied together
    this.brake = input.brake;
    this.throttle = input.brake > 0.05 ? 0 : input.throttle;
    this.applySteer(input.steer);

    const body = this.body;
    const t = body.translation(), q = body.rotation();
    const com = body.worldCom();     // moves with driver weight
    const v = body.linvel(), wv = body.angvel();
    const rot = (x, y, z) => {
      const ix = q.w * x + q.y * z - q.z * y, iy = q.w * y + q.z * x - q.x * z;
      const iz = q.w * z + q.x * y - q.y * x, iw = -q.x * x - q.y * y - q.z * z;
      return [ix * q.w + iw * -q.x + iy * -q.z - iz * -q.y,
              iy * q.w + iw * -q.y + iz * -q.x - ix * -q.z,
              iz * q.w + iw * -q.z + ix * -q.y - iy * -q.x];
    };
    const right = rot(1, 0, 0), fwd = rot(0, 0, -1);
    body.resetForces(true);
    body.resetTorques(true);

    // ---- 1. contact geometry and vertical load per wheel
    const steerMag = Math.abs(this.steer);
    for (const w of this.wheels) {
      const r = rot(w.pos[0], w.pos[1], w.pos[2]);
      const hub = [t.x + r[0], t.y + r[1], t.z + r[2]];
      // caster jacking: the inside front spindle drops as you steer
      let leg = w.tyre.radius;
      if (w.front && steerMag > 1e-3) {
        const inside = (this.steer > 0) !== w.left;
        leg += (inside ? 0.5 : -0.5) * k.casterJack * steerMag;
      }
      const gy = this.groundAt(hub[0], hub[2]);
      const pen = leg - (hub[1] - gy);
      w.cp = [hub[0], gy, hub[2]];
      // ground normal: on a slope (the hill, the grass lip) the tyre load
      // pushes back at an angle, so climbing costs speed and gravity pulls
      // the kart down the fall line
      const e = 0.12;
      const gx = (this.groundAt(hub[0] + e, hub[2]) - this.groundAt(hub[0] - e, hub[2])) / (2 * e);
      const gz = (this.groundAt(hub[0], hub[2] + e) - this.groundAt(hub[0], hub[2] - e)) / (2 * e);
      const nl = Math.hypot(gx, 1, gz);
      w.n = [-gx / nl, 1 / nl, -gz / nl];
      const rr = [w.cp[0] - com.x, gy - com.y, w.cp[2] - com.z];
      const pv = [v.x + wv.y * rr[2] - wv.z * rr[1], v.y + wv.z * rr[0] - wv.x * rr[2], v.z + wv.x * rr[1] - wv.y * rr[0]];
      w.contact = pen > 0;
      w.compression = Math.max(0, pen);
      w.Fz = w.contact ? Math.max(0, Math.min((w.front ? k.tyreK.front : k.tyreK.rear) * pen - k.tyreC * pv[1], 9000)) : 0;
      if (w.Fz <= 0) w.contact = false;

      const cs = Math.cos(w.steer), sn = Math.sin(w.steer);
      const hf = [fwd[0] * cs - right[0] * sn, 0, fwd[2] * cs - right[2] * sn];
      const n = Math.hypot(hf[0], hf[2]) || 1; hf[0] /= n; hf[2] /= n;
      w.hf = hf;
      w.hr = [-hf[2], 0, hf[0]];
      w.vLong = pv[0] * hf[0] + pv[2] * hf[2];
      w.vLat = pv[0] * w.hr[0] + pv[2] * w.hr[2];
      w.surface = this.surfaceAt(w.cp[0], w.cp[2]);
      w._sx = 0; w._sy = 0;
    }

    // ---- 2. tyre slip + wheel spin, substepped (front wheels spin freely,
    //         rear wheels share one solid axle driven through the clutch)
    const subDt = dt / SUBSTEPS;
    const RL = this.wheels[2], RR = this.wheels[3];
    for (let s = 0; s < SUBSTEPS; s++) {
      let axleTorque = 0;
      for (const w of this.wheels) {
        const omega = w.front ? w.omega : this.pt.wa;
        if (!w.contact) {
          if (w.front) w.omega *= 0.999;
          continue;
        }
        const surf = SURFACES[w.surface];
        const speed = Math.abs(w.vLong);
        const denom = Math.max(speed, 1.2);
        const relax = Math.max(Math.hypot(w.vLong, w.vLat), 0.6) * subDt;
        w.alpha += (Math.atan2(w.vLat, denom) - w.alpha) * Math.min(1, relax / w.tyre.relaxLat);
        w.kappa += ((omega * w.tyre.radius - w.vLong) / denom - w.kappa) * Math.min(1, relax / w.tyre.relaxLong);
        const [Fx, FyRaw, u] = w.tyre.forces(w.kappa, w.alpha, w.Fz, surf, w.grip * w.balanceGrip * this.tyreGrip * this.weightGrip * this.wetGrip(w));
        let Fy = -FyRaw;
        // near standstill, hold the kart with static friction instead of slip
        if (speed < 0.6) {
          const blend = 1 - speed / 0.6;
          const lim = surf.mu * 1.1 * w.Fz;
          Fy = Fy * (1 - blend) + Math.max(-lim, Math.min(lim, -w.vLat * 2500)) * blend;
        }
        w._sx += Fx; w._sy += Fy; w.util = u;
        if (w.front) w.omega += subDt * (-Fx * w.tyre.radius) / k.frontSpinI;
        else axleTorque -= Fx * w.tyre.radius;
      }
      // assists: ease the brake before the rear wheels lock (they grip best
      // at ~10% slip), and the gas before they spin or while the rear is
      // already sliding under power
      let thr = this.throttle, brk = this.brake;
      if (this.assist) {
        const [rl, rr] = this.rear;
        const kap = (rl.kappa + rr.kappa) / 2;
        if (this.assist.abs) {
          // never more brake than the rear tyres can take on this surface
          // with the weight on them now, and back off further if they start
          // to lock anyway
          let cap = 0;
          for (const w of this.rear) if (w.contact) cap += w.tyre.muX * SURFACES[w.surface].mu * w.grip * w.balanceGrip * this.tyreGrip * this.weightGrip * this.wetGrip(w) * w.Fz * w.tyre.radius;
          this.absK = kap < -ASSIST.lock ? Math.max(0, this.absK - 40 * subDt) : kap > -ASSIST.lock * 0.6 ? Math.min(1, this.absK + 3 * subDt) : this.absK;
          brk = Math.min(brk, ASSIST.brakeShare * cap / this.pt.brakeMax) * this.absK;
        }
        // (not pulling away: wheelspin from a standstill is no slide, and the
        // slip reading is inflated near zero speed)
        if (this.assist.tc && this.speed > ASSIST.tcFrom) {
          // (only real wheelspin, and never so little gas the clutch lets go)
          this.tcK = kap > ASSIST.spin ? Math.max(ASSIST.minGas, this.tcK - 10 * subDt) : Math.min(1, this.tcK + 3 * subDt);
          thr *= this.tcK;
        }
      }
      this.pt.step(subDt, thr, brk, axleTorque);
    }
    RL.omega = RR.omega = this.pt.wa;

    // ---- 3. apply averaged tyre forces at the contact patches, and heat the tyres
    const TT = TYRE_TEMP;
    for (const w of this.wheels) {
      const v = Math.hypot(w.vLong, w.vLat);
      let heat = 0;
      if (w.contact) {
        const slipV = (w.front ? w.omega : this.pt.wa) * w.tyre.radius - w.vLong;
        heat = TT.slipShare * (Math.abs((w._sx / SUBSTEPS) * slipV) + Math.abs((w._sy / SUBSTEPS) * w.vLat))
             + TT.rollingHeat * w.Fz * Math.abs(w.vLong);
      }
      // convective cooling grows with airspeed, and radiation/conduction
      // into the rim make very hot rubber shed heat much faster
      const dT = w.temp - TT.ambient;
      const cool = (TT.cooling[0] + TT.cooling[1] * v) * dT + 0.004 * dT * Math.abs(dT);
      w.temp = Math.min(TT.max, w.temp + dt * (heat - cool) / TT.heatCapacity);
      w.grip = gripFromTemp(w.temp);
      if (!w.contact) { w.Fx = w.Fy = 0; w.util = 0; continue; }
      w.Fx = w._sx / SUBSTEPS;
      w.Fy = w._sy / SUBSTEPS;
      const surf = SURFACES[w.surface];
      const Fx = w.Fx - surf.rolling * w.Fz * Math.tanh(w.vLong / 0.4);
      const n = w.n;
      body.addForceAtPoint(
        { x: w.hf[0] * Fx + w.hr[0] * w.Fy + w.Fz * n[0], y: w.Fz * n[1], z: w.hf[2] * Fx + w.hr[2] * w.Fy + w.Fz * n[2] },
        { x: w.cp[0], y: w.cp[1], z: w.cp[2] }, true);
    }

    // ---- aero drag
    const sp = Math.hypot(v.x, v.y, v.z);
    if (sp > 0.01) {
      const f = -0.5 * k.rho * (this.CdA ?? k.CdA) * (1 - (this.draft || 0)) * sp;     // (less in another kart's slipstream: draftOf)
      body.addForceAtPoint({ x: f * v.x, y: f * v.y, z: f * v.z }, { x: t.x, y: t.y + 0.25, z: t.z }, true);
    }

    // ---- rollover guard: a kart sits low and wide and almost never rolls,
    // but a light, fast one hitting tyres or a barrier got flung over. Past
    // 20 degrees of tilt the roll and pitch spin is damped and the kart eased
    // back onto its wheels, and an impact can't throw it upward hard.
    // Slides and spins (yaw) on the ground are untouched.
    const up = rot(0, 1, 0);
    const tilt = Math.acos(Math.max(-1, Math.min(1, up[1])));
    if (tilt > ROLL_GUARD.from) {
      const ax = -up[2], az = up[0], al = Math.hypot(ax, az) || 1;   // up x worldUp: the way back upright
      const kT = ROLL_GUARD.right * this.mass * (tilt - ROLL_GUARD.from), kD = ROLL_GUARD.damp * this.mass;
      body.addTorque({ x: kT * ax / al - kD * wv.x, y: 0, z: kT * az / al - kD * wv.z }, true);
    }
    if (v.y > ROLL_GUARD.maxRise) body.setLinvel({ x: v.x, y: ROLL_GUARD.maxRise, z: v.z }, true);

    for (const w of this.wheels) w.angle += w.omega * dt;

    // local accelerations for the g-meter (smoothed)
    if (this._lastV) {
      const ax = (v.x - this._lastV.x) / dt, az = (v.z - this._lastV.z) / dt;
      const lat = ax * right[0] + az * right[2], lon = ax * fwd[0] + az * fwd[2];
      this.accel.x += (lat / 9.81 - this.accel.x) * 0.05;
      this.accel.z += (lon / 9.81 - this.accel.z) * 0.05;
    }
    this._lastV = { x: v.x, y: v.y, z: v.z };
    this.speed = Math.hypot(v.x, v.z);
    this.forwardSpeed = v.x * fwd[0] + v.z * fwd[2];
  }
}

// Drafting: a kart close behind another, lined up with it, is in its
// slipstream and meets less air: up to DRAFT.max less drag about 2 m back,
// fading to none by DRAFT.far or a kart's width to the side. Light: on a
// lap tucked in behind someone it's worth about a tenth of a second: enough to
// close up and try a pass, never a launch.
export const DRAFT = { max: 0.12, near: 2.0, far: 9, side: 0.9 };
// me: { x, z, vx, vz }; others: [{ x, z, vx, vz }]; the share of drag saved (0..DRAFT.max)
export function draftOf(me, others) {
  const sp = Math.hypot(me.vx, me.vz);
  if (sp < 6) return 0;
  const fx = me.vx / sp, fz = me.vz / sp;
  let best = 0;
  for (const o of others) {
    const dx = o.x - me.x, dz = o.z - me.z, along = dx * fx + dz * fz, side = Math.abs(dx * -fz + dz * fx);
    if (along < DRAFT.near || along > DRAFT.far || side > DRAFT.side) continue;
    const os = Math.hypot(o.vx, o.vz);
    if (os < 5 || (o.vx * fx + o.vz * fz) / os < 0.9) continue;               // going the same way
    const k = DRAFT.max * (1 - (along - DRAFT.near) / (DRAFT.far - DRAFT.near)) * (1 - side / DRAFT.side);
    if (k > best) best = k;
  }
  return best;
}
