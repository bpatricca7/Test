// Where an elf may hide (docs/teams/elves.md §4). Pure: no three.js, no DOM. The game hands
// in a small "view" of the world (src/things/elves/view.js builds it from the world and the
// furniture); tools/test-elves.mjs hands in a made-up one.
//
//   view = {
//     inBounds(x, y, z) -> bool
//     solid(x, y, z)    -> bool   a block that stops the player and taps (air, water and plants do not)
//     open(x, y, z)     -> bool   the cell can hold an elf: air (never a placed block) and no furniture
//     liquid(x, y, z)   -> bool
//     support(x, y, z)  -> null | { dy, kind: 'block' | 'furn', key, uid?, bath? }
//                                  what the elf in this cell would stand on; dy (-1 < dy <= 0) is
//                                  how far below the cell's floor that top is
//     standable(x, y, z) -> bool  the player can stand in this cell (feet here, room for the head)
//   }
//
// A hiding place is: an open cell, with something under it, not where the player is, within REACH of
// a cell the player can stand in with nothing solid between the eyes and the elf. So an elf is never
// inside a block and never out of reach (the player can also fly). Every loop has a fixed bound.

import { REACH, HOME_RADIUS, HOME_DOWN, HOME_UP } from './data.js';

const EYE = 1.6; // the eyes above the feet
const ELF_MID = 0.32; // the middle of a standing elf above its feet
const STAND_R = 4; // look this far (sideways) for a place to stand
const MAX_CANDIDATES = 4000;

/** True when no solid block lies strictly between points a and b (3D DDA, at most 64 cells). */
export function lineOfSight(view, ax, ay, az, bx, by, bz) {
  const dx = bx - ax, dy = by - ay, dz = bz - az;
  if (![ax, ay, az, bx, by, bz].every(Number.isFinite)) return false;
  let x = Math.floor(ax), y = Math.floor(ay), z = Math.floor(az);
  const ex = Math.floor(bx), ey = Math.floor(by), ez = Math.floor(bz);
  const sx = Math.sign(dx), sy = Math.sign(dy), sz = Math.sign(dz);
  const tdx = sx ? Math.abs(1 / dx) : Infinity, tdy = sy ? Math.abs(1 / dy) : Infinity, tdz = sz ? Math.abs(1 / dz) : Infinity;
  let tmx = sx ? (sx > 0 ? x + 1 - ax : ax - x) * tdx : Infinity;
  let tmy = sy ? (sy > 0 ? y + 1 - ay : ay - y) * tdy : Infinity;
  let tmz = sz ? (sz > 0 ? z + 1 - az : az - z) * tdz : Infinity;
  for (let i = 0; i < 64; i++) {
    if (x === ex && y === ey && z === ez) return true;
    // the next cell border is past b: b is reached (it sat right on a border)
    if (Math.min(tmx, tmy, tmz) > 1) return true;
    if (tmx <= tmy && tmx <= tmz) { x += sx; tmx += tdx; }
    else if (tmy <= tmz) { y += sy; tmy += tdy; }
    else { z += sz; tmz += tdz; }
    if (x === ex && y === ey && z === ez) return true;
    if (view.solid(x, y, z)) return false;
  }
  return false;
}

/**
 * A cell the player can stand in, close enough to tap an elf in cell (x, y, z) whose feet are dy
 * below that cell, with a clear line from the eyes. Nearest first. null when there is none.
 */
export function findStand(view, x, y, z, dy = 0, region = null) {
  const tx = x + 0.5, ty = y + dy + ELF_MID, tz = z + 0.5;
  let best = null, bestD = Infinity;
  for (let oy = -4; oy <= 1; oy++) {
    for (let ox = -STAND_R; ox <= STAND_R; ox++) {
      for (let oz = -STAND_R; oz <= STAND_R; oz++) {
        if (ox === 0 && oz === 0 && oy >= -1 && oy <= 0) continue; // the player's own feet in the elf's cell
        const sx = x + ox, sy = y + oy, sz = z + oz;
        const ex = sx + 0.5, ey = sy + EYE, ez = sz + 0.5;
        const d = Math.hypot(tx - ex, ty - ey, tz - ez);
        if (d > REACH || d >= bestD) continue;
        if (!view.inBounds(sx, sy, sz) || !view.standable(sx, sy, sz)) continue;
        if (region && !region.has(sx, sy, sz)) continue; // a sealed room or a cave: no way in
        if (!lineOfSight(view, ex, ey, ez, tx, ty, tz)) continue;
        best = [sx, sy, sz];
        bestD = d;
      }
    }
  }
  return best;
}

/** Is (x, y, z) a cell an elf may stand in (not checking reach)? Returns its support or null. */
export function spotSupport(view, x, y, z, { player = null } = {}) {
  if (![x, y, z].every(Number.isInteger)) return null;
  if (!view.inBounds(x, y, z) || !view.open(x, y, z) || view.liquid(x, y, z)) return null;
  if (player && nearPlayer(player, x, y, z)) return null;
  const s = view.support(x, y, z);
  if (!s || !Number.isFinite(s.dy) || s.dy > 0.05 || s.dy <= -1) return null;
  return s;
}

/** The player's body (feet at p) overlaps cell (x, y, z), with a little room to spare. */
export function nearPlayer(p, x, y, z) {
  if (!Array.isArray(p) || !p.every(Number.isFinite)) return false;
  return Math.abs(p[0] - (x + 0.5)) < 1.2 && Math.abs(p[2] - (z + 0.5)) < 1.2 && p[1] - 0.6 < y + 1 && p[1] + 2 > y;
}

const sameCell = (a, x, y, z) => Array.isArray(a) && a[0] === x && a[1] === y && a[2] === z;

/**
 * The air around home that the player can get to (walking, jumping or flying, no digging):
 * every non-solid cell joined to `start` inside the box lo..hi (a flood fill, at most
 * MAX_REGION cells). A sealed room or a cave pocket nearby is not in it. has(x, y, z).
 */
export function airRegion(view, start, lo, hi) {
  const seen = new Set();
  const out = { has: (x, y, z) => seen.has(key(x, y, z)), size: () => seen.size };
  if (!Array.isArray(start) || !start.every(Number.isFinite)) return out;
  let [x0, y0, z0] = start.map(Math.floor);
  // the start may be inside a bed or on a block's edge: step up to the first free cell
  for (let k = 0; k < 3 && view.solid(x0, y0, z0); k++) y0++;
  if (view.solid(x0, y0, z0)) return out;
  const inBox = (x, y, z) => x >= lo[0] && y >= lo[1] && z >= lo[2] && x <= hi[0] && y <= hi[1] && z <= hi[2];
  if (!inBox(x0, y0, z0)) return out;
  const queue = [[x0, y0, z0]];
  seen.add(key(x0, y0, z0));
  for (let qi = 0; qi < queue.length && seen.size < MAX_REGION; qi++) {
    const [x, y, z] = queue[qi];
    for (const [dx, dy, dz] of STEPS) {
      const nx = x + dx, ny = y + dy, nz = z + dz;
      if (!inBox(nx, ny, nz) || !view.inBounds(nx, ny, nz)) continue;
      const k = key(nx, ny, nz);
      if (seen.has(k) || view.solid(nx, ny, nz)) continue;
      seen.add(k);
      queue.push([nx, ny, nz]);
    }
  }
  return out;
}
const STEPS = [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]];
const MAX_REGION = 80000;
const key = (x, y, z) => (x + 2048) * 16777216 + (y + 2048) * 4096 + (z + 2048);

/** Is there a solid block above (x, y, z) within a few cells (indoors there)? */
function roofed(view, x, y, z) {
  for (let k = 1; k <= 5; k++) if (view.solid(x, y + k, z)) return true;
  return false;
}

/**
 * Every possible hiding cell around anchor, with a weight: furniture tops first (shelves,
 * the fridge, a lamp, the sofa, the bath), then cells under a roof, then the garden.
 * Bounded: (2r + 1)^2 * (down + up + 1) cells at most, MAX_CANDIDATES kept.
 */
export function candidates(view, anchor, { radius = HOME_RADIUS, down = HOME_DOWN, up = HOME_UP, player = null, avoid = [] } = {}) {
  const out = [];
  if (!Array.isArray(anchor) || !anchor.every(Number.isFinite)) return out;
  const [ax, ay, az] = anchor.map(Math.floor);
  const r = Math.max(0, Math.min(16, radius | 0));
  for (let y = ay - Math.min(8, down); y <= ay + Math.min(12, up); y++) {
    for (let x = ax - r; x <= ax + r; x++) {
      for (let z = az - r; z <= az + r; z++) {
        if (out.length >= MAX_CANDIDATES) return out;
        if (avoid.some((a) => sameCell(a, x, y, z))) continue;
        const s = spotSupport(view, x, y, z, { player });
        if (!s) continue;
        const dist = Math.hypot(x - ax, (y - ay) * 1.5, z - az);
        let w = s.kind === 'furn' ? (s.bath ? 2.6 : 3) : roofed(view, x, y, z) ? 1.3 : 0.6;
        w /= 1 + dist / 6;
        out.push({ x, y, z, dy: s.dy, kind: s.kind, key: s.key || '', uid: s.uid || 0, bath: !!s.bath, w });
      }
    }
  }
  return out;
}

/** The air region around a home (anchor) big enough for every candidate and its stand cell. */
export function homeRegion(view, anchor, { radius = HOME_RADIUS, down = HOME_DOWN, up = HOME_UP } = {}) {
  if (!Array.isArray(anchor) || !anchor.every(Number.isFinite)) return airRegion(view, null);
  const [ax, ay, az] = anchor.map(Math.floor);
  const r = Math.max(0, Math.min(16, (radius ?? HOME_RADIUS) | 0)) + STAND_R + 1;
  const lo = [ax - r, ay - Math.min(8, down ?? HOME_DOWN) - 5, az - r];
  const hi = [ax + r, ay + Math.min(12, up ?? HOME_UP) + 4, az + r];
  return airRegion(view, anchor, lo, hi);
}

/**
 * Pick the house elf's hiding place for a new morning.
 * opts: { anchor: [x, y, z], rand, last: [x, y, z] | null (never the same twice in a row),
 *         prev: [[x, y, z], ...] (yesterday's and before: avoided while there are others),
 *         player: [x, y, z] | null, radius, down, up, tries }
 * Returns { x, y, z, dy, kind, key, uid, bath, stand } or null when nothing fits.
 */
export function pickHideSpot(view, opts = {}) {
  const rand = typeof opts.rand === 'function' ? opts.rand : () => 0.5;
  const last = Array.isArray(opts.last) ? opts.last : null;
  const prev = Array.isArray(opts.prev) ? opts.prev.filter(Array.isArray) : [];
  const tries = Math.max(1, Math.min(200, opts.tries | 0 || 80));
  const avoid = last ? [last] : [];
  const all = candidates(view, opts.anchor, { radius: opts.radius, down: opts.down, up: opts.up, player: opts.player, avoid });
  if (!all.length) return null;
  const region = homeRegion(view, opts.anchor, opts);
  // weighted random order (each candidate's key is rand^(1/w)); spots used lately sink
  for (const c of all) {
    const w = prev.some((p) => sameCell(p, c.x, c.y, c.z)) ? c.w * 0.05 : c.w;
    const r = Math.min(Math.max(Number(rand()) || 0, 1e-9), 1);
    c.k = Math.pow(r, 1 / Math.max(1e-6, w));
  }
  all.sort((a, b) => b.k - a.k);
  const n = Math.min(all.length, tries);
  for (let i = 0; i < n; i++) {
    const c = all[i];
    const stand = findStand(view, c.x, c.y, c.z, c.dy, region);
    if (stand) return { x: c.x, y: c.y, z: c.z, dy: c.dy, kind: c.kind, key: c.key, uid: c.uid, bath: c.bath, stand };
  }
  return null;
}

/**
 * The nearest good cell to (x, y, z) (a village record whose cell is taken, an elf whose
 * shelf was taken away): searches a box around it, nearest first, falling a little further
 * down than up. needReach: also needs a place to stand. Returns { x, y, z, dy, kind, key,
 * uid, bath } or null.
 */
export function nearestSpot(view, x, y, z, { r = 2, down = 6, up = 2, needReach = true, player = null, avoid = [], region = null } = {}) {
  if (![x, y, z].every(Number.isFinite)) return null;
  x = Math.floor(x); y = Math.floor(y); z = Math.floor(z);
  r = Math.max(0, Math.min(6, r | 0));
  const list = [];
  for (let oy = -Math.min(12, down); oy <= Math.min(6, up); oy++) {
    for (let ox = -r; ox <= r; ox++) {
      for (let oz = -r; oz <= r; oz++) list.push([ox, oy, oz, Math.abs(ox) + Math.abs(oz) + (oy > 0 ? oy * 1.5 : -oy * 0.75)]);
    }
  }
  list.sort((a, b) => a[3] - b[3]);
  for (const [ox, oy, oz] of list) {
    const cx = x + ox, cy = y + oy, cz = z + oz;
    if (avoid.some((a) => sameCell(a, cx, cy, cz))) continue;
    const s = spotSupport(view, cx, cy, cz, { player });
    if (!s) continue;
    if (needReach && !findStand(view, cx, cy, cz, s.dy, region)) continue;
    return { x: cx, y: cy, z: cz, dy: s.dy, kind: s.kind, key: s.key || '', uid: s.uid || 0, bath: !!s.bath };
  }
  return null;
}

/**
 * The top of a piece of furniture over one of its cells, in model units above its feet, or
 * null when nothing stands there (no collider over the cell's middle, a rug, a wall piece).
 * def: { size: [w, h, d], colliders, surface? }; (i, k): the cell in the model's own grid.
 */
export function furnitureTop(def, i, k, data = {}, entity = null) {
  if (!def || !Array.isArray(def.size)) return null;
  const w = Math.max(1, def.size[0] | 0), h = Math.max(1, def.size[1] | 0), d = Math.max(1, def.size[2] | 0);
  if (!(i >= 0 && i < w && k >= 0 && k < d)) return null;
  let spec = def.colliders;
  if (typeof spec === 'function') {
    try { spec = spec(data || {}, entity); } catch { spec = null; }
  }
  const boxes = spec === 'full' ? [[0, 0, 0, w, h, d]] : Array.isArray(spec) ? spec : [];
  const cx = i + 0.5, cz = k + 0.5;
  let top = null;
  for (const b of boxes) {
    if (!Array.isArray(b) || b.length < 6 || !b.every(Number.isFinite)) continue;
    if (cx >= b[0] - 0.01 && cx <= b[3] + 0.01 && cz >= b[2] - 0.01 && cz <= b[5] + 0.01) top = top === null ? b[4] : Math.max(top, b[4]);
  }
  if (top === null) return null;
  if (typeof def.surface === 'number' && Number.isFinite(def.surface) && def.surface <= top + 0.001 && def.surface > h - 1) top = def.surface;
  return top > h - 1 && top <= h + 0.001 ? top : null;
}

/** Integer rotation (the same as entities.js rotXZ, copied so this file imports no game code). */
export function rotXZ(x, z, rot) {
  switch (rot & 3) {
    case 1: return [z, -x];
    case 2: return [-x, -z];
    case 3: return [-z, x];
    default: return [x, z];
  }
}

/** The model grid cell (i, k) of an entity's world cell (wx, wz). Inverse of entities.footprint. */
export function localCell(entity, wx, wz) {
  const size = entity && entity.def && entity.def.size;
  if (!size) return null;
  const w = Math.max(1, size[0] | 0), d = Math.max(1, size[2] | 0);
  const ai = Math.floor((w - 1) / 2);
  const [ox, oz] = rotXZ(wx - entity.x, wz - entity.z, (4 - (entity.rot & 3)) & 3);
  return [ox + ai, oz + (d - 1)];
}
