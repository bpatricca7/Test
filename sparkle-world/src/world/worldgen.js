// World generation: the biome registry (game.registry.biomes) plus the core 'meadow' and
// 'flat' biomes. Biome def:
//   { name, description, iconBlock, colors: [cssTop, cssBottom],
//     generate(world, rand, noise), spawn?(world) -> [x, y, z],
//     sky?: { top, horizon }  (day colors, hex; daynight.js uses them) }
// generate() writes world.blocks directly (use the helpers below) and should set
// world.waterLevel and world.outside = { block, surface } for the horizon plane.

import { smoothstep, lerp, clamp } from '../core/util.js';

// ---------- helpers for biome authors ----------

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
 * Grow a tree whose trunk starts at (x, y, z) (the first air voxel above ground).
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
        // ragged edge: drop some outermost leaves
        if (d2 > (r - 0.8) * (r - 0.8) && rand() < 0.35) continue;
        if (peek(world, x + dx, ly, z + dz) === 0) put(world, x + dx, ly, z + dz, leafId);
      }
    }
  });
}

/** A safe standing spot near the world center: [x, y, z] (feet). */
export function defaultSpawn(world) {
  const cx = Math.floor(world.sx / 2), cz = Math.floor(world.sz / 2);
  const water = world.registry.idOf('water');
  for (let r = 0; r < 40; r++) {
    for (let a = 0; a < 8; a++) {
      const x = Math.round(cx + Math.cos((a / 8) * Math.PI * 2) * r);
      const z = Math.round(cz + Math.sin((a / 8) * Math.PI * 2) * r);
      const h = world.heightAt(x, z);
      if (h < 0) continue;
      if (world.get(x, h + 1, z) === water) continue;
      return [x + 0.5, h + 1, z + 0.5];
    }
  }
  return [cx + 0.5, world.heightAt(cx, cz) + 1, cz + 0.5];
}

// ---------- meadow ----------

function generateMeadow(world, rand, noise) {
  const { sx, sz } = world;
  const sea = 20;
  world.waterLevel = sea;
  world.outside = { block: 'water', surface: sea + 0.875 };
  const G = idOf(world, 'grass'), D = idOf(world, 'dirt'), S = idOf(world, 'stone');
  const SAND = idOf(world, 'sand'), W = idOf(world, 'water');
  const cx = sx / 2, cz = sz / 2;

  // pond somewhere 18-26 blocks from the middle
  const pa = rand() * Math.PI * 2;
  const pd = 18 + rand() * 8;
  const px = cx + Math.cos(pa) * pd, pz = cz + Math.sin(pa) * pd;
  const pr = 7 + rand() * 3;

  const heights = new Int16Array(sx * sz);
  const spawnH = 24 + noise.fbm2(cx / 70, cz / 70, 4) * 3;
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const n = noise.fbm2(x / 70, z / 70, 4);
      const hills = Math.max(0, noise.fbm2(x / 38 + 100, z / 38 - 50, 3));
      let h = 24 + n * 4 + hills * 9;
      // flat, safe start area in the middle
      const ds = Math.hypot(x - cx, z - cz);
      h = lerp(spawnH, h, smoothstep(5, 14, ds));
      // pond bowl
      const dp = Math.hypot(x - px, z - pz) / pr;
      if (dp < 1.6) h = lerp(Math.min(h, sea - 3 + dp * dp * 3.5), h, smoothstep(1.0, 1.6, dp));
      // island edge slopes into the ocean
      const e = Math.min(x, z, sx - 1 - x, sz - 1 - z);
      h = lerp(sea - 5, h, smoothstep(2, 20, e + noise.n2(x / 20, z / 20) * 4));
      heights[z * sx + x] = Math.round(clamp(h, 4, world.sy - 12));
    }
  }

  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      const h = heights[z * sx + x];
      const beach = h <= sea + 1;
      fillColumn(world, x, z, h, beach ? SAND : G, beach ? SAND : D, S);
      for (let y = h + 1; y <= sea; y++) put(world, x, y, z, W);
    }
  }

  // trees, avoiding the start area, water and each other
  const taken = new Uint8Array(sx * sz);
  const tries = Math.floor((sx * sz) / 55);
  for (let i = 0; i < tries; i++) {
    const x = 3 + Math.floor(rand() * (sx - 6)), z = 3 + Math.floor(rand() * (sz - 6));
    const h = heights[z * sx + x];
    if (h <= sea + 1 || Math.hypot(x - cx, z - cz) < 9) continue;
    const forest = noise.fbm2(x / 45 + 300, z / 45, 2);
    if (rand() > 0.12 + Math.max(0, forest) * 0.8) continue;
    let clear = true;
    for (let dz = -3; dz <= 3 && clear; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        const k = (z + dz) * sx + (x + dx);
        if (taken[k]) { clear = false; break; }
      }
    }
    if (!clear) continue;
    taken[z * sx + x] = 1;
    const cherry = rand() < 0.35;
    const height = 4 + Math.floor(rand() * 2);
    growTree(world, x, h + 1, z, cherry
      ? { log: 'log_oak', leaves: 'leaves_cherry', height, radii: [2.9, 2.9, 2.2, 1.2], rand }
      : { log: 'log_oak', leaves: 'leaves_oak', height: height + 1, radii: [2.5, 2.5, 1.9, 1.1], rand });
  }

  // flowers and tall grass, in drifts
  const flowers = ['flower_rose', 'flower_daisy', 'flower_tulip'].map((k) => idOf(world, k));
  const tall = idOf(world, 'grass_tall');
  for (let z = 1; z < sz - 1; z++) {
    for (let x = 1; x < sx - 1; x++) {
      const h = heights[z * sx + x];
      if (peek(world, x, h, z) !== G || peek(world, x, h + 1, z) !== 0) continue;
      const field = noise.fbm2(x / 16 + 40, z / 16 + 40, 2);
      const r = rand();
      if (r < (field > 0.25 ? 0.22 : 0.025)) {
        const kind = Math.floor(((noise.n2(x / 9, z / 9) + 1) / 2) * flowers.length) % flowers.length;
        put(world, x, h + 1, z, rand() < 0.8 ? flowers[kind] : flowers[Math.floor(rand() * flowers.length)]);
      } else if (r < 0.12) {
        put(world, x, h + 1, z, tall);
      }
    }
  }
}

// ---------- flat ----------

function generateFlat(world, rand) {
  const { sx, sz } = world;
  const ground = 16;
  world.waterLevel = 0;
  world.outside = { block: 'grass', surface: ground + 1 };
  const G = idOf(world, 'grass'), D = idOf(world, 'dirt'), S = idOf(world, 'stone');
  const flowers = ['flower_rose', 'flower_daisy', 'flower_tulip'].map((k) => idOf(world, k));
  for (let z = 0; z < sz; z++) {
    for (let x = 0; x < sx; x++) {
      fillColumn(world, x, z, ground, G, D, S);
      if (rand() < 0.012) put(world, x, ground + 1, z, flowers[Math.floor(rand() * flowers.length)]);
    }
  }
}

export function install(game) {
  const biomes = game.registry.biomes;
  biomes.set('meadow', {
    key: 'meadow',
    name: 'Flower Meadow',
    description: 'Hills, flowers, cherry trees and a pond',
    iconBlock: 'grass',
    colors: ['#BDF5C6', '#8EDB7E'],
    sky: { top: '#5FB8FF', horizon: '#CDEFFF' },
    generate: generateMeadow,
    spawn: defaultSpawn,
  });
  biomes.set('flat', {
    key: 'flat',
    name: 'Builder Flat',
    description: 'Perfectly flat grass for building towns',
    iconBlock: 'planks_pink',
    colors: ['#FFE3F0', '#B6EC8C'],
    sky: { top: '#6CC6FF', horizon: '#DDF3FF' },
    generate: generateFlat,
    spawn: defaultSpawn,
  });
}
