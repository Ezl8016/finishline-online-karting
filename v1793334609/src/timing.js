// Lap timing on the Tidal Turns centreline: three sectors, best laps kept per
// browser, laps invalidated if all four wheels leave the pavement.

const STORE = 'tidalturns.best.v3';   // + layout and direction: each keeps its own records

// Track limits are lenient because the pavement traced from the satellite
// photo doesn't match the real circuit everywhere: the kart has to be well
// clear of the traced track, not just over the edge, and stay out a while.
const LIMIT_MARGIN = 1.5;   // m beyond the traced pavement edge
const LIMIT_GRACE = 0.75;   // s with all four wheels off before the lap is lost

export const fmt = (t) => {
  if (t == null || !isFinite(t)) return '--:--.---';
  const m = Math.floor(t / 60), s = t - m * 60;
  return `${String(m).padStart(2, '0')}:${s.toFixed(3).padStart(6, '0')}`;
};

export class LapTimer {
  constructor(track) {
    this.c = track.centerline;
    this.n = this.c.length;
    this.limit = (track.trackWidth || 6.8) / 2 + LIMIT_MARGIN;
    this.sectorIdx = track.sectors;          // indices where S2 and S3 start
    this.idx = 0;
    this.lap = 0;                            // 0 = out lap
    this.lapStart = null;
    this.sectorStart = null;
    this.sector = 0;
    this.sectors = [null, null, null];
    this.last = null;
    this.offTime = 0;
    this.invalid = false;
    this.events = [];
    let saved = null;
    // the short track keeps its original key; other layouts add their id
    this.store = `${STORE}.${track.layout && track.layout !== 'short' ? track.layout + '.' : ''}${track.direction || 'cw'}`;
    try { saved = JSON.parse(localStorage.getItem(this.store)); } catch { /* ignore */ }
    this.best = saved?.best ?? null;
    this.bestSectors = saved?.bestSectors ?? [null, null, null];
    this.bestLapSectors = saved?.bestLapSectors ?? null;   // splits of the best lap, for live delta
    this.progressMax = 0;
  }

  save() {
    try { localStorage.setItem(this.store, JSON.stringify({ best: this.best, bestSectors: this.bestSectors, bestLapSectors: this.bestLapSectors })); } catch { /* ignore */ }
  }

  // nearest centreline index near the previous one
  locate(x, z) {
    let best = Infinity, bi = this.idx;
    for (let d = -60; d <= 60; d++) {
      const i = (this.idx + d + this.n) % this.n;
      const p = this.c[i];
      const e = (p[0] - x) ** 2 + (p[1] - z) ** 2;
      if (e < best) { best = e; bi = i; }
    }
    if (best > 400) {           // lost (reset/teleport): global search
      for (let i = 0; i < this.n; i++) {
        const p = this.c[i];
        const e = (p[0] - x) ** 2 + (p[1] - z) ** 2;
        if (e < best) { best = e; bi = i; }
      }
    }
    return bi;
  }

  update(t, dt, x, z, wheelsOff) {
    const prev = this.idx;
    this.idx = this.locate(x, z);
    const n = this.n;
    let step = this.idx - prev;
    if (step > n / 2) step -= n;
    if (step < -n / 2) step += n;
    // crossing the line forwards
    const crossed = step > 0 && prev > n * 0.8 && this.idx < n * 0.2;
    if (this.lapStart != null) this.progressMax = Math.max(this.progressMax, this.idx);

    // karting track limits: all four wheels off the pavement (beyond the
    // white line and kerbs), well wide of the line and for more than a
    // moment, invalidates the lap, so cutting across the grass can't set a time
    const p = this.c[this.idx];
    const wide = Math.hypot(p[0] - x, p[1] - z) > this.limit;
    if (wheelsOff && wide) this.offTime += dt; else this.offTime = 0;
    if (this.lapStart != null && this.offTime > LIMIT_GRACE && !this.invalid) {
      this.invalid = true;
      this.events.push({ type: 'invalid' });
    }

    // sector boundaries
    if (this.lapStart != null && step > 0) {
      for (let s = 0; s < 2; s++) {
        const b = this.sectorIdx[s];
        if (this.sector === s && prev < b && this.idx >= b && this.idx - b < 40) this.closeSector(t);
      }
    }

    if (crossed) {
      if (this.lapStart != null && this.sector === 2 && this.progressMax > n * 0.75) {
        this.closeSector(t);
        const lapTime = t - this.lapStart;
        this.last = lapTime;
        const valid = !this.invalid;
        if (valid && (this.best == null || lapTime < this.best)) {
          this.best = lapTime;
          this.bestLapSectors = this.sectors.slice();
          this.events.push({ type: 'best', time: lapTime });
        }
        this.events.push({ type: 'lap', time: lapTime, valid });
        this.save();
      }
      this.lap += 1;
      this.lapStart = t;
      this.sectorStart = t;
      this.sector = 0;
      this.sectors = [null, null, null];
      this.invalid = false;
      this.offTime = 0;
      this.progressMax = 0;
    }
  }

  closeSector(t) {
    const s = this.sector;
    const dt = t - this.sectorStart;
    this.sectors[s] = dt;
    let cls = 'slow';
    if (!this.invalid && (this.bestSectors[s] == null || dt < this.bestSectors[s])) { this.bestSectors[s] = dt; cls = 'best'; }
    else if (this.bestLapSectors && dt <= this.bestLapSectors[s]) cls = 'good';
    this.events.push({ type: 'sector', sector: s, time: dt, cls });
    this.sector = Math.min(2, s + 1);
    this.sectorStart = t;
  }

  current(t) { return this.lapStart == null ? null : t - this.lapStart; }

  reset() {
    this.lapStart = null; this.lap = 0; this.sector = 0; this.invalid = false; this.progressMax = 0;
    this.sectors = [null, null, null]; this.last = null; this.offTime = 0; this.events = []; this.idx = 0;
  }

  takeEvents() { const e = this.events; this.events = []; return e; }
}
