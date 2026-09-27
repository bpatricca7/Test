// NetSession (docs/MULTIPLAYER.md §6): the session state machine around NetHost / NetGuest.
// open, knock, resume, leave, error mapping -> friendly message codes (§12, protocol MESSAGES).
//
//   idle -> h.opening -> h.live -> h.closing -> idle
//   idle -> g.joining -> g.finding -> g.knocking -> g.loading -> g.live <-> g.waiting
//        (new epoch / hash x2 / rs -> g.loading; kicked / end / host gone / leave / fatal -> g.leaving -> idle)
//
// The game side (src/net/index.js) creates one NetSession with:
//   adapter    GameAdapter (src/net/adapter.js)
//   transport  () => NetTransport (a fresh one per session; see transport.js createTransport)
//   build      the build id (__SW_BUILD__), presence `pv`
//   env        optional game callbacks, all may be async:
//     prepareHost()          save the world + the ".before" backup -> true | {ok:false}
//     saveHost({final})      local save while hosting (every 15 s) and at the end
//     saveLastHost(info)     profile.net.lastHost = {code, at, uids}
//     saveLastJoin(info)     profile.net.lastJoin = {code, hostName, at}
//     exitToTitle()          guest: back to the title (does not save the host world)
//   options    { autoAdmit, compression, trackExec, noTimer }
// Events (session.on(name, fn)): 'state' {state, role, count}, 'message' {code, text, vars},
//   'knock' info, 'knock-gone' {peer}, 'players' {...}, 'reject' {lseq, code, kind},
//   'intent' {kind, lseq, ok}, 'resync' {reason}, 'progress' {have, of}, 'status' {connected},
//   'summary' {} (host session over).

import { C, PROTOCOL, roomNameFor, randomCode, isCode, messageText, cleanText } from './protocol.js';
import { NetError, realClock, listenerSet } from './transport.js';
import { NetHost } from './host.js';
import { NetGuest } from './guest.js';

const ERROR_TO_MESSAGE = {
  unavailable: 'unavailable', no_rooms: 'no_rooms', cannot_host: 'cannot_host', busy: 'busy', full: 'full',
  transient: 'transient', lost: 'transient', fatal: 'fatal', invalid: 'transient', too_big: 'transient',
};

export class NetSession {
  constructor(o = {}) {
    this.adapter = o.adapter;
    this.clock = o.clock || realClock;
    this.rand = o.rand || Math.random;
    this.build = o.build || 'dev';
    this.makeTransport = o.transport;
    this.env = o.env || {};
    this.options = o.options || {};
    this.state = 'idle';
    this.role = null;
    this.code = null;
    this.remoteApplying = false;
    this.noHistory = false;
    this.hostCore = null;
    this.guestCore = null;
    this.transport = null;
    this.lastMessage = null;
    this._fns = new Map();
    this._timer = null;
    this._lastTick = -Infinity;
    this._offs = [];
    this._emoteN = 0;
    this._phraseN = 0;
    this._phraseAt = -Infinity;
    this._epochSeen = null;
  }

  get active() { return this.state !== 'idle'; }
  get isHost() { return this.role === 'host'; }
  get isGuest() { return this.role === 'guest'; }
  get hostFrozen() { return !!this.guestCore?.hostFrozen; }
  get epoch() { return this.hostCore?.epoch ?? this.guestCore?.epoch ?? null; }

  on(name, fn) {
    let set = this._fns.get(name);
    if (!set) this._fns.set(name, (set = listenerSet()));
    return set.add(fn);
  }

  emit(name, payload) {
    this._fns.get(name)?.emit(payload);
  }

  // ---------- hosting ----------

  /**
   * Start hosting the loaded world. opts: { code (resume: the same code), resume, uids }.
   * Resolves true when live; false with a 'message' event otherwise.
   */
  async host({ code = null, resume = false, uids = [] } = {}) {
    if (this.state !== 'idle') return false;
    if (!this.makeTransport) return this._fail('unavailable');
    this._setState('h.opening', 'host');
    let t = null;
    try {
      t = await this.makeTransport();
      const id = await t.identity();
      if (id.canHost === false) return this._fail('cannot_host', t);
      if (typeof this.env.prepareHost === 'function') {
        let ok = false;
        try {
          ok = await this.env.prepareHost();
        } catch (err) {
          console.warn('[net] backup failed', err);
        }
        if (!ok || ok.ok === false) return this._fail('backup_failed', t);
      }
      if (this.state !== 'h.opening') return this._abandon(t);
      let words = null;
      for (let attempt = 0; attempt < C.HOST_PICK_TRIES; attempt++) {
        const pick = attempt === 0 && isCode(code) ? code : randomCode(this.rand);
        await this._openWithRetry(t, roomNameFor(pick));
        const hs = this.clock.now();
        const local = this.adapter.local();
        t.setState({ v: PROTOCOL, pv: this.build, r: 'h', hs, uid: id.uid ?? null, nm: cleanText(local.nm, 12), ep: '' });
        t.flushState();
        await this._sleep(C.HOST_PICK_WAIT);
        if (this.state !== 'h.opening') return this._abandon(t);
        const me = t.selfId();
        const rival = t.peers().some((p) => !p.self && p.state.r === 'h' && p.state.end !== 1 &&
          (!(typeof p.state.hs === 'number') || p.state.hs < hs || (p.state.hs === hs && p.id < me)));
        if (!rival) {
          words = pick;
          break;
        }
        await t.close();
        t = await this.makeTransport();
      }
      if (!words) return this._fail('busy', t);
      const may = await t.probeSend();
      if (!may) return this._fail('cannot_host', t);
      if (this.state !== 'h.opening') return this._abandon(t);
      this.transport = t;
      this.code = words;
      this.hostCore = new NetHost({
        session: this, transport: t, adapter: this.adapter, clock: this.clock, rand: this.rand, build: this.build,
        uid: id.uid ?? null, options: { ...this.options, resumeUids: resume ? uids : [] },
      });
      this.hostCore.start();
      this._watch(t);
      this._offs.push(this.on('players', () => this._saveLastHost()));
      this._saveLastHost();
      this._setState('h.live');
      this._startTicking();
      return true;
    } catch (err) {
      return this._fail(ERROR_TO_MESSAGE[err?.code] || 'transient', t, err);
    }
  }

  _saveLastHost() {
    if (!this.hostCore || typeof this.env.saveLastHost !== 'function') return;
    const uids = [];
    for (const s of this.hostCore.seats) if (s && s.uid) uids.push(s.uid);
    for (const uid of this.hostCore.seatedUids.keys()) if (!uids.includes(uid)) uids.push(uid);
    Promise.resolve()
      .then(() => this.env.saveLastHost({ code: this.code, at: Date.now(), uids: uids.filter((u) => !this.hostCore.banned.has(u)) }))
      .catch(() => {});
  }

  // ---------- joining ----------

  /** Join a friend's world by its 4-picture code. Resolves true once knocking starts. */
  async join(code) {
    if (this.state !== 'idle') return false;
    if (!isCode(code)) return this._fail('no_host');
    if (!this.makeTransport) return this._fail('unavailable');
    this._setState('g.joining', 'guest');
    let t = null;
    try {
      t = await this.makeTransport();
      const id = await t.identity();
      await this._openWithRetry(t, roomNameFor(code));
      if (this.state !== 'g.joining') return this._abandon(t);
      this.transport = t;
      this.code = code.slice();
      this.guestCore = new NetGuest({
        session: this, transport: t, adapter: this.adapter, clock: this.clock, build: this.build,
        uid: id.uid ?? null, options: this.options,
      });
      this._watch(t);
      this._setState('g.finding');
      this._startTicking();
      return true;
    } catch (err) {
      return this._fail(ERROR_TO_MESSAGE[err?.code] || 'transient', t, err);
    }
  }

  /** Called by NetGuest when its phase changes. */
  _guestState(state) {
    if (this.role !== 'guest' || this.state === 'g.leaving' || this.state === 'idle') return;
    if (state === 'g.live' && this.state !== 'g.live' && typeof this.env.saveLastJoin === 'function') {
      Promise.resolve()
        .then(() => this.env.saveLastJoin({ code: this.code, hostName: this.guestCore?.hostName || '', at: Date.now() }))
        .catch(() => {});
    }
    this._setState(state);
  }

  /** Called by NetGuest when the session is over for her (kicked, host gone, ...). */
  _guestEnded(code, vars) {
    this.leave({ message: code, vars });
  }

  // ---------- leaving ----------

  /**
   * Leave the session. Host: presence end:1, a goodbye, a final save, close, summary.
   * Guest: close and back to the title (unless quiet: the game is already going there).
   * opts: { quiet, message, vars }
   */
  async leave({ quiet = false, message = null, vars = null } = {}) {
    if (this.state === 'idle' || this.state === 'h.closing' || this.state === 'g.leaving') return;
    const t = this.transport;
    if (this.role === 'host' && this.hostCore) {
      this._setState('h.closing');
      try {
        this.hostCore.flushNow();
        this.hostCore.stop();
      } catch (err) {
        console.error(err);
      }
      await this._sleep(150); // let "end" and the goodbye go out
      try {
        await this.env.saveHost?.({ final: true });
      } catch (err) {
        console.warn('[net] final save failed', err);
      }
      await this._closeTransport(t);
      this._reset();
      if (message) this._message(message, vars);
      if (!quiet && !message) this.emit('summary', {});
      return;
    }
    if (this.role === 'guest') {
      this._setState('g.leaving');
      this.guestCore?.stop();
      await this._closeTransport(t);
      this._reset();
      if (!quiet) {
        try {
          await this.env.exitToTitle?.();
        } catch (err) {
          console.error(err);
        }
      }
      if (message) this._message(message, vars);
      return;
    }
    await this._closeTransport(t);
    this._reset();
  }

  /**
   * Drop the session at once, with no goodbye (the page is going away: a reload or a new
   * version). The room sees this peer leave; a host's guests wait for her to come back.
   */
  async abandon() {
    if (this.state === 'idle') return;
    const t = this.transport;
    if (this.hostCore) {
      this.hostCore.live = false;
      try {
        this.adapter.detach();
      } catch {}
    }
    this.guestCore?.stop();
    this._reset();
    await this._closeTransport(t);
  }

  // ---------- per-tick and per-frame ----------

  tick() {
    const now = this.clock.now();
    this._lastTick = now;
    try {
      if (this.hostCore && this.state === 'h.live') this.hostCore.tick(now);
      else if (this.guestCore && this.state.startsWith('g.') && this.state !== 'g.leaving' && this.state !== 'g.joining') this.guestCore.tick(now);
    } catch (err) {
      console.error('[net] tick failed', err);
    }
  }

  /** From the game frame: ticks when 100 ms passed. */
  frame() {
    if (this.state === 'idle') return;
    if (this.clock.now() - this._lastTick >= C.TICK) this.tick();
  }

  /** Game._frame end: the guest recorder closes its current run. */
  frameEnd() {
    this.guestCore?.frameEnd();
  }

  _startTicking() {
    if (this.options.noTimer || this._timer !== null) return;
    const loop = () => {
      this._timer = null;
      if (this.state === 'idle') return;
      if (this.clock.now() - this._lastTick >= C.TICK - 10) this.tick();
      this._timer = this.clock.setTimeout(loop, C.TICK);
    };
    this._timer = this.clock.setTimeout(loop, C.TICK);
  }

  // ---------- game-facing helpers (the game.net facade forwards these) ----------

  intent(kind, args) {
    if (!this.guestCore || (this.state !== 'g.live' && this.state !== 'g.waiting')) return 0;
    return this.guestCore.intent(kind, args);
  }

  mayEdit(tool) {
    if (tool === 'hand') return true;
    if (this.role !== 'guest') return true;
    if (this.state !== 'g.live' && this.state !== 'g.waiting') return false;
    return this.guestCore.rules.build === 1;
  }

  players() {
    if (this.hostCore) return this.hostCore.players();
    if (this.guestCore) return this.guestCore.players();
    return [];
  }

  /** Emote for others to see (presence em [name, nonce]). */
  emote(name) {
    const owner = this.hostCore || this.guestCore;
    if (!owner || typeof name !== 'string') return;
    owner.emote = [name.slice(0, 16), ++this._emoteN];
  }

  /** Quick phrase id 0..15 (presence ph [id, nonce]); at most one per 2 s. */
  say(id) {
    const owner = this.hostCore || this.guestCore;
    if (!owner || !Number.isInteger(id) || id < 0 || id > 15) return false;
    const now = this.clock.now();
    if (now - this._phraseAt < C.PHRASE_MIN_INTERVAL) return false;
    this._phraseAt = now;
    owner.phrase = [id, ++this._phraseN];
    return true;
  }

  setHidden(hidden) {
    this.hostCore?.setHidden(hidden);
  }

  /** Guest: outbox entries still waiting for the host (the HUD shows "sending..." above 20). */
  sending() {
    const g = this.guestCore;
    return g ? g.outbox.length + (g.run ? 1 : 0) : 0;
  }

  /** debug.net.admitAll: let every knock in without a card. */
  setAutoAdmit(on) {
    this.options = { ...this.options, autoAdmit: !!on };
    if (this.hostCore) this.hostCore.autoAdmit = !!on;
  }

  admit(peer) { return this.hostCore?.admit(peer) ?? false; }
  deny(peer) { this.hostCore?.deny(peer); }
  kick(peer) { this.hostCore?.kick(peer); }
  undoSeat(seat) { return this.hostCore?.undoSeat(seat) ?? 0; }
  setRules(r) { this.hostCore?.setRules(r); }
  get rules() { return this.hostCore ? { ...this.hostCore.rules } : this.guestCore ? this.guestCore.rules : { build: 1, mine: 0 }; }
  knocks() { return this.hostCore?.knockList() ?? []; }

  hashes() {
    return this.hostCore?.hashes() ?? this.guestCore?.hashes() ?? null;
  }

  stats() {
    return {
      state: this.state, role: this.role, code: this.code, transport: this.transport?.stats?.() || null,
      host: this.hostCore?.debug() || null, guest: this.guestCore?.debug() || null,
      resyncs: this.guestCore?.stats.resyncs ?? 0,
    };
  }

  // ---------- internals ----------

  _setState(state, role) {
    if (role !== undefined) this.role = role;
    if (this.state === state) return;
    this.state = state;
    this.emit('state', { state, role: this.role, count: this.state === 'idle' ? 0 : this.players().length });
  }

  _message(code, vars = {}) {
    const text = messageText(code, vars || {});
    this.lastMessage = { code, text, vars };
    this.emit('message', { code, text, vars });
  }

  async _fail(code, t, err) {
    if (err && !(err instanceof NetError)) console.error('[net]', err);
    await this._closeTransport(t);
    this._reset();
    this._message(code);
    return false;
  }

  async _abandon(t) {
    await this._closeTransport(t);
    return false;
  }

  async _closeTransport(t) {
    if (!t) return;
    try {
      await t.close();
    } catch {}
  }

  _reset() {
    if (this._timer !== null) this.clock.clearTimeout(this._timer);
    this._timer = null;
    for (const off of this._offs) off();
    this._offs = [];
    this.hostCore = null;
    this.guestCore = null;
    this.transport = null;
    this.code = null;
    this.remoteApplying = false;
    this.noHistory = false;
    const was = this.state;
    this.state = 'idle';
    this.role = null;
    if (was !== 'idle') this.emit('state', { state: 'idle', role: null, count: 0 });
  }

  _watch(t) {
    this._offs.push(
      t.onStatus((s) => {
        if (s.fatal) {
          this.leave({ message: 'fatal', quiet: this.role === 'host' });
          return;
        }
        this.emit('status', { connected: s.connected });
      }),
    );
  }

  /** open() with the §4.3 retries: busy once after 5 s; transient after 1, 2, 4, 8 s. */
  async _openWithRetry(t, room) {
    const waits = [1000, 2000, 4000, 8000];
    let busyTried = false;
    for (let k = 0; ; k++) {
      try {
        return await t.open(room);
      } catch (err) {
        const code = err?.code;
        if (code === 'busy' && !busyTried) {
          busyTried = true;
          await this._sleep(5000);
          continue;
        }
        if ((code === 'transient' || code === 'lost') && k < waits.length) {
          await this._sleep(waits[k]);
          continue;
        }
        throw err instanceof NetError ? err : new NetError('transient', String(err?.message || err));
      }
    }
  }

  _sleep(ms) {
    return new Promise((resolve) => this.clock.setTimeout(resolve, ms));
  }
}
