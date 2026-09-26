// Wave 2 Magic Builds: more treehouses. Friendship Treehouse (two trees, two cabins and a
// rope bridge) and Fairy Treehouse (a round hut in a glowing fairy tree with a spiral stair).
// Frame reminder: x left-to-right, y up (0 = ground layer), z back (0) to front (D-1).

import { hash2 } from './kit.js';
import { F, R, B, L, C, FLOWERS, BED_BUNK, BED_CLOUD, COMFY, STOOL, LANTERN, CEIL_LAMP, BENCH } from './palette.js';

const blossom = (seed) => (x, y, z) => (hash2(x * 3 + y, z, seed) < 0.7 ? 'leaves_cherry' : 'leaves_oak');

/** A tree cabin: walls, windows, door in the front wall, gable roof. Returns its interior. */
function cabin(a, X0, X1, Z0, Z1, P, wall, roof, doorX, doorColor) {
  a.walls(X0, Z0, X1, Z1, P + 1, P + 4, wall);
  a.corners(X0, Z0, X1, Z1, P + 1, P + 4, 'log_oak');
  a.floor(X0, Z0, X1, Z1, P + 5, 'planks_oak');
  a.air(X0 + 1, P + 1, Z0 + 1, X1 - 1, P + 4, Z1 - 1);
  const mid = Math.floor((X0 + X1) / 2);
  a.fill(X0 + 1, P + 2, Z1, X0 + 2, P + 3, Z1, 'glass').fill(X1 - 2, P + 2, Z1, X1 - 1, P + 3, Z1, 'glass');
  a.fill(X0, P + 2, Z0 + 2, X0, P + 3, Z1 - 2, 'glass').fill(X1, P + 2, Z0 + 2, X1, P + 3, Z1 - 2, 'glass');
  a.fill(mid, P + 2, Z0, mid + 1, P + 3, Z0, 'glass');
  a.door(doorX, P + 1, Z1, { key: 'door', color: doorColor });
  a.gable(X0 - 1, Z0 - 1, X1 + 1, Z1 + 1, P + 5, roof, { axis: 'x', gable: wall, gableAt: [X0, X1] });
  a.block(X0, P + 7, Math.floor((Z0 + Z1) / 2), 'glass_heart').block(X1, P + 7, Math.floor((Z0 + Z1) / 2), 'glass_heart');
}

// ---------------------------------------------------------------------------------------
// Friendship Treehouse: two blossom trees, a pink sleepover cabin with bunk beds and a mint
// playroom cabin with a party table, joined by a rope bridge. Stairs up one tree, rope
// ladders up the other through a hatch, a swing under the bridge.
// ---------------------------------------------------------------------------------------
export const friendshipTreehouse = {
  key: 'friendship_treehouse',
  name: 'Friendship Treehouse',
  blurb: 'Two tree cabins and a rope bridge',
  size: [27, 24, 18],
  iconZoom: 0.74,
  view: { bridge: [11, 9.8, 11, 22, 9, 10.5], inside: [8, 9.8, 9.3, 3, 8.8, 5], playroom: [18.5, 9.8, 9.3, 23, 8.6, 5] },
  build(a) {
    const P = 7;
    // two trees with blossom canopies
    for (const [tx, seed] of [[5, 22], [20, 23]]) {
      a.fill(tx, 1, 7, tx + 1, 19, 8, 'log_oak');
      for (const [x, z] of [[tx - 1, 7], [tx + 2, 8], [tx, 6], [tx + 1, 9]]) a.block(x, 1, z, 'log_oak');
      a.line(tx, 3, 7, tx - 3, 6, 4, 'log_oak').line(tx + 1, 3, 8, tx + 4, 6, 11, 'log_oak');
    }
    // platforms, posts, cabins
    a.fill(1, P, 3, 10, P, 13, 'planks_oak');
    a.fill(16, P, 3, 25, P, 13, 'planks_oak');
    for (const [x, z] of [[1, 3], [10, 3], [1, 13], [10, 13], [16, 3], [25, 3], [16, 13], [25, 13]]) a.fill(x, 1, z, x, P - 1, z, 'log_oak');
    cabin(a, 2, 9, 4, 10, P, 'planks_pink', 'roof_pink', 7, C.pink);
    cabin(a, 17, 24, 4, 10, P, 'planks_mint', 'roof_blue', 18, C.mint);
    a.fill(5, P + 1, 7, 6, 19, 8, 'log_oak').fill(20, P + 1, 7, 21, 19, 8, 'log_oak');
    for (const [cx, seed] of [[5.5, 22], [20.5, 23]]) {
      a.dome(cx, 17, 7.5, 6.5, 5.5, 6.5, blossom(seed), { thick: 2 });
      for (const [dx, dz] of [[-4, -3], [4, -3], [-4, 3], [4, 3]]) a.blob(cx + dx, 16, 7.5 + dz, 2.2, blossom(seed), { keep: true, ry: 1.8 });
    }
    // porches with railings and the rope bridge between them
    for (let x = 1; x <= 25; x++) {
      if (x >= 10 && x <= 16) continue;
      if (x !== 7 && x !== 8) a.furn('fence', x, P + 1, 13, F, C.white);
    }
    a.fill(11, P, 11, 15, P, 12, 'planks_oak');
    a.block(13, P, 11, 'planks_birch|planks_white').block(12, P, 12, 'planks_birch|planks_white');
    for (let x = 11; x <= 15; x++) a.furn('fence', x, P + 1, 10, F, C.wood).furn('fence', x, P + 1, 13, F, C.wood);
    for (const x of [10, 16]) for (const z of [10, 13]) a.fill(x, P + 1, z, x, P + 2, z, 'log_oak');
    a.air(10, P + 1, 11, 10, P + 2, 12).air(16, P + 1, 11, 16, P + 2, 12);
    for (const x of [11, 15]) a.block(x, P + 3, 10, 'lantern').block(x, P + 3, 13, 'lantern');
    a.fill(11, P + 3, 10, 15, P + 3, 10, 'lantern').fill(12, P + 3, 10, 14, P + 3, 10, 'air');
    // stairs to the left porch (along the front), rope ladders up the right tree
    for (let k = 1; k <= P - 1; k++) a.fill(k + 1, 1, 15, k + 1, k, 16, 'planks_oak');
    a.fill(8, 1, 15, 9, P - 1, 16, 'planks_oak');
    a.fill(8, P, 14, 9, P, 16, 'planks_oak');
    a.air(7, P + 1, 13, 8, P + 1, 13);
    for (const y of [1, 4, 7]) a.furn('tree_house_ladder', 20, y, 9, F, C.wood);
    a.air(20, P, 9, 20, P, 9);

    // pink sleepover cabin
    a.put(BED_BUNK, 3, P + 1, 5, R, C.pink);
    a.put(BED_BUNK, 3, P + 1, 8, R, C.lav);
    a.put('nightstand', 3, P + 1, 7, R, C.white);
    a.furn('table_lamp', 3, P + 2, 7, F, C.pink);
    a.put('toy_chest', 8, P + 1, 5, F, C.pink);
    a.put('rug_heart', 7, P + 1, 6, F, C.pink);
    a.furn('teddy_bear', 8, P + 1, 9, B);
    a.furn('fairy_lights', 7, P + 4, 7, F, C.pink);
    // mint playroom cabin
    a.put('table_round', 22, P + 1, 7, F, C.white);
    a.put('chair', 22, P + 1, 6, F, C.pink).put('chair', 23, P + 1, 7, L, C.sky).put('chair', 22, P + 1, 8, B, C.mint);
    a.furn('cake_stand', 22, P + 2, 7, F, C.pink);
    a.put('bookshelf', 23, P + 1, 5, F, C.white);
    a.put(COMFY, 18, P + 1, 5, R, C.pink).put(COMFY, 23, P + 1, 9, L, C.lav);
    a.put('easel', 19, P + 1, 5, F, C.wood);
    a.furn('fairy_lights', 21, P + 4, 6, F, C.sky);
    for (const x of [3, 4, 22, 23]) a.furn('flower_box', x, P + 1, 11, F, C.white);
    // down below: a swing under the bridge, picnic, flowers, mailbox
    a.put('swing', 12, 1, 11, F, C.pink);
    a.put('picnic_blanket', 18, 1, 16, F, C.pink);
    a.furn('mailbox', 14, 1, 16, F, C.pink);
    a.flowers(11, 0, 15, 17, 1, FLOWERS, { density: 0.3, seed: 101 });
    a.flowers(0, 0, 26, 2, 1, FLOWERS, { density: 0.3, seed: 102 });
    a.air(12, 1, 11, 13, 2, 11).air(14, 1, 16, 14, 1, 16).air(18, 1, 15, 19, 1, 16);
  },
};

// ---------------------------------------------------------------------------------------
// Fairy Treehouse: a mossy glade with glowing mushrooms, crystals and giant toadstools; a
// purple-leaved fairy tree holds a round lavender hut with a pointy pink roof and a star,
// reached by a spiral stair winding round the trunk. Inside: a cloud bed, books, fairy lights.
// ---------------------------------------------------------------------------------------
export const fairyTreehouse = {
  key: 'fairy_treehouse',
  name: 'Fairy Treehouse',
  blurb: 'A round hut in a glowing fairy tree',
  size: [19, 24, 19],
  view: { inside: [11.6, 9.6, 10.4, 6.5, 8.4, 5], glade: [15.5, 3.5, 17.5, 8, 2, 7] },
  build(a) {
    const cx = 8.5, cz = 8.5, P = 7;
    const LEAF = (x, y, z) => (hash2(x * 5 + y, z, 31) < 0.6 ? 'leaves_fairy|leaves_cherry' : 'leaves_cherry');
    // mossy glade
    for (let z = 0; z <= 18; z++) for (let x = 0; x <= 18; x++) if (Math.hypot(x - 9, z - 9) <= 9.3) a.block(x, 0, z, 'moss');
    // the fairy tree trunk, roots and the round platform
    a.fill(8, 1, 8, 9, 19, 9, 'log_fairy|log_birch');
    for (const [x, z] of [[7, 8], [10, 9], [8, 7], [9, 10]]) a.block(x, 1, z, 'log_fairy|log_birch');
    a.cyl(cx, cz, 5.4, P, P, 'planks_lavender');
    // spiral stair round the trunk (ring cells, one step higher each), hatch in the platform
    const ring = [[7, 10], [7, 9], [7, 8], [7, 7], [8, 7], [9, 7], [10, 7], [10, 8], [10, 9], [10, 10], [9, 10], [8, 10]];
    for (let k = 1; k < P; k++) {
      const [x, z] = ring[k - 1];
      a.block(x, k, z, 'planks_oak');
      if (k >= 4) a.block(x, P, z, 'air');
    }
    a.block(7, 1, 10, 'planks_oak');
    // round hut with windows, door and a pointy roof with a star
    a.cyl(cx, cz, 4.4, P + 1, P + 4, 'planks_lavender', { hollow: true });
    a.cyl(cx, cz, 4.4, P + 4, P + 4, 'wool_purple|planks_lavender', { hollow: true });
    for (const [x, z] of [[5, 8], [5, 9], [12, 8], [12, 9], [8, 5], [9, 5]]) a.fill(x, P + 2, z, x, P + 3, z, 'glass_pink');
    a.door(9, P + 1, 12, { key: 'door_pink|door', color: C.lav });
    a.cyl(cx, cz, 4.4, P + 5, P + 5, 'planks_lavender');
    a.cone(cx, cz, 5.4, P + 5, 'roof_pink', { step: 0.62, tip: 'crystal_pink|lantern' });
    a.fill(8, P + 5, 8, 9, 20, 9, 'log_fairy|log_birch');
    // branches with fairy leaves poking out round the roof
    a.line(9, 15, 9, 14, 18, 13, 'log_fairy|log_birch').line(8, 15, 8, 3, 18, 4, 'log_fairy|log_birch').line(9, 16, 8, 14, 19, 4, 'log_fairy|log_birch');
    for (const [x, y, z] of [[14, 18, 13], [3, 18, 4], [14, 19, 4], [8.5, 20, 8.5], [3, 16, 13]]) a.blob(x, y, z, 2.3, LEAF, { keep: true, ry: 1.8 });
    for (const [x, y, z] of [[14, 16, 13], [3, 16, 4], [14, 17, 4]]) a.block(x, y, z, 'lantern');
    // porch ring lanterns
    for (const [x, z] of [[4, 8], [13, 9], [8, 4], [7, 13]]) a.block(x, P + 1, z, 'lantern');

    // inside: cloud bed, books, beanbag, fairy lights
    a.put(BED_CLOUD, 6, P + 1, 10, R, C.lav);
    a.put('bookshelf', 10, P + 1, 6, F, C.white);
    a.furn('teddy_bear', 10, P + 2, 6, F);
    a.put(COMFY, 11, P + 1, 10, L, C.pink);
    a.put('toy_chest', 7, P + 1, 11, B, C.lav);
    a.furn('fairy_lights', 7, P + 4, 6, F, C.lav);
    a.furn('fairy_lights', 11, P + 4, 10, F, C.pink);

    // the glade: toadstools, glowing mushrooms, crystals, a pond, lamps
    for (const [x, z, h] of [[3, 14, 3], [15, 4, 4]]) {
      a.fill(x, 1, z, x, h - 1, z, 'mushroom_stem|wool_white');
      a.fill(x - 1, h, z - 1, x + 1, h, z + 1, 'mushroom_cap_red|wool_red');
      a.block(x, h + 1, z, 'mushroom_cap_red|wool_red');
      a.block(x - 1, h, z - 1, 'wool_white').block(x + 1, h, z + 1, 'wool_white').block(x, h + 1, z, 'wool_white');
    }
    for (const [x, z] of [[2, 10], [4, 3], [14, 12], [12, 16], [6, 15], [16, 8], [11, 2]]) a.block(x, 1, z, 'mushroom_glow');
    for (const [x, z, k] of [[2, 6, 'crystal_pink'], [16, 11, 'crystal_blue'], [12, 2, 'crystal_pink']]) {
      a.block(x, 1, z, k).block(x, 2, z, k).block(x + 1, 1, z, k).block(x, 1, z + 1, k);
    }
    for (let z = 13; z <= 16; z++) for (let x = 13; x <= 16; x++) if (Math.hypot(x - 14.5, z - 14.8) < 1.7) a.block(x, 0, z, 'water');
    a.furn(LANTERN, 12, 1, 13, F, C.lav).furn(LANTERN, 6, 1, 13, F, C.pink);
    a.flowers(0, 0, 18, 18, 1, ['flower_lavender', 'flower_tulip', 'flower_daisy', 'mushroom_glow'], { density: 0.16, seed: 111 });
    a.air(12, 1, 13, 12, 1, 13).air(6, 1, 13, 6, 1, 13).air(13, 1, 13, 16, 1, 16);
  },
};
