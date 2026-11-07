// Cruise fun: the pure logic (no three.js, no DOM), so Node can test it
// (tools/test-cruise-fun.mjs). Slide paths (reading the world team's records, packing them into
// a gate's entity data, following them), the slide's speed, the Bag slide's own path, lift stop
// picking, the timing meter of the deck games, the mini-golf ball, the scores and the daily
// coins. Every loop here has a fixed bound and every number from a record is checked.

export const SLIDE = {
  MAX_POINTS: 240, // a record's path is cut after this many cells
  MAX_CHARS: 420, // packed path in the gate's data (entity data travels in <= 600 bytes)
  STEP_MAX: 1.5, // the contract's longest step between two cells
  GAP_FILL: 4, // a longer step up to this is filled in; a longer one ends the path there
  G: 9.8 * 0.9,
  VMIN: 3.2, // never slower than this (flat and uphill bits still move)
  VMAX: 11.5,
  V0: 2.4,
  DRAG: 0.012, // * v^2
  ROLL: 0.15,
  AUTO_STEPS: 32, // the Bag slide gate looks this far ahead
};

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** [x, y, z] or { x, y, z } with finite numbers -> integer cell [x, y, z], else null. */
export function cellOf(p) {
  if (!p) return null;
  const x = Array.isArray(p) ? p[0] : p.x;
  const y = Array.isArray(p) ? p[1] : p.y;
  const z = Array.isArray(p) ? p[2] : p.z;
  if (!isNum(x) || !isNum(y) || !isNum(z)) return null;
  if (Math.abs(x) > 1e5 || Math.abs(y) > 1e5 || Math.abs(z) > 1e5) return null;
  return [Math.floor(x), Math.floor(y), Math.floor(z)];
}

/**
 * A record's path -> a list of integer cells (at most SLIDE.MAX_POINTS). Broken points are
 * skipped, repeats dropped, a step a little longer than the contract allows is filled in with
 * the cells between, and a jump longer than SLIDE.GAP_FILL ends the path there (what comes
 * after a jump cannot be reached by sliding).
 */
export function normalizePath(raw, max = SLIDE.MAX_POINTS) {
  const out = [];
  if (!Array.isArray(raw)) return out;
  const n = Math.min(raw.length, 4 * max);
  for (let i = 0; i < n && out.length < max; i++) {
    const c = cellOf(raw[i]);
    if (!c) continue;
    const last = out[out.length - 1];
    if (last && last[0] === c[0] && last[1] === c[1] && last[2] === c[2]) continue;
    if (last) {
      const d = Math.hypot(c[0] - last[0], c[1] - last[1], c[2] - last[2]);
      if (d > SLIDE.GAP_FILL) break;
      if (d > SLIDE.STEP_MAX + 0.3) {
        // fill the gap with the cells along the straight line
        const k = Math.ceil(d);
        for (let j = 1; j < k && out.length < max; j++) {
          const t = j / k;
          const m = [Math.round(last[0] + (c[0] - last[0]) * t), Math.round(last[1] + (c[1] - last[1]) * t), Math.round(last[2] + (c[2] - last[2]) * t)];
          const l2 = out[out.length - 1];
          if (l2[0] !== m[0] || l2[1] !== m[1] || l2[2] !== m[2]) out.push(m);
        }
        if (out.length >= max) break;
      }
    }
    out.push(c);
  }
  return out;
}

/** Keep the first and last cell and every cell where the direction changes. */
export function keyCells(cells) {
  if (!Array.isArray(cells) || cells.length <= 2) return Array.isArray(cells) ? cells.slice() : [];
  const out = [cells[0]];
  for (let i = 1; i < cells.length - 1; i++) {
    const a = cells[i - 1], b = cells[i], c = cells[i + 1];
    if (b[0] - a[0] !== c[0] - b[0] || b[1] - a[1] !== c[1] - b[1] || b[2] - a[2] !== c[2] - b[2]) out.push(b);
  }
  out.push(cells[cells.length - 1]);
  return out;
}

/** Distance from point p to the segment a-b (3D). */
function segDist(p, a, b) {
  const vx = b[0] - a[0], vy = b[1] - a[1], vz = b[2] - a[2];
  const L = vx * vx + vy * vy + vz * vz;
  let t = L > 0 ? ((p[0] - a[0]) * vx + (p[1] - a[1]) * vy + (p[2] - a[2]) * vz) / L : 0;
  t = clamp(t, 0, 1);
  return Math.hypot(a[0] + vx * t - p[0], a[1] + vy * t - p[1], a[2] + vz * t - p[2]);
}

/** Ramer-Douglas-Peucker on a list of cells (no recursion: an explicit, bounded stack). */
export function simplify(cells, tol) {
  const n = cells.length;
  if (n <= 2 || !(tol > 0)) return cells.slice();
  const keep = new Uint8Array(n);
  keep[0] = keep[n - 1] = 1;
  const stack = [[0, n - 1]];
  for (let guard = 0; stack.length && guard < 4 * n; guard++) {
    const [i0, i1] = stack.pop();
    let best = -1, bestD = tol;
    for (let i = i0 + 1; i < i1; i++) {
      const d = segDist(cells[i], cells[i0], cells[i1]);
      if (d > bestD) { bestD = d; best = i; }
    }
    if (best >= 0) {
      keep[best] = 1;
      stack.push([i0, best], [best, i1]);
    }
  }
  const out = [];
  for (let i = 0; i < n; i++) if (keep[i]) out.push(cells[i]);
  return out;
}

// URL-safe base64 alphabet: each character is one signed step -32..31 on one axis
const ALPH = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
const CODE = new Map([...ALPH].map((ch, i) => [ch, i]));

/**
 * Pack key cells relative to the origin cell (the gate) into a short string: 'k' and then three
 * characters per key cell (its step from the one before, each axis -32..31; a longer step is
 * split into several). Returns '' for an empty list.
 */
export function encodeKeys(keys, ox, oy, oz) {
  if (!Array.isArray(keys) || !keys.length) return '';
  let s = 'k';
  let px = ox | 0, py = oy | 0, pz = oz | 0;
  for (const k of keys) {
    let dx = k[0] - px, dy = k[1] - py, dz = k[2] - pz;
    // split long steps into pieces that fit one character per axis
    for (let guard = 0; guard < 64; guard++) {
      const m = Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz));
      const parts = Math.max(1, Math.ceil(m / 31));
      const sx = Math.round(dx / parts), sy = Math.round(dy / parts), sz = Math.round(dz / parts);
      s += ALPH[sx + 32] + ALPH[sy + 32] + ALPH[sz + 32];
      px += sx; py += sy; pz += sz;
      dx = k[0] - px; dy = k[1] - py; dz = k[2] - pz;
      if (!dx && !dy && !dz) break;
    }
  }
  return s;
}

/** The inverse of encodeKeys (at most `max` cells; a broken string gives what it can, maybe []). */
export function decodeKeys(str, ox, oy, oz, max = SLIDE.MAX_POINTS) {
  const out = [];
  if (typeof str !== 'string' || str[0] !== 'k') return out;
  let x = ox | 0, y = oy | 0, z = oz | 0;
  const n = Math.min(str.length, 1 + 3 * max);
  for (let i = 1; i + 2 < n; i += 3) {
    const a = CODE.get(str[i]), b = CODE.get(str[i + 1]), c = CODE.get(str[i + 2]);
    if (a === undefined || b === undefined || c === undefined) break;
    x += a - 32; y += b - 32; z += c - 32;
    out.push([x, y, z]);
  }
  return out;
}

/**
 * A record's path packed for the gate's data: the key cells, simplified more and more until it
 * fits SLIDE.MAX_CHARS. Returns { code, keys } (code '' when the path has under 2 cells).
 */
export function packPath(raw, ox, oy, oz) {
  const cells = normalizePath(raw);
  if (cells.length < 2) return { code: '', keys: [] };
  let keys = keyCells(cells);
  let code = encodeKeys(keys, ox, oy, oz);
  for (const tol of [0.45, 0.8, 1.2, 1.8, 2.6, 4]) {
    if (code.length <= SLIDE.MAX_CHARS) break;
    keys = simplify(keyCells(cells), tol);
    code = encodeKeys(keys, ox, oy, oz);
  }
  if (code.length > SLIDE.MAX_CHARS) {
    // still too long: keep evenly spread key cells (always the first and the last)
    const room = Math.max(2, Math.floor((SLIDE.MAX_CHARS - 1) / 3 / 2));
    const pick = [];
    for (let i = 0; i < room; i++) pick.push(keys[Math.round((i / (room - 1)) * (keys.length - 1))]);
    keys = pick;
    code = encodeKeys(keys, ox, oy, oz);
  }
  return { code, keys };
}

/**
 * The cells a polyline through key cells passes (every cell her seat crosses), for the
 * "is anything built in the slide?" check. At most `max` cells.
 */
export function expandKeys(keys, max = 600) {
  const out = [];
  if (!Array.isArray(keys) || !keys.length) return out;
  out.push(keys[0].slice());
  for (let i = 1; i < keys.length && out.length < max; i++) {
    const a = keys[i - 1], b = keys[i];
    const d = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), Math.abs(b[2] - a[2]));
    const steps = Math.min(200, Math.max(1, Math.ceil(d * 2)));
    for (let j = 1; j <= steps && out.length < max; j++) {
      const t = j / steps;
      const c = [Math.round(a[0] + (b[0] - a[0]) * t), Math.round(a[1] + (b[1] - a[1]) * t), Math.round(a[2] + (b[2] - a[2]) * t)];
      const l = out[out.length - 1];
      if (l[0] !== c[0] || l[1] !== c[1] || l[2] !== c[2]) out.push(c);
    }
  }
  return out;
}

/**
 * Where a cell of the path really is: a path cell that is solid with air above it means the
 * record named the slide's floor block, so she rides one cell higher. Returns the cell to ride
 * (maybe the same) or null when it is blocked (solid, and solid above too).
 * solid(x, y, z) -> bool.
 */
export function rideCell(c, solid) {
  if (!solid(c[0], c[1], c[2])) return c;
  if (!solid(c[0], c[1] + 1, c[2])) return [c[0], c[1] + 1, c[2]];
  return null;
}

/** Lift every key cell that names the floor (see rideCell); blocked ones stay as they are. */
export function liftKeys(keys, solid) {
  return keys.map((k) => rideCell(k, solid) || k);
}

/**
 * The first blocked cell index along the expanded cells, or -1 (the slide is clear).
 * Cells are checked as they are (call after liftKeys).
 */
export function firstBlocked(cells, solid) {
  for (let i = 0; i < cells.length; i++) {
    const c = cells[i];
    if (solid(c[0], c[1], c[2]) && solid(c[0], c[1] + 1, c[2])) return i;
  }
  return -1;
}

/**
 * How a ride ends when the slide is blocked at expanded index `blockedAt` (-1: clear): she rides
 * up to just before it and then hops by magic to the splash cell ('pool'), or, when even that is
 * not free (or the block is right at the top), she stays at the start ('start').
 * Returns { end: 'full' | 'pool' | 'start', stopAt } (stopAt: expanded index where the ride stops).
 */
export function planRide(cellCount, blockedAt, endFree) {
  if (blockedAt < 0) return { end: 'full', stopAt: cellCount - 1 };
  if (blockedAt <= 1 || !endFree) return { end: 'start', stopAt: 0 };
  return { end: 'pool', stopAt: blockedAt - 1 };
}

/** Polyline through points [[x,y,z]...] -> { pts: Float32Array, cum: Float32Array, len, n }. */
export function polyline(points) {
  const n = points.length;
  const pts = new Float32Array(n * 3);
  const cum = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    pts[i * 3] = points[i][0];
    pts[i * 3 + 1] = points[i][1];
    pts[i * 3 + 2] = points[i][2];
    if (i > 0) cum[i] = cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1], points[i][2] - points[i - 1][2]);
  }
  return { pts, cum, len: n ? cum[n - 1] : 0, n, cursor: 0 };
}

/**
 * Round the corners (Chaikin, `rounds` times; the ends stay put) so turns are gentle.
 * points: [[x,y,z]...]. At most `max` points come back.
 */
export function smoothCorners(points, rounds = 2, max = 1200) {
  let p = points;
  for (let r = 0; r < rounds; r++) {
    if (p.length < 3 || p.length * 2 > max) break;
    const q = [p[0]];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i], b = p[i + 1];
      if (i > 0) q.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, a[2] * 0.75 + b[2] * 0.25]);
      if (i < p.length - 2) q.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, a[2] * 0.25 + b[2] * 0.75]);
    }
    q.push(p[p.length - 1]);
    p = q;
  }
  return p;
}

/**
 * Point at arc length s into out ({x,y,z} or an array); returns the slope dy/ds of that piece.
 * Uses (and moves) line.cursor so walking along the ride costs O(1) a frame.
 */
export function samplePolyline(line, s, out) {
  const { pts, cum, n } = line;
  if (n === 0) return 0;
  if (n === 1) {
    set3(out, pts[0], pts[1], pts[2]);
    return 0;
  }
  s = clamp(isNum(s) ? s : 0, 0, line.len);
  let j = clamp(line.cursor | 0, 0, n - 2);
  for (let guard = 0; guard < n && j > 0 && cum[j] > s; guard++) j--;
  for (let guard = 0; guard < n && j < n - 2 && cum[j + 1] < s; guard++) j++;
  line.cursor = j;
  const seg = cum[j + 1] - cum[j] || 1;
  const t = clamp((s - cum[j]) / seg, 0, 1);
  const i = j * 3, k = i + 3;
  set3(out, pts[i] + (pts[k] - pts[i]) * t, pts[i + 1] + (pts[k + 1] - pts[i + 1]) * t, pts[i + 2] + (pts[k + 2] - pts[i + 2]) * t);
  return (pts[k + 1] - pts[i + 1]) / seg;
}

function set3(out, x, y, z) {
  if (Array.isArray(out)) {
    out[0] = x; out[1] = y; out[2] = z;
  } else if (out && typeof out.set === 'function') out.set(x, y, z);
  else if (out) {
    out.x = x; out.y = y; out.z = z;
  }
}

/** One step of the slide's speed: gravity along the slope, a little drag; never stops. */
export function slideSpeed(v, slope, dt) {
  if (!isNum(v)) v = SLIDE.V0;
  if (!isNum(slope)) slope = 0;
  if (!isNum(dt) || dt < 0) dt = 0;
  const sin = slope / Math.hypot(1, slope);
  const a = -SLIDE.G * sin - SLIDE.DRAG * v * v - SLIDE.ROLL;
  return clamp(v + a * dt, SLIDE.VMIN, SLIDE.VMAX);
}

/** The longest a ride of this length may take (then it simply ends): never stuck. */
export function rideTimeLimit(len) {
  return (isNum(len) && len > 0 ? len : 0) / SLIDE.VMIN + 4;
}

/**
 * The Bag's slide gate: a path from the gate cell straight ahead (dir [dx, dz]) and down
 * whatever she built: each step goes one cell forward and drops while there is room below (at
 * most 2 a step), stops at a wall, in water, or after two flat steps once it has gone down.
 * solid(x,y,z), liquid(x,y,z) -> bool; inside(x,y,z) -> bool (the world's bounds).
 */
export function autoSlidePath(x, y, z, dir, solid, liquid, inside = () => true) {
  const out = [[x, y, z]];
  const dx = Math.sign(dir[0] | 0), dz = Math.sign(dir[1] | 0);
  if (!dx && !dz) return out;
  let cx = x, cy = y, cz = z, flat = 0, down = 0;
  for (let i = 0; i < SLIDE.AUTO_STEPS; i++) {
    const nx = cx + dx, nz = cz + dz;
    if (!inside(nx, cy, nz) || solid(nx, cy, nz)) break;
    let ny = cy, drop = 0;
    for (let k = 0; k < 2 && ny > 1 && !solid(nx, ny - 1, nz) && !liquid(nx, ny, nz) && inside(nx, ny - 1, nz); k++) {
      ny--;
      drop++;
    }
    cx = nx; cy = ny; cz = nz;
    out.push([cx, cy, cz]);
    if (liquid(cx, cy, cz)) break; // splash!
    if (drop) {
      down += drop;
      flat = 0;
    } else if (down > 0 && ++flat >= 2) break;
    else if (down === 0 && i >= 3) break; // a flat start: a short scoot is enough
  }
  // landing in water: go down into it until the floor (at most 3) so she lands in, not on, it
  const last = out[out.length - 1];
  if (liquid(last[0], last[1], last[2]) || liquid(last[0], last[1] - 1, last[2])) {
    let ly = last[1];
    for (let k = 0; k < 3 && liquid(last[0], ly - 1, last[2]) && !solid(last[0], ly - 1, last[2]); k++) ly--;
    if (ly !== last[1]) out.push([last[0], ly, last[2]]);
  }
  return out;
}

// ---------- lifts ----------

/**
 * The stops of a lift: every lift piece in the same shaft (same x and z), lowest first, each
 * { y, name, uid }. pieces: [{ uid, x, y, z, name }]. Unnamed stops are numbered "Deck N".
 * Pieces on the same floor (y within 1) count once.
 */
export function liftStops(pieces, x, z) {
  const list = [];
  for (const p of Array.isArray(pieces) ? pieces : []) {
    if (!p || p.x !== x || p.z !== z || !isNum(p.y)) continue;
    if (list.some((q) => Math.abs(q.y - p.y) < 2)) continue;
    list.push(p);
    if (list.length >= 12) break;
  }
  list.sort((a, b) => a.y - b.y);
  return list.map((p, i) => ({ y: p.y, uid: p.uid, name: cleanName(p.name, 22) || `Deck ${i + 1}` }));
}

/** Which stop she is at: the one whose floor is closest below her feet (null when none). */
export function currentStop(stops, y) {
  let best = null, bestD = Infinity;
  for (const s of stops) {
    const d = Math.abs(y - s.y);
    if (d < bestD) { bestD = d; best = s; }
  }
  return best && bestD < 3 ? best : null;
}

/** A short friendly name from a record: printable, trimmed, at most `max` characters. */
export function cleanName(v, max = 24) {
  if (typeof v !== 'string') return '';
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2060-\u206f\ufeff<>]/g, '').replace(/\s+/g, ' ').trim();
  return s.slice(0, max);
}

/** A css color from a record ('#rgb' / '#rrggbb'), else the fallback. */
export function cleanColor(v, fallback) {
  if (typeof v === 'string' && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(v.trim())) {
    let h = v.trim().slice(1);
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    return '#' + h.toUpperCase();
  }
  return fallback;
}

// ---------- the deck games' timing meter ----------

/** The meter's needle 0..1 (a triangle wave) at time t for a speed in sweeps per second. */
export function meterValue(t, speed) {
  if (!isNum(t) || !isNum(speed)) return 0;
  const p = (((t * speed) % 2) + 2) % 2;
  return p < 1 ? p : 2 - p;
}

/** How good a tap is: 1 right on target, falling to 0 at `width` away (never negative). */
export function meterQuality(v, target, width) {
  if (!isNum(v) || !isNum(target) || !(width > 0)) return 0;
  return clamp(1 - Math.abs(v - target) / width, 0, 1);
}

/** Points for one throw: 3 for a great one, 2 good, 1 for every other (every throw scores). */
export function throwPoints(q) {
  if (!(q >= 0)) return 1;
  return q >= 0.75 ? 3 : q >= 0.4 ? 2 : 1;
}

/** The needle gets a little quicker each throw (gently, and never too fast). */
export function meterSpeed(throwIndex, base = 0.55) {
  return clamp(base + 0.07 * Math.max(0, throwIndex | 0), 0.3, 1.15);
}

// ---------- mini golf ----------

export const GOLF = {
  W: 640, H: 400, // the green's drawing space (logical px)
  BALL: 9,
  CUP: 15,
  FRICTION: 1.15, // per second, exponential
  DECEL: 34, // px/s^2 constant rolling resistance
  BOUNCE: 0.78,
  VMIN_PUTT: 130,
  VMAX_PUTT: 720,
  CAPTURE_SPEED: 330, // slower than this over the cup: plop
  MAX_STROKES: 6, // after this many the ball rolls in by magic
  STEP: 1 / 120, // physics sub-step (seconds)
};

// Holes of our own: walls [x0, y0, x1, y1] (inside the border) and round bumpers [x, y, r]
export const HOLES = [
  { name: 'Sunny Start', par: 2, tee: [110, 200], cup: [530, 200], walls: [], bumpers: [] },
  { name: 'Corner Cove', par: 3, tee: [100, 320], cup: [540, 90], walls: [[20, 150, 420, 190]], bumpers: [] },
  { name: 'Bubble Bumpers', par: 3, tee: [90, 200], cup: [550, 200], walls: [], bumpers: [[300, 140, 34], [360, 260, 34], [440, 170, 26]] },
  { name: 'Zig Zag', par: 3, tee: [90, 90], cup: [550, 320], walls: [[200, 20, 240, 280], [400, 120, 440, 380]], bumpers: [] },
  { name: 'Lighthouse Gap', par: 2, tee: [90, 300], cup: [540, 110], walls: [[300, 20, 340, 170], [300, 230, 340, 380]], bumpers: [[470, 230, 22]] },
  { name: 'Starfish Loop', par: 3, tee: [320, 330], cup: [320, 80], walls: [[180, 190, 460, 220]], bumpers: [[120, 200, 24], [520, 200, 24]] },
];

/** A course of n holes (1..9) with pars from a record (2..5) when it gives them. */
export function golfCourse(n, pars = null) {
  const count = clamp(isNum(n) ? Math.floor(n) : HOLES.length, 1, 9);
  const out = [];
  for (let i = 0; i < count; i++) {
    const h = HOLES[i % HOLES.length];
    const p = Array.isArray(pars) && isNum(pars[i]) ? clamp(Math.round(pars[i]), 2, 5) : h.par;
    out.push({ ...h, par: p, index: i });
  }
  return out;
}

/** A ball { x, y, vx, vy, moving, inCup } on the tee of hole h. */
export function newBall(h) {
  return { x: h.tee[0], y: h.tee[1], vx: 0, vy: 0, moving: false, inCup: false };
}

/** Hit the ball toward (tx, ty) with power 0..1. */
export function putt(ball, tx, ty, power) {
  const dx = tx - ball.x, dy = ty - ball.y;
  const d = Math.hypot(dx, dy);
  if (!(d > 0.5)) return false;
  const p = clamp(isNum(power) ? power : 0.5, 0, 1);
  const v = GOLF.VMIN_PUTT + (GOLF.VMAX_PUTT - GOLF.VMIN_PUTT) * p;
  ball.vx = (dx / d) * v;
  ball.vy = (dy / d) * v;
  ball.moving = true;
  return true;
}

/**
 * Move the ball dt seconds (fixed sub-steps, at most 30): walls and bumpers bounce it, the
 * border keeps it on the green, the cup takes it when it rolls over slowly enough. Returns an
 * event: 'cup' | 'bump' | null.
 */
export function stepBall(ball, h, dt) {
  if (!ball.moving || ball.inCup) return null;
  if (!isNum(dt) || dt <= 0) return null;
  let event = null;
  const steps = Math.min(30, Math.ceil(dt / GOLF.STEP));
  const st = dt / steps;
  const R = GOLF.BALL;
  for (let s = 0; s < steps; s++) {
    ball.x += ball.vx * st;
    ball.y += ball.vy * st;
    // border
    const x0 = 20 + R, x1 = GOLF.W - 20 - R, y0 = 20 + R, y1 = GOLF.H - 20 - R;
    if (ball.x < x0) { ball.x = x0; ball.vx = Math.abs(ball.vx) * GOLF.BOUNCE; event = event || 'bump'; }
    if (ball.x > x1) { ball.x = x1; ball.vx = -Math.abs(ball.vx) * GOLF.BOUNCE; event = event || 'bump'; }
    if (ball.y < y0) { ball.y = y0; ball.vy = Math.abs(ball.vy) * GOLF.BOUNCE; event = event || 'bump'; }
    if (ball.y > y1) { ball.y = y1; ball.vy = -Math.abs(ball.vy) * GOLF.BOUNCE; event = event || 'bump'; }
    // walls: push out along the shallowest side
    for (const w of h.walls || []) {
      if (ball.x + R <= w[0] || ball.x - R >= w[2] || ball.y + R <= w[1] || ball.y - R >= w[3]) continue;
      const pl = ball.x + R - w[0], pr = w[2] - (ball.x - R), pt = ball.y + R - w[1], pb = w[3] - (ball.y - R);
      const m = Math.min(pl, pr, pt, pb);
      if (m === pl) { ball.x = w[0] - R; ball.vx = -Math.abs(ball.vx) * GOLF.BOUNCE; }
      else if (m === pr) { ball.x = w[2] + R; ball.vx = Math.abs(ball.vx) * GOLF.BOUNCE; }
      else if (m === pt) { ball.y = w[1] - R; ball.vy = -Math.abs(ball.vy) * GOLF.BOUNCE; }
      else { ball.y = w[3] + R; ball.vy = Math.abs(ball.vy) * GOLF.BOUNCE; }
      event = event || 'bump';
    }
    // round bumpers: reflect, with a little extra boing
    for (const b of h.bumpers || []) {
      const dx = ball.x - b[0], dy = ball.y - b[1];
      const d = Math.hypot(dx, dy), min = b[2] + R;
      if (d >= min || d < 1e-6) continue;
      const nx = dx / d, ny = dy / d;
      ball.x = b[0] + nx * min;
      ball.y = b[1] + ny * min;
      const vn = ball.vx * nx + ball.vy * ny;
      if (vn < 0) {
        ball.vx -= 2 * vn * nx;
        ball.vy -= 2 * vn * ny;
        ball.vx *= 0.95;
        ball.vy *= 0.95;
      }
      event = 'bump';
    }
    // rolling resistance
    const sp = Math.hypot(ball.vx, ball.vy);
    let ns = sp * Math.exp(-GOLF.FRICTION * st) - GOLF.DECEL * st;
    if (!(ns > 0)) ns = 0;
    // the cup: a gentle pull when near, in when slow enough
    const cx = h.cup[0] - ball.x, cy = h.cup[1] - ball.y;
    const cd = Math.hypot(cx, cy);
    if (cd < GOLF.CUP - 2 && ns < GOLF.CAPTURE_SPEED) {
      ball.x = h.cup[0];
      ball.y = h.cup[1];
      ball.vx = ball.vy = 0;
      ball.moving = false;
      ball.inCup = true;
      return 'cup';
    }
    if (cd < GOLF.CUP * 2.2 && ns > 0 && cd > 0.01) {
      const pull = 160 * st * (1 - cd / (GOLF.CUP * 2.2));
      ball.vx += (cx / cd) * pull;
      ball.vy += (cy / cd) * pull;
    }
    if (ns < 6) {
      ball.vx = ball.vy = 0;
      ball.moving = false;
      return event;
    }
    const k = sp > 0 ? ns / sp : 0;
    ball.vx *= k;
    ball.vy *= k;
    if (!isNum(ball.x) || !isNum(ball.y) || !isNum(ball.vx) || !isNum(ball.vy)) {
      // never lost: back to the tee
      ball.x = h.tee[0]; ball.y = h.tee[1]; ball.vx = ball.vy = 0; ball.moving = false;
      return null;
    }
  }
  return event;
}

/** Stars for a hole: 3 at par or better, 2 within two over, 1 for every other finish. */
export function holeStars(strokes, par) {
  if (!isNum(strokes) || !isNum(par)) return 1;
  return strokes <= par ? 3 : strokes <= par + 2 ? 2 : 1;
}

// ---------- scores, plays and the daily coins (profile.cruise) ----------

// what pays the first time each game day (sum 20 = the team's daily cap)
export const PAY = { star: 3, bubble: 3, fish: 3, hoops: 2, ring: 2, shuffle: 2, golf: 3, slide: 2 };
export const DAILY_CAP = 20;
const PAY_KEYS = Object.keys(PAY);

/** yyyymmdd of a date (a number that only grows). */
export function dayStamp(d = new Date()) {
  return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
}

/** profile.cruise read kindly: { v, best: {}, plays: {}, day, mask, paid, captain }. Mends what is broken. */
export function cruiseData(profile) {
  if (!profile || typeof profile !== 'object') return null;
  let c = profile.cruise;
  if (!c || typeof c !== 'object' || Array.isArray(c)) c = profile.cruise = {};
  c.v = 1;
  for (const k of ['best', 'plays']) {
    if (!c[k] || typeof c[k] !== 'object' || Array.isArray(c[k])) c[k] = {};
    for (const key of Object.keys(c[k])) {
      const n = c[k][key];
      if (!isNum(n) || n < 0) delete c[k][key];
    }
  }
  if (!isNum(c.day)) c.day = 0;
  if (!isNum(c.mask)) c.mask = 0;
  if (!isNum(c.paid) || c.paid < 0) c.paid = 0;
  return c;
}

/**
 * The coins for doing `what` (a PAY key) now: its amount the first time today, never past the
 * daily cap; 0 otherwise. Marks it paid. A clock that went backwards pays nothing.
 */
export function dailyCoins(c, what, day = dayStamp()) {
  if (!c || !isNum(day)) return 0;
  const bit = PAY_KEYS.indexOf(what);
  if (bit < 0) return 0;
  if (c.day > day) return 0;
  if (c.day !== day) {
    c.day = day;
    c.mask = 0;
    c.paid = 0;
  }
  if (c.mask & (1 << bit)) return 0;
  c.mask |= 1 << bit;
  const n = Math.max(0, Math.min(PAY[what], DAILY_CAP - c.paid));
  c.paid += n;
  return n;
}

/** Keep a score: returns { best, isBest } (the first score is a best too). Scores are >= 0 integers. */
export function recordScore(c, game, score) {
  if (!c) return { best: 0, isBest: false };
  const s = isNum(score) ? Math.max(0, Math.min(99999, Math.floor(score))) : 0;
  const old = isNum(c.best[game]) ? c.best[game] : -1;
  c.plays[game] = Math.min(1e6, (isNum(c.plays[game]) ? c.plays[game] : 0) + 1);
  if (s > old) {
    c.best[game] = s;
    return { best: s, isBest: true };
  }
  return { best: old, isBest: false };
}

/**
 * Join two copies of profile.cruise (two devices, a backup file): the higher best and play
 * count per game, and the later day's coin record (the same day: both days' paid games, so a
 * game paid on either device is not paid again). Pure; neither input is changed.
 */
export function mergeCruise(a, b) {
  const A = cruiseData({ cruise: a && typeof a === 'object' ? JSON.parse(JSON.stringify(a)) : {} });
  const B = cruiseData({ cruise: b && typeof b === 'object' ? JSON.parse(JSON.stringify(b)) : {} });
  const out = { v: 1, best: { ...A.best }, plays: { ...A.plays }, day: A.day, mask: A.mask, paid: A.paid };
  for (const k of ['best', 'plays']) {
    for (const [key, n] of Object.entries(B[k])) if (!(out[k][key] >= n)) out[k][key] = n;
  }
  if (B.day > A.day) Object.assign(out, { day: B.day, mask: B.mask, paid: B.paid });
  else if (B.day === A.day) Object.assign(out, { mask: A.mask | B.mask, paid: Math.min(DAILY_CAP, Math.max(A.paid, B.paid)) });
  return out;
}

// ---------- the arcade's scoring helpers ----------

/** Fish Match: points for a finished board (pairs, how quickly). Always > 0 once one pair is found. */
export function matchScore(pairs, seconds, flips) {
  const p = Math.max(0, pairs | 0);
  if (!p) return 0;
  const quick = clamp(Math.round((90 - (isNum(seconds) ? seconds : 90)) / 3), 0, 30);
  const neat = clamp(Math.round((p * 4 - (isNum(flips) ? flips : p * 4)) / 2), 0, 20);
  return p * 10 + quick + neat;
}

/** A little seeded random (mulberry32), so tests and rounds are repeatable. */
export function rng(seed) {
  let a = (seed >>> 0) || 1;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Shuffle a copy of list with rand (Fisher-Yates). */
export function shuffled(list, rand) {
  const a = list.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  return a;
}

// ---------- the board ----------

// Activities on the "What's on" board: which spot names and which pieces lead there
export const ACTIVITIES = [
  { key: 'pool', name: 'Pool', icon: 'pool', color: '#4FB8FF', spots: ['pool', 'pool deck', 'splash pool'], pieces: ['cruise_float', 'cruise_lounger'] },
  { key: 'slides', name: 'Water Slides', icon: 'slide', color: '#FF7EB6', spots: ['slides', 'slide', 'water slides'], pieces: ['cruise_slide', 'cruise_waterslide'] },
  { key: 'arcade', name: 'Arcade', icon: 'arcade', color: '#9C7BFF', spots: ['arcade'], pieces: ['cruise_arcade'] },
  { key: 'games', name: 'Deck Games', icon: 'hoops', color: '#FF9F43', spots: ['games', 'sports', 'sports deck', 'court', 'game court'], pieces: ['cruise_hoops', 'cruise_ringtoss', 'cruise_shuffle'] },
  { key: 'golf', name: 'Mini Golf', icon: 'golf', color: '#3FD8B0', spots: ['golf', 'mini golf', 'minigolf'], pieces: ['cruise_golf'] },
  { key: 'dance', name: 'Dance Party', icon: 'dance', color: '#FF5FA2', spots: ['dance', 'dance floor', 'disco'], pieces: ['cruise_dj'] },
  { key: 'movies', name: 'Movies', icon: 'movie', color: '#6CC6FF', spots: ['theater', 'theatre', 'movies', 'cinema', 'movie'], pieces: ['cruise_movie'] },
  { key: 'bridge', name: 'Captain\'s Bridge', icon: 'wheel', color: '#FFC94D', spots: ['bridge', 'captain'], pieces: ['cruise_wheel'] },
  { key: 'cabins', name: 'Cabins', icon: 'bed', color: '#C8B4FF', spots: ['cabins', 'cabin', 'rooms'], pieces: ['cruise_towel'] },
  { key: 'beach', name: 'Beach Island', icon: 'palm', color: '#FFD43B', spots: ['beach', 'island', 'palm island'], pieces: [] },
];

/** Which activity a spot name belongs to (lower-case match), or null. */
export function activityOfSpot(name) {
  const n = cleanName(name, 40).toLowerCase();
  if (!n) return null;
  for (const a of ACTIVITIES) if (a.spots.includes(n)) return a.key;
  for (const a of ACTIVITIES) if (a.spots.some((s) => n.includes(s))) return a.key;
  return null;
}

/** The nearest of points [{ x, y, z, ... }] to (x, y, z), or null. */
export function nearest(points, x, y, z) {
  let best = null, bestD = Infinity;
  for (const p of points) {
    if (!p || !isNum(p.x) || !isNum(p.y) || !isNum(p.z)) continue;
    const d = (p.x - x) ** 2 + ((p.y - y) * 2) ** 2 + (p.z - z) ** 2;
    if (d < bestD) { bestD = d; best = p; }
  }
  return best;
}
