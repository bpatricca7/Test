// Wire codecs for multiplayer (docs/MULTIPLAYER.md §5.3, §5.8, §5.11, §5.13):
// cell strings, region RLE, the look token string, snapshot framing (deflate, crc, chunks),
// stableStringify, fnv1a32 and the block-hash mix. Pure functions; runs in Node and browsers.

import {
  normalizeLook, HAIR_STYLES, HAIR_MIXES, SMILES, TOPS, BOTTOMS, DRESSES, PATTERNS, SHOES,
  HEAD_ACC, FACE_ACC, BACK_ACC, NECK_ACC, HAND_ACC, BROWS,
  SEA_FORMS, SEA_COLORS,
} from '../player/wardrobe-data.js';

// ---------- base36 / hex digits ----------

const DIG = '0123456789abcdefghijklmnopqrstuvwxyz';
const DIGVAL = new Int8Array(128).fill(-1);
for (let k = 0; k < 36; k++) {
  DIGVAL[DIG.charCodeAt(k)] = k;
  if (k >= 10) DIGVAL[DIG.toUpperCase().charCodeAt(k)] = k;
}

/** Value of `len` base-`radix` digits of s starting at `at`, or -1 when malformed. */
function readNum(s, at, len, radix) {
  let v = 0;
  for (let k = 0; k < len; k++) {
    const c = s.charCodeAt(at + k);
    const d = c < 128 ? DIGVAL[c] : -1;
    if (d < 0 || d >= radix) return -1;
    v = v * radix + d;
  }
  return v;
}

function b36(i, width) {
  let s = i.toString(36);
  while (s.length < width) s = '0' + s;
  return s;
}
const HEX2 = [];
for (let k = 0; k < 256; k++) HEX2.push((k < 16 ? '0' : '') + k.toString(16));

export const MAX_CELL_INDEX = 36 ** 5 - 1; // 5 base36 digits

// ---------- cells: `c` (7 chars) and outbox `b` (9 chars) ----------

/** [i, id, i, id, ...] -> 7 chars per cell: idx base36 (5, zero padded) + id hex (2). */
export function packCells(pairs, from = 0, to = pairs.length) {
  let s = '';
  for (let k = from; k < to; k += 2) s += b36(pairs[k], 5) + HEX2[pairs[k + 1] & 255];
  return s;
}

/** Inverse of packCells; appends to `out`. Returns out, or null when malformed. */
export function unpackCells(s, out = []) {
  if (typeof s !== 'string' || s.length % 7 !== 0) return null;
  for (let k = 0; k < s.length; k += 7) {
    const i = readNum(s, k, 5, 36);
    const id = readNum(s, k + 5, 2, 16);
    if (i < 0 || id < 0) return null;
    out.push(i, id);
  }
  return out;
}

/** [i, before, after, ...] -> 9 chars per cell: idx (5 base36) + before (2 hex) + after (2 hex). */
export function packB(triples, from = 0, to = triples.length) {
  let s = '';
  for (let k = from; k < to; k += 3) s += b36(triples[k], 5) + HEX2[triples[k + 1] & 255] + HEX2[triples[k + 2] & 255];
  return s;
}

/** Inverse of packB -> flat triples, or null when malformed. */
export function unpackB(s, out = []) {
  if (typeof s !== 'string' || s.length % 9 !== 0) return null;
  for (let k = 0; k < s.length; k += 9) {
    const i = readNum(s, k, 5, 36);
    const b = readNum(s, k + 5, 2, 16);
    const a = readNum(s, k + 7, 2, 16);
    if (i < 0 || b < 0 || a < 0) return null;
    out.push(i, b, a);
  }
  return out;
}

// ---------- RLE (id byte + LEB128 run) and base64 ----------

/** RLE-encode a byte array (same format as World.encodeBlocks). */
export function rleEncode(src) {
  let out = new Uint8Array(Math.max(64, src.length >> 4));
  let o = 0;
  const put = (b) => {
    if (o === out.length) {
      const bigger = new Uint8Array(out.length * 2);
      bigger.set(out);
      out = bigger;
    }
    out[o++] = b;
  };
  let i = 0;
  const n = src.length;
  while (i < n) {
    const id = src[i];
    let run = 1;
    while (i + run < n && src[i + run] === id) run++;
    put(id);
    let r = run;
    while (r >= 0x80) { put((r & 0x7f) | 0x80); r >>>= 7; }
    put(r);
    i += run;
  }
  return out.slice(0, o);
}

/** Decode RLE into `dst` (a Uint8Array of the expected length). Returns cells written, or -1. */
export function rleDecode(bytes, dst) {
  let o = 0, i = 0;
  while (i < bytes.length) {
    const id = bytes[i++];
    let run = 0, shift = 0, b;
    do {
      if (i >= bytes.length || shift > 28) return -1;
      b = bytes[i++];
      run |= (b & 0x7f) << shift;
      shift += 7;
    } while (b & 0x80);
    if (run <= 0 || o + run > dst.length) return -1;
    dst.fill(id, o, o + run);
    o += run;
  }
  return o;
}

export function bytesToBase64(bytes) {
  let s = '';
  const step = 0x8000;
  for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode.apply(null, bytes.subarray(i, i + step));
  return btoa(s);
}

export function base64ToBytes(b64) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ---------- regions `g` ----------

/**
 * Region RLE of the CURRENT ids in a box (order x fastest, then z, then y, like world.blocks),
 * base64. getCell(i) reads one cell; sx/sz are the world size.
 */
export function encodeRegion(getCell, sx, sz, x0, y0, z0, dx, dy, dz) {
  let out = new Uint8Array(64);
  let o = 0;
  const put = (b) => {
    if (o === out.length) {
      const bigger = new Uint8Array(out.length * 2);
      bigger.set(out);
      out = bigger;
    }
    out[o++] = b;
  };
  let cur = -1, run = 0;
  const flush = () => {
    put(cur);
    let r = run;
    while (r >= 0x80) { put((r & 0x7f) | 0x80); r >>>= 7; }
    put(r);
  };
  for (let y = y0; y < y0 + dy; y++) {
    for (let z = z0; z < z0 + dz; z++) {
      let i = (y * sz + z) * sx + x0;
      for (let x = 0; x < dx; x++, i++) {
        const id = getCell(i);
        if (id === cur) run++;
        else {
          if (run > 0) flush();
          cur = id;
          run = 1;
        }
      }
    }
  }
  if (run > 0) flush();
  return bytesToBase64(out.subarray(0, o));
}

/**
 * Decode a region into flat [i, id, ...] pairs appended to `out`. Returns the number of
 * cells, or -1 when malformed (wrong length, bad base64).
 */
export function decodeRegion(region, sx, sz, out) {
  const [x0, y0, z0, dx, dy, dz, b64] = region;
  const n = dx * dy * dz;
  if (!(n > 0) || n > 4 * 1024 * 1024) return -1;
  let bytes;
  try {
    bytes = base64ToBytes(b64);
  } catch {
    return -1;
  }
  const ids = new Uint8Array(n);
  if (rleDecode(bytes, ids) !== n) return -1;
  let k = 0;
  for (let y = y0; y < y0 + dy; y++) {
    for (let z = z0; z < z0 + dz; z++) {
      let i = (y * sz + z) * sx + x0;
      for (let x = 0; x < dx; x++, i++) out.push(i, ids[k++]);
    }
  }
  return n;
}

// ---------- strings, JSON sizes ----------

const enc = new TextEncoder();
const dec = new TextDecoder('utf-8', { fatal: true });
export const utf8Encode = (s) => enc.encode(s);
export const utf8Decode = (b) => dec.decode(b);

/** UTF-8 byte length of a string (no allocation). */
export function utf8Length(s) {
  let n = 0;
  for (let k = 0; k < s.length; k++) {
    const c = s.charCodeAt(k);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff && k + 1 < s.length && (s.charCodeAt(k + 1) & 0xfc00) === 0xdc00) {
      n += 4;
      k++;
    } else n += 3;
  }
  return n;
}

/** Bytes this character adds inside a JSON string literal (UTF-8), and chars it spans. */
function jsonCharCost(s, k) {
  const c = s.charCodeAt(k);
  if (c === 0x22 || c === 0x5c) return 2;
  if (c < 0x20) return c === 8 || c === 9 || c === 10 || c === 12 || c === 13 ? 2 : 6;
  if (c < 0x80) return 1;
  if (c < 0x800) return 2;
  if (c >= 0xd800 && c <= 0xdbff) {
    if (k + 1 < s.length && (s.charCodeAt(k + 1) & 0xfc00) === 0xdc00) return -4; // pair: 4 bytes, 2 chars
    return 6; // lone surrogate: JSON.stringify writes \udXXX
  }
  if (c >= 0xdc00 && c <= 0xdfff) return 6;
  return 3;
}

/**
 * Split `s` into pieces so that JSON.stringify(piece) is at most `maxBytes` UTF-8 bytes and
 * each piece has at most `maxChars` characters. Never splits a surrogate pair.
 */
export function splitForJson(s, maxBytes, maxChars = Infinity) {
  const pieces = [];
  let start = 0, bytes = 2, k = 0;
  while (k < s.length) {
    let cost = jsonCharCost(s, k);
    let span = 1;
    if (cost < 0) {
      cost = -cost;
      span = 2;
    }
    if (bytes + cost > maxBytes || k + span - start > maxChars) {
      pieces.push(s.slice(start, k));
      start = k;
      bytes = 2;
    }
    bytes += cost;
    k += span;
  }
  if (start < s.length || pieces.length === 0) pieces.push(s.slice(start));
  return pieces;
}

/** JSON with object keys sorted (a stable text for hashing). */
export function stableStringify(v) {
  if (v === null || typeof v !== 'object') {
    const t = JSON.stringify(v);
    return t === undefined ? 'null' : t;
  }
  if (Array.isArray(v)) {
    let s = '[';
    for (let k = 0; k < v.length; k++) s += (k ? ',' : '') + stableStringify(v[k]);
    return s + ']';
  }
  const keys = Object.keys(v).filter((k) => v[k] !== undefined).sort();
  let s = '{';
  for (let k = 0; k < keys.length; k++) s += (k ? ',' : '') + JSON.stringify(keys[k]) + ':' + stableStringify(v[keys[k]]);
  return s + '}';
}

// ---------- hashes ----------

export const FNV_OFFSET = 0x811c9dc5;

/** FNV-1a 32 over bytes (Uint8Array) or over a string's UTF-16 code units. */
export function fnv1a32(data, h = FNV_OFFSET) {
  if (typeof data === 'string') {
    for (let k = 0; k < data.length; k++) {
      h ^= data.charCodeAt(k);
      h = Math.imul(h, 0x01000193);
    }
  } else {
    for (let k = 0; k < data.length; k++) {
      h ^= data[k];
      h = Math.imul(h, 0x01000193);
    }
  }
  return h >>> 0;
}

export const hex8 = (h) => (h >>> 0).toString(16).padStart(8, '0');

export function fmix32(h) {
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

/** Block-hash term of one non-air cell (§5.11). The hash is the sum mod 2^32. */
export function blockMix(i, id) {
  return fmix32(Math.imul(i, 0x9e3779b1) ^ Math.imul(id, 0x85ebca77));
}

/** Full block hash over a getter (host start, after a snapshot). */
export function blockHashOf(getCell, n) {
  let h = 0;
  for (let i = 0; i < n; i++) {
    const id = getCell(i);
    if (id !== 0) h = (h + blockMix(i, id)) >>> 0;
  }
  return h;
}

/** Entity hash `e`: fnv1a32 over uid-sorted uid|key|x|y|z|rot|color|stableStringify(data). */
export function hashEntityRecords(records) {
  const list = records.slice().sort((a, b) => a[0] - b[0]);
  let h = FNV_OFFSET;
  for (const r of list) {
    h = fnv1a32(`${r[0]}|${r[1]}|${r[2]}|${r[3]}|${r[4]}|${r[5]}|${r[6] || 0}|${stableStringify(r[7] || 0)}\n`, h);
  }
  return h >>> 0;
}

/** Plant hash `p`: fnv1a32 over idx-sorted idx|crop|stage. records: [i, crop, stage, wet]. */
export function hashPlantRecords(records) {
  const list = records.slice().sort((a, b) => a[0] - b[0]);
  let h = FNV_OFFSET;
  for (const r of list) h = fnv1a32(`${r[0]}|${r[1]}|${r[2]}\n`, h);
  return h >>> 0;
}

// ---------- look codec (§5.13) ----------

const idxOf = (list) => {
  const m = new Map();
  list.forEach((o, k) => m.set(o.key, k));
  return m;
};
const L = {
  hair: HAIR_STYLES, mix: HAIR_MIXES, smile: SMILES, top: TOPS, bottom: BOTTOMS, dress: DRESSES,
  pattern: PATTERNS, shoes: SHOES, head: HEAD_ACC, face: FACE_ACC, back: BACK_ACC, neck: NECK_ACC, hand: HAND_ACC,
  brows: BROWS,
  sea: SEA_FORMS,
};
const IDX = {};
for (const k in L) IDX[k] = idxOf(L[k]);

const tokIdx = (map, key) => (map.get(key) ?? 0).toString(36);
const tokHex = (c) => (typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c) ? c.slice(1).toLowerCase() : '-');
const tokBool = (b) => (b ? '1' : '0');

/** look -> dot-separated token string (~130 chars, at most 156). The name is not included. */
export function packLook(look) {
  const l = normalizeLook(look);
  const t = [];
  t.push(tokHex(l.skin));
  t.push(tokIdx(IDX.hair, l.hair.style), tokHex(l.hair.color), l.hair.color2 === 'rainbow' ? 'r' : l.hair.color2 ? tokHex(l.hair.color2) : '-', tokIdx(IDX.mix, l.hair.mix));
  t.push(tokHex(l.eyes.color), tokBool(l.eyes.lashes));
  t.push(tokBool(l.face.blush), tokBool(l.face.freckles), tokIdx(IDX.smile, l.face.smile));
  const garment = (g, types) => {
    if (!g) t.push('-', '-', '-', '-');
    else t.push(tokIdx(types, g.type), tokHex(g.color), tokIdx(IDX.pattern, g.pattern), tokHex(g.patternColor));
  };
  garment(l.top, IDX.top);
  garment(l.bottom, IDX.bottom);
  garment(l.dress, IDX.dress);
  t.push(tokIdx(IDX.shoes, l.shoes.type), tokHex(l.shoes.color));
  const a = l.acc;
  t.push(
    tokIdx(IDX.head, a.head), tokHex(a.headColor), tokIdx(IDX.face, a.face), a.faceColor ? tokHex(a.faceColor) : '-',
    tokIdx(IDX.back, a.back), tokHex(a.backColor), tokIdx(IDX.neck, a.neck), tokHex(a.neckColor),
    tokIdx(IDX.hand, a.hand), a.handColor ? tokHex(a.handColor) : '-',
  );
  // Appended tail (wave 3): eyebrows and the jersey number (0..99, base 36). New tokens only
  // ever go at the end, so an older string is a prefix and still unpacks.
  const num = l.top ? l.top.num : 7;
  t.push(tokIdx(IDX.brows, l.face.brows), (Number.isInteger(num) && num >= 0 && num <= 99 ? num : 7).toString(36));
  // Appended tail (merfolk): sea form and tail color, left out while they are the default
  // ('auto', Match) so every older look packs exactly as before.
  // RULE FOR LATER TOKENS: a team that appends a token after these must always write the
  // sea pair first (`0.-` = auto / Match) whenever its own token is present, or positions shift.
  const s = l.sea;
  if (s.form !== 'auto' || s.color) {
    const ci = s.color ? SEA_COLORS.indexOf(s.color) : -1;
    t.push(tokIdx(IDX.sea, s.form), ci >= 0 ? ci.toString(36) : '-');
  }
  return t.join('.');
}

/** Inverse of packLook; unknown or broken tokens fall back to defaults (normalizeLook). */
export function unpackLook(s, name) {
  const t = typeof s === 'string' ? s.slice(0, 400).split('.') : [];
  let k = 0;
  const next = () => (k < t.length ? t[k++] : '-');
  const opt = (list) => {
    const v = parseInt(next(), 36);
    return Number.isInteger(v) && v >= 0 && v < list.length ? list[v].key : undefined;
  };
  const hex = () => {
    const v = next();
    return /^[0-9a-fA-F]{6}$/.test(v) ? '#' + v.toUpperCase() : undefined;
  };
  const bool = () => {
    const v = next();
    return v === '1' ? true : v === '0' ? false : undefined;
  };
  const look = { name };
  look.skin = hex();
  const style = opt(L.hair);
  const color = hex();
  const c2tok = next();
  const color2 = c2tok === 'r' ? 'rainbow' : /^[0-9a-fA-F]{6}$/.test(c2tok) ? '#' + c2tok.toUpperCase() : null;
  look.hair = { style, color, color2, mix: opt(L.mix) };
  look.eyes = { color: hex(), lashes: bool() };
  look.face = { blush: bool(), freckles: bool(), smile: opt(L.smile) };
  const garment = (list) => {
    const type = opt(list);
    return { type, color: hex(), pattern: opt(L.pattern), patternColor: hex() };
  };
  look.top = garment(L.top);
  look.bottom = garment(L.bottom);
  const dress = garment(L.dress);
  look.dress = dress.type ? dress : null;
  look.shoes = { type: opt(L.shoes), color: hex() };
  look.acc = {
    head: opt(L.head), headColor: hex(), face: opt(L.face), faceColor: hex() ?? null,
    back: opt(L.back), backColor: hex(), neck: opt(L.neck), neckColor: hex(),
    hand: opt(L.hand), handColor: hex() ?? null,
  };
  // The tail (brows, jersey number) came later: an older string without it reads '-' here,
  // which gives undefined, and normalizeLook fills 'soft' and 7.
  look.face.brows = opt(L.brows);
  const num = parseInt(next(), 36);
  look.top.num = Number.isInteger(num) && num >= 0 && num <= 99 ? num : undefined;
  // The sea tail came later still: a missing token reads '-', which gives 'auto' / Match.
  const form = opt(L.sea);
  const ct = parseInt(next(), 36);
  look.sea = { form, color: Number.isInteger(ct) && ct >= 0 && ct < SEA_COLORS.length ? SEA_COLORS[ct] : null };
  return normalizeLook(look);
}

// ---------- snapshot framing (§5.8) ----------

let deflateOk = null;
/** Whether this runtime can compress/decompress 'deflate-raw' (presence `zc`). */
export function canDeflate() {
  if (deflateOk !== null) return deflateOk;
  try {
    deflateOk = typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' &&
      !!new CompressionStream('deflate-raw') && !!new DecompressionStream('deflate-raw');
  } catch {
    deflateOk = false;
  }
  return deflateOk;
}

async function pipeBytes(bytes, stream) {
  const body = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(body).arrayBuffer());
}
export const deflateRaw = (bytes) => pipeBytes(bytes, new CompressionStream('deflate-raw'));
export const inflateRaw = (bytes) => pipeBytes(bytes, new DecompressionStream('deflate-raw'));

/**
 * Frame a snapshot: u32le(jsonLen) | utf8(JSON with blocks:'') | rle, optionally deflate-raw,
 * then base64 in CHUNK_CHARS pieces. c = fnv1a32 of the uncompressed bytes (8 hex).
 * @returns {Promise<{chunks:string[], z:0|1, c:string, rawBytes:number}>}
 */
export async function frameSnapshot(json, rle, { compress = false, chunkChars = 3600 } = {}) {
  const text = JSON.stringify({ ...json, blocks: '' });
  const jb = utf8Encode(text);
  const raw = new Uint8Array(4 + jb.length + rle.length);
  new DataView(raw.buffer).setUint32(0, jb.length, true);
  raw.set(jb, 4);
  raw.set(rle, 4 + jb.length);
  const c = hex8(fnv1a32(raw));
  const body = compress ? await deflateRaw(raw) : raw;
  const b64 = bytesToBase64(body);
  const chunks = [];
  for (let k = 0; k < b64.length; k += chunkChars) chunks.push(b64.slice(k, k + chunkChars));
  if (chunks.length === 0) chunks.push('');
  return { chunks, z: compress ? 1 : 0, c, rawBytes: raw.length };
}

/** Inverse of frameSnapshot. Throws Error('crc' | 'frame' | 'json') on any failure. */
export async function unframeSnapshot(chunks, z, c) {
  let body;
  try {
    body = base64ToBytes(chunks.join(''));
  } catch {
    throw new Error('frame');
  }
  let raw;
  try {
    raw = z ? await inflateRaw(body) : body;
  } catch {
    throw new Error('frame');
  }
  if (hex8(fnv1a32(raw)) !== c) throw new Error('crc');
  if (raw.length < 4) throw new Error('frame');
  const len = new DataView(raw.buffer, raw.byteOffset, raw.byteLength).getUint32(0, true);
  if (4 + len > raw.length) throw new Error('frame');
  let json;
  try {
    json = JSON.parse(utf8Decode(raw.subarray(4, 4 + len)));
  } catch {
    throw new Error('json');
  }
  if (json === null || typeof json !== 'object') throw new Error('json');
  return { json, rle: raw.slice(4 + len) };
}

/** Round to 2 decimals (positions in presence). */
export const round2 = (v) => Math.round(v * 100) / 100;
