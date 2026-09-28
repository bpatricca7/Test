// Multiplayer protocol: constants (docs/MULTIPLAYER.md §5.12), topics, codes and room names,
// friendly messages (§12), shape validation of untrusted input, and the GameAdapter typedef
// (§9.0). Pure data and small functions: no DOM, no game imports, runs in Node tests.

export const PROTOCOL = 1; // presence `v`: protocol major; peers must match
export const ROOM_PREFIX = 'sw1-';

/** The 12 code pictures; the word is also the code token (§5.1). */
export const CODE_WORDS = Object.freeze([
  'heart', 'star', 'moon', 'sun', 'flower', 'rainbow', 'cat', 'bunny', 'fish', 'cupcake', 'crown', 'gem',
]);
export const CODE_LENGTH = 4;

/** Transport topic -> room topic (§5.3). */
export const TOPICS = Object.freeze({ op: 'sw.op', bulk: 'sw.bulk', ctl: 'sw.ctl' });
/** Send priorities: lower goes first. Presence flushes always go before all of them. */
export const PRIO = Object.freeze({ ctl: 0, op: 1, fix: 2, snap: 3 });

export const LIMITS = Object.freeze({ msgBytes: 3900, stateBytes: 3900, strBytes: 1000, rate: 30, burst: 60 });

/** §5.12 constants (times in ms unless named otherwise). */
export const C = Object.freeze({
  MAX_PLAYERS: 4, // host plus seats 1..3
  MAX_SEATS: 3,
  MSG_BYTES: 3900,
  STATE_BYTES: 3900,
  STR_BYTES: 1000,
  BUCKET_RATE: 30,
  BUCKET_BURST: 60,
  PRESENCE_MIN: 100, // <= 10 Hz
  PRESENCE_FLUSH: 30, // flushState: send within 30 ms
  TICK: 100,
  FLUSH_MIN: 100,
  OUTBOX_BYTES: 2800,
  OUTBOX_ENTRIES: 40,
  ENTRY_BYTES: 1000,
  CELLS_PER_B: 100,
  GAP_WAIT: 400,
  FIX_REPEAT: 2000,
  FIX_MAX: 48 * 1024,
  CHUNK_CHARS: 3600,
  SNAP_HZ: 10,
  SNAP_CACHE: 60000,
  SNAP_RESEND: 800, // re-send a missing chunk only if not sent in the last 800 ms
  SNAP_RESTART: 3000, // restart the pass for a receiver with no progress
  SNAP_STALL: 60000,
  SNAP_TRIES: 3, // first try plus two retries
  JOURNAL_MAX_KEYS: 60000,
  BUFFER_MAX: 400,
  FIND_HOST: 8000,
  KNOCK_GIVEUP: 90000,
  HOST_PICK_WAIT: 2000,
  HOST_PICK_TRIES: 3,
  HOST_AWAY_GRACE: 60000,
  SEAT_HOLD: 60000,
  HASH_EVERY: 10000,
  HOST_LOCAL_SAVE: 15000,
  TIME_REPUBLISH: 5000,
  DAY_LENGTH_S: 720, // game.time.dayLength (DESIGN §2 daynight)
  REJECT_WINDOW: 30000, // a fix carries the seat's rejections from the last 30 s
  REJECT_TOAST_GAP: 4000,
  LOOK_MIN_INTERVAL: 1000,
  PHRASE_MIN_INTERVAL: 2000,
  MOVE_EPS: 0.02, // re-send position after moving > 2 cm
  TURN_EPS: Math.PI / 180, // or turning > 1 degree
  DISCONNECT_DEBOUNCE: 2000,
  QUEUE_MAX_AGE: 2000,
  NO_LIST_MAX: 16,
  ENTITY_DATA_BYTES: 600,
  ENTITY_DATA_DEPTH: 3,
  SEAT_UID_SPAN: 1000000, // seat s allocates entity uids in [s*1e6 + 1, (s+1)*1e6)
  PREFAB_EVERY: 20000,
  SLEEP_EVERY: 60000,
});

/** Guest rate limits per seat (token buckets: rate per second, burst). */
export const RATE = Object.freeze({
  cells: [400, 800],
  ents: [20, 40],
  data: [10, 20],
});

/** Rejection codes (§8.1). */
export const REJECT = Object.freeze({ CONFLICT: 1, PROTECTED: 2, PAUSED: 3, LIMIT: 4, INVALID: 5 });

/** `no` reasons in host presence (§5.4). */
export const NO = Object.freeze({ DENY: 'd', KICK: 'k', FULL: 'f', VERSION: 'v' });

/** Entity data fields any admitted friend may toggle, even on the host's things (§8.1). */
export const ANY_FIELDS = Object.freeze(['open', 'on', 'ch', 'art', 'bloom', 'conn']);

/** Outbox op kinds a guest may send (§5.6). */
export const OP_KINDS = Object.freeze(['b', 'e+', 'e-', 'er', 'ed', 'p+', 'p-', 'ph', 'pf', 'pu', 'z']);

/** Session states (§6). */
export const STATES = Object.freeze([
  'idle', 'h.opening', 'h.live', 'h.closing',
  'g.joining', 'g.finding', 'g.knocking', 'g.loading', 'g.live', 'g.waiting', 'g.leaving',
]);

/**
 * Friendly texts for every session message (§12). `{host}` is the host's sanitized name;
 * `{name}` another player's. The UI may use its own copies; the core uses these for toasts.
 */
export const MESSAGES = Object.freeze({
  unavailable: '',
  cannot_host: "You can join a friend's world!",
  cannot_host_small: 'Grown-ups: inviting friends needs Contributor access to Sparkle World.',
  no_rooms: "Playing together isn't turned on for this account. Ask a grown-up!",
  busy: 'Lots of games right now! Try again in a minute.',
  transient: 'The magic mail is slow. Try again?',
  no_host: 'Nobody is playing with those pictures. Check them with your friend!',
  version: 'Your game needs a refresh!',
  denied: "{host} can't play right now. Maybe later!",
  no_answer: "{host} didn't hear the knock. Knock again?",
  full: "{host}'s world is full of friends right now!",
  snapshot_failed: "The world got lost on the way. Let's try again!",
  reconnecting: 'Reconnecting…',
  host_away: '{host} is taking a little break…',
  host_gone: '{host} went home. Her world is saved at her house!',
  ended: '{host} went home. Her world is saved at her house!',
  kicked: "Time to go home! Let's play in your own world.",
  paused: '{host} paused building.',
  building_paused: '{host} paused building.',
  building_on: 'You can build again!',
  reject_1: 'Oops! Someone else changed that.',
  reject_2: "That's someone else's! Build your own next to it.",
  reject_3: '{host} paused building.',
  reject_4: 'Slow down, sparkle builder!',
  reject_5: 'Oops! Someone else changed that.',
  prefab_fizzled: "The magic fizzled! Something of {host}'s is in the way.",
  prefab_rest: 'The magic needs a little rest! Try again in a moment.',
  prefab_changed: 'Oops! Something changed there.',
  tidied: "{host} tidied up. Let's build something new together!",
  pet_owner: "That's {host}'s pet! Ask her to help.",
  backup_failed: "Your world couldn't make a safety copy, so friends can't come in right now.",
  fatal: 'Playing together stopped.',
  resync: 'Fixing a few sparkles…',
  joined: '{name} is here!',
  you_joined: "You're in {host}'s world!",
  made_prefab: '{name} made a {prefab}!',
  slept: '{name} went to sleep. Good morning, everyone!',
  summary: 'Playing together is over! Everything is saved.',
  // family accounts (docs/ACCOUNTS.md §7.7); player_gone has no words: the page goes back to "Who's playing?"
  signed_out: 'Ask a grown-up to sign in to Sparkle World on this device.',
  not_entitled: 'Sparkle World is resting. Ask a grown-up to wake it up!',
  friends_off: 'Ask a grown-up to turn on Play with Friends for you.',
  friends_locked: "Playing with friends isn't ready yet. A grown-up can check the Family page.",
  // a child with an account and a device without one never play together (optional mode)
  accounts_mixed: "You can't play with this friend yet: both of you need a grown-up to set up Sparkle World.",
  cannot_host_acct: 'Grown-ups: see the Family page.',
});

/** Fill `{host}` / `{name}` / `{prefab}` in a message. */
export function messageText(code, vars = {}) {
  const t = MESSAGES[code];
  if (!t) return '';
  return t.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null && vars[k] !== '' ? String(vars[k]) : k === 'host' ? 'your friend' : 'A friend'));
}

// ---------- codes and room names ----------

const WORD_SET = new Set(CODE_WORDS);
const ROOM_RE = /^[a-z0-9][a-z0-9_.-]{0,47}$/;
const TOPIC_RE = /^[a-z][a-z0-9_.-]{0,47}$/;

export function isRoomName(name) {
  return typeof name === 'string' && ROOM_RE.test(name);
}
export function isTopic(t) {
  return typeof t === 'string' && TOPIC_RE.test(t);
}

/** ['heart','star','moon','cat'] -> 'sw1-heart-star-moon-cat' (null for a bad code). */
export function roomNameFor(words) {
  if (!isCode(words)) return null;
  return ROOM_PREFIX + words.join('-');
}

/** 'sw1-heart-star-moon-cat' -> words, or null. */
export function codeFromRoom(name) {
  if (typeof name !== 'string' || !name.startsWith(ROOM_PREFIX)) return null;
  const words = name.slice(ROOM_PREFIX.length).split('-');
  return isCode(words) ? words : null;
}

export function isCode(words) {
  return Array.isArray(words) && words.length === CODE_LENGTH && words.every((w) => WORD_SET.has(w));
}

/** A random code (repeats allowed: 12^4 = 20,736 codes). */
export function randomCode(rand = Math.random) {
  const out = [];
  for (let k = 0; k < CODE_LENGTH; k++) out.push(CODE_WORDS[Math.floor(rand() * CODE_WORDS.length) % CODE_WORDS.length]);
  return out;
}

/** 6 random base36 characters: a host epoch (new on every host start or reload). */
export function randomEpoch(rand = Math.random) {
  let s = '';
  for (let k = 0; k < 6; k++) s += Math.floor(rand() * 36).toString(36);
  return s;
}

// ---------- small validators for untrusted input ----------

export const isInt = (v) => typeof v === 'number' && Number.isInteger(v);
export const isIntIn = (v, lo, hi) => isInt(v) && v >= lo && v <= hi;
export const isStr = (v, max = 1000) => typeof v === 'string' && v.length <= max;
export const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
export const IDENT_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
/**
 * Presence `hi`, the treat in a player's hand: an item key, never free text. Shop treats are
 * 'treat_<candy>' or 'treat_ic_<style>_<flavor-flavor-flavor>_<toppings>' (at most 47 chars).
 */
export const HELD_KEY_RE = /^[a-z0-9_-]{1,48}$/;

/** Depth of a JSON value (a scalar is 0, {} or [] is 1). */
export function jsonDepth(v, limit = 16) {
  if (v === null || typeof v !== 'object') return 0;
  if (limit <= 0) return Infinity;
  let d = 0;
  if (Array.isArray(v)) {
    for (let k = 0; k < v.length; k++) d = Math.max(d, jsonDepth(v[k], limit - 1));
  } else {
    for (const k in v) d = Math.max(d, jsonDepth(v[k], limit - 1));
  }
  return d + 1;
}

/** Plain JSON object check (no prototypes other than Object, identifier-safe keys). */
export function isPlainData(v, maxDepth = 3) {
  if (!isObj(v)) return false;
  if (Object.getPrototypeOf(v) !== Object.prototype) return false;
  return jsonDepth(v, maxDepth + 1) <= maxDepth;
}

const INVISIBLE_RE = /[\u0000-\u001f\u007f-\u009f\u00ad\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff]/;

/**
 * Whether a value may travel inside presence (room.d.ts): identifier keys at every level,
 * strings <= 1,000 B without control or invisible characters, finite numbers, bounded depth.
 * The guest checks entity data before it goes into her outbox: one bad key would make the
 * platform refuse her whole presence.
 */
export function presenceSafe(v, depth = 0, maxDepth = 5) {
  if (v === null || typeof v === 'boolean') return true;
  if (typeof v === 'number') return Number.isFinite(v);
  if (typeof v === 'string') return v.length <= C.STR_BYTES && !INVISIBLE_RE.test(v) && utf8Bytes(v) <= C.STR_BYTES;
  if (typeof v !== 'object' || depth >= maxDepth) return false;
  if (Array.isArray(v)) {
    for (let k = 0; k < v.length; k++) if (!presenceSafe(v[k], depth + 1, maxDepth)) return false;
    return true;
  }
  for (const k in v) {
    if (!IDENT_RE.test(k) || k === '__proto__' || k === 'constructor' || k === 'prototype') return false;
    if (!presenceSafe(v[k], depth + 1, maxDepth)) return false;
  }
  return true;
}

function utf8Bytes(s) {
  let n = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    n += c < 0x80 ? 1 : c < 0x800 ? 2 : c >= 0xd800 && c <= 0xdbff ? (k++, 4) : 3;
  }
  return n;
}

/** Strip control and invisible characters (names and other short texts for presence). */
export function cleanText(s, max) {
  return typeof s === 'string' ? s.replace(new RegExp(INVISIBLE_RE.source, 'g'), '').slice(0, max) : '';
}

const ENT_KEY_RE = /^[a-z0-9_:.-]{1,64}$/;
export const isEntityKey = (k) => typeof k === 'string' && ENT_KEY_RE.test(k);
const COLOR_RE = /^#?[0-9A-Fa-f]{3,8}$/;
export const isColor = (c) => c === 0 || c === null || (typeof c === 'string' && COLOR_RE.test(c));

/**
 * Validate a host batch or fix payload (untrusted shape). Returns a cleaned object with only
 * known, well-typed fields, or null when the message is unusable.
 */
export function parsePayload(d) {
  if (!isObj(d)) return null;
  const out = {};
  if (d.a !== undefined) {
    if (!Array.isArray(d.a) || d.a.length > 8) return null;
    out.a = d.a.filter((x) => Array.isArray(x) && isIntIn(x[0], 0, C.MAX_SEATS) && isIntIn(x[1], 0, 2 ** 31));
  }
  if (d.r !== undefined) {
    if (!Array.isArray(d.r)) return null;
    out.r = d.r.filter((x) => Array.isArray(x) && isIntIn(x[0], 1, C.MAX_SEATS) && isIntIn(x[1], 1, 2 ** 31) && isIntIn(x[2], 1, 9));
  }
  if (d.c !== undefined) {
    if (typeof d.c !== 'string' || d.c.length % 7 !== 0) return null;
    out.c = d.c;
  }
  if (d.g !== undefined) {
    if (!Array.isArray(d.g)) return null;
    for (const r of d.g) {
      if (!Array.isArray(r) || r.length !== 7) return null;
      for (let k = 0; k < 6; k++) if (!isIntIn(r[k], 0, 4096)) return null;
      if (typeof r[6] !== 'string') return null;
    }
    out.g = d.g;
  }
  if (d.X !== undefined) {
    if (!Array.isArray(d.X) || !d.X.every((u) => isIntIn(u, 1, 2 ** 31))) return null;
    out.X = d.X;
  }
  if (d.E !== undefined) {
    if (!Array.isArray(d.E)) return null;
    out.E = d.E.filter(isEntityRecord);
  }
  if (d.P !== undefined) {
    if (!Array.isArray(d.P)) return null;
    out.P = d.P.filter((p) => Array.isArray(p) && p.length === 4 && isIntIn(p[0], 0, 2 ** 31) && (p[1] === 0 || isStr(p[1], 64)) && isIntIn(p[2], 0, 9) && isIntIn(p[3], 0, 1));
  }
  if (d.K !== undefined) {
    if (!Array.isArray(d.K)) return null;
    out.K = d.K.filter((k) => Array.isArray(k) && k.length === 3 && isStr(k[0], 32) && isStr(k[1], 64) && (k[2] === 0 || isObj(k[2])));
  }
  if (d.f !== undefined && Array.isArray(d.f)) out.f = d.f.filter((h) => Array.isArray(h) && h.length <= 8);
  return out;
}

/** [uid,key,x,y,z,rot,color|0,data|0,yo,ro] */
export function isEntityRecord(r) {
  return Array.isArray(r) && r.length === 10 && isIntIn(r[0], 1, 2 ** 31) && isEntityKey(r[1]) &&
    isIntIn(r[2], -64, 4096) && isIntIn(r[3], -64, 4096) && isIntIn(r[4], -64, 4096) && isIntIn(r[5], 0, 3) &&
    isColor(r[6]) && (r[7] === 0 || isObj(r[7])) && isInt(r[8]) && isInt(r[9]);
}

/** A sw.op batch: payload fields plus epoch and sequence number. */
export function parseBatch(d) {
  if (!isObj(d) || !isStr(d.e, 16) || !isIntIn(d.s, 1, 2 ** 31)) return null;
  const p = parsePayload(d);
  if (!p) return null;
  p.e = d.e;
  p.s = d.s;
  return p;
}

/** A sw.bulk message: snapshot chunk (k 's') or catch-up part (k 'f'). */
export function parseBulk(d) {
  if (!isObj(d) || !isStr(d.e, 16) || !isStr(d.id, 24) || !isIntIn(d.i, 0, 100000) || !isIntIn(d.n, 1, 100000) || d.i >= d.n) return null;
  if (typeof d.d !== 'string' || d.d.length > C.CHUNK_CHARS) return null;
  if (d.k === 's') {
    if (!isIntIn(d.s0, 0, 2 ** 31) || !isIntIn(d.z, 0, 1) || !isStr(d.c, 8)) return null;
    return { k: 's', e: d.e, id: d.id, s0: d.s0, i: d.i, n: d.n, z: d.z, c: d.c, d: d.d };
  }
  if (d.k === 'f') {
    if (!isStr(d.to, 64) || !isIntIn(d.from, 0, 2 ** 31) || !isIntIn(d.upto, 0, 2 ** 31) || d.upto < d.from) return null;
    return { k: 'f', e: d.e, to: d.to, id: d.id, from: d.from, upto: d.upto, i: d.i, n: d.n, d: d.d };
  }
  return null;
}

/** A sw.ctl message. */
export function parseCtl(d) {
  if (!isObj(d) || typeof d.k !== 'string') return null;
  if (d.k === 'bye') {
    if (!isStr(d.e, 16) || !isStr(d.to, 64) || !['kick', 'end', 'deny'].includes(d.why)) return null;
    return { k: 'bye', e: d.e, to: d.to, why: d.why };
  }
  if (d.k === 'tidy') {
    // the host undid this friend's building: a kind word and a few sparkle spots
    if (!isStr(d.e, 16) || !isStr(d.to, 64) || !isIntIn(d.n, 0, 2 ** 31)) return null;
    const at = Array.isArray(d.at)
      ? d.at.slice(0, 8).filter((c) => Array.isArray(c) && c.length === 3 && c.every((v) => isIntIn(v, -64, 4096)))
      : [];
    return { k: 'tidy', e: d.e, to: d.to, n: d.n, at };
  }
  return { k: d.k };
}

/** Read the fields of a host's presence that the guest relies on, clamped and typed. */
export function readHostState(s) {
  if (!isObj(s) || s.r !== 'h') return null;
  const pairs = (v, max) => (Array.isArray(v) ? v.slice(0, max).filter((x) => Array.isArray(x) && x.length >= 2) : []);
  return {
    v: s.v,
    pv: typeof s.pv === 'string' ? s.pv : '',
    ep: isStr(s.ep, 16) ? s.ep : '',
    hs: typeof s.hs === 'number' ? s.hs : 0,
    nm: typeof s.nm === 'string' ? s.nm.slice(0, 24) : '',
    hd: isIntIn(s.hd, 0, 2 ** 31) ? s.hd : 0,
    fl: isIntIn(s.fl, 0, 2 ** 31) ? s.fl : 0,
    ak: pairs(s.ak, 8).filter((x) => isInt(x[0]) && isInt(x[1])),
    adm: pairs(s.adm, 8).filter((x) => typeof x[0] === 'string' && isIntIn(x[1], 1, C.MAX_SEATS)),
    no: pairs(s.no, 64).filter((x) => typeof x[0] === 'string' && typeof x[1] === 'string'),
    rs: Array.isArray(s.rs) ? s.rs.filter((x) => typeof x === 'string').slice(0, 8) : [],
    ru: Array.isArray(s.ru) ? [s.ru[0] === 0 ? 0 : 1, s.ru[1] === 1 ? 1 : 0] : [1, 0],
    tm: Array.isArray(s.tm) && typeof s.tm[0] === 'number' ? s.tm : null,
    wx: typeof s.wx === 'string' ? s.wx.slice(0, 24) : null,
    pt: Array.isArray(s.pt) ? s.pt : null,
    nx: Array.isArray(s.nx) ? s.nx : null,
    hh: Array.isArray(s.hh) && s.hh.length === 4 && s.hh.every(isInt) ? s.hh : null,
    zz: s.zz === 1 ? 1 : 0,
    end: s.end === 1 ? 1 : 0,
  };
}

/**
 * @typedef {object} GameAdapterHooks  What the net core gives the adapter in attach().
 * @property {(i:number, prev:number, id:number) => void} cell  every World.set (also silent ones)
 * @property {(kind:'add'|'del'|'rot'|'data', uid:number, before:any, after:any) => void} ent
 *   'add': null, rec | 'del': rec, null | 'rot': rotBefore, rotAfter | 'data': dataBefore, patch
 *   (rec = [uid,key,x,y,z,rot,color|0,data|0,yo,ro])
 * @property {(kind:'add'|'del'|'stage'|'harvest', i:number, before:?Array, after:?Array) => void} plant
 *   before/after = [crop, stage] | null
 * @property {(kind:string, id:string) => void} actor  host only: an actor record changed
 */

/**
 * GameAdapter: the frozen boundary between the net core and the game (§9.0).
 * src/net/adapter.js implements it over the real game; tools/net/fake-adapter.mjs over plain
 * arrays and Maps. host.js and guest.js call nothing else in the game.
 *
 * @typedef {object} GameAdapter
 * ---- lifecycle ----
 * @property {(role:'host'|'guest', hooks:GameAdapterHooks, info?:{seat:number}) => void} attach
 *   Installs world.onCell, entities.onChange, garden.onChange and the actor touch; sets
 *   entities.uidBase (guest: seat * 1e6; `info.seat` is passed as a convenience), pets remote
 *   mode and weather.auto = false (guest). The hooks must stay installed across
 *   enterSnapshot() (a new World object needs its onCell set again).
 * @property {() => void} detach
 * ---- reading current values (host encodes batches, fixes and hashes from these) ----
 * @property {() => {sx:number, sy:number, sz:number}} size
 * @property {(i:number) => number} getCell
 * @property {(i:number) => number[]} coords  [x, y, z]
 * @property {(uid:number) => ?Array} entityRecord  [uid,key,x,y,z,rot,color|0,data|0,yo,ro] | null
 * @property {(i:number) => ?Array} plantRecord  [i,crop,stage,wet] | null
 * @property {(kind:string, id:string) => ?Array} actorRecord  [kind,id,rec] | null
 * @property {() => {pt:Array, nx:Array}} actorSamples
 * @property {(id:number) => boolean} isFree  classify(): natural || tree || leaves || plant || liquid
 * @property {(id:number) => boolean} isSolid
 * @property {(i:number) => boolean} occupied  an entity covers cell i
 * @property {() => number} entityHash  uint32 (use codec.hashEntityRecords)
 * @property {() => number} plantHash  uint32 (use codec.hashPlantRecords)
 * @property {(lo:number, hi:number) => number} maxUidInRange  0 when none
 * ---- snapshot ----
 * @property {() => {json:object, rle:Uint8Array}} makeSnapshot  state at the call
 * @property {(json:object, rle:Uint8Array) => Promise<boolean>} enterSnapshot  guest
 * ---- guest: silent apply of host data (the core sets remoteApplying around it) ----
 * @property {(p:{X?:number[], cells?:number[], E?:Array[], P?:Array[], K?:Array[]}) => {cells:number, ents:number}} applyPayload
 *   Order: X, cells (world.batch), E (tables first), P, K; then 'net:applied' + unstick.
 *   `cells` is the decoded flat list [i, id, i, id, ...] (the core decodes `c`/`g` and drops
 *   keys the guest is still predicting). A P entry with crop 0 means "no plant"; a K entry with
 *   rec 0 means "removed". E records replace the whole entity (force placement: the host is
 *   the truth); records with unchanged data should skip refresh().
 * ---- host: execute validated guest ops (called inside net.exec(seat)) ----
 * @property {(pairs:number[]) => void} setCells  [i, id, i, id, ...]; record:true; batch when > 8
 * @property {(key:string, x:number, y:number, z:number, rot:number, ignoreUid:?number) => boolean} canPlaceEntity
 *   players ignored; false for an unknown key
 * @property {(rec:Array) => boolean} placeEntity  history off, events and fx on, uid from rec
 * @property {(uid:number) => boolean} removeEntity
 * @property {(uid:number, rot:number) => boolean} rotateEntity
 * @property {(uid:number, patch:object) => boolean} patchEntity
 * @property {(uid:number) => number[]} ridersOf  uids of items standing on it
 * @property {(i:number) => ?Array} plantAt  [crop, stage] | null
 * @property {(i:number) => boolean} soilOk  farmland under the cell
 * @property {(crop:string, x:number, y:number, z:number) => boolean} addPlant  false: unknown crop
 * @property {(i:number) => boolean} removePlant
 * @property {(i:number) => boolean} harvestPlant  the state change of harvest(), no reward or fx
 * @property {(i:number) => void} adoptWet  called for every cell a guest op changed; the adapter
 *   adds a wet timer when the new block is farmland_wet (ignores other cells)
 * @property {(key:string, pl:{x:number,y:number,z:number,rot:number}, policy:(diff:{cells:number[], ents:number[]}) => boolean) => {ok:boolean, code?:number, name?:string}} prefab
 *   game.prefabs.applyRemote. diff.cells is flat [i, before, after, ...]; diff.ents the uids the
 *   commit would remove. policy false -> {ok:false, code:2}. Bad plan/bounds -> code 5.
 * @property {() => void} skipToMorning
 * ---- environment (both roles) ----
 * @property {() => {p:number[], st:string, nm:string, lk:string}} local  my own presence
 * @property {() => Array} time  [dayTime, day, frozen]
 * @property {(tm:Array, ageMs:number) => void} applyTime  guest: follow the host clock
 * @property {() => string} weather
 * @property {(kind:string) => void} applyWeather
 * @property {(text:string, icon?:string) => void} toast
 * @property {(kind:string, x:number, y:number, z:number) => void} celebrate
 * @property {() => void} unstick
 * ---- optional extensions (checked with ?.) ----
 * @property {() => boolean} [inSystems]  true while game._inSystems (host: author map; guest: no recording)
 * @property {(samples:{pt:?Array, nx:?Array}, ageMs:number) => void} [applySamples]  guest: pet/NPC motion
 * @property {(kind:string, lseq:number, ok:boolean) => void} [resolveIntent]  guest: 'pf' ack -> prefabs.resolveRemote
 * @property {(fn:() => void) => void} [historyGroup]  host: one Undo group (per-friend "Undo building")
 */
