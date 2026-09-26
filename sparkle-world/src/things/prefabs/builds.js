// Magic Builds that are not houses: Rainbow Bridge, Secret Flower Garden and Playground.
// Frame reminder: x left-to-right, y up (0 = ground layer), z back (0) to front (D-1).

import { F, R, B, L, C, FLOWERS, BENCH, LANTERN } from './palette.js';

const RAINBOW = ['wool_red', 'wool_orange', 'wool_yellow', 'wool_lime', 'wool_sky', 'wool_blue', 'wool_purple'];

// ---------------------------------------------------------------------------------------
// Rainbow Bridge: a seven-lane rainbow arching over whatever is below (a pond, a river, a
// flower bed), with fluffy cloud rails and lanterns at the top. It does not flatten the land
// or fill under the arch: only the bridge itself (plus head room over it) is built.
// ---------------------------------------------------------------------------------------
export const rainbowBridge = {
  key: 'rainbow_bridge',
  name: 'Rainbow Bridge',
  blurb: 'Walk over a rainbow with cloud rails',
  size: [9, 10, 25],
  options: { clear: 'none', level: false },
  iconDir: [1.6, 0.9, 0.9],
  view: { inside: [4, 8.6, 17, 4, 7, 4] },
  build(a) {
    const N = 24;
    for (let z = 0; z <= N; z++) {
      const h = Math.round(6 * Math.sin((Math.PI * z) / N));
      a.air(0, h + 1, z, 8, h + 3, z);
      for (let i = 0; i < 7; i++) a.block(1 + i, h, z, RAINBOW[i]);
      a.fill(0, h, z, 0, h + 1, z, 'cloud').fill(8, h, z, 8, h + 1, z, 'cloud');
    }
    // puffy clouds at both ends, lanterns on top of the arch
    for (const z of [0, 1, 23, 24]) a.block(0, 2, z, 'cloud').block(8, 2, z, 'cloud');
    a.block(0, 8, 12, 'lantern').block(8, 8, 12, 'lantern');
  },
};

// ---------------------------------------------------------------------------------------
// Secret Flower Garden: a hedge garden entered under a blossom arch with roses on top, a
// glowing fountain on a ring path, flower beds of every kind, benches facing the fountain,
// lanterns, little cherry trees, a wishing well, a bird house and a picnic blanket.
// ---------------------------------------------------------------------------------------
export const flowerGarden = {
  key: 'flower_garden',
  name: 'Flower Garden',
  blurb: 'Flowers, a fountain and benches',
  size: [19, 7, 19],
  view: { inside: [9, 3.2, 16.5, 9, 1.4, 8] },
  build(a) {
    // flower beds everywhere first, four kinds of beds
    a.flowers(1, 1, 8, 8, 1, ['flower_rose', 'flower_tulip'], { density: 0.8, seed: 81 });
    a.flowers(10, 1, 17, 8, 1, ['flower_sunflower', 'flower_daisy'], { density: 0.8, seed: 82 });
    a.flowers(1, 10, 8, 17, 1, ['flower_lavender', 'flower_poppy'], { density: 0.8, seed: 83 });
    a.flowers(10, 10, 17, 17, 1, FLOWERS, { density: 0.8, seed: 84 });
    a.flowers(1, 9, 17, 9, 1, FLOWERS, { density: 0.8, seed: 85 });
    a.flowers(9, 1, 9, 17, 1, FLOWERS, { density: 0.8, seed: 86 });
    // hedges round the garden, a blossom arch with roses over the entrance
    a.walls(0, 0, 18, 18, 1, 1, 'hedge|leaves_oak');
    a.air(8, 1, 18, 10, 1, 18);
    a.fill(7, 1, 18, 7, 3, 18, 'leaves_cherry').fill(11, 1, 18, 11, 3, 18, 'leaves_cherry').fill(7, 4, 18, 11, 4, 18, 'leaves_cherry');
    a.block(8, 5, 18, 'flower_rose').block(10, 5, 18, 'flower_rose').block(9, 5, 18, 'flower_tulip');
    // paths: from the entrance to a ring round the fountain
    a.fill(9, 0, 12, 9, 0, 18, 'path|cobble').air(9, 1, 12, 9, 1, 17);
    a.walls(6, 6, 12, 12, 0, 0, 'path|cobble');
    a.air(6, 1, 6, 12, 1, 12);
    // the fountain: quartz basin with glowing lights under the water, a pillar and a top bowl
    a.floor(7, 7, 11, 11, 0, 'quartz');
    a.walls(7, 7, 11, 11, 1, 1, 'quartz');
    a.fill(8, 1, 8, 10, 1, 10, 'water');
    for (const [x, z] of [[8, 8], [10, 8], [8, 10], [10, 10]]) a.block(x, 0, z, 'sea_lantern');
    a.fill(9, 0, 9, 9, 3, 9, 'quartz');
    a.block(8, 4, 9, 'quartz').block(10, 4, 9, 'quartz').block(9, 4, 8, 'quartz').block(9, 4, 10, 'quartz');
    a.block(9, 4, 9, 'water');
    // benches facing the fountain, lanterns on the ring corners
    a.put(BENCH, 8, 1, 5, F, C.white);
    a.put(BENCH, 5, 1, 10, R, C.white);
    a.put(BENCH, 13, 1, 8, L, C.white);
    for (const [x, z] of [[5, 5], [13, 5], [5, 13], [13, 13]]) a.furn(LANTERN, x, 1, z, F, C.pink);
    // little cherry trees, a wishing well, a bird house, a picnic
    for (const [x, z] of [[2, 2], [16, 2]]) a.tree(x, 1, z, { h: 3, r: 1.6, leaves: 'leaves_cherry' });
    for (const [x, z] of [[1, 17], [17, 17], [1, 9], [17, 9]]) a.block(x, 1, z, 'leaves_cherry');
    a.put('well', 13, 1, 2, F, C.pink);
    a.furn('bird_house', 4, 1, 2, F, C.sky);
    a.put('picnic_blanket', 13, 1, 13, F, C.pink);
    a.air(13, 1, 13, 14, 1, 14).air(13, 1, 2, 14, 2, 3).air(4, 1, 2, 4, 2, 2);
  },
};

// ---------------------------------------------------------------------------------------
// Playground: a toy-block fence, a play tower with a pink roof and a slide, two swings,
// a trampoline, a seesaw, a merry-go-round, a sandbox with a sandcastle, hopscotch,
// benches, lanterns and a bunch of balloons.
// ---------------------------------------------------------------------------------------
export const playground = {
  key: 'playground',
  name: 'Playground',
  blurb: 'Swings, a slide, a trampoline and more',
  size: [21, 9, 19],
  view: { inside: [10, 3.2, 17, 8, 1.5, 5] },
  build(a) {
    const TOY = ['wool_pink', 'wool_yellow', 'wool_sky', 'wool_lime', 'wool_purple'];
    for (let x = 0; x <= 20; x++) for (const z of [0, 18]) if (z === 0 || x < 9 || x > 11) a.block(x, 1, z, TOY[(x + z) % 5]);
    for (let z = 1; z < 18; z++) for (const x of [0, 20]) a.block(x, 1, z, TOY[(x + z) % 5]);
    // soft sand under the tower and the swings
    a.floor(1, 1, 9, 10, 0, 'sand');
    a.floor(12, 1, 19, 5, 0, 'sand');
    // play tower: platform, rails, posts, roof, a step up and a slide down
    const T0 = 4, T1 = 7, Z0 = 3, Z1 = 6;
    a.fill(T0, 2, Z0, T1, 2, Z1, 'planks_pink');
    a.walls(T0, Z0, T1, Z1, 3, 3, 'planks_white');
    a.air(T0, 3, 4, T0, 3, 4).air(5, 3, Z1, 6, 3, Z1);
    for (const [x, z] of [[T0, Z0], [T1, Z0], [T0, Z1], [T1, Z1]]) a.fill(x, 1, z, x, 5, z, 'log_oak');
    a.hip(3, 2, 8, 7, 6, 'roof_pink');
    a.fill(5, 1, 7, 6, 1, 7, 'planks_pink');
    a.put('slide', 3, 1, 4, L, C.pink);
    a.put('balloon_bunch', 8, 1, 8, F, C.pink);
    // swings, trampoline, seesaw
    a.put('swing', 13, 1, 3, F, C.pink);
    a.put('swing', 16, 1, 3, F, C.sky);
    a.put('trampoline', 13, 1, 8, F, C.lav);
    a.block(17, 1, 9, 'log_oak').fill(17, 2, 7, 17, 2, 11, 'planks_pink');
    a.block(17, 3, 7, 'wool_yellow').block(17, 3, 11, 'wool_sky');
    // merry-go-round
    const MX = 10, MZ = 4;
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      a.block(MX + dx, 1, MZ + dz, (dx + dz) % 2 ? 'wool_white' : 'wool_pink');
      a.block(MX + dx, 4, MZ + dz, (dx + dz) % 2 ? 'wool_sky' : 'wool_pink');
    }
    a.fill(MX, 1, MZ, MX, 3, MZ, 'quartz').block(MX, 5, MZ, 'wool_yellow');
    for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) a.block(MX + dx, 2, MZ + dz, 'quartz|wool_white').block(MX + dx, 3, MZ + dz, 'quartz|wool_white');
    a.put('picnic_blanket', 15, 1, 13, F, C.sun);
    // sandbox with a sandcastle
    a.walls(2, 12, 6, 16, 1, 1, 'planks_oak');
    a.floor(3, 13, 5, 15, 0, 'sand');
    for (const [x, z] of [[3, 13], [5, 13], [3, 15], [5, 15]]) a.block(x, 1, z, 'sand');
    a.fill(4, 1, 14, 4, 2, 14, 'sand').block(4, 3, 14, 'wool_pink');
    // hopscotch on the way in
    const HOP = [[10, 15], [10, 14], [9, 13], [11, 13], [10, 12], [9, 11], [11, 11], [10, 10]];
    const CARPETS = ['carpet_pink', 'carpet_yellow', 'carpet_sky', 'carpet_lime', 'carpet_purple'];
    HOP.forEach(([x, z], i) => a.block(x, 1, z, CARPETS[i % CARPETS.length]));
    // benches, lanterns
    a.put(BENCH, 4, 1, 17, B, C.sky).put(BENCH, 16, 1, 17, B, C.pink);
    a.furn(LANTERN, 8, 1, 17, F, C.sun).furn(LANTERN, 12, 1, 17, F, C.sun);
  },
};
