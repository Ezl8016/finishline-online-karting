// Background music: laid-back house in the menus, upbeat EDM while driving,
// and in the clubhouse The Marlo Boys and Adam Holt (used with their
// permission); Settings' "real artist music" plays theirs on track too, one
// playlist carrying on between track and clubhouse. See assets/music/CREDITS.txt.
// Each list is shuffled every time you enter it and reshuffled when it runs
// out, round and round for as long as you play;
// tracks whose file isn't there are skipped. onTrack(track) fires when a
// song starts (null: nothing playing).
//
// The songs are found from the page's own address rather than the current
// version folder (<base href>), so publishing an update never pulls them
// out from under someone playing (tools/publish_pages.sh keeps them outside
// the version folders).

const T = (file, title, artist) => ({ src: new URL(`assets/music/${file}`, location.href).href, title, artist });
const FAILS_TO_DROP = 3;         // a song is skipped for good only after failing this often
const STUCK_S = 20;              // a song that hasn't moved for this long is skipped

const LOBBY = [
  T('if-you-dont-love-me.mp3', "If You Don't Love Me", 'Snabisch'),
  T('chill-house.mp3', 'Chill House', 'Aurec'),
  T('deep-house-sunset.mp3', 'Deep House Sunset', 'sunset-house-grooves'),
  T('sunset-house-classic.mp3', 'Sunset House Classic', 'sunset-house-grooves'),
  T('luxury-life.mp3', 'Luxury Life', 'Kulakovka'),
  T('chill-deep-house.mp3', 'Chill Deep House', 'Kulakovka'),
];
const RACE = [
  T('we-own-the-night.mp3', 'We Own the Night', 'jakob_welik'),
  T('falling-into-you.mp3', 'Falling Into You (After the Drop)', 'jakob_welik'),
  T('neon-skies.mp3', 'Neon Skies', 'jakob_welik'),
  T('forever.mp3', 'Forever (EDM Trance Vibes)', 'diogodasilvasimoes'),
  T('unity.mp3', 'Unity (MainStage Dark EDM)', 'diogodasilvasimoes'),
  T('epic-fast-bitwise-edm.mp3', 'Epic Fast Bitwise EDM', 'AllWorldMusic'),
  T('energy-edm.mp3', 'Energy EDM', 'The_Mountain'),
  T('edm-fun.mp3', 'EDM Fun', 'The_Mountain'),
  T('hard-edm.mp3', 'Hard EDM', 'Kulakovka'),
  T('neon-love.mp3', 'Neon Love (Cyberpunk EDM)', 'SoundUniverseStudio'),
  T('heavy-dubstep-bass-drop-edm.mp3', 'Heavy Dubstep Bass Drop EDM', 'alex-morgan'),
  T('acid-edm.mp3', 'Acid EDM', 'Kulakovka'),
  T('edm-house.mp3', 'EDM - House', 'DJDoblina'),
  T('edm.mp3', 'EDM', 'Ashika006'),
];
// the clubhouse, and on track too with Settings' "real artist music": by permission of the artists
const LOUNGE = [
  T('mr-morning-drive.mp3', 'Mr. Morning Drive', 'Adam Holt'),
  T('dont-give-up-on-me-baby.mp3', "Don't Give Up on Me Baby", 'Adam Holt'),
  T('give-the-dog-a-bone.mp3', 'Give the Dog a Bone', 'Adam Holt'),
  T('the-story-must-go-on.mp3', 'The Story Must Go On', 'Adam Holt'),
  T('local-band.m4a', 'Local Band', 'The Marlo Boys'),
  T('gonna-be-alright.mp3', 'Gonna Be Alright', 'The Marlo Boys'),
  T('kate.mp3', 'Kate', 'The Marlo Boys'),
  T('no-more-excuses.mp3', 'No More Excuses', 'The Marlo Boys'),
  T('technicolor.mp3', 'Technicolor', 'The Marlo Boys'),
  T('without-your-love.mp3', 'Without Your Love', 'The Marlo Boys'),
];
const STORE = 'tidalturns.music.v1';

export class Music {
  constructor() {
    let saved = {};
    try { saved = JSON.parse(localStorage.getItem(STORE)) || {}; } catch { /* default */ }
    this.volume = saved.volume ?? 0.45;
    this.enabled = saved.enabled ?? true;
    this.artists = saved.artists ?? false;       // on track: the artists' songs instead of EDM
    this.mode = null;
    this.el = new Audio();
    this.el.preload = 'auto';
    this.el.addEventListener('ended', () => this.next());
    // a song that won't load: try the next, but don't drop it for good over a
    // passing network hiccup; if nothing at all will play, wait and retry
    this.fails = new Map();
    this.failsInRow = 0;
    this.el.addEventListener('error', () => {
      const src = this.track?.src;
      if (src) { this.fails.set(src, (this.fails.get(src) || 0) + 1); if (this.fails.get(src) >= FAILS_TO_DROP) this.missing.add(src); }
      this.failsInRow++;
      if (this.failsInRow >= Math.max(1, this.list().length)) { this.failsInRow = 0; clearTimeout(this.retry); this.retry = setTimeout(() => this.next(), 15000); }
      else this.next();
    });
    this.el.addEventListener('playing', () => { this.failsInRow = 0; this.blocked = false; });
    // the browser refused to start a song (screen locked, tab in the
    // background): start it on the next tap or key press
    this.blocked = false;
    const resume = () => { if (this.blocked && this.enabled && this.track) this.el.play().then(() => { this.blocked = false; }).catch(() => {}); };
    addEventListener('pointerdown', resume);
    addEventListener('keydown', resume);
    // and a watchdog: a song that stalls, or ended without saying so, moves on
    this.lastPos = -1; this.still = 0;
    setInterval(() => {
      if (!this.enabled || !this.track || this.blocked) { this.still = 0; return; }
      if (this.el.ended) { this.next(); return; }
      if (this.el.paused) { this.el.play().catch(() => { this.blocked = true; }); return; }
      this.still = this.el.currentTime === this.lastPos ? this.still + 5 : 0;
      this.lastPos = this.el.currentTime;
      if (this.still >= STUCK_S) { this.still = 0; this.next(); }
    }, 5000);
    this.queue = [];
    this.track = null;
    this.missing = new Set();
    this.onTrack = null;
    this.duck = 1;               // lowered while driving so the engine stays audible
    // find out which files are actually there
    this.ready = Promise.all([...LOBBY, ...RACE, ...LOUNGE].map(async (t) => {
      try { if (!(await fetch(t.src, { method: 'HEAD' })).ok) this.missing.add(t.src); } catch { this.missing.add(t.src); }
    }));
  }

  save() {
    try { localStorage.setItem(STORE, JSON.stringify({ volume: this.volume, enabled: this.enabled, artists: this.artists })); } catch { /* ignore */ }
  }

  apply() { this.el.volume = this.enabled ? this.volume * this.duck : 0; }

  // which songs play where (on track: EDM, or the artists' songs if chosen)
  lists(mode) { return { lobby: LOBBY, race: this.artists ? LOUNGE : RACE, lounge: LOUNGE }[mode] || LOBBY; }

  list() { return this.lists(this.mode).filter(t => !this.missing.has(t.src)); }

  // Fisher-Yates: a fair shuffle (sorting by random() isn't)
  static shuffle(a) {
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  // 'lobby', 'race' or 'lounge'; must first be called from a click/keypress (autoplay rules)
  play(mode) {
    // (from the track to the clubhouse and back: the same songs, so the one playing carries on, only louder or softer)
    if (mode !== this.mode && this.mode && this.lists(mode) === this.lists(this.mode)) { this.mode = mode; this.duck = mode === 'race' ? 0.55 : 1; }
    if (mode !== this.mode) {
      this.mode = mode;
      this.duck = mode === 'race' ? 0.55 : 1;
      this.queue = [];
      this.track = null;
      // wait for the file check, so a missing song doesn't flash up first
      this.ready.then(() => { if (this.mode === mode && !this.track) this.next(); });
      return;
    }
    this.apply();
    if (this.enabled && this.el.paused && this.track) this.play_();
  }

  // start the current song; if the browser says no, wait for a tap or key
  play_() { this.el.play().then(() => { this.blocked = false; }).catch(() => { this.blocked = true; }); }

  next() {
    if (!this.queue.length) {
      const list = this.list();
      if (!list.length) { this.track = null; this.el.pause(); this.el.removeAttribute('src'); this.onTrack?.(null); return; }
      this.queue = Music.shuffle(list.slice());
      // don't play the same song twice in a row across a reshuffle
      if (this.queue.length > 1 && this.queue[0] === this.track) this.queue.push(this.queue.shift());
    }
    this.track = this.queue.shift();
    this.el.src = this.track.src;
    this.apply();
    this.still = 0; this.lastPos = -1;
    if (this.enabled) this.play_();
    this.onTrack?.(this.enabled ? this.track : null);
  }

  // Settings' "real artist music": on track, The Marlo Boys and Adam Holt instead of EDM (a change swaps the song now if you're driving)
  setArtists(on) {
    this.artists = on; this.save();
    if (this.mode === 'race') { const m = this.mode; this.mode = null; this.play(m); }
  }

    setVolume(v) { this.volume = v; this.apply(); this.save(); }

  toggle() {
    this.enabled = !this.enabled;
    this.apply();
    if (this.enabled && this.el.paused && this.track) this.play_();
    this.onTrack?.(this.enabled ? this.track : null);
    this.save();
    return this.enabled;
  }

  pause() { this.el.pause(); }
}
