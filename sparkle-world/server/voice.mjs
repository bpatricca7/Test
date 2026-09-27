// Walkie-talkie relay for the Railway server (docs/MULTIPLAYER.md Addendum B).
//
// Voices go live, through this server, only:
//   - within ONE room (a game code), and there only within one game: the host's player plus
//     the friends the host let in (the host's presence `adm`, read from the room at the moment
//     each frame arrives, so a friend who is sent home stops hearing at once);
//   - to pages that said "voice on" ({t:'v', k:'on'}): each device needs its own grown-up's
//     OK (the page only says "on" after the grown-up check), to talk AND to hear. A page that
//     never said "on" receives no voice byte at all;
//   - one talker at a time per game (the "floor"), at most 15 s per press (by time and by
//     audio length), with per-talker byte and frame rate limits;
//   - never to someone muted: the host's presence `wm` = [all 0/1, [peers]] ("Mute everyone" /
//     a muted friend) silences talkers here too, and a listener's own mutes ({k:'mute'}) keep
//     those voices from being sent to her.
// Nothing is recorded, stored or logged: frames are passed on as they are and forgotten; only
// counters are kept (for /api/stats in tests).

import { W, F_END, readHeader, isPeerId } from '../src/net/walkie/wire.js';

class Bucket {
  constructor(rate, burst, now) {
    this.rate = rate;
    this.burst = burst;
    this.tokens = burst;
    this.at = now;
  }

  take(now, n = 1) {
    if (now > this.at) {
      this.tokens = Math.min(this.burst, this.tokens + ((now - this.at) * this.rate) / 1000);
      this.at = now;
    }
    if (this.tokens < n) return false;
    this.tokens -= n;
    return true;
  }
}

class Link {
  constructor(relay, name, peer, send, now) {
    this.relay = relay;
    this.name = name;
    this.peer = peer;
    this.send = send; // { json(obj), binary(bytes) }
    this.on = false;
    this.host = null;
    this.mutes = new Set();
    this.closed = false;
    this.lastEndAt = -Infinity;
    this.bytes = new Bucket(relay.L.BYTES_PER_S, relay.L.BYTES_BURST, now);
    this.frames = new Bucket(relay.L.FRAMES_PER_S, relay.L.FRAMES_BURST, now);
    this.c = { framesIn: 0, bytesIn: 0, framesOut: 0, bytesOut: 0 };
  }

  /** A {t:'v'} control frame from this page. */
  control(f) {
    if (this.closed || !f || typeof f !== 'object') return;
    this.relay._control(this, f);
  }

  /** A binary frame from this page. */
  binary(buf) {
    if (this.closed) return;
    this.relay._binary(this, buf);
  }

  /** The connection closed. */
  close() {
    if (this.closed) return;
    this.relay._close(this);
  }
}

export class VoiceRelay {
  /**
   * @param {object} o
   * @param {import('./rooms.mjs').RoomRegistry} o.registry  the rooms (membership and presence)
   * @param {() => number} [o.now]
   * @param {object} [o.limits]  overrides of W (tests)
   */
  constructor({ registry, now = () => Date.now(), limits = {} } = {}) {
    this.registry = registry;
    this.now = now;
    this.L = { ...W, ...limits };
    this.rooms = new Map(); // room name -> Set<Link>
    this.floors = new Map(); // room name + '\n' + host peer -> floor
    this.timer = null;
    this.counts = {
      links: 0, framesIn: 0, bytesIn: 0, framesRelayed: 0, bytesRelayed: 0,
      grants: 0, busy: 0, denied: 0, bad: 0, rateDropped: 0, noFloor: 0,
      cuts: { cap: 0, idle: 0, quiet: 0, muted: 0, group: 0, off: 0 },
    };
  }

  /** A new connection in room `name` as `peer`. send: { json(obj), binary(bytes) }. */
  link(name, peer, send) {
    const l = new Link(this, name, peer, send, this.now());
    let set = this.rooms.get(name);
    if (!set) this.rooms.set(name, (set = new Set()));
    set.add(l);
    this.counts.links++;
    return l;
  }

  start(everyMs = 250) {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), everyMs);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Timeouts: a silent talker loses the floor; no press lasts longer than 15 s. */
  tick() {
    const now = this.now();
    for (const fl of Array.from(this.floors.values())) {
      const L = this.L;
      if (now - fl.since > L.BURST_MS + L.GRACE_MS) this._release(fl, 'cap');
      else if (fl.frames === 0 ? now - fl.since > L.FIRST_FRAME_MS : now - fl.lastAt > L.IDLE_MS) this._release(fl, 'idle');
      else {
        const why = this._talkBlock(fl.link);
        if (why) this._release(fl, why);
      }
    }
  }

  stats() {
    let on = 0;
    let links = 0;
    for (const set of this.rooms.values()) for (const l of set) {
      links++;
      if (l.on) on++;
    }
    return { ...this.counts, cuts: { ...this.counts.cuts }, openLinks: links, voiceOn: on, talking: this.floors.size };
  }

  /** Per-peer counters (tests only; peers are random ids, room names are not included). */
  peerStats() {
    const out = [];
    for (const set of this.rooms.values()) for (const l of set) out.push({ peer: l.peer, on: l.on, ...l.c });
    return out;
  }

  // ---------- membership (read from the room, never stored here) ----------

  _member(name, peer) {
    const room = this.registry.rooms.get(name);
    return room ? room.members.get(peer) || null : null;
  }

  /** Is `peer` a player of the game `host` runs in room `name` (the host, or let in by her)? */
  _inGame(name, host, peer) {
    if (!host || !this._member(name, peer)) return false;
    const h = this._member(name, host);
    if (!h || !h.state || h.state.end === 1) return false;
    if (peer === host) return true;
    const adm = h.state.adm;
    if (!Array.isArray(adm)) return false;
    for (const e of adm) if (Array.isArray(e) && e[0] === peer) return true;
    return false;
  }

  /** The host's walkie mutes: presence wm = [all, [peers]]. */
  _hostMute(name, host) {
    const h = this._member(name, host);
    const wm = h && h.state ? h.state.wm : null;
    if (!Array.isArray(wm)) return { all: false, list: null };
    return { all: wm[0] === 1, list: Array.isArray(wm[1]) ? wm[1] : null };
  }

  /** Why this link may not talk now (null = it may). */
  _talkBlock(l) {
    if (!l.on) return 'off';
    if (!this._inGame(l.name, l.host, l.peer)) return 'group';
    const m = this._hostMute(l.name, l.host);
    if (m.all) return 'quiet';
    if (m.list && m.list.includes(l.peer)) return 'muted';
    return null;
  }

  _group(l) {
    const out = [];
    const set = this.rooms.get(l.name);
    if (!set) return out;
    for (const o of set) {
      if (o.on && !o.closed && o.host === l.host && this._inGame(o.name, o.host, o.peer)) out.push(o);
    }
    return out;
  }

  _floorKey(l) {
    return l.name + '\n' + l.host;
  }

  _json(l, obj) {
    try {
      l.send.json(obj);
    } catch {}
  }

  _tellGroup(l, obj) {
    for (const o of this._group(l)) this._json(o, obj);
  }

  // ---------- control ----------

  _control(l, f) {
    const now = this.now();
    switch (f.k) {
      case 'on': {
        if (!isPeerId(f.h)) return;
        if (l.on && l.host !== f.h) this._leaveFloor(l, 'off');
        l.on = true;
        l.host = f.h;
        const fl = this.floors.get(this._floorKey(l));
        this._json(l, { t: 'v', k: 'hi', ok: this._inGame(l.name, l.host, l.peer), talk: fl ? fl.link.peer : null });
        return;
      }
      case 'off':
        this._leaveFloor(l, 'off');
        l.on = false;
        l.host = null;
        return;
      case 'mute': {
        const list = Array.isArray(f.p) ? f.p.filter(isPeerId).slice(0, this.L.MAX_MUTES) : [];
        l.mutes = new Set(list);
        return;
      }
      case 'end':
        this._leaveFloor(l, 'end');
        return;
      case 'req': {
        const why = this._talkBlock(l);
        if (why) {
          this.counts.denied++;
          this._json(l, { t: 'v', k: 'no', why });
          return;
        }
        const key = this._floorKey(l);
        const fl = this.floors.get(key);
        if (fl && fl.link !== l) {
          this.counts.busy++;
          this._json(l, { t: 'v', k: 'busy', by: fl.link.peer });
          return;
        }
        if (fl) {
          this._json(l, { t: 'v', k: 'go' });
          return;
        }
        if (now - l.lastEndAt < this.L.COOLDOWN_MS) {
          this.counts.denied++;
          this._json(l, { t: 'v', k: 'no', why: 'wait' });
          return;
        }
        this.floors.set(key, { key, link: l, since: now, lastAt: now, frames: 0, samples: 0, bytes: 0 });
        this.counts.grants++;
        this._json(l, { t: 'v', k: 'go' });
        this._tellGroup(l, { t: 'v', k: 'talk', by: l.peer });
        return;
      }
      default:
    }
  }

  _leaveFloor(l, why) {
    const fl = this.floors.get(this._floorKey(l));
    if (fl && fl.link === l) this._release(fl, why);
  }

  /** End a press: tell the talker why (unless she ended it) and everyone that nobody talks. */
  _release(fl, why) {
    if (this.floors.get(fl.key) !== fl) return;
    this.floors.delete(fl.key);
    const l = fl.link;
    l.lastEndAt = this.now();
    if (why !== 'end') {
      if (this.counts.cuts[why] !== undefined) this.counts.cuts[why]++;
      if (!l.closed) this._json(l, { t: 'v', k: 'cut', why });
    }
    // everyone who heard her learns the press is over
    for (const o of this._group(l)) if (o !== l) this._json(o, { t: 'v', k: 'talk', by: null });
    if (!l.closed && l.on) this._json(l, { t: 'v', k: 'talk', by: null });
  }

  // ---------- audio ----------

  _binary(l, buf) {
    const now = this.now();
    const len = buf ? buf.byteLength ?? buf.length : 0;
    const h = readHeader(buf);
    if (!h || len > this.L.MAX_FRAME_BYTES || h.samples > this.L.MAX_FRAME_SAMPLES) {
      this.counts.bad++;
      return;
    }
    l.c.framesIn++;
    l.c.bytesIn += len;
    this.counts.framesIn++;
    this.counts.bytesIn += len;
    const fl = this.floors.get(this._floorKey(l));
    if (!l.on || !fl || fl.link !== l) {
      this.counts.noFloor++;
      return;
    }
    if (!l.frames.take(now) || !l.bytes.take(now, len)) {
      this.counts.rateDropped++;
      return;
    }
    const why = this._talkBlock(l);
    if (why) {
      this._release(fl, why);
      return;
    }
    if (now - fl.since > this.L.BURST_MS + this.L.GRACE_MS || fl.samples + h.samples > this.L.BURST_SAMPLES + this.L.MAX_FRAME_SAMPLES) {
      this._release(fl, 'cap');
      return;
    }
    fl.frames++;
    fl.samples += h.samples;
    fl.bytes += len;
    fl.lastAt = now;
    for (const o of this._group(l)) {
      if (o === l || o.mutes.has(l.peer)) continue;
      try {
        if (o.send.binary(buf) === false) continue;
      } catch {
        continue;
      }
      o.c.framesOut++;
      o.c.bytesOut += len;
      this.counts.framesRelayed++;
      this.counts.bytesRelayed += len;
    }
    if (h.flags & F_END) this._release(fl, 'end');
  }

  _close(l) {
    l.closed = true;
    this._leaveFloor(l, 'off');
    l.on = false;
    const set = this.rooms.get(l.name);
    if (set) {
      set.delete(l);
      if (set.size === 0) this.rooms.delete(l.name);
    }
  }
}
