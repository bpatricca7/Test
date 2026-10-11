// Builder Flat: perfectly flat grass for building towns, with a few little flower patches
// far from the middle so the building space stays open.

import { Gen } from './gen.js';
import { driftKind } from './common.js';

const FLOWERS = ['flower_rose', 'flower_daisy', 'flower_tulip', 'flower_tulip_pink', 'flower_cosmos', 'flower_forgetmenot'];
export const GROUND = 16;

export function generate(world, rand, noise) {
  const g = new Gen(world, rand, noise, { sea: 0 });
  g.shape(() => GROUND);
  g.commit(1);
  g.fillColumns(() => [g.id('grass'), g.id('dirt'), g.id('stone')]);
  // little flower patches, away from the building space in the middle
  const patches = g.big ? 26 : 16;
  for (let k = 0; k < patches; k++) {
    const x = 6 + Math.floor(rand() * (g.sx - 12)), z = 6 + Math.floor(rand() * (g.sz - 12));
    if (g.distSpawn(x, z) < 22) continue;
    const kind = driftKind(g, x, z, FLOWERS);
    const n = 4 + Math.floor(rand() * 7);
    for (let i = 0; i < n; i++) {
      const xx = x + Math.round((rand() - 0.5) * 5), zz = z + Math.round((rand() - 0.5) * 5);
      if (xx < 1 || zz < 1 || xx >= g.sx - 1 || zz >= g.sz - 1) continue;
      g.setAir(xx, GROUND + 1, zz, g.id(rand() < 0.85 ? kind : 'grass_tall'));
    }
    g.gem(x, GROUND + 1, z, 'flowers');
  }
  for (let k = 0; k < 60; k++) {
    const x = 4 + Math.floor(rand() * (g.sx - 8)), z = 4 + Math.floor(rand() * (g.sz - 8));
    if (g.distSpawn(x, z) > 16) g.gem(x, GROUND + 1, z, 'ground');
  }
  world.outside = { block: 'grass', surface: GROUND + 1 };
  const w = g.finish();
  w.waterLevel = 0;
  return w;
}

export const biome = {
  key: 'flat',
  name: 'Builder Flat',
  description: 'Perfectly flat grass for building towns',
  iconBlock: 'planks_pink',
  colors: ['#FFE3F0', '#B6EC8C'],
  sky: { top: '#6CC6FF', horizon: '#DDF3FF', fog: '#E2F5FF', sunset: '#FFC9AE', nightTop: '#161C4E', cloud: '#FFFFFF' },
  generate,
};
