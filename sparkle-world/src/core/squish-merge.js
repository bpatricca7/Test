// Two copies of one player's squishy toy collection (`profile.squish`), from two devices, a
// backup file or the server: mergeSquish(a, b). Pure and dependency-free (no imports at all), so
// src/core/storage.js, src/account/merge.js and through them the server can use it without
// loading any game module.
//
// Rules (the squish team doc §9.2):
//   - no toy is ever lost: `got`, `glit` and `seen` are unions (the earliest date per key wins);
//   - `base` (where the present milestones start): a real base beats a provisional one (`prov`,
//     made from a stale offline copy); two real: the earliest `at`; two provisional: the larger
//     `coins`; an invalid base loses to a valid one; none valid: absent (never made up);
//   - `rest` (the last time every present was opened): the larger `n`, then the larger `coins`;
//   - unknown inner keys (from a newer build) are kept;
//   - only one side an object: that side (a copy); neither: undefined (the key stays absent);
//   - inputs that are not objects are treated as empty and never throw;
//   - the result does not depend on the order, and merging again changes nothing.

const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const KNOWN = new Set(['v', 'got', 'glit', 'seen', 'base', 'rest']);
const copy = (v) => JSON.parse(JSON.stringify(v));
const time = (v) => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  const t = typeof v === 'string' ? Date.parse(v) : NaN;
  return Number.isFinite(t) ? t : null;
};
const str = (v) => {
  try {
    return JSON.stringify(v) || '';
  } catch {
    return '';
  }
};

/** Toys opened (keys in got + glit), known to this build or not. */
function openedOf(s) {
  return (isObj(s.got) ? Object.keys(s.got).length : 0) + (isObj(s.glit) ? Object.keys(s.glit).length : 0);
}

/** The earlier of two dates (a valid date beats an invalid one; ties: the smaller string). */
function earlier(x, y) {
  const tx = time(x), ty = time(y);
  if (tx === null && ty !== null) return y;
  if (ty === null && tx !== null) return x;
  if (tx !== null && ty !== null && tx !== ty) return tx < ty ? x : y;
  return str(x) <= str(y) ? x : y;
}

function union(a, b) {
  const out = {};
  for (const side of [a, b]) {
    if (!isObj(side)) continue;
    for (const [k, v] of Object.entries(side)) out[k] = k in out ? earlier(out[k], v) : v;
  }
  return out;
}

const validBase = (b) => isObj(b) && typeof b.coins === 'number' && Number.isFinite(b.coins) && b.coins >= 0 && time(b.at) !== null;

function pickBase(a, b) {
  const va = validBase(a), vb = validBase(b);
  if (!va && !vb) return undefined;
  if (!vb) return a;
  if (!va) return b;
  const pa = !!a.prov, pb = !!b.prov;
  if (pa !== pb) return pa ? b : a; // a real base beats a provisional one
  const ta = time(a.at), tb = time(b.at);
  if (pa) { // two provisional: the larger coins, then the earliest
    if (a.coins !== b.coins) return a.coins > b.coins ? a : b;
    if (ta !== tb) return ta < tb ? a : b;
  } else { // two real: the earliest, then the larger coins
    if (ta !== tb) return ta < tb ? a : b;
    if (a.coins !== b.coins) return a.coins > b.coins ? a : b;
  }
  return str(a) >= str(b) ? a : b;
}

const validRest = (r) => isObj(r) && Number.isInteger(r.n) && r.n >= 0 && typeof r.coins === 'number' && Number.isFinite(r.coins) && r.coins >= 0;

function pickRest(a, b) {
  const va = validRest(a), vb = validRest(b);
  if (!va && !vb) return undefined;
  if (!vb) return a;
  if (!va) return b;
  if (a.n !== b.n) return a.n > b.n ? a : b;
  if (a.coins !== b.coins) return a.coins > b.coins ? a : b;
  return str(a) >= str(b) ? a : b;
}

export function mergeSquish(a, b) {
  const oa = isObj(a), ob = isObj(b);
  if (!oa && !ob) return undefined;
  if (!ob) return copy(a);
  if (!oa) return copy(b);
  const na = openedOf(a), nb = openedOf(b);
  const out = {};
  // unknown keys: the side with more toys opened (ties: the larger value, so the order never matters)
  for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
    if (KNOWN.has(k)) continue;
    if (!(k in b)) out[k] = a[k];
    else if (!(k in a)) out[k] = b[k];
    else if (na !== nb) out[k] = na > nb ? a[k] : b[k];
    else out[k] = str(a[k]) >= str(b[k]) ? a[k] : b[k];
  }
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 1);
  out.v = Math.max(num(a.v), num(b.v), 1);
  out.got = union(a.got, b.got);
  out.glit = union(a.glit, b.glit);
  out.seen = union(a.seen, b.seen);
  const base = pickBase(a.base, b.base);
  if (base) out.base = base;
  const rest = pickRest(a.rest, b.rest);
  if (rest) out.rest = rest;
  return copy(out);
}
