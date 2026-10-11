// RoomTransport (docs/MULTIPLAYER.md §4.2, §4.3): NetTransport over claude.use('room') and
// claude.use('user') inside claude.ai. The only file (with storage.js) that touches
// window.claude for multiplayer.
//
// - open(name): room.join(name); topics sw.op / sw.bulk / sw.ctl, onPeers, onConnection.
// - send(): only while connected; JSON <= msgBytes; one token of the page's bucket
//   (30/s, burst 60, shared with presence) or queued by priority; queue items older than 2 s
//   are dropped. The platform drops emits while disconnected and past its own budget.
// - setState(): merged locally, size-checked (throws too_big), sent as a diff patch at <= 10 Hz
//   (30 ms after flushState()). The platform re-asserts presence after a reconnect.
// - peers(): nr.peers() mapped: peer -> id, by -> uid (null when the platform gives none; a
//   uid is never read from presence, which the peer writes itself), presence -> state,
//   isMe && sameTab -> self; agents are dropped.
// - A room that ends (listener error upstream_error / limit_reached) is re-joined after 1, 2,
//   4 and 8 s, then the session ends. Terminal codes end it at once.

import { LIMITS, TOPICS, C, isRoomName, cleanText } from './protocol.js';
import { NetTransport, NetError, StateBox, Pacer, listenerSet, jsonBytes, realClock } from './transport.js';

const TERMINAL = new Set(['revoked', 'not_granted', 'capability_disabled', 'capability_removed', 'transform_error']);
const REJOIN_WAITS = [1000, 2000, 4000, 8000];
const TOPIC_KEYS = ['op', 'bulk', 'ctl'];

function joinError(e) {
  const code = e?.code;
  if (code === 'not_permitted') return new NetError('no_rooms', e.message);
  if (code === 'limit_reached') return new NetError('busy', e.message);
  if (code === 'upstream_error') return new NetError('transient', e.message);
  if (code === 'invalid_argument') return new NetError('invalid', e.message);
  if (TERMINAL.has(code)) return new NetError('fatal', e.message);
  return new NetError('transient', String(e?.message || e));
}

export class RoomTransport extends NetTransport {
  /**
   * @param {object} [o]
   * @param {object} [o.claude]  the claude object (default: window.claude)
   * @param {object} [o.clock]
   */
  constructor(o = {}) {
    super();
    this.clock = o.clock || realClock;
    this._claude = o.claude || globalThis.claude;
    this._limits = LIMITS;
    this._roomNs = undefined;
    this._userNs = undefined;
    this._nr = null;
    this._name = null;
    this._self = null;
    this._closed = false;
    this._ending = false;
    this._offs = [];
    this._rawPeers = null;
    this._peersArr = Object.freeze([]);
    this._mapped = new WeakMap();
    this._topics = { op: listenerSet(), bulk: listenerSet(), ctl: listenerSet() };
    this._peerFns = listenerSet();
    this._statusFns = listenerSet();
    this._rawUp = false;
    this._debUp = false;
    this._downTimer = null;
    this._warned = new Set();
    this._stats = { emitErrors: {}, presenceErrors: {}, bigDropped: 0, rejoins: 0 };
    this._box = new StateBox(this._limits.stateBytes);
    this._pacer = new Pacer({
      clock: this.clock,
      rate: this._limits.rate,
      burst: this._limits.burst,
      isUp: () => !!this._nr && this._rawUp,
      emit: (topic, data) => this._emit(topic, data),
      sendState: () => this._sendPresence(),
    });
  }

  get kind() { return 'room'; }
  get limits() { return this._limits; }
  selfId() { return this._self; }
  connected() { return this._debUp; }
  myState() { return this._box.state; }
  onStatus(fn) { return this._statusFns.add(fn); }
  onPeers(fn) { return this._peerFns.add(fn); }

  on(topic, fn) {
    const set = this._topics[topic];
    if (!set) throw new TypeError('unknown topic ' + topic);
    return set.add(fn);
  }

  async _room() {
    if (this._roomNs === undefined) {
      try {
        this._roomNs = this._claude?.use ? await this._claude.use('room') : null;
      } catch {
        this._roomNs = null;
      }
    }
    return this._roomNs;
  }

  async _user() {
    if (this._userNs === undefined) {
      try {
        this._userNs = this._claude?.use ? await this._claude.use('user') : null;
      } catch {
        this._userNs = null;
      }
    }
    return this._userNs;
  }

  async identity() {
    const user = await this._user();
    if (!user) return { uid: null, canHost: null };
    const [uid, can] = await Promise.all([user.id().catch(() => null), user.can('data.write').catch(() => null)]);
    return { uid: typeof uid === 'string' ? uid : null, canHost: can === true ? true : can === false ? false : null };
  }

  /**
   * The platform account name of a viewer (user.profiles, scope 'profile'), for the small print
   * grown-ups read on the knock card and in the Players list. '' when unknown. Cached.
   */
  async accountName(uid) {
    if (typeof uid !== 'string' || !uid) return '';
    this._names ||= new Map();
    if (this._names.has(uid)) return this._names.get(uid);
    let name = '';
    try {
      const user = await this._user();
      if (user && typeof user.profiles === 'function') {
        const r = await user.profiles([uid]);
        const p = Array.isArray(r) ? r.find((x) => x && x.id === uid) : r && (r[uid] || (typeof r.get === 'function' ? r.get(uid) : null));
        if (p && typeof p.name === 'string') name = cleanText(p.name, 60);
      }
    } catch {
      name = '';
    }
    this._names.set(uid, name);
    return name;
  }

  async open(roomName) {
    if (!isRoomName(roomName)) throw new NetError('invalid', 'bad room name');
    const room = await this._room();
    if (!room) throw new NetError('unavailable');
    this._closed = false;
    this._ending = false;
    this._name = roomName;
    let nr;
    try {
      nr = await room.join(roomName);
    } catch (e) {
      throw joinError(e);
    }
    this._attach(nr);
    // the first onPeers delivery (a microtask later) lists us; wait for our own peer label
    const end = this.clock.now() + 5000;
    while (!this._self) {
      this._findSelf();
      if (this._self) break;
      if (this.clock.now() > end) {
        await this.close();
        throw new NetError('transient', 'no peer label');
      }
      await new Promise((r) => this.clock.setTimeout(r, 25));
    }
    return { self: this._self };
  }

  _attach(nr) {
    this._nr = nr;
    this._rawPeers = null;
    let ended = false;
    const onError = (e) => {
      if (ended || nr !== this._nr) return;
      ended = true;
      this._onRoomError(e?.code);
    };
    for (const key of TOPIC_KEYS) {
      this._offs.push(nr.on(TOPICS[key], (msg) => this._onMessage(key, msg), onError));
    }
    this._offs.push(nr.onPeers((change) => this._onPeersChange(change), onError));
    this._offs.push(nr.onConnection((c) => this._onConnection(c), onError));
    this._box.replaceNext = true;
    this._onConnection(nr.connected());
  }

  _detach() {
    for (const off of this._offs) {
      try {
        off();
      } catch {}
    }
    this._offs = [];
  }

  _findSelf() {
    if (!this._nr) return;
    for (const p of this._nr.peers()) {
      if (p.isMe && p.sameTab) {
        this._self = p.peer;
        return;
      }
    }
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
    this._pacer.stop();
    if (this._downTimer !== null) this.clock.clearTimeout(this._downTimer);
    this._downTimer = null;
    this._detach();
    const nr = this._nr;
    this._nr = null;
    this._rawUp = false;
    this._debUp = false;
    this._peersArr = Object.freeze([]);
    if (nr) {
      try {
        await nr.leave();
      } catch {}
    }
  }

  // ---------- presence ----------

  setState(patch) {
    if (this._box.merge(patch) && this._nr) this._pacer.requestState(false);
  }

  flushState() {
    if (this._nr && this._box.pending) this._pacer.requestState(true);
  }

  _sendPresence() {
    const nr = this._nr;
    if (!nr) return;
    const p = this._box.takePatch();
    if (!p) return;
    nr.presence(p.patch).catch((e) => this._countError('presenceErrors', e));
  }

  // ---------- emits ----------

  send(topic, data, prio = 1) {
    const nr = this._nr;
    if (!nr || !this._rawUp || !nr.connected()) return 'dropped';
    if (!this._topics[topic]) return 'dropped';
    const bytes = jsonBytes(data);
    if (bytes > this._limits.msgBytes) {
      this._stats.bigDropped++;
      this._warnOnce('big:' + topic, `[net] ${topic} message of ${bytes} B dropped (limit ${this._limits.msgBytes})`);
      return 'dropped';
    }
    return this._pacer.send(topic, data, prio);
  }

  _emit(topic, data) {
    const nr = this._nr;
    if (!nr) return;
    nr.emit(TOPICS[topic], data).catch((e) => this._countError('emitErrors', e));
  }

  _countError(bucket, e) {
    const code = e?.code || 'unknown';
    this._stats[bucket][code] = (this._stats[bucket][code] || 0) + 1;
    if (code === 'invalid_argument') this._warnOnce(bucket + code, `[net] room refused a message: ${e?.message || code}`);
  }

  async probeSend() {
    const end = this.clock.now() + 8000;
    while (!this._nr || !this._nr.connected()) {
      if (this._closed || this.clock.now() > end) return false;
      await new Promise((r) => this.clock.setTimeout(r, 50));
    }
    for (let k = 0; k < 2; k++) {
      try {
        await this._nr.emit(TOPICS.ctl, { k: 'hi' });
        return true;
      } catch (e) {
        if (e?.code === 'not_permitted' || TERMINAL.has(e?.code)) return false;
        if (e?.code === 'invalid_argument') return false;
      }
    }
    throw new NetError('transient', 'probe failed');
  }

  // ---------- receiving ----------

  _onMessage(key, msg) {
    if (!msg || msg.kind !== 'viewer' || (msg.isMe && msg.sameTab)) return;
    this._topics[key].emit(msg.data, msg.peer);
  }

  _map(p) {
    let m = this._mapped.get(p);
    if (!m) {
      const st = p.presence && typeof p.presence === 'object' ? p.presence : {};
      m = Object.freeze({
        id: p.peer,
        // the platform's stamp only: presence is written by the peer itself
        uid: typeof p.by === 'string' ? p.by : null,
        by: typeof p.by === 'string' ? p.by : null,
        at: null,
        guest: !!p.guest,
        self: !!(p.isMe && p.sameTab),
        state: st,
        updatedAt: p.updatedAt || this.clock.now(),
      });
      this._mapped.set(p, m);
    }
    return m;
  }

  peers() {
    const nr = this._nr;
    if (!nr) return this._peersArr;
    const raw = nr.peers();
    if (raw !== this._rawPeers) {
      this._rawPeers = raw;
      const out = [];
      for (const p of raw) if (p.kind === 'viewer') out.push(this._map(p));
      this._peersArr = Object.freeze(out);
      if (!this._self) this._findSelf();
    }
    return this._peersArr;
  }

  _onPeersChange(change) {
    const viewers = (list) => Object.freeze(list.filter((p) => p.kind === 'viewer').map((p) => this._map(p)));
    const peers = this.peers();
    this._peerFns.emit({ peers, joined: viewers(change.joined), left: viewers(change.left), updated: viewers(change.updated) });
  }

  _onConnection(c) {
    if (this._closed) return;
    if (c) {
      this._rawUp = true;
      if (this._downTimer !== null) {
        this.clock.clearTimeout(this._downTimer);
        this._downTimer = null;
      }
      this._pacer.linkUp();
      if (!this._debUp) {
        this._debUp = true;
        this._statusFns.emit({ connected: true });
      }
      return;
    }
    if (!this._rawUp) return;
    this._rawUp = false;
    this._pacer.linkDown();
    if (this._downTimer === null && this._debUp) {
      this._downTimer = this.clock.setTimeout(() => {
        this._downTimer = null;
        if (!this._rawUp && this._debUp) {
          this._debUp = false;
          this._statusFns.emit({ connected: false });
        }
      }, C.DISCONNECT_DEBOUNCE);
    }
  }

  _onRoomError(code) {
    if (this._closed || this._ending) return;
    if (TERMINAL.has(code)) return this._fatal(code === 'revoked' ? 'revoked' : code === 'not_granted' ? 'not_granted' : 'ended');
    if (code === 'not_permitted') return this._fatal('ended');
    // the room ended (upstream_error / limit_reached): join the same name again
    this._rejoin();
  }

  async _rejoin() {
    this._detach();
    this._nr = null;
    this._onConnection(false);
    const room = await this._room();
    for (const wait of REJOIN_WAITS) {
      await new Promise((r) => this.clock.setTimeout(r, wait));
      if (this._closed) return;
      try {
        const nr = await room.join(this._name);
        if (this._closed) {
          nr.leave().catch(() => {});
          return;
        }
        this._stats.rejoins++;
        this._attach(nr);
        return;
      } catch (e) {
        if (e?.code === 'not_permitted' || TERMINAL.has(e?.code)) break;
      }
    }
    this._fatal('ended');
  }

  _fatal(kind) {
    if (this._ending) return;
    this._ending = true;
    this.close().finally(() => this._statusFns.emit({ connected: false, fatal: kind }));
  }

  _warnOnce(key, text) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    console.warn(text);
  }

  stats() {
    return { ...this._stats, pacer: { ...this._pacer.counts }, stateBytes: this._box.bytes || 0 };
  }
}
