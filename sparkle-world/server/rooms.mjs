// Room logic shared by the Railway relay (server/server.mjs) and the test hub
// (tools/net/hub.mjs), so the tests exercise exactly what runs in production.
//
// Semantics (the ones the game relies on; docs/MULTIPLAYER.md §1, §4.4, Addendum A):
// - presence: per peer one object; patches merge (top-level null deletes, latest wins); the
//   whole room is handed to a newcomer; a peer's presence is cleared when it leaves;
// - broadcast: delivered to every attached peer, the sender included, stamped with a Sender
//   {peer, by, isMe, sameTab, kind:'viewer', guest} computed per receiver;
// - roster: joined / left / updated, as frames.
// - reconnect: a peer that loses its connection stays in the room for `graceMs`; if the same
//   peer attaches again it gets the whole roster (reset) and nobody sees it leave.
// - join order: every roster entry carries `at`, a number the room gives each member when it
//   joins (earlier joiners have smaller numbers). A page with a device stamp (`by`) gets the
//   number of her device's FIRST join in this room, so a reloaded page keeps its place (the
//   room remembers up to 64 devices while it lives). Clients cannot choose it; guests use it
//   to pick the room's real host (docs/MULTIPLAYER.md Addendum B).
// - gate (the Railway relay only; claude.ai rooms have no such thing): a member that the
//   room's host has not let in sees only the public presence keys of the others (GATE_PUBLIC:
//   enough to find the host and hear yes / no) and gets no broadcasts at all; a gated
//   member's broadcasts reach nobody. The room's host is the member with the smallest `at`
//   whose presence says r:'h', together with every member stamped with the same `by` (her own
//   reloaded page); the let-in members are the peers in those members' presence `adm`. The
//   room remembers the host's device (`by`): while none of its pages is here as host (a
//   reload), nobody else becomes the host for `hostHoldMs` (90 s, longer than friends wait
//   for her), so a pretend host who came in between never gets her friends.
//   gameOf(name) gives that same answer (with or without the gate) to the walkie-talkie relay
//   (server/voice.mjs), so voice reaches exactly the members the gate lets see the game.
// Nothing here stores anything beyond the live room, and nothing is logged.
//
// Frames out:  {t:'p', self?, reset?, j?:[entry], l?:[peer], u?:[[peer, patch]]}
//              {t:'b', topic, data, from:{peer, by, isMe, sameTab, kind, guest}}
//              entry = {peer, by, isMe, sameTab, kind, guest, at, state}
// Frames in:   {t:'s', patch, replace?}  {t:'b', topic, data}

export const ROOM_NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
export const TOPIC_RE = /^[a-z][a-z0-9_.-]{0,47}$/;
export const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);
/** Control and invisible format characters: the platform refuses them in presence strings. */
export const INVISIBLE_RE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;

/** Presence keys a gated member still sees of the others (finding the host, yes / no). */
export const GATE_PUBLIC = Object.freeze(['v', 'pv', 'r', 'ep', 'hs', 'end', 'adm', 'no', 'kn']);
const PUBLIC = new Set(GATE_PUBLIC);

/** Devices a room remembers the first join of (for `at`); later ones use their own join. */
const SEEN_MAX = 64;
/** How long a room keeps its host's place while none of her device's pages is here as host. */
export const HOST_HOLD_MS = 90000;

/** Deepest nesting a broadcast may have (the game's messages use at most 7). */
export const MAX_DATA_DEPTH = 16;

const enc = new TextEncoder();
/** UTF-8 bytes of a value's JSON text; -1 when it cannot be measured (too deep to stringify). */
export function jsonSize(v) {
  let t;
  try {
    t = JSON.stringify(v);
  } catch {
    return -1;
  }
  return t === undefined ? 0 : enc.encode(t).length;
}

/**
 * Is `v` nested deeper than `max` levels ({} or [] is 1)? Iterative with an early exit, so a
 * frame of 8,000 nested arrays costs nothing and never reaches JSON.stringify's recursion.
 */
export function tooDeep(v, max = MAX_DATA_DEPTH) {
  if (v === null || typeof v !== 'object') return false;
  const stack = [[v, 1]];
  let seen = 0;
  while (stack.length) {
    const [o, d] = stack.pop();
    if (d > max) return true;
    if (++seen > 100000) return true; // absurdly wide: refuse rather than walk it
    if (Array.isArray(o)) {
      for (let k = 0; k < o.length; k++) {
        const c = o[k];
        if (c !== null && typeof c === 'object') stack.push([c, d + 1]);
      }
    } else {
      for (const k in o) {
        const c = o[k];
        if (c !== null && typeof c === 'object') stack.push([c, d + 1]);
      }
    }
  }
  return false;
}

function utf8Len(s) {
  let n = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) {
      n += 4;
      k++;
    } else n += 3;
  }
  return n;
}

/**
 * Check one presence value: identifier keys at every level, strings <= strBytes and free of
 * control / invisible characters, nesting
 * <= maxDepth, JSON-only values. Returns null when fine, else a short reason.
 */
export function checkPresenceValue(v, strBytes, maxDepth, depth = 0) {
  if (v === null || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? null : 'number';
  if (typeof v === 'string') return utf8Len(v) > strBytes ? 'string' : INVISIBLE_RE.test(v) ? 'chars' : null;
  if (typeof v !== 'object') return 'type';
  if (depth >= maxDepth) return 'depth';
  if (Array.isArray(v)) {
    for (let k = 0; k < v.length; k++) {
      const r = checkPresenceValue(v[k], strBytes, maxDepth, depth + 1);
      if (r) return r;
    }
    return null;
  }
  for (const k in v) {
    if (!IDENT_RE.test(k) || BAD_KEYS.has(k)) return 'key';
    const r = checkPresenceValue(v[k], strBytes, maxDepth, depth + 1);
    if (r) return r;
  }
  return null;
}

class Member {
  constructor(peer, sink, meta, now, order, rank) {
    this.peer = peer;
    this.sink = sink;
    this.by = meta.by ?? null;
    this.kind = meta.kind || 'viewer';
    this.guest = !!meta.guest;
    this.state = {};
    this.detachedAt = sink ? 0 : now;
    this.joinedAt = now;
    this.order = order;
    this.rank = rank ?? order; // `at`: her device's first join in the room (or her own)
  }
}

class Room {
  constructor(name, now, owner) {
    this.name = name;
    this.members = new Map();
    this.lastActive = now;
    this.owner = owner ?? null; // who made the room (the server passes the client's IP)
    this.seen = new Map(); // device stamp (by) -> the join number of its first page here
    this.hostBy = null; // the host's device (gate): only its pages can be the host...
    this.hostAwayAt = 0; // ...and since when none of them is here as host (0 = she is)
  }
}

export class RoomRegistry {
  /**
   * @param {object} o
   * @param {number} [o.maxRooms=500]
   * @param {number} [o.maxPeers=4]    per room
   * @param {number} [o.msgBytes=3900] broadcast data JSON
   * @param {number} [o.stateBytes=4096] merged presence JSON per peer
   * @param {number} [o.strBytes=1024] any string in presence
   * @param {number} [o.maxDepth=8]
   * @param {number} [o.graceMs=5000]  reconnect grace
   * @param {number} [o.idleMs=600000] a room with no traffic this long is closed
   * @param {number} [o.roomsPerOwner=Infinity] live rooms one owner (meta.owner) may have made
   * @param {boolean} [o.gate=false] hide presence and broadcasts from members not let in
   * @param {number} [o.hostHoldMs=90000] keep the host device's place while she reloads
   * @param {() => number} [o.now]
   */
  constructor(o = {}) {
    this.maxRooms = o.maxRooms ?? 500;
    this.maxPeers = o.maxPeers ?? 4;
    this.msgBytes = o.msgBytes ?? 3900;
    this.stateBytes = o.stateBytes ?? 4096;
    this.strBytes = o.strBytes ?? 1024;
    this.maxDepth = o.maxDepth ?? 8;
    this.graceMs = o.graceMs ?? 5000;
    this.idleMs = o.idleMs ?? 600000;
    this.roomsPerOwner = o.roomsPerOwner ?? Infinity;
    this.gate = !!o.gate;
    this.hostHoldMs = o.hostHoldMs ?? HOST_HOLD_MS;
    this.now = o.now ?? (() => Date.now());
    this.rooms = new Map();
    this.owned = new Map(); // owner -> live rooms it made
    this.joinSeq = 0;
    this.counts = { joins: 0, leaves: 0, broadcasts: 0, states: 0, rejected: 0, gated: 0 };
  }

  get roomCount() {
    return this.rooms.size;
  }

  peerCount() {
    let n = 0;
    for (const r of this.rooms.values()) n += r.members.size;
    return n;
  }

  has(name, peer) {
    return !!this.rooms.get(name)?.members.has(peer);
  }

  /**
   * Put `peer` in room `name` with a delivery function sink(frame). A peer already in the
   * room (a reconnect) swaps its sink and gets the whole roster again.
   * meta: { by, kind, guest, owner } (owner: who is asking, for the rooms-per-owner cap).
   * @returns {{ok:true, resumed:boolean} | {ok:false, code:'bad_name'|'full'|'rooms_full'|'limit'}}
   */
  join(name, peer, sink, meta = {}) {
    if (typeof name !== 'string' || !ROOM_NAME_RE.test(name)) return { ok: false, code: 'bad_name' };
    const now = this.now();
    let room = this.rooms.get(name);
    const existing = room?.members.get(peer);
    if (existing) {
      existing.sink = sink;
      existing.detachedAt = 0;
      room.lastActive = now;
      this._deliver(existing, { t: 'p', self: peer, reset: true, j: this._entries(room, existing) });
      return { ok: true, resumed: true };
    }
    if (!room) {
      if (this.rooms.size >= this.maxRooms) return { ok: false, code: 'rooms_full' };
      const owner = meta.owner ?? null;
      if (owner !== null && (this.owned.get(owner) || 0) >= this.roomsPerOwner) return { ok: false, code: 'limit' };
      room = this._newRoom(name, now, owner);
    }
    if (room.members.size >= this.maxPeers) {
      // a peer that lost its connection (in its reconnect grace) does not block a newcomer:
      // the longest-gone one leaves now (if it comes back it simply joins again)
      let gone = null;
      for (const m of room.members.values()) if (m.sink === null && (!gone || m.detachedAt < gone.detachedAt)) gone = m;
      if (!gone) return { ok: false, code: 'full' };
      this.leave(name, gone.peer);
      room = this.rooms.get(name);
      if (!room) room = this._newRoom(name, now, meta.owner ?? null);
    }
    const before = this._openSet(room);
    const order = ++this.joinSeq;
    const by = meta.by ?? null;
    if (by !== null && !room.seen.has(by) && room.seen.size < SEEN_MAX) room.seen.set(by, order);
    const m = new Member(peer, sink, meta, now, order, by !== null && room.seen.has(by) ? room.seen.get(by) : order);
    room.members.set(peer, m);
    room.lastActive = now;
    this.counts.joins++;
    this._trackHost(room);
    const after = this._openSet(room);
    this._deliver(m, { t: 'p', self: peer, reset: true, j: this._entries(room, m) });
    for (const o of room.members.values()) {
      if (o === m) continue;
      if (this._flipped(o, before, after)) this._refresh(room, o);
      else this._deliver(o, { t: 'p', j: [this._entry(m, o, after)] });
    }
    return { ok: true, resumed: false };
  }

  _newRoom(name, now, owner) {
    const room = new Room(name, now, owner);
    this.rooms.set(name, room);
    if (owner !== null) this.owned.set(owner, (this.owned.get(owner) || 0) + 1);
    return room;
  }

  _dropRoom(room) {
    if (this.rooms.get(room.name) !== room) return;
    this.rooms.delete(room.name);
    if (room.owner !== null) {
      const n = (this.owned.get(room.owner) || 1) - 1;
      if (n <= 0) this.owned.delete(room.owner);
      else this.owned.set(room.owner, n);
    }
  }

  /** The connection is gone but the peer may come back within graceMs. */
  detach(name, peer) {
    const m = this.rooms.get(name)?.members.get(peer);
    if (!m) return;
    m.sink = null;
    m.detachedAt = this.now();
  }

  /** The peer left: clear its presence and tell the others. */
  leave(name, peer) {
    const room = this.rooms.get(name);
    if (!room || !room.members.has(peer)) return;
    const before = this._openSet(room);
    room.members.delete(peer);
    this.counts.leaves++;
    this._trackHost(room);
    const after = this._openSet(room);
    for (const o of room.members.values()) {
      this._deliver(o, { t: 'p', l: [peer] });
      if (this._flipped(o, before, after)) this._refresh(room, o);
    }
    if (room.members.size === 0) this._dropRoom(room);
  }

  /**
   * Handle one client frame from `peer`. Returns null when accepted, else {code, msg}.
   */
  handle(name, peer, frame) {
    const room = this.rooms.get(name);
    const m = room?.members.get(peer);
    if (!m) return { code: 'not_joined' };
    if (!frame || typeof frame !== 'object') return this._reject('bad_frame');
    const now = this.now();
    if (frame.t === 's') {
      const patch = frame.patch;
      if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return this._reject('bad_frame');
      const next = frame.replace ? {} : { ...m.state };
      for (const k in patch) {
        if (!IDENT_RE.test(k) || BAD_KEYS.has(k)) return this._reject('bad_state', 'key');
        if (patch[k] === null || patch[k] === undefined) delete next[k];
        else next[k] = patch[k];
      }
      const why = checkPresenceValue(next, this.strBytes, this.maxDepth);
      if (why) return this._reject('bad_state', why);
      const size = jsonSize(next);
      if (size < 0 || size > this.stateBytes) return this._reject('too_big', `presence ${size} B`);
      // what actually changed, for the others
      let out = null;
      if (frame.replace) {
        for (const k in m.state) if (!(k in next)) (out ||= {})[k] = null;
        for (const k in next) if (JSON.stringify(next[k]) !== JSON.stringify(m.state[k])) (out ||= {})[k] = next[k];
      } else {
        for (const k in patch) (out ||= {})[k] = patch[k] === undefined ? null : patch[k];
      }
      const before = this.gate ? this._openSet(room) : null;
      m.state = next;
      room.lastActive = now;
      this.counts.states++;
      this._trackHost(room);
      const after = this.gate ? this._openSet(room) : null;
      for (const o of room.members.values()) {
        if (o === m) {
          if (this._flipped(o, before, after)) this._refresh(room, o); // she became the host
          continue;
        }
        if (this._flipped(o, before, after)) {
          this._refresh(room, o);
          continue;
        }
        const seen = out && this._visible(o, after) ? out : out && publicPart(out);
        if (seen) this._deliver(o, { t: 'p', u: [[peer, seen]] });
      }
      return null;
    }
    if (frame.t === 'b') {
      if (typeof frame.topic !== 'string' || !TOPIC_RE.test(frame.topic)) return this._reject('bad_topic');
      // depth first: JSON.stringify of 8,000 nested arrays would throw (and take the relay down)
      if (tooDeep(frame.data)) return this._reject('bad_frame', 'too deep');
      const size = jsonSize(frame.data);
      if (size < 0) return this._reject('bad_frame', 'unmeasurable');
      if (size > this.msgBytes) return this._reject('too_big', `message ${size} B`);
      room.lastActive = now;
      this.counts.broadcasts++;
      const open = this.gate ? this._openSet(room) : null;
      const fromOpen = this._visible(m, open);
      for (const o of room.members.values()) {
        // a gated member hears nothing but her own echo, and nobody hears her
        if (o !== m && (!fromOpen || !this._visible(o, open))) {
          this.counts.gated++;
          continue;
        }
        this._deliver(o, { t: 'b', topic: frame.topic, data: frame.data, from: this._sender(m, o) });
      }
      return null;
    }
    return this._reject('bad_frame');
  }

  /**
   * Drop peers whose grace ran out and rooms idle for idleMs.
   * @returns {Array<{name, peer, reason}>} peers the caller should disconnect
   */
  sweep() {
    const now = this.now();
    const out = [];
    for (const room of Array.from(this.rooms.values())) {
      if (now - room.lastActive > this.idleMs) {
        for (const m of room.members.values()) out.push({ name: room.name, peer: m.peer, reason: 'idle' });
        this._dropRoom(room);
        continue;
      }
      for (const m of Array.from(room.members.values())) {
        if (m.sink === null && m.detachedAt && now - m.detachedAt > this.graceMs) this.leave(room.name, m.peer);
      }
      // the host's device has been away too long: the room is free for a new host
      if (this.rooms.get(room.name) === room && room.hostBy !== null && room.hostAwayAt && now - room.hostAwayAt > this.hostHoldMs) {
        const before = this._openSet(room);
        room.hostBy = null;
        room.hostAwayAt = 0;
        this._trackHost(room);
        const after = this._openSet(room);
        for (const o of room.members.values()) if (this._flipped(o, before, after)) this._refresh(room, o);
      }
    }
    return out;
  }

  // ---------- internals ----------

  _reject(code, msg) {
    this.counts.rejected++;
    return { code, msg };
  }

  _sender(from, to) {
    const sameTab = from === to;
    return {
      peer: from.peer,
      by: from.by,
      isMe: sameTab || (from.by !== null && from.by === to.by),
      sameTab,
      kind: from.kind,
      guest: from.guest,
    };
  }

  _entry(m, to, open) {
    const s = this._sender(m, to);
    s.at = m.rank;
    s.state = m === to || this._visible(to, open) ? m.state : publicPart(m.state) || {};
    return s;
  }

  _entries(room, to) {
    const open = this._openSet(room);
    const list = [];
    for (const m of room.members.values()) list.push(this._entry(m, to, open));
    return list;
  }

  // ---------- the gate (Railway relay) ----------

  /**
   * Who plays the game in room `name`, by the gate's rule (computed whether or not this
   * registry gates; the walkie-talkie relay asks it for every voice frame):
   *   host: the member with the smallest `at` (then join) whose presence says r:'h' (null:
   *     nobody hosts here),
   *   side: the host and every member with her `by` that also says r:'h' (her reloaded page),
   *   open: the side's peers plus the peers listed in the side's presence `adm`.
   * Nothing is kept: it is read from the live room each time.
   * @returns {{host: object|null, side: object[], open: Set<string>}}
   */
  gameOf(name) {
    const room = this.rooms.get(name);
    return room ? this._game(room) : { host: null, side: [], open: new Set() };
  }

  _game(room) {
    const host = this._bestHost(room);
    const side = [];
    const open = new Set();
    if (!host) return { host, side, open };
    for (const m of room.members.values()) {
      if (m !== host && !(host.by !== null && m.by === host.by && m.state.r === 'h')) continue;
      side.push(m);
      open.add(m.peer);
      const adm = m.state.adm;
      if (Array.isArray(adm)) for (const a of adm) if (Array.isArray(a) && typeof a[0] === 'string') open.add(a[0]);
    }
    return { host, side, open };
  }

  /**
   * The room's host: the r:'h' member with the smallest `at` (then join). While the room holds
   * its host device's place (room.hostBy), only that device's pages, or a device that was here
   * before hers, can be the host.
   */
  _bestHost(room) {
    const hold = room.hostBy !== null ? room.seen.get(room.hostBy) ?? Infinity : Infinity;
    let host = null;
    for (const m of room.members.values()) {
      if (m.state.r !== 'h') continue;
      if (room.hostBy !== null && m.by !== room.hostBy && !(m.rank < hold)) continue;
      if (!host || m.rank < host.rank || (m.rank === host.rank && m.order < host.order)) host = m;
    }
    return host;
  }

  /**
   * After every change: remember the host's device, and since when none of its pages is here
   * as host (sweep() lets the room go after hostHoldMs). A page without a stamp (by:null)
   * never holds a room.
   */
  _trackHost(room) {
    const h = this._bestHost(room);
    if (h) {
      room.hostBy = h.by;
      room.hostAwayAt = 0;
    } else if (room.hostBy !== null && !room.hostAwayAt) room.hostAwayAt = this.now();
  }

  /** The members that see everything (null when the room has no gate): gameOf's `open`. */
  _openSet(room) {
    if (!this.gate || !room) return null;
    return this._game(room).open;
  }

  _visible(m, open) {
    return open === null || open === undefined || open.has(m.peer);
  }

  _flipped(m, before, after) {
    if (!this.gate || !before || !after) return false;
    return before.has(m.peer) !== after.has(m.peer);
  }

  /** Her view of the others changed (let in, or not any more): everyone's state again. */
  _refresh(room, to) {
    const open = this._openSet(room);
    const j = [];
    for (const m of room.members.values()) if (m !== to) j.push(this._entry(m, to, open));
    if (j.length) this._deliver(to, { t: 'p', j });
  }

  _deliver(m, frame) {
    if (m.sink === null) return;
    try {
      m.sink(frame);
    } catch {
      // a broken sink is the connection layer's problem
    }
  }
}

/** The GATE_PUBLIC keys of a presence object or patch (null when none are there). */
function publicPart(state) {
  let out = null;
  if (!state) return null;
  for (const k in state) if (PUBLIC.has(k)) (out ||= {})[k] = state[k];
  return out;
}
