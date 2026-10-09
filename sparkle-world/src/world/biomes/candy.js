// Candy Land: pink frosting hills stacked like cake layers over cookie ground, a chocolate
// pond, lollipop trees, giant candy canes, ice-cream and cotton-candy trees, gumdrop
// bushes, a strawberry-milk sea and cotton-candy puff clouds in the sky.

import { Gen, TREES, puffCloud } from './gen.js';
import { driftKind, fieldAt, ahead, placeAt, ring, path } from './common.js';
import { smoothstep, lerp } from '../../core/util.js';

const FLORA = ['flower_tulip_pink', 'flower_cosmos', 'lollipop', 'flower_tulip_white', 'flower_tulip', 'lollipop'];

export const region = {
  key: 'candy',
  height(g, x, z) {
    const n = g.noise.fbm2(x / 60 - 20, z / 60 + 13, 3);
    const bumps = Math.max(0, g.noise.fbm2(x / 34 + 70, z / 34 + 10, 3));
    let h = 23.5 + n * 3 + Math.pow(bumps, 1.2) * 15;
    // cake layers: flat tiers with little cookie cliffs between them
    const terr = smoothstep(-0.1, 0.25, g.noise.fbm2(x / 90 - 40, z / 90 + 20, 2));
    const q = Math.floor(h / 3) * 3 + 3 * smoothstep(0.75, 1, h / 3 - Math.floor(h / 3));
    return lerp(h, q, terr);
  },
  column(g, x, z, h) {
    if (h <= g.sea + 1) return [g.id('sand_pink'), g.id('sand_pink'), g.id('cookie')];
    if (h >= g.sea + 16) return [g.id('frosting_white'), g.id('cookie'), g.id('chocolate')];
    // a patchwork of frosting flavors
    const v = g.noise.fbm2(x / 46 + 11, z / 46 - 7, 2);
    const top = v > 0.28 ? 'grass_frosting_mint' : v < -0.3 ? 'grass_frosting_vanilla' : 'grass_frosting';
    return [g.id(top), g.id('cookie'), g.id('chocolate')];
  },
  surfaces: ['grass_frosting', 'grass_frosting_mint', 'grass_frosting_vanilla', 'frosting_white'],
  forest(g, x, z) {
    return Math.max(0, g.noise.fbm2(x / 40 + 300, z / 40 - 70, 2));
  },
  tree(g, x, y, z) {
    const r = g.rand();
    if (r < 0.3) TREES.lollipop(g, x, y, z);
    else if (r < 0.5) TREES.candyCane(g, x, y, z);
    else if (r < 0.68) TREES.cottonCandy(g, x, y, z);
    else if (r < 0.82) TREES.iceCream(g, x, y, z);
    else TREES.gumdropBush(g, x, y, z);
  },
  flora(g, x, z, h, top) {
    if (top !== g.id('grass_frosting') && top !== g.id('grass_frosting_mint') && top !== g.id('grass_frosting_vanilla')) return;
    const field = fieldAt(g, x, z, 9);
    const r = g.rand();
    if (r < (field > 0.25 ? 0.16 : 0.018)) {
      g.set(x, h + 1, z, g.id(driftKind(g, x, z, FLORA, 5)));
      if (field > 0.4 && g.rand() < 0.02) g.gem(x + 1, h + 1, z, 'flowers');
    } else if (r < 0.03) {
      g.set(x, h + 1, z, g.id('mushroom_red'));
    }
  },
};

export function generate(world, rand, noise) {
  const g = new Gen(world, rand, noise, { sea: 20 });
  g.shape((x, z) => region.height(g, x, z));
  g.flattenSpawn(6, 15, 1);
  g.islandEdge();
  const [px, pz] = ahead(g, (rand() - 0.5) * 1.0, 20 + rand() * 3);
  const pond = g.carvePond(px, pz, 6 + rand() * 1.5, { depth: 2, liquid: 'choco_milk', bed: 'chocolate' });
  g.commit();
  g.fillColumns((x, z, h) => region.column(g, x, z, h));
  g.fillSea(g.id('strawberry_milk'));
  g.pourPonds();
  decorate(g, pond);
  world.outside = { block: 'strawberry_milk', surface: g.sea + 0.875 };
  return g.finish();
}

function decorate(g, pond) {
  const surf = region.surfaces.map((k) => g.id(k));
  placeAt(g, ...ahead(g, -0.6, 14), TREES.lollipop, { force: true, surfaces: surf });
  placeAt(g, ...ahead(g, 0.68, 16), TREES.candyCane, { force: true, surfaces: surf });
  placeAt(g, ...ahead(g, -1.25, 10), TREES.gumdropBush, { force: true, surfaces: surf });
  placeAt(g, ...ahead(g, 1.3, 11), TREES.gumdropBush, { force: true, surfaces: surf });
  g.scatter(Math.floor((g.sx * g.sz) / 34), {
    spacing: 3,
    avoidSpawn: 15,
    accept: (x, z) => g.dryLand(x, z, surf) && g.rand() < 0.05 + region.forest(g, x, z) * 0.75,
    place: (x, z) => region.tree(g, x, g.h(x, z) + 1, z),
  });
  // extra gumdrop bushes sprinkled everywhere
  g.scatter(Math.floor((g.sx * g.sz) / 300), {
    spacing: 2,
    accept: (x, z) => g.dryLand(x, z, surf),
    place: (x, z) => TREES.gumdropBush(g, x, g.h(x, z) + 1, z),
  });
  // cotton-candy puff clouds hanging in the sky
  const clouds = g.big ? 14 : 8;
  const pink = g.id('cotton_candy');
  for (let k = 0; k < clouds; k++) {
    const x = 10 + Math.floor(g.rand() * (g.sx - 20)), z = 10 + Math.floor(g.rand() * (g.sz - 20));
    const y = Math.min(g.sy - 6, Math.max(g.h(x, z) + 10, 42 + Math.floor(g.rand() * 8)));
    puffCloud(g, x, y, z, pink);
  }
  ring(g, g.cx, g.cz, 7.5, ['lollipop', 'flower_tulip_pink', 'flower_cosmos'], { chance: 0.45, surfaces: surf });
  path(g, g.cx, g.cz - 3, pond.x, pond.z, 'waffle_cone', { surfaces: surf, stopAt: pond.r });
  g.eachSurface((x, z, h, top) => {
    if (g.distSpawn(x, z) < 7) return;
    region.flora(g, x, z, h, top);
  });
  g.hilltopGems();
}

export const biome = {
  key: 'candy',
  name: 'Candy Land',
  description: 'Frosting hills, lollipop trees and a chocolate pond',
  iconBlock: 'grass_frosting',
  colors: ['#FFE0F0', '#FFB3D2'],
  sky: { top: '#86C8FF', horizon: '#E4DDFF', fog: '#ECE4FF', sunset: '#FF9EC8', nightTop: '#2E2366', cloud: '#FFE6F4' },
  generate,
};
