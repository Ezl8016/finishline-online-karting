// The sound of the place round you: birds in the daytime and crickets after
// dark (CC0 recordings, assets/ambience), the wind, rain when it rains, and
// the other karts on track, each a little engine placed where its kart is
// (louder close by, panned, its note rising as it comes and falling as it
// goes). Inside the clubhouse it is all muffled through the walls.
// A quiet murmur of people round the pits and the clubhouse's patio.
// Plays through the engine's output (audio.js), so the effects volume, mute
// and pausing apply to it too.

const FILES = { birds: 'assets/ambience/birds.mp3', wind: 'assets/ambience/wind.mp3', crickets: 'assets/ambience/crickets.mp3', crowd: 'assets/ambience/crowd.mp3' };
const CROWD = [16, 0.5, 82];   // where the people are: between the pits and the patio
const VOICES = 4;            // other karts heard at once (the nearest)
const SOUND = 343;           // m/s, for the pass-by pitch shift
// how much birdsong and crickets at each time of day
const BIRDS = { afternoon: 1, overcast: 0.6, evening: 0.35, night: 0 };
const CRICKETS = { afternoon: 0, overcast: 0, evening: 0.35, night: 1 };

export class Ambience {
  constructor(audio) {
    this.audio = audio;
    this.ctx = null;
    this.voices = [];
  }

  init() {
    const ctx = this.ctx = this.audio.ctx;
    // everything outdoors goes through one filter that closes when you're inside
    this.out = ctx.createGain(); this.out.connect(this.audio.master);
    this.walls = ctx.createBiquadFilter(); this.walls.type = 'lowpass'; this.walls.frequency.value = 20000;
    this.walls.connect(this.out);
    this.beds = {};
    for (const [k, url] of Object.entries(FILES)) {
      const g = ctx.createGain(); g.gain.value = 0;
      this.beds[k] = g;
      if (k === 'crowd') {
        // (heard from where they stand: full in the pits, fading across the circuit)
        const pan = ctx.createPanner();
        pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse'; pan.refDistance = 14; pan.rolloffFactor = 1.3; pan.maxDistance = 500;
        if (pan.positionX) { pan.positionX.value = CROWD[0]; pan.positionY.value = CROWD[1]; pan.positionZ.value = CROWD[2]; } else pan.setPosition(...CROWD);
        g.connect(pan); pan.connect(this.walls);
      } else g.connect(this.walls);
      fetch(url).then(r => r.arrayBuffer()).then(b => ctx.decodeAudioData(b)).then((buf) => {
        const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true;
        s.connect(g); s.start(0, Math.random() * buf.duration);
      }).catch(() => {});
    }
    // rain: a hiss of drops and a softer roar under it
    const noise = this.audio.noiseBuf;
    this.rain = ctx.createGain(); this.rain.gain.value = 0; this.rain.connect(this.walls);
    for (const [type, f, q, level] of [['highpass', 1800, 0.4, 0.07], ['lowpass', 500, 0.6, 0.35]]) {
      const s = ctx.createBufferSource(); s.buffer = noise; s.loop = true;
      const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
      const g = ctx.createGain(); g.gain.value = level;
      s.connect(flt); flt.connect(g); g.connect(this.rain);
      s.start(0, Math.random() * 1.5);
    }
    // the other karts: a few engine voices, each handed to one of the nearest
    const n = 24, re = new Float32Array(n), im = new Float32Array(n);
    for (let h = 1; h < n; h++) im[h] = (Math.sin(h * 0.42) / h) * (1 + 1.4 * Math.exp(-((h - 4.5) ** 2) / 6));
    const wave = ctx.createPeriodicWave(re, im);
    for (let i = 0; i < VOICES; i++) {
      const osc = ctx.createOscillator(); osc.setPeriodicWave(wave); osc.frequency.value = 15;
      const lp = ctx.createBiquadFilter(); lp.type = 'lowpass'; lp.Q.value = 2; lp.frequency.value = 600;
      const g = ctx.createGain(); g.gain.value = 0;
      const pan = ctx.createPanner();
      pan.panningModel = 'equalpower'; pan.distanceModel = 'inverse'; pan.refDistance = 6; pan.rolloffFactor = 1.1; pan.maxDistance = 500;
      osc.connect(lp); lp.connect(g); g.connect(pan); pan.connect(this.walls);
      osc.start();
      this.voices.push({ id: null, osc, lp, g, pan });
    }
  }

  // each frame. cam: the camera; time: 'afternoon' | 'evening' | 'overcast' | 'night';
  // karts: [{ id, x, y, z, vx, vz }] (everyone but you); indoors: in the clubhouse
  update({ cam, time, rain, indoors, karts }) {
    if (!this.audio.ctx) return;
    if (!this.ctx) this.init();
    const ctx = this.ctx, t = ctx.currentTime;
    this.walls.frequency.setTargetAtTime(indoors ? 650 : 20000, t, 0.25);
    this.out.gain.setTargetAtTime(indoors ? 0.45 : 1, t, 0.25);
    const wet = rain ? 0.2 : 1;
    this.beds.birds.gain.setTargetAtTime((BIRDS[time] ?? 1) * wet * 0.35, t, 1);
    this.beds.crowd.gain.setTargetAtTime(rain ? 0.12 : 0.25, t, 1);
    this.beds.crickets.gain.setTargetAtTime((CRICKETS[time] ?? 0) * wet * 0.9, t, 1);
    this.beds.wind.gain.setTargetAtTime(rain ? 0.9 : 0.55, t, 1);
    this.rain.gain.setTargetAtTime(rain ? (indoors ? 1.6 : 0.6) : 0, t, 1);

    // you hear from the camera
    const L = ctx.listener, p = cam.position, f = cam.getWorldDirection(this.fwd ??= cam.position.clone());
    if (L.positionX) {
      L.positionX.value = p.x; L.positionY.value = p.y; L.positionZ.value = p.z;
      L.forwardX.value = f.x; L.forwardY.value = f.y; L.forwardZ.value = f.z;
      L.upX.value = 0; L.upY.value = 1; L.upZ.value = 0;
    } else { L.setPosition(p.x, p.y, p.z); L.setOrientation(f.x, f.y, f.z, 0, 1, 0); }

    // the nearest karts keep the voice they have; a freed voice goes to the next
    const near = karts.map(k => ({ k, d: (k.x - p.x) ** 2 + (k.z - p.z) ** 2 })).sort((a, b) => a.d - b.d).slice(0, VOICES).map(o => o.k);
    const ids = new Set(near.map(k => k.id));
    for (const v of this.voices) if (v.id != null && !ids.has(v.id)) { v.id = null; v.g.gain.setTargetAtTime(0, t, 0.15); }
    for (const k of near) {
      const v = this.voices.find(v => v.id === k.id) || this.voices.find(v => v.id == null);
      if (!v) continue;
      v.id = k.id;
      // engine speed from road speed (a GX390's 68/20 chain on 0.14 m tyres; the clutch slipping when slow)
      const sp = Math.hypot(k.vx, k.vz), rpm = Math.min(4700, Math.max(1500 + sp * 280, sp * 23.2));
      // pass-by: the note rises coming towards you and drops going away
      const dx = k.x - p.x, dz = k.z - p.z, d = Math.hypot(dx, dz) || 1;
      const closing = -(k.vx * dx + k.vz * dz) / d;
      const fire = (rpm / 120) * SOUND / (SOUND - Math.max(-60, Math.min(60, closing)));
      v.osc.frequency.setTargetAtTime(fire, t, 0.05);
      v.lp.frequency.setTargetAtTime(250 + rpm * 0.25, t, 0.05);
      v.g.gain.setTargetAtTime(0.12 + Math.min(1, sp / 15) * 0.2, t, 0.1);
      if (v.pan.positionX) { v.pan.positionX.value = k.x; v.pan.positionY.value = k.y ?? 0.4; v.pan.positionZ.value = k.z; }
      else v.pan.setPosition(k.x, k.y ?? 0.4, k.z);
    }
  }
}
