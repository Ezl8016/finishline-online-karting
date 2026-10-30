// Keyboard, gamepad and steering wheel / pedal input.
//
// Browsers expose wheels and pedals as (usually non-standard) gamepads, and
// every brand reports its axes differently, so controls are found with a
// short calibration ("press the throttle", "press the brake", "turn the
// wheel") rather than a list of models. Each control can come from a
// different device (a wheel plus separate USB pedals works), and settings are
// saved per device in localStorage.

const STORE = 'tidalturns.input.v3';   // v2 could hold a wrong G920 preset
const WHEEL_ID = /wheel|racing|G2[579]|G9[02]\d|G923|driving force|thrustmaster|T150|T248|T300|TMX|T128|T-GT|fanatec|CSL|clubsport|podium|moza|simagic|simucube|logitech.*c2[4-9a-f][0-9a-f]|046d-c2|044f-b6|0eb7/i;

const ls = {
  get() { try { return JSON.parse(localStorage.getItem(STORE)) || {}; } catch { return {}; } },
  set(v) { try { localStorage.setItem(STORE, JSON.stringify(v)); } catch { /* private mode */ } },
};

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

// Pedal / trigger weight, 0 (light) .. 1 (heavy). A browser can't stiffen a
// trigger's spring, so a heavier setting asks for more travel instead: a
// dead first part of the pull, then a progressive response, so you have to
// squeeze hard for full throttle or brake.
// a controller's triggers are short: a curve makes the first part of the
// press gentle, so most of the travel is fine control and full gas or brake
// only comes right at the end (pedals stay as they are)
const TRIGGER_CURVE = 1.7;
const pedal = (v, prof) => weigh(prof.kind === 'pad' ? Math.pow(v, TRIGGER_CURVE) : v, prof.pedalWeight);

function weigh(v, w = 0) {
  if (!w) return v;
  const dz = 0.2 * w;
  return Math.pow(clamp((v - dz) / (1 - dz), 0, 1), 1 + 1.5 * w);
}

// Logitech wheels (G920 / G923 / G29 / G27 / G25 and Driving Force): steering
// on axis 0, pedals on axes 1 (throttle) and 2 (brake), reading +1 at rest
// and -1 pressed. Calibration can still override this.
const LOGITECH_WHEEL = /G920|G923|G29|G27|G25|Driving Force|046d.{0,12}c2(62|66|67|6d|6e|4f|9b|98|99|94)/i;

// Chrome reports an axis as exactly 0 until it's first moved, so untouched
// pedals that rest at +1 would read half-pressed. Ignore an axis until it has
// moved.
const moved = new Set();

function connectedPads() {
  const out = [];
  for (const p of (navigator.getGamepads ? navigator.getGamepads() : [])) if (p && p.connected) out.push(p);
  return out;
}

// default setup for a device we haven't calibrated yet
function defaultProfile(p) {
  const wheel = WHEEL_ID.test(p.id);
  if (LOGITECH_WHEEL.test(p.id)) {
    // Two ways a G920 shows up: as an Xbox-style "standard" gamepad (pedals
    // are the trigger buttons 7/6), or in HID mode (pedals on axes 1/2).
    const xbox = p.mapping === 'standard';
    return {
      kind: 'wheel', calibrated: true, preset: xbox ? 'Logitech, Xbox layout' : 'Logitech',
      steer: { pad: p.id, axis: 0, invert: false },
      throttle: xbox ? { pad: p.id, button: 7, rest: 0, full: 1 } : { pad: p.id, axis: 1, rest: 1, full: -1 },
      brake: xbox ? { pad: p.id, button: 6, rest: 0, full: 1 } : { pad: p.id, axis: 2, rest: 1, full: -1 },
      wheelRange: 900, steerLock: 180, deadzone: 0.01, curve: 1.0,
    };
  }
  if (!wheel && p.mapping === 'standard') {
    return {
      kind: 'pad', calibrated: true,
      steer: { pad: p.id, axis: 0, invert: false },
      throttle: { pad: p.id, button: 7, rest: 0, full: 1 },
      brake: { pad: p.id, button: 6, rest: 0, full: 1 },
      deadzone: 0.08, curve: 1.5,
    };
  }
  // wheel (or unknown device): steering on axis 0 is near-universal; pedals
  // differ by brand, so ask for a calibration
  return {
    kind: 'wheel', calibrated: false,
    steer: { pad: p.id, axis: 0, invert: false },
    throttle: null, brake: null,
    wheelRange: 900, steerLock: 180, deadzone: 0.01, curve: 1.0,
  };
}

export class Input {
  constructor() {
    this.keys = new Set();
    this.steer = 0; this.throttle = 0; this.brake = 0;
    this.source = 'keyboard';
    this.touch = { steer: 0, gas: false, brake: false, talk: false };   // the on-screen controls (touch.js)
    this.profiles = ls.get();
    this.actions = [];
    this._prevButtons = new Map();
    this._rumbleAt = 0;
    this.onDevicesChanged = null;
    addEventListener('keydown', (e) => {
      if (e.repeat) return;
      // typing in a menu field (helmet number) isn't driving
      if (e.target.closest?.('input[type=text], select, textarea')) return;
      this.keys.add(e.code);
      const a = { KeyC: 'camera', KeyR: 'reset', KeyF: 'turnaround', Escape: 'pause', KeyM: 'mute', KeyN: 'music', KeyT: 'telemetry',
        // (the steward's flags; R is red to a steward)
        KeyG: 'flag:green', KeyY: 'flag:yellow', KeyW: 'flag:white', KeyX: 'flag:chequered', KeyA: 'flag:auto' }[e.code];
      if (a) this.actions.push(a);
      // number keys: the steward's cameras
      const n = /^(Digit|Numpad)(\d)$/.exec(e.code);
      if (n) this.actions.push(`cam${n[2]}`);
      if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());
    addEventListener('gamepadconnected', () => this.onDevicesChanged?.());
    addEventListener('gamepaddisconnected', () => this.onDevicesChanged?.());
  }

  // the device that steers decides which profile is active
  activeProfile() {
    const pads = connectedPads();
    if (!pads.length) return null;
    // prefer a wheel if one is plugged in
    const main = pads.find(p => WHEEL_ID.test(p.id)) || pads.find(p => p.mapping === 'standard') || pads[0];
    if (!this.profiles[main.id]) this.profiles[main.id] = defaultProfile(main);
    return { pad: main, prof: this.profiles[main.id] };
  }

  save() { ls.set(this.profiles); }

  static read(ctrl, pads) {
    if (!ctrl) return 0;
    const p = pads.find(q => q.id === ctrl.pad);
    if (!p) return 0;
    let raw;
    if (ctrl.button !== undefined) raw = p.buttons[ctrl.button]?.value ?? 0;
    else {
      raw = p.axes[ctrl.axis] ?? 0;
      const key = `${p.id}#${ctrl.axis}`;
      if (raw !== 0) moved.add(key);
      else if (!moved.has(key)) return 0;      // never touched yet: at rest
    }
    return clamp((raw - ctrl.rest) / ((ctrl.full - ctrl.rest) || 1), 0, 1);
  }

  // steering in -1..1 of the kart's full lock
  static steerValue(prof, pads) {
    const c = prof.steer;
    const p = pads.find(q => q.id === c.pad);
    if (!p) return 0;
    let v = p.axes[c.axis] ?? 0;
    if (c.invert) v = -v;
    if (Math.abs(v) < prof.deadzone) v = 0;
    else v = Math.sign(v) * (Math.abs(v) - prof.deadzone) / (1 - prof.deadzone);
    if (prof.kind === 'wheel') {
      // a 900 deg wheel turned 90 deg reads 0.2; scale so `steerLock` deg of
      // wheel rotation (lock to lock) is full kart lock, like a real kart
      v = v * (prof.wheelRange / prof.steerLock);
    } else {
      v = Math.sign(v) * Math.pow(Math.abs(v), prof.curve);
    }
    return clamp(v, -1, 1);
  }

  poll(dt, speed) {
    const pads = connectedPads();
    const act = this.activeProfile();
    let padCmd = null;
    if (act) {
      const { prof } = act;
      const st = Input.steerValue(prof, pads);
      const thr = pedal(Input.read(prof.throttle, pads), prof);
      const brk = pedal(Input.read(prof.brake, pads), prof);
      // (from the on-screen controls, only a controller that moves takes over:
      // one lying with its stick a touch off centre mustn't)
      const last = this._lastPad || { st, thr, brk };
      const moved = Math.abs(st - last.st) > 0.03 || Math.abs(thr - last.thr) > 0.03 || Math.abs(brk - last.brk) > 0.03;
      this._lastPad = { st, thr, brk };
      if ((moved || this.source !== 'touch') && (Math.abs(st) > 0.05 || thr > 0.05 || brk > 0.05)) this.source = 'pad';
      padCmd = { steer: st, throttle: thr, brake: brk };
      // buttons (standard layout: Y camera, B reset, X turn around, Start pause)
      for (const p of pads) {
        const prev = this._prevButtons.get(p.id) || [];
        const edge = (i) => p.buttons[i]?.pressed && !prev[i];
        // A/B/X/Y sit at 0-3 on standard pads and on Logitech wheels alike
        if (p.mapping === 'standard' || LOGITECH_WHEEL.test(p.id)) {
          if (edge(3)) this.actions.push('camera');
          if (edge(1)) this.actions.push('reset');
          if (edge(2)) this.actions.push('turnaround');
          if (p.mapping === 'standard' && edge(9)) this.actions.push('pause');
          // bumpers / d-pad left and right: the steward's previous and next driver
          if (p.mapping === 'standard' && (edge(4) || edge(14))) this.actions.push('watchPrev');
          if (p.mapping === 'standard' && (edge(5) || edge(15))) this.actions.push('watchNext');
        }
        this._prevButtons.set(p.id, p.buttons.map(b => b.pressed));
      }
    }
    const k = this.keys;
    const kL = k.has('KeyA') || k.has('ArrowLeft'), kR = k.has('KeyD') || k.has('ArrowRight');
    const kT = k.has('KeyW') || k.has('ArrowUp'), kB = k.has('KeyS') || k.has('ArrowDown') || k.has('Space');
    if (kL || kR || kT || kB) this.source = 'keyboard';
    if (padCmd && this.source === 'pad') {
      this.steer = padCmd.steer; this.throttle = padCmd.throttle; this.brake = padCmd.brake;
    } else if (this.source === 'touch') {
      // on-screen controls: the thumb's steering, a little smoothed and with
      // the same cap at speed as the keyboard; pedals ramped like keys
      const t = this.touch;
      const limit = Math.min(1, 1 / (1 + Math.max(0, speed - 4) / 5.5));
      this.steer += clamp(t.steer * limit - this.steer, -7 * dt, 7 * dt);
      this.throttle += clamp((t.gas ? 1 : 0) - this.throttle, -6 * dt, 4 * dt);
      this.brake += clamp((t.brake ? 1 : 0) - this.brake, -8 * dt, 5 * dt);
    } else {
      // keyboard assist: rate-limited steering that tightens less at speed,
      // and ramped pedals so a tap isn't a full stab
      const target = (kR ? 1 : 0) - (kL ? 1 : 0);
      // past the grip limit more lock only scrubs (or spins it), so cap it
      const limit = Math.min(1, 1 / (1 + Math.max(0, speed - 4) / 5.5));
      const goal = target * limit;
      const rate = (target === 0 || Math.sign(goal) !== Math.sign(this.steer)) ? 6 : 4;
      this.steer += clamp(goal - this.steer, -rate * dt, rate * dt);
      this.throttle += clamp((kT ? 1 : 0) - this.throttle, -6 * dt, 4 * dt);
      this.brake += clamp((kB ? 1 : 0) - this.brake, -8 * dt, 5 * dt);
    }
    return { steer: this.steer, throttle: this.throttle, brake: this.brake };
  }

  // Controller rumble, scaled by the profile's rumble strength. Gamepads and
  // any wheel that exposes rumble motors get it; a wheel's force-feedback
  // motor isn't reachable from a browser. Xbox controllers in Chrome on
  // Windows also get the trigger motors (left = brake, right = throttle).
  rumble(strong, weak, ms = 60, lt = 0, rt = 0) {
    if (this.source !== 'pad') return;
    const k = this.activeProfile()?.prof.rumble ?? 1;
    strong = clamp(strong * k, 0, 1); weak = clamp(weak * k, 0, 1);
    lt = clamp(lt * k, 0, 1); rt = clamp(rt * k, 0, 1);
    if (strong < 0.02 && weak < 0.02 && lt < 0.02 && rt < 0.02) return;
    const now = performance.now();
    if (now < this._rumbleAt) return;
    this._rumbleAt = now + ms * 0.8;
    for (const p of connectedPads()) Input.buzz(p, ms, strong, weak, lt, rt).catch(() => {});
  }

  // One rumble effect on one controller. Returns a promise of the browser's
  // answer ('complete', 'preempted') or rejects with why it couldn't.
  static buzz(p, ms, strong, weak, lt = 0, rt = 0) {
    const va = p.vibrationActuator;
    if (va?.playEffect) {
      const triggers = (lt >= 0.02 || rt >= 0.02) && va.effects?.includes('trigger-rumble');
      return va.playEffect(triggers ? 'trigger-rumble' : 'dual-rumble', {
        startDelay: 0, duration: ms, strongMagnitude: strong, weakMagnitude: weak, leftTrigger: lt, rightTrigger: rt,
      });
    }
    // older Firefox-style API
    const h = p.hapticActuators?.[0];
    if (h?.pulse) return Promise.resolve(h.pulse(Math.max(strong, weak), ms)).then(() => 'complete');
    return Promise.reject(new Error('the browser reports no rumble motors on it'));
  }

  // strong test buzz from the settings panel; resolves to a readout per controller
  async testRumble() {
    const k = this.activeProfile()?.prof.rumble ?? 1;
    const pads = connectedPads();
    if (!pads.length) return 'No controller seen yet: press a button on it first.';
    const out = await Promise.all(pads.map(async (p) => {
      const name = p.id.replace(/\s*\(.*?\)\s*/g, ' ').trim() || 'Controller';
      try {
        const r = await Input.buzz(p, 600, clamp(k, 0, 1), clamp(k, 0, 1), clamp(k, 0, 1), clamp(k, 0, 1));
        return `${name}: browser says "${r}"`;
      } catch (e) { return `${name}: ${e.message}`; }
    }));
    return out.join(' · ');
  }

  // what the browser offers for rumble, for the settings panel
  rumbleInfo() {
    return connectedPads().map((p) => {
      const va = p.vibrationActuator;
      const kinds = va ? (va.effects ? [...va.effects].join(', ') : va.type || 'unknown') : p.hapticActuators?.length ? 'pulse' : 'none';
      return `${p.id.slice(0, 40)}: rumble ${kinds}`;
    }).join('\n');
  }

  // does any connected controller have rumble motors?
  canRumble() { return connectedPads().some(p => p.vibrationActuator?.playEffect || p.hapticActuators?.[0]?.pulse); }

  takeActions() { const a = this.actions; this.actions = []; return a; }

  // the on-screen controls were used: they drive until a key or pad does
  touched() { this.source = 'touch'; }

  // push to talk (voice chat in a server): V, a controller's A, or TALK on a touchscreen
  talkHeld() {
    if (this.keys.has('KeyV') || this.touch.talk) return true;
    for (const p of connectedPads()) if ((p.mapping === 'standard' || LOGITECH_WHEEL.test(p.id)) && p.buttons[0]?.pressed) return true;
    return false;
  }

  // driving with a steering wheel (and pedals) right now
  onWheel() { return this.source === 'pad' && this.activeProfile()?.prof.kind === 'wheel'; }

  needsCalibration() {
    const act = this.activeProfile();
    return !!act && act.prof.kind === 'wheel' && !act.prof.calibrated;
  }

  describe() {
    const act = this.activeProfile();
    if (!act) {
      const safari = /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent);
      return safari ? 'Keyboard. Safari doesn\'t support steering wheels; open the sim in Chrome or Edge.'
        : 'Keyboard. No wheel or gamepad seen yet: press a button or pedal on it (browsers only show a controller after that).';
    }
    const name = act.pad.id.replace(/\s*\(.*?\)\s*/g, ' ').trim() || 'Controller';
    if (act.prof.kind === 'wheel' && !act.prof.calibrated) return `${name}: wheel found, calibrate pedals`;
    if (act.prof.preset) return `${name} (${act.prof.preset} wheel preset; calibrate if the pedals don't respond)`;
    return `${name} (${act.prof.kind === 'wheel' ? 'wheel' : 'gamepad'})`;
  }

  // ---------------------------------------------------------------- settings UI
  openConfig(root) {
    const body = root.querySelector('#cfgBody');
    let calib = null;           // { step, rest, prof }
    const render = () => {
      const act = this.activeProfile();
      if (!act) {
        body.innerHTML = `<p class="small">No controller found yet. Plug in the wheel and <b>press a button or pedal</b>: browsers don't list a controller until you do.</p>
          <p class="small">Still nothing? Use Chrome or Edge (Safari doesn't support wheels). On a Mac, a Logitech G920 needs <b>Logitech G HUB</b> installed: it switches the wheel out of its Xbox mode so macOS can see it. Then unplug and replug the wheel and press a button.</p>`;
        return;
      }
      const { pad, prof } = act;
      const wheel = prof.kind === 'wheel';
      body.innerHTML = `
        <p class="small">Using <b></b> · ${pad.mapping === 'standard' ? 'standard layout' : 'custom layout'} · ${pad.axes.length} axes, ${pad.buttons.length} buttons</p>
        <div class="cfgGrid">
          <b>Steering</b><div class="axisMeter"><div id="m_steer"></div></div><span id="v_steer" class="small"></span>
          <b>Throttle</b><div class="axisMeter"><div id="m_throttle"></div></div><span id="v_throttle" class="small"></span>
          <b>Brake</b><div class="axisMeter"><div id="m_brake"></div></div><span id="v_brake" class="small"></span>
        </div>
        <div class="raw small" id="raw"></div>
        <div class="calib" id="calib"></div>
        <div class="cfgRow">
          <button class="mini" id="startCalib">${prof.calibrated ? 'Recalibrate' : 'Calibrate now'}</button>
          <label class="small">Type
            <select id="kind"><option value="wheel">Steering wheel</option><option value="pad">Gamepad</option></select></label>
        </div>
        <div class="cfgRow ${wheel ? '' : 'hidden'}">
          <label class="small">Wheel rotation (hardware)
            <select id="wheelRange">${[180, 240, 270, 360, 540, 720, 900, 1080].map(d => `<option value="${d}">${d}°</option>`).join('')}</select></label>
          <label class="small">Steering lock (lock to lock) <input id="steerLock" type="range" min="90" max="540" step="10"> <span id="lockVal"></span></label>
        </div>
        <div class="cfgRow ${wheel ? 'hidden' : ''}">
          <label class="small">Stick deadzone <input id="deadzone" type="range" min="0" max="0.3" step="0.01"></label>
          <label class="small">Stick response <input id="curve" type="range" min="1" max="2.5" step="0.1"></label>
        </div>
        <div class="cfgRow">
          <label class="small">${wheel ? 'Pedal' : 'Trigger'} weight <input id="pedalWeight" type="range" min="0" max="1" step="0.1"> <span id="weightVal"></span></label>
          <label class="small">Rumble <input id="rumble" type="range" min="0" max="2" step="0.1"> <span id="rumbleVal"></span></label>
          <button class="mini" id="testRumble">Test rumble</button>
        </div>
        <p class="small" id="rumbleNote" style="white-space: pre-wrap"></p>`;
      body.querySelector('b').textContent = pad.id;
      const $ = (id) => body.querySelector('#' + id);
      $('kind').value = prof.kind;
      $('kind').onchange = () => {
        prof.kind = $('kind').value;
        if (prof.kind === 'wheel') { prof.wheelRange ??= 900; prof.steerLock ??= 180; prof.deadzone = 0.01; prof.curve = 1; }
        else { prof.deadzone = 0.08; prof.curve = 1.5; }
        this.save(); render();
      };
      if (wheel) {
        $('wheelRange').value = String(prof.wheelRange);
        $('wheelRange').onchange = () => { prof.wheelRange = +$('wheelRange').value; this.save(); };
        $('steerLock').value = String(prof.steerLock);
        $('lockVal').textContent = `${prof.steerLock}°`;
        $('steerLock').oninput = () => { prof.steerLock = +$('steerLock').value; $('lockVal').textContent = `${prof.steerLock}°`; this.save(); };
      } else {
        $('deadzone').value = String(prof.deadzone);
        $('deadzone').oninput = () => { prof.deadzone = +$('deadzone').value; this.save(); };
        $('curve').value = String(prof.curve);
        $('curve').oninput = () => { prof.curve = +$('curve').value; this.save(); };
      }
      const WEIGHTS = ['Light', 'Light', 'Light-medium', 'Light-medium', 'Medium', 'Medium', 'Medium-heavy', 'Medium-heavy', 'Heavy', 'Heavy', 'Very heavy'];
      const showWeight = () => { $('weightVal').textContent = WEIGHTS[Math.round((prof.pedalWeight ?? 0) * 10)]; };
      $('pedalWeight').value = String(prof.pedalWeight ?? 0);
      showWeight();
      $('pedalWeight').oninput = () => { prof.pedalWeight = +$('pedalWeight').value; showWeight(); this.save(); };
      const showRumble = () => { $('rumbleVal').textContent = prof.rumble === 0 ? 'off' : `${Math.round((prof.rumble ?? 1) * 100)}%`; };
      $('rumble').value = String(prof.rumble ?? 1);
      showRumble();
      $('rumble').oninput = () => { prof.rumble = +$('rumble').value; showRumble(); this.save(); };
      const safari = /Safari/.test(navigator.userAgent) && !/Chrome|Chromium|Edg/.test(navigator.userAgent);
      const note = safari ? 'Safari doesn\'t give websites access to controller rumble. For rumble, open the sim in Chrome or Edge (http://localhost:8642). Weight still works here: the meters above show how hard you now have to press.'
        : this.canRumble()
        ? 'Rumble: kerbs, the drop onto the grass, sliding or locked tyres, the engine and hits. Weight: the throttle and brake meters above show how hard you now have to press.'
        : `This browser doesn't offer rumble for this ${wheel ? 'wheel' : 'controller'}${wheel ? ' (wheels have force feedback instead, which browsers can\'t drive)' : '. Rumble needs Chrome or Edge; Firefox has none'}. Weight still works: the meters above show how hard you now have to press.`;
      $('rumbleNote').textContent = `${note}\n${this.rumbleInfo()}`;
      $('testRumble').onclick = async () => {
        $('rumbleNote').textContent = 'Testing…';
        $('rumbleNote').textContent = `${await this.testRumble()}\n${this.rumbleInfo()}`;
      };
      $('startCalib').onclick = () => { calib = { step: 0, prof, padId: pad.id }; showStep(); };
      if (!prof.calibrated && !calib) { calib = { step: 0, prof, padId: pad.id }; showStep(); }
    };

    // ---- calibration wizard
    const STEPS = [
      'Let go of the pedals and centre the wheel (or leave the stick alone), then click Next.',
      'Press the THROTTLE all the way down and hold it, then click Next.',
      'Release the throttle. Press the BRAKE all the way down and hold it, then click Next.',
      'Release the brake. Turn the wheel a quarter turn (90°) to the RIGHT and hold it, or push the stick fully right, then click Next.',
    ];
    const snapshot = () => connectedPads().map(p => ({ id: p.id, axes: [...p.axes], buttons: p.buttons.map(b => b.value) }));
    // biggest change from the rest snapshot, optionally excluding controls already used
    const biggest = (rest, now, exclude = []) => {
      let best = null;
      for (const s of now) {
        const r = rest.find(x => x.id === s.id);
        if (!r) continue;
        s.axes.forEach((v, i) => {
          if (exclude.some(e => e.pad === s.id && e.axis === i)) return;
          const d = v - r.axes[i];
          if (!best || Math.abs(d) > Math.abs(best.d)) best = { pad: s.id, axis: i, d, rest: r.axes[i], full: v };
        });
        s.buttons.forEach((v, i) => {
          if (exclude.some(e => e.pad === s.id && e.button === i)) return;
          const d = v - r.buttons[i];
          if (!best || Math.abs(d) > Math.abs(best.d)) best = { pad: s.id, button: i, d, rest: r.buttons[i], full: v };
        });
      }
      return best && Math.abs(best.d) > 0.15 ? best : null;
    };
    const showStep = () => {
      const box = body.querySelector('#calib');
      if (!box) return;
      box.innerHTML = `<p><b>Calibration ${calib.step + 1}/4.</b> ${STEPS[calib.step]}</p><button class="mini" id="calibNext">Next</button> <span id="calibMsg" class="small"></span>`;
      box.querySelector('#calibNext').onclick = next;
    };
    const next = () => {
      const now = snapshot();
      const msg = (t) => { const m = body.querySelector('#calibMsg'); if (m) m.textContent = t; };
      const prof = calib.prof;
      if (calib.step === 0) { calib.rest = now; calib.step = 1; return showStep(); }
      if (calib.step === 1) {
        const b = biggest(calib.rest, now);
        if (!b) return msg('No pedal movement seen. Press it fully and try again.');
        calib.throttle = b.button !== undefined ? { pad: b.pad, button: b.button, rest: b.rest, full: b.full } : { pad: b.pad, axis: b.axis, rest: b.rest, full: b.full };
        calib.step = 2; return showStep();
      }
      if (calib.step === 2) {
        const b = biggest(calib.rest, now, [calib.throttle]);
        if (!b) return msg('No brake movement seen. Press it fully and try again.');
        calib.brake = b.button !== undefined ? { pad: b.pad, button: b.button, rest: b.rest, full: b.full } : { pad: b.pad, axis: b.axis, rest: b.rest, full: b.full };
        calib.step = 3; return showStep();
      }
      if (calib.step === 3) {
        const b = biggest(calib.rest, now, [calib.throttle, calib.brake].filter(Boolean));
        if (!b || b.axis === undefined) return msg('No steering movement seen. Turn it and try again.');
        prof.steer = { pad: b.pad, axis: b.axis, invert: b.d < 0 };
        prof.throttle = calib.throttle;
        prof.brake = calib.brake;
        const amount = Math.abs(b.d);
        if (amount < 0.7) {
          // a quarter turn moved the axis this far, so the wheel's full range is:
          const est = 180 / amount;
          const ranges = [180, 240, 270, 360, 540, 720, 900, 1080];
          prof.kind = 'wheel';
          prof.wheelRange = ranges.reduce((a, r) => Math.abs(r - est) < Math.abs(a - est) ? r : a, 900);
          prof.steerLock ??= 180; prof.deadzone = 0.01; prof.curve = 1;
        } else {
          prof.kind = 'pad'; prof.deadzone = 0.08; prof.curve = 1.5;
        }
        prof.calibrated = true;
        delete prof.preset;
        this.save();
        calib = null;
        render();
        const box = body.querySelector('#calib');
        if (box) box.innerHTML = '<p class="small">Calibrated. Check the meters above, then click Done.</p>';
      }
    };

    render();
    this.onDevicesChanged = () => { if (!root.classList.contains('hidden') && !calib) render(); };
    root.classList.remove('hidden');
    const tick = () => {
      if (root.classList.contains('hidden')) return;
      const act = this.activeProfile();
      if (act) {
        const pads = connectedPads();
        const st = Input.steerValue(act.prof, pads);
        const thr = pedal(Input.read(act.prof.throttle, pads), act.prof);
        const brk = pedal(Input.read(act.prof.brake, pads), act.prof);
        const set = (k, l, w, txt) => {
          const e = body.querySelector('#m_' + k); if (e) { e.style.left = l + '%'; e.style.width = w + '%'; }
          const v = body.querySelector('#v_' + k); if (v) v.textContent = txt;
        };
        set('steer', st < 0 ? 50 + st * 50 : 50, Math.abs(st) * 50, `${Math.round(st * 100)}%`);
        set('throttle', 0, thr * 100, act.prof.throttle ? `${Math.round(thr * 100)}%` : 'not set');
        set('brake', 0, brk * 100, act.prof.brake ? `${Math.round(brk * 100)}%` : 'not set');
        // raw readout of every device, so a wheel that misbehaves can be diagnosed
        const raw = body.querySelector('#raw');
        if (raw) raw.textContent = pads.map(p => `${p.id.slice(0, 40)}: axes [${p.axes.map(a => a.toFixed(2)).join(', ')}] · buttons down [${p.buttons.map((b, i) => (b.pressed || b.value > 0.1) ? i : null).filter(i => i !== null).join(', ')}]`).join('\n');
      }
      requestAnimationFrame(tick);
    };
    tick();
  }
}
