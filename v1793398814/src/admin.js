// Admin powers (supabase/admin.sql sets up the database side). An admin is
// an account in ADMIN_UIDS, by id, never by name. In a server, other players'
// games only treat someone as an admin once the database confirms that
// session belongs to an admin account (only that account can register it).
//
// Local testing: on localhost, ?guest=Name&testadmin=Name makes that guest an
// admin on every test page, with no database involved.

export const ADMIN_UIDS = new Set(['8c894d35-d15a-44ad-875a-587d0fe6bfc9']);   // Ezra_Langley
const LOCAL = /^(localhost|127\.0\.0\.1)$/.test(location.hostname);
const TEST = LOCAL ? new URLSearchParams(location.search).get('testadmin') : null;
const GUEST = LOCAL ? new URLSearchParams(location.search).get('guest') : null;

export class Admin {
  constructor(account) {
    this.account = account;
    this.guest = GUEST;
    this.checked = new Map();        // server session id -> Promise<boolean>
    this.onAnnounce = null;          // (text) => show it
  }

  get sb() { return this.account.sb; }
  get uid() { return this.account.user?.id ?? null; }
  // this player is an admin
  get me() { return (!!this.uid && ADMIN_UIDS.has(this.uid)) || (!!TEST && this.guest === TEST); }

  // ---------------------------------------------------------------- sessions
  // our server session, registered so other players can check it's really us
  async registerSession(sessionId) {
    if (!this.me || TEST) return;
    await this.sb.from('admin_sessions').insert({ session_id: sessionId, user_id: this.uid }).then(() => {}, () => {});
  }
  async unregisterSession(sessionId) {
    if (!this.me || TEST || !sessionId) return;
    await this.sb.from('admin_sessions').delete().eq('session_id', sessionId).then(() => {}, () => {});
  }
  // is that server session an admin's? (meta: their presence: { uid, name })
  isAdminSession(sessionId, meta) {
    if (TEST) return Promise.resolve(meta?.name === TEST);
    if (!meta?.uid || !ADMIN_UIDS.has(meta.uid) || !this.sb) return Promise.resolve(false);
    if (!this.checked.has(sessionId)) {
      this.checked.set(sessionId, this.sb.from('admin_sessions').select('user_id').eq('session_id', sessionId).maybeSingle()
        .then(({ data }) => !!data && data.user_id === meta.uid, () => false));
    }
    return this.checked.get(sessionId);
  }

  // ---------------------------------------------------------------- bans
  // our own ban, if there is one: { until: Date | null, reason }
  async myBan() {
    if (!this.uid || !this.sb || this.me) return null;
    const { data } = await this.sb.from('bans').select('until, reason').eq('user_id', this.uid).maybeSingle().then(r => r, () => ({}));
    if (!data || (data.until && new Date(data.until) <= new Date())) return null;
    return { until: data.until ? new Date(data.until) : null, reason: data.reason };
  }
  async userByName(name) {
    const { data } = await this.sb.from('profiles').select('id, username').ilike('username', name.trim()).maybeSingle();
    return data;
  }
  // days: a number, or null for good
  async ban(userId, days, reason = '') {
    if (ADMIN_UIDS.has(userId)) throw new Error('Admins can\'t be banned.');
    const until = days == null ? null : new Date(Date.now() + days * 864e5).toISOString();
    const { error } = await this.sb.from('bans').upsert({ user_id: userId, until, reason: reason.slice(0, 200) });
    if (error) throw new Error(error.message);
  }
  async unban(userId) {
    const { error } = await this.sb.from('bans').delete().eq('user_id', userId);
    if (error) throw new Error(error.message);
  }
  // current bans, with names
  async bans() {
    const { data, error } = await this.sb.from('bans').select('user_id, until, reason, created_at').order('created_at', { ascending: false });
    if (error) throw new Error(error.message);
    const live = (data || []).filter(b => !b.until || new Date(b.until) > new Date());
    if (!live.length) return [];
    const { data: names } = await this.sb.from('profiles').select('id, username').in('id', live.map(b => b.user_id));
    const by = new Map((names || []).map(p => [p.id, p.username]));
    return live.map(b => ({ ...b, name: by.get(b.user_id) ?? '?' }));
  }

  // ---------------------------------------------------------------- lap times
  // take a driver's lap (their best on the board) off Fastest Drivers
  async deleteLap(dir, userId, time) {
    const { error, count } = await this.sb.from('laps').delete({ count: 'exact' }).eq('dir', dir).eq('user_id', userId).gte('time', time - 0.0005).lte('time', time + 0.0005);
    if (error) throw new Error(error.message);
    return count ?? 0;
  }

  // ---------------------------------------------------------------- servers
  // a host keeps its server's line in the list (admins read it)
  async listServer(row) {
    if (!this.uid || !this.sb) return;
    await this.sb.from('rooms').upsert({ ...row, host: this.uid, updated_at: new Date().toISOString() }).then(() => {}, () => {});
  }
  async unlistServer(code) {
    if (!this.uid || !this.sb || !code) return;
    await this.sb.from('rooms').delete().eq('code', code).then(() => {}, () => {});
  }
  // every server with a host seen in the last 90 s
  async servers() {
    const since = new Date(Date.now() - 90e3).toISOString();
    const { data, error } = await this.sb.from('rooms').select('*').gte('updated_at', since).order('n', { ascending: false });
    if (error) throw new Error(error.message);
    return data || [];
  }

  // ---------------------------------------------------------------- announcements
  async announce(text) {
    const { error } = await this.sb.from('announcements').insert({ text: text.trim().slice(0, 140) });
    if (error) throw new Error(error.message);
  }
  // every game hears new announcements
  listen() {
    if (!this.sb || this.listening) return;
    this.listening = this.sb.channel('announcements')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'announcements' }, ({ new: row }) => this.onAnnounce?.(row.text))
      .subscribe();
  }
}
