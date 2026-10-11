// World generation: the biome registry (game.registry.biomes). Every biome lives in
// src/world/biomes/<key>.js; this file registers them in New World order and keeps the small
// helpers other modules import.
//
// Biome def:
//   { key, name, description, iconBlock, colors: [cssTop, cssBottom],
//     sky: { top, horizon, fog, sunset, nightTop, cloud }   (hex; daynight reads them)
//     generate(world, rand, noise), spawn(world) -> [x, y, z] }
// generate() writes world.blocks directly and sets world.waterLevel, world.outside
// ({ block, surface } horizon ring), world.gemSpots ([[x, y, z] x 20-30 interesting air
// cells]) and world.gemTotal. Light is computed after generation by the core.

import { WORLD_SIZES, World } from './world.js';
import { mulberry32 } from '../core/util.js';
import { Noise } from '../core/noise.js';
import * as meadow from './biomes/meadow.js';
import * as candy from './biomes/candy.js';
import * as beach from './biomes/beach.js';
import * as snow from './biomes/snow.js';
import * as fairy from './biomes/fairy.js';
import * as flat from './biomes/flat.js';
import * as mix from './biomes/mix.js';

// ---------- helpers for biome authors (kept for other modules) ----------

/** Block id for a key (0 when unknown, so a missing block never breaks generation). */
export function idOf(world, key) {
  const id = world.registry.idOf(key);
  return id < 0 ? 0 : id;
}

/** Raw set without lighting/events (generation only). */
export function put(world, x, y, z, id) {
  if (x < 0 || y < 0 || z < 0 || x >= world.sx || y >= world.sy || z >= world.sz) return;
  world.blocks[(y * world.sz + z) * world.sx + x] = id;
}

export function peek(world, x, y, z) {
  if (x < 0 || y < 0 || z < 0 || x >= world.sx || y >= world.sy || z >= world.sz) return 0;
  return world.blocks[(y * world.sz + z) * world.sx + x];
}

/** Fill a column: stone up to top-4, `under` for 3 blocks, `surface` at top. */
export function fillColumn(world, x, z, top, surfaceId, underId, stoneId) {
  const { sx, sz } = world;
  top = Math.min(top, world.sy - 1);
  for (let y = 0; y <= top; y++) {
    const id = y === top ? surfaceId : y >= top - 3 ? underId : stoneId;
    world.blocks[(y * sz + z) * sx + x] = id;
  }
}

/**
 * Grow a simple tree whose trunk starts at (x, y, z) (the first air voxel above ground).
 * opts: { log, leaves, height, radii: [r per canopy layer from bottom], rand }
 */
export function growTree(world, x, y, z, { log, leaves, height, radii, rand }) {
  const logId = idOf(world, log), leafId = idOf(world, leaves);
  for (let i = 0; i < height; i++) put(world, x, y + i, z, logId);
  const top = y + height;
  const base = top - radii.length + 1;
  radii.forEach((r, layer) => {
    const ly = base + layer;
    const R = Math.ceil(r);
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const d2 = dx * dx + dz * dz;
        if (d2 > r * r) continue;
        if (d2 > (r - 0.8) * (r - 0.8) && rand() < 0.35) continue;
        if (peek(world, x + dx, ly, z + dz) === 0) put(world, x + dx, ly, z + dz, leafId);
      }
    }
  });
}

/** A safe standing spot near the world center: [x, y, z] (feet). */
export function defaultSpawn(world) {
  const cx = Math.floor(world.sx / 2), cz = Math.floor(world.sz / 2);
  const reg = world.registry;
  const liquid = (id) => reg.byId(id)?.shape === 'liquid';
  for (let r = 0; r < 40; r++) {
    for (let a = 0; a < 8; a++) {
      const x = Math.round(cx + Math.cos((a / 8) * Math.PI * 2) * r);
      const z = Math.round(cz + Math.sin((a / 8) * Math.PI * 2) * r);
      const h = world.heightAt(x, z);
      if (h < 0) continue;
      if (liquid(world.get(x, h + 1, z))) continue;
      return [x + 0.5, h + 1, z + 0.5];
    }
  }
  return [cx + 0.5, world.heightAt(cx, cz) + 1, cz + 0.5];
}

/** The spawn a biome's generate() chose (world._spawn), if it is still a safe spot. */
export function biomeSpawn(world) {
  const s = world._spawn;
  if (s) {
    const x = Math.floor(s[0]), y = Math.floor(s[1]), z = Math.floor(s[2]);
    const solid = world.registry.props ? world.registry.props.solid : null;
    const below = world.get(x, y - 1, z);
    const free = (id) => id === 0 || (world.registry.props && world.registry.props.replaceable[id] && !(solid && solid[id]));
    if (below && (!solid || solid[below]) && free(world.get(x, y, z)) && free(world.get(x, y + 1, z))) return s;
  }
  return defaultSpawn(world);
}

// ---------- registry ----------

const ORDER = [meadow, candy, beach, snow, fairy, flat, mix];

export function install(game) {
  const biomes = game.registry.biomes;
  for (const m of ORDER) {
    biomes.set(m.biome.key, { ...m.biome, spawn: biomeSpawn });
  }

  /** Test helpers: generate a world off-screen and time it (used by tools/probe-blocks.mjs). */
  game.worldgen = {
    generate(biome = 'meadow', size = 'cozy', seed = 1) {
      const def = biomes.get(biome);
      const world = new World(WORLD_SIZES[size] || WORLD_SIZES.cozy, game.registry.blocks);
      world.meta = { id: 'bench', name: 'Bench', biome, seed, createdAt: 0 };
      def.generate(world, mulberry32(seed), new Noise(seed));
      return world;
    },
    benchmark(biome = 'meadow', size = 'big', seed = 1) {
      const t0 = performance.now();
      const world = this.generate(biome, size, seed);
      const t1 = performance.now();
      world.computeAllLight();
      const t2 = performance.now();
      let hash = 2166136261;
      const b = world.blocks;
      for (let i = 0; i < b.length; i += 7) hash = Math.imul(hash ^ b[i], 16777619);
      return {
        biome, size, seed,
        genMs: Math.round(t1 - t0), lightMs: Math.round(t2 - t1),
        gems: world.gemSpots ? world.gemSpots.length : 0,
        gemSpots: world.gemSpots || [],
        spawn: biomeSpawn(world),
        hash: hash >>> 0,
        waterLevel: world.waterLevel, outside: world.outside,
      };
    },
  };
}
