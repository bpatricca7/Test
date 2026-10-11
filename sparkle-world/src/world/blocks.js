// The block library: ~200 blocks with hand-tuned pastel pixel-art tiles (16x16, painted
// deterministically on canvas). Painters live in src/world/paint/<tab>.js; this file wires
// them into the registry in Bag order and keeps the small painter helpers other modules
// may import.
//
// Bag tabs used by blocks: nature building colors candy glass lights garden fun.

import { jitter, shade, mixHex } from '../core/util.js';
import { painter } from './paint/kit.js';
import * as nature from './paint/nature.js';
import * as building from './paint/building.js';
import * as colors from './paint/colors.js';
import * as candy from './paint/candy.js';
import * as glass from './paint/glass.js';
import * as lights from './paint/lights.js';
import * as garden from './paint/garden.js';
import * as fun from './paint/fun.js';

// ---------- painter helpers (exported for other block modules) ----------

export function px(ctx, x, y, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, 1, 1);
}

export function rect(ctx, x, y, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(x, y, w, h);
}

/** Fill every pixel with a weighted pick from palette [[color, weight], ...], jittered. */
export function speckle(ctx, rand, palette, jit = 0.03, x0 = 0, y0 = 0, w = 16, h = 16) {
  let total = 0;
  for (const [, wt] of palette) total += wt;
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) {
      let r = rand() * total, c = palette[0][0];
      for (const [col, wt] of palette) {
        if ((r -= wt) <= 0) { c = col; break; }
      }
      px(ctx, x, y, jit ? jitter(c, rand, jit) : c);
    }
  }
}

/**
 * Tileable Voronoi cells: returns { cell: Int8Array(256), edge: Uint8Array(256) } where edge
 * marks pixels near a border between cells.
 */
export function voronoi(rand, count, edgeWidth = 1.1) {
  const pts = [];
  for (let i = 0; i < count; i++) pts.push([rand() * 16, rand() * 16]);
  const cell = new Int8Array(256), edge = new Uint8Array(256);
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let d1 = Infinity, d2 = Infinity, best = 0;
      for (let i = 0; i < count; i++) {
        let dx = Math.abs(x + 0.5 - pts[i][0]), dy = Math.abs(y + 0.5 - pts[i][1]);
        if (dx > 8) dx = 16 - dx;
        if (dy > 8) dy = 16 - dy;
        const d = Math.sqrt(dx * dx + dy * dy);
        if (d < d1) { d2 = d1; d1 = d; best = i; } else if (d < d2) d2 = d;
      }
      cell[y * 16 + x] = best;
      edge[y * 16 + x] = d2 - d1 < edgeWidth ? 1 : 0;
    }
  }
  return { cell, edge };
}

/** Soft knitted fabric look (wool, carpets) for a plain canvas context. */
export function paintWool(ctx, rand, base) {
  for (let y = 0; y < 16; y++) {
    for (let x = 0; x < 16; x++) {
      let c = base;
      const k = (x + (y >> 1)) % 4;
      if (k === 0) c = shade(base, 0.12);
      else if (k === 2) c = shade(base, -0.06);
      if ((y & 1) === 0 && x % 4 === 1) c = shade(base, -0.1);
      px(ctx, x, y, jitter(c, rand, 0.025));
    }
  }
}

/** Horizontal planks with seams and grain for a plain canvas context. */
export function paintPlanks(ctx, rand, base, seam) {
  const light = shade(base, 0.12), dark = shade(base, -0.08);
  for (let row = 0; row < 4; row++) {
    const y0 = row * 4;
    const cut = (row * 7 + 3 + Math.floor(rand() * 4)) % 16;
    for (let y = y0; y < y0 + 4; y++) {
      for (let x = 0; x < 16; x++) {
        let c = y === y0 + 3 ? seam : rand() < 0.18 ? dark : rand() < 0.12 ? light : base;
        if (y === y0 && y !== y0 + 3) c = mixHex(c, light, 0.5);
        if (x === cut && y !== y0 + 3) c = seam;
        px(ctx, x, y, jitter(c, rand, 0.02));
      }
    }
    if (rand() < 0.5) px(ctx, (cut + 5 + Math.floor(rand() * 6)) % 16, y0 + 1, seam);
  }
}

/** The pastel wool colors (key suffix -> hex), for modules that want matching colors. */
export const WOOL_COLORS = Object.fromEntries(colors.WOOL.map(([k, c]) => [k, c]));
/** Kept for compatibility with the core's original export. */
export const CORE_WOOL = WOOL_COLORS;

/** Flat (not isometric) Bag icon for lying-flat decorations such as seashells. */
function useFlatIcon(B, def) {
  const item = B.items && B.items.get('block:' + def.key);
  if (!item) return;
  item.icon = () => {
    const src = B.tileCanvas(B.faceTile(def, 2));
    const c = document.createElement('canvas');
    c.width = 96;
    c.height = 96;
    const g = c.getContext('2d');
    g.imageSmoothingEnabled = false;
    g.drawImage(src, 8, 8, 80, 80);
    return Promise.resolve(c.toDataURL('image/png'));
  };
}

export function install(game) {
  const B = game.registry.blocks;
  const L = {
    tile: (key, fn, opts) => B.tile(key, painter(fn), opts),
    block: (def) => {
      const d = B.register(def);
      if (def.flatIcon) useFlatIcon(B, d);
      return d;
    },
  };
  // registration order = Bag order inside each tab (and the tab's own icon = its first item)
  nature.install(L);
  building.install(L);
  colors.install(L);
  candy.install(L);
  glass.install(L);
  lights.install(L);
  garden.install(L);
  fun.install(L);
}
