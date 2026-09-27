// LoopTransport (docs/MULTIPLAYER.md §4.4): the NetTransport semantics without a server.
// - Node tests: pass { hub } (tools/net/hub.mjs), an in-memory room with fault injection
//   that runs the production room logic (server/rooms.mjs).
// - Two tabs in one browser profile (?net=loop): a BroadcastChannel('sw-net') where every tab
//   keeps its own copy of the room roster. Knobs: dropRate, dupRate, delayMs [min, max].

import { FrameTransport, NetError, realClock } from './transport.js';

function randomId(n = 16) {
  const a = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let s = '';
  const buf = new Uint8Array(n);
  if (globalThis.crypto?.getRandomValues) globalThis.crypto.getRandomValues(buf);
  else for (let k = 0; k < n; k++) buf[k] = Math.floor(Math.random() * 256);
  for (let k = 0; k < n; k++) s += a[buf[k] % 36];
  return s;
}

export class LoopTransport extends FrameTransport {
  /**
   * @param {object} o
   * @param {object} [o.hub]       NetHub (tests); without it a BroadcastChannel is used
   * @param {string} [o.uid]       my stable id (tests); default: a random per-page id
   * @param {string|null} [o.by]   Sender.by the hub stamps (tests of `by` handling)
   * @param {boolean} [o.canHost]  identity().canHost (default true)
   * @param {object} [o.clock]
   * @param {object} [o.limits]
   * @param {object} [o.faults]    BroadcastChannel mode: { dropRate, dupRate, delayMs }
   */
  constructor(o = {}) {
    super({ clock: o.clock || realClock, limits: o.limits });
    this._hub = o.hub || null;
    this._uid = o.uid || null;
    this._by = o.by ?? null;
    this._canHost = o.canHost ?? true;
    this._faults = o.faults || {};
    this._link = null;
    this._name = o.name || '';
  }

  get kind() { return 'loop'; }

  async identity() {
    if (!this._uid) this._uid = loadDeviceId('loop');
    return { uid: this._uid, canHost: this._canHost };
  }

  async _linkOpen(roomName) {
    const sink = {
      deliver: (frame) => this._onFrame(frame),
      down: () => this._onLinkDown(),
      fatal: (code) => this._onFatal(code),
    };
    if (this._hub) {
      this._link = this._hub.connect(roomName, sink, { by: this._by, name: this._name });
    } else if (typeof BroadcastChannel === 'function') {
      this._link = new BroadcastLink(roomName, sink, { clock: this.clock, faults: this._faults });
    } else {
      throw new NetError('unavailable', 'no hub and no BroadcastChannel');
    }
  }

  _linkSend(frame) {
    return this._link ? this._link.send(frame) : false;
  }

  async _linkClose() {
    const l = this._link;
    this._link = null;
    if (l) l.close();
  }

  /** Test helper: the hub's peer id for this transport (before open resolves). */
  get linkPeer() {
    return this._link?.peer ?? null;
  }
}

/** A per-device id kept in localStorage (random, not an account). */
export function loadDeviceId(kind) {
  const key = 'sparkle-world:net-id';
  try {
    const ls = globalThis.localStorage;
    let v = ls?.getItem(key);
    if (!v || !/^[a-z0-9]{12,32}$/.test(v)) {
      v = randomId(16);
      ls?.setItem(key, v);
    }
    return v;
  } catch {
    return kind + '-' + randomId(12);
  }
}

// ---------- BroadcastChannel room (two tabs, dev only) ----------

const HEARTBEAT = 2000;
const PEER_TIMEOUT = 6500;

class BroadcastLink {
  constructor(room, sink, { clock, faults }) {
    this.room = room;
    this.sink = sink;
    this.clock = clock;
    this.faults = faults;
    this.peer = randomId(16);
    this.state = {};
    this.roster = new Map(); // peer -> { state, seen }
    this.closed = false;
    this.ch = new BroadcastChannel('sw-net');
    this.ch.onmessage = (ev) => this._onMessage(ev.data);
    this._post({ t: 'join', state: this.state });
    this._deliver({ t: 'p', self: this.peer, reset: true, j: [this._entry(this.peer, this.state, true)] });
    this.beat = setInterval(() => this._heartbeat(), HEARTBEAT);
    this._onHide = () => this.close();
    globalThis.addEventListener?.('pagehide', this._onHide);
  }

  send(frame) {
    if (this.closed) return false;
    if (frame.t === 's') {
      if (frame.replace) this.state = { ...frame.patch };
      else for (const k in frame.patch) {
        if (frame.patch[k] === null) delete this.state[k];
        else this.state[k] = frame.patch[k];
      }
      this._post({ t: 'state', patch: frame.patch, replace: !!frame.replace });
    } else if (frame.t === 'b') {
      this._post({ t: 'b', topic: frame.topic, data: frame.data });
      this._deliver({ t: 'b', topic: frame.topic, data: frame.data, from: this._sender(this.peer) });
    } else if (frame.t === 'bye') {
      this._post({ t: 'leave' });
    }
    return true;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    try {
      this._post({ t: 'leave' });
    } catch {}
    clearInterval(this.beat);
    globalThis.removeEventListener?.('pagehide', this._onHide);
    this.ch.close();
  }

  _post(m) {
    m.room = this.room;
    m.from = this.peer;
    this.ch.postMessage(m);
  }

  _sender(peer) {
    const self = peer === this.peer;
    return { peer, by: null, isMe: self, sameTab: self, kind: 'viewer', guest: false };
  }

  _entry(peer, state, self) {
    return { ...this._sender(peer), sameTab: !!self, isMe: !!self, state };
  }

  _deliver(frame) {
    if (this.closed) return;
    const f = this.faults;
    if (frame.t === 'b' && f.dropRate && Math.random() < f.dropRate) return;
    const d = f.delayMs ? f.delayMs[0] + Math.random() * (f.delayMs[1] - f.delayMs[0]) : 0;
    const go = () => this.sink.deliver(frame);
    if (d > 0 && frame.t === 'b') setTimeout(go, d);
    else go();
    if (frame.t === 'b' && f.dupRate && Math.random() < f.dupRate) setTimeout(go, d + 5);
  }

  _add(peer, state) {
    const known = this.roster.get(peer);
    if (known) {
      known.seen = Date.now();
      return;
    }
    this.roster.set(peer, { state: state || {}, seen: Date.now() });
    this._deliver({ t: 'p', j: [this._entry(peer, state || {}, false)] });
  }

  _onMessage(m) {
    if (this.closed || !m || m.room !== this.room || m.from === this.peer) return;
    const from = m.from;
    switch (m.t) {
      case 'join':
        this._add(from, m.state);
        this._post({ t: 'here', to: from, state: this.state });
        break;
      case 'here':
        if (m.to === this.peer) this._add(from, m.state);
        break;
      case 'beat':
        if (!this.roster.has(from)) this._post({ t: 'who', to: from });
        else this.roster.get(from).seen = Date.now();
        break;
      case 'who':
        if (m.to === this.peer) this._post({ t: 'here', to: from, state: this.state });
        break;
      case 'state': {
        const r = this.roster.get(from);
        if (!r) {
          this._post({ t: 'who', to: from });
          return;
        }
        r.seen = Date.now();
        const next = m.replace ? {} : { ...r.state };
        for (const k in m.patch) {
          if (m.patch[k] === null) delete next[k];
          else next[k] = m.patch[k];
        }
        const out = { ...m.patch };
        if (m.replace) for (const k in r.state) if (!(k in next)) out[k] = null;
        r.state = next;
        this._deliver({ t: 'p', u: [[from, out]] });
        break;
      }
      case 'b':
        if (this.roster.has(from)) this._deliver({ t: 'b', topic: m.topic, data: m.data, from: this._sender(from) });
        break;
      case 'leave':
        if (this.roster.delete(from)) this._deliver({ t: 'p', l: [from] });
        break;
    }
  }

  _heartbeat() {
    if (this.closed) return;
    this._post({ t: 'beat' });
    const now = Date.now();
    for (const [peer, r] of this.roster) {
      if (now - r.seen > PEER_TIMEOUT) {
        this.roster.delete(peer);
        this._deliver({ t: 'p', l: [peer] });
      }
    }
  }
}
