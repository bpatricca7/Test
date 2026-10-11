// Flower Meadow: rolling grass hills, drifts of flowers, oak, birch and cherry-blossom trees,
// a pond with a little waterfall, bushes and mossy boulders.

import { Gen, TREES, mound, waterfallCliff } from './gen.js';
import { driftKind, fieldAt, ahead, placeAt, ring, path } from './common.js';

const FLOWERS = ['flower_rose', 'flower_daisy', 'flower_tulip', 'flower_tulip_pink', 'flower_cosmos', 'flower_poppy', 'flower_forgetmenot', 'flower_tulip_white', 'flower_lavender', 'flower_tulip_red'];

/** Region pieces (also used by Everything Land). */
export const region = {
  key: 'meadow',
  height(g, x, z) {
    const n = g.noise.fbm2(x / 70, z / 70, 4);
    const hills = Math.max(0, g.noise.fbm2(x / 38 + 100, z / 38 - 50, 3));
    return 24 + n * 4 + Math.pow(hills, 1.25) * 13;
  },
  column(g, x, z, h) {
    if (h <= g.sea + 1) return [g.id('sand'), g.id('sand'), g.id('stone')];
    return [g.id('grass'), g.id('dirt'), g.id('stone')];
  },
  surfaces: ['grass'],
  forest(g, x, z) {
    return Math.max(0, g.noise.fbm2(x / 45 + 300, z / 45, 2));
  },
  tree(g, x, y, z) {
    const r = g.rand();
    if (r < 0.34) TREES.cherry(g, x, y, z);
    else if (r < 0.52) TREES.birch(g, x, y, z);
    else TREES.oak(g, x, y, z);
  },
  flora(g, x, z, h, top) {
    if (top !== g.id('grass')) return;
    const field = fieldAt(g, x, z);
    const r = g.rand();
    if (r < (field > 0.22 ? 0.26 : 0.022)) {
      g.set(x, h + 1, z, g.id(driftKind(g, x, z, FLOWERS)));
      if (field > 0.38 && g.rand() < 0.02) g.gem(x, h + 1, z + 1, 'flowers');
    } else if (r < 0.13) {
      g.set(x, h + 1, z, g.id(g.rand() < 0.12 ? 'fern' : 'grass_tall'));
    } else if (r < 0.1315) {
      g.set(x, h + 1, z, g.id('flower_sunflower'));
    }
  },
};

export function generate(world, rand, noise) {
  const g = new Gen(world, rand, noise, { sea: 20 });
  g.shape((x, z) => region.height(g, x, z));
  g.flattenSpawn(6, 15);
  g.islandEdge();
  // the pond sits ahead of the start so the first view has water and a waterfall
  const [px, pz] = ahead(g, (rand() - 0.5) * 0.9, 21 + rand() * 3);
  const pond = g.carvePond(px, pz, 6.5 + rand() * 1.5, { depth: 3, bed: 'sand', lilies: 0.05 });
  g.commit();
  g.fillColumns((x, z, h) => region.column(g, x, z, h));
  g.fillSea(g.id('water'));
  waterfallCliff(g, pond, { fromX: g.cx, fromZ: g.cz, rock: 'stone', grass: 'grass', height: 6 + Math.floor(rand() * 2) });
  g.pourPonds();
  decorate(g, pond);
  world.outside = { block: 'water', surface: g.sea + 0.875 };
  return g.finish();
}

function decorate(g, pond) {
  const grass = [g.id('grass')];
  // hero trees framing the first view
  placeAt(g, ...ahead(g, -0.62, 15), TREES.cherry, { force: true, surfaces: grass });
  placeAt(g, ...ahead(g, 0.7, 16), TREES.oak, { force: true, surfaces: grass });
  // forests and lone trees
  g.scatter(Math.floor((g.sx * g.sz) / 28), {
    spacing: 3,
    accept: (x, z) => g.dryLand(x, z, grass) && g.rand() < 0.06 + region.forest(g, x, z) * 0.9,
    place: (x, z) => region.tree(g, x, g.h(x, z) + 1, z),
  });
  // bushes and mossy boulders
  const leaf = g.id('leaves_oak');
  g.scatter(Math.floor((g.sx * g.sz) / 260), {
    spacing: 2,
    accept: (x, z) => g.dryLand(x, z, grass),
    place: (x, z) => {
      if (g.rand() < 0.6) mound(g, x, g.h(x, z) + 1, z, [leaf], 1);
      else mound(g, x, g.h(x, z) + 1, z, [g.id('mossy_stone'), g.id('stone'), g.id('cobble')], 2);
    },
  });
  // a little pumpkin & melon patch
  g.scatter(3, {
    spacing: 4,
    accept: (x, z) => g.dryLand(x, z, grass) && g.distSpawn(x, z) > 20,
    place: (x, z) => {
      for (let k = 0; k < 6; k++) {
        const xx = x + Math.floor(g.rand() * 5) - 2, zz = z + Math.floor(g.rand() * 5) - 2;
        if (g.dryLand(xx, zz, grass)) g.setAir(xx, g.h(xx, zz) + 1, zz, g.id(g.rand() < 0.65 ? 'pumpkin' : 'melon'));
      }
      g.gem(x, g.h(x, z) + 1, z, 'patch');
    },
  });
  // welcome circle of flowers around the start area, and a little path down to the pond
  ring(g, g.cx, g.cz, 7.5, ['flower_tulip_pink', 'flower_daisy', 'flower_tulip', 'flower_daisy'], { chance: 0.55, surfaces: grass });
  path(g, g.cx, g.cz - 3, pond.x, pond.z, 'path', { surfaces: grass, stopAt: pond.r });
  g.eachSurface((x, z, h, top) => {
    if (g.distSpawn(x, z) < 7) return;
    region.flora(g, x, z, h, top);
  });
  g.hilltopGems();
}

export const biome = {
  key: 'meadow',
  name: 'Flower Meadow',
  description: 'Hills, flowers, cherry trees and a waterfall pond',
  iconBlock: 'grass',
  colors: ['#C9F7CF', '#8EDB7E'],
  sky: { top: '#5FB8FF', horizon: '#CDEFFF', fog: '#D6F2FF', sunset: '#FFC4A6', nightTop: '#141A4A', cloud: '#FFFFFF' },
  generate,
};
