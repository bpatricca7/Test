// wave 5 (reindeer team, docs/teams/reindeer.md): the pure rules of the reindeer module, no
// three.js scene and no DOM, so tools/test-reindeer.mjs can check them in Node: where a
// reindeer may fly, the pasture herd (how many, where, which names and coats), the daily
// coins (5 a day at most) and the profile record (profile.reindeer, always read with a
// default and cleaned).

import { REINDEER, setReindeerSky } from '../pets/reindeer.js';

export { setReindeerSky as setSky };

/** The words she sees (toasts and hints), in one place. */
export const STRINGS = {
  firstFly: 'Up, up and away! Hold Jump to fly higher.',
  landing: 'Landing!',
  sleighUp: 'The sleigh is flying! Jingle jingle!',
  noSky: 'Reindeer fly in Holiday Village!',
  herdHello: 'Reindeer friends live in the pasture!',
};

export const HERD_NAMES = REINDEER.names;
export const HERD_RADIUS = 3; // blocks from the pasture record's middle
export const HERD_MAX = 4;
export const COINS = { fly: 2, sleigh: 3 }; // first of each a day: 5 a day at most
const BITS = { fly: 1, sleigh: 2 };

const fin = Number.isFinite;
const clampInt = (v, lo, hi) => Math.max(lo, Math.min(hi, Math.round(v)));

/** May a ridden reindeer fly in this world? (Holiday Village, or a debug override) */
export function skyAllowed(biome, override = null) {
  if (override === true || override === false) return override;
  return biome === 'holiday';
}

/** How many reindeer a holiday:reindeer record places (n 1..4, default 2), within room left. */
export function herdCount(rec, current, max) {
  if (!rec || typeof rec !== 'object') return 0;
  const n = fin(rec.n) ? clampInt(rec.n, 1, HERD_MAX) : 2;
  const room = Math.max(0, (fin(max) ? max : 12) - (fin(current) ? current : 0));
  return Math.min(n, room);
}

function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Spots for n reindeer round the pasture middle (cell centre), all within HERD_RADIUS. */
export function herdSpots(rec, n, seed = 1) {
  const out = [];
  if (!rec || !fin(rec.x) || !fin(rec.y) || !fin(rec.z)) return out;
  const r = rng(seed);
  const cx = Math.floor(rec.x) + 0.5, cz = Math.floor(rec.z) + 0.5;
  const k = Math.max(0, Math.min(HERD_MAX, n | 0));
  const a0 = r() * Math.PI * 2;
  for (let i = 0; i < k; i++) {
    const a = a0 + (i / Math.max(1, k)) * Math.PI * 2 + (r() - 0.5) * 0.5;
    const d = 1.2 + r() * (HERD_RADIUS - 1.4);
    out.push([cx + Math.sin(a) * d, Math.floor(rec.y), cz + Math.cos(a) * d]);
  }
  return out;
}

/** n different names (a seeded shuffle of the reindeer names). */
export function herdNames(n, seed = 1) {
  const list = HERD_NAMES.slice();
  const r = rng(seed * 31 + 7);
  for (let i = list.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [list[i], list[j]] = [list[j], list[i]];
  }
  return list.slice(0, Math.max(0, Math.min(list.length, n | 0)));
}

/** n coats, different where they can be. */
export function herdCoats(n, seed = 1) {
  const keys = REINDEER.variants.map((v) => v.key);
  const r = rng(seed * 17 + 3);
  const start = Math.floor(r() * keys.length);
  const out = [];
  for (let i = 0; i < Math.max(0, n | 0); i++) out.push(keys[(start + i * 2 + Math.floor(i / 3)) % keys.length]);
  return out;
}

/** yyyymmdd of a date (local time). */
export function dayStamp(d = new Date()) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/**
 * profile.reindeer, cleaned: { coinDay, coinMask, petted, rides, flights, sleighFlights }.
 * Creates it when missing; junk numbers become 0. Returns the record kept on the profile.
 */
export function state(profile) {
  if (!profile || typeof profile !== 'object') return { coinDay: 0, coinMask: 0, petted: 0, rides: 0, flights: 0, sleighFlights: 0 };
  let s = profile.reindeer;
  if (!s || typeof s !== 'object' || Array.isArray(s)) s = profile.reindeer = {};
  for (const k of ['coinDay', 'coinMask', 'petted', 'rides', 'flights', 'sleighFlights']) {
    const v = s[k];
    s[k] = fin(v) && v >= 0 ? Math.floor(v) : 0;
  }
  s.coinMask &= 3;
  return s;
}

/**
 * The coins this action pays today (0 when it already paid today or it pays nothing), and
 * marks it paid. reason 'fly' (a reindeer's first flight of the day, 2) or 'sleigh' (the
 * sleigh's first flight of the day, 3): 5 a day at most.
 */
export function coinFor(profile, reason, day = dayStamp()) {
  const bit = BITS[reason];
  if (!bit) return 0;
  const s = state(profile);
  if (s.coinDay !== day) {
    s.coinDay = day;
    s.coinMask = 0;
  }
  if (s.coinMask & bit) return 0;
  s.coinMask |= bit;
  return COINS[reason];
}
