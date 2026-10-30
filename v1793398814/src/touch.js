// On-screen controls for phones and tablets (shown only on a touchscreen):
// drag a thumb left and right anywhere in the lower left to steer (how far
// from where it first touched sets how much lock), hold GAS and BRAKE on the
// right, and small buttons along the top for the camera, reset, turn around
// and the menu. Feeds Input.touch, which poll() smooths like the keyboard.

const FULL_LOCK_PX = 70;         // thumb travel for full lock

export class TouchControls {
  constructor(input) {
    this.input = input;
    this.el = document.getElementById('touch');
    // a touchscreen (and not a laptop's mouse): show the controls
    const coarse = matchMedia('(pointer: coarse)');
    const mark = () => document.body.classList.toggle('touch', coarse.matches || this.touched === true);
    coarse.addEventListener?.('change', mark);
    addEventListener('touchstart', () => { if (!this.touched) { this.touched = true; mark(); } }, { passive: true, once: true });
    mark();

    const zone = document.getElementById('tSteer'), ring = zone.querySelector('.ring'), knob = zone.querySelector('.knob');
    let id = null, x0 = 0;
    const set = (v) => {
      input.touch.steer = v;
      knob.style.transform = `translateX(${(v * FULL_LOCK_PX).toFixed(1)}px)`;
    };
    zone.addEventListener('pointerdown', (e) => {
      if (id != null) return;
      id = e.pointerId; x0 = e.clientX;
      zone.setPointerCapture(id);
      const r = zone.getBoundingClientRect();
      ring.style.left = `${e.clientX - r.left}px`; ring.style.top = `${e.clientY - r.top}px`;
      zone.classList.add('on');
      input.touched();
      set(0);
    });
    zone.addEventListener('pointermove', (e) => {
      if (e.pointerId !== id) return;
      set(Math.max(-1, Math.min(1, (e.clientX - x0) / FULL_LOCK_PX)));
    });
    const lift = (e) => { if (e.pointerId !== id) return; id = null; zone.classList.remove('on'); set(0); };
    // (lostpointercapture too: whatever ends the touch, steering never sticks)
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) zone.addEventListener(ev, lift);

    for (const [elId, key] of [['tGas', 'gas'], ['tBrake', 'brake']]) {
      const b = document.getElementById(elId);
      const held = new Set();
      const update = () => { input.touch[key] = held.size > 0; b.classList.toggle('on', held.size > 0); };
      b.addEventListener('pointerdown', (e) => { held.add(e.pointerId); b.setPointerCapture(e.pointerId); input.touched(); update(); });
      // (lostpointercapture too: a pedal is never left stuck down)
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, (e) => { held.delete(e.pointerId); update(); });
    }
    // TALK: push to talk while it's held (voice chat in a server)
    {
      const b = document.getElementById('tTalk');
      const held = new Set();
      const update = () => { input.touch.talk = held.size > 0; b.classList.toggle('on', held.size > 0); };
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); held.add(e.pointerId); b.setPointerCapture(e.pointerId); update(); });
      for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) b.addEventListener(ev, (e) => { held.delete(e.pointerId); update(); });
    }
    for (const b of this.el.querySelectorAll('[data-a]')) {
      b.addEventListener('pointerdown', (e) => { e.preventDefault(); input.touched(); input.actions.push(b.dataset.a); });
    }
    addEventListener('blur', () => this.release());
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.release(); });
    // no page scrolling, zooming or long-press menus while driving
    this.el.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
    this.el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // let go of everything (leaving the track, opening a menu)
  release() {
    Object.assign(this.input.touch, { steer: 0, gas: false, brake: false, talk: false });
    for (const b of this.el.querySelectorAll('.on')) b.classList.remove('on');
  }
}
