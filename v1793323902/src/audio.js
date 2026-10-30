// Synthesised Honda GX390 single: a firing pulse every second crank revolution
// (rpm/120 Hz), exhaust resonance, intake noise, chain whine and tyre scrub.

export class KartAudio {
  constructor() {
    this.ctx = null;
    this.muted = false;
    this.volume = 0.55;
  }

  start() {
    if (this.ctx) { this.ctx.resume(); return; }
    const ctx = this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.master = ctx.createGain();
    // fade in rather than starting at full level: the oscillators begin
    // before the first engine update has set their volumes
    this.master.gain.value = 0;
    if (!this.muted) this.master.gain.setTargetAtTime(this.volume, ctx.currentTime + 0.15, 0.1);
    this.master.connect(ctx.destination);

    // exhaust: pulse-like periodic wave rich in low harmonics
    const n = 40, re = new Float32Array(n), im = new Float32Array(n);
    for (let h = 1; h < n; h++) {
      // narrow pulse spectrum with a hump around the 3rd-6th harmonics (muffler)
      const hump = 1 + 1.4 * Math.exp(-((h - 4.5) ** 2) / 6);
      im[h] = (Math.sin(h * 0.42) / h) * hump * (h % 2 ? 1 : 0.75);
    }
    const wave = ctx.createPeriodicWave(re, im);
    this.osc = ctx.createOscillator();
    this.osc.setPeriodicWave(wave);
    this.osc2 = ctx.createOscillator();        // half-order rumble (uneven firing feel)
    this.osc2.type = 'triangle';
    const shaper = ctx.createWaveShaper();
    const curve = new Float32Array(1024);
    for (let i = 0; i < 1024; i++) { const x = i / 512 - 1; curve[i] = Math.tanh(2.2 * x); }
    shaper.curve = curve;
    this.exLP = ctx.createBiquadFilter(); this.exLP.type = 'lowpass'; this.exLP.Q.value = 3;
    this.exGain = ctx.createGain();
    this.rumbleGain = ctx.createGain();
    this.osc.connect(shaper); shaper.connect(this.exLP); this.exLP.connect(this.exGain); this.exGain.connect(this.master);
    this.osc2.connect(this.rumbleGain); this.rumbleGain.connect(this.master);

    // noise source shared by intake and tyres
    const buf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    const noise = () => { const s = ctx.createBufferSource(); s.buffer = buf; s.loop = true; s.start(); return s; };
    this.noiseBuf = buf;

    this.intakeBP = ctx.createBiquadFilter(); this.intakeBP.type = 'bandpass'; this.intakeBP.Q.value = 1.2;
    this.intakeGain = ctx.createGain();
    noise().connect(this.intakeBP); this.intakeBP.connect(this.intakeGain); this.intakeGain.connect(this.master);

    this.squealBP = ctx.createBiquadFilter(); this.squealBP.type = 'bandpass'; this.squealBP.frequency.value = 1100; this.squealBP.Q.value = 6;
    this.squealGain = ctx.createGain(); this.squealGain.gain.value = 0;
    noise().connect(this.squealBP); this.squealBP.connect(this.squealGain); this.squealGain.connect(this.master);

    this.scrubLP = ctx.createBiquadFilter(); this.scrubLP.type = 'lowpass'; this.scrubLP.frequency.value = 400;
    this.scrubGain = ctx.createGain(); this.scrubGain.gain.value = 0;
    noise().connect(this.scrubLP); this.scrubLP.connect(this.scrubGain); this.scrubGain.connect(this.master);

    this.chain = ctx.createOscillator(); this.chain.type = 'sawtooth';
    this.chainBP = ctx.createBiquadFilter(); this.chainBP.type = 'bandpass'; this.chainBP.Q.value = 8;
    this.chainGain = ctx.createGain(); this.chainGain.gain.value = 0;
    this.chain.connect(this.chainBP); this.chainBP.connect(this.chainGain); this.chainGain.connect(this.master);

    this.osc.start(); this.osc2.start(); this.chain.start();
  }

  update(kart) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime, k = 0.03;
    const rpm = Math.max(300, kart.pt.rpm);
    const load = kart.pt.throttleEff;
    const fire = rpm / 120;
    this.osc.frequency.setTargetAtTime(fire, t, k);
    this.osc2.frequency.setTargetAtTime(fire / 2, t, k);
    this.exLP.frequency.setTargetAtTime(220 + rpm * 0.32 + load * 900, t, k);
    this.exGain.gain.setTargetAtTime(0.16 + load * 0.34, t, k);
    this.rumbleGain.gain.setTargetAtTime(0.05 + load * 0.05, t, k);
    this.intakeBP.frequency.setTargetAtTime(500 + rpm * 0.4, t, k);
    this.intakeGain.gain.setTargetAtTime(0.02 + load * 0.06, t, k);
    // chain: 20-tooth clutch sprocket tooth-passing frequency
    const sprocketHz = (Math.abs(kart.pt.wa) * kart.pt.ratio / (2 * Math.PI)) * 20;
    this.chain.frequency.setTargetAtTime(Math.max(20, sprocketHz), t, k);
    this.chainBP.frequency.setTargetAtTime(Math.max(60, sprocketHz * 2), t, k);
    this.chainGain.gain.setTargetAtTime(Math.min(0.04, Math.abs(kart.pt.wa) * 0.0006), t, k);
    // tyres: squeal grows past peak slip on asphalt; scrub rumble on grass
    let squeal = 0, scrub = 0;
    for (const w of kart.wheels) {
      if (!w.contact) continue;
      const over = Math.max(0, w.util - 0.85);
      if (w.surface === 'grass') scrub += Math.min(1, kart.speed / 10) * 0.08;
      else squeal += Math.min(1, over * 1.6) * Math.min(1, kart.speed / 4) * (w.Fz / 800);
    }
    this.squealGain.gain.setTargetAtTime(Math.min(0.22, squeal * 0.07), t, 0.05);
    this.squealBP.frequency.setTargetAtTime(950 + Math.min(600, squeal * 250), t, 0.05);
    this.scrubGain.gain.setTargetAtTime(Math.min(0.3, scrub), t, 0.05);
  }

  // A knock: kart into kart, wall, tyres or a parked car. k: 0..1, how hard.
  // A dull thud of the chassis and a sharper clack of plastic bodywork.
  hit(k) {
    if (!this.ctx || !this.noiseBuf || this.muted) return;
    const ctx = this.ctx, t = ctx.currentTime;
    k = Math.min(1, Math.max(0, k));
    for (const [type, f, q, level, decay] of [['lowpass', 180, 0.8, 1.0, 0.16], ['bandpass', 1500 + 900 * Math.random(), 2.5, 0.45, 0.06]]) {
      const src = ctx.createBufferSource(); src.buffer = this.noiseBuf;
      const flt = ctx.createBiquadFilter(); flt.type = type; flt.frequency.value = f; flt.Q.value = q;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(level * (0.25 + 0.75 * k), t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.001, t + decay * (0.6 + 0.8 * k));
      src.connect(flt); flt.connect(g); g.connect(this.master);
      src.start(t, Math.random() * 1.5); src.stop(t + 0.5);
    }
  }

  toggleMute() {
    if (!this.ctx) return;
    this.muted = !this.muted;
    this.master.gain.setTargetAtTime(this.muted ? 0 : this.volume, this.ctx.currentTime, 0.05);
  }

  setVolume(v) {
    this.volume = v;
    if (this.ctx && !this.muted) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  suspend() { this.ctx?.suspend(); }
  resume() { this.ctx?.resume(); }
}
