import { fmt } from './timing.js';

const $ = (id) => document.getElementById(id);

// 29 C ambient -> blue, 60 C optimum -> green, 90 C+ -> red
function tempColour(T) {
  const stops = [[29, [70, 130, 230]], [44, [60, 190, 200]], [52, [60, 207, 110]], [85, [60, 207, 110]], [95, [255, 210, 60]], [105, [226, 87, 76]]];
  if (T <= stops[0][0]) return `rgb(${stops[0][1]})`;
  for (let i = 1; i < stops.length; i++) {
    if (T <= stops[i][0]) {
      const [t0, c0] = stops[i - 1], [t1, c1] = stops[i], k = (T - t0) / (t1 - t0);
      return `rgb(${c0.map((c, j) => Math.round(c + (c1[j] - c) * k))})`;
    }
  }
  return `rgb(${stops[stops.length - 1][1]})`;
}

export class Hud {
  constructor(track) {
    this.track = track;
    this.units = 'mph';
    this.el = {
      lapNo: $('lapNo'), lapTime: $('lapTime'), lastLap: $('lastLap'), bestLap: $('bestLap'),
      s: [$('s1'), $('s2'), $('s3')], delta: $('delta'), invalid: $('invalid'),
      speed: $('speedVal'), rpmBar: $('rpmBar'), rpmVal: $('rpmVal'), gVal: $('gVal'),
      thr: $('thrFill'), brk: $('brkFill'), steer: $('steerDot'),
      tyres: [$('tFL'), $('tFR'), $('tRL'), $('tRR')], tyreTxt: $('tyreTxt'),
      cam: $('camLabel'), telemetry: $('telemetry'),
    };
    // the rev counter: 24 lights, green, then yellow, then red near the limit
    this.rpmLeds = [];
    for (let i = 0; i < 24; i++) {
      const d = document.createElement('i');
      d.dataset.c = i < 14 ? 'g' : i < 20 ? 'y' : 'r';
      this.el.rpmBar.appendChild(d);
      this.rpmLeds.push(d);
    }
    this.lit = -1;
    this.others = [];                 // other drivers' karts on the map: [{ x, z }]
    this.mini = $('minimap').getContext('2d');
    this.g = $('gmeter').getContext('2d');
    this.deltaTimer = 0;
    this.gTrail = [];
    this.prepMinimap();
  }

  prepMinimap() {
    const c = this.track.centerline;
    let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
    for (const [x, z] of c) { x0 = Math.min(x0, x); x1 = Math.max(x1, x); z0 = Math.min(z0, z); z1 = Math.max(z1, z); }
    const pad = 14, W = 220;
    const s = (W - 2 * pad) / Math.max(x1 - x0, z1 - z0);
    const ox = (W - (x1 - x0) * s) / 2, oz = (W - (z1 - z0) * s) / 2;
    this.mm = (x, z) => [ox + (x - x0) * s, oz + (z - z0) * s];
    const off = document.createElement('canvas');
    off.width = off.height = W;
    const g = off.getContext('2d');
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = 'rgba(255,255,255,0.12)'; g.lineWidth = 10;
    g.beginPath(); c.forEach(([x, z], i) => { const [a, b] = this.mm(x, z); i ? g.lineTo(a, b) : g.moveTo(a, b); }); g.closePath(); g.stroke();
    g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 2.5; g.stroke();
    // the start/finish line, across the track
    const [sx, sz] = this.mm(c[0][0], c[0][1]), [nx, nz] = this.mm(c[3][0], c[3][1]);
    const ang = Math.atan2(nz - sz, nx - sx);
    g.save(); g.translate(sx, sz); g.rotate(ang);
    g.fillStyle = '#fff'; g.fillRect(-2, -7, 4, 14);
    g.fillStyle = '#111'; g.fillRect(-2, -7, 2, 3.5); g.fillRect(0, -3.5, 2, 3.5); g.fillRect(-2, 0, 2, 3.5); g.fillRect(0, 3.5, 2, 3.5);
    g.restore();
    this.mmBase = off;
  }

  setCamera(name) { this.el.cam.textContent = `CAM · ${name}`; }

  setTrack(name, dir) {
    $('mapName').textContent = name;
    $('mapDir').textContent = dir === 'ccw' ? 'CCW' : 'CW';
  }

  resetSectors() {
    this.el.s.forEach((el) => { el.className = ''; el.querySelector('b').textContent = ''; });
  }

  setUnits(u) { this.units = u; document.getElementById('speedUnit').textContent = u === 'kmh' ? 'KM/H' : 'MPH'; }

  update(dt, t, kart, input, timer) {
    const e = this.el;
    e.lapNo.textContent = timer.lap === 0 ? 'OUT LAP' : `LAP ${timer.lap}`;
    // no time yet: a faint placeholder
    const show = (el, v) => { el.textContent = v == null ? '-:--.---' : fmt(v); el.classList.toggle('none', v == null); };
    show(e.lapTime, timer.current(t));
    show(e.lastLap, timer.last);
    show(e.bestLap, timer.best);
    e.invalid.classList.toggle('hidden', !timer.invalid);

    for (const ev of timer.takeEvents()) {
      if (ev.type === 'sector') {
        const el = e.s[ev.sector];
        el.className = ev.cls;
        el.querySelector('b').textContent = ev.time.toFixed(2);
        if (timer.bestLapSectors && timer.bestLapSectors[ev.sector] != null) {
          // cumulative delta to the best lap at this split
          const cur = timer.sectors.slice(0, ev.sector + 1).reduce((a, b) => a + b, 0);
          const ref = timer.bestLapSectors.slice(0, ev.sector + 1).reduce((a, b) => a + b, 0);
          const d = cur - ref;
          e.delta.textContent = (d >= 0 ? '+' : '−') + Math.abs(d).toFixed(3);
          e.delta.style.color = d <= 0 ? '#3ccf6e' : '#ff5a4f';
          this.deltaTimer = 4;
        }
      } else if (ev.type === 'lap') {
        setTimeout(() => this.resetSectors(), 3000);
        if (!ev.valid) { e.delta.textContent = 'LAP INVALID'; e.delta.style.color = '#ffb020'; this.deltaTimer = 3; }
      } else if (ev.type === 'board') {
        e.delta.textContent += `  ·  #${ev.rank} ON FASTEST DRIVERS`;
        this.deltaTimer = 5;
      } else if (ev.type === 'best') {
        e.delta.textContent = 'BEST LAP ' + fmt(ev.time);
        e.delta.style.color = '#c58bff';
        this.deltaTimer = 4;
      }
    }
    this.deltaTimer -= dt;
    if (this.deltaTimer <= 0) e.delta.textContent = '';

    e.speed.textContent = Math.round(Math.abs(kart.forwardSpeed) * (this.units === 'kmh' ? 3.6 : 2.23694));
    const rpm = kart.pt.rpm;
    const lit = Math.max(0, Math.min(24, Math.round((rpm / (kart.pt.maxRpm * 0.92)) * 24)));
    if (lit !== this.lit) {
      this.rpmLeds.forEach((d, i) => { d.className = i < lit ? d.dataset.c : ''; });
      e.rpmBar.classList.toggle('limit', lit >= 23);
      this.lit = lit;
    }
    e.rpmVal.textContent = String(Math.round(rpm / 10) * 10);
    e.thr.style.width = `${kart.throttle * 100}%`;
    e.brk.style.width = `${kart.brake * 100}%`;
    e.steer.style.left = `${50 + input.steer * 50}%`;

    // tyres: colour by temperature (blue cold -> green in the window -> red
    // overheated), red outline when sliding, faded when the wheel lifts
    kart.wheels.forEach((w, i) => {
      const el = e.tyres[i];
      el.style.background = tempColour(w.temp);
      el.textContent = `${Math.round(w.temp * 9 / 5 + 32)}°`;
      el.style.boxShadow = w.util > 1.05 && w.contact ? '0 0 0 2px #fff'
        : w.surface === 'grass' ? '0 0 0 2px #8a6' : 'none';
      el.style.opacity = !w.contact || w.Fz < 40 ? '0.35' : '1';
    });
    const g = kart.wheels.reduce((a, w) => a + w.grip, 0) / 4;
    const T = kart.wheels.reduce((a, w) => a + w.temp, 0) / 4;
    const state = T < 40 ? 'COLD' : T < 52 ? 'WARMING' : T <= 85 ? 'READY' : 'HOT';
    e.tyreTxt.textContent = `TYRES ${state} · GRIP ${Math.round(g * 100)}%`;
    e.tyreTxt.style.color = state === 'READY' ? '#3ccf6e' : state === 'HOT' ? '#ff5a4f' : state === 'COLD' ? '#7cc4ff' : '#ffb020';

    this.drawG(kart);
    this.drawMinimap(kart);
  }

  drawG(kart) {
    const g = this.g, W = 120, c = W / 2, R = 54;
    g.clearRect(0, 0, W, W);
    g.lineWidth = 1;
    for (const r of [0.5, 1.0, 1.5]) {
      g.strokeStyle = r === 1.5 ? 'rgba(255,255,255,0.28)' : 'rgba(255,255,255,0.12)';
      g.beginPath(); g.arc(c, c, (r / 1.5) * R, 0, Math.PI * 2); g.stroke();
    }
    g.strokeStyle = 'rgba(255,255,255,0.12)';
    g.beginPath(); g.moveTo(c - R, c); g.lineTo(c + R, c); g.moveTo(c, c - R); g.lineTo(c, c + R); g.stroke();
    g.fillStyle = 'rgba(255,255,255,0.35)'; g.font = 'italic 900 8px "Arial Black", Arial, sans-serif'; g.textAlign = 'center';
    g.fillText('1G', c, c - (1 / 1.5) * R - 2);
    const x = c + (kart.accel.x / 1.5) * R, y = c - (kart.accel.z / 1.5) * R;
    this.gTrail.push([x, y]); if (this.gTrail.length > 40) this.gTrail.shift();
    this.gTrail.forEach(([a, b], i) => { g.fillStyle = `rgba(212,42,42,${(i / this.gTrail.length) * 0.35})`; g.beginPath(); g.arc(a, b, 2, 0, 7); g.fill(); });
    g.fillStyle = '#fff'; g.beginPath(); g.arc(x, y, 5, 0, 7); g.fill();
    g.strokeStyle = '#d42a2a'; g.lineWidth = 2; g.stroke();
    this.el.gVal.textContent = `${Math.hypot(kart.accel.x, kart.accel.z).toFixed(2)} G`;
  }

  drawMinimap(kart) {
    const g = this.mini;
    g.clearRect(0, 0, 220, 220);
    g.drawImage(this.mmBase, 0, 0);
    // other drivers: white dots (the one the steward is watching in red)
    for (const o of this.others) {
      const [ox, oy] = this.mm(o.x, o.z);
      g.fillStyle = o.hl ? '#d42a2a' : '#fff'; g.beginPath(); g.arc(ox, oy, o.hl ? 6 : 4, 0, 7); g.fill();
      g.strokeStyle = o.hl ? '#fff' : '#111'; g.lineWidth = 1.5; g.stroke();
    }
    if (!kart) return;              // (stewarding: no kart of my own)
    const p = kart.body.translation();
    const [x, y] = this.mm(p.x, p.z);
    const q = kart.body.rotation();
    const yaw = Math.atan2(2 * (q.w * q.y + q.x * q.z), 1 - 2 * (q.y * q.y + q.x * q.x));
    g.save(); g.translate(x, y); g.rotate(-yaw);
    g.fillStyle = '#d42a2a'; g.strokeStyle = '#fff'; g.lineWidth = 1.5;
    g.beginPath(); g.moveTo(0, -8); g.lineTo(6, 6); g.lineTo(0, 3); g.lineTo(-6, 6); g.closePath(); g.fill(); g.stroke();
    g.restore();
  }
}
