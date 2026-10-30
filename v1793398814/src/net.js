// Online servers (rooms). Supabase Realtime does the matchmaking: who's in a
// room (presence), the public server list, the room's track and races, and
// the WebRTC handshakes. The karts' positions then go straight between the
// players over WebRTC data channels, 20 times a second, so a busy room costs
// almost nothing in Realtime messages. If two players can't connect directly
// (some strict networks), their positions go through Realtime instead, slower.
// AI drivers can be in a room too (room.bots): the host's computer drives
// them and sends their positions with its own; to everyone else they're
// players like any other.
// Each link also carries voice (voice.js): turning the microphone on adds it
// to every link, which then renegotiates ("perfect negotiation": either side
// may, the polite one gives way if both do at once).

const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
export const MAX_PLAYERS = 11;      // drivers in a room, AI drivers included
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';     // no 0/O or 1/I
const LOBBY = 'tt-lobby';
const roomTopic = (code) => `tt-room-${code}`;
const rid = (n) => Array.from(crypto.getRandomValues(new Uint8Array(n)), b => CODE_CHARS[b % CODE_CHARS.length]).join('');
export const newCode = () => rid(5);
export const cleanCode = (s) => (s || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);

export class Net {
  constructor(sb) {
    this.sb = sb;
    this.id = rid(10);              // this session in the room (one account can't be in a room twice)
    this.room = null;               // the host's room settings, shared by everyone
    this.code = null;
    this.members = new Map();       // id -> presence meta (everyone but me)
    this.peers = new Map();         // id -> { pc, dc, micSender, polite, makingOffer }
    this.mic = null;                // our microphone track for voice chat (or null)
    this.admins = new Set();        // sessions confirmed as admins (main.js / admin.js): they host wherever they are
    this.ch = null;
    this.lobby = null;
    this.meta = null;
    this.on = {};                   // handlers: state, members, room, msg, closed
    this._relayAt = 0;
    this._lobbyMeta = '';
    this._lobbyAt = 0;
  }

  emit(ev, ...a) { this.on[ev]?.(...a); }
  get inRoom() { return !!this.ch; }
  // the host: an admin whenever one's here, else the server's owner (whoever
  // made it, by account) whenever they're in it, else whoever has been in
  // the room longest
  get hostId() {
    let best = null, owner = null, admin = null;
    const first = (a, m, id) => !a || m.since < a[0] || (m.since === a[0] && id < a[1]);
    const all = this.meta ? [[this.id, this.meta], ...this.members] : [...this.members];
    for (const [id, m] of all) {
      if (m.bot) continue;
      if (first(best, m, id)) best = [m.since, id];
      if (this.room?.owner && m.uid === this.room.owner && first(owner, m, id)) owner = [m.since, id];
      if (this.admins.has(id) && first(admin, m, id)) admin = [m.since, id];
    }
    return (admin ?? owner ?? best)?.[1] ?? null;
  }

  // an admin was confirmed (or left): the host may change
  setAdmin(id, on) {
    const before = this.hostId;
    if (on) this.admins.add(id); else this.admins.delete(id);
    if (this.meta && before !== this.hostId) { this.emit('members'); if (this.isHost && this.room) this.setRoom({}); }
  }
  get isHost() { return this.inRoom && this.hostId === this.id; }

  // ---------------------------------------------------------------- server list
  watchLobby(onList) {
    this.unwatchLobby();
    const ch = this.lobby = this.sb.channel(LOBBY, { config: { presence: { key: this.id, enabled: true } } });
    const list = () => {
      const out = [];
      for (const metas of Object.values(ch.presenceState())) for (const m of metas) if (m.code) out.push(m);
      onList(out.sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)));
    };
    ch.on('presence', { event: 'sync' }, list).subscribe();
  }
  unwatchLobby() {
    // a public room's host stays listed while they're in the room
    if (this.lobby && !(this.isHost && this.room?.public)) { this.sb.removeChannel(this.lobby); this.lobby = null; }
  }

  // public rooms: the host keeps the room's entry in the server list up to date
  // (presence updates are rate limited, so at most every few seconds)
  advertise(force = false) {
    const want = this.isHost && this.room?.public;
    if (!want) {
      if (this.lobby && this._lobbyMeta) { this.lobby.untrack(); this._lobbyMeta = ''; }
      return;
    }
    const r = this.room;
    const meta = { code: this.code, name: r.name, layout: r.layout, dir: r.dir, kart: r.kart || null, n: this.members.size + 1, racing: !!(r.race && r.race.phase !== 'done') };
    const key = JSON.stringify(meta);
    if (key === this._lobbyMeta || (!force && performance.now() - this._lobbyAt < 6000)) return;
    if (!this.lobby) {
      this.lobby = this.sb.channel(LOBBY, { config: { presence: { key: this.id, enabled: true } } });
      this.lobby.subscribe((s) => { if (s === 'SUBSCRIBED') { this._lobbyMeta = ''; this.advertise(true); } });
      return;
    }
    if (this.lobby.state !== 'joined') return;
    this._lobbyMeta = key; this._lobbyAt = performance.now();
    this.lobby.track(meta);
  }

  // ---------------------------------------------------------------- rooms
  // create: room settings to start a new room with; otherwise join an existing one
  // (opts.anyway: an admin gets in even when it's full)
  async join(code, me, create = null, opts = {}) {
    // an offline server (racing the AI): only this computer and its AI
    // drivers (addBot), nothing sent anywhere
    if (opts.offline) {
      await this._leaveRoom();
      this.offline = true; this.code = code;
      this.ch = { offline: true, send() {}, track() {}, untrack() {} };
      this.meta = { ...me, since: Date.now() };
      this.room = { ...create, owner: me.uid ?? null, v: 1, by: this.id, race: null };
      this.syncBots(true);
      return this.room;
    }
    // (the server list stays open until we're in: closing the last channel
    // drops the connection, and the new channel would race it)
    await this._leaveRoom();
    this.code = code;
    const ch = this.ch = this.sb.channel(roomTopic(code), { config: { presence: { key: this.id, enabled: true }, broadcast: { self: false } } });
    let gotRoom = null;
    const roomP = new Promise((res) => { gotRoom = res; });
    ch.on('presence', { event: 'sync' }, () => this._sync());
    ch.on('broadcast', { event: 'room' }, ({ payload }) => {
      if (!this.room || payload.v >= (this.room.v ?? 0) || payload.by !== this.room.by) {
        const hostBefore = this.hostId;
        this.room = payload;
        this.syncBots(!this.meta);
        this.emit('room', payload);
        // the owner is back: they take the room over as it is
        if (this.meta && hostBefore !== this.hostId) { this.emit('members'); if (this.isHost) this.setRoom({}); }
      }
      gotRoom(payload);
    });
    ch.on('broadcast', { event: 'hello' }, ({ payload }) => { if (this.isHost && this.room) this.sendRoom(); this._connect(payload.id); });
    ch.on('broadcast', { event: 'sig' }, ({ payload }) => { if (payload.to === this.id) this._signal(payload); });
    ch.on('broadcast', { event: 's' }, ({ payload }) => {
      // relayed positions, only from players we have no direct link to
      if (this.peers.get(payload.id)?.dc?.readyState === 'open') return;
      if (payload.B) this._bots(payload.B); else this.emit('state', payload.id, payload.d);
    });
    ch.on('broadcast', { event: 'msg' }, ({ payload }) => this.emit('msg', payload));
    await new Promise((res, rej) => {
      const t = setTimeout(() => rej(new Error('Couldn\'t reach the game servers. Check your connection and try again.')), 10000);
      ch.subscribe((s) => {
        if (s === 'SUBSCRIBED') { clearTimeout(t); res(); }
        else if (s === 'CHANNEL_ERROR' || s === 'TIMED_OUT') { clearTimeout(t); rej(new Error('Couldn\'t reach the game servers. Check your connection and try again.')); }
      });
    });
    // who's here already (the first sync comes just after subscribing)
    await new Promise(r => setTimeout(r, 900));
    const others = this._others();
    // (either: the championship's server: open it if nobody's there yet, else join)
    if (opts.either && others.length) create = null;
    if (!create && !others.length) { await this._leaveRoom(); throw new Error(`No server with the code ${code}. Check the code, or the server may have closed.`); }
    const full = () => this._leaveRoom().then(() => { throw new Error(`That server is full (${MAX_PLAYERS} drivers).`); });
    if (others.length >= MAX_PLAYERS && !opts.anyway) await full();
    // join after everyone already here, whatever this computer's clock says
    const since = Math.max(Date.now(), ...others.map(([, m]) => m.since + 1));
    this.meta = { ...me, since };
    await ch.track(this.meta);
    for (const id of this.members.keys()) this._connect(id);
    if (create) {
      this.room = { ...create, owner: me.uid ?? null, v: 1, by: this.id, race: null };
      this.syncBots(true);
      this.sendRoom();
    } else {
      ch.send({ type: 'broadcast', event: 'hello', payload: { id: this.id } });
      const r = await Promise.race([roomP, new Promise(r => setTimeout(r, 5000))]);
      if (!r) { await this._leaveRoom(); throw new Error('That server didn\'t answer. Try again in a moment.'); }
      // (its AI drivers take places too)
      // (and in the championship people take the AI's seats)
      if (others.length + (r.round ? 0 : r.bots?.length ?? 0) >= MAX_PLAYERS && !opts.anyway) await full();
      this.syncBots(true);
    }
    this.advertise(true);
    return this.room;
  }

  async leave() {
    if (this.lobby) { this.sb.removeChannel(this.lobby); this.lobby = null; this._lobbyMeta = ''; }
    await this._leaveRoom();
  }
  async _leaveRoom() {
    for (const id of [...this.peers.keys()]) this._drop(id);
    if (this.ch) { const ch = this.ch; this.ch = null; if (!ch.offline) { try { await ch.untrack(); } catch { /* gone */ } await this.sb.removeChannel(ch); } }
    this.offline = false;
    this.members.clear();
    this.admins.clear();
    this.room = null; this.code = null; this.meta = null;
  }

  // the room's AI drivers (room.bots) are members like the players: they
  // join and leave as the host adds and removes them (quiet: no news, as
  // when we've only just come in)
  syncBots(quiet = false) {
    const want = new Map((this.room?.bots || []).map(b => [b.id, b]));
    let changed = false;
    for (const [id, m] of [...this.members]) {
      if (!m.bot || want.has(id)) continue;
      this.members.delete(id); changed = true;
      if (!quiet) this.emit('left', id);
    }
    for (const [id, b] of want) {
      if (this.members.has(id)) continue;
      const m = { ...b, bot: true, since: Infinity };
      this.members.set(id, m); changed = true;
      if (!quiet) this.emit('joined', id, m);
    }
    if (changed && !quiet) this.emit('members');
  }
  get humans() { let n = 0; for (const m of this.members.values()) if (!m.bot) n++; return n; }

  // the host: its AI drivers' positions, all in one packet ({ id: state })
  sendBots(B) {
    if (!this.ch || this.offline) return;
    const s = JSON.stringify({ B });
    let relay = false;
    for (const [id, m] of this.members) {
      if (m.bot) continue;
      const p = this.peers.get(id);
      if (p?.dc?.readyState === 'open') { try { p.dc.send(s); } catch { /* closing */ } }
      else if (!p || performance.now() - p.made > 6000) relay = true;
    }
    if (relay && performance.now() - (this._botRelayAt ?? 0) > 200) {
      this._botRelayAt = performance.now();
      this.ch.send({ type: 'broadcast', event: 's', payload: { id: this.id, B } });
    }
  }
  _bots(B) { for (const [id, d] of Object.entries(B)) if (this.members.get(id)?.bot) this.emit('state', id, d); }
  // a message on an AI driver's behalf (its finish), from the host
  sendAs(payload) { if (!this.offline) this.ch?.send({ type: 'broadcast', event: 'msg', payload }); }

  // the host changes the room (track, races); everyone follows the newest version
  setRoom(patch) {
    if (!this.isHost) return;
    this.room = { ...this.room, ...patch, v: (this.room.v ?? 0) + 1, by: this.id };
    this.syncBots();
    this.sendRoom();
    this.emit('room', this.room);
  }
  sendRoom() {
    this.ch?.send({ type: 'broadcast', event: 'room', payload: this.room });
    this.advertise(true);
  }

  // race events and the like, to everyone in the room
  send(payload) { this.ch?.send({ type: 'broadcast', event: 'msg', payload: { ...payload, from: this.id } }); }

  // this kart's state, straight to each player (or relayed for the ones we
  // can't reach directly, at a lower rate)
  sendState(d) {
    if (!this.ch) return;
    const s = JSON.stringify(d);
    let relay = false;
    for (const [id, m] of this.members) {
      if (m.bot) continue;
      const p = this.peers.get(id);
      if (p?.dc?.readyState === 'open') { try { p.dc.send(s); } catch { /* closing */ } }
      else if (!p || performance.now() - p.made > 6000) relay = true;
    }
    if (relay && performance.now() - this._relayAt > 200) {
      this._relayAt = performance.now();
      this.ch.send({ type: 'broadcast', event: 's', payload: { id: this.id, d } });
    }
  }

  // round-trip time to a player over the direct link, if there is one
  direct(id) { return this.peers.get(id)?.dc?.readyState === 'open'; }

  // voice chat: put our microphone on every link (null takes it off). It's
  // added as a real track and the link renegotiates (see _peer): swapping a
  // track into an empty or placeholder channel doesn't carry sound in Safari.
  setMicTrack(track) {
    this.mic = track;
    for (const p of this.peers.values()) this._micOn(p);
  }
  _micOn(p) {
    if (p.pc.signalingState === 'closed') return;
    if (this.mic && !p.micSender) p.micSender = p.pc.addTrack(this.mic, new MediaStream([this.mic]));
    else if (!this.mic && p.micSender) { try { p.pc.removeTrack(p.micSender); } catch { /* closing */ } p.micSender = null; }
  }

  // how much sound energy has gone out to and come in from a player so far
  // (for the menu's readout: silence adds nothing, speech does)
  async voiceEnergy(id) {
    const p = this.peers.get(id);
    if (!p) return null;
    let out = null, inn = null;
    try {
      for (const r of (await p.pc.getStats()).values()) {
        if (r.type === 'media-source' && r.kind === 'audio' && r.totalAudioEnergy != null) out = (out ?? 0) + r.totalAudioEnergy;
        if (r.type === 'inbound-rtp' && (r.kind === 'audio' || r.mediaType === 'audio') && r.totalAudioEnergy != null) inn = (inn ?? 0) + r.totalAudioEnergy;
      }
    } catch { return null; }
    return { out, inn };
  }

  _others() {
    const out = [];
    if (!this.ch) return out;
    for (const [key, metas] of Object.entries(this.ch.presenceState())) if (key !== this.id && metas[0]) out.push([key, metas[0]]);
    return out;
  }

  _sync() {
    const now = new Map(this._others());
    const hostBefore = this.hostId;
    for (const [id, m] of [...this.members]) if (!m.bot && !now.has(id)) { this.members.delete(id); this._drop(id); this.emit('left', id); }
    for (const [id, m] of now) if (!this.members.has(id)) { this.members.set(id, m); if (this.meta) this.emit('joined', id, m); this._connect(id); }
    this.emit('members');
    // the host left: the next in line takes over the room as it was
    if (this.meta && hostBefore !== this.hostId && this.isHost && this.room) this.setRoom({});
    this.advertise();
  }

  // ---------------------------------------------------------------- WebRTC
  // the player with the smaller id starts the link; after that either side
  // may renegotiate it (adding the microphone), and the one with the larger
  // id is "polite": it gives way if both offer at once
  _connect(id) {
    if (!this.meta || id === this.id || this.peers.has(id) || !this.members.has(id) || this.members.get(id).bot) return;
    if (this.id < id) this._peer(id, true);
  }

  _peer(id, starter) {
    const pc = new RTCPeerConnection({ iceServers: ICE });
    const p = { pc, dc: null, made: performance.now(), micSender: null, polite: this.id > id, makingOffer: false, ignoreOffer: false };
    this.peers.set(id, p);
    const sig = (body) => this.ch?.send({ type: 'broadcast', event: 'sig', payload: { from: this.id, to: id, ...body } });
    p.sig = sig;
    pc.onicecandidate = (e) => { if (e.candidate) sig({ cand: e.candidate.toJSON() }); };
    const wire = (dc) => {
      p.dc = dc;
      dc.onmessage = (e) => {
        let d; try { d = JSON.parse(e.data); } catch { return; }     // (a bad packet)
        if (d.B) this._bots(d.B); else this.emit('state', id, d);
      };
    };
    // voice: their microphone arrives here (see setMicTrack for ours)
    p.heard = new Set();            // the voice tracks already passed on
    pc.ontrack = (e) => { p.heard.add(e.track.id); this.emit('track', id, e.streams[0] || new MediaStream([e.track])); };
    // any change (the data channel, a microphone added or taken off) is offered
    pc.onnegotiationneeded = async () => {
      try {
        p.makingOffer = true;
        const offer = await pc.createOffer();
        if (pc.signalingState !== 'stable') return;
        await pc.setLocalDescription(offer);
        sig({ desc: pc.localDescription.toJSON() });
      } catch (e) { console.warn('webrtc offer', e); } finally { p.makingOffer = false; }
    };
    // positions: unordered and never resent (a late one is useless)
    if (starter) wire(pc.createDataChannel('kart', { ordered: false, maxRetransmits: 0 }));
    else pc.ondatachannel = (e) => wire(e.channel);
    this._micOn(p);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed') console.warn('webrtc: no direct link to', id, '(positions go through the server)');
    };
    return p;
  }

  async _signal({ from, desc, cand }) {
    // (the first offer can beat the sender's presence here: answer it anyway)
    let p = this.peers.get(from);
    try {
      if (desc) {
        if (!p) { if (desc.type !== 'offer') return; p = this._peer(from, false); }
        const pc = p.pc;
        const collision = desc.type === 'offer' && (p.makingOffer || pc.signalingState !== 'stable');
        p.ignoreOffer = !p.polite && collision;
        if (p.ignoreOffer) return;
        if (collision) await pc.setLocalDescription({ type: 'rollback' });
        await pc.setRemoteDescription(desc);
        for (const c of p.queued || []) await pc.addIceCandidate(c).catch(() => {});
        p.queued = null;
        if (desc.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          p.sig({ desc: pc.localDescription.toJSON() });
        }
        this._heardCheck(from, p);
      } else if (cand && p) {
        if (!p.pc.remoteDescription) (p.queued ||= []).push(cand);
        else await p.pc.addIceCandidate(cand).catch((e) => { if (!p.ignoreOffer) throw e; });
      }
    } catch (e) { console.warn('webrtc signal', e); }
  }

  // Safari doesn't always say when a voice starts arriving on a channel that
  // was only sending before (the other player turned their mic on later): look
  _heardCheck(id, p) {
    for (const t of p.pc.getTransceivers()) {
      const tr = t.receiver.track;
      if (tr?.kind === 'audio' && /recv/.test(t.currentDirection || '') && !p.heard.has(tr.id)) {
        p.heard.add(tr.id);
        this.emit('track', id, new MediaStream([tr]));
      }
    }
  }

  _drop(id) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    try { p.dc?.close(); p.pc.close(); } catch { /* already closed */ }
  }
}
