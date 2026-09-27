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
// Nothing here stores anything beyond the live room, and nothing is logged.
//
// Frames out:  {t:'p', self?, reset?, j?:[entry], l?:[peer], u?:[[peer, patch]]}
//              {t:'b', topic, data, from:{peer, by, isMe, sameTab, kind, guest}}
// Frames in:   {t:'s', patch, replace?}  {t:'b', topic, data}

export const ROOM_NAME_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
export const TOPIC_RE = /^[a-z][a-z0-9_.-]{0,47}$/;
export const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const BAD_KEYS = new Set(['__proto__', 'constructor', 'prototype']);

const enc = new TextEncoder();
export function jsonSize(v) {
  const t = JSON.stringify(v);
  return t === undefined ? 0 : enc.encode(t).length;
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
 * Check one presence value: identifier keys at every level, strings <= strBytes, nesting
 * <= maxDepth, JSON-only values. Returns null when fine, else a short reason.
 */
export function checkPresenceValue(v, strBytes, maxDepth, depth = 0) {
  if (v === null || typeof v === 'boolean') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? null : 'number';
  if (typeof v === 'string') return utf8Len(v) <= strBytes ? null : 'string';
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
  constructor(peer, sink, meta, now) {
    this.peer = peer;
    this.sink = sink;
    this.by = meta.by ?? null;
    this.kind = meta.kind || 'viewer';
    this.guest = !!meta.guest;
    this.state = {};
    this.detachedAt = sink ? 0 : now;
    this.joinedAt = now;
  }
}

class Room {
  constructor(name, now) {
    this.name = name;
    this.members = new Map();
    this.lastActive = now;
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
    this.now = o.now ?? (() => Date.now());
    this.rooms = new Map();
    this.counts = { joins: 0, leaves: 0, broadcasts: 0, states: 0, rejected: 0 };
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
   * @returns {{ok:true, resumed:boolean} | {ok:false, code:'bad_name'|'full'|'rooms_full'}}
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
      room = new Room(name, now);
      this.rooms.set(name, room);
    }
    if (room.members.size >= this.maxPeers) {
      if (room.members.size === 0) this.rooms.delete(name);
      return { ok: false, code: 'full' };
    }
    const m = new Member(peer, sink, meta, now);
    room.members.set(peer, m);
    room.lastActive = now;
    this.counts.joins++;
    this._deliver(m, { t: 'p', self: peer, reset: true, j: this._entries(room, m) });
    for (const o of room.members.values()) {
      if (o !== m) this._deliver(o, { t: 'p', j: [this._entry(m, o)] });
    }
    return { ok: true, resumed: false };
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
    room.members.delete(peer);
    this.counts.leaves++;
    for (const o of room.members.values()) this._deliver(o, { t: 'p', l: [peer] });
    if (room.members.size === 0) this.rooms.delete(name);
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
      if (size > this.stateBytes) return this._reject('too_big', `presence ${size} B`);
      // what actually changed, for the others
      let out = null;
      if (frame.replace) {
        for (const k in m.state) if (!(k in next)) (out ||= {})[k] = null;
        for (const k in next) if (JSON.stringify(next[k]) !== JSON.stringify(m.state[k])) (out ||= {})[k] = next[k];
      } else {
        for (const k in patch) (out ||= {})[k] = patch[k] === undefined ? null : patch[k];
      }
      m.state = next;
      room.lastActive = now;
      this.counts.states++;
      if (out) {
        for (const o of room.members.values()) if (o !== m) this._deliver(o, { t: 'p', u: [[peer, out]] });
      }
      return null;
    }
    if (frame.t === 'b') {
      if (typeof frame.topic !== 'string' || !TOPIC_RE.test(frame.topic)) return this._reject('bad_topic');
      const size = jsonSize(frame.data);
      if (size > this.msgBytes) return this._reject('too_big', `message ${size} B`);
      room.lastActive = now;
      this.counts.broadcasts++;
      for (const o of room.members.values()) {
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
        this.rooms.delete(room.name);
        continue;
      }
      for (const m of Array.from(room.members.values())) {
        if (m.sink === null && m.detachedAt && now - m.detachedAt > this.graceMs) this.leave(room.name, m.peer);
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

  _entry(m, to) {
    const s = this._sender(m, to);
    s.state = m.state;
    return s;
  }

  _entries(room, to) {
    const list = [];
    for (const m of room.members.values()) list.push(this._entry(m, to));
    return list;
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
