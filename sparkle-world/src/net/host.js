// NetHost (docs/MULTIPLAYER.md §5, §8): the authority. Seats and knocks, outbox processing
// with validation, careful-friends protection and rate limits, the author map and per-friend
// logs (Undo building), the journal flush into numbered batches, catch-up fixes, the snapshot
// carousel, the host presence, hashes and the 15 s local saves.
//
// Who owns what is keyed by the FRIEND, not her seat (Addendum B): an owner key is 'u:' + her
// room stamp (uid) when she has one, else 'p:' + her peer id. A friend who takes a freed seat
// starts with nothing; a friend who comes back (same stamp) keeps what she built, also after
// the host's page reloads (exportAuthors / importAuthors, saved with the host's world). Only
// making or removing a thing changes its owner: tapping a lamp, a door swinging, a fence
// joining its new neighbour or a railing opening for a bridge never do.
//
// It reaches the network only through NetTransport and the game only through GameAdapter.

import {
  C, PRIO, REJECT, NO, ANY_FIELDS, RATE, PROTOCOL, randomEpoch,
  isInt, isIntIn, isObj, isStr, isEntityKey, isColor, isPlainData, messageText, cleanText, HELD_KEY_RE,
  parseVehiclePresence,
} from './protocol.js';
import { Journal, buildPayload } from './journal.js';
import { unpackB, blockMix, blockHashOf, frameSnapshot, splitForJson, canDeflate, round2, utf8Length } from './codec.js';
import { TokenBucket, jsonBytes } from './transport.js';

const ANY = new Set(ANY_FIELDS);
/** Entity data only the host works out (a guest's page's guess is dropped, see 'ed'). */
const DERIVED = ['conn'];
const FIX_KEEP = 10000; // re-send the same fix for up to 10 s while she asks for the same gap
const SEAT_LOG_BYTES = 2 * 1024 * 1024;
// a friend's car in the host's custody goes back to its spot when she has not been driving it
// (no presence vh with its uid, no park waiting in her outbox) for this long
const CUSTODY_NO_VH = 10000;

export class NetHost {
  /**
   * @param {object} ctx
   * @param {object} ctx.session    NetSession (flags remoteApplying/noHistory, emit(), env)
   * @param {object} ctx.transport  NetTransport (open, probed)
   * @param {object} ctx.adapter    GameAdapter
   * @param {object} ctx.clock
   * @param {() => number} ctx.rand
   * @param {string} ctx.build      presence `pv`
   * @param {string|null} ctx.uid   my identity().uid
   * @param {object} [ctx.options]  { autoAdmit, compression, resumeUids, trackExec, journalMaxKeys, fixMax,
   *                                   authors (exportAuthors() data to start from: a resumed session) }
   */
  constructor(ctx) {
    this.session = ctx.session;
    this.t = ctx.transport;
    this.a = ctx.adapter;
    this.clock = ctx.clock;
    this.rand = ctx.rand;
    this.build = ctx.build;
    this.uid = ctx.uid ?? null;
    const o = ctx.options || {};
    this.autoAdmit = !!o.autoAdmit;
    this.compression = o.compression === undefined ? canDeflate() : !!o.compression && canDeflate();
    this.resumeUids = new Set(o.resumeUids || []);
    this.trackExec = !!o.trackExec;
    this.resumed = !!o.resumed;
    this._authorsIn = o.authors || null;

    this.epoch = null;
    this.hs = 0;
    this.journal = new Journal({ maxKeys: o.journalMaxKeys || C.JOURNAL_MAX_KEYS });
    this.fixMax = o.fixMax || C.FIX_MAX;
    this.blockHash = 0;
    this.live = false;

    this.seats = [null, null, null, null]; // 1..3: { peer, uid, owner, admittedAt, missingSince }
    this.adm = new Map(); // peer -> seat
    this.no = new Map(); // peer -> why (insertion ordered)
    this.banned = new Set(); // uids
    this.seatedUids = new Map(); // uid -> seat (this session)
    this.lastLseq = new Map(); // peer -> processed-through lseq
    this.acks = [0, 0, 0, 0];
    this.acksDirty = false;
    this.flushRejects = [];
    this.recentRejects = []; // { at, seat, lseq, code }
    this.rules = { build: 1, mine: 0 };
    // key -> owner: 0 = the host, else a friend's owner key (see _ownerOf); no entry = nobody's
    this.author = { cells: new Map(), ents: new Map(), plants: new Map() };
    this.logs = new Map(); // owner key -> { log: [group], bytes } (Undo building)
    // vehicles friends are driving (docs/teams/vehicles.md §8.4): the host keeps custody so a
    // car is never lost. owner key -> { uid, rec, peer, seat, name, prevOwner, since, noVhSince }
    this.custody = new Map();
    this.buckets = [null, null, null, null];
    this.pfAt = [-Infinity, -Infinity, -Infinity, -Infinity];
    this.zAt = -Infinity;
    this.knocks = new Map(); // peer -> info (shown to the UI)
    this.lastFixAt = new Map();
    this.fixCache = new Map(); // peer -> the last fix sent to her (re-sent as is while she asks the same)
    this.rs = new Set();
    this.snap = null;
    this.snapPending = false;
    this.snapCounter = 0;
    this.snapMinS0 = 0;
    this.snapTokens = 1;
    this.snapTokAt = 0;
    this.receivers = new Map(); // peer -> { snapId, h, progressAt, seenAt }
    this.fixCounter = 0;
    this.peerMap = new Map();
    this.execSeat = null;
    this.execPeer = null;
    this.execOwner = null;
    this.group = null;
    this.lastFlushAt = -Infinity;
    this.lastHashAt = 0;
    this.lastHashSeq = -1;
    this.hh = null;
    this.lastSaveAt = 0;
    this.savedSeq = 0;
    this.changedSinceSave = false;
    this.zz = 0;
    this.ended = false;
    this.presenceText = new Map();
    this.tmSent = null;
    this.tmAt = -Infinity;
    this.lastLookAt = -Infinity;
    this.lastPos = null;
    this.execLog = this.trackExec ? new Map() : null;
    this.stats = {
      batches: 0, fixes: 0, fixParts: 0, snapshots: 0, chunks: 0, executed: 0, rejected: 0,
      dupExec: 0, rsForced: 0, oversize: 0, sendDropped: 0, fixRepeats: 0, rejectCodes: {}, executedKinds: {},
    };

    this.hooks = {
      cell: (i, prev, id) => this._hookCell(i, prev, id),
      ent: (kind, uid, before, after) => this._hookEnt(kind, uid, before, after),
      plant: (kind, i, before, after) => this._hookPlant(kind, i, before, after),
      actor: (kind, id) => this.journal.touchActor(kind + ':' + id),
    };
  }

  /** Start hosting (after open + probe). A new epoch; hooks go live. */
  start({ epoch } = {}) {
    const now = this.clock.now();
    this.epoch = epoch || randomEpoch(this.rand);
    this.hs = now;
    const { sx, sy, sz } = this.a.size();
    this.size = { sx, sy, sz, n: sx * sy * sz, layer: sx * sz };
    this.blockHash = blockHashOf((i) => this.a.getCell(i), this.size.n);
    this.a.attach('host', this.hooks);
    if (this._authorsIn) this.importAuthors(this._authorsIn);
    this._authorsIn = null;
    this.live = true;
    this.lastHashAt = now;
    this.lastSaveAt = now;
    const local = this.a.local();
    this.t.setState({
      v: PROTOCOL, pv: this.build, r: 'h', uid: null, ep: this.epoch, hs: this.hs,
      nm: cleanText(local.nm, 12), lk: cleanText(local.lk, 200), hd: 0, fl: 0, ak: [], adm: [], no: [], rs: [], ru: [1, 0],
      end: null, kn: null, ob: null, nd: null, rx: null,
    });
    this.t.flushState();
  }

  /** Stop: presence end:1 and a best-effort goodbye to everyone. Hooks come off. */
  stop() {
    if (!this.live) return;
    // friends' cars go back to their spots first (while the hooks still journal and the
    // world is saved after this)
    for (const owner of Array.from(this.custody.keys())) this._releaseCustody(owner, 'stop');
    this.live = false;
    this.ended = true;
    try {
      this.t.setState({ end: 1 });
      this.t.flushState();
    } catch {}
    this.t.send('ctl', { k: 'bye', e: this.epoch, to: '*', why: 'end' }, PRIO.ctl);
    try {
      this.a.detach();
    } catch {}
  }

  // ---------- the tick (§6 host h.live, in this order) ----------

  tick(now = this.clock.now()) {
    if (!this.live) return;
    this._readPeers(now);
    this._admissions(now);
    this._processOutboxes(now);
    this._flush(now);
    this._serveFixes(now);
    this._serveSnapshot(now);
    this._composePresence(now);
    this._periodic(now);
  }

  _readPeers(now) {
    const m = this.peerMap;
    m.clear();
    for (const p of this.t.peers()) m.set(p.id, p);
    // seat hold: a seated peer missing for 60 s loses the seat
    for (let s = 1; s <= C.MAX_SEATS; s++) {
      const seat = this.seats[s];
      if (!seat) continue;
      if (m.has(seat.peer)) seat.missingSince = null;
      else {
        if (seat.missingSince == null) seat.missingSince = now;
        if (now - seat.missingSince > C.SEAT_HOLD) this._freeSeat(s);
      }
    }
    this._watchCustody(now);
    // peers that left: forget their refusals (so a new knock is judged fresh) and knocks
    for (const peer of Array.from(this.no.keys())) if (!m.has(peer)) this.no.delete(peer);
    for (const [peer, info] of Array.from(this.knocks)) {
      const p = m.get(peer);
      if (!p || p.state.kn !== 1) {
        this.knocks.delete(peer);
        // waited: how long her card was up (a long wait = she gave up knocking)
        this.session.emit('knock-gone', { peer, name: info.name, waited: now - info.at });
      }
    }
    for (const peer of Array.from(this.rs)) {
      const p = m.get(peer);
      if (!p || !this.adm.has(peer) || isObj(p.state.rx)) this.rs.delete(peer);
    }
  }

  _admissions(now) {
    for (const p of this.peerMap.values()) {
      if (p.self) continue;
      const st = p.state;
      if (st.r !== 'g' || st.kn !== 1) continue;
      if (this.adm.has(p.id) || this.no.has(p.id) || this.knocks.has(p.id)) continue;
      if (st.v !== PROTOCOL || st.pv !== this.build) {
        this._refuse(p.id, NO.VERSION);
        continue;
      }
      const uid = typeof p.uid === 'string' ? p.uid : null;
      if (uid && this.banned.has(uid)) {
        this._refuse(p.id, NO.KICK);
        continue;
      }
      const known = uid && (this.seatedUids.has(uid) || this.resumeUids.has(uid));
      this._reclaimSeat(uid);
      if (!this._freeSeatNumber(uid ? this.seatedUids.get(uid) : undefined)) {
        this._refuse(p.id, NO.FULL);
        continue;
      }
      if (known || this.autoAdmit) {
        this.admit(p.id);
        continue;
      }
      const info = {
        peer: p.id, uid, guest: !!p.guest, name: typeof st.nm === 'string' ? st.nm.slice(0, 24) : '',
        look: typeof st.lk === 'string' ? st.lk : '', at: now,
      };
      this.knocks.set(p.id, info);
      this.session.emit('knock', info);
    }
  }

  // ---------- admission API (UI) ----------

  /** Let a knocking friend in (lowest free seat, or her old seat when free). */
  admit(peer) {
    const p = this.peerMap.get(peer) || this.t.peers().find((x) => x.id === peer);
    if (!p || this.adm.has(peer)) return false;
    const uid = typeof p.uid === 'string' ? p.uid : null;
    this._reclaimSeat(uid);
    const seat = this._freeSeatNumber(uid ? this.seatedUids.get(uid) : undefined);
    this.knocks.delete(peer);
    if (!seat) {
      this._refuse(peer, NO.FULL);
      return false;
    }
    this.no.delete(peer);
    this.adm.set(peer, seat);
    this.seats[seat] = { peer, uid, owner: this._ownerOf(uid, peer), admittedAt: this.clock.now(), missingSince: null };
    if (uid) this.seatedUids.set(uid, seat);
    this.lastLseq.set(peer, 0);
    this.acks[seat] = 0;
    this.acksDirty = true;
    this.buckets[seat] = {
      cells: new TokenBucket(RATE.cells[0], RATE.cells[1], this.clock.now()),
      ents: new TokenBucket(RATE.ents[0], RATE.ents[1], this.clock.now()),
      data: new TokenBucket(RATE.data[0], RATE.data[1], this.clock.now()),
    };
    this.session.emit('players', { reason: 'admit', peer, seat });
    return true;
  }

  /** "Not now". */
  deny(peer) {
    this.knocks.delete(peer);
    this._refuse(peer, NO.DENY);
    this.t.send('ctl', { k: 'bye', e: this.epoch, to: peer, why: 'deny' }, PRIO.ctl);
  }

  /** "Send home": refuse, ban the uid, free the seat, ignore the outbox from now on. */
  kick(peer) {
    const seat = this.adm.get(peer);
    const p = this.peerMap.get(peer) || this.t.peers().find((x) => x.id === peer);
    const uid = seat ? this.seats[seat]?.uid : typeof p?.uid === 'string' ? p.uid : null;
    if (uid) this.banned.add(uid);
    if (seat) this._freeSeat(seat);
    this.knocks.delete(peer);
    this._refuse(peer, NO.KICK);
    this.t.send('ctl', { k: 'bye', e: this.epoch, to: peer, why: 'kick' }, PRIO.ctl);
    this.session.emit('players', { reason: 'kick', peer, seat });
  }

  /** The owner key of a friend: her room stamp when she has one (it comes back with her). */
  _ownerOf(uid, peer) {
    return uid ? 'u:' + uid : 'p:' + peer;
  }

  _logOf(owner) {
    let l = this.logs.get(owner);
    if (!l) this.logs.set(owner, (l = { log: [], bytes: 0 }));
    return l;
  }

  setRules({ build, mine } = {}) {
    if (build !== undefined) this.rules.build = build ? 1 : 0;
    if (mine !== undefined) this.rules.mine = mine ? 1 : 0;
  }

  knockList() {
    return Array.from(this.knocks.values());
  }

  _refuse(peer, why) {
    this.no.delete(peer);
    this.no.set(peer, why);
    while (this.no.size > C.NO_LIST_MAX) this.no.delete(this.no.keys().next().value);
  }

  _freeSeat(seat) {
    const s = this.seats[seat];
    if (!s) return;
    // her car goes back to its spot (seat hold over, sent home, her page reloaded)
    this._releaseCustody(s.owner, 'free');
    this.adm.delete(s.peer);
    this.lastLseq.delete(s.peer);
    this.receivers.delete(s.peer);
    this.fixCache.delete(s.peer);
    this.rs.delete(s.peer);
    this.seats[seat] = null;
    this.session.emit('players', { reason: 'free', peer: s.peer, seat });
  }

  /** Her old page is gone (a reload): the seat held for it goes back to her at once. */
  _reclaimSeat(uid) {
    if (!uid) return;
    const pref = this.seatedUids.get(uid);
    const s = pref ? this.seats[pref] : null;
    if (s && s.uid === uid && !this.peerMap.has(s.peer)) this._freeSeat(pref);
  }

  /** Seat to use: `prefer` when free, else the lowest free seat; 0 when full. */
  _freeSeatNumber(prefer) {
    if (prefer && !this.seats[prefer]) return prefer;
    for (let s = 1; s <= C.MAX_SEATS; s++) if (!this.seats[s]) return s;
    return 0;
  }

  // ---------- guest outboxes (§5.6, §8.1) ----------

  _processOutboxes(now) {
    for (let seat = 1; seat <= C.MAX_SEATS; seat++) {
      const s = this.seats[seat];
      if (!s) continue;
      const p = this.peerMap.get(s.peer);
      if (!p) continue;
      const st = p.state;
      if (st.ep !== this.epoch || !Array.isArray(st.ob)) continue;
      let last = this.lastLseq.get(s.peer) || 0;
      const b = this.buckets[seat];
      for (const e of st.ob) {
        if (!Array.isArray(e) || !isIntIn(e[0], 1, 2 ** 31) || typeof e[1] !== 'string') continue;
        if (e[0] <= last) continue;
        // charge before applying; a very fast friend is slowed down, never loses anything
        const cost = entryCost(e);
        const bucket = cost.kind ? b[cost.kind] : null;
        if (bucket && !bucket.take(now, Math.min(cost.n, bucket.burst))) break;
        this._exec(seat, s.peer, e, now);
        last = e[0];
        this.lastLseq.set(s.peer, last);
        this.acks[seat] = last;
        this.acksDirty = true;
      }
    }
  }

  _exec(seat, peer, e, now) {
    const lseq = e[0];
    if (this.execLog) {
      let set = this.execLog.get(peer);
      if (!set) this.execLog.set(peer, (set = new Set()));
      if (set.has(lseq)) this.stats.dupExec++;
      set.add(lseq);
    }
    this.stats.executed++;
    this.stats.executedKinds[e[1]] = (this.stats.executedKinds[e[1]] || 0) + 1;
    this.execSeat = seat;
    this.execPeer = peer;
    this.execOwner = this.seats[seat]?.owner ?? this._ownerOf(null, peer);
    const owner = this.execOwner;
    this.group = { lseq, kind: e[1], cells: new Map(), ents: new Map(), plants: new Map() };
    const s = this.session;
    s.remoteApplying = true;
    s.noHistory = true;
    let code = 0;
    try {
      code = this._run(seat, owner, e, now);
    } catch (err) {
      console.error('[net] guest op failed', err);
      code = REJECT.INVALID;
    } finally {
      s.remoteApplying = false;
      s.noHistory = false;
      this.execSeat = null;
      this.execPeer = null;
      this.execOwner = null;
    }
    this._closeGroup(owner);
    if (code) {
      this.stats.rejected++;
      const key = e[1] + ':' + code;
      this.stats.rejectCodes[key] = (this.stats.rejectCodes[key] || 0) + 1;
      this.flushRejects.push([seat, lseq, code]);
      this.recentRejects.push({ at: now, seat, lseq, code });
    }
  }

  _idx(x, y, z) {
    const { sx, sy, sz } = this.size;
    if (!isInt(x) || !isInt(y) || !isInt(z) || x < 0 || y < 0 || z < 0 || x >= sx || y >= sy || z >= sz) return -1;
    return (y * sz + z) * sx + x;
  }

  _free(i, owner) {
    const a = this.author.cells.get(i);
    if (a === owner) return true;
    if (a === undefined) return this.a.isFree(this.a.getCell(i));
    return false;
  }

  _ownEnt(uid, owner) {
    return this.author.ents.get(uid) === owner;
  }

  /** Validate and apply one outbox entry. Returns a rejection code (0 = fine). */
  _run(seat, owner, e, now) {
    const a = this.a;
    const j = this.journal;
    const R = this.rules;
    switch (e[1]) {
      case 'b': {
        const tr = typeof e[2] === 'string' && e[2].length <= C.CELLS_PER_B * 9 ? unpackB(e[2]) : null;
        if (!tr) return REJECT.INVALID;
        const n = this.size.n;
        for (let k = 0; k < tr.length; k += 3) if (tr[k] < n) j.touchCell(tr[k]);
        if (!R.build) return REJECT.PAUSED;
        let code = 0;
        const pairs = [];
        for (let k = 0; k < tr.length; k += 3) {
          const i = tr[k], before = tr[k + 1], after = tr[k + 2];
          if (i >= n) {
            code ||= REJECT.INVALID;
            continue;
          }
          const cur = a.getCell(i);
          if (cur === after) continue;
          if (cur !== before) {
            code ||= REJECT.CONFLICT;
            continue;
          }
          if (i < this.size.layer && a.isSolid(before) && !a.isSolid(after)) {
            code ||= REJECT.INVALID;
            continue;
          }
          if (a.isSolid(after) && a.occupied(i)) {
            code ||= REJECT.CONFLICT;
            continue;
          }
          // watering anyone's garden is helping, like harvesting (and changes no owner)
          if (!R.mine && before !== 0 && !this._free(i, owner) && !a.isWatering?.(before, after)) {
            code ||= REJECT.PROTECTED;
            continue;
          }
          pairs.push(i, after);
        }
        if (pairs.length > 0) {
          a.setCells(pairs);
          for (let k = 0; k < pairs.length; k += 2) a.adoptWet(pairs[k]);
        }
        return code;
      }
      case 'e+': {
        const [, , uid, key, x, y, z, rot, color, data] = e;
        if (!isIntIn(uid, 1, 2 ** 31)) return REJECT.INVALID;
        j.touchEnt(uid);
        // parking the car she drives (in the host's custody) is fine even while building is
        // paused: it must come back
        const held = this.custody.get(owner);
        const parking = !!(held && held.rec[1] === key && a.isVehicle?.(key));
        if (!R.build && !parking) return REJECT.PAUSED;
        const lo = seat * C.SEAT_UID_SPAN + 1;
        if (uid < lo || uid >= lo - 1 + C.SEAT_UID_SPAN) return REJECT.INVALID;
        if (a.entityRecord(uid)) return REJECT.INVALID;
        if (!isEntityKey(key) || this._idx(x, y, z) < 0 || !isIntIn(rot, 0, 3) || !isColor(color ?? 0)) return REJECT.INVALID;
        const d = data || 0;
        if (d !== 0 && (!isPlainData(d, C.ENTITY_DATA_DEPTH) || jsonBytes(d) > C.ENTITY_DATA_BYTES)) return REJECT.INVALID;
        if (parking) {
          // where she parked, else the nearest free spot (the vehicle is never refused for room)
          let ok = a.canPlaceEntity(key, x, y, z, rot, null) && a.placeEntity([uid, key, x, y, z, rot, color || 0, d, 0, 0]);
          if (!ok) ok = (a.parkVehicle?.([uid, key, x, y, z, rot, color || 0, d, 0, 0]) || 0) === uid;
          if (!ok) return REJECT.CONFLICT;
          this.custody.delete(owner);
          // a vehicle keeps its owner when it is driven and parked again
          if (held.prevOwner === undefined) this.author.ents.delete(uid);
          else this.author.ents.set(uid, held.prevOwner);
          return 0;
        }
        if (!a.canPlaceEntity(key, x, y, z, rot, null)) return REJECT.CONFLICT;
        return a.placeEntity([uid, key, x, y, z, rot, color || 0, d, 0, 0]) ? 0 : REJECT.CONFLICT;
      }
      case 'e-': {
        const uid = e[2];
        if (!isIntIn(uid, 1, 2 ** 31)) return REJECT.INVALID;
        j.touchEnt(uid);
        if (!R.build) return REJECT.PAUSED;
        if (!a.entityRecord(uid)) return 0; // already gone: what she wanted
        if (!R.mine) {
          // a treat on a table is there to be eaten, by anyone
          if (!this._ownEnt(uid, owner) && !a.isEdible?.(uid)) return REJECT.PROTECTED;
          for (const r of a.ridersOf(uid)) if (!this._ownEnt(r, owner) && !a.isEdible?.(r)) return REJECT.PROTECTED;
        }
        // a vehicle she is about to drive (her presence vh, sent with this outbox, names it):
        // the host keeps custody until she parks it
        const before = a.entityRecord(uid);
        const drives = !!(before && a.isVehicle?.(before[1]) && this._drivesNow(seat, uid));
        const prevOwner = this.author.ents.has(uid) ? this.author.ents.get(uid) : undefined;
        if (!a.removeEntity(uid)) return REJECT.CONFLICT;
        if (drives) this._takeCustody(owner, seat, before, prevOwner, now);
        return 0;
      }
      case 'er': {
        const [, , uid, rotB, rotA] = e;
        if (!isIntIn(uid, 1, 2 ** 31)) return REJECT.INVALID;
        j.touchEnt(uid);
        if (!R.build) return REJECT.PAUSED;
        if (!isIntIn(rotB, 0, 3) || !isIntIn(rotA, 0, 3)) return REJECT.INVALID;
        const rec = a.entityRecord(uid);
        if (!rec) return REJECT.CONFLICT;
        if (rec[5] === rotA) return 0;
        if (rec[5] !== rotB) return REJECT.CONFLICT;
        if (!R.mine && !this._ownEnt(uid, owner)) return REJECT.PROTECTED;
        if (!a.canPlaceEntity(rec[1], rec[2], rec[3], rec[4], rotA, uid)) return REJECT.CONFLICT;
        return a.rotateEntity(uid, rotA) ? 0 : REJECT.CONFLICT;
      }
      case 'ed': {
        const [, , uid, raw] = e;
        if (!isIntIn(uid, 1, 2 ** 31)) return REJECT.INVALID;
        j.touchEnt(uid); // (so she always gets the host's record back, also when nothing changes)
        if (!a.entityRecord(uid)) return REJECT.CONFLICT;
        if (!isPlainData(raw, C.ENTITY_DATA_DEPTH) || jsonBytes(raw) > C.ENTITY_DATA_BYTES) return REJECT.INVALID;
        // derived fields are the host's to work out: a fence joins its neighbours here when a
        // block or piece next to it changes (her own page's guess is not taken)
        let patch = raw;
        for (const k of DERIVED) {
          if (k in patch) {
            if (patch === raw) patch = { ...raw };
            delete patch[k];
          }
        }
        let keys = 0;
        for (const k in patch) keys++;
        if (keys === 0) return 0;
        if (!R.mine && !this._ownEnt(uid, owner)) {
          for (const k in patch) if (!ANY.has(k)) return REJECT.PROTECTED;
        }
        return a.patchEntity(uid, patch) ? 0 : REJECT.CONFLICT;
      }
      case 'p+':
      case 'p-':
      case 'ph': {
        const [, kind, x, y, z, crop] = e;
        const i = this._idx(x, y, z);
        if (i < 0) return REJECT.INVALID;
        j.touchPlant(i);
        if (!isStr(crop, 32) || !crop) return REJECT.INVALID;
        const pl = a.plantAt(i);
        if (kind === 'ph') {
          if (!pl || pl[0] !== crop || pl[1] !== 3) return REJECT.CONFLICT;
          return a.harvestPlant(i) ? 0 : REJECT.CONFLICT;
        }
        if (!R.build) return REJECT.PAUSED;
        if (kind === 'p+') {
          if (pl || !a.soilOk(i)) return REJECT.CONFLICT;
          return a.addPlant(crop, x, y, z) ? 0 : REJECT.CONFLICT;
        }
        if (!pl || pl[0] !== crop) return REJECT.CONFLICT;
        if (!R.mine && this.author.plants.get(i) !== owner) return REJECT.PROTECTED;
        return a.removePlant(i) ? 0 : REJECT.CONFLICT;
      }
      case 'pf': {
        const [, , key, ox, oy, oz, rot] = e;
        if (!R.build) return REJECT.PAUSED;
        if (now - this.pfAt[seat] < C.PREFAB_EVERY) return REJECT.LIMIT;
        if (!isStr(key, 64) || !key || !isInt(ox) || !isInt(oy) || !isInt(oz) || !isIntIn(rot, 0, 3)) return REJECT.INVALID;
        const policy = R.mine
          ? () => true
          : (diff) => {
            const cells = diff?.cells || [];
            for (let k = 0; k < cells.length; k += 3) {
              if (cells[k + 1] !== cells[k + 2] && cells[k + 1] !== 0 && !this._free(cells[k], owner)) return false;
            }
            for (const uid of diff?.ents || []) if (!this._ownEnt(uid, owner)) return false;
            return true;
          };
        const r = a.prefab(key, { x: ox, y: oy, z: oz, rot }, policy);
        if (!r || !r.ok) return r?.code || REJECT.CONFLICT;
        this.pfAt[seat] = now;
        a.toast(messageText('made_prefab', { name: this._seatName(seat), prefab: r.name || 'Magic House' }), 'magic');
        return 0;
      }
      case 'pu': {
        const target = e[2];
        const l = this._logOf(owner);
        const k = l.log.findIndex((g) => g.lseq === target && g.kind === 'pf');
        if (k < 0) return REJECT.CONFLICT;
        const g = l.log[k];
        l.log.splice(k, 1);
        l.bytes -= g.bytes;
        this._revertGroup(g);
        return 0;
      }
      case 'z': {
        if (now - this.zAt < C.SLEEP_EVERY) return REJECT.LIMIT;
        this.zAt = now;
        a.skipToMorning();
        this.tmAt = -Infinity; // publish the clock at once
        a.toast(messageText('slept', { name: this._seatName(seat) }), 'moon');
        return 0;
      }
      default:
        return REJECT.INVALID;
    }
  }

  _seatName(seat) {
    const s = this.seats[seat];
    const p = s && this.peerMap.get(s.peer);
    const nm = p && typeof p.state.nm === 'string' ? p.state.nm : '';
    return nm || 'A friend';
  }

  // ---------- hooks: every change of a synced key passes here ----------

  _hookCell(i, prev, id) {
    if (prev !== id) {
      if (prev !== 0) this.blockHash = (this.blockHash - blockMix(i, prev)) >>> 0;
      if (id !== 0) this.blockHash = (this.blockHash + blockMix(i, id)) >>> 0;
    }
    if (!this.live) return;
    this.journal.touchCell(i);
    this.changedSinceSave = true;
    // soil getting wet (a watering can) or drying out again belongs to whoever made the bed
    const keep = !!this.a.isWatering?.(prev, id) || !!this.a.isWatering?.(id, prev);
    if (this.execOwner !== null) {
      if (!keep) this.author.cells.set(i, this.execOwner);
      const g = this.group;
      if (g && !g.cells.has(i)) g.cells.set(i, prev);
    } else if (keep) {
      // nobody's change of owner
    } else if (this.a.inSystems?.()) this.author.cells.delete(i);
    else this.author.cells.set(i, 0);
  }

  _hookEnt(kind, uid, before, after) {
    if (!this.live) return;
    this.journal.touchEnt(uid);
    this.changedSinceSave = true;
    // only making or removing a piece changes its owner: turning it, tapping it (a lamp, a
    // door) or a derived change (a fence joining a neighbour, a railing opening for a bridge)
    // leaves it with whoever made it
    if (kind === 'del') this.author.ents.delete(uid);
    else if (kind === 'add') {
      if (this.execOwner !== null) this.author.ents.set(uid, this.execOwner);
      else if (this.a.inSystems?.()) this.author.ents.delete(uid);
      else this.author.ents.set(uid, 0);
    }
    if (this.execOwner !== null) {
      const g = this.group;
      if (g && !g.ents.has(uid)) {
        let rec = null;
        if (kind === 'del') rec = before;
        else if (kind === 'rot' || kind === 'data') {
          const cur = this.a.entityRecord(uid);
          if (cur) {
            rec = cur.slice();
            if (kind === 'rot') rec[5] = before;
            else rec[7] = before ? JSON.parse(JSON.stringify(before)) : 0;
          }
        }
        g.ents.set(uid, rec);
      }
    }
  }

  _hookPlant(kind, i, before) {
    if (!this.live) return;
    this.journal.touchPlant(i);
    this.changedSinceSave = true;
    // planting makes it hers, taking it out makes it nobody's; growing and harvesting (a
    // regrowing crop stays) change no owner
    if (kind === 'del') this.author.plants.delete(i);
    else if (kind === 'add') {
      if (this.execOwner !== null) this.author.plants.set(i, this.execOwner);
      else if (this.a.inSystems?.()) this.author.plants.delete(i);
      else this.author.plants.set(i, 0);
    }
    if (this.execOwner !== null) {
      const g = this.group;
      if (g && !g.plants.has(i)) g.plants.set(i, before ? [before[0], before[1]] : null);
    }
  }

  // ---------- who owns what, across a reload (Addendum B) ----------

  /**
   * Owners of this session's changes, for the host's world save: owner keys that come back
   * with the friend ('u:' stamps) and the host (0). Keys of friends with no stamp are left out
   * (after a reload nobody can be them). Cells go as runs [start, length, owner index].
   */
  exportAuthors() {
    const owners = [];
    const index = new Map([[0, 0]]);
    const idx = (o) => {
      if (index.has(o)) return index.get(o);
      if (typeof o !== 'string' || !o.startsWith('u:')) return -1;
      owners.push(o);
      index.set(o, owners.length);
      return owners.length;
    };
    const cells = [];
    const sorted = Array.from(this.author.cells).sort((a, b) => a[0] - b[0]);
    for (const [i, o] of sorted) {
      const k = idx(o);
      if (k < 0) continue;
      const last = cells[cells.length - 1];
      if (last && last[2] === k && last[0] + last[1] === i) last[1]++;
      else cells.push([i, 1, k]);
    }
    const ents = [];
    for (const [uid, o] of this.author.ents) {
      const k = idx(o);
      if (k >= 0) ents.push([uid, k]);
    }
    const plants = [];
    for (const [i, o] of this.author.plants) {
      const k = idx(o);
      if (k >= 0) plants.push([i, k]);
    }
    return { v: 1, owners, cells, ents, plants };
  }

  /** Start from a saved exportAuthors() (a resumed session: friends keep what they built). */
  importAuthors(data) {
    if (!data || data.v !== 1 || !Array.isArray(data.owners)) return false;
    const owners = [0];
    for (const o of data.owners) owners.push(typeof o === 'string' && o.startsWith('u:') ? o : undefined);
    const own = (k) => (isInt(k) && k >= 0 && k < owners.length ? owners[k] : undefined);
    const n = this.size ? this.size.n : Infinity;
    for (const r of Array.isArray(data.cells) ? data.cells : []) {
      if (!Array.isArray(r) || !isInt(r[0]) || !isInt(r[1]) || r[1] < 1 || r[0] < 0 || r[0] + r[1] > n) continue;
      const o = own(r[2]);
      if (o === undefined) continue;
      for (let k = 0; k < r[1]; k++) this.author.cells.set(r[0] + k, o);
    }
    for (const r of Array.isArray(data.ents) ? data.ents : []) {
      if (!Array.isArray(r) || !isIntIn(r[0], 1, 2 ** 31)) continue;
      const o = own(r[1]);
      if (o !== undefined && this.a.entityRecord(r[0])) this.author.ents.set(r[0], o);
    }
    for (const r of Array.isArray(data.plants) ? data.plants : []) {
      if (!Array.isArray(r) || !isInt(r[0])) continue;
      const o = own(r[1]);
      if (o !== undefined) this.author.plants.set(r[0], o);
    }
    return true;
  }

  // ---------- per-seat log and Undo building (§8.4) ----------

  _closeGroup(owner) {
    const g = this.group;
    this.group = null;
    if (!g || g.cells.size + g.ents.size + g.plants.size === 0) return;
    const a = this.a;
    // cells: Int32Array idx + Uint8Array before/after keeps big prefabs cheap
    const n = g.cells.size;
    const idx = new Int32Array(n), bef = new Uint8Array(n), aft = new Uint8Array(n);
    let k = 0;
    for (const [i, b] of g.cells) {
      idx[k] = i;
      bef[k] = b;
      aft[k] = a.getCell(i);
      k++;
    }
    const ents = [];
    for (const [uid, b] of g.ents) ents.push([uid, b, a.entityRecord(uid)]);
    const plants = [];
    for (const [i, b] of g.plants) {
      const r = a.plantRecord(i);
      plants.push([i, b, r ? [r[1], r[2]] : null]);
    }
    const rec = { lseq: g.lseq, kind: g.kind, idx, bef, aft, ents, plants, bytes: n * 6 + ents.length * 200 + plants.length * 40 + 64 };
    const l = this._logOf(owner);
    l.log.push(rec);
    l.bytes += rec.bytes;
    while (l.bytes > SEAT_LOG_BYTES && l.log.length > 1) l.bytes -= l.log.shift().bytes;
  }

  /** Restore every key of one group whose current value still equals its after value. */
  _revertGroup(g) {
    const a = this.a;
    // entities that the group added go first (so blocks can come back where they stood).
    // Which ones is decided before any goes: taking one away can change its neighbours
    // (a picket fence re-joins its rails), and they must not look "changed since" for that.
    const drop = [];
    for (const [uid, before, after] of g.ents) {
      if (before === null && after !== null && sameEnt(a.entityRecord(uid), after)) drop.push(uid);
    }
    for (const uid of drop) a.removeEntity(uid);
    const pairs = [];
    for (let k = 0; k < g.idx.length; k++) {
      if (a.getCell(g.idx[k]) === g.aft[k] && g.bef[k] !== g.aft[k]) pairs.push(g.idx[k], g.bef[k]);
    }
    if (pairs.length) a.setCells(pairs);
    for (const [uid, before, after] of g.ents) {
      if (before === null) continue;
      const cur = a.entityRecord(uid);
      if (after === null) {
        if (!cur && a.canPlaceEntity(before[1], before[2], before[3], before[4], before[5], null)) a.placeEntity(before.slice());
      } else if (sameEnt(cur, after)) {
        if (before[5] !== after[5] && a.canPlaceEntity(before[1], before[2], before[3], before[4], before[5], uid)) a.rotateEntity(uid, before[5]);
        const bd = before[7] || {}, ad = after[7] || {};
        if (JSON.stringify(bd) !== JSON.stringify(ad)) {
          const patch = {};
          for (const key in ad) patch[key] = key in bd ? bd[key] : null;
          for (const key in bd) patch[key] = bd[key];
          a.patchEntity(uid, patch);
        }
      }
    }
    for (const [i, before, after] of g.plants) {
      const cur = a.plantAt(i);
      const same = (cur === null && after === null) || (cur && after && cur[0] === after[0] && cur[1] === after[1]);
      if (!same) continue;
      if (before === null && cur) a.removePlant(i);
      else if (before && !cur) {
        const [x, y, z] = a.coords(i);
        a.addPlant(before[0], x, y, z);
      }
    }
  }

  /**
   * "Undo building" for the friend in `seat` (everything she built since the host opened her
   * door, or since the host's page came back): newest to oldest, one host history group. She
   * hears about it (ctl 'tidy' with a few spots for her sparkles).
   */
  undoSeat(seat) {
    const s = this.seats[seat];
    const l = s ? this.logs.get(s.owner) : null;
    if (!l || l.log.length === 0) return 0;
    const groups = l.log.splice(0, l.log.length);
    l.bytes = 0;
    const run = () => {
      for (let k = groups.length - 1; k >= 0; k--) this._revertGroup(groups[k]);
    };
    if (typeof this.a.historyGroup === 'function') this.a.historyGroup(run);
    else run();
    // a car she drove came back with the revert: no custody left (else it goes back now)
    if (this.custody.has(s.owner)) this._releaseCustody(s.owner, 'undo');
    this.t.send('ctl', { k: 'tidy', e: this.epoch, to: s.peer, n: groups.length, at: this._spots(groups) }, PRIO.ctl);
    return groups.length;
  }

  // ---------- vehicle custody (docs/teams/vehicles.md §8.4) ----------

  /** Does the friend in `seat` say (presence vh) that she drives the vehicle `uid` now? */
  _drivesNow(seat, uid) {
    const s = this.seats[seat];
    const p = s && this.peerMap.get(s.peer);
    const vh = p ? parseVehiclePresence(p.state.vh) : null;
    return !!vh && vh[4] === uid;
  }

  _takeCustody(owner, seat, rec, prevOwner, now) {
    // one vehicle per friend: an older one goes back first
    if (this.custody.has(owner)) this._releaseCustody(owner, 'second');
    const s = this.seats[seat];
    this.custody.set(owner, {
      uid: rec[0], rec: rec.slice(), peer: s ? s.peer : null, seat, name: cleanText(this._seatName(seat), 12),
      prevOwner, since: now, noVhSince: null,
    });
  }

  /**
   * Put a friend's vehicle back where she took it from (or the nearest free spot; never lost),
   * with its owner from before. Returns true when the custody entry is gone.
   */
  _releaseCustody(owner, why = '') {
    const c = this.custody.get(owner);
    if (!c) return false;
    this.custody.delete(owner);
    if (this.a.entityRecord(c.uid)) return true; // it is back already (an Undo)
    let uid = 0;
    try {
      uid = this.a.parkVehicle?.(c.rec) || 0;
    } catch (err) {
      console.error('[net] could not put a car back', err);
    }
    if (!uid) return true;
    if (c.prevOwner === undefined) this.author.ents.delete(uid);
    else this.author.ents.set(uid, c.prevOwner);
    if (why !== 'stop') {
      const noun = this.a.vehicleNoun?.(c.rec[1]) || 'car';
      this.a.toast(`${c.name || 'A friend'}'s ${noun} went back to its spot.`, 'sparkle');
    }
    return true;
  }

  /**
   * Every tick: a car that is back already (an Undo) needs no custody; a friend who is here
   * but has not been driving it (no vh with its uid) for 10 s, with no park of it waiting in
   * her outbox, gets it put back.
   */
  _watchCustody(now) {
    for (const [owner, c] of Array.from(this.custody)) {
      if (this.a.entityRecord(c.uid)) {
        this.custody.delete(owner);
        continue;
      }
      const p = c.peer ? this.peerMap.get(c.peer) : null;
      if (!p) continue; // gone: the seat hold (_freeSeat) decides
      const vh = parseVehiclePresence(p.state.vh);
      if (vh && vh[4] === c.uid) {
        c.noVhSince = null;
        continue;
      }
      const last = this.lastLseq.get(c.peer) || 0;
      const ob = Array.isArray(p.state.ob) ? p.state.ob : [];
      if (ob.some((e) => Array.isArray(e) && e[0] > last && e[1] === 'e+' && e[3] === c.rec[1])) continue;
      if (c.noVhSince == null) c.noVhSince = now;
      else if (now - c.noVhSince > CUSTODY_NO_VH) this._releaseCustody(owner, 'idle');
    }
  }

  /** The vehicles in custody as parked save records (the host's world saves them). */
  custodyRecords() {
    const out = [];
    for (const c of this.custody.values()) {
      const r = c.rec;
      out.push({ uid: r[0], key: r[1], x: r[2], y: r[3], z: r[4], rot: r[5], color: r[6] || null, data: r[7] && typeof r[7] === 'object' ? JSON.parse(JSON.stringify(r[7])) : {} });
    }
    return out;
  }

  /** The owner of an entity now (the host is about to drive it), to give back on parking. */
  ownerToken(uid) {
    return { has: this.author.ents.has(uid), owner: this.author.ents.get(uid) };
  }

  /** After the host parked a vehicle: it keeps the owner it had (ownerToken). */
  restoreOwner(uid, token) {
    if (!token || !isIntIn(uid, 1, 2 ** 31)) return;
    if (token.has) this.author.ents.set(uid, token.owner);
    else this.author.ents.delete(uid);
  }

  /** Up to 6 places (block cells) spread over some groups, for sparkles. */
  _spots(groups) {
    const all = [];
    for (const g of groups) {
      for (let k = 0; k < g.idx.length; k++) all.push(this.a.coords(g.idx[k]));
      for (const [, before, after] of g.ents) {
        const r = after || before;
        if (r) all.push([r[2], r[3], r[4]]);
      }
    }
    if (all.length <= 6) return all.map((c) => c.map((v) => v | 0));
    const out = [];
    for (let k = 0; k < 6; k++) out.push(all[Math.floor((k * all.length) / 6)].map((v) => v | 0));
    return out;
  }

  // ---------- flush (§5.5) ----------

  _ackTable() {
    const out = [];
    for (let s = 1; s <= C.MAX_SEATS; s++) if (this.seats[s] || this.acks[s]) out.push([s, this.acks[s]]);
    return out;
  }

  _flush(now) {
    if (now - this.lastFlushAt < C.FLUSH_MIN && !this._forceFlush) return;
    this._forceFlush = false;
    if (!this.journal.dirty && !this.acksDirty && this.flushRejects.length === 0) return;
    this.lastFlushAt = now;
    const head = { e: this.epoch };
    if (this.acksDirty) head.a = this._ackTable();
    if (this.flushRejects.length) head.r = this.flushRejects;
    this.acksDirty = false;
    this.flushRejects = [];
    const { msgs, oversize } = this.journal.flush(this.a, head);
    for (const m of msgs) {
      const r = this.t.send('op', m, PRIO.op);
      if (r === 'dropped') this.stats.sendDropped++;
      this.stats.batches++;
    }
    if (oversize) {
      // a record too big for any batch: everyone takes a fresh snapshot (it is in there)
      this.stats.oversize++;
      this.snapMinS0 = this.journal.seq;
      for (const peer of this.adm.keys()) this.rs.add(peer);
    }
  }

  /** Flush now, whatever the time since the last one (snapshot / hash / stop). */
  flushNow() {
    this._forceFlush = true;
    this._flush(this.clock.now());
  }

  // ---------- catch-up fixes (§5.7) ----------

  _serveFixes(now) {
    const seq = this.journal.seq;
    for (const [peer, seat] of this.adm) {
      const p = this.peerMap.get(peer);
      if (!p) continue;
      const st = p.state;
      if (st.ep !== this.epoch || isObj(st.rx)) continue;
      const nd = st.nd;
      if (!isIntIn(nd, 0, seq - 1)) {
        this.fixCache.delete(peer);
        continue;
      }
      // A repeat of the same request gets the very same fix (same id, same parts), so parts
      // that arrived last time still count: under heavy loss a big fix completes in a few
      // rounds instead of never. Re-sending a cached fix costs no rebuild, so it may repeat
      // after 1 s; a new fix waits FIX_REPEAT (2 s). Rebuilt when she moves on or after FIX_KEEP.
      let fx = this.fixCache.get(peer);
      const reuse = !!fx && fx.from === nd && now - fx.at <= FIX_KEEP && fx.floor === this.journal.floor;
      if (now - (this.lastFixAt.get(peer) ?? -Infinity) < (reuse ? C.FIX_REPEAT / 2 : C.FIX_REPEAT)) continue;
      this.lastFixAt.set(peer, now);
      if (nd < this.journal.floor) {
        this.rs.add(peer);
        this.stats.rsForced++;
        continue;
      }
      if (!reuse) {
        fx = this._buildFix(peer, seat, nd, seq, now);
        if (!fx) continue;
        this.fixCache.set(peer, fx);
      } else this.stats.fixRepeats++;
      for (let i = 0; i < fx.parts.length; i++) {
        this.t.send('bulk', { k: 'f', e: this.epoch, to: peer, id: fx.id, from: fx.from, upto: fx.upto, i, n: fx.parts.length, d: fx.parts[i] }, PRIO.fix);
        this.stats.fixParts++;
      }
      this.stats.fixes++;
    }
  }

  _buildFix(peer, seat, nd, seq, now) {
    const payload = buildPayload(this.a, this.journal.since(nd));
    payload.a = this._ackTable();
    const cut = now - C.REJECT_WINDOW;
    while (this.recentRejects.length && this.recentRejects[0].at < cut) this.recentRejects.shift();
    const r = this.recentRejects.filter((x) => x.seat === seat).map((x) => [x.seat, x.lseq, x.code]);
    if (r.length) payload.r = r;
    const text = JSON.stringify(payload);
    if (utf8Length(text) > this.fixMax) {
      this.rs.add(peer);
      this.snapMinS0 = seq;
      this.stats.rsForced++;
      return null;
    }
    const overhead = 150 + peer.length;
    const parts = splitForJson(text, C.MSG_BYTES - overhead, C.CHUNK_CHARS);
    return { id: 'f' + (++this.fixCounter).toString(36), from: nd, upto: seq, parts, at: now, floor: this.journal.floor };
  }

  // ---------- snapshot carousel (§5.8) ----------

  _serveSnapshot(now) {
    const receivers = [];
    for (const [peer] of this.adm) {
      const p = this.peerMap.get(peer);
      if (p && p.state.ep === this.epoch && isObj(p.state.rx)) receivers.push(p);
    }
    for (const peer of Array.from(this.receivers.keys())) {
      if (!receivers.some((p) => p.id === peer)) this.receivers.delete(peer);
    }
    if (receivers.length === 0) return;
    if (this.snapPending) return;
    const snap = this.snap;
    const allZ = receivers.every((p) => p.state.zc === 1);
    const stale = !snap || snap.ep !== this.epoch || now - snap.createdAt > C.SNAP_CACHE ||
      snap.s0 < this.journal.floor || snap.s0 < this.snapMinS0 || (snap.z === 1 && !allZ);
    if (stale) {
      this._makeSnapshot(now, this.compression && allZ);
      return;
    }
    // per-receiver bookkeeping
    let restart = false;
    for (const p of receivers) {
      const rx = p.state.rx;
      let r = this.receivers.get(p.id);
      if (!r) {
        r = { snapId: null, h: -1, progressAt: now, seenAt: now };
        this.receivers.set(p.id, r);
        if (rx.id !== snap.id && snap.cursor >= snap.n) restart = true; // a new receiver after the pass
      }
      const h = isInt(rx.h) ? rx.h : 0;
      if (rx.id !== r.snapId || h !== r.h) {
        r.snapId = rx.id;
        r.h = h;
        r.progressAt = now;
      } else if ((h === 0 || rx.id !== snap.id) && now - r.progressAt > C.SNAP_RESTART && snap.cursor >= snap.n) {
        restart = true;
        r.progressAt = now;
      }
    }
    if (restart) snap.cursor = 0;
    // 10 chunks per second
    this.snapTokens = Math.min(3, this.snapTokens + ((now - this.snapTokAt) * C.SNAP_HZ) / 1000);
    this.snapTokAt = now;
    while (this.snapTokens >= 1) {
      let i = -1;
      if (snap.cursor < snap.n) i = snap.cursor++;
      else {
        for (const p of receivers) {
          const rx = p.state.rx;
          if (rx.id !== snap.id || typeof rx.m !== 'string' || !rx.m) continue;
          for (const part of rx.m.split(',', 32)) {
            const k = +part;
            if (Number.isInteger(k) && k >= 0 && k < snap.n && now - snap.sentAt[k] > C.SNAP_RESEND && (i < 0 || k < i)) i = k;
          }
        }
      }
      if (i < 0) break;
      this.snapTokens -= 1;
      snap.sentAt[i] = now;
      this.t.send('bulk', { k: 's', e: this.epoch, id: snap.id, s0: snap.s0, i, n: snap.n, z: snap.z, c: snap.c, d: snap.chunks[i] }, PRIO.snap);
      this.stats.chunks++;
    }
  }

  _makeSnapshot(now, compress) {
    this.flushNow(); // the snapshot equals the state at s0 = hd
    const s0 = this.journal.seq;
    const { json, rle } = this.a.makeSnapshot();
    const local = this.a.local();
    json.net = { s0, ep: this.epoch, host: Array.isArray(local.p) ? local.p.slice(0, 4) : null };
    if (local.nm) json.name = `${local.nm}'s World`;
    const id = 's' + (++this.snapCounter).toString(36);
    const epoch = this.epoch;
    this.snapPending = true;
    this.stats.snapshots++;
    frameSnapshot(json, rle, { compress, chunkChars: C.CHUNK_CHARS })
      .then((fr) => {
        this.snapPending = false;
        if (!this.live || this.epoch !== epoch) return;
        this.snap = {
          id, s0, ep: epoch, z: fr.z, c: fr.c, chunks: fr.chunks, n: fr.chunks.length,
          createdAt: now, sentAt: new Array(fr.chunks.length).fill(-Infinity), cursor: 0,
        };
        this.receivers.clear();
      })
      .catch((err) => {
        this.snapPending = false;
        console.error('[net] snapshot failed', err);
      });
  }

  // ---------- presence (§5.4) ----------

  _set(patch, key, value, text) {
    const t = text ?? JSON.stringify(value);
    if (this.presenceText.get(key) === t) return false;
    this.presenceText.set(key, t);
    patch[key] = value;
    return true;
  }

  _composePresence(now) {
    const patch = {};
    let urgent = false;
    const a = this.a;
    const local = a.local();
    avatarFields(this, patch, local, now);
    this._set(patch, 'hd', this.journal.seq);
    this._set(patch, 'fl', this.journal.floor);
    const ak = this._ackTable();
    if (this._set(patch, 'ak', ak)) urgent = true;
    if (this._set(patch, 'adm', Array.from(this.adm, ([peer, seat]) => [peer, seat]))) urgent = true;
    if (this._set(patch, 'no', Array.from(this.no, ([peer, why]) => [peer, why]))) urgent = true;
    if (this._set(patch, 'rs', Array.from(this.rs))) urgent = true;
    if (this._set(patch, 'ru', [this.rules.build, this.rules.mine])) urgent = true;
    // clock: every 5 s, and at once after a jump
    const tm = a.time();
    if (Array.isArray(tm)) {
      const prev = this.tmSent;
      const jumped = !prev || tm[1] !== prev[1] || !!tm[2] !== !!prev[2] ||
        Math.abs(tm[0] - (prev[0] + (prev[2] ? 0 : (now - this.tmAt) / 1000 / C.DAY_LENGTH_S))) > 0.01;
      if (jumped || now - this.tmAt >= C.TIME_REPUBLISH) {
        const v = [Math.round(tm[0] * 10000) / 10000, tm[1] | 0, tm[2] ? 1 : 0];
        this.tmSent = v;
        this.tmAt = now;
        // a jump (someone slept, the clock was set) reaches every friend at once
        if (this._set(patch, 'tm', v) && jumped) urgent = true;
      }
    }
    const wx = a.weather();
    if (typeof wx === 'string') this._set(patch, 'wx', wx);
    const samples = a.actorSamples() || {};
    this._set(patch, 'pt', Array.isArray(samples.pt) && samples.pt.length ? samples.pt.slice(0, 12) : null);
    this._set(patch, 'nx', Array.isArray(samples.nx) && samples.nx.length ? samples.nx.slice(0, 12) : null);
    if (this.hh) this._set(patch, 'hh', this.hh);
    this._set(patch, 'zz', this.zz);
    let keys = 0;
    for (const k in patch) keys++;
    if (keys === 0) return;
    try {
      this.t.setState(patch);
    } catch (err) {
      if (err?.code !== 'too_big') throw err;
      // shrink what can shrink and try once more
      while (this.no.size > 4) this.no.delete(this.no.keys().next().value);
      patch.no = Array.from(this.no, ([peer, why]) => [peer, why]);
      if (patch.pt) patch.pt = patch.pt.slice(0, 6);
      if (patch.nx) patch.nx = patch.nx.slice(0, 4);
      patch.lk = null;
      this.presenceText.clear();
      try {
        this.t.setState(patch);
      } catch {
        console.warn('[net] host presence too big');
      }
    }
    if (urgent) this.t.flushState();
  }

  // ---------- periodic: hashes and local saves ----------

  _periodic(now) {
    if (now - this.lastHashAt >= C.HASH_EVERY && this.journal.seq !== this.lastHashSeq) {
      this.flushNow();
      if (!this.journal.dirty) {
        this.lastHashAt = now;
        this.lastHashSeq = this.journal.seq;
        this.hh = [this.journal.seq, this.blockHash, this.a.entityHash() >>> 0, this.a.plantHash() >>> 0];
      }
    }
    if (now - this.lastSaveAt >= C.HOST_LOCAL_SAVE && this.changedSinceSave) {
      this.lastSaveAt = now;
      this.changedSinceSave = false;
      const save = this.session.env?.saveHost;
      if (typeof save === 'function') {
        Promise.resolve()
          .then(() => save())
          .catch((err) => console.warn('[net] host save failed', err));
      }
    }
  }

  /** Host tab hidden ("taking a nap"). */
  setHidden(hidden) {
    this.zz = hidden ? 1 : 0;
  }

  // ---------- info ----------

  players() {
    const out = [];
    const me = this.t.selfId();
    const local = this.a.local();
    out.push({ peer: me, seat: 0, name: local.nm || '', you: true, host: true, pos: local.p || null, state: this.t.myState?.() || {} });
    for (let s = 1; s <= C.MAX_SEATS; s++) {
      const seat = this.seats[s];
      if (!seat) continue;
      const p = this.peerMap.get(seat.peer);
      out.push({
        peer: seat.peer, seat: s, uid: seat.uid, name: p && typeof p.state.nm === 'string' ? p.state.nm : '',
        you: false, host: false, pos: p && Array.isArray(p.state.p) ? p.state.p : null, away: !p,
        guest: !!p?.guest, state: p ? p.state : null, updatedAt: p ? p.updatedAt : 0,
      });
    }
    return out;
  }

  debug() {
    return {
      epoch: this.epoch, seq: this.journal.seq, floor: this.journal.floor, journalKeys: this.journal.size,
      acks: this._ackTable(), adm: Array.from(this.adm), no: Array.from(this.no), rs: Array.from(this.rs),
      rules: { ...this.rules }, hash: this.hashes(), stats: { ...this.stats },
      seatLog: this.seats.map((s, k) => (k === 0 ? 0 : s ? this.logs.get(s.owner)?.log.length || 0 : 0)),
    };
  }

  /** Current [block, entity, plant] hashes. */
  hashes() {
    return [this.blockHash >>> 0, this.a.entityHash() >>> 0, this.a.plantHash() >>> 0];
  }
}

// ---------- helpers ----------

/** Rate cost of an outbox entry: which bucket and how many tokens. */
function entryCost(e) {
  switch (e[1]) {
    case 'b':
      return { kind: 'cells', n: typeof e[2] === 'string' ? Math.max(1, Math.floor(e[2].length / 9)) : 1 };
    case 'ed':
      return { kind: 'data', n: 1 };
    case 'pf':
    case 'z':
      return { kind: null, n: 0 };
    default:
      return { kind: 'ents', n: 1 };
  }
}

function sameEnt(a, b) {
  if (a === b) return true;
  if (!a || !b) return false;
  for (let k = 0; k < 8; k++) {
    if (k === 7) {
      if (JSON.stringify(a[7] || 0) !== JSON.stringify(b[7] || 0)) return false;
    } else if ((a[k] || 0) !== (b[k] || 0)) return false;
  }
  return true;
}

/**
 * Avatar presence fields for either role: p (moved > 2 cm or turned > 1 degree), st, nm,
 * lk (at most once per second), em / ph (set by emote() / say()).
 */
export function avatarFields(owner, patch, local, now) {
  const p = local.p;
  if (Array.isArray(p) && p.length >= 4 && p.every((v) => typeof v === 'number' && Number.isFinite(v))) {
    const last = owner.lastPos;
    const moved = !last || Math.hypot(p[0] - last[0], p[1] - last[1], p[2] - last[2]) > C.MOVE_EPS ||
      Math.abs(angleDiff(p[3], last[3])) > C.TURN_EPS;
    if (moved) {
      owner.lastPos = [p[0], p[1], p[2], p[3]];
      owner._set(patch, 'p', [round2(p[0]), round2(p[1]), round2(p[2]), round2(p[3])]);
    }
  }
  if (typeof local.st === 'string') owner._set(patch, 'st', cleanText(local.st, 1));
  if (typeof local.nm === 'string') owner._set(patch, 'nm', cleanText(local.nm, 12));
  if (typeof local.lk === 'string' && now - owner.lastLookAt >= C.LOOK_MIN_INTERVAL) {
    if (owner._set(patch, 'lk', cleanText(local.lk, 200))) owner.lastLookAt = now;
  }
  if (owner.emote) owner._set(patch, 'em', owner.emote);
  if (owner.phrase) owner._set(patch, 'ph', owner.phrase);
  // optional: the treat held in her hand (an item key, never free text; §7 "Held treats").
  // Ice cream keys carry '-' between their flavors, so the key rule is HELD_KEY_RE.
  if ('hi' in local) owner._set(patch, 'hi', typeof local.hi === 'string' && HELD_KEY_RE.test(local.hi) ? local.hi : null);
  // optional: the vehicle she drives [key, color, flags, honk, src] (docs/teams/vehicles.md §8.1)
  if ('vh' in local) owner._set(patch, 'vh', parseVehiclePresence(local.vh));
}

function angleDiff(a, b) {
  let d = (a - b) % (2 * Math.PI);
  if (d > Math.PI) d -= 2 * Math.PI;
  if (d < -Math.PI) d += 2 * Math.PI;
  return d;
}
