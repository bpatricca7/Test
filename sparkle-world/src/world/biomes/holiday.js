// Wave 5 stub (docs/teams/wave5-plan.md): the holiday-world team replaces this file.
// For now a flat snowy/sandy pad so the build and the New World card work.

import { Gen } from './gen.js';

export function generate(world, rand, noise) {
  const g = new Gen(world, rand, noise, { sea: 0 });
  g.shape(() => 16);
  g.commit(1);
  g.fillColumns(() => [g.id('snow'), g.id('dirt'), g.id('stone')]);
  world.outside = { block: 'snow', surface: 17 };
  const w = g.finish();
  w.waterLevel = 0;
  return w;
}

export const biome = {
  key: 'holiday',
  name: 'Holiday Village',
  description: 'Twinkly lights, a giant tree, elves and reindeer',
  iconBlock: 'snow',
  colors: ['#FFF1F4', '#D93D5A'],
  sky: { top: '#6CC6FF', horizon: '#DDF3FF', fog: '#E2F5FF', sunset: '#FFC9AE', nightTop: '#161C4E', cloud: '#FFFFFF' },
  generate,
};
