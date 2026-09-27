// NetGuest (docs/MULTIPLAYER.md §5.6-§5.11, §6 guest): finds and follows the host, knocks,
// loads the snapshot, applies batches in order (buffer, gap detection, catch-up fixes),
// records her own changes into the presence outbox, keeps her predictions (pend maps) until
// the host's answer arrives, checks the hash safety net, and follows time and weather.
//
// It reaches the network only through NetTransport and the game only through GameAdapter.

import {
  C, PROTOCOL, NO, messageText, parseBatch, parseBulk, parseCtl, parsePayload, readHostState, presenceSafe, cleanText,
} from './protocol.js';
import { packB, blockMix, blockHashOf, unframeSnapshot, canDeflate, unpackCells, decodeRegion } from './codec.js';
import { jsonBytes } from './transport.js';
import { avatarFields } from './host.js';

const WHY_TO_MESSAGE = { [NO.DENY]: 'denied', [NO.KICK]: 'kicked', [NO.FULL]: 'full', [NO.VERSION]: 'version' };

export class NetGuest {
  /**
   * @param {object} ctx  { session, transport, adapter, clock, build, uid, options: { compression } }
   */
  constructor(ctx) {
    this.session = ctx.session;
    this.t = ctx.transport;
    this.a = ctx.adapter;
    this.clock = ctx.clock;
    this.build = ctx.build;
    this.uid = ctx.uid ?? null;
    const o = ctx.options || {};
    this.zc = (o.compression === undefined ? true : !!o.compression) && canDeflate() ? 1 : 0;

    this.phase = 'finding'; // finding | knocking | loading | live | waiting | ended
    this.findStart = this.clock.now();
    this.knockStart = 0;
    this.hostPeer = null;
    this.hostUid = null;
    this.hostName = '';
    this.epoch = null;
    this.seat = 0;
    this.attached = 0; // the seat the adapter is attached with (0 = not attached)
    this.host = null; // last parsed host presence
    this.hostEntry = null;
    this.hostMissingSince = null;

    // batches
    this.ap = 0;
    this.hd = 0;
    this.buffer = new Map();
    this.nd = null;
    this.gapSince = null;
    this.fixParts = new Map();

    // snapshot
    this.rx = null;
    this.asm = null;
    this.finishing = false;
    this.snapTries = 0;
    this.snapProgressAt = 0;
    this.resyncing = false;

    // predictions
    this.pendCells = new Map();
    this.pendEnts = new Map();
    this.pendPlants = new Map();
    this.pendByLseq = new Map(); // lseq -> { c:[], e:[], p:[] }
    this.shadowCells = new Map();
    this.shadowEnts = new Map();
    this.shadowPlants = new Map();
    this.ackedL = 0;
    this.applying = false;

    // outbox
    this.lseq = 0;
    this.outbox = []; // { lseq, arr, bytes }
    this.run = null; // open 'b' run: { lseq, cells: Map i -> [before, after] }
    this.intents = new Map(); // lseq -> kind ('pf' | 'pu' | 'z')
    this.rejected = new Set();
    this.lastRejectToast = -Infinity;
    this.obKey = '';
    this.admKey = '';

    // environment following
    this.blockHash = 0;
    this.hashMiss = 0;
    this.hashLastS = -1;
    this.tmText = '';
    this.tmAt = 0;
    this.wx = null;
    this.samplesText = '';
    this.presenceText = new Map();
    this.lastPos = null;
    this.lastLookAt = -Infinity;
    this.emote = null;
    this.phrase = null;
    this.stats = { batches: 0, fixes: 0, snapshots: 0, resyncs: 0, resyncHash: 0, resyncRs: 0, epochs: 0, rejects: 0, hashChecks: 0, hashMismatches: 0, dropped: 0 };
    this.epochBase = 0;

    this.hooks = {
      cell: (i, prev, id) => this._hookCell(i, prev, id),
      ent: (kind, uid, before, after) => this._hookEnt(kind, uid, before, after),
      plant: (kind, i, before, after) => this._hookPlant(kind, i, before, after),
      actor: () => {},
    };
    this.offs = [
      this.t.on('op', (d, from) => this._onOp(d, from)),
      this.t.on('bulk', (d, from) => this._onBulk(d, from)),
      this.t.on('ctl', (d, from) => this._onCtl(d, from)),
    ];
  }

  get live() {
    return this.phase === 'live' || this.phase === 'waiting';
  }

  /** Stop listening; hooks come off. */
  stop() {
    this.phase = 'ended';
    for (const off of this.offs) off();
    this.offs = [];
    if (this.attached) {
      this.attached = 0;
      try {
        this.a.detach();
      } catch {}
    }
  }

  // ---------- the tick (§6 guest, in this order) ----------

  tick(now = this.clock.now()) {
    if (this.phase === 'ended') return;
    if (this.phase === 'finding') return this._find(now);
    this._readHost(now);
    if (this.phase === 'ended') return;
    if (this.phase === 'knocking') return this._composePresence(now);
    this._drain();
    this._gapCheck(now);
    if (this.phase === 'loading' || this.rx) this._loadWatch(now);
    if (this.live) this._follow(now);
    this._hashCheck();
    this._composePresence(now);
  }

  _find(now) {
    const hosts = this.t.peers().filter((p) => !p.self && p.state.r === 'h' && p.state.end !== 1);
    const same = hosts.filter((p) => p.state.v === PROTOCOL && p.state.pv === this.build);
    // a host still picking her code has no epoch yet: wait for it
    const ok = same.filter((p) => typeof p.state.ep === 'string' && p.state.ep !== '');
    if (ok.length === 0) {
      if (hosts.length > 0 && same.length === 0 && now - this.findStart > 1500) return this._end('version');
      if (now - this.findStart > C.FIND_HOST) return this._end('no_host');
      return;
    }
    ok.sort((a, b) => (a.state.hs || 0) - (b.state.hs || 0) || (a.id < b.id ? -1 : 1));
    this._knock(ok[0], now);
  }

  _knock(p, now) {
    this.hostPeer = p.id;
    this.hostUid = p.uid;
    this.hostName = typeof p.state.nm === 'string' ? p.state.nm : '';
    this.epoch = p.state.ep;
    this.phase = 'knocking';
    this.knockStart = now;
    this.hostMissingSince = null;
    const local = this.a.local();
    this.t.setState({
      v: PROTOCOL, pv: this.build, r: 'g', uid: this.uid, nm: cleanText(local.nm, 12), lk: cleanText(local.lk, 200),
      kn: 1, zc: this.zc, ep: this.epoch, ob: null, nd: null, rx: null, hs: null, hd: null, end: null,
    });
    this.t.flushState();
    this.session._guestState('g.knocking');
  }

  _end(code) {
    if (this.phase === 'ended') return;
    this.phase = 'ended';
    this.session._guestEnded(code, { host: this.hostName });
  }

  // ---------- host presence ----------

  _readHost(now) {
    let entry = null;
    for (const p of this.t.peers()) if (p.id === this.hostPeer) entry = p;
    const hs = entry ? readHostState(entry.state) : null;
    if (!hs) {
      // host peer gone: a reload shows up as a new peer with the same uid and a new epoch
      const again = this.hostUid
        ? this.t.peers().find((p) => !p.self && p.uid === this.hostUid && p.state.r === 'h' && p.state.end !== 1 && p.state.ep !== this.epoch)
        : null;
      if (again && again.state.v === PROTOCOL && again.state.pv === this.build) return this._newEpoch(again, now);
      if (this.hostMissingSince === null) this.hostMissingSince = now;
      if (this.phase === 'live') this._setPhase('waiting');
      if (now - this.hostMissingSince > (this.phase === 'knocking' || this.phase === 'loading' ? C.FIND_HOST * 2 : C.HOST_AWAY_GRACE)) this._end('host_gone');
      return;
    }
    this.hostMissingSince = null;
    if (this.hostUid) {
      // her page reloaded while the old one is still fading out of the room: follow the new one
      for (const p of this.t.peers()) {
        if (p.id !== entry.id && !p.self && p.uid === this.hostUid && p.state.r === 'h' && p.state.end !== 1 &&
          typeof p.state.ep === 'string' && p.state.ep && p.state.ep !== this.epoch && (p.state.hs || 0) > hs.hs &&
          p.state.v === PROTOCOL && p.state.pv === this.build) return this._newEpoch(p, now);
      }
    }
    this.hostEntry = entry;
    this.host = hs;
    if (hs.nm) this.hostName = hs.nm;
    if (hs.end) return this._end('ended');
    if (hs.ep !== this.epoch) return this._newEpoch(entry, now);
    const me = this.t.selfId();
    if (this.phase === 'knocking') {
      const no = hs.no.find((x) => x[0] === me);
      if (no) return this._end(WHY_TO_MESSAGE[no[1]] || 'denied');
      const adm = hs.adm.find((x) => x[0] === me);
      if (adm) return this._admitted(adm[1], now);
      if (now - this.knockStart > C.KNOCK_GIVEUP) return this._end('denied');
      return;
    }
    const no = hs.no.find((x) => x[0] === me);
    if (no) return this._end(WHY_TO_MESSAGE[no[1]] || 'kicked');
    const adm = hs.adm.find((x) => x[0] === me);
    if (!adm) {
      // the seat went away (host held it past 60 s): knock again
      return this._newEpoch(entry, now, true);
    }
    this.hd = Math.max(this.hd, hs.hd);
    const admKey = JSON.stringify(hs.adm);
    if (admKey !== this.admKey) {
      this.admKey = admKey;
      this.session.emit('players', { reason: 'roster', adm: hs.adm });
    }
    // fast outbox trim by the host's processed-through for my seat
    for (const [seat, L] of hs.ak) if (seat === this.seat) this._trim(L);
    if (this.live) {
      const away = hs.zz === 1;
      if (away && this.phase === 'live') this._setPhase('waiting');
      else if (!away && this.phase === 'waiting') this._setPhase('live');
    }
    if (hs.rs.includes(me) && !this.rx && this.live) this._resync('rs');
  }

  _newEpoch(entry, now, sameEpoch = false) {
    // host restarted (new epoch): her unacked edits are dropped; knock again
    for (const [lseq, kind] of this.intents) this._resolveIntent(kind, lseq, false);
    this.intents.clear();
    this.outbox = [];
    this.run = null;
    this._clearPredictions();
    this.buffer.clear();
    this.fixParts.clear();
    this.asm = null;
    this.rx = null;
    this.nd = null;
    this.gapSince = null;
    this.ap = 0;
    this.hd = 0;
    this.seat = 0;
    this.hashMiss = 0;
    this.epochBase = this.lseq; // entries up to here were dropped with the old epoch
    if (!sameEpoch) this.stats.epochs++;
    this._knock(entry, now);
  }

  _admitted(seat, now) {
    this.seat = seat;
    if (this.attached !== seat) {
      if (this.attached) this.a.detach();
      this.a.attach('guest', this.hooks, { seat });
      this.attached = seat;
    }
    this.rx = { id: 0, h: 0, m: '' };
    this.asm = null;
    this.snapProgressAt = now;
    this.snapTries = 0;
    this.phase = 'loading';
    this.t.setState({ kn: null, rx: this.rx });
    this.t.flushState();
    this.session._guestState('g.loading');
  }

  _setPhase(phase) {
    if (this.phase === phase) return;
    this.phase = phase;
    this.session._guestState(phase === 'live' ? 'g.live' : phase === 'waiting' ? 'g.waiting' : 'g.' + phase);
  }

  // ---------- batches (§5.7) ----------

  _onOp(data, from) {
    if (from !== this.hostPeer || !this.epoch || this.phase === 'ended') return;
    const b = parseBatch(data);
    if (!b || b.e !== this.epoch) return;
    if (b.s <= this.ap || this.buffer.has(b.s)) return;
    if (b.s > this.ap + C.BUFFER_MAX) {
      this.stats.dropped++;
      return;
    }
    this.buffer.set(b.s, b);
    if (b.s > this.hd) this.hd = b.s;
    this._drain();
  }

  _drain() {
    if (this.rx || !this.live || this.applyingSnapshot) return;
    let moved = false;
    for (;;) {
      const b = this.buffer.get(this.ap + 1);
      if (!b) break;
      this.buffer.delete(b.s);
      this._applyPayload(b);
      this.ap = b.s;
      this.stats.batches++;
      moved = true;
    }
    if (moved) {
      for (const s of this.buffer.keys()) if (s <= this.ap) this.buffer.delete(s);
      this.gapSince = this.hd > this.ap || this.buffer.size > 0 ? this.clock.now() : null;
    }
  }

  _gapCheck(now) {
    if (this.rx || !this.live) return;
    const behind = this.hd > this.ap || this.buffer.size > 0;
    if (!behind) {
      this.gapSince = null;
      if (this.nd !== null) {
        this.nd = null;
        this.t.setState({ nd: null });
      }
      return;
    }
    if (this.gapSince === null) this.gapSince = now;
    else if (now - this.gapSince >= C.GAP_WAIT && this.nd !== this.ap) {
      this.nd = this.ap;
      this.t.setState({ nd: this.ap });
      this.t.flushState();
    }
  }

  _onBulk(data, from) {
    if (from !== this.hostPeer || !this.epoch || this.phase === 'ended') return;
    const m = parseBulk(data);
    if (!m || m.e !== this.epoch) return;
    if (m.k === 's') this._onChunk(m);
    else if (m.to === this.t.selfId()) this._onFixPart(m);
  }

  _onFixPart(m) {
    if (this.rx || !this.live) return;
    if (m.upto <= this.ap) return;
    let f = this.fixParts.get(m.id);
    if (!f) {
      if (this.fixParts.size >= 8) this.fixParts.delete(this.fixParts.keys().next().value);
      f = { from: m.from, upto: m.upto, n: m.n, parts: new Array(m.n), got: 0 };
      this.fixParts.set(m.id, f);
    }
    if (m.n !== f.n || f.parts[m.i] !== undefined) return;
    f.parts[m.i] = m.d;
    f.got++;
    if (f.got < f.n) return;
    this.fixParts.delete(m.id);
    if (f.from > this.ap || f.upto <= this.ap) return;
    let p = null;
    try {
      p = parsePayload(JSON.parse(f.parts.join('')));
    } catch {
      p = null;
    }
    if (!p) return;
    this._applyPayload(p);
    this.ap = f.upto;
    if (f.upto > this.hd) this.hd = f.upto;
    this.stats.fixes++;
    for (const s of this.buffer.keys()) if (s <= this.ap) this.buffer.delete(s);
    this._drain();
    this.gapSince = this.hd > this.ap || this.buffer.size > 0 ? this.clock.now() : null;
    if (this.ap >= this.hd && this.buffer.size === 0 && this.nd !== null) {
      this.nd = null;
      this.t.setState({ nd: null });
    }
  }

  /**
   * Apply one batch or fix: rejections first, then acks (clearing predictions whose answer
   * is here), then values, skipping keys she is still predicting (kept as shadows).
   */
  _applyPayload(p) {
    if (p.r) for (const [seat, lseq, code] of p.r) if (seat === this.seat) this._rejectedEntry(lseq, code);
    const restore = { cells: null, ents: null, plants: null };
    if (p.a) for (const [seat, L] of p.a) if (seat === this.seat) this._ackTo(L, restore);
    const sz = this.a.size();
    let cells = [];
    if (p.c) {
      const tmp = unpackCells(p.c, []);
      if (tmp) this._filterCells(tmp, cells, restore);
    }
    if (p.g) {
      for (const r of p.g) {
        const tmp = [];
        if (decodeRegion(r, sz.sx, sz.sz, tmp) >= 0) this._filterCells(tmp, cells, restore);
      }
    }
    let X = null, E = null, P = null;
    if (p.X) for (const uid of p.X) {
      if (this.pendEnts.has(uid)) this.shadowEnts.set(uid, null);
      else {
        (X ||= []).push(uid);
        restore.ents?.delete(uid);
      }
    }
    if (p.E) for (const rec of p.E) {
      if (this.pendEnts.has(rec[0])) this.shadowEnts.set(rec[0], rec);
      else {
        (E ||= []).push(rec);
        restore.ents?.delete(rec[0]);
      }
    }
    if (p.P) for (const rec of p.P) {
      if (this.pendPlants.has(rec[0])) this.shadowPlants.set(rec[0], rec);
      else {
        (P ||= []).push(rec);
        restore.plants?.delete(rec[0]);
      }
    }
    // confirmed values of keys whose prediction just ended and that this payload did not carry
    if (restore.cells && restore.cells.size) {
      const pre = [];
      for (const [i, id] of restore.cells) pre.push(i, id);
      for (let k = 0; k < cells.length; k++) pre.push(cells[k]);
      cells = pre;
    }
    if (restore.ents) for (const [uid, rec] of restore.ents) {
      if (rec) (E ||= []).push(rec);
      else (X ||= []).push(uid);
    }
    if (restore.plants) for (const [, rec] of restore.plants) (P ||= []).push(rec);
    const K = p.K && p.K.length ? p.K : null;
    if (cells.length === 0 && !X && !E && !P && !K) return;
    const payload = {};
    if (X) payload.X = X;
    if (cells.length) payload.cells = cells;
    if (E) payload.E = E;
    if (P) payload.P = P;
    if (K) payload.K = K;
    this.applying = true;
    this.session.remoteApplying = true;
    try {
      this.a.applyPayload(payload);
    } catch (err) {
      console.error('[net] applyPayload failed', err);
    } finally {
      this.applying = false;
      this.session.remoteApplying = false;
    }
  }

  _filterCells(tmp, out, restore) {
    for (let k = 0; k < tmp.length; k += 2) {
      const i = tmp[k], id = tmp[k + 1];
      if (this.pendCells.has(i)) this.shadowCells.set(i, id);
      else {
        out.push(i, id);
        restore.cells?.delete(i);
      }
    }
  }

  _ackTo(L, restore) {
    if (L <= this.ackedL || L > this.lseq) return; // stale, or not mine (a new page in this seat)
    for (const [lseq, keys] of this.pendByLseq) {
      if (lseq > L) break;
      this.pendByLseq.delete(lseq);
      for (const i of keys.c) {
        if (this.pendCells.get(i) !== lseq) continue;
        this.pendCells.delete(i);
        if (this.shadowCells.has(i)) {
          (restore.cells ||= new Map()).set(i, this.shadowCells.get(i));
          this.shadowCells.delete(i);
        }
      }
      for (const uid of keys.e) {
        if (this.pendEnts.get(uid) !== lseq) continue;
        this.pendEnts.delete(uid);
        if (this.shadowEnts.has(uid)) {
          (restore.ents ||= new Map()).set(uid, this.shadowEnts.get(uid));
          this.shadowEnts.delete(uid);
        }
      }
      for (const i of keys.p) {
        if (this.pendPlants.get(i) !== lseq) continue;
        this.pendPlants.delete(i);
        if (this.shadowPlants.has(i)) {
          (restore.plants ||= new Map()).set(i, this.shadowPlants.get(i));
          this.shadowPlants.delete(i);
        }
      }
    }
    for (const [lseq, kind] of this.intents) {
      if (lseq > L) continue;
      this.intents.delete(lseq);
      this._resolveIntent(kind, lseq, !this.rejected.has(lseq));
    }
    this.ackedL = L;
    this._trim(L);
    if (this.rejected.size > 512) for (const l of this.rejected) if (l < L - 256) this.rejected.delete(l);
  }

  _resolveIntent(kind, lseq, ok) {
    try {
      this.a.resolveIntent?.(kind, lseq, ok);
    } catch (err) {
      console.error(err);
    }
    this.session.emit('intent', { kind, lseq, ok });
  }

  _rejectedEntry(lseq, code) {
    if (lseq > this.lseq || this.rejected.has(lseq)) return;
    this.rejected.add(lseq);
    this.stats.rejects++;
    const kind = this.intents.get(lseq);
    this.session.emit('reject', { lseq, code, kind: kind || null });
    const now = this.clock.now();
    if (now - this.lastRejectToast < C.REJECT_TOAST_GAP) return;
    this.lastRejectToast = now;
    const text = kind === 'pf' ? messageText('prefab_fizzled', { host: this.hostName }) : messageText('reject_' + code, { host: this.hostName });
    if (text) this.a.toast(text, 'nope');
  }

  // ---------- snapshot (§5.8) ----------

  _onChunk(m) {
    if (!this.rx) return;
    let a = this.asm;
    if (!a || a.id !== m.id) {
      if (a && m.s0 < a.s0) return; // an older snapshot than the one being assembled
      a = this.asm = { id: m.id, s0: m.s0, n: m.n, z: m.z, c: m.c, parts: new Array(m.n), got: 0 };
    }
    if (m.n !== a.n || a.parts[m.i] !== undefined) return;
    a.parts[m.i] = m.d;
    a.got++;
    this.snapProgressAt = this.clock.now();
    let miss = '';
    let count = 0;
    for (let k = 0; k < a.n && count < 32; k++) {
      if (a.parts[k] === undefined) {
        miss += (count ? ',' : '') + k;
        count++;
      }
    }
    this.rx = { id: a.id, h: a.got, m: miss };
    this.session.emit('progress', { have: a.got, of: a.n });
    if (a.got === a.n && !this.finishing) this._finishSnapshot(a);
  }

  async _finishSnapshot(a) {
    this.finishing = true;
    const epoch = this.epoch;
    try {
      const { json, rle } = await unframeSnapshot(a.parts, a.z, a.c);
      if (this.phase === 'ended' || this.epoch !== epoch || this.asm !== a) return;
      this.applyingSnapshot = true;
      this.applying = true;
      this.session.remoteApplying = true;
      let ok = false;
      try {
        ok = await this.a.enterSnapshot(json, rle);
      } finally {
        this.applying = false;
        this.session.remoteApplying = false;
        this.applyingSnapshot = false;
      }
      if (!ok) throw new Error('enter');
      if (this.phase === 'ended' || this.epoch !== epoch) return;
      const { sx, sy, sz } = this.a.size();
      this.blockHash = blockHashOf((i) => this.a.getCell(i), sx * sy * sz);
      this._clearPredictions();
      this.ap = a.s0;
      if (this.hd < a.s0) this.hd = a.s0;
      this.asm = null;
      this.rx = null;
      this.nd = null;
      this.gapSince = null;
      this.hashMiss = 0;
      this.snapTries = 0;
      this.stats.snapshots++;
      this.t.setState({ rx: null, nd: null });
      this.t.flushState();
      for (const s of this.buffer.keys()) if (s <= this.ap) this.buffer.delete(s);
      const first = this.phase === 'loading';
      if (first || this.resyncing) {
        this.resyncing = false;
        this._setPhase(this.host?.zz === 1 ? 'waiting' : 'live');
      }
      this._drain();
      if (first) {
        const text = messageText('you_joined', { host: this.hostName });
        if (text) this.a.toast(text, 'friends');
      }
    } catch (err) {
      if (this.phase === 'ended' || this.epoch !== epoch) return;
      this._snapshotFailed(String(err?.message || err));
    } finally {
      this.finishing = false;
    }
  }

  _snapshotFailed(why) {
    this.snapTries++;
    this.stats.snapFailures = (this.stats.snapFailures || 0) + 1;
    if (this.snapTries >= C.SNAP_TRIES) {
      this.session.emit('snapshot-failed', { why });
      return this._end('snapshot_failed');
    }
    this.asm = null;
    this.rx = { id: 0, h: 0, m: '' };
    this.snapProgressAt = this.clock.now();
  }

  _loadWatch(now) {
    if (this.finishing) return;
    if (now - this.snapProgressAt > C.SNAP_STALL) this._snapshotFailed('stall');
  }

  /** Take a new snapshot (same epoch): keeps her outbox; predictions end with it. */
  _resync(reason) {
    if (this.rx) return;
    this.stats.resyncs++;
    if (reason === 'hash') this.stats.resyncHash++;
    else this.stats.resyncRs++;
    this.session.emit('resync', { reason });
    this.resyncing = true;
    this.rx = { id: 0, h: 0, m: '' };
    this.asm = null;
    this.fixParts.clear();
    this.nd = null;
    this.snapProgressAt = this.clock.now();
    this.snapTries = 0;
    this.t.setState({ rx: this.rx, nd: null });
    this.t.flushState();
    this.phase = 'loading';
    this.session._guestState('g.loading', { resync: reason });
  }

  _clearPredictions() {
    this.pendCells.clear();
    this.pendEnts.clear();
    this.pendPlants.clear();
    this.pendByLseq.clear();
    this.shadowCells.clear();
    this.shadowEnts.clear();
    this.shadowPlants.clear();
    if (this.run) this.run = null;
  }

  // ---------- safety net (§5.11) ----------

  _hashCheck() {
    const hs = this.host;
    if (!hs || !hs.hh || !this.live || this.rx) return;
    const [s, b, e, p] = hs.hh;
    if (s !== this.ap || s === this.hashLastS) return;
    if (this.pendCells.size + this.pendEnts.size + this.pendPlants.size > 0 || this.buffer.size > 0 || this.run) return;
    this.hashLastS = s;
    this.stats.hashChecks++;
    const mine = [this.blockHash >>> 0, this.a.entityHash() >>> 0, this.a.plantHash() >>> 0];
    if (mine[0] === b >>> 0 && mine[1] === e >>> 0 && mine[2] === p >>> 0) {
      this.hashMiss = 0;
      return;
    }
    this.stats.hashMismatches++;
    this.hashMiss++;
    if (this.hashMiss >= 2) {
      this.hashMiss = 0;
      this._resync('hash');
    }
  }

  /** Current [block, entity, plant] hashes. */
  hashes() {
    return [this.blockHash >>> 0, this.a.entityHash() >>> 0, this.a.plantHash() >>> 0];
  }

  // ---------- time, weather, pets ----------

  _follow(now) {
    const hs = this.host;
    const e = this.hostEntry;
    if (!hs || !e) return;
    if (hs.tm) {
      const text = JSON.stringify(hs.tm);
      if (text !== this.tmText) {
        this.tmText = text;
        this.tmAt = now;
      }
      // her own sleep (intent 'z') already skipped her clock to morning: the host's clock from
      // before her wish must not pull her back into the night. The host's answer (the ack) comes
      // in the same presence as the host's new clock: morning for everyone, or back to night
      // when the host said no.
      if (!this._sleepPending()) this.a.applyTime(hs.tm, now - this.tmAt);
    }
    if (hs.wx && hs.wx !== this.wx) {
      this.wx = hs.wx;
      this.a.applyWeather(hs.wx);
    }
    if (typeof this.a.applySamples === 'function' && (hs.pt || hs.nx)) {
      const text = JSON.stringify([hs.pt, hs.nx]);
      if (text !== this.samplesText) {
        this.samplesText = text;
        this.a.applySamples({ pt: hs.pt, nx: hs.nx }, now - e.updatedAt);
      }
    }
  }

  /** Is her sleep (intent 'z') still waiting for the host's answer? */
  _sleepPending() {
    for (const kind of this.intents.values()) if (kind === 'z') return true;
    return false;
  }

  get hostFrozen() {
    return !!(this.host?.tm && this.host.tm[2]);
  }

  get rules() {
    return this.host ? { build: this.host.ru[0], mine: this.host.ru[1] } : { build: 1, mine: 0 };
  }

  // ---------- recording (§5.6) ----------

  _recording() {
    return this.live && !this.rx && !this.applying && !this.session.remoteApplying && !(this.a.inSystems?.());
  }

  _pend(kind, key, lseq) {
    let keys = this.pendByLseq.get(lseq);
    if (!keys) this.pendByLseq.set(lseq, (keys = { c: [], e: [], p: [] }));
    if (kind === 'c') {
      this.pendCells.set(key, lseq);
      keys.c.push(key);
    } else if (kind === 'e') {
      this.pendEnts.set(key, lseq);
      keys.e.push(key);
    } else {
      this.pendPlants.set(key, lseq);
      keys.p.push(key);
    }
  }

  _hookCell(i, prev, id) {
    if (prev !== id) {
      if (prev !== 0) this.blockHash = (this.blockHash - blockMix(i, prev)) >>> 0;
      if (id !== 0) this.blockHash = (this.blockHash + blockMix(i, id)) >>> 0;
    }
    if (!this._recording()) return;
    let run = this.run;
    if (run && !run.cells.has(i) && run.cells.size >= C.CELLS_PER_B) {
      this._closeRun();
      run = null;
    }
    if (!run) run = this.run = { lseq: ++this.lseq, cells: new Map() };
    const c = run.cells.get(i);
    if (c) c[1] = id;
    else run.cells.set(i, [prev, id]);
    if (this.pendCells.get(i) !== run.lseq) this._pend('c', i, run.lseq);
  }

  _hookEnt(kind, uid, before, after) {
    if (!this._recording()) return;
    this._closeRun();
    let arr;
    if (kind === 'add') {
      const rec = after;
      arr = ['e+', rec[0], rec[1], rec[2], rec[3], rec[4], rec[5], rec[6] || 0, rec[7] || 0];
      // oversized or presence-unsafe data: send none (the host's record, with its defaults, comes back)
      if (jsonBytes(arr) > C.ENTRY_BYTES - 16 || !presenceSafe(arr[8])) arr[8] = 0;
      if (!presenceSafe(arr[7])) arr[7] = 0;
    } else if (kind === 'del') arr = ['e-', uid];
    else if (kind === 'rot') arr = ['er', uid, before, after];
    else if (kind === 'data') {
      const patch = after && typeof after === 'object' ? after : {};
      arr = ['ed', uid, jsonBytes(patch) > C.ENTRY_BYTES - 32 || !presenceSafe(patch) ? {} : patch];
    } else return;
    const lseq = this._push(arr);
    this._pend('e', uid, lseq);
  }

  _hookPlant(kind, i, before, after) {
    if (!this._recording()) return;
    let op;
    if (kind === 'add') op = 'p+';
    else if (kind === 'del') op = 'p-';
    else if (kind === 'harvest') op = 'ph';
    else return; // growth runs only on the host
    const crop = (after || before || [])[0];
    if (typeof crop !== 'string' || !presenceSafe(crop)) return;
    this._closeRun();
    const [x, y, z] = this.a.coords(i);
    const lseq = this._push([op, x, y, z, crop]);
    this._pend('p', i, lseq);
  }

  /** Intent entry ('pf' | 'pu' | 'z'); returns its lseq (0 when not live). */
  intent(kind, args = []) {
    if (!this.live) return 0;
    this._closeRun();
    const lseq = this._push([kind, ...args]);
    this.intents.set(lseq, kind);
    return lseq;
  }

  _push(arr) {
    const lseq = ++this.lseq;
    const entry = [lseq, ...arr];
    this.outbox.push({ lseq, arr: entry, bytes: jsonBytes(entry) });
    return lseq;
  }

  /** Close the open 'b' run into an outbox entry (also at frameEnd). */
  _closeRun() {
    const run = this.run;
    if (!run) return;
    this.run = null;
    const triples = [];
    for (const [i, [b, a]] of run.cells) if (b !== a) triples.push(i, b, a);
    // an empty run still goes out: its lseq may be pending on some keys
    const entry = [run.lseq, 'b', packB(triples)];
    this.outbox.push({ lseq: run.lseq, arr: entry, bytes: jsonBytes(entry) });
  }

  frameEnd() {
    if (this.run) this._closeRun();
  }

  _trim(L) {
    if (L > this.lseq) return;
    let k = 0;
    while (k < this.outbox.length && this.outbox[k].lseq <= L) k++;
    if (k > 0) this.outbox.splice(0, k);
  }

  // ---------- presence ----------

  _set(patch, key, value) {
    const t = JSON.stringify(value);
    if (this.presenceText.get(key) === t) return false;
    this.presenceText.set(key, t);
    patch[key] = value;
    return true;
  }

  _composePresence(now) {
    const patch = {};
    const local = this.a.local();
    avatarFields(this, patch, local, now);
    if (this.phase !== 'knocking') {
      this._set(patch, 'rx', this.rx);
      this._set(patch, 'nd', this.nd);
      // outbox window: the oldest unacked entries that fit
      const mine = this.t.myState?.() || {};
      let other = 0;
      for (const k in mine) if (k !== 'ob') other += 4 + k.length + jsonBytes(mine[k]);
      for (const k in patch) other += 4 + k.length + jsonBytes(patch[k]);
      const budget = Math.min(C.OUTBOX_BYTES, C.STATE_BYTES - other - 96);
      const ob = [];
      let size = 2;
      for (const e of this.outbox) {
        if (ob.length >= C.OUTBOX_ENTRIES || size + e.bytes + 1 > budget) break;
        ob.push(e.arr);
        size += e.bytes + 1;
      }
      const key = ob.length ? ob[0][0] + ':' + ob[ob.length - 1][0] + ':' + ob.length : '';
      if (key !== this.obKey) {
        this.obKey = key;
        patch.ob = ob.length ? ob : null;
        this.presenceText.delete('ob');
      }
    }
    let n = 0;
    for (const k in patch) n++;
    if (n === 0) return;
    try {
      this.t.setState(patch);
    } catch (err) {
      if (err?.code !== 'too_big') throw err;
      if (patch.ob) {
        patch.ob = patch.ob.slice(0, Math.max(1, patch.ob.length >> 1));
        this.obKey = 'shrunk';
      }
      patch.lk = null;
      this.presenceText.delete('lk');
      try {
        this.t.setState(patch);
      } catch {
        console.warn('[net] guest presence too big');
      }
    }
    if ('ob' in patch || 'nd' in patch || 'rx' in patch) this.t.flushState();
  }

  // ---------- control ----------

  _onCtl(data, from) {
    if (from !== this.hostPeer) return;
    const c = parseCtl(data);
    if (!c || c.k !== 'bye' || c.e !== this.epoch) return;
    const me = this.t.selfId();
    if (c.to !== '*' && c.to !== me) return;
    if (c.why === 'kick') this._end('kicked');
    else if (c.why === 'deny') this._end('denied');
    else if (c.why === 'end') this._end('ended');
  }

  // ---------- info ----------

  pendingCount() {
    return this.pendCells.size + this.pendEnts.size + this.pendPlants.size;
  }

  players() {
    const out = [];
    const hs = this.host;
    const peers = new Map();
    for (const p of this.t.peers()) peers.set(p.id, p);
    const me = this.t.selfId();
    if (this.hostPeer) {
      const p = peers.get(this.hostPeer);
      out.push({ peer: this.hostPeer, seat: 0, uid: this.hostUid, name: this.hostName, you: false, host: true, pos: p && Array.isArray(p.state.p) ? p.state.p : null, away: !p || hs?.zz === 1, state: p ? p.state : null, updatedAt: p ? p.updatedAt : 0 });
    }
    for (const [peer, seat] of hs ? hs.adm : []) {
      const p = peers.get(peer);
      const you = peer === me;
      const st = you ? this.t.myState?.() || {} : p ? p.state : null;
      out.push({ peer, seat, uid: p?.uid ?? null, name: st && typeof st.nm === 'string' ? st.nm : '', you, host: false, pos: st && Array.isArray(st.p) ? st.p : null, away: !p, guest: !!p?.guest, state: st, updatedAt: p ? p.updatedAt : 0 });
    }
    return out;
  }

  debug() {
    return {
      phase: this.phase, hostPeer: this.hostPeer, epoch: this.epoch, seat: this.seat, ap: this.ap, hd: this.hd,
      nd: this.nd, buffered: this.buffer.size, pend: this.pendingCount(), outbox: this.outbox.length + (this.run ? 1 : 0),
      lseq: this.lseq, ackedL: this.ackedL, rx: this.rx, hash: this.hashes(), stats: { ...this.stats },
    };
  }
}

