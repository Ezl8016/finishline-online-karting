// A driver's record and achievements, for their profile page. Kept on this
// computer and, signed in, with the account (in its settings, so it follows
// you to any computer and anyone can see it on your profile). The game tells
// it what happens (laps, races, distance); each achievement is a test on the
// record, unlocked (with the date) the first time it passes.

import { POINTS } from './shop.js';

const STORE = 'tidalturns.stats.v1';

export const ACHIEVEMENTS = [
  // laps and driving
  { id: 'firstLap', name: 'Off the Line', desc: 'Set your first valid lap', test: s => s.validLaps >= 1 },
  { id: 'laps100', name: 'Century', desc: 'Drive 100 valid laps', test: s => s.validLaps >= 100 },
  { id: 'laps500', name: 'Marathon', desc: 'Drive 500 valid laps', test: s => s.validLaps >= 500 },
  { id: 'km100', name: 'Road Trip', desc: 'Drive 100 km', test: s => s.km >= 100 },
  { id: 'hours5', name: 'Seat Time', desc: 'Spend 5 hours behind the wheel', test: s => s.seconds >= 5 * 3600 },
  { id: 'everyKart', name: 'Garage Regular', desc: 'Set a valid lap in every kart', test: s => Object.keys(s.karts).length >= 4 },
  { id: 'everyLayout', name: 'Know the Place', desc: 'Set a valid lap on every layout', test: s => Object.keys(s.layouts).length >= 3 },
  { id: 'bothWays', name: 'Both Ways Round', desc: 'Set a valid lap clockwise and counter-clockwise', test: s => !!(s.dirs.cw && s.dirs.ccw) },
  { id: 'rental29', name: 'Rental Hero', desc: 'Lap Tidal Turns under 29 s in the Rental Kart R25', test: s => under(s, 'Rental Kart R25', 29) },
  { id: 'lo27', name: 'Briggs Boss', desc: 'Lap Tidal Turns under 27 s in the LO206', test: s => under(s, 'LO206', 27) },
  { id: 'ka26', name: 'Two-Stroke Terror', desc: 'Lap Tidal Turns under 26 s in the KA100', test: s => under(s, 'KA100', 26) },
  { id: 'speed70', name: 'Seventy', desc: 'Reach 70 mph', test: s => s.topSpeed >= 70 / 2.23694 },
  { id: 'rainLap', name: 'Wet Weather Specialist', desc: 'Set a valid lap in the rain', test: s => s.rainLaps >= 1 },
  { id: 'eveningLap', name: 'Golden Hour', desc: 'Set a valid lap in the evening', test: s => s.eveningLaps >= 1 },
  // boards
  { id: 'top10', name: 'On the Board', desc: 'Make a Fastest Drivers top 10', test: s => !!s.top10 },
  { id: 'top1', name: 'Fastest Driver', desc: 'Top a Fastest Drivers board', test: s => !!s.top1 },
  // racing
  { id: 'firstRace', name: 'Lights Out', desc: 'Finish your first race', test: s => s.races >= 1 },
  { id: 'podium', name: 'Podium Finish', desc: 'Finish a race in the top three', test: s => s.podiums >= 1 },
  { id: 'firstWin', name: 'Winner', desc: 'Win a race', test: s => s.wins >= 1 },
  { id: 'wins10', name: 'Serial Winner', desc: 'Win 10 races', test: s => s.wins >= 10 },
  { id: 'pole', name: 'Pole Sitter', desc: 'Qualify on pole', test: s => s.poles >= 1 },
  { id: 'fastestLap', name: 'Purple Lap', desc: 'Set the fastest lap of a race', test: s => s.fastestLaps >= 1 },
  { id: 'clean', name: 'Clean Racer', desc: 'Finish 5 races without a penalty', test: s => s.cleanRaces >= 5 },
  { id: 'comeback', name: 'Comeback Kid', desc: 'Win a race from the back half of the grid (4 or more drivers)', test: s => s.comebacks >= 1 },
  { id: 'hardAI', name: 'Beat the Machines', desc: 'Win a race against Hard AI', test: s => s.hardWins >= 1 },
  { id: 'rainWin', name: 'Rain Master', desc: 'Win a race in the rain', test: s => s.rainWins >= 1 },
  { id: 'crowd', name: 'Full Grid', desc: 'Race against 5 or more other people', test: s => s.crowdRaces >= 1 },
  { id: 'champ', name: 'Championship Leader', desc: 'Lead a championship after 3 or more races', test: s => !!s.champLead },
];
// a best lap under t on the short layout (either way round) in a kart
const under = (s, kart, t) => ['cw', 'ccw'].some(d => (s.best[`${d}@${kart}`] ?? Infinity) < t);

const EMPTY = () => ({ laps: 0, validLaps: 0, km: 0, seconds: 0, topSpeed: 0, rainLaps: 0, eveningLaps: 0,
  races: 0, wins: 0, podiums: 0, poles: 0, fastestLaps: 0, cleanRaces: 0, comebacks: 0, hardWins: 0, rainWins: 0, crowdRaces: 0,
  top10: false, top1: false, champLead: false, karts: {}, layouts: {}, dirs: {}, best: {}, unlocked: {},
  points: 0, owned: {} });                 // the shop (shop.js): points earned, and what was bought, for how many

export class Stats {
  constructor() {
    this.onEarn = null;              // (points, why) when points are earned
    this.data = EMPTY();
    try { this.data = { ...this.data, ...JSON.parse(localStorage.getItem(STORE)) }; } catch { /* a fresh record */ }
    this.check(true);
  }

  save() { try { localStorage.setItem(STORE, JSON.stringify(this.data)); } catch { /* full */ } }

  // the account's record and this computer's together: the most of each
  // count, every kart and layout, the best of each lap, the first of each unlock
  merge(o) {
    if (!o) return;
    const d = this.data;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === 'number') d[k] = Math.max(d[k] ?? 0, v);
      else if (typeof v === 'boolean') d[k] = !!(d[k] || v);
    }
    for (const k of ['karts', 'layouts', 'dirs', 'owned']) Object.assign(d[k], o[k] || {});
    for (const [k, t] of Object.entries(o.best || {})) if (!(d.best[k] <= t)) d.best[k] = t;
    for (const [k, t] of Object.entries(o.unlocked || {})) if (!d.unlocked[k] || t < d.unlocked[k]) d.unlocked[k] = t;
    this.save();
  }

  // points for the shop
  earn(n, why) {
    this.data.points = (this.data.points || 0) + n;
    this.save();
    this.onEarn?.(n, why);
  }
  buy(id, price) {
    this.data.owned[id] = price;
    this.save();
  }

  // driving: distance and time, and the top speed
  drive(dt, speed) {
    this.data.km += speed * dt / 1000;
    this.data.seconds += dt;
    if (speed > this.data.topSpeed) this.data.topSpeed = speed;
  }

  // a lap: { valid, time, layout, dir, kart, weather, time of day }; true if a personal best
  lap(l) {
    const d = this.data;
    d.laps++;
    if (!l.valid) return;
    d.validLaps++;
    d.karts[l.kart] = 1; d.layouts[l.layout] = 1; d.dirs[l.dir] = 1;
    if (l.weather === 'rain') d.rainLaps++;
    if (l.tod === 'evening') d.eveningLaps++;
    const key = `${l.layout === 'short' ? '' : l.layout + '.'}${l.dir}@${l.kart}`;
    const pb = !(d.best[key] <= l.time);
    if (pb) d.best[key] = l.time;
    this.earn(POINTS.lap + (pb ? POINTS.best : 0), pb ? 'best' : 'lap');
    return pb;
  }

  // a race finished: { pos, of, grid (1 = pole), pens, fastest, hardAI, rain, people }
  race(r) {
    const d = this.data;
    d.races++;
    if (r.pos <= 3 && r.of >= 2) d.podiums++;
    if (r.pos === 1 && r.of >= 2) {
      d.wins++;
      if (r.of >= 4 && r.grid > r.of / 2) d.comebacks++;
      if (r.hardAI) d.hardWins++;
      if (r.rain) d.rainWins++;
    }
    if (r.fastest && r.of >= 2) { d.fastestLaps++; this.earn(POINTS.fastestLap, 'fastestLap'); }
    if (!r.pens) d.cleanRaces++;
    if (r.people >= 5) d.crowdRaces++;
  }

  // new unlocks, dated (quiet: just catch up, no news)
  check(quiet = false) {
    const out = [], day = new Date().toISOString().slice(0, 10);
    for (const a of ACHIEVEMENTS) {
      if (this.data.unlocked[a.id] || !a.test(this.data)) continue;
      this.data.unlocked[a.id] = day;
      if (!quiet) out.push(a);
    }
    if (out.length) this.save();
    return out;
  }
}
