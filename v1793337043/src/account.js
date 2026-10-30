// Player accounts and the online leaderboard (Supabase).
//
// Three ways in: email + password, Google, or a driver name + password (no
// email; stored as a placeholder address on the players.tidalturns.invalid
// domain, which never receives mail). The signed-in profile carries the
// driver's look, kart, paint and settings between computers. Without a
// configured project, or signed out, the game runs on its local data.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const NAME_RE = /^[A-Za-z0-9_.-]{3,20}$/;
const NAME_DOMAIN = 'players.tidalturns.invalid';
const nameEmail = (name) => `${name.toLowerCase()}@${NAME_DOMAIN}`;

export class Account {
  constructor() {
    this.enabled = !!(SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase);
    this.user = null;
    this.profile = null;
    this.google = false;
    this.listeners = [];
    this._saveTimer = null;
    this._pending = {};
    if (!this.enabled) return;
    this.sb = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
    });
  }

  get signedIn() { return !!this.profile; }
  get name() { return this.profile?.username ?? null; }
  // made-up name until the player picks one (email and Google sign-ups)
  get needsName() { return !!this.profile && /^Driver[0-9a-f]{6}\d*$/.test(this.profile.username); }

  onChange(fn) { this.listeners.push(fn); }
  emit() { for (const fn of this.listeners) fn(this); }

  async init() {
    if (!this.enabled) return;
    // which sign-in methods the project has switched on
    fetch(`${SUPABASE_URL}/auth/v1/settings`, { headers: { apikey: SUPABASE_ANON_KEY } })
      .then(r => r.json()).then(s => { this.google = !!s.external?.google; }).catch(() => {});
    const { data } = await this.sb.auth.getSession();
    await this.setUser(data.session?.user ?? null);
    this.sb.auth.onAuthStateChange((_ev, session) => {
      const u = session?.user ?? null;
      if ((u?.id ?? null) !== (this.user?.id ?? null)) this.setUser(u);
    });
  }

  async setUser(user) {
    this.user = user;
    this.profile = null;
    if (user) {
      // the sign-up trigger makes the profile; give it a moment on first sign-in
      for (let i = 0; i < 5 && !this.profile; i++) {
        const { data } = await this.sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
        this.profile = data;
        if (!data) await new Promise(r => setTimeout(r, 400));
      }
    }
    this.emit();
  }

  // ---- sign in / up
  static validName(name) { return NAME_RE.test(name || ''); }

  async nameFree(name) {
    const { data, error } = await this.sb.rpc('username_available', { name });
    if (error) throw error;
    return data;
  }

  async signUpEmail(email, password) {
    const { data, error } = await this.sb.auth.signUp({ email, password, options: { emailRedirectTo: location.origin + location.pathname } });
    if (error) throw error;
    return { confirm: !data.session };          // true: check your inbox first
  }

  async signInEmail(email, password) {
    const { error } = await this.sb.auth.signInWithPassword({ email, password });
    if (error) throw error;
  }

  async signUpName(name, password) {
    if (!Account.validName(name)) throw new Error('Driver names are 3-20 letters, numbers, dots, dashes or underscores.');
    if (!(await this.nameFree(name))) throw new Error('That driver name is taken.');
    const { data, error } = await this.sb.auth.signUp({ email: nameEmail(name), password, options: { data: { username: name } } });
    if (error) throw error;
    if (!data.session) throw new Error('This project still requires email confirmation. Turn off "Confirm email" in Supabase (Authentication -> Providers -> Email) for driver-name accounts.');
  }

  async signInName(name, password) {
    const { error } = await this.sb.auth.signInWithPassword({ email: nameEmail(name), password });
    if (error) throw new Error(error.message === 'Invalid login credentials' ? 'Wrong driver name or password.' : error.message);
  }

  async signInGoogle() {
    const { error } = await this.sb.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: location.origin + location.pathname } });
    if (error) throw error;
  }

  async signOut() {
    await this.flush();
    await this.sb.auth.signOut();
  }

  async rename(name) {
    if (!Account.validName(name)) throw new Error('Driver names are 3-20 letters, numbers, dots, dashes or underscores.');
    if (name.toLowerCase() !== this.profile.username.toLowerCase() && !(await this.nameFree(name))) throw new Error('That driver name is taken.');
    const { error } = await this.sb.from('profiles').update({ username: name, updated_at: new Date().toISOString() }).eq('id', this.user.id);
    if (error) throw new Error(error.code === '23505' ? 'That driver name is taken.' : error.message);
    this.profile.username = name;
    this.emit();
  }

  // ---- synced data: look, kart, settings (batched; a burst of slider moves is one write)
  save(field, value) {
    if (!this.signedIn) return;
    this.profile[field] = value;
    this._pending[field] = value;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.flush(), 1500);
  }

  async flush() {
    clearTimeout(this._saveTimer);
    if (!this.signedIn || !Object.keys(this._pending).length) return;
    const patch = { ...this._pending, updated_at: new Date().toISOString() };
    this._pending = {};
    const { error } = await this.sb.from('profiles').update(patch).eq('id', this.user.id);
    if (error) console.warn('profile save:', error.message);
  }

  // ---- laps and the board
  async postLap(dir, time, kart, look) {
    if (!this.signedIn) return;
    const { error } = await this.sb.from('laps').insert({ user_id: this.user.id, dir, time, kart: kart || '', look: look || {} });
    if (error) {
      console.warn('lap not posted:', error.message);
      // a database that hasn't had supabase/layouts.sql run rejects the new layouts' laps
      if (/check constraint/i.test(error.message)) this.onReject?.(dir);
    }
  }

  // the best lap of each driver in this kart, this way round
  async top(dir, n = 10, kart = '') {
    const { data, error } = await this.sb.from('laps').select('user_id, time, kart, look, created_at, profiles(username)')
      .eq('dir', dir).eq('kart', kart).order('time').limit(400);
    if (error) throw error;
    const best = new Map();
    for (const l of data) if (!best.has(l.user_id)) best.set(l.user_id, l);
    return [...best.values()].slice(0, n).map(l => ({ name: l.profiles?.username ?? 'Driver', time: l.time, kart: l.kart, look: l.look,
      date: l.created_at?.slice(0, 10), user_id: l.user_id }));
  }

  async best(dir) {
    if (!this.signedIn) return null;
    const { data } = await this.sb.from('laps').select('time').eq('user_id', this.user.id).eq('dir', dir).order('time').limit(1);
    return data?.[0]?.time ?? null;
  }
}
