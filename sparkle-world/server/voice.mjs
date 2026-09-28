// Walkie-talkie relay for the Railway server (docs/MULTIPLAYER.md Addendum C).
//
// Voices go live, through this server, only:
//   - within ONE room (a game code), and there only to the players of its game: exactly the
//     members the room's gate lets see the game (rooms.mjs gameOf: the host, i.e. the r:'h'
//     member with the smallest `at`, whose place the room holds while her page reloads, and her
//     own reloaded page, plus the peers in their presence `adm`, i.e. the friends she let in
//     with a tap; no game once the host side says end:1), read from the room at the moment
//     each frame arrives, so a friend who
//     is sent home stops hearing at once; a knocking page, a stranger who guessed the code or a
//     later "pretend host" gets 0 bytes. Peer ids and `by` stamps are made by the server;
//     whatever host the page names in {k:'on'} is not trusted;
//   - to pages that said "voice on" ({t:'v', k:'on'}) AND show it: their room presence has
//     wk:1, the "walkie" badge every player (and the host) sees next to them. Each device
//     needs its own grown-up's OK (the page only says "on" after the grown-up check), to talk
//     AND to hear. A page that did not say "on", or whose badge says "walkie off", receives no
//     voice byte at all and cannot talk, so the badges show exactly who can hear;
//   - one talker at a time per game (the "floor"), at most 15 s per press (by time and by
//     audio length), with per-talker byte and frame rate limits; a friend who heard "busy"
//     gets the next turn before the last talker can press again, and a press the server cut
//     (15 s, silence) waits a little longer;
//   - frames that are not relayed (bad header, no floor, over the rate) still cost the sender a
//     budget; past it the connection is closed (send.kick), like the JSON rate limit;
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
    this.send = send; // { json(obj), binary(bytes) -> false when dropped, kick() }
    this.on = false;
    this.mutes = new Set();
    this.closed = false;
    this.coolUntil = -Infinity;
    this.kicked = false;
    this.bytes = new Bucket(relay.L.BYTES_PER_S, relay.L.BYTES_BURST, now);
    this.frames = new Bucket(relay.L.FRAMES_PER_S, relay.L.FRAMES_BURST, now);
    this.junk = new Bucket(relay.L.JUNK_PER_S, relay.L.JUNK_BURST, now);
    this.junkBytes = new Bucket(relay.L.JUNK_BYTES_PER_S, relay.L.JUNK_BYTES_BURST, now);
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
   * @param {import('./rooms.mjs').RoomRegistry} o.registry  the rooms (gameOf, presence)
   * @param {() => number} [o.now]
   * @param {object} [o.limits]  overrides of W (tests)
   */
  constructor({ registry, now = () => Date.now(), limits = {} } = {}) {
    this.registry = registry;
    this.now = now;
    this.L = { ...W, ...limits };
    this.rooms = new Map(); // room name -> Set<Link>
    this.floors = new Map(); // room name -> floor (one game per room: the gate's)
    this.after = new Map(); // room name -> { by, until, waiting } (who goes next after a press)
    this.timer = null;
    this.counts = {
      links: 0, framesIn: 0, bytesIn: 0, framesRelayed: 0, bytesRelayed: 0,
      grants: 0, busy: 0, denied: 0, bad: 0, rateDropped: 0, noFloor: 0, kicked: 0, notShown: 0,
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
    for (const [key, af] of Array.from(this.after)) if (now >= af.until) this.after.delete(key);
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

  // ---------- membership (read from the room's gate, never stored here) ----------

  _member(name, peer) {
    const room = this.registry.rooms.get(name);
    return room ? room.members.get(peer) || null : null;
  }

  /**
   * Does `peer` show its walkie as on (presence wk:1, the badge everyone sees)? Read from the
   * room at every use, like `adm`; anything else (never set, cleared, reshaped) is "off".
   */
  _shown(name, peer) {
    const m = this._member(name, peer);
    return !!(m && m.state && m.state.wk === 1);
  }

  /**
   * The room's game as its gate sees it (registry.gameOf), or null when nobody hosts there or
   * every page of the host side said the game is over (presence end:1).
   */
  _game(name) {
    const g = this.registry.gameOf(name);
    if (!g.host || !g.side.some((m) => !m.state || m.state.end !== 1)) return null;
    return g;
  }

  /** Is `peer` a player of the game in room `name` (the host side, or let in by it)? */
  _inGame(name, peer, g = this._game(name)) {
    return !!g && g.open.has(peer) && !!this._member(name, peer);
  }

  /**
   * The host's walkie mutes: presence wm = [all, [peers]] of the host side (her reloaded page
   * too: a mute on either page counts).
   */
  _hostMute(g) {
    let all = false;
    const list = [];
    for (const m of g.side) {
      const wm = m.state ? m.state.wm : null;
      if (!Array.isArray(wm)) continue;
      if (wm[0] === 1) all = true;
      if (Array.isArray(wm[1])) list.push(...wm[1]);
    }
    return { all, list };
  }

  /** Why this link may not talk now (null = it may). */
  _talkBlock(l) {
    if (!l.on || !this._shown(l.name, l.peer)) return 'off';
    const g = this._game(l.name);
    if (!this._inGame(l.name, l.peer, g)) return 'group';
    const m = this._hostMute(g);
    if (m.all) return 'quiet';
    if (m.list.includes(l.peer)) return 'muted';
    return null;
  }

  /** The links that hear the game in room `name` now: voice on, badge shown, in the game. */
  _group(name) {
    const out = [];
    const set = this.rooms.get(name);
    const g = set ? this._game(name) : null;
    if (!g) return out;
    for (const o of set) {
      if (o.on && !o.closed && this._shown(o.name, o.peer) && this._inGame(o.name, o.peer, g)) out.push(o);
    }
    return out;
  }

  _json(l, obj) {
    try {
      l.send.json(obj);
    } catch {}
  }

  _tellGroup(l, obj) {
    for (const o of this._group(l.name)) this._json(o, obj);
  }

  // ---------- control ----------

  _control(l, f) {
    const now = this.now();
    switch (f.k) {
      case 'on': {
        // `h` (the host the page follows) is only checked for shape: the room's gate decides
        // which game she is in, never the page
        if (f.h !== undefined && !isPeerId(f.h)) return;
        l.on = true;
        const fl = this.floors.get(l.name);
        const ok = this._inGame(l.name, l.peer);
        this._json(l, { t: 'v', k: 'hi', ok, talk: fl && ok ? fl.link.peer : null });
        return;
      }
      case 'off':
        this._leaveFloor(l, 'off');
        l.on = false;
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
          if (why === 'off' && l.on) this.counts.notShown++; // said "on" but shows "walkie off"
          this._json(l, { t: 'v', k: 'no', why });
          return;
        }
        const key = l.name;
        const fl = this.floors.get(key);
        if (fl && fl.link !== l) {
          this.counts.busy++;
          fl.waiting.add(l.peer); // she goes next (see _release)
          this._json(l, { t: 'v', k: 'busy', by: fl.link.peer });
          return;
        }
        if (fl) {
          this._json(l, { t: 'v', k: 'go' });
          return;
        }
        if (now < l.coolUntil || this._othersFirst(l, key, now)) {
          this.counts.denied++;
          this._json(l, { t: 'v', k: 'no', why: 'wait' });
          return;
        }
        this.after.delete(key);
        this.floors.set(key, { key, link: l, since: now, lastAt: now, frames: 0, samples: 0, bytes: 0, waiting: new Set() });
        this.counts.grants++;
        this._json(l, { t: 'v', k: 'go' });
        this._tellGroup(l, { t: 'v', k: 'talk', by: l.peer });
        return;
      }
      default:
    }
  }

  /**
   * Fairness: right after a press, a friend who heard "busy" during it goes first; the last
   * talker waits (PRIORITY_MS) while such a friend is still a voice-on player of the game.
   */
  _othersFirst(l, key, now) {
    const af = this.after.get(key);
    if (!af || now >= af.until || af.by !== l.peer) return false;
    for (const o of this._group(l.name)) if (o !== l && af.waiting.has(o.peer) && !this._talkBlock(o)) return true;
    return false;
  }

  _leaveFloor(l, why) {
    const fl = this.floors.get(l.name);
    if (fl && fl.link === l) this._release(fl, why);
  }

  /** End a press: tell the talker why (unless she ended it) and everyone that nobody talks. */
  _release(fl, why) {
    if (this.floors.get(fl.key) !== fl) return;
    this.floors.delete(fl.key);
    const l = fl.link;
    const now = this.now();
    // the same talker may press again after a short pause; a longer one after a cut
    l.coolUntil = now + (why === 'cap' || why === 'idle' ? this.L.CUT_COOLDOWN_MS : this.L.COOLDOWN_MS);
    fl.waiting.delete(l.peer);
    if (fl.waiting.size) this.after.set(fl.key, { by: l.peer, until: now + this.L.PRIORITY_MS, waiting: fl.waiting });
    else this.after.delete(fl.key);
    if (why !== 'end') {
      if (this.counts.cuts[why] !== undefined) this.counts.cuts[why]++;
      if (!l.closed) this._json(l, { t: 'v', k: 'cut', why });
    }
    // everyone who heard her learns the press is over
    for (const o of this._group(l.name)) if (o !== l) this._json(o, { t: 'v', k: 'talk', by: null });
    if (!l.closed && l.on) this._json(l, { t: 'v', k: 'talk', by: null });
  }

  // ---------- audio ----------

  _binary(l, buf) {
    const now = this.now();
    const len = buf ? buf.byteLength ?? buf.length : 0;
    const h = readHeader(buf);
    if (!h || len > this.L.MAX_FRAME_BYTES || h.samples > this.L.MAX_FRAME_SAMPLES) {
      this.counts.bad++;
      this._junk(l, now, len);
      return;
    }
    l.c.framesIn++;
    l.c.bytesIn += len;
    this.counts.framesIn++;
    this.counts.bytesIn += len;
    const fl = this.floors.get(l.name);
    if (!l.on || !fl || fl.link !== l) {
      this.counts.noFloor++;
      this._junk(l, now, len);
      return;
    }
    if (!l.frames.take(now) || !l.bytes.take(now, len)) {
      this.counts.rateDropped++;
      this._junk(l, now, len);
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
    // a frame with (almost) no audio is silence: it does not keep the floor
    if (h.samples >= this.L.ACTIVE_SAMPLES) {
      fl.frames++;
      fl.lastAt = now;
    }
    fl.samples += h.samples;
    fl.bytes += len;
    for (const o of this._group(l.name)) {
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

  /** A frame that was not relayed: it costs the sender; past the budget she is disconnected. */
  _junk(l, now, len) {
    if (l.junk.take(now) && l.junkBytes.take(now, len)) return;
    if (l.kicked) return;
    l.kicked = true;
    this.counts.kicked++;
    try {
      l.send.kick?.();
    } catch {}
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
