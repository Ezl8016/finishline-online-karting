// The championship: one season everyone shares, on a schedule. The rounds and
// results live in the database (supabase/championship.sql); only the admin
// can change a round. On race night the game hosting the official server
// (main.js champTick) fills the seats with the season's AI drivers, runs
// qualifying and starts the race on time; everyone's finishing position is
// kept for good, and ties on points go to whoever has the better finishes.

export const SEASON = '2026-fall';
export const LOBBY_MIN = 15, QUALI_MIN = 10;   // minutes before the green flag
const LATE_MIN = 45;                           // a round is over this long after the flag

// (shown until the database answers, or if its tables aren't set up yet)
const at = (s) => new Date(s).getTime();
const SCHEDULE = [
  { round: 1, at: at('2026-11-07T20:00:00-06:00'), layout: 'short', dir: 'cw', kart: 'r25', tod: 'afternoon', laps: 20 },
  { round: 2, at: at('2026-11-14T20:00:00-06:00'), layout: 'l2', dir: 'cw', kart: 'honda', tod: 'afternoon', laps: 15 },
  { round: 3, at: at('2026-11-21T20:00:00-06:00'), layout: 'short', dir: 'ccw', kart: 'honda', tod: 'afternoon', laps: 24 },
  { round: 4, at: at('2026-12-05T20:00:00-06:00'), layout: 'kc', dir: 'cw', kart: 'honda', tod: 'afternoon', laps: 10 },
  { round: 5, at: at('2026-12-12T20:00:00-06:00'), layout: 'l2', dir: 'ccw', kart: 'ka100', tod: 'afternoon', laps: 18 },
  { round: 6, at: at('2026-12-19T20:00:00-06:00'), layout: 'bff', dir: 'cw', kart: 'ka100', tod: 'night', laps: 12 },
];

export class Championship {
  // sb(): the database client, or null
  constructor(sb) {
    this.sb = sb;
    this.rounds = SCHEDULE.map(r => ({ ...r }));
    this.results = [];
    this.live = false;                 // the database's tables answered
  }

  async load() {
    const db = this.sb();
    if (!db) return;
    const [r, x] = await Promise.all([
      db.from('champ_rounds').select('*').eq('season', SEASON).order('round'),
      db.from('champ_results').select('*').eq('season', SEASON),
    ]);
    if (r.error || x.error || !r.data?.length) return;
    this.rounds = r.data.map(d => ({ round: d.round, at: new Date(d.starts_at).getTime(), layout: d.layout, dir: d.dir, kart: d.kart, tod: d.tod, laps: d.laps }));
    this.results = x.data || [];
    this.live = true;
  }

  done(round) { return this.results.some(r => r.round === round); }
  // the next round to run (null: the season's over)
  next(now = Date.now()) { return this.rounds.find(r => !this.done(r.round) && now < r.at + LATE_MIN * 60e3) || null; }
  lobbyOpen(r, now = Date.now()) { return now >= r.at - LOBBY_MIN * 60e3; }

  // everyone's points and finishes, best first: most points, then countback:
  // most wins, then most second places, and so on down the positions
  standings() {
    const by = new Map();
    for (const r of this.results) {
      if (!by.has(r.driver)) by.set(r.driver, { id: r.driver, name: r.name, bot: r.bot, pts: 0, pos: {} });
      const d = by.get(r.driver);
      d.pts += r.pts; d.pos[r.round] = r.pos;
    }
    const count = (d, p) => Object.values(d.pos).filter(x => x === p).length;
    return [...by.values()].sort((a, b) => {
      if (b.pts !== a.pts) return b.pts - a.pts;
      for (let p = 1; p <= 11; p++) { const k = count(b, p) - count(a, p); if (k) return k; }
      return a.name.localeCompare(b.name);
    });
  }

  async submit(round, rows) {
    const { error } = await this.sb().rpc('champ_submit', { p_season: SEASON, p_round: round, p_rows: rows });
    if (error) throw error;
    await this.load();
  }

  // the admin's changes
  async setRound(round, at, laps) {
    const { error } = await this.sb().from('champ_rounds').update({ starts_at: new Date(at).toISOString(), laps }).eq('season', SEASON).eq('round', round);
    if (error) throw error;
    await this.load();
  }
  async clearResult(round) {
    const { error } = await this.sb().from('champ_results').delete().eq('season', SEASON).eq('round', round);
    if (error) throw error;
    await this.load();
  }
}
