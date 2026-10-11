// A contract-faithful fake of claude.use('room') / claude.use('user') for Node tests of
// RoomTransport (room.d.ts / user.d.ts 0.2.60), built on the production room logic
// (server/rooms.mjs). Delivery is asynchronous (timers), onPeers is batched per ~frame, and
// the rules the platform enforces are enforced here: topic and room-name grammars, 4 KiB emit
// and merged-presence limits (invalid_argument), per-page send levels (not_permitted), the
// shared budget (40/s, burst 80: past it emits drop and reportError is counted once).
// The browser twin for the headless probe is tools/net/fake-claude.js (UI task).

import { RoomRegistry, TOPIC_RE, ROOM_NAME_RE, jsonSize } from '../../server/rooms.mjs';

const LEVELS = { view: 0, interact: 1, admin: 2 };

class Bucket {
  constructor(rate, burst) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.at = Date.now();
  }
  take() {
    const now = Date.now();
    this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) * this.rate) / 1000);
    this.at = now;
    if (this.tokens < 1) return false;
    this.tokens -= 1;
    return true;
  }
}

function rejectWith(code, message = code) {
  const e = new Error(message);
  e.code = code;
  return Promise.reject(e);
}

let pageCounter = 0;

export function makeFakeClaude({ topics = { 'sw.op': 'interact', 'sw.bulk': 'interact', 'sw.ctl': 'interact' } } = {}) {
  const registry = new RoomRegistry({ maxPeers: 256, msgBytes: 4096, stateBytes: 4096, strBytes: 1024, maxRooms: 10000, idleMs: Infinity });
  const world = {
    reportErrors: 0,
    pages: [],
    registry,
    /** A page (one open document) of one viewer. */
    page({ uid = null, level = 'interact', rooms = true, can = undefined, guest = false } = {}) {
      const page = new FakePage(world, { uid, level, rooms, can, guest, topics });
      world.pages.push(page);
      return page.claude;
    },
    /** Let deliveries happen. */
    flush(ms = 60) {
      return new Promise((r) => setTimeout(r, ms));
    },
    /** Withdraw the grant of the page a transport uses (every listener hears 'revoked'). */
    revoke(transport) {
      for (const p of world.pages) if (p.claude === transport._claude) p.terminate('revoked');
    },
  };
  return world;
}

class FakePage {
  constructor(world, o) {
    this.world = world;
    this.o = o;
    this.peer = 'pg' + (++pageCounter).toString(36).padStart(4, '0') + Math.random().toString(36).slice(2, 12);
    this.bucket = new Bucket(40, 80);
    this.reported = false;
    this.rooms = new Map();
    const page = this;
    const user = Object.freeze({
      id: async () => o.uid,
      can: async (name) => (name === 'data.write' ? (o.can !== undefined ? o.can : o.level === 'view' ? null : true) : null),
      canEdit: async () => o.level === 'admin',
      isOwner: async () => false,
      me: async () => ({ id: o.uid, name: '', avatarUrl: 'data:,', color: '#888', email: null, isOwner: false, canEdit: o.level === 'admin' }),
      profiles: async (ids) => Object.fromEntries([].concat(ids).map((id) => [id, { id, name: '', avatarUrl: 'data:,', color: '#888', email: null, isMe: id === o.uid, guest: false }])),
    });
    const room = Object.freeze({
      join: (name) => page.join(name),
    });
    this.claude = Object.freeze({ use: async (name) => (name === 'room' ? room : name === 'user' ? user : null) });
  }

  send(frame) {
    // the page's shared budget
    if (!this.bucket.take()) {
      if (frame.t === 'b') {
        if (!this.reported) {
          this.reported = true;
          this.world.reportErrors++;
        }
        return;
      }
    }
    return true;
  }

  join(name) {
    if (typeof name !== 'string' || !ROOM_NAME_RE.test(name)) return rejectWith('invalid_argument', 'room name');
    if (!this.o.rooms) return rejectWith('not_permitted');
    if (this.rooms.has(name)) return Promise.resolve(this.rooms.get(name).api);
    const nr = new FakeNamedRoom(this, name);
    const r = this.world.registry.join(name, this.peer, (f) => nr.inbox(f), { by: this.o.uid, guest: this.o.guest });
    if (!r.ok) return rejectWith('limit_reached');
    this.rooms.set(name, nr);
    return Promise.resolve(nr.api);
  }

  terminate(code) {
    for (const nr of this.rooms.values()) nr.fail(code);
  }
}

class FakeNamedRoom {
  constructor(page, name) {
    this.page = page;
    this.name = name;
    this.peersMap = new Map(); // peer -> frozen Peer
    this.snapshot = Object.freeze([]);
    this.handlers = new Map(); // topic -> Set of {fn, onError}
    this.peerFns = new Set();
    this.connFns = new Set();
    this.left = false;
    this.dead = null;
    this.mine = {};
    this.change = null;
    this.first = true;
    const self = this;
    this.api = Object.freeze({
      name,
      emit: (topic, data) => self.emit(topic, data),
      on: (topic, fn, onError) => self.on(topic, fn, onError),
      presence: (patch) => self.presence(patch),
      peers: () => self.snapshot,
      onPeers: (fn, onError) => self.onPeers(fn, onError),
      connected: () => !self.left && !self.dead,
      onConnection: (fn, onError) => self.onConnection(fn, onError),
      leave: () => self.leave(),
    });
  }

  _peer(e) {
    return Object.freeze({
      peer: e.peer, by: e.by, isMe: e.isMe, sameTab: e.sameTab, kind: e.kind, guest: e.guest,
      presence: Object.freeze({ ...(e.state || {}) }), updatedAt: Date.now(),
    });
  }

  inbox(f) {
    setTimeout(() => this._deliver(f), 1);
  }

  _deliver(f) {
    if (this.left || this.dead) return;
    if (f.t === 'b') {
      const msg = Object.freeze({ ...f.from, topic: f.topic, data: f.data });
      for (const h of this.handlers.get(f.topic) || []) h.fn(msg);
      return;
    }
    if (f.t !== 'p') return;
    if (f.reset) {
      for (const j of f.j) {
        const p = this._peer(j);
        this.peersMap.set(p.peer, p);
        this._note('joined', p);
      }
    }
    for (const j of f.reset ? [] : f.j || []) {
      const p = this._peer(j);
      this.peersMap.set(p.peer, p);
      this._note('joined', p);
    }
    for (const id of f.l || []) {
      const old = this.peersMap.get(id);
      if (old) {
        this.peersMap.delete(id);
        this._note('left', old);
      }
    }
    for (const [id, patch] of f.u || []) {
      const old = this.peersMap.get(id);
      if (!old) continue;
      const st = { ...old.presence };
      for (const k in patch) {
        if (patch[k] === null) delete st[k];
        else st[k] = patch[k];
      }
      const p = Object.freeze({ ...old, presence: Object.freeze(st), updatedAt: Date.now() });
      this.peersMap.set(id, p);
      this._note('updated', p);
    }
  }

  _note(kind, p) {
    this.snapshot = Object.freeze(Array.from(this.peersMap.values()));
    const c = (this.change ||= { joined: new Map(), left: new Map(), updated: new Map() });
    if (kind === 'joined') c.joined.set(p.peer, p);
    else if (kind === 'left') {
      if (c.joined.has(p.peer)) c.joined.delete(p.peer);
      else c.left.set(p.peer, p);
      c.updated.delete(p.peer);
    } else if (c.joined.has(p.peer)) c.joined.set(p.peer, p);
    else c.updated.set(p.peer, p);
    if (!this.frame) {
      this.frame = setTimeout(() => {
        this.frame = null;
        const ch = this.change;
        this.change = null;
        if (!ch || this.left || this.dead) return;
        const change = Object.freeze({
          peers: this.snapshot,
          joined: Object.freeze(Array.from(ch.joined.values())),
          left: Object.freeze(Array.from(ch.left.values())),
          updated: Object.freeze(Array.from(ch.updated.values())),
        });
        for (const h of this.peerFns) h.fn(change);
      }, 16);
    }
  }

  _gone() {
    if (this.dead) return rejectWith(this.dead);
    if (this.left) return rejectWith('invalid_argument', 'left');
    return null;
  }

  emit(topic, data) {
    const g = this._gone();
    if (g) return g;
    if (typeof topic !== 'string' || !TOPIC_RE.test(topic)) return rejectWith('invalid_argument', 'topic');
    const size = jsonSize(data ?? null);
    if (size > 4096) return rejectWith('invalid_argument', `data is ${size} bytes (limit 4096)`);
    const need = this.page.o.topics[topic] || 'admin';
    if (LEVELS[this.page.o.level] < LEVELS[need]) return rejectWith('not_permitted');
    if (this.page.send({ t: 'b' })) this.page.world.registry.handle(this.name, this.page.peer, { t: 'b', topic, data });
    return Promise.resolve();
  }

  presence(patch) {
    const g = this._gone();
    if (g) return g;
    const next = { ...this.mine };
    for (const k in patch) {
      if (patch[k] === null) delete next[k];
      else next[k] = patch[k];
    }
    if (jsonSize(next) > 4096) return rejectWith('invalid_argument', 'presence over 4 KiB');
    const err = this.page.world.registry.handle(this.name, this.page.peer, { t: 's', patch });
    if (err) return rejectWith('invalid_argument', err.code);
    this.page.send({ t: 's' });
    this.mine = next;
    const me = this.peersMap.get(this.page.peer);
    if (me) {
      const p = Object.freeze({ ...me, presence: Object.freeze({ ...next }), updatedAt: Date.now() });
      this.peersMap.set(p.peer, p);
      this._note('updated', p);
    }
    return Promise.resolve();
  }

  on(topic, fn, onError) {
    if (typeof fn !== 'function') throw new TypeError('handler');
    const box = { fn, onError };
    if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
    this.handlers.get(topic).add(box);
    if (typeof topic !== 'string' || !TOPIC_RE.test(topic)) queueMicrotask(() => onError?.({ code: 'invalid_argument', message: 'topic' }));
    return () => this.handlers.get(topic)?.delete(box);
  }

  onPeers(fn, onError) {
    const box = { fn, onError };
    this.peerFns.add(box);
    return () => this.peerFns.delete(box);
  }

  onConnection(fn, onError) {
    const box = { fn, onError };
    this.connFns.add(box);
    queueMicrotask(() => {
      if (this.connFns.has(box)) fn(!this.left && !this.dead);
    });
    return () => this.connFns.delete(box);
  }

  leave() {
    if (this.left) return Promise.resolve();
    this.left = true;
    this.page.rooms.delete(this.name);
    this.page.world.registry.leave(this.name, this.page.peer);
    return Promise.resolve();
  }

  fail(code) {
    if (this.dead) return;
    this.dead = code;
    const all = [];
    for (const set of this.handlers.values()) for (const h of set) all.push(h);
    for (const h of this.peerFns) all.push(h);
    for (const h of this.connFns) all.push(h);
    for (const h of all) setTimeout(() => h.onError?.({ code, message: code }), 1);
    this.page.world.registry.leave(this.name, this.page.peer);
  }
}
