// Magic Houses building kit: records a prefab's blocks and furniture in prefab-local
// coordinates, with small readable helpers (walls, roofs, towers, domes, string layers).
//
// Prefab-local frame: x across (0 = left when you stand in front of the house), y up
// (0 = the ground layer, which replaces the terrain's top block), z front-to-back with
// z = D-1 the FRONT row (the side that faces the player / has the door) and z = 0 the back.
// Furniture rot uses the same frame: 0 faces the front (+z), 1 faces +x (right), 2 faces the
// back (-z), 3 faces -x (left).
//
// Block keys may carry stand-ins: 'roof_straw|hay' uses the first key the registry knows.

export const ROT = { FRONT: 0, RIGHT: 1, BACK: 2, LEFT: 3 };

/** Records what a prefab's build(api) asks for. */
export class PrefabRecorder {
  constructor(size) {
    const [W, H, D] = size.map((v) => Math.max(1, v | 0));
    this.W = W;
    this.H = H;
    this.D = D;
    this.cells = new Array(W * H * D).fill(null); // null untouched, 'air' or a block key
    this.furniture = [];
    this.outside = 0;
  }

  index(x, y, z) {
    return (y * this.D + z) * this.W + x;
  }

  inside(x, y, z) {
    return x >= 0 && y >= 0 && z >= 0 && x < this.W && y < this.H && z < this.D;
  }

  set(x, y, z, key) {
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    if (!this.inside(x, y, z)) {
      this.outside++;
      return;
    }
    this.cells[this.index(x, y, z)] = key;
  }

  get(x, y, z) {
    x = Math.round(x); y = Math.round(y); z = Math.round(z);
    return this.inside(x, y, z) ? this.cells[this.index(x, y, z)] : null;
  }
}

const order = (a, b) => (a <= b ? [a, b] : [b, a]);

/** Tiny deterministic hash for decorative variety (flowers, gumdrop colors...). */
export function hash2(x, z, seed = 0) {
  let h = Math.imul((x | 0) + 7919 * seed, 374761393) + Math.imul(z | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/**
 * The api handed to prefab build(api). The three DESIGN.md calls (block, fill, furn) plus
 * helpers. Coordinates are rounded; anything outside the prefab box is ignored.
 */
export function makeApi(rec) {
  const api = {
    size: [rec.W, rec.H, rec.D],
    W: rec.W,
    H: rec.H,
    D: rec.D,

    /** One block (key 'air' clears, null/undefined does nothing). */
    block(x, y, z, key) {
      if (key === null || key === undefined) return api;
      rec.set(x, y, z, key);
      return api;
    },

    /** Fill a box (inclusive corners, any order). */
    fill(x0, y0, z0, x1, y1, z1, key) {
      if (key === null || key === undefined) return api;
      [x0, x1] = order(Math.round(x0), Math.round(x1));
      [y0, y1] = order(Math.round(y0), Math.round(y1));
      [z0, z1] = order(Math.round(z0), Math.round(z1));
      for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) rec.set(x, y, z, key);
      return api;
    },

    air(x0, y0, z0, x1, y1, z1) {
      return api.fill(x0, y0, z0, x1, y1, z1, 'air');
    },

    get(x, y, z) {
      return rec.get(x, y, z);
    },

    /**
     * Furniture at prefab-local anchor (x, y, z) with prefab-local rot (see ROT). keys: one
     * key, 'a|b|c' or ['a', 'b'] (first registered one wins; none registered = skipped).
     * opts.back: (x, z) is the piece's BACK row (against a wall) instead of its front row, so
     * deep pieces (beds, bathtubs) grow into the room whatever their real depth is.
     * opts.orBlock: a block to put in the anchor cell when no furniture key is registered.
     */
    furn(keys, x, y, z, rot = 0, color = null, data = null, opts = {}) {
      const list = Array.isArray(keys) ? keys : String(keys).split('|');
      rec.furniture.push({
        keys: list, x: Math.round(x), y: Math.round(y), z: Math.round(z), rot: ((rot | 0) % 4 + 4) % 4,
        color: color || null, data: data || null, back: !!opts.back, orBlock: opts.orBlock || null,
      });
      return api;
    },

    /** Furniture whose back touches (x, z): the usual way to stand things against walls. */
    put(keys, x, y, z, rot = 0, color = null, data = null, opts = {}) {
      return api.furn(keys, x, y, z, rot, color, data, { back: true, ...opts });
    },

    // ---------- shapes ----------

    /** Perimeter walls of the rectangle x0..x1 / z0..z1 from y0 to y1. */
    walls(x0, z0, x1, z1, y0, y1, key) {
      api.fill(x0, y0, z0, x1, y1, z0, key);
      api.fill(x0, y0, z1, x1, y1, z1, key);
      api.fill(x0, y0, z0, x0, y1, z1, key);
      api.fill(x1, y0, z0, x1, y1, z1, key);
      return api;
    },

    /**
     * Inner wall covering (wallpaper) just inside the outer walls x0..x1 / z0..z1. Where the
     * outer wall is open (windows, doorways) the lining stays open too: deep window sills.
     */
    lining(x0, z0, x1, z1, y0, y1, key) {
      const open = (k) => k === 'air' || (typeof k === 'string' && /glass|ice/.test(k));
      const ix0 = x0 + 1, ix1 = x1 - 1, iz0 = z0 + 1, iz1 = z1 - 1;
      for (let y = y0; y <= y1; y++) {
        for (let z = iz0; z <= iz1; z++) {
          for (let x = ix0; x <= ix1; x++) {
            if (x !== ix0 && x !== ix1 && z !== iz0 && z !== iz1) continue;
            let hole = false;
            if (x === ix0 && open(rec.get(x0, y, z))) hole = true;
            if (x === ix1 && open(rec.get(x1, y, z))) hole = true;
            if (z === iz0 && open(rec.get(x, y, z0))) hole = true;
            if (z === iz1 && open(rec.get(x, y, z1))) hole = true;
            rec.set(x, y, z, hole ? 'air' : key);
          }
        }
      }
      return api;
    },

    /** Corner posts of a rectangle. */
    corners(x0, z0, x1, z1, y0, y1, key) {
      for (const [x, z] of [[x0, z0], [x1, z0], [x0, z1], [x1, z1]]) api.fill(x, y0, z, x, y1, z, key);
      return api;
    },

    /** One horizontal layer. */
    floor(x0, z0, x1, z1, y, key) {
      return api.fill(x0, y, z0, x1, y, z1, key);
    },

    /** Checkerboard floor (kitchens, bathrooms, ballrooms). */
    checker(x0, z0, x1, z1, y, a, b) {
      [x0, x1] = order(x0, x1);
      [z0, z1] = order(z0, z1);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) rec.set(x, y, z, (x + z) % 2 ? b : a);
      return api;
    },

    /**
     * Stepped gable roof over x0..x1 / z0..z1 starting at height y. axis 'x': the ridge runs
     * along x (slopes face front and back); 'z': ridge along z. opts: { gable: key filling the
     * triangular end walls at gableAt [a, b] (x for axis 'x'), ridge: key for the top row,
     * eave: key for the lowest row, inner: key filling under the roof (default nothing) }.
     */
    gable(x0, z0, x1, z1, y, key, opts = {}) {
      const axis = opts.axis || 'x';
      [x0, x1] = order(x0, x1);
      [z0, z1] = order(z0, z1);
      const lo = axis === 'x' ? z0 : x0, hi = axis === 'x' ? z1 : x1;
      const a0 = axis === 'x' ? x0 : z0, a1 = axis === 'x' ? x1 : z1;
      const put = (along, across, yy, k) => (axis === 'x' ? rec.set(along, yy, across, k) : rec.set(across, yy, along, k));
      for (let k = 0; lo + k <= hi - k; k++) {
        const yy = y + k;
        const top = lo + k + 1 >= hi - k;
        const rowKey = top && opts.ridge ? opts.ridge : k === 0 && opts.eave ? opts.eave : key;
        for (let along = a0; along <= a1; along++) {
          put(along, lo + k, yy, rowKey);
          put(along, hi - k, yy, rowKey);
          if (opts.inner) for (let c = lo + k + 1; c <= hi - k - 1; c++) put(along, c, yy, opts.inner);
        }
        if (opts.gable && k >= 1) {
          const ends = opts.gableAt || [a0 + 1, a1 - 1];
          for (const e of ends) for (let c = lo + k + 1; c <= hi - k - 1; c++) put(e, c, yy, opts.gable);
        }
      }
      return api;
    },

    /** Stepped pyramid (hip) roof: each layer insets one on every side. opts.cap: top fill. */
    hip(x0, z0, x1, z1, y, key, opts = {}) {
      [x0, x1] = order(x0, x1);
      [z0, z1] = order(z0, z1);
      for (let k = 0; x0 + k <= x1 - k && z0 + k <= z1 - k; k++) {
        const ax = x0 + k, bx = x1 - k, az = z0 + k, bz = z1 - k;
        const last = ax + 1 >= bx - 1 || az + 1 >= bz - 1;
        if (last) {
          api.fill(ax, y + k, az, bx, y + k, bz, opts.cap || key);
          break;
        }
        api.walls(ax, az, bx, bz, y + k, y + k, key);
      }
      return api;
    },

    /** Round column/tower: cells whose centre is within r of (cx, cz). hollow: ring only. */
    cyl(cx, cz, r, y0, y1, key, opts = {}) {
      const R = Math.ceil(r);
      for (let y = Math.min(y0, y1); y <= Math.max(y0, y1); y++) {
        for (let z = Math.floor(cz - R); z <= Math.ceil(cz + R); z++) {
          for (let x = Math.floor(cx - R); x <= Math.ceil(cx + R); x++) {
            const d = Math.hypot(x - cx, z - cz);
            if (d > r + 0.01) continue;
            if (opts.hollow && d <= r - 1.01) {
              if (opts.inner) rec.set(x, y, z, opts.inner);
              continue;
            }
            rec.set(x, y, z, key);
          }
        }
      }
      return api;
    },

    /** Pointed round roof: discs shrinking by `step` per layer from radius r at height y. */
    cone(cx, cz, r, y, key, opts = {}) {
      const step = opts.step || 0.75;
      let k = 0;
      for (let rr = r; rr > 0.3; rr -= step, k++) api.cyl(cx, cz, rr, y + k, y + k, key);
      if (opts.tip) {
        const tx = Math.round(cx), tz = Math.round(cz);
        rec.set(tx, y + k, tz, opts.tip);
        if (opts.tipHeight > 1) api.fill(tx, y + k, tz, tx, y + k + opts.tipHeight - 1, tz, opts.tip);
      }
      return api;
    },

    /** Ellipsoid dome centred at (cx, cy, cz) with radii (rx, ry, rz); upper half only. */
    dome(cx, cy, cz, rx, ry, rz, key, opts = {}) {
      const thick = opts.thick ?? 1;
      for (let y = Math.floor(cy); y <= Math.ceil(cy + ry); y++) {
        for (let z = Math.floor(cz - rz); z <= Math.ceil(cz + rz); z++) {
          for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
            const d = Math.hypot((x - cx) / rx, (y - cy) / ry, (z - cz) / rz);
            if (d > 1.0) continue;
            const di = Math.hypot((x - cx) / Math.max(0.5, rx - thick), (y - cy) / Math.max(0.5, ry - thick), (z - cz) / Math.max(0.5, rz - thick));
            if (di < 1.0) {
              if (opts.inner) rec.set(x, y, z, opts.inner);
              continue;
            }
            rec.set(x, y, z, typeof key === 'function' ? key(x, y, z) : key);
          }
        }
      }
      return api;
    },

    /** A straight line of blocks (branches, struts, beams). */
    line(x0, y0, z0, x1, y1, z1, key) {
      const n = Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0), Math.abs(z1 - z0), 1);
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        rec.set(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t, z0 + (z1 - z0) * t, key);
      }
      return api;
    },

    /** A round blob (leafy clumps, clouds, cotton candy). key may be a function (x, y, z). */
    blob(cx, cy, cz, r, key, opts = {}) {
      const ry = opts.ry ?? r;
      for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++) {
        for (let z = Math.floor(cz - r); z <= Math.ceil(cz + r); z++) {
          for (let x = Math.floor(cx - r); x <= Math.ceil(cx + r); x++) {
            if (Math.hypot((x - cx) / r, (y - cy) / ry, (z - cz) / r) > 1) continue;
            if (opts.keep && rec.get(x, y, z) !== null && rec.get(x, y, z) !== 'air') continue;
            rec.set(x, y, z, typeof key === 'function' ? key(x, y, z) : key);
          }
        }
      }
      return api;
    },

    /**
     * Stacked string layers: layers[0] is the lowest (at y0); each layer is rows of chars,
     * row 0 at z0 (the back), x increasing to the right. legend maps chars to keys;
     * ' ' leaves the cell alone and '.' clears it. A legend value may be a function
     * (x, y, z) => key for variety.
     */
    layers(x0, y0, z0, layers, legend) {
      layers.forEach((rows, ly) => {
        rows.forEach((row, rz) => {
          for (let rx = 0; rx < row.length; rx++) {
            const ch = row[rx];
            if (ch === ' ') continue;
            const x = x0 + rx, y = y0 + ly, z = z0 + rz;
            let key = ch === '.' ? 'air' : legend[ch];
            if (typeof key === 'function') key = key(x, y, z);
            if (key) rec.set(x, y, z, key);
          }
        });
      });
      return api;
    },

    /** A doorway (1 wide, h tall) in a wall plus the door furniture facing rot. */
    door(x, y, z, opts = {}) {
      const h = opts.h ?? 2;
      api.air(x, y, z, x, y + h - 1, z);
      api.furn(opts.key || 'door', x, y, z, opts.rot ?? 0, opts.color || null, opts.data || null);
      return api;
    },

    /** Deterministic flower bed on the layer y (flowers stand in cells at y; built cells stay). */
    flowers(x0, z0, x1, z1, y, kinds, opts = {}) {
      [x0, x1] = order(x0, x1);
      [z0, z1] = order(z0, z1);
      const density = opts.density ?? 1;
      for (let z = z0; z <= z1; z++) {
        for (let x = x0; x <= x1; x++) {
          if (hash2(x, z, opts.seed || 3) > density) continue;
          const cur = rec.get(x, y, z);
          if (cur !== null && cur !== 'air') continue;
          rec.set(x, y, z, kinds[Math.floor(hash2(x, z, (opts.seed || 3) + 11) * kinds.length) % kinds.length]);
        }
      }
      return api;
    },

    /** A little blocky tree: trunk from y for h blocks, round canopy. */
    tree(x, y, z, opts = {}) {
      const h = opts.h ?? 4;
      const log = opts.log || 'log_oak';
      const leaves = opts.leaves || 'leaves_oak';
      const r = opts.r ?? 2;
      const top = y + h;
      for (let yy = top - 2; yy <= top + 1; yy++) {
        const rr = yy >= top + 1 ? r - 1 : yy === top - 2 ? r - 0.5 : r;
        for (let dz = -r; dz <= r; dz++) {
          for (let dx = -r; dx <= r; dx++) {
            const d = Math.hypot(dx, dz);
            if (d > rr + 0.3) continue;
            if (d > rr - 0.6 && hash2(x + dx * 3, z + dz * 5 + yy, 9) < 0.25) continue;
            rec.set(x + dx, yy, z + dz, leaves);
          }
        }
      }
      api.fill(x, y, z, x, top - 1, z, log);
      return api;
    },
  };
  return api;
}

/** The front direction (x, z) of a prefab-local rotation. */
export function frontVec(rot) {
  switch (rot & 3) {
    case 1: return [1, 0];
    case 2: return [0, -1];
    case 3: return [-1, 0];
    default: return [0, 1];
  }
}

/** Integer quarter-turn rotation of a grid offset (same as entities.js / rotation.y). */
export function rotXZ(x, z, rot) {
  switch (rot & 3) {
    case 1: return [z, -x];
    case 2: return [-x, -z];
    case 3: return [-z, x];
    default: return [x, z];
  }
}

/**
 * Stand-ins for canonical block keys that an older block library may not have yet. Once the
 * full library is installed these are never used (the real key is registered).
 */
export const BLOCK_STAND_INS = {
  log_birch: ['log_oak'],
  planks_lavender: ['wool_purple', 'planks_pink'],
  planks_mint: ['wool_lime', 'planks_white'],
  glass_heart: ['glass_pink', 'glass'],
  brick_red: ['wool_red', 'planks_pink'],
  brick_pink: ['wool_pink', 'planks_pink'],
  brick_white: ['planks_white', 'wool_white'],
  quartz: ['wool_white', 'planks_white'],
  marble: ['wool_white', 'planks_white'],
  frosting_pink: ['wool_pink'],
  frosting_white: ['wool_white'],
  cookie: ['planks_oak'],
  chocolate: ['log_oak', 'planks_oak'],
  candy_cane: ['wool_red', 'wool_white'],
  gumdrop_pink: ['wool_pink'],
  gumdrop_orange: ['wool_yellow', 'wool_red'],
  gumdrop_yellow: ['wool_yellow'],
  gumdrop_green: ['wool_lime'],
  gumdrop_blue: ['wool_sky'],
  gumdrop_purple: ['wool_purple'],
  cotton_candy: ['wool_pink'],
  lollipop_block: ['wool_pink'],
  moss: ['grass'],
  mushroom_glow: ['flower_tulip'],
  crystal_pink: ['glass_pink'],
  crystal_blue: ['glass'],
  lantern: ['lamp_block'],
  sea_lantern: ['lamp_block'],
  farmland: ['dirt'],
  flower_sunflower: ['flower_daisy'],
  flower_lavender: ['flower_tulip'],
  flower_poppy: ['flower_rose'],
  cloud: ['wool_white'],
  rainbow: ['wool_pink'],
  shell: ['sand'],
  coral: ['wool_pink'],
  palm_log: ['log_oak'],
  palm_leaves: ['leaves_oak'],
  pine_leaves: ['leaves_oak'],
  snow_leaves: ['leaves_oak'],
  wallpaper_hearts: ['wool_pink', 'planks_pink'],
  wallpaper_stars: ['wool_purple', 'planks_white'],
  wallpaper_stripes: ['wool_sky', 'planks_white'],
  wallpaper_flowers: ['wool_yellow', 'planks_white'],
  tile_kitchen: ['wool_white', 'planks_white'],
  tile_bath: ['wool_sky', 'planks_white'],
  roof_red: ['wool_red'],
  roof_blue: ['wool_sky'],
  roof_pink: ['wool_pink'],
  hay: ['wool_yellow'],
  wool_orange: ['wool_yellow'],
  wool_green: ['wool_lime'],
  wool_cyan: ['wool_sky'],
  wool_blue: ['wool_sky'],
  wool_magenta: ['wool_pink'],
  wool_lightgray: ['wool_white'],
  wool_gray: ['cobble', 'stone'],
  wool_black: ['cobble', 'stone'],
  wool_brown: ['planks_oak'],
  carpet_red: ['carpet_pink'],
  carpet_orange: ['carpet_pink'],
  carpet_yellow: ['carpet_white'],
  carpet_lime: ['carpet_white'],
  carpet_green: ['carpet_white'],
  carpet_cyan: ['carpet_white'],
  carpet_sky: ['carpet_white'],
  carpet_blue: ['carpet_white'],
  carpet_purple: ['carpet_pink'],
  carpet_magenta: ['carpet_pink'],
  carpet_lightgray: ['carpet_white'],
  carpet_gray: ['carpet_white'],
  carpet_black: ['carpet_white'],
  carpet_brown: ['carpet_white'],
};
