// NetTransport: everything multiplayer needs from the network (docs/MULTIPLAYER.md §4).
// This file holds the contract, NetError, TokenBucket, jsonBytes(), the shared send pacer and
// presence box, FrameTransport (the base of LoopTransport and WsTransport, which speak the
// same JSON frames as server/rooms.mjs), and createTransport() / detectTransportKind().

import { LIMITS, TOPICS, C, isRoomName } from './protocol.js';
import { utf8Length } from './codec.js';

export class NetError extends Error {
  /** code: unavailable | no_rooms | cannot_host | busy | full | transient | lost | fatal | too_big | invalid */
  constructor(code, message) {
    super(message || code);
    this.name = 'NetError';
    this.code = code;
  }
}

/** The real clock. Tests pass a SimClock with the same three methods. */
export const realClock = Object.freeze({
  now: () => Date.now(),
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
});

/** UTF-8 bytes of a value's JSON text. */
export function jsonBytes(v) {
  const t = JSON.stringify(v);
  return t === undefined ? 0 : utf8Length(t);
}

/** Token bucket: `rate` tokens per second, at most `burst` stored. */
export class TokenBucket {
  constructor(rate, burst, now = 0) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.at = now;
  }

  refill(now) {
    if (now > this.at) {
      this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) * this.rate) / 1000);
      this.at = now;
    }
  }

  /** Take n tokens if available. */
  take(now, n = 1) {
    this.refill(now);
    if (this.tokens >= n) {
      this.tokens -= n;
      return true;
    }
    return false;
  }

  /** ms until n tokens are available (0 = now). */
  msUntil(now, n = 1) {
    this.refill(now);
    return this.tokens >= n ? 0 : Math.ceil(((n - this.tokens) * 1000) / this.rate);
  }
}

/**
 * NetTransport: the contract every implementation keeps (RoomTransport, LoopTransport,
 * WsTransport). send() may drop, duplicate or reorder; setState() is reliable latest-value
 * (re-sent after reconnects, handed to newcomers, cleared on leave).
 *
 *   get kind()            'room' | 'loop' | 'ws'
 *   get limits()          { msgBytes: 3900, stateBytes: 3900, strBytes: 1000, rate: 30, burst: 60 }
 *   async identity()      -> { uid: string|null, canHost: true|false|null }   (null = try it)
 *   async open(roomName)  join; resolves { self: peerId }; rejects NetError (§4.3)
 *   async close()         leave; idempotent
 *   selfId()              my peer id (null before open)
 *   connected()           debounced: false only after a true->false edge lasting 2 s
 *   onStatus(fn)          fn({ connected, fatal?: 'revoked'|'not_granted'|'ended' }) -> off
 *   setState(patch)       merge into MY state (top-level null deletes). Coalesced to <= 10 Hz.
 *                         Throws NetError('too_big') synchronously if the merged object would
 *                         exceed limits.stateBytes, and applies nothing.
 *   flushState()          send the merged state within 30 ms (outbox/ack changes)
 *   peers()               [{ id, uid, guest, self, state, updatedAt }] frozen; viewers only
 *   onPeers(fn)           fn({ peers, joined, left, updated }) -> off
 *   send(topic, data, prio)  topic 'op'|'bulk'|'ctl'; prio 0 (ctl) .. 3 (snapshot);
 *                         -> 'sent' | 'queued' | 'dropped'  (never throws; never retried)
 *   on(topic, fn)         fn(data, fromPeerId) -> off; my own echoes are filtered out
 *   async probeSend()     host precondition: may I send on the topics? -> boolean
 *
 * Extras every implementation also offers: myState() (my merged state), stats().
 */
export class NetTransport {
  get kind() { return 'none'; }
  get limits() { return LIMITS; }
  async identity() { return { uid: null, canHost: null }; }
  async open() { throw new NetError('unavailable'); }
  async close() {}
  selfId() { return null; }
  connected() { return false; }
  onStatus() { return () => {}; }
  setState() {}
  flushState() {}
  peers() { return []; }
  onPeers() { return () => {}; }
  send() { return 'dropped'; }
  on() { return () => {}; }
  async probeSend() { return false; }
  myState() { return {}; }
  stats() { return {}; }
}

// ---------- presence box: merged state + diff since the last send ----------

export class StateBox {
  constructor(limitBytes) {
    this.limit = limitBytes;
    this.state = Object.freeze({});
    this.sentText = new Map(); // key -> JSON text last sent
    this.touched = new Set();
    this.replaceNext = true; // first send (and after a reconnect) replaces the whole object
  }

  /** Merge (top-level null/undefined deletes). Throws NetError('too_big') and applies nothing. */
  merge(patch) {
    let next = null;
    for (const k in patch) {
      const v = patch[k];
      const has = Object.prototype.hasOwnProperty.call(this.state, k);
      if (v === null || v === undefined) {
        if (!has) continue;
      } else if (has && this.state[k] === v) continue;
      if (next === null) next = { ...this.state };
      if (v === null || v === undefined) delete next[k];
      else next[k] = v;
      this.touched.add(k);
    }
    if (next === null) return false;
    const bytes = jsonBytes(next);
    if (bytes > this.limit) {
      for (const k in patch) if (!Object.prototype.hasOwnProperty.call(next, k) || next[k] !== this.state[k]) this.touched.delete(k);
      throw new NetError('too_big', `presence would be ${bytes} B (limit ${this.limit})`);
    }
    this.state = Object.freeze(next);
    this.bytes = bytes;
    return true;
  }

  /** The patch to send now (null = nothing changed); marks it sent. */
  takePatch() {
    if (this.replaceNext) {
      this.replaceNext = false;
      this.touched.clear();
      this.sentText.clear();
      for (const k in this.state) this.sentText.set(k, JSON.stringify(this.state[k]));
      return { patch: { ...this.state }, replace: true };
    }
    if (this.touched.size === 0) return null;
    let patch = null;
    for (const k of this.touched) {
      const has = Object.prototype.hasOwnProperty.call(this.state, k);
      if (!has) {
        if (this.sentText.has(k)) {
          (patch ||= {})[k] = null;
          this.sentText.delete(k);
        }
        continue;
      }
      const text = JSON.stringify(this.state[k]);
      if (this.sentText.get(k) !== text) {
        (patch ||= {})[k] = this.state[k];
        this.sentText.set(k, text);
      }
    }
    this.touched.clear();
    return patch ? { patch, replace: false } : null;
  }

  get pending() {
    return this.replaceNext || this.touched.size > 0;
  }
}

// ---------- pacer: one token bucket per page, priority queue, presence coalescing ----------

/**
 * Shared by every transport. Presence flushes go first, then ctl > op > bulk fix > bulk
 * snapshot. Queue items older than 2 s are dropped (a dropped op batch is repaired by a fix).
 */
export class Pacer {
  constructor({ clock, rate, burst, maxAgeMs = C.QUEUE_MAX_AGE, emit, sendState, isUp }) {
    this.clock = clock;
    this.bucket = new TokenBucket(rate, burst, clock.now());
    this.maxAge = maxAgeMs;
    this.emit = emit; // (topic, data) -> void
    this.sendState = sendState; // () -> void (sends the StateBox patch, if any)
    this.isUp = isUp;
    this.queues = [[], [], [], []];
    this.queued = 0;
    this.stateDue = Infinity;
    this.lastStateAt = -Infinity;
    this.timer = null;
    this.timerAt = Infinity;
    this.counts = { sent: 0, queued: 0, dropped: 0, aged: 0, states: 0 };
  }

  send(topic, data, prio) {
    if (!this.isUp()) {
      this.counts.dropped++;
      return 'dropped';
    }
    const now = this.clock.now();
    const p = prio >= 0 && prio <= 3 ? prio | 0 : 1;
    if (this.queued === 0 && !(this.stateDue <= now) && this.bucket.take(now)) {
      this.emit(topic, data);
      this.counts.sent++;
      return 'sent';
    }
    this.queues[p].push({ topic, data, at: now });
    this.queued++;
    this.counts.queued++;
    this._schedule(now + this.bucket.msUntil(now));
    return 'queued';
  }

  /** Ask for a presence send: urgent = within 30 ms (and >= 33 ms after the last one). */
  requestState(urgent) {
    const now = this.clock.now();
    const due = urgent
      ? Math.max(now, Math.min(now + C.PRESENCE_FLUSH, this.lastStateAt + 33))
      : Math.max(now, this.lastStateAt + C.PRESENCE_MIN);
    if (due < this.stateDue) this.stateDue = due;
    this._schedule(this.stateDue);
  }

  /** Link went down: queued emits are dropped (they would be dropped anyway). */
  linkDown() {
    for (const q of this.queues) {
      this.counts.dropped += q.length;
      q.length = 0;
    }
    this.queued = 0;
  }

  /** Link came back: presence must go out again. */
  linkUp() {
    if (this.stateDue === Infinity) this.stateDue = this.clock.now();
    this._schedule(this.stateDue);
  }

  stop() {
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timer = null;
    this.timerAt = Infinity;
    this.linkDown();
    this.stateDue = Infinity;
  }

  _schedule(at) {
    if (at >= this.timerAt) return;
    if (this.timer !== null) this.clock.clearTimeout(this.timer);
    this.timerAt = at;
    const delay = Math.max(0, at - this.clock.now());
    this.timer = this.clock.setTimeout(() => {
      this.timer = null;
      this.timerAt = Infinity;
      this._pump();
    }, delay);
  }

  _pump() {
    const now = this.clock.now();
    const up = this.isUp();
    // drop aged items
    if (this.queued > 0) {
      for (const q of this.queues) {
        let k = 0;
        while (k < q.length && now - q[k].at > this.maxAge) k++;
        if (k > 0) {
          q.splice(0, k);
          this.queued -= k;
          this.counts.aged += k;
        }
      }
    }
    if (up && this.stateDue <= now) {
      if (this.bucket.take(now)) {
        this.stateDue = Infinity;
        this.lastStateAt = now;
        this.counts.states++;
        this.sendState();
      }
    }
    if (up && this.stateDue > now) {
      while (this.queued > 0 && this.bucket.take(now)) {
        const q = this.queues.find((x) => x.length > 0);
        const item = q.shift();
        this.queued--;
        this.emit(item.topic, item.data);
        this.counts.sent++;
      }
    }
    let next = Infinity;
    if (this.stateDue !== Infinity) next = up ? Math.max(this.stateDue, now + this.bucket.msUntil(now)) : Infinity;
    if (this.queued > 0 && up) next = Math.min(next, now + Math.max(1, this.bucket.msUntil(now)));
    if (next !== Infinity) this._schedule(next);
  }
}

// ---------- listener sets ----------

export function listenerSet() {
  const fns = new Set();
  return {
    add(fn) {
      const box = { fn };
      fns.add(box);
      return () => fns.delete(box);
    },
    emit(...args) {
      for (const box of Array.from(fns)) {
        try {
          box.fn(...args);
        } catch (err) {
          console.error('[net] listener failed', err);
        }
      }
    },
    clear() {
      fns.clear();
    },
    get size() {
      return fns.size;
    },
  };
}

const ROOM_TOPIC_TO_KEY = { [TOPICS.op]: 'op', [TOPICS.bulk]: 'bulk', [TOPICS.ctl]: 'ctl' };

// ---------- FrameTransport: shared by LoopTransport and WsTransport ----------

/**
 * Frames (server/rooms.mjs speaks the same):
 *   client -> room: {t:'s', patch, replace?}  {t:'b', topic, data}  {t:'k'} keepalive  {t:'bye'}
 *   room -> client: {t:'p', self?, reset?, j?:[{peer,by,kind,guest,isMe,sameTab,state}], l?:[peer], u?:[[peer,patch]]}
 *                   {t:'b', topic, data, from:{peer,by,isMe,sameTab,kind,guest}}   {t:'e', code, msg?}   {t:'k'}
 * Subclasses implement _linkOpen(roomName), _linkSend(frame) -> boolean and _linkClose(),
 * and call _onFrame(frame), _onLinkUp(), _onLinkDown(), _onFatal(code).
 */
export class FrameTransport extends NetTransport {
  constructor({ clock = realClock, limits = LIMITS } = {}) {
    super();
    this.clock = clock;
    this._limits = { ...LIMITS, ...limits };
    this._self = null;
    this._room = null;
    this._open = false;
    this._closed = false;
    this._rawUp = false;
    this._debUp = false;
    this._downTimer = null;
    this._peers = new Map(); // id -> frozen entry
    this._peersArr = Object.freeze([]);
    this._change = null; // pending onPeers delivery
    this._changeTimer = null;
    this._topics = { op: listenerSet(), bulk: listenerSet(), ctl: listenerSet() };
    this._peerFns = listenerSet();
    this._statusFns = listenerSet();
    this._box = new StateBox(this._limits.stateBytes);
    this._welcome = null;
    this._stats = { framesIn: 0, framesOut: 0, bigDropped: 0, errors: {} };
    this._warned = new Set();
    this._pacer = new Pacer({
      clock,
      rate: this._limits.rate,
      burst: this._limits.burst,
      isUp: () => this._rawUp && this._open,
      emit: (topic, data) => this._out({ t: 'b', topic: TOPICS[topic] || topic, data }),
      sendState: () => {
        const p = this._box.takePatch();
        if (p) this._out(p.replace ? { t: 's', patch: p.patch, replace: true } : { t: 's', patch: p.patch });
      },
    });
  }

  get limits() { return this._limits; }
  selfId() { return this._self; }
  connected() { return this._debUp; }
  myState() { return this._box.state; }
  onStatus(fn) { return this._statusFns.add(fn); }
  onPeers(fn) { return this._peerFns.add(fn); }
  peers() { return this._peersArr; }

  on(topic, fn) {
    const set = this._topics[topic];
    if (!set) throw new TypeError('unknown topic ' + topic);
    return set.add(fn);
  }

  async probeSend() {
    return true;
  }

  async open(roomName) {
    if (!isRoomName(roomName)) throw new NetError('invalid', 'bad room name');
    if (this._open || this._welcome) throw new NetError('invalid', 'already open');
    this._room = roomName;
    this._closed = false;
    const welcome = new Promise((resolve, reject) => {
      this._welcome = { resolve, reject };
    });
    const timer = this.clock.setTimeout(() => this._failOpen(new NetError('transient', 'no answer')), 10000);
    try {
      await this._linkOpen(roomName);
      await welcome;
    } catch (err) {
      this._welcome = null;
      this.clock.clearTimeout(timer);
      await this._teardown();
      throw err instanceof NetError ? err : new NetError('transient', String(err?.message || err));
    }
    this.clock.clearTimeout(timer);
    this._welcome = null;
    this._open = true;
    this._box.replaceNext = true;
    this._pacer.linkUp();
    return { self: this._self };
  }

  async close() {
    if (this._closed) return;
    this._closed = true;
    if (this._open && this._rawUp) {
      // best effort: say goodbye so the room clears us at once
      try {
        this._linkSend({ t: 'bye' });
      } catch {}
    }
    this._open = false;
    await this._teardown();
  }

  async _teardown() {
    this._pacer.stop();
    if (this._downTimer !== null) this.clock.clearTimeout(this._downTimer);
    if (this._changeTimer !== null) this.clock.clearTimeout(this._changeTimer);
    this._downTimer = this._changeTimer = null;
    this._rawUp = false;
    this._debUp = false;
    try {
      await this._linkClose();
    } catch {}
    this._peers.clear();
    this._peersArr = Object.freeze([]);
    this._change = null;
  }

  setState(patch) {
    if (this._box.merge(patch)) {
      this._refreshSelf();
      if (this._open) this._pacer.requestState(false);
    }
  }

  flushState() {
    if (this._open && this._box.pending) this._pacer.requestState(true);
  }

  send(topic, data, prio = 1) {
    if (!this._open || !this._rawUp) return 'dropped';
    if (!this._topics[topic]) return 'dropped';
    const bytes = jsonBytes(data);
    if (bytes > this._limits.msgBytes) {
      this._stats.bigDropped++;
      this._warnOnce('big:' + topic, `[net] ${topic} message of ${bytes} B dropped (limit ${this._limits.msgBytes})`);
      return 'dropped';
    }
    return this._pacer.send(topic, data, prio);
  }

  stats() {
    return { ...this._stats, pacer: { ...this._pacer.counts }, stateBytes: this._box.bytes || 0 };
  }

  // ---------- for subclasses ----------

  _out(frame) {
    if (!this._rawUp) return false;
    this._stats.framesOut++;
    return this._linkSend(frame);
  }

  _onLinkUp() {
    if (this._closed) return;
    this._rawUp = true;
    if (this._downTimer !== null) {
      this.clock.clearTimeout(this._downTimer);
      this._downTimer = null;
    }
    if (this._open) {
      this._box.replaceNext = true; // re-assert the whole presence after a reconnect
      this._pacer.linkUp();
    }
    if (!this._debUp && (this._open || this._welcome)) {
      this._debUp = true;
      this._statusFns.emit({ connected: true });
    }
  }

  _onLinkDown() {
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

  _onFatal(code, err) {
    if (this._welcome) {
      this._failOpen(err || new NetError(code === 'ended' ? 'lost' : code));
      return;
    }
    if (this._closed) return;
    this._open = false;
    this._closed = true;
    this._teardown();
    this._debUp = false;
    this._statusFns.emit({ connected: false, fatal: code });
  }

  _failOpen(err) {
    const w = this._welcome;
    if (!w) return;
    this._welcome = null;
    w.reject(err);
  }

  _warnOnce(key, text) {
    if (this._warned.has(key)) return;
    this._warned.add(key);
    console.warn(text);
  }

  _onFrame(f) {
    if (this._closed || !f || typeof f !== 'object') return;
    this._stats.framesIn++;
    if (f.t === 'b') return this._onBroadcast(f);
    if (f.t === 'p') return this._onRoster(f);
    if (f.t === 'e') {
      this._stats.errors[f.code] = (this._stats.errors[f.code] || 0) + 1;
      if (this._welcome) {
        const map = { full: 'full', rooms_full: 'busy', busy: 'busy', bad_name: 'invalid', origin: 'no_rooms', limit: 'busy' };
        if (map[f.code]) this._failOpen(new NetError(map[f.code], f.msg || f.code));
      }
    }
  }

  _onBroadcast(f) {
    const from = f.from;
    if (!from || from.kind !== 'viewer' || from.sameTab) return; // own echoes and agents are ignored
    const key = ROOM_TOPIC_TO_KEY[f.topic];
    if (!key) return;
    this._topics[key].emit(f.data, from.peer);
  }

  _entry(p, state, now) {
    const st = state && typeof state === 'object' ? (Object.isFrozen(state) ? state : Object.freeze({ ...state })) : Object.freeze({});
    return Object.freeze({
      id: p.peer,
      uid: p.by ?? (typeof st.uid === 'string' ? st.uid : null),
      by: p.by ?? null,
      guest: !!p.guest,
      self: !!p.sameTab,
      state: st,
      updatedAt: now,
    });
  }

  _refreshSelf() {
    if (!this._self) return;
    const me = this._peers.get(this._self);
    if (!me) return;
    const e = Object.freeze({ ...me, state: this._box.state, uid: me.by ?? (typeof this._box.state.uid === 'string' ? this._box.state.uid : null), updatedAt: this.clock.now() });
    this._peers.set(this._self, e);
    this._noteChange('updated', e);
  }

  _onRoster(f) {
    const now = this.clock.now();
    if (typeof f.self === 'string') this._self = f.self;
    if (f.reset) {
      const seen = new Set();
      for (const j of f.j || []) {
        if (!j || j.kind !== 'viewer' || typeof j.peer !== 'string') continue;
        seen.add(j.peer);
        const self = j.peer === this._self;
        const old = this._peers.get(j.peer);
        if (!old) {
          const e = this._entry(j, self ? this._box.state : j.state, now);
          this._peers.set(j.peer, e);
          this._noteChange('joined', e);
        } else if (!self && JSON.stringify(old.state) !== JSON.stringify(j.state || {})) {
          const e = this._entry(j, j.state, now);
          this._peers.set(j.peer, e);
          this._noteChange('updated', e);
        }
      }
      for (const [id, old] of this._peers) {
        if (!seen.has(id)) {
          this._peers.delete(id);
          this._noteChange('left', old);
        }
      }
      if (this._welcome && this._self && this._peers.has(this._self)) this._welcome.resolve();
      if (this._self) this._onLinkUp();
      return;
    }
    for (const j of f.j || []) {
      if (!j || j.kind !== 'viewer' || typeof j.peer !== 'string') continue;
      const self = j.peer === this._self;
      const e = this._entry(j, self ? this._box.state : j.state, now);
      const had = this._peers.has(j.peer);
      this._peers.set(j.peer, e);
      this._noteChange(had ? 'updated' : 'joined', e);
    }
    for (const id of f.l || []) {
      const old = this._peers.get(id);
      if (old && id !== this._self) {
        this._peers.delete(id);
        this._noteChange('left', old);
      }
    }
    for (const u of f.u || []) {
      if (!Array.isArray(u) || typeof u[0] !== 'string' || u[0] === this._self) continue;
      const old = this._peers.get(u[0]);
      if (!old) continue;
      const st = { ...old.state };
      const patch = u[1] || {};
      for (const k in patch) {
        if (k === '__proto__' || k === 'constructor' || k === 'prototype') continue;
        if (patch[k] === null) delete st[k];
        else st[k] = patch[k];
      }
      const e = this._entry({ peer: old.id, by: old.by, guest: old.guest, sameTab: false }, st, now);
      this._peers.set(old.id, e);
      this._noteChange('updated', e);
    }
  }

  _noteChange(kind, e) {
    let c = this._change;
    if (!c) {
      c = this._change = { joined: new Map(), left: new Map(), updated: new Map() };
    }
    const id = e.id;
    if (kind === 'joined') {
      if (c.left.has(id)) {
        c.left.delete(id);
        c.updated.set(id, e);
      } else c.joined.set(id, e);
    } else if (kind === 'left') {
      if (c.joined.has(id)) c.joined.delete(id);
      else {
        c.updated.delete(id);
        c.left.set(id, e);
      }
    } else if (c.joined.has(id)) c.joined.set(id, e);
    else c.updated.set(id, e);
    this._peersArr = Object.freeze(Array.from(this._peers.values()));
    if (this._changeTimer === null) {
      this._changeTimer = this.clock.setTimeout(() => {
        this._changeTimer = null;
        const ch = this._change;
        this._change = null;
        if (!ch || this._closed) return;
        if (ch.joined.size + ch.left.size + ch.updated.size === 0) return;
        this._peerFns.emit({
          peers: this._peersArr,
          joined: Object.freeze(Array.from(ch.joined.values())),
          left: Object.freeze(Array.from(ch.left.values())),
          updated: Object.freeze(Array.from(ch.updated.values())),
        });
      }, 0);
    }
  }

  // abstract
  async _linkOpen() { throw new NetError('unavailable'); }
  _linkSend() { return false; }
  async _linkClose() {}
}

// ---------- choosing a transport ----------

/**
 * Which transport this page should use: 'loop' (?net=loop), 'room' (inside claude.ai, when
 * claude.use('room') resolves), 'ws' (served over http(s) by server/server.mjs, which answers
 * GET /api/net), or null (multiplayer unavailable: the Friends buttons stay hidden).
 */
export async function detectTransportKind(env = globalThis) {
  const loc = env.location;
  try {
    if (loc && new URLSearchParams(loc.search || '').get('net') === 'loop' && typeof env.BroadcastChannel === 'function') return 'loop';
  } catch {}
  const claude = env.claude;
  if (claude && typeof claude.use === 'function') {
    try {
      const room = await claude.use('room');
      return room ? 'room' : null;
    } catch {
      return null;
    }
  }
  if (loc && (loc.protocol === 'http:' || loc.protocol === 'https:') && typeof env.fetch === 'function' && typeof env.WebSocket === 'function') {
    try {
      const ctl = typeof AbortController === 'function' ? new AbortController() : null;
      const timer = ctl ? setTimeout(() => ctl.abort(), 4000) : null;
      const res = await env.fetch('/api/net', { cache: 'no-store', signal: ctl?.signal });
      if (timer) clearTimeout(timer);
      if (res.ok) {
        const info = await res.json();
        if (info && info.ok === true) return 'ws';
      }
    } catch {}
  }
  return null;
}

/**
 * Create a transport of the given kind ('room' | 'loop' | 'ws'). Options go to the
 * constructor (clock, hub for Node tests, url for WsTransport outside a browser, ...).
 */
export async function createTransport(kind, opts = {}) {
  if (kind === 'room') {
    const { RoomTransport } = await import('./room-transport.js');
    return new RoomTransport(opts);
  }
  if (kind === 'loop') {
    const { LoopTransport } = await import('./loop-transport.js');
    return new LoopTransport(opts);
  }
  if (kind === 'ws') {
    const { WsTransport } = await import('./ws-transport.js');
    return new WsTransport(opts);
  }
  throw new NetError('unavailable', 'no transport ' + kind);
}
