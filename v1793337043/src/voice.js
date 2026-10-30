// Voice chat in a server: push to talk, heard straight from player to player
// over the WebRTC links (net.js), each voice turned up or down and placed
// left or right by main.js (proximity on track, everyone at once before and
// after sessions, the steward always). Nothing is recorded or sent anywhere
// else; players who can't link directly can't hear each other.

export class Voice {
  constructor() {
    this.ctx = null;                // Web Audio, made on the first tap or key press
    this.out = null;
    this.mic = null;                // our microphone track (null until asked for)
    this.asking = null;
    this.talking = false;
    this.voices = new Map();        // player id -> { el, src, gain, pan, an, buf, level }
    this.onMic = null;              // (track | null) -> net.setMicTrack
    // browsers only start sound after a click, tap or key press (a
    // controller's buttons don't count), so any of those wakes it
    const wake = () => this.unlock();
    for (const ev of ['pointerdown', 'pointerup', 'keydown', 'touchend', 'click']) addEventListener(ev, wake, true);
  }

  // make (and start) the sound from a click or key press: call it from the
  // button that joins a server, so voices play even if you then only use a
  // controller
  unlock() {
    const ctx = this._audio();
    if (ctx.state !== 'running') ctx.resume?.().catch(() => {});
    for (const v of this.voices.values()) if (v.el.paused) v.el.play?.().catch(() => {});
  }

  // sound not started yet (no click or key since joining)
  get blocked() { return !!this.ctx && this.ctx.state !== 'running'; }

  _audio() {
    if (this.ctx) return this.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.out = this.ctx.createGain();
    this.out.connect(this.ctx.destination);
    // while the mixer is paused, voices play straight from their audio
    // element instead (no left/right, but heard)
    this.ctx.onstatechange = () => { for (const v of this.voices.values()) this._route(v); };
    return this.ctx;
  }

  // the microphone, asked for once (the browser shows its permission prompt);
  // resolves to true if we have it
  async enableMic() {
    if (this.mic && this.mic.readyState === 'live') return true;
    if (!navigator.mediaDevices?.getUserMedia) return false;
    this.asking ||= navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } })
      .then((s) => {
        this.mic = s.getAudioTracks()[0];
        this.mic.enabled = false;           // push to talk: silent until held
        this.onMic?.(this.mic);
        return true;
      })
      .catch(() => false)
      .finally(() => { this.asking = null; });
    return this.asking;
  }

  // how loud our own microphone is right now (0-1), for the talking meter
  micLevel() {
    if (!this.mic || this.mic.readyState !== 'live') return 0;
    if (!this._micAn || this._micAnFor !== this.mic) {
      const ctx = this._audio();
      this._micAn = ctx.createAnalyser(); this._micAn.fftSize = 512;
      ctx.createMediaStreamSource(new MediaStream([this.mic])).connect(this._micAn);
      this._micAnFor = this.mic; this._micBuf = new Float32Array(512);
    }
    this._micAn.getFloatTimeDomainData(this._micBuf);
    let s = 0;
    for (const x of this._micBuf) s += x * x;
    return Math.min(1, Math.sqrt(s / this._micBuf.length) * 6);
  }

  // stop using the microphone (leaving the server, voice switched off)
  disableMic() {
    this.talk(false);
    if (this.mic) { this.mic.stop(); this.mic = null; this.onMic?.(null); }
  }

  // push to talk: while held, our voice goes out
  talk(on) {
    this.talking = !!on && !!this.mic;
    if (this.mic) this.mic.enabled = this.talking;
  }

  // another player's voice arrived
  add(id, stream) {
    this.remove(id);
    const ctx = this._audio();
    // (Chrome only feeds a remote WebRTC stream into Web Audio while an
    // element is playing it; the element itself stays silent unless the mixer
    // can't run, see _route)
    const el = new Audio();
    el.autoplay = true; el.playsInline = true;
    el.muted = true; el.srcObject = stream; el.play?.().catch(() => {});
    const src = ctx.createMediaStreamSource(stream);
    const gain = ctx.createGain(); gain.gain.value = 0;
    const pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
    const an = ctx.createAnalyser(); an.fftSize = 512;
    src.connect(an);
    src.connect(gain);
    if (pan) { gain.connect(pan); pan.connect(this.out); } else gain.connect(this.out);
    const v = { el, src, gain, pan, an, buf: new Float32Array(an.fftSize), level: 0, vol: 0 };
    this.voices.set(id, v);
    this._route(v);
  }

  // through the mixer when it runs, else straight from the element
  _route(v) {
    const direct = this.ctx.state !== 'running';
    v.el.muted = !direct;
    v.el.volume = direct ? Math.max(0, Math.min(1, v.vol)) : 1;
    if (direct && v.el.paused) v.el.play?.().catch(() => {});
  }

  remove(id) {
    const v = this.voices.get(id);
    if (!v) return;
    try { v.src.disconnect(); v.gain.disconnect(); v.pan?.disconnect(); v.el.srcObject = null; } catch { /* gone */ }
    this.voices.delete(id);
  }

  removeAll() { for (const id of [...this.voices.keys()]) this.remove(id); }

  // how loud (0-1) and where (-1 left .. 1 right) a player's voice is
  set(id, vol, panTo = 0) {
    const v = this.voices.get(id);
    if (!v) return;
    const t = this.ctx.currentTime;
    v.gain.gain.setTargetAtTime(vol, t, 0.08);
    v.pan?.pan.setTargetAtTime(Math.max(-1, Math.min(1, panTo)), t, 0.08);
    v.vol = vol;
    if (this.ctx.state !== 'running') v.el.volume = Math.max(0, Math.min(1, vol));
  }

  // who's talking (and audible to us) right now
  speaking() {
    const out = [];
    for (const [id, v] of this.voices) {
      v.an.getFloatTimeDomainData(v.buf);
      let s = 0;
      for (const x of v.buf) s += x * x;
      const rms = Math.sqrt(s / v.buf.length);
      v.level = Math.max(rms, v.level * 0.85);
      if (v.level > 0.02 && (v.vol ?? 0) > 0.05) out.push(id);
    }
    return out;
  }
}
