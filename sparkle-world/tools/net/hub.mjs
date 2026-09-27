// NetHub: an in-memory room service for Node tests (docs/MULTIPLAYER.md §15.1), built on
// the production room logic (server/rooms.mjs). LoopTransport({ hub }) connects to it.
//
// Faults: emit drop rate, duplicates, random delay (so reordering), presence delay (FIFO per
// receiver, >= 33 ms apart: ~30 Hz), partitions (a peer's link goes down and comes back with
// the whole roster, like a reconnect). Limits are enforced and every breach is recorded in
// hub.violations: message bytes, presence bytes, 1,000 B presence strings, identifier keys,
// and the page budget (40/s, burst 80; past it emits drop and `reportError` is counted).
//
// Also exports SimClock, a deterministic virtual clock for the property tests.

import { RoomRegistry, jsonSize } from '../../server/rooms.mjs';
import { TokenBucket } from '../../src/net/transport.js';

// ---------- SimClock ----------

export class SimClock {
  constructor(start = 1_000_000) {
    this.t = start;
    this.seq = 0;
    this.heap = [];
    this.byId = new Map();
    this.events = 0;
  }

  now() {
    return this.t;
  }

  setTimeout(fn, ms) {
    const id = ++this.seq;
    const e = { at: this.t + Math.max(0, +ms || 0), id, fn, dead: false };
    this.byId.set(id, e);
    this._push(e);
    return id;
  }

  clearTimeout(id) {
    const e = this.byId.get(id);
    if (e) {
      e.dead = true;
      this.byId.delete(id);
    }
  }

  /** Run every timer due within `ms`, in time order, letting promise chains settle between. */
  async advance(ms) {
    const end = this.t + ms;
    for (;;) {
      const e = this.heap[0];
      if (!e || e.at > end) break;
      this._pop();
      if (e.dead) continue;
      this.byId.delete(e.id);
      this.t = e.at;
      this.events++;
      e.fn();
      await settle();
    }
    this.t = end;
    await settle();
  }

  _push(e) {
    const h = this.heap;
    h.push(e);
    let k = h.length - 1;
    while (k > 0) {
      const p = (k - 1) >> 1;
      if (less(h[p], h[k])) break;
      [h[p], h[k]] = [h[k], h[p]];
      k = p;
    }
  }

  _pop() {
    const h = this.heap;
    const top = h[0];
    const last = h.pop();
    if (h.length > 0) {
      h[0] = last;
      let k = 0;
      for (;;) {
        const l = 2 * k + 1, r = l + 1;
        let m = k;
        if (l < h.length && less(h[l], h[m])) m = l;
        if (r < h.length && less(h[r], h[m])) m = r;
        if (m === k) break;
        [h[m], h[k]] = [h[k], h[m]];
        k = m;
      }
    }
    return top;
  }
}

const less = (a, b) => a.at < b.at || (a.at === b.at && a.id < b.id);

/** Let pending promise continuations run (several microtask turns). */
export async function settle() {
  for (let k = 0; k < 6; k++) await null;
}

/** Deterministic PRNG (mulberry32). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function rand() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- NetHub ----------

export class NetHub {
  /**
   * @param {object} o
   * @param {object} o.clock                 SimClock or a real clock
   * @param {() => number} [o.rand]
   * @param {number} [o.dropRate=0]          emit drop probability per receiver
   * @param {number} [o.dupRate=0]           emit duplicate probability per receiver
   * @param {number[]} [o.delayMs=[0,0]]     emit delay range
   * @param {number[]} [o.presenceDelayMs=[0,0]] presence/roster delay range (FIFO per receiver)
   * @param {object} [o.limits]              { msgBytes, stateBytes, strBytes }
   * @param {object} [o.budget]              { rate, burst } per page
   * @param {number} [o.maxPeers=16]
   * @param {number} [o.graceMs=10000]
   */
  constructor(o) {
    this.clock = o.clock;
    this.rand = o.rand || Math.random;
    this.dropRate = o.dropRate || 0;
    this.dupRate = o.dupRate || 0;
    this.delayMs = o.delayMs || [0, 0];
    this.presenceDelayMs = o.presenceDelayMs || [0, 0];
    this.limits = { msgBytes: 3900, stateBytes: 3900, strBytes: 1000, ...(o.limits || {}) };
    this.budget = { rate: 40, burst: 80, ...(o.budget || {}) };
    this.registry = new RoomRegistry({
      maxRooms: 100000,
      maxPeers: o.maxPeers ?? 16,
      msgBytes: this.limits.msgBytes,
      stateBytes: this.limits.stateBytes,
      strBytes: this.limits.strBytes,
      graceMs: o.graceMs ?? 10000,
      idleMs: Infinity,
      now: () => this.clock.now(),
    });
    this.links = new Map();
    this.nextPeer = 0;
    this.violations = [];
    this.stats = { emits: 0, states: 0, dropped: 0, duplicated: 0, delivered: 0, reportErrors: 0, maxEmit: 0, maxState: 0 };
    this.closed = false;
    this._sweep = this.clock.setTimeout(() => this._sweepTick(), 1000);
  }

  close() {
    this.closed = true;
    this.clock.clearTimeout(this._sweep);
    for (const l of Array.from(this.links.values())) l.close();
  }

  _sweepTick() {
    if (this.closed) return;
    this.registry.sweep();
    this._sweep = this.clock.setTimeout(() => this._sweepTick(), 1000);
  }

  /** Connect a client to room `room`. sink = { deliver(frame), down(), fatal(code) }. */
  connect(room, sink, meta = {}) {
    const peer = 'p' + (++this.nextPeer).toString(36).padStart(4, '0') + Math.floor(this.rand() * 36 ** 6).toString(36).padStart(6, '0');
    const link = new HubLink(this, room, peer, sink, meta);
    this.links.set(peer, link);
    const r = this.registry.join(room, peer, link.inbox, { by: meta.by ?? null });
    if (!r.ok) {
      this.clock.setTimeout(() => sink.deliver({ t: 'e', code: r.code }), 1);
      link.closed = true;
      this.links.delete(peer);
    }
    return link;
  }

  /** Take `peer` offline for `ms` (a reconnect afterwards, same peer id). */
  partition(peer, ms) {
    const l = this.links.get(peer);
    if (!l || l.closed || !l.up) return false;
    l.up = false;
    l.gen++;
    l.resetQueue();
    this.registry.detach(l.room, l.peer);
    l.sink.down();
    this.clock.setTimeout(() => {
      if (l.closed) return;
      l.up = true;
      l.gen++;
      l.resetQueue();
      this.registry.join(l.room, l.peer, l.inbox, { by: l.meta.by ?? null });
    }, ms);
    return true;
  }

  /** The page's grant was withdrawn (terminal). */
  revoke(peer) {
    const l = this.links.get(peer);
    if (!l) return;
    l.close();
    l.sink.fatal('revoked');
  }

  /** A new artifact version: every page reloads and the rooms empty. */
  newVersion() {
    for (const l of Array.from(this.links.values())) {
      l.close();
      l.sink.fatal('ended');
    }
  }

  isPartitioned(peer) {
    const l = this.links.get(peer);
    return !!l && !l.up;
  }

  violation(peer, kind, detail) {
    this.violations.push({ at: this.clock.now(), peer, kind, detail });
  }

  _delay(range) {
    return range[0] + this.rand() * (range[1] - range[0]);
  }
}

class HubLink {
  constructor(hub, room, peer, sink, meta) {
    this.hub = hub;
    this.room = room;
    this.peer = peer;
    this.sink = sink;
    this.meta = meta;
    this.up = true;
    this.closed = false;
    this.gen = 0;
    this.pAt = -Infinity;
    this.pQueue = [];
    this.pTimer = null;
    this.bucket = new TokenBucket(hub.budget.rate, hub.budget.burst, hub.clock.now());
    this.sends = 0;
    this.secCount = 0;
    this.secAt = -1;
    this.maxPerSec = 0;
    this.reported = false;
    this.inbox = (frame) => this._schedule(frame);
  }

  send(frame) {
    const hub = this.hub;
    if (this.closed || !this.up) return false;
    if (frame.t === 'bye') {
      this.close();
      return true;
    }
    if (frame.t === 'k') return true;
    const now = hub.clock.now();
    this.sends++;
    const sec = Math.floor(now / 1000);
    if (sec !== this.secAt) {
      this.secAt = sec;
      this.secCount = 0;
    }
    this.secCount++;
    if (this.secCount > this.maxPerSec) this.maxPerSec = this.secCount;
    if (!this.bucket.take(now)) {
      hub.violation(this.peer, 'budget', frame.t);
      if (frame.t === 'b') {
        if (!this.reported) {
          this.reported = true;
          hub.stats.reportErrors++;
        }
        return true; // dropped past the budget, like the platform
      }
    }
    if (frame.t === 'b') {
      const size = jsonSize(frame.data);
      hub.stats.emits++;
      if (size > hub.stats.maxEmit) hub.stats.maxEmit = size;
    } else if (frame.t === 's') {
      hub.stats.states++;
    }
    const err = hub.registry.handle(this.room, this.peer, frame);
    if (err) hub.violation(this.peer, err.code, err.msg || '');
    if (frame.t === 's' && !err) {
      const room = hub.registry.rooms.get(this.room);
      const m = room?.members.get(this.peer);
      if (m) {
        const size = jsonSize(m.state);
        if (size > hub.stats.maxState) hub.stats.maxState = size;
      }
    }
    return true;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.hub.registry.leave(this.room, this.peer);
    this.hub.links.delete(this.peer);
  }

  _schedule(frame) {
    const hub = this.hub;
    if (this.closed) return;
    const gen = this.gen;
    const deliver = () => {
      if (this.closed || this.gen !== gen || !this.up) return;
      hub.stats.delivered++;
      this.sink.deliver(frame);
    };
    const now = hub.clock.now();
    if (frame.t === 'b') {
      const copies = hub.rand() < hub.dupRate ? 2 : 1;
      if (copies === 2) hub.stats.duplicated++;
      for (let k = 0; k < copies; k++) {
        if (hub.rand() < hub.dropRate) {
          hub.stats.dropped++;
          continue;
        }
        hub.clock.setTimeout(deliver, hub._delay(hub.delayMs));
      }
      return;
    }
    // roster / presence: reliable and in order, coalesced to about 30 deliveries per second
    this.pQueue.push(frame);
    if (this.pTimer !== null) return;
    const at = Math.max(now + hub._delay(hub.presenceDelayMs), this.pAt + 33);
    this.pTimer = hub.clock.setTimeout(() => {
      this.pTimer = null;
      this.pAt = hub.clock.now();
      const list = this.pQueue;
      this.pQueue = [];
      if (this.closed || this.gen !== gen || !this.up) return;
      for (const f of list) {
        hub.stats.delivered++;
        this.sink.deliver(f);
      }
    }, at - now);
  }

  /** Forget queued roster frames (partition: the reconnect brings a whole roster). */
  resetQueue() {
    if (this.pTimer !== null) this.hub.clock.clearTimeout(this.pTimer);
    this.pTimer = null;
    this.pQueue = [];
  }
}
