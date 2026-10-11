// Fairy Forest: mossy ground under purple willow-like fairy trees with little lanterns,
// giant glowing mushrooms, crystal clusters, fairy rings, a lily pond fed by a waterfall
// and glowing mushrooms everywhere (lovely at night).

import { Gen, TREES, mound, waterfallCliff } from './gen.js';
import { driftKind, fieldAt, ahead, placeAt, ring, path } from './common.js';

const FLORA = ['flower_bluebell', 'flower_lily', 'flower_forgetmenot', 'flower_lavender', 'mushroom_glow', 'fern'];

export const region = {
  key: 'fairy',
  height(g, x, z) {
    const n = g.noise.fbm2(x / 64 - 5, z / 64 + 5, 4);
    const bumps = Math.max(0, g.noise.fbm2(x / 30 + 5, z / 30 + 9, 2));
    return 24 + n * 3.5 + Math.pow(bumps, 1.3) * 9;
  },
  column(g, x, z, h) {
    if (h < g.sea) return [g.id('clay'), g.id('clay'), g.id('stone')];
    if (h <= g.sea + 1) return [g.id('gravel'), g.id('gravel'), g.id('stone')];
    return [g.id('grass_moss'), g.id('dirt'), g.id('mossy_stone')];
  },
  surfaces: ['grass_moss'],
  forest(g, x, z) {
    return Math.max(0, g.noise.fbm2(x / 34 + 300, z / 34 - 90, 2));
  },
  tree(g, x, y, z) {
    const r = g.rand();
    if (r < 0.62) TREES.fairy(g, x, y, z);
    else if (r < 0.84) TREES.mushroom(g, x, y, z, { glow: true });
    else if (r < 0.92) TREES.mushroom(g, x, y, z, { glow: false });
    else TREES.crystals(g, x, y, z);
  },
  flora(g, x, z, h, top) {
    if (top !== g.id('grass_moss')) return;
    const field = fieldAt(g, x, z, 23);
    const r = g.rand();
    if (r < (field > 0.2 ? 0.22 : 0.04)) {
      g.set(x, h + 1, z, g.id(driftKind(g, x, z, FLORA, 19)));
    } else if (r < 0.12) {
      g.set(x, h + 1, z, g.id(g.rand() < 0.3 ? 'fern' : 'grass_tall'));
    } else if (r < 0.13) {
      g.set(x, h + 1, z, g.id('mushroom_red'));
    }
  },
};

export function generate(world, rand, noise) {
  const g = new Gen(world, rand, noise, { sea: 20 });
  g.shape((x, z) => region.height(g, x, z));
  g.flattenSpawn(6, 15);
  g.islandEdge();
  const [px, pz] = ahead(g, (rand() - 0.5) * 0.8, 21 + rand() * 3);
  const pond = g.carvePond(px, pz, 6.5 + rand() * 1.5, { depth: 3, bed: 'clay', lilies: 0.14 });
  g.commit();
  g.fillColumns((x, z, h) => region.column(g, x, z, h));
  g.fillSea(g.id('water'));
  waterfallCliff(g, pond, { fromX: g.cx, fromZ: g.cz, rock: 'mossy_stone', grass: 'grass_moss', height: 7 });
  g.pourPonds();
  decorate(g, pond);
  world.outside = { block: 'water', surface: g.sea + 0.875 };
  return g.finish();
}

function decorate(g, pond) {
  const surf = [g.id('grass_moss')];
  placeAt(g, ...ahead(g, -0.72, 17), TREES.fairy, { force: true, surfaces: surf });
  placeAt(g, ...ahead(g, 0.78, 17), (gg, x, y, z) => TREES.mushroom(gg, x, y, z, { glow: true }), { force: true, surfaces: surf });
  placeAt(g, ...ahead(g, 1.35, 10), TREES.crystals, { force: true, surfaces: surf });
  g.scatter(Math.floor((g.sx * g.sz) / 22), {
    spacing: 3,
    avoidSpawn: 15,
    accept: (x, z) => g.dryLand(x, z, surf) && g.rand() < 0.08 + region.forest(g, x, z) * 1.0,
    place: (x, z) => region.tree(g, x, g.h(x, z) + 1, z),
  });
  // crystal clusters on the rocky bits
  g.scatter(g.big ? 40 : 22, {
    spacing: 4,
    accept: (x, z) => g.dryLand(x, z, surf) && g.h(x, z) > g.sea + 5 && g.noise.n2(x / 25 - 9, z / 25 + 4) > 0.25,
    place: (x, z) => TREES.crystals(g, x, g.h(x, z) + 1, z),
  });
  // fairy rings of glowing mushrooms in clearings
  g.scatter(g.big ? 5 : 3, {
    spacing: 5,
    accept: (x, z) => g.dryLand(x, z, surf) && g.distSpawn(x, z) > 16,
    place: (x, z) => {
      ring(g, x, z, 2.6, ['mushroom_glow'], { surfaces: surf });
      g.gem(x, g.h(x, z) + 1, z, 'ring');
    },
  });
  // mossy boulders
  g.scatter(Math.floor((g.sx * g.sz) / 500), {
    spacing: 2,
    accept: (x, z) => g.dryLand(x, z, surf),
    place: (x, z) => mound(g, x, g.h(x, z) + 1, z, [g.id('mossy_stone'), g.id('moss')], 2),
  });
  ring(g, g.cx, g.cz, 7.5, ['mushroom_glow', 'flower_bluebell', 'flower_lily'], { chance: 0.5, surfaces: surf });
  path(g, g.cx, g.cz - 3, pond.x, pond.z, 'gravel', { surfaces: surf, stopAt: pond.r });
  g.eachSurface((x, z, h, top) => {
    if (g.distSpawn(x, z) < 7) return;
    region.flora(g, x, z, h, top);
  });
  g.hilltopGems();
}

export const biome = {
  key: 'fairy',
  name: 'Fairy Forest',
  description: 'Purple trees, glowing mushrooms and crystals',
  iconBlock: 'mushroom_cap_glow',
  colors: ['#EEDDFF', '#B79CFF'],
  sky: { top: '#8C86F2', horizon: '#F3D6FF', fog: '#EBDDFF', sunset: '#FFB0DE', nightTop: '#1E1450', cloud: '#F4E8FF' },
  generate,
};
