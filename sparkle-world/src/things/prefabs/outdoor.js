// Helpers for the wave 2 Magic Builds that use the outdoor team's pieces (tents, camp fires,
// string lights, hammocks, rope bridges, zip towers...) when they are registered, and simple
// look-alikes from blocks and core furniture when they are not, so every build still looks
// good on its own. `a` is the prefab api (see kit.js); x0/z0 are footprint corners.

import { F, R, B, L, C } from './palette.js';
import { SLIDES } from './extras.js';

export const DIRS = [[0, 1], [1, 0], [0, -1], [-1, 0]]; // rot -> (dx, dz)

/** A crackling camp fire in cell (x, y, z), or a stone ring with an ember and a candle flame. */
export function campfire(a, x, y, z, color = null) {
  if (a.has('campfire')) {
    a.at('campfire', x, y, z, F, color);
    return;
  }
  a.block(x - 1, y, z, 'cobble').block(x + 1, y, z, 'cobble').block(x, y, z - 1, 'cobble').block(x, y, z + 1, 'cobble');
  a.block(x, y - 1, z, 'lamp_block');
  a.furn('candle', x, y, z, F, C.peach);
}

/** A 2x2 camping tent with its door facing rot, or a little wool tent. */
export function tent(a, x0, y, z0, rot, color, wool = 'wool_pink') {
  if (a.has('tent')) {
    a.at('tent', x0, y, z0, rot, color);
    return;
  }
  a.fill(x0, y, z0, x0 + 1, y, z0 + 1, wool);
  a.fill(x0, y + 1, z0, x0 + 1, y + 1, z0 + 1, 'slab_white|slab_oak');
}

/** Folding camp chair (or a chair). */
export function campChair(a, x, y, z, rot, color) {
  return a.at('camp_chair|chair', x, y, z, rot, color);
}

/** Cooler (or a toy chest). */
export function cooler(a, x, y, z, rot, color) {
  return a.at('cooler|toy_chest', x, y, z, rot, color);
}

/** Camper bunk (1x2x2), a bunk bed or a single bed, covering x0.. / z0.. . */
export function bunk(a, x0, y, z0, rot, color) {
  return a.at('camper_bunk|bed_bunk|bed_single', x0, y, z0, rot, color);
}

/**
 * String lights: two posts 3 cells apart (along x for rot 0/2, along z for 1/3) with glowing
 * bulbs between. Without them: two lamp posts at the ends.
 */
export function stringLights(a, x0, y, z0, rot, color) {
  if (a.has('string_lights')) {
    a.at('string_lights', x0, y, z0, rot, color, { on: true });
    return;
  }
  const along = rot & 1 ? [0, 2] : [2, 0];
  a.at('lantern_post|floor_lamp', x0, y, z0, rot, color);
  a.at('lantern_post|floor_lamp', x0 + along[0], y, z0 + along[1], rot, color);
}

/** Hammock on its stand (3x2x1), or a bench. */
export function hammock(a, x0, y, z0, rot, color) {
  if (a.has('hammock')) return a.at('hammock', x0, y, z0, rot, color);
  return a.at('bench|chair', x0, y, z0, rot, color);
}

/** Picnic table (2x1x2, benches on both sides) or a long table and a bench. rot 0 or 2. */
export function picnicTable(a, x0, y, z0, rot, color) {
  if (a.has('picnic_table')) {
    a.at('picnic_table', x0, y, z0, rot, color);
    return;
  }
  a.at('table_long|table_round', x0, y, z0 + (rot === 2 ? 1 : 0), F, C.white);
  a.at('bench|chair', x0, y, z0 + (rot === 2 ? 0 : 1), rot === 2 ? F : B, color);
}

/**
 * Rope bridge of n cells from (x, y, z) running dir (0 +z, 1 +x, 2 -z, 3 -x) on floor layer
 * y (the layer of the decks it joins). id: unique within the build. Without rope bridges:
 * planks with a fence railing on both sides.
 */
export function ropeBridge(a, x, y, z, dir, n, color, id) {
  const [dx, dz] = DIRS[dir & 3];
  if (a.has('rope_bridge')) {
    for (let i = 0; i < n; i++) a.furn('rope_bridge', x + dx * i, y, z + dz * i, dir, color, { i, n, b: '@' + id });
    return true;
  }
  const [sx, sz] = [dz, dx]; // sideways
  for (let i = 0; i < n; i++) {
    const cx = x + dx * i, cz = z + dz * i;
    a.block(cx, y, cz, i % 2 ? 'planks_birch|planks_oak' : 'planks_oak');
    a.furn('fence', cx + sx, y + 1, cz + sz, F, C.wood).furn('fence', cx - sx, y + 1, cz - sz, F, C.wood);
    a.block(cx + sx, y, cz + sz, 'planks_oak').block(cx - sx, y, cz - sz, 'planks_oak');
  }
  return false;
}

/** Zip line tower (2x2, 7 tall) covering x0..x0+1 / z0..z0+1, ladder side facing rot. */
export function zipTower(a, x0, y, z0, rot, color) {
  if (!a.has('zipline_tower')) return false;
  a.at('zipline_tower', x0, y, z0, rot, color);
  return true;
}

/** A row of fences from (x0, z0) to (x1, z1) (straight line) on layer y, skipping `gaps`. */
export function rail(a, x0, z0, x1, z1, y, color = C.white, gaps = null) {
  const n = Math.max(Math.abs(x1 - x0), Math.abs(z1 - z0));
  const sx = Math.sign(x1 - x0), sz = Math.sign(z1 - z0);
  for (let i = 0; i <= n; i++) {
    const x = x0 + sx * i, z = z0 + sz * i;
    if (gaps && gaps.some(([gx, gz]) => gx === x && gz === z)) continue;
    a.furn('fence', x, y, z, F, color);
  }
}

/**
 * Big slide whose entry cell (x, zEntry) is next to a deck whose standing level is `top`,
 * running dir (0 +z, 1 +x, 2 -z, 3 -x). tall: the 7-high slide (else 5-high). The slide's
 * cells must be free: its base is top - height.
 */
export function bigSlide(a, x, top, z, dir, color, tall = false) {
  const [key, h] = SLIDES[tall ? 1 : 0];
  a.put(key, x, top - h, z, dir, color);
}

/** A beach / patio parasol: a pole and a striped 3x3 canopy. */
export function parasol(a, x, y, z, c1 = 'wool_pink', c2 = 'wool_white') {
  a.fill(x, y, z, x, y + 1, z, 'quartz_pillar|planks_white');
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) a.block(x + dx, y + 2, z + dz, (dx + dz) % 2 ? c2 : c1);
  a.block(x, y + 3, z, c1);
}

/** A round-ish window (plus shape, 3x3 without corners) in a wall facing along axis. */
export function roundWindow(a, x, y, z, axis, key = 'glass_lavender|glass_pink') {
  // axis 'x': the wall runs along x (window spans x and y); 'z': along z
  for (const [u, v] of [[0, -1], [-1, 0], [0, 0], [1, 0], [0, 1]]) {
    if (axis === 'x') a.block(x + u, y + v, z, key);
    else a.block(x, y + v, z + u, key);
  }
}

/** A leafy tree with a round, slightly ragged canopy (trunk from y for h blocks). */
export function bushyTree(a, x, y, z, h = 5, leaves = 'leaves_oak', log = 'log_oak', r = 2.3) {
  a.tree(x, y, z, { h, r: Math.round(r), leaves, log });
}

export { F, R, B, L, C };
