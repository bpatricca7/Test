// Small shared pieces for biome files: flower drifts, hero features near the spawn and the
// standard island pipeline.

import { Gen, TREES } from './gen.js';

/**
 * Pick a flower for a drift: nearby cells share a kind (low-frequency noise), so fields
 * come in patches of one color with the odd stray.
 */
export function driftKind(g, x, z, kinds, salt = 0) {
  const v = (g.noise.n2(x / 13 + 71 + salt, z / 13 - 29) + 1) / 2;
  const k = Math.min(kinds.length - 1, Math.floor(v * kinds.length));
  return g.rand() < 0.88 ? kinds[k] : kinds[Math.floor(g.rand() * kinds.length)];
}

/** 0..1 "flower field" strength at a column (patchy). */
export function fieldAt(g, x, z, salt = 0) {
  return g.noise.fbm2(x / 17 + 40 + salt, z / 17 + 40, 2);
}

/** A point `d` blocks from the spawn at angle `a` (0 = straight ahead, toward -Z). */
export function ahead(g, a, d) {
  return [Math.round(g.cx + Math.sin(a) * d), Math.round(g.cz - Math.cos(a) * d)];
}

/**
 * Place a tree/structure at (x, z) on dry land if the spot is free; claims the area.
 * Returns true when placed.
 */
export function placeAt(g, x, z, grow, { spacing = 2, surfaces = null, force = false } = {}) {
  if (!force && !g.free(x, z, spacing)) return false;
  if (!g.dryLand(x, z, surfaces)) return false;
  grow(g, x, g.h(x, z) + 1, z);
  g.claim(x, z, spacing);
  return true;
}

/** A ring of `key` sprites around a center (fairy rings, the welcome flower circle). */
export function ring(g, cx, cz, r, keys, { chance = 1, surfaces = null } = {}) {
  const n = Math.round(r * 6.3);
  for (let k = 0; k < n; k++) {
    if (g.rand() > chance) continue;
    const a = (k / n) * Math.PI * 2;
    const x = Math.round(cx + Math.cos(a) * r), z = Math.round(cz + Math.sin(a) * r);
    if (!g.dryLand(x, z, surfaces)) continue;
    g.setAir(x, g.h(x, z) + 1, z, g.id(keys[k % keys.length]));
  }
}

/**
 * A little winding path from (x0, z0) to (x1, z1): the ground's top block becomes `key`
 * where it is one of `surfaces`, and sprites on it are cleared. width 1 or 2.
 */
export function path(g, x0, z0, x1, z1, key, { surfaces = null, width = 2, stopAt = 0 } = {}) {
  const id = g.id(key);
  const len = Math.hypot(x1 - x0, z1 - z0);
  const dx = (x1 - x0) / len, dz = (z1 - z0) / len;
  const px = -dz, pz = dx;
  for (let t = 0; t < len - stopAt; t += 0.5) {
    const wig = g.noise.n2(t / 7 + 13, 5.5) * 2.2;
    const cx = x0 + dx * t + px * wig, cz = z0 + dz * t + pz * wig;
    for (let w = 0; w < width; w++) {
      const x = Math.round(cx + px * w * 0.8), z = Math.round(cz + pz * w * 0.8);
      const h = g.h(x, z);
      if (h <= g.sea) continue;
      const top = g.get(x, h, z);
      if (surfaces && !surfaces.includes(top)) continue;
      g.set(x, h, z, id);
      const above = g.get(x, h + 1, z);
      if (above && g.world.registry.byId(above)?.shape === 'cross') g.set(x, h + 1, z, 0);
    }
  }
}

export { Gen, TREES };
