// A room.d.ts-faithful `window.claude` for the headless multiplayer probe
// (docs/MULTIPLAYER.md §15.2). It is the browser twin of tools/net/fake-room.mjs:
//
//   page side   installFakeClaude(opts) runs in every page (context.addInitScript) before the
//               game: claude.use('room' | 'user') return the platform's shapes; 'db' and
//               'downloads' are null (saves stay on the device, like the Railway version).
//   Node side   FakeClaudeHub routes every page's frames through ONE NetHub (tools/net/hub.mjs,
//               the production room logic in server/rooms.mjs) over context.exposeBinding
//               ('__swHub') and delivers with page.evaluate(window.__swFakeRoomDeliver).
//
// Rules enforced as the platform does (so the game's own limits are what keep it safe):
//   - room names ^[a-z0-9][a-z0-9_.-]{0,47}$ and topics ^[a-z][a-z0-9_.-]{0,47}$
//     (invalid_argument), emits <= 4 KiB and merged presence <= 4 KiB (invalid_argument),
//     identifier keys and <= 1 KiB strings in presence (invalid_argument, by the room logic);
//   - per-page levels admin / interact / view: an emit on a topic above the page's level
//     rejects not_permitted (the declared topics are opened to 'interact');
//   - the page's shared send budget (40/s, burst 80, presence flushes included): past it
//     emits are dropped and reportError() is called ONCE (a console error: tests fail on it);
//   - onPeers at most once per ~frame with net joined / left / updated and frozen snapshots;
//     Sender stamping (peer, by, isMe, sameTab, kind, guest) comes from the room logic;
//   - disconnects: emits dropped silently, presence re-asserted after the reconnect.
// Fault injection (Node): hub.dropRate / dupRate / delayMs, partition(page, ms),
// revoke(page), newVersion() (every page reloads, the rooms empty).

// ---------------------------------------------------------------------------------------
// page side (serialized into the page by addInitScript; no imports, no closures)
// ---------------------------------------------------------------------------------------

/**
 * @param {object} o  { uid, level: 'admin'|'interact'|'view', can: true|false|null, guest,
 *   rooms (false: join rejects not_permitted), accounts: { uid: name }, topics }
 */
export function installFakeClaude(o) {
  if (window.claude) return;
  const ROOM_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
  const TOPIC_RE = /^[a-z][a-z0-9_.-]{0,47}$/;
  const LEVELS = { view: 0, interact: 1, admin: 2 };
  const topics = o.topics || { 'sw.op': 'interact', 'sw.bulk': 'interact', 'sw.ctl': 'interact' };
  const enc = new TextEncoder();
  const size = (v) => enc.encode(JSON.stringify(v === undefined ? null : v)).length;
  const reject = (code, message) => {
    const e = new Error(message || code);
    e.code = code;
    return Promise.reject(e);
  };
  const hub = (msg) => (typeof window.__swHub === 'function' ? window.__swHub(msg) : Promise.reject(new Error('no hub')));

  // the page's shared budget (presence + emits), and what the probe reads back
  const stats = { emits: 0, presence: 0, dropped: 0, reportErrors: 0, maxEmit: 0, maxPresence: 0, perSec: [], maxPerSec: 0, rejects: {} };
  const bucket = { rate: 40, burst: 80, tokens: 80, at: performance.now() };
  const sendTimes = [];
  const take = () => {
    const now = performance.now();
    bucket.tokens = Math.min(bucket.burst, bucket.tokens + ((now - bucket.at) * bucket.rate) / 1000);
    bucket.at = now;
    sendTimes.push(now);
    while (sendTimes.length && sendTimes[0] < now - 1000) sendTimes.shift();
    if (sendTimes.length > stats.maxPerSec) stats.maxPerSec = sendTimes.length;
    if (bucket.tokens < 1) return false;
    bucket.tokens -= 1;
    return true;
  };
  let reported = false;
  const countReject = (code) => { stats.rejects[code] = (stats.rejects[code] || 0) + 1; };

  const rooms = new Map(); // name -> NamedRoom

  class NamedRoom {
    constructor(name, peer) {
      this.name = name;
      this.self = peer;
      this.peersMap = new Map();
      this.snapshot = Object.freeze([]);
      this.handlers = new Map();
      this.peerFns = new Set();
      this.connFns = new Set();
      this.left = false;
      this.dead = null;
      this.up = true;
      this.mine = {};
      this.change = null;
      this.timer = null;
      const self = this;
      this.api = Object.freeze({
        name,
        emit: (topic, data) => self.emit(topic, data),
        on: (topic, fn, onError) => self.on(topic, fn, onError),
        presence: (patch) => self.presence(patch),
        peers: () => self.snapshot,
        onPeers: (fn, onError) => self.onPeers(fn, onError),
        connected: () => !self.left && !self.dead && self.up,
        onConnection: (fn, onError) => self.onConnection(fn, onError),
        leave: () => self.leave(),
      });
    }

    _peer(e) {
      return Object.freeze({
        peer: e.peer, by: e.by ?? null, isMe: !!e.isMe, sameTab: !!e.sameTab, kind: e.kind || 'viewer', guest: !!e.guest,
        presence: Object.freeze({ ...(e.state || {}) }), updatedAt: Date.now(),
      });
    }

    deliver(f) {
      if (this.left || this.dead) return;
      if (f.t === 'b') {
        const msg = Object.freeze({ ...f.from, topic: f.topic, data: f.data });
        for (const h of Array.from(this.handlers.get(f.topic) || [])) {
          try {
            h.fn(msg);
          } catch (err) {
            setTimeout(() => { throw err; });
          }
        }
        return;
      }
      if (f.t === 'down') return this._link(false);
      if (f.t === 'fatal') return this.fail(f.code || 'upstream_error');
      if (f.t !== 'p') return;
      if (f.reset) {
        const fresh = new Set((f.j || []).map((j) => j.peer));
        for (const [id, old] of Array.from(this.peersMap)) {
          if (!fresh.has(id)) {
            this.peersMap.delete(id);
            this._note('left', old);
          }
        }
        for (const j of f.j || []) {
          const had = this.peersMap.has(j.peer);
          const p = this._peer(j);
          this.peersMap.set(p.peer, p);
          this._note(had ? 'updated' : 'joined', p);
        }
        if (!this.up) this._link(true);
        return;
      }
      for (const j of f.j || []) {
        const p = this._peer(j);
        this.peersMap.set(p.peer, p);
        this._note('joined', p);
      }
      for (const id of f.l || []) {
        const old = this.peersMap.get(id);
        if (!old) continue;
        this.peersMap.delete(id);
        this._note('left', old);
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

    _link(up) {
      if (this.up === up) return;
      this.up = up;
      for (const h of Array.from(this.connFns)) h.fn(up);
      // the platform re-asserts this page's presence after a reconnect
      if (up && Object.keys(this.mine).length) hub({ op: 'frame', room: this.name, frame: { t: 's', patch: this.mine, replace: true } }).catch(() => {});
    }

    _note(kind, p) {
      this.snapshot = Object.freeze(Array.from(this.peersMap.values()));
      const c = (this.change ||= { joined: new Map(), left: new Map(), updated: new Map() });
      if (kind === 'joined') {
        c.left.delete(p.peer);
        c.joined.set(p.peer, p);
      } else if (kind === 'left') {
        if (c.joined.has(p.peer)) c.joined.delete(p.peer);
        else c.left.set(p.peer, p);
        c.updated.delete(p.peer);
      } else if (c.joined.has(p.peer)) c.joined.set(p.peer, p);
      else c.updated.set(p.peer, p);
      if (this.timer) return;
      this.timer = setTimeout(() => {
        this.timer = null;
        const ch = this.change;
        this.change = null;
        if (!ch || this.left || this.dead) return;
        const change = Object.freeze({
          peers: this.snapshot,
          joined: Object.freeze(Array.from(ch.joined.values())),
          left: Object.freeze(Array.from(ch.left.values())),
          updated: Object.freeze(Array.from(ch.updated.values())),
        });
        for (const h of Array.from(this.peerFns)) h.fn(change);
      }, 16);
    }

    _gone() {
      if (this.dead) return reject(this.dead);
      if (this.left) return reject('invalid_argument', 'left the room');
      return null;
    }

    emit(topic, data) {
      const g = this._gone();
      if (g) return g;
      if (typeof topic !== 'string' || !TOPIC_RE.test(topic)) return countReject('invalid_argument'), reject('invalid_argument', 'topic');
      const n = size(data);
      if (n > 4096) return countReject('invalid_argument'), reject('invalid_argument', `data is ${n} bytes (limit 4096)`);
      const need = topics[topic] || 'admin';
      if (LEVELS[o.level || 'interact'] < LEVELS[need]) return countReject('not_permitted'), reject('not_permitted');
      if (!this.up) return Promise.resolve(); // dropped silently while disconnected
      if (!take()) {
        stats.dropped++;
        if (!reported) {
          reported = true;
          stats.reportErrors++;
          const e = new Error('room: send budget exceeded; messages are being dropped');
          if (typeof window.reportError === 'function') window.reportError(e);
          else console.error(e);
        }
        return Promise.resolve();
      }
      stats.emits++;
      if (n > stats.maxEmit) stats.maxEmit = n;
      hub({ op: 'frame', room: this.name, frame: { t: 'b', topic, data } }).catch(() => {});
      return Promise.resolve();
    }

    presence(patch) {
      const g = this._gone();
      if (g) return g;
      if (!patch || typeof patch !== 'object') return reject('invalid_argument', 'patch');
      const next = { ...this.mine };
      for (const k in patch) {
        if (patch[k] === null || patch[k] === undefined) delete next[k];
        else next[k] = patch[k];
      }
      const n = size(next);
      if (n > 4096) return countReject('invalid_argument'), reject('invalid_argument', `presence is ${n} bytes (limit 4096)`);
      this.mine = next;
      if (n > stats.maxPresence) stats.maxPresence = n;
      const me = this.peersMap.get(this.self);
      if (me) {
        const p = Object.freeze({ ...me, presence: Object.freeze({ ...next }), updatedAt: Date.now() });
        this.peersMap.set(p.peer, p);
        this._note('updated', p);
      }
      if (!this.up) return Promise.resolve(); // re-asserted after the reconnect
      take();
      stats.presence++;
      return hub({ op: 'frame', room: this.name, frame: { t: 's', patch } }).then((r) => {
        if (r && r.error) {
          countReject('invalid_argument');
          const e = new Error('presence: ' + r.error);
          e.code = 'invalid_argument';
          throw e;
        }
      });
    }

    on(topic, fn, onError) {
      if (typeof fn !== 'function') throw new TypeError('handler');
      const box = { fn, onError };
      if (!this.handlers.has(topic)) this.handlers.set(topic, new Set());
      this.handlers.get(topic).add(box);
      if (typeof topic !== 'string' || !TOPIC_RE.test(topic)) queueMicrotask(() => onError && onError({ code: 'invalid_argument', message: 'topic' }));
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
        if (this.connFns.has(box)) fn(!this.left && !this.dead && this.up);
      });
      return () => this.connFns.delete(box);
    }

    leave() {
      if (this.left) return Promise.resolve();
      this.left = true;
      rooms.delete(this.name);
      pending.delete(this.name);
      return hub({ op: 'leave', room: this.name }).then(() => undefined, () => undefined);
    }

    fail(code) {
      if (this.dead) return;
      this.dead = code;
      rooms.delete(this.name);
      const all = [];
      for (const set of this.handlers.values()) for (const h of set) all.push(h);
      for (const h of this.peerFns) all.push(h);
      for (const h of this.connFns) all.push(h);
      for (const h of all) setTimeout(() => h.onError && h.onError({ code, message: code }), 1);
    }
  }

  const room = Object.freeze({
    async join(name) {
      if (typeof name !== 'string' || !ROOM_RE.test(name)) return reject('invalid_argument', 'room name');
      if (o.rooms === false) return reject('not_permitted');
      const had = rooms.get(name);
      if (had) return had.api;
      const r = await hub({ op: 'join', room: name });
      if (!r || !r.ok) return reject(r && r.code === 'full' ? 'limit_reached' : r && r.code ? 'upstream_error' : 'upstream_error');
      const nr = new NamedRoom(name, r.peer);
      rooms.set(name, nr);
      for (const f of r.frames || []) nr.deliver(f);
      const early = pending.get(name);
      pending.delete(name);
      if (early) for (const f of early) nr.deliver(f);
      return nr.api;
    },
  });

  const accounts = o.accounts || {};
  const user = Object.freeze({
    id: async () => o.uid ?? null,
    can: async (what) => (what === 'data.write' ? (o.can === undefined ? true : o.can) : null),
    canEdit: async () => o.level === 'admin',
    isOwner: async () => o.level === 'admin',
    me: async () => ({ id: o.uid ?? null, name: accounts[o.uid] || '', avatarUrl: 'data:,', color: '#888', email: null, isOwner: false, canEdit: o.level === 'admin' }),
    profiles: async (ids) => {
      const out = {};
      for (const id of [].concat(ids || [])) out[id] = { id, name: accounts[id] || '', avatarUrl: 'data:,', color: '#888', email: null, isMe: id === o.uid, guest: false };
      return out;
    },
  });

  // Node -> page (frames that beat the join answer wait for it)
  const pending = new Map();
  window.__swFakeRoomDeliver = (name, frames) => {
    const nr = rooms.get(name);
    if (!nr) {
      const q = pending.get(name) || [];
      q.push(...frames);
      pending.set(name, q.slice(-400));
      return false;
    }
    for (const f of frames) nr.deliver(f);
    return true;
  };
  window.__swFakeStats = () => JSON.parse(JSON.stringify(stats));
  window.addEventListener('pagehide', () => {
    for (const nr of Array.from(rooms.values())) nr.leave();
  });

  const claude = Object.freeze({
    use: async (name) => (name === 'room' ? room : name === 'user' ? user : null),
  });
  Object.defineProperty(window, 'claude', { value: claude, configurable: false, writable: false });
}

// ---------------------------------------------------------------------------------------
// Node side
// ---------------------------------------------------------------------------------------

/**
 * Routes the fake rooms of several Playwright pages through one NetHub.
 *   const fc = new FakeClaudeHub(hub);
 *   await fc.addContext(context, { uid: 'u-host', level: 'interact', can: true, accounts });
 * Then fc.pageOf(page) -> { links, emits }, fc.partition(page, ms), fc.revoke(page),
 * fc.newVersion(), fc.stats().
 */
export class FakeClaudeHub {
  constructor(hub) {
    this.hub = hub;
    this.pages = new Map(); // page -> { opts, links: Map room -> link, emits, states, queue }
  }

  _entry(page, opts) {
    let e = this.pages.get(page);
    if (!e) {
      e = { page, opts, links: new Map(), emits: 0, states: 0, queue: new Map(), flushing: false };
      this.pages.set(page, e);
      page.on('framenavigated', (fr) => { if (fr === page.mainFrame()) this._closePage(e); });
      page.on('close', () => this._closePage(e));
    }
    return e;
  }

  async addContext(context, opts) {
    await context.addInitScript(installFakeClaude, opts);
    await context.exposeBinding('__swHub', (source, msg) => this._onMessage(source.page, opts, msg));
    context.on('page', (p) => this._entry(p, opts));
    for (const p of context.pages()) this._entry(p, opts);
  }

  _closePage(e) {
    for (const link of e.links.values()) link.close();
    e.links.clear();
    e.queue.clear();
  }

  _onMessage(page, opts, msg) {
    const e = this._entry(page, opts);
    if (!msg || typeof msg !== 'object') return { ok: false };
    if (msg.op === 'join') {
      const old = e.links.get(msg.room);
      if (old && !old.closed) return { ok: true, peer: old.peer };
      const sink = {
        deliver: (frame) => this._queue(e, msg.room, frame),
        down: () => this._queue(e, msg.room, { t: 'down' }),
        fatal: (code) => this._queue(e, msg.room, { t: 'fatal', code }),
      };
      const link = this.hub.connect(msg.room, sink, { by: opts.uid ?? null, guest: !!opts.guest, name: opts.label || '' });
      if (link.closed) return { ok: false, code: 'full' };
      e.links.set(msg.room, link);
      // frames the room sent while connecting go with the answer (the roster first)
      const frames = this._take(e, msg.room);
      return { ok: true, peer: link.peer, frames };
    }
    const link = e.links.get(msg.room);
    if (msg.op === 'leave') {
      if (link) link.close();
      e.links.delete(msg.room);
      return { ok: true };
    }
    if (msg.op === 'frame') {
      if (!link || link.closed) return { ok: false };
      const f = msg.frame;
      const before = this.hub.violations.length;
      link.send(f);
      if (f && f.t === 'b') e.emits++;
      else if (f && f.t === 's') e.states++;
      const v = this.hub.violations.slice(before).find((x) => x.peer === link.peer && x.kind !== 'budget');
      return v ? { ok: false, error: v.kind + (v.detail ? ' ' + v.detail : '') } : { ok: true };
    }
    return { ok: false };
  }

  _take(e, room) {
    const q = e.queue.get(room);
    e.queue.delete(room);
    return q || [];
  }

  _queue(e, room, frame) {
    let q = e.queue.get(room);
    if (!q) e.queue.set(room, (q = []));
    q.push(frame);
    if (!e.flushing) {
      e.flushing = true;
      setTimeout(() => this._flush(e), 4);
    }
  }

  async _flush(e) {
    e.flushing = false;
    const batches = Array.from(e.queue.entries()).filter(([room]) => e.links.has(room));
    for (const [room] of batches) e.queue.delete(room);
    for (const [room, frames] of batches) {
      try {
        await e.page.evaluate(([r, f]) => window.__swFakeRoomDeliver && window.__swFakeRoomDeliver(r, f), [room, frames]);
      } catch {
        // the page is reloading or closed
      }
    }
  }

  /** The peer ids of a page's open rooms. */
  peersOf(page) {
    const e = this.pages.get(page);
    return e ? Array.from(e.links.values(), (l) => l.peer) : [];
  }

  /** Take a page offline for `ms` (a reconnect afterwards, same peer). */
  partition(page, ms) {
    for (const peer of this.peersOf(page)) this.hub.partition(peer, ms);
  }

  /** The page's grant was withdrawn (terminal). */
  revoke(page) {
    for (const peer of this.peersOf(page)) this.hub.revoke(peer);
  }

  /** A new artifact version: every room ends (the probe then reloads the pages). */
  newVersion() {
    this.hub.newVersion();
  }

  /** Sends the hub saw from each page: [{ label, emits, states }]. */
  stats() {
    return Array.from(this.pages.values(), (e) => ({ label: e.opts.label || '', emits: e.emits, states: e.states }));
  }
}
