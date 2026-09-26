// Snowy Wonderland: round snowy hills, snowy pine forests, a frozen pond for skating,
// snowmen, frosty bushes, blue-ice spikes and ice floes drifting on the sea.

import { Gen, TREES, mound } from './gen.js';
import { driftKind, fieldAt, ahead, placeAt, path } from './common.js';

const FLOWERS = ['flower_lily', 'flower_bluebell', 'flower_forgetmenot', 'flower_tulip_white'];

export const region = {
  key: 'snow',
  height(g, x, z) {
    const n = g.noise.fbm2(x / 80 + 12, z / 80 - 7, 4);
    const hills = Math.max(0, g.noise.fbm2(x / 45 + 33, z / 45 - 12, 3));
    return 24 + n * 4 + Math.pow(hills, 1.1) * 17;
  },
  column(g, x, z, h) {
    if (h < g.sea) return [g.id(g.noise.n2(x / 8, z / 8) > 0.3 ? 'clay' : 'gravel'), g.id('gravel'), g.id('stone')];
    if (h <= g.sea + 1) return [g.id('snow'), g.id('gravel'), g.id('stone')];
    // deep snow: little steps stay white, taller cliffs show earth and stone
    if (h <= g.sea + 4 && g.noise.n2(x / 14 - 3, z / 14 + 8) > 0.1) return [g.id('grass_snowy'), g.id('dirt'), g.id('stone')];
    return [g.id('snow'), g.id('dirt'), g.id('stone'), 4, g.id('snow'), 2];
  },
  surfaces: ['grass_snowy', 'snow'],
  forest(g, x, z) {
    return Math.max(0, g.noise.fbm2(x / 38 + 300, z / 38 + 55, 2));
  },
  tree(g, x, y, z) {
    if (g.rand() < 0.86) TREES.pine(g, x, y, z);
    else TREES.birch(g, x, y, z, { leaves: 'snow_leaves' });
  },
  flora(g, x, z, h, top) {
    if (top !== g.id('grass_snowy') && top !== g.id('snow')) return;
    const field = fieldAt(g, x, z, 17);
    const r = g.rand();
    if (r < (field > 0.3 ? 0.08 : 0.008)) g.set(x, h + 1, z, g.id(driftKind(g, x, z, FLOWERS, 11)));
    else if (r < 0.015) g.set(x, h + 1, z, g.id('fern'));
  },
};

export function generate(world, rand, noise) {
  const g = new Gen(world, rand, noise, { sea: 20 });
  g.shape((x, z) => region.height(g, x, z));
  g.flattenSpawn(6, 15);
  g.islandEdge();
  const [px, pz] = ahead(g, (rand() - 0.5) * 0.8, 20 + rand() * 3);
  const pond = g.carvePond(px, pz, 7 + rand() * 2, { depth: 2, bed: 'clay', ice: true });
  g.commit();
  g.fillColumns((x, z, h) => region.column(g, x, z, h));
  g.fillSea(g.id('water'));
  g.pourPonds();
  g.gem(Math.round(pond.x), pond.level + 1, Math.round(pond.z), 'ice');
  decorate(g, pond);
  world.outside = { block: 'water', surface: g.sea + 0.875 };
  return g.finish();
}

function decorate(g, pond) {
  const surf = region.surfaces.map((k) => g.id(k));
  // snowmen say hello right in front of the start
  placeAt(g, ...ahead(g, 0.32, 10), TREES.snowman, { force: true, surfaces: surf });
  placeAt(g, ...ahead(g, -0.62, 14), TREES.pine, { force: true, surfaces: surf });
  placeAt(g, ...ahead(g, 0.75, 15), TREES.pine, { force: true, surfaces: surf });
  g.scatter(Math.floor((g.sx * g.sz) / 24), {
    spacing: 2,
    accept: (x, z) => g.dryLand(x, z, surf) && g.rand() < 0.05 + region.forest(g, x, z) * 1.1,
    place: (x, z) => region.tree(g, x, g.h(x, z) + 1, z),
  });
  g.scatter(g.big ? 60 : 30, {
    spacing: 4,
    accept: (x, z) => g.dryLand(x, z, surf) && region.forest(g, x, z) < 0.15,
    place: (x, z) => {
      if (g.rand() < 0.3) TREES.snowman(g, x, g.h(x, z) + 1, z);
      else if (g.rand() < 0.5) mound(g, x, g.h(x, z) + 1, z, [g.id('snow_leaves')], 1);
      else iceSpike(g, x, g.h(x, z) + 1, z);
    },
  });
  // ice floes on the sea near the shore
  const water = g.id('water'), ice = g.id('ice'), packed = g.id('ice_packed');
  for (let z = 1; z < g.sz - 1; z++) {
    for (let x = 1; x < g.sx - 1; x++) {
      if (g.get(x, g.sea, z) !== water || g.get(x, g.sea + 1, z) !== 0) continue;
      const depth = g.sea - g.h(x, z);
      if (depth > 5) continue;
      if (g.noise.n2(x / 9 + 90, z / 9 - 90) > 0.5 + depth * 0.04) g.set(x, g.sea, z, g.noise.n2(x / 4, z / 4) > 0.45 ? packed : ice);
    }
  }
  path(g, g.cx, g.cz - 3, pond.x, pond.z, 'path', { surfaces: surf, stopAt: pond.r });
  g.eachSurface((x, z, h, top) => {
    if (g.distSpawn(x, z) < 7) return;
    region.flora(g, x, z, h, top);
  });
  g.hilltopGems();
}

function iceSpike(g, x, y, z) {
  const packed = g.id('ice_packed');
  const h = 2 + Math.floor(g.rand() * 4);
  for (let i = 0; i < h; i++) g.set(x, y + i, z, packed);
  if (h > 3) for (const [dx, dz] of [[1, 0], [0, 1]]) g.setAir(x + dx, y, z + dz, packed);
  g.gem(x, y + h, z, 'top');
}

export const biome = {
  key: 'snow',
  name: 'Snowy Wonderland',
  description: 'Snowy hills, pine trees, snowmen and an ice pond',
  iconBlock: 'snowman_head',
  colors: ['#EAF6FF', '#BFE3FF'],
  sky: { top: '#86C4FF', horizon: '#EAF5FF', fog: '#EEF6FF', sunset: '#FFC7DA', nightTop: '#1A2358', cloud: '#F4F8FF' },
  generate,
};
