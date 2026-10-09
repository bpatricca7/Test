// Pixel-art painting kit for 16x16 block tiles.
//
// Painters work on a Pix: an RGBA pixel buffer with wrap-around coordinates (so patterns
// tile seamlessly), hue-shifted shading (shadows lean plum, highlights lean white) and a
// few pattern/noise helpers. Everything is deterministic: the only randomness is the
// seeded `rand` the texture builder hands to each painter.

import { hexToRgb } from '../../core/util.js';

export const T = 16;

const SHADOW = [74, 42, 94]; // plum: every darker tone leans this way (cohesive pastel palette)
const LIGHT = [255, 255, 255];

const rgbCache = new Map();
/** '#rrggbb' -> [r, g, b] (cached); arrays pass through. */
export function rgb(c) {
  if (typeof c !== 'string') return c;
  let v = rgbCache.get(c);
  if (!v) {
    v = hexToRgb(c);
    rgbCache.set(c, v);
  }
  return v;
}

/** Mix two colors (hex or rgb arrays), t = 0 -> a, 1 -> b. Returns an rgb array. */
export function mix(a, b, t) {
  const A = rgb(a), B = rgb(b);
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t, A[2] + (B[2] - A[2]) * t];
}

/** Lighter (amt > 0, toward white) or darker (amt < 0, toward plum) version of a color. */
export function tone(c, amt) {
  return amt >= 0 ? mix(c, LIGHT, amt) : mix(c, SHADOW, -amt);
}

/** A ramp of tones around a base color: tones(base, [-0.2, -0.1, 0, 0.1]) -> rgb arrays. */
export function ramp(base, steps = [-0.18, -0.09, 0, 0.08, 0.16]) {
  return steps.map((s) => tone(base, s));
}

export const smooth = (t) => t * t * (3 - 2 * t);

/**
 * Tileable value noise: an n x n lattice of random values, smoothly interpolated over the
 * 16x16 tile (wraps at the edges). Returns Float32Array(256) in 0..1.
 */
export function vnoise(rand, n = 4) {
  const lat = new Float32Array(n * n);
  for (let i = 0; i < lat.length; i++) lat[i] = rand();
  const out = new Float32Array(256);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      const fx = ((x + 0.5) / 16) * n, fy = ((y + 0.5) / 16) * n;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = smooth(fx - ix), ty = smooth(fy - iy);
      const x0 = ix % n, x1 = (ix + 1) % n, y0 = iy % n, y1 = (iy + 1) % n;
      const a = lat[y0 * n + x0], b = lat[y0 * n + x1], c = lat[y1 * n + x0], d = lat[y1 * n + x1];
      out[y * 16 + x] = (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
    }
  }
  return out;
}

/** Sum of tileable value-noise octaves, normalized to 0..1. octaves: [[latticeSize, weight], ...] */
export function fbm(rand, octaves = [[2, 0.5], [4, 0.3], [8, 0.2]]) {
  const out = new Float32Array(256);
  let total = 0;
  for (const [n, w] of octaves) {
    const v = vnoise(rand, n);
    for (let i = 0; i < 256; i++) out[i] += v[i] * w;
    total += w;
  }
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < 256; i++) {
    out[i] /= total;
    if (out[i] < lo) lo = out[i];
    if (out[i] > hi) hi = out[i];
  }
  const span = hi - lo || 1;
  for (let i = 0; i < 256; i++) out[i] = (out[i] - lo) / span;
  return out;
}

export class Pix {
  constructor(rand) {
    this.d = new Uint8ClampedArray(T * T * 4);
    this.rand = rand;
  }

  /** Byte offset of a pixel; coordinates wrap so patterns tile. */
  i(x, y) {
    return (((y & 15) << 4) + (x & 15)) << 2;
  }

  set(x, y, c, a = 255) {
    const i = this.i(x, y), v = rgb(c), d = this.d;
    d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; d[i + 3] = a;
  }

  /** Like set() but ignores pixels outside the tile (no wrap), for sprites. */
  put(x, y, c, a = 255) {
    if (x < 0 || y < 0 || x > 15 || y > 15) return;
    this.set(x, y, c, a);
  }

  get(x, y) {
    const i = this.i(x, y), d = this.d;
    return [d[i], d[i + 1], d[i + 2]];
  }

  alpha(x, y) {
    return this.d[this.i(x, y) + 3];
  }

  setAlpha(x, y, a) {
    this.d[this.i(x, y) + 3] = a;
  }

  fill(c, a = 255) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) this.set(x, y, c, a);
    return this;
  }

  clear() {
    this.d.fill(0);
    return this;
  }

  rect(x, y, w, h, c, a = 255) {
    for (let yy = y; yy < y + h; yy++) for (let xx = x; xx < x + w; xx++) this.set(xx, yy, c, a);
  }

  /** Blend color c over the existing pixel by t (alpha unchanged unless the pixel was empty). */
  blend(x, y, c, t) {
    const i = this.i(x, y), d = this.d, v = rgb(c);
    if (d[i + 3] === 0) {
      d[i] = v[0]; d[i + 1] = v[1]; d[i + 2] = v[2]; d[i + 3] = 255;
      return;
    }
    d[i] += (v[0] - d[i]) * t;
    d[i + 1] += (v[1] - d[i + 1]) * t;
    d[i + 2] += (v[2] - d[i + 2]) * t;
  }

  /** Lighten (amt > 0) or darken (amt < 0) an existing pixel with the kit's shading. */
  shade(x, y, amt) {
    if (amt >= 0) this.blend(x, y, LIGHT, amt);
    else this.blend(x, y, SHADOW, -amt);
  }

  each(fn) {
    for (let y = 0; y < 16; y++) for (let x = 0; x < 16; x++) fn(x, y);
  }

  /**
   * Draw string pixel art: rows of characters mapped through pal ({ ch: color | null }).
   * Characters missing from pal (and '.') are skipped; null clears the pixel.
   * opts: { wrap: false } keeps sprites from wrapping around the tile edge.
   */
  art(rows, pal, ox = 0, oy = 0, { wrap = false, alpha = 255 } = {}) {
    for (let r = 0; r < rows.length; r++) {
      const row = rows[r];
      for (let c = 0; c < row.length; c++) {
        const ch = row[c];
        if (ch === '.' || ch === ' ' || !(ch in pal)) continue;
        const x = ox + c, y = oy + r;
        if (!wrap && (x < 0 || y < 0 || x > 15 || y > 15)) continue;
        const col = pal[ch];
        if (col === null) this.setAlpha(x, y, 0);
        else this.set(x, y, col, Array.isArray(col) && col.length === 4 ? col[3] : alpha);
      }
    }
  }

  /** Paint a glyph (rows of 'X') in one color at (ox, oy), wrapping around the tile. */
  glyph(rows, c, ox, oy, a = 255) {
    for (let r = 0; r < rows.length; r++) {
      for (let k = 0; k < rows[r].length; k++) if (rows[r][k] === 'X') this.set(ox + k, oy + r, c, a);
    }
  }

  /** Darken transparent pixels next to opaque ones (sprite outline) — 4-neighbour. */
  outline(c, { diagonal = false } = {}) {
    const mark = [];
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        if (this.alpha(x, y)) continue;
        const nb = (dx, dy) => {
          const xx = x + dx, yy = y + dy;
          return xx >= 0 && yy >= 0 && xx < 16 && yy < 16 && this.alpha(xx, yy) > 0;
        };
        if (nb(1, 0) || nb(-1, 0) || nb(0, 1) || nb(0, -1) || (diagonal && (nb(1, 1) || nb(-1, 1) || nb(1, -1) || nb(-1, -1)))) mark.push(x, y);
      }
    }
    for (let k = 0; k < mark.length; k += 2) this.set(mark[k], mark[k + 1], c);
  }

  /** Soft bevel: lighter top/left edge, darker bottom/right edge (a tile that pops out). */
  bevel(hi = 0.22, lo = -0.18, w = 1) {
    for (let k = 0; k < w; k++) {
      const f = 1 - k / w;
      for (let t = 0; t < 16; t++) {
        this.shade(t, k, hi * f);
        this.shade(k, t, hi * f * 0.8);
        this.shade(t, 15 - k, lo * f);
        this.shade(15 - k, t, lo * f * 0.8);
      }
    }
  }

  /** Round pastel "pillow" shading: bright middle, darker edges and corners. */
  pillow(amt = 0.14) {
    this.each((x, y) => {
      const dx = Math.abs(x - 7.5) / 7.5, dy = Math.abs(y - 7.5) / 7.5;
      const d = Math.max(dx, dy) ** 3 * 0.7 + (dx * dx + dy * dy) * 0.3;
      this.shade(x, y, amt * 0.5 - amt * 1.6 * d);
    });
  }

  copyFrom(other) {
    this.d.set(other.d);
    return this;
  }

  /** Write into a 2D canvas context (the texture builder's 16x16 canvas). */
  write(ctx) {
    ctx.putImageData(new ImageData(this.d, 16, 16), 0, 0);
  }
}

/** Wrap a Pix painter as a registry tile painter (ctx, rand). */
export function painter(fn) {
  return (ctx, rand) => {
    const p = new Pix(rand);
    fn(p, rand);
    p.write(ctx);
  };
}

// ---------- glyphs ----------

export const G = {
  heart7: ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'],
  heart5: ['XX.XX', 'XXXXX', 'XXXXX', '.XXX.', '..X..'],
  heart3: ['X.X', 'XXX', '.X.'],
  star7: ['...X...', '..XXX..', 'XXXXXXX', '.XXXXX.', '..XXX..', '.XX.XX.', '.X...X.'],
  star5: ['..X..', '.XXX.', 'XXXXX', '.XXX.', '.X.X.'],
  plus3: ['.X.', 'XXX', '.X.'],
  spark5: ['..X..', '..X..', 'XX.XX', '..X..', '..X..'],
  dot2: ['XX', 'XX'],
  dot3: ['.X.', 'XXX', '.X.'],
  dot4: ['.XX.', 'XXXX', 'XXXX', '.XX.'],
  circle6: ['.XXXX.', 'XXXXXX', 'XXXXXX', 'XXXXXX', 'XXXXXX', '.XXXX.'],
  flower5: ['.X.X.', 'XXXXX', '.XXX.', 'XXXXX', '.X.X.'],
};

/** A little 4-point sparkle: bright center, softer arms (wraps). */
export function sparkle(p, x, y, c = '#FFFFFF', arm = 1) {
  p.set(x, y, c);
  for (let k = 1; k <= arm; k++) {
    const t = k === arm && arm > 1 ? 0.55 : 0.8;
    p.blend(x + k, y, c, t); p.blend(x - k, y, c, t);
    p.blend(x, y + k, c, t); p.blend(x, y - k, c, t);
  }
}

// ---------- reusable surface painters ----------

/**
 * Soft natural material: smooth tileable noise quantized into the given colors (dark ->
 * light), with a pinch of per-pixel dither so bands never look like contour lines.
 */
export function natural(p, rand, colors, { oct = [[2, 0.45], [4, 0.35], [8, 0.2]], dither = 0.12, bias = 0 } = {}) {
  const n = fbm(rand, oct);
  const k = colors.length;
  p.each((x, y) => {
    let v = n[y * 16 + x] + (rand() - 0.5) * dither + bias;
    v = Math.max(0, Math.min(0.999, v));
    p.set(x, y, colors[Math.floor(v * k)]);
  });
}

/** Scatter little pebbles/specks: `count` dots (1 or 2 px wide) with an optional shadow below. */
export function pebbles(p, rand, count, body, lo = null) {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * 16), y = Math.floor(rand() * 16);
    const big = rand() < 0.45;
    p.set(x, y, body);
    if (big) {
      p.set(x + 1, y, body);
      if (lo) p.set(x + 1, y + 1, lo);
    } else if (lo) p.set(x, y + 1, lo);
  }
}

/** Knitted wool: rows of little V stitches. */
export function knit(p, rand, base) {
  const hi = tone(base, 0.16), mid = tone(base, 0.04), lo = tone(base, -0.1), deep = tone(base, -0.17);
  p.each((x, y) => {
    const sx = x & 3, sy = y & 3;
    // each 4x4 cell holds one V stitch
    let c;
    if (sy === 0) c = sx === 0 || sx === 3 ? hi : mid;
    else if (sy === 1) c = sx === 1 || sx === 2 ? hi : mid;
    else if (sy === 2) c = sx === 1 || sx === 2 ? mid : lo;
    else c = sx === 0 || sx === 3 ? deep : lo;
    p.set(x, y, c);
    if (rand() < 0.07) p.shade(x, y, rand() < 0.5 ? 0.07 : -0.06);
  });
}

/** Horizontal planks with seams, grain, staggered board ends and little nails. */
export function planks(p, rand, base, seam = null, { rows = 4, nails = true } = {}) {
  const sm = seam ? rgb(seam) : tone(base, -0.3);
  const hi = tone(base, 0.14), grain = tone(base, -0.08), grain2 = tone(base, 0.06);
  const rh = 16 / rows;
  for (let r = 0; r < rows; r++) {
    const y0 = r * rh;
    const cut = (r * 5 + 3 + Math.floor(rand() * 5)) % 16;
    const boardTone = rand() * 0.08 - 0.04;
    for (let y = y0; y < y0 + rh; y++) {
      for (let x = 0; x < 16; x++) {
        let c = tone(base, boardTone);
        if (y === y0 + rh - 1) c = sm;
        else if (y === y0) c = mix(c, hi, 0.6);
        else if (rand() < 0.16) c = rand() < 0.6 ? grain : grain2;
        p.set(x, y, c);
      }
    }
    // board end seam
    for (let y = y0; y < y0 + rh - 1; y++) p.set(cut, y, sm);
    p.set(cut + 1, y0, hi);
    // grain streak along the board
    const gy = y0 + 1 + Math.floor(rand() * (rh - 2));
    const gx = Math.floor(rand() * 16), gl = 3 + Math.floor(rand() * 4);
    for (let k = 0; k < gl; k++) if (((gx + k) & 15) !== cut) p.set(gx + k, gy, grain);
    if (nails) {
      p.set(cut + 2, y0 + 1, tone(base, -0.22));
      p.set(cut - 2, y0 + 1, tone(base, -0.22));
    }
  }
}

/**
 * Bricks: rows of `h` px (last row = mortar), bricks `w` px wide, staggered every row.
 * Each brick gets its own tone plus a soft highlight on its top-left edge.
 */
export function bricks(p, rand, base, mortar, { h = 4, w = 8, vary = 0.07, hi = 0.14, lo = -0.12 } = {}) {
  const rows = 16 / h;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2) * (w / 2);
    const y0 = r * h;
    for (let b = 0; b < 16 / w; b++) {
      const x0 = b * w + off;
      const t = (rand() * 2 - 1) * vary;
      for (let y = y0; y < y0 + h - 1; y++) {
        for (let x = x0; x < x0 + w - 1; x++) {
          let c = tone(base, t);
          if (y === y0) c = tone(base, t + hi);
          else if (y === y0 + h - 2) c = tone(base, t + lo * 0.6);
          if (x === x0 && y > y0) c = tone(base, t + hi * 0.6);
          else if (x === x0 + w - 2 && y > y0) c = tone(base, t + lo);
          if (rand() < 0.08) c = tone(c, rand() < 0.5 ? 0.05 : -0.05);
          p.set(x, y, c);
        }
        p.set(x0 + w - 1, y, mortar);
      }
      for (let x = x0; x < x0 + w; x++) p.set(x, y0 + h - 1, mortar);
    }
  }
}

/** Glass pane: frame, inner bevel line and a diagonal double shine; the rest clear. */
export function glassPane(p, frame, shine, { inner = null, fillAlpha = 0, fill = null } = {}) {
  p.clear();
  if (fill && fillAlpha) p.fill(fill, fillAlpha);
  const f = rgb(frame);
  for (let t = 0; t < 16; t++) {
    p.set(t, 0, tone(f, 0.18)); p.set(0, t, tone(f, 0.12));
    p.set(t, 15, tone(f, -0.1)); p.set(15, t, tone(f, -0.06));
  }
  if (inner) {
    const a = 150;
    for (let t = 1; t < 15; t++) { p.set(t, 1, inner, a); p.set(1, t, inner, a); }
  }
  // shine streaks
  const s = rgb(shine);
  for (let k = 0; k < 5; k++) p.set(3 + k, 8 - k, s, 235);
  for (let k = 0; k < 3; k++) p.set(4 + k, 11 - k, s, 200);
  p.set(12, 12, s, 220); p.set(12, 13, s, 160); p.set(13, 12, s, 160);
}

/** Leaves: clumps from noise, some holes (cutout), highlight + shadow bits. */
export function leaves(p, rand, colors, { holes = 0.12, blossoms = null, blossomRate = 0, sparkles = null } = {}) {
  const n = fbm(rand, [[4, 0.6], [8, 0.4]]);
  const k = colors.length;
  p.each((x, y) => {
    const v = n[y * 16 + x];
    if (rand() < holes * (1.4 - v)) {
      p.setAlpha(x, y, 0);
      return;
    }
    let idx = Math.floor(Math.max(0, Math.min(0.999, v + (rand() - 0.5) * 0.35)) * k);
    p.set(x, y, colors[idx]);
  });
  // little leaf highlights (2px) and shadow notches
  for (let i = 0; i < 9; i++) {
    const x = Math.floor(rand() * 16), y = Math.floor(rand() * 16);
    if (!p.alpha(x, y)) continue;
    p.set(x, y, tone(colors[k - 1], 0.14));
    p.set(x + 1, y, colors[k - 1]);
    p.set(x, y + 1, colors[0]);
  }
  if (blossoms) {
    for (let i = 0; i < blossomRate; i++) {
      const x = Math.floor(rand() * 16), y = Math.floor(rand() * 16);
      const c = blossoms[Math.floor(rand() * blossoms.length)];
      p.set(x, y, c);
      if (rand() < 0.6) { p.set(x + 1, y, c); p.set(x, y + 1, c); p.set(x + 1, y + 1, tone(c, -0.12)); }
    }
  }
  if (sparkles) {
    for (let i = 0; i < 4; i++) p.set(Math.floor(rand() * 16), Math.floor(rand() * 16), sparkles);
  }
}

/** Vertical bark: columns of varying tone with darker furrows. */
export function bark(p, rand, colors, { furrows = 3, knots = 1 } = {}) {
  const k = colors.length;
  const col = [];
  for (let x = 0; x < 16; x++) col.push(Math.floor(rand() * k));
  // smooth neighbour columns a little
  p.each((x, y) => {
    let idx = Math.round((col[x] + col[(x + 1) & 15]) / 2);
    if (rand() < 0.12) idx = Math.max(0, Math.min(k - 1, idx + (rand() < 0.5 ? -1 : 1)));
    p.set(x, y, colors[idx]);
  });
  for (let f = 0; f < furrows; f++) {
    let x = Math.floor(rand() * 16);
    const y0 = Math.floor(rand() * 16), len = 5 + Math.floor(rand() * 8);
    for (let y = 0; y < len; y++) {
      p.set(x, y0 + y, colors[0]);
      if (rand() < 0.2) x += rand() < 0.5 ? -1 : 1;
    }
  }
  for (let i = 0; i < knots; i++) {
    const x = Math.floor(rand() * 14) + 1, y = Math.floor(rand() * 14) + 1;
    p.set(x, y, colors[0]); p.set(x + 1, y, colors[0]); p.set(x, y + 1, colors[0]); p.set(x + 1, y + 1, colors[1]);
    p.set(x, y - 1, colors[k - 1]);
  }
}

/** Log end: concentric rounded-square rings in `wood` tones inside a `rim` of bark. */
export function rings(p, rand, rim, wood, ringc) {
  p.each((x, y) => {
    const dx = Math.abs(x - 7.5), dy = Math.abs(y - 7.5);
    const d = Math.max(dx, dy) * 0.7 + Math.hypot(dx, dy) * 0.3;
    let c;
    if (Math.max(dx, dy) > 6.6) c = rim;
    else if (Math.floor(d + 0.3) % 2 === 1 && d > 1.2) c = ringc;
    else c = wood;
    p.set(x, y, c);
    if (rand() < 0.06) p.shade(x, y, -0.05);
  });
  p.set(7, 7, ringc);
}

/**
 * Overlay a material drip on the top rows of a side tile: `colors` dark -> light, drips of
 * minLen..maxLen px with rounded tips and a darker rim under them.
 */
export function drip(p, rand, colors, { min = 2, max = 5, rim = null, fat = true } = {}) {
  const k = colors.length;
  let len = min + Math.floor(rand() * (max - min + 1));
  const lens = [];
  for (let x = 0; x < 16; x++) {
    if (rand() < 0.35) len = min + Math.floor(rand() * (max - min + 1));
    lens.push(len);
  }
  // make drips rounded: a long drip is flanked by medium ones
  for (let x = 0; x < 16; x++) {
    const L = lens[x];
    for (let y = 0; y < L; y++) {
      const t = y / Math.max(1, L);
      const idx = Math.max(0, Math.min(k - 1, Math.floor((1 - t) * (k - 1) + rand() * 0.8)));
      p.set(x, y, colors[idx]);
    }
    p.set(x, 0, colors[k - 1]);
    if (rim) p.set(x, L, rim);
    if (fat && L >= max - 1 && x > 0) p.set(x, L - 1, colors[0]);
  }
}

/** Sprinkles: little 2-px candy dashes in the given colors. */
export function sprinkles(p, rand, colors, count = 10) {
  for (let i = 0; i < count; i++) {
    const x = Math.floor(rand() * 16), y = Math.floor(rand() * 16);
    const c = colors[i % colors.length];
    p.set(x, y, c);
    const dir = Math.floor(rand() * 3);
    if (dir === 0) p.set(x + 1, y, c);
    else if (dir === 1) p.set(x, y + 1, c);
    else p.set(x + 1, y + 1, c);
  }
}

/** Repeat a glyph on a staggered grid (wallpaper motifs). */
export function motif(p, rows, c, { sx = 8, sy = 8, ox = 0, oy = 0, stagger = true } = {}) {
  for (let gy = 0; gy < 16; gy += sy) {
    const row = gy / sy;
    for (let gx = 0; gx < 16; gx += sx) {
      const dx = stagger && row % 2 ? sx / 2 : 0;
      p.glyph(rows, c, gx + ox + dx, gy + oy);
    }
  }
}

/** Checkerboard of `size` px squares. */
export function checker(p, a, b, size = 4) {
  p.each((x, y) => p.set(x, y, ((x / size | 0) + (y / size | 0)) % 2 ? b : a));
}

/** Rounded gradient disc helper for sprites: returns true when (x,y) is inside. */
export function inCircle(x, y, cx, cy, r) {
  const dx = x + 0.5 - cx, dy = y + 0.5 - cy;
  return dx * dx + dy * dy <= r * r;
}
