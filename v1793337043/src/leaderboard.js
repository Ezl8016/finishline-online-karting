// Fastest drivers: every driver's best valid lap, per track direction and
// kart (a KA100 and a rental kart don't race for the same times). Kept in
// this browser, so it ranks everyone who has driven on this computer; the
// worldwide board is online (account.js).

const STORE = 'tidalturns.leaderboard.v1';

export class Leaderboard {
  constructor() {
    this.data = { cw: {}, ccw: {} };
    try { this.data = { ...this.data, ...JSON.parse(localStorage.getItem(STORE)) }; } catch { /* empty board */ }
  }

  save() { try { localStorage.setItem(STORE, JSON.stringify(this.data)); } catch { /* private mode */ } }

  // A valid lap. look: the driver's helmet and suit, for the podium.
  // Returns the driver's rank (on that kart's board) if it improved their best, else null.
  record(dir, name, time, kart, look) {
    const key = (name || 'Driver').trim().slice(0, 20) || 'Driver';
    const board = this.data[`${dir}@${kart || ''}`] ??= {};
    const prev = board[key];
    if (prev && prev.time <= time) return null;
    board[key] = { time, kart: kart || '', date: new Date().toISOString().slice(0, 10), look: look || prev?.look || null };
    this.save();
    return this.top(dir, Infinity, kart).findIndex(e => e.name === key) + 1;
  }

  // (laps from before the boards were split by kart count on their kart's)
  top(dir, n = 10, kart = '') {
    const best = new Map();
    const old = Object.entries(this.data[dir] ?? {}).filter(([, e]) => (e.kart || '') === kart);
    for (const [name, e] of [...old, ...Object.entries(this.data[`${dir}@${kart}`] ?? {})]) {
      if (!best.has(name) || e.time < best.get(name).time) best.set(name, e);
    }
    return [...best.entries()].map(([name, e]) => ({ name, ...e })).sort((a, b) => a.time - b.time).slice(0, n);
  }

  best(dir, name, kart = '') { return this.top(dir, Infinity, kart).find(e => e.name === name)?.time ?? null; }
}
