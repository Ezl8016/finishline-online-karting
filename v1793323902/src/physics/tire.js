// Pacejka "Magic Formula" tyre with load sensitivity, combined slip and
// first-order relaxation. Parameters approximate a hard-compound 5" rental
// kart tyre (10x4.50-5 front / 11x7.10-5 rear) on dry asphalt.

export const SURFACES = {
  asphalt: { mu: 1.0, rolling: 0.018, shape: 1.0 },
  kerb:    { mu: 0.88, rolling: 0.022, shape: 1.0 },
  grass:   { mu: 0.52, rolling: 0.085, shape: 0.8 },
};

function magic(x, B, C, D, E) {
  const Bx = B * x;
  return D * Math.sin(C * Math.atan(Bx - E * (Bx - Math.atan(Bx))));
}

// Solve for B so the curve peaks at `peak` (E shifts the peak, so search).
function stiffnessForPeak(C, E, peak) {
  let lo = 0.1, hi = 200;
  const peakOf = (B) => {
    let best = 0, at = 0;
    for (let i = 1; i <= 400; i++) {
      const x = (i / 400) * 1.0;
      const f = magic(x, B, C, 1, E);
      if (f > best) { best = f; at = x; }
    }
    return at;
  };
  for (let k = 0; k < 40; k++) {
    const mid = 0.5 * (lo + hi);
    if (peakOf(mid) > peak) lo = mid; else hi = mid;
  }
  return 0.5 * (lo + hi);
}

export class TyreModel {
  constructor(o) {
    this.radius = o.radius;
    this.Fz0 = o.Fz0;                 // nominal load (N)
    this.muX = o.muX; this.muY = o.muY;
    this.loadSens = o.loadSens;       // fractional mu drop per unit of Fz/Fz0 above nominal
    this.Cx = o.Cx; this.Ex = o.Ex; this.kPeak = o.kPeak;
    this.Cy = o.Cy; this.Ey = o.Ey; this.aPeak = o.aPeak;
    this.Bx = stiffnessForPeak(this.Cx, this.Ex, this.kPeak);
    this.By = stiffnessForPeak(this.Cy, this.Ey, this.aPeak);
    this.relaxLat = o.relaxLat;       // m
    this.relaxLong = o.relaxLong;
  }

  // Returns [Fx, Fy, utilisation] for slip ratio k, slip angle a (rad), load
  // Fz, surface and temperature grip factor.
  forces(k, a, Fz, surf, grip = 1) {
    if (Fz <= 0) return [0, 0, 0];
    const dfz = (Fz - this.Fz0) / this.Fz0;
    const sens = Math.max(0.6, 1 - this.loadSens * dfz);
    const Dx = this.muX * surf.mu * sens * grip * Fz;
    const Dy = this.muY * surf.mu * sens * grip * Fz;
    // normalised combined slip (similarity method)
    const sx = k / this.kPeak;
    const sy = Math.tan(a) / Math.tan(this.aPeak);
    const rho = Math.hypot(sx, sy);
    if (rho < 1e-6) return [0, 0, 0];
    const Fx0 = magic(rho * this.kPeak, this.Bx, this.Cx * surf.shape + (1 - surf.shape), 1, this.Ex);
    const Fy0 = magic(Math.atan(rho * Math.tan(this.aPeak)), this.By, this.Cy * surf.shape + (1 - surf.shape), 1, this.Ey);
    const Fx = (sx / rho) * Fx0 * Dx;
    const Fy = (sy / rho) * Fy0 * Dy;
    return [Fx, Fy, rho];
  }
}

// ---------------------------------------------------------------------------
// Tyre temperature. A hard rental compound gives full grip across a wide
// window (~52-85 C / 126-185 F). At Biloxi ambient (~29 C) it has 80% grip;
// above the window it fades only gently - rental tyres get greasy, they
// don't fall off a cliff. Most sliding energy goes into the track surface
// and tyre wear, not tread temperature.
export const TYRE_TEMP = {
  ambient: 29,
  windowLow: 52,
  windowHigh: 85,
  coldGrip: 0.80,          // grip factor at ambient
  hotGripMin: 0.88,        // worst case when badly overheated
  heatCapacity: 380,       // J/K, effective tread layer (most of the way in one lap)
  slipShare: 0.4,          // share of sliding power that ends up in the tread
  rollingHeat: 0.016,      // carcass flex: W per (N load x m/s)
  cooling: [2.5, 0.45],    // W/K = a + b * speed
  max: 120,
};

export function gripFromTemp(T) {
  const t = TYRE_TEMP;
  if (T < t.windowLow) {
    const x = Math.max(0, (t.windowLow - T) / (t.windowLow - t.ambient));
    return 1 - (1 - t.coldGrip) * x * x;
  }
  if (T <= t.windowHigh) return 1;
  const x = (T - t.windowHigh) / 35;
  return Math.max(t.hotGripMin, 1 - (1 - t.hotGripMin) * x * x);
}

// Front: narrower 4.5" tyre. Rear: 7.1" tyre. Rental compound on a well
// rubbered-in outdoor track: ~1.4 g sustained when warm (what it takes
// to match FLP's real 30-35 s Tidal Turns laps), gentle fall-off once sliding.
export const FRONT_TYRE = {
  radius: 0.130, Fz0: 520, muX: 1.34, muY: 1.39, loadSens: 0.13,
  Cx: 1.65, Ex: 0.10, kPeak: 0.11,
  Cy: 1.42, Ey: 0.15, aPeak: 0.105,
  relaxLat: 0.11, relaxLong: 0.08,
};
export const REAR_TYRE = {
  radius: 0.140, Fz0: 700, muX: 1.51, muY: 1.74, loadSens: 0.10,
  Cx: 1.65, Ex: 0.10, kPeak: 0.10,
  Cy: 1.45, Ey: 0.15, aPeak: 0.10,
  relaxLat: 0.13, relaxLong: 0.08,
};
