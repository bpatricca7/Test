// Wave 2 Magic Builds: treehouses.
//   Big Friendship Treehouse  two big blossom trees, a pink sleepover cabin (bunk beds) and a
//                             mint cabin (big bed), joined by a wobbly rope bridge; stairs up,
//                             rope ladders, a big slide down, string lights and a swing below
//   Fairy Treehouse           a giant glowing mushroom-tree: round windows in its stem and cap,
//                             a cosy room inside the cap (cloud bed, vanity, crystal lamps),
//                             stairs up round the stem and a tiny balcony with crystal lights
//   Lookout Treehouse         a tall tree with a big lookout deck (telescope, a little cabin)
//                             and a zip line: one tower on the deck, one down in the meadow
// Frame reminder: x left-to-right, y up (0 = ground layer), z back (0) to front (D-1).

import { hash2 } from './kit.js';
import { F, R, B, L, C, FLOWERS, BED_BUNK, BED_BIG, BED_CLOUD, COMFY, LANTERN, BENCH } from './palette.js';
import { ropeBridge, zipTower, stringLights, rail, bigSlide, roundWindow, bushyTree } from './outdoor.js';

const blossom = (seed) => (x, y, z) => (hash2(x * 3 + y, z, seed) < 0.7 ? 'leaves_cherry' : 'leaves_oak');

/** A tree cabin: walls, windows, door in the front wall, gable roof. */
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
// Big Friendship Treehouse
// ---------------------------------------------------------------------------------------
export const friendshipTreehouse = {
  key: 'friendship_treehouse',
  name: 'Big Friendship Treehouse',
  blurb: 'Two tree cabins, a rope bridge and a big slide',
  size: [27, 25, 24],
  iconZoom: 0.72,
  view: {
    bridge: [9.6, 9.9, 11.2, 22, 8.6, 11],
    sleepover: [8, 9.8, 9.3, 3, 8.8, 5],
    bedroom: [23.6, 10, 9.4, 21, 8.4, 5],
    slide: [26, 8, 21, 21.5, 4, 15],
    front: [24, 12.5, 31, 13, 8, 9],
  },
  build(a) {
    const P = 7;
    // two trees with blossom canopies
    for (const tx of [5, 20]) {
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
    // porch railings (gaps: stairs at the left, the slide at the right)
    for (let x = 1; x <= 25; x++) {
      if ((x >= 10 && x <= 16) || x === 7 || x === 8 || x === 22) continue;
      a.furn('fence', x, P + 1, 13, F, C.white);
    }
    // the rope bridge between the porches, with posts and lanterns at both ends
    ropeBridge(a, 11, P, 11, R, 5, C.wood, 'friends');
    for (const x of [10, 16]) for (const z of [10, 12]) a.fill(x, P + 1, z, x, P + 2, z, 'log_oak').block(x, P + 3, z, 'lantern');
    // stairs to the left porch (along the front), rope ladders up the right tree
    for (let k = 1; k <= P - 1; k++) a.fill(k + 1, 1, 15, k + 1, k, 16, 'planks_oak');
    a.fill(8, 1, 15, 9, P - 1, 16, 'planks_oak');
    a.fill(8, P, 14, 9, P, 16, 'planks_oak');
    for (const y of [1, 4, 7]) a.furn('tree_house_ladder', 20, y, 9, F, C.wood);
    a.air(20, P, 9, 20, P, 9);
    // the big slide from the right porch down to the meadow
    bigSlide(a, 22, P + 1, 14, F, C.pink, true);

    // pink sleepover cabin: bunk beds, toys, a heart rug
    a.put(BED_BUNK, 3, P + 1, 5, R, C.pink);
    a.put(BED_BUNK, 3, P + 1, 8, R, C.lav);
    a.put('nightstand', 3, P + 1, 7, R, C.white);
    a.furn('table_lamp', 3, P + 2, 7, F, C.pink);
    a.put('toy_chest', 8, P + 1, 5, F, C.pink);
    a.at('rug_heart|rug_round', 7, P + 1, 6, F, C.pink);
    a.furn('teddy_bear', 8, P + 1, 9, B);
    a.furn('picture_frame', 6, P + 3, 5, F);
    a.furn('fairy_lights', 7, P + 4, 7, F, C.pink);
    // mint cabin: a big bed, nightstand, easel, comfy chair, rug
    a.at(BED_BIG, 22, P + 1, 5, F, C.mint);
    a.at('nightstand', 21, P + 1, 5, F, C.white);
    a.furn('table_lamp', 21, P + 2, 5, F, C.sun);
    a.at('easel', 18, P + 1, 5, F, C.wood);
    a.at(COMFY, 18, P + 1, 8, R, C.lav);
    a.at('rug_round|rug_heart', 22, P + 1, 7, F, C.sky);
    a.at('toy_chest', 23, P + 1, 9, B, C.mint);
    a.furn('picture_frame', 19, P + 3, 5, F);
    a.furn('lamp_ceiling', 22, P + 4, 7, F, C.sky);
    for (const x of [3, 4, 22, 23]) a.furn('flower_box', x, P + 1, 11, F, C.white);
    // down below: a swing under the bridge, string lights, a picnic, a mailbox, flowers
    a.put('swing', 12, 1, 11, F, C.pink);
    stringLights(a, 11, 1, 14, F, C.white);
    a.at('picnic_blanket', 16, 1, 16, F, C.pink);
    a.furn('mailbox', 14, 1, 18, F, C.pink);
    a.furn(LANTERN, 10, 1, 17, F, C.pink);
    a.flowers(0, 17, 26, 23, 1, FLOWERS, { density: 0.3, seed: 101 });
    a.flowers(0, 0, 26, 2, 1, FLOWERS, { density: 0.3, seed: 102 });
    a.air(12, 1, 11, 13, 2, 11).air(14, 1, 18, 14, 1, 18).air(16, 1, 16, 17, 1, 17).air(10, 1, 17, 10, 2, 17);
    a.air(22, 1, 14, 22, 8, 23);
  },
};

// ---------------------------------------------------------------------------------------
// Fairy Treehouse: a giant glowing mushroom-tree in a mossy glade.
// ---------------------------------------------------------------------------------------
export const fairyTreehouse = {
  key: 'fairy_treehouse',
  name: 'Fairy Treehouse',
  blurb: 'A giant glowing mushroom house with a balcony',
  size: [21, 18, 21],
  iconZoom: 0.78,
  view: {
    room: [10, 11.9, 15.6, 10, 10.6, 4],
    bed: [13.4, 11.8, 12.6, 8, 10.4, 4.6],
    balcony: [13.8, 12.6, 22.8, 10, 10.8, 18.2],
    stem: [10, 2.6, 12.2, 10, 3.2, 7.8],
    glade: [19, 5, 20, 10, 5, 9],
    front: [17.5, 8.5, 25.5, 10, 7, 10],
  },
  build(a) {
    const cx = 10, cz = 10;
    const glowCap = 'mushroom_cap_glow|mushroom_glow';
    // mossy glade and a path to the door
    for (let z = 0; z <= 20; z++) for (let x = 0; x <= 20; x++) if (Math.hypot(x - cx, z - cz) <= 10.4) a.block(x, 0, z, 'moss');
    a.flowers(0, 0, 20, 20, 1, ['flower_lavender', 'flower_tulip', 'flower_daisy', 'mushroom_glow', 'flower_bluebell|flower_tulip'], { density: 0.12, seed: 111 });
    for (let z = 14; z <= 20; z++) a.block(cx, 0, z, 'path|gravel').block(cx, 1, z, 'air');
    // the stem: hollow, round windows, a door, a lavender floor
    a.cyl(cx, cz, 3.8, 1, 8, 'mushroom_stem', { hollow: true, inner: 'air' });
    a.cyl(cx, cz, 2.8, 0, 0, 'planks_lavender');
    roundWindow(a, 7, 4, cz, 'z');
    roundWindow(a, 13, 4, cz, 'z');
    roundWindow(a, cx, 5, 7, 'x');
    a.door(cx, 1, 13, { key: 'door_pink|door', color: C.lav });
    // inside the stem (a round hall): a crystal lamp, a comfy chair, a plant
    a.block(cx, 1, 8, 'quartz_pillar|quartz').block(cx, 2, 8, 'crystal_pink|lantern');
    a.at(COMFY, 8, 1, cz, R, C.pink);
    a.at('plant_pot', 12, 1, cz, F, C.lav);
    a.at('rug_round|rug_heart', 9, 1, 10, F, C.lav);
    a.furn('lamp_ceiling', 10, 8, 10, F, C.lav);
    // wide stairs up the left side of the stem, under the cap, into the room through a hatch;
    // glowing lantern blocks along their outer edge
    for (let k = 1; k <= 8; k++) {
      const z = 15 - k;
      a.block(6, k, z, k % 2 ? 'planks_lavender' : 'planks_pink');
      a.block(5, k, z, k % 3 === 1 ? 'lantern' : k % 2 ? 'planks_lavender' : 'planks_pink');
      if (k >= 3 && k % 3 === 0) a.fill(5, 1, z, 5, k - 1, z, 'mushroom_stem');
    }
    // the cap: a lavender floor (the gills underneath) and a glowing dome with round windows
    a.cyl(cx, cz, 7.6, 9, 9, 'concrete_lavender|planks_lavender');
    a.dome(cx, 10, cz, 8.2, 6, 8.2, glowCap, { thick: 1.2 });
    // round windows: a plus of glass right through the cap wall at five places round it
    for (const deg of [55, 125, 180, 235, 305]) {
      const ang = (deg * Math.PI) / 180;
      const sx = Math.sin(ang), sz = Math.cos(ang);
      for (const [t, y] of [[0, 11], [0, 12], [0, 13], [-1, 12], [1, 12]]) {
        for (let r = 6; r <= 8.6; r += 0.35) {
          const x = Math.round(cx + sx * r + sz * t), z = Math.round(cz + sz * r - sx * t);
          const k = a.get(x, y, z);
          if (k && k !== 'air') a.block(x, y, z, 'glass_lavender|glass_pink');
        }
      }
    }
    a.air(5, 9, 7, 6, 9, 9);
    // the cap's rim curls down round the edge
    for (let z = 0; z <= 20; z++) for (let x = 0; x <= 20; x++) {
      const d = Math.hypot(x - cx, z - cz);
      if (d > 7.6 && d <= 8.6) a.block(x, 9, z, glowCap);
    }
    // hanging vines of fairy leaves round the rim, a lantern chandelier inside
    for (let i = 0; i < 12; i++) {
      const ang = (i / 12) * Math.PI * 2 + 0.2;
      const x = Math.round(cx + Math.sin(ang) * 7.4), z = Math.round(cz + Math.cos(ang) * 7.4);
      if (Math.abs(x - cx) <= 2 && z > cz) continue; // keep the balcony clear
      a.block(x, 8, z, 'leaves_fairy|leaves_cherry');
      if (i % 3 === 0) a.block(x, 7, z, 'lantern');
    }
    a.block(cx, 14, cz, 'lantern');
    // door out to a tiny balcony with fences and crystal lamps
    a.air(cx, 10, 17, cx, 11, 17);
    a.door(cx, 10, 18, { key: 'door_pink|door', color: C.pink });
    a.fill(cx - 2, 9, 18, cx + 2, 9, 20, 'concrete_lavender|planks_lavender');
    a.air(cx - 2, 10, 19, cx + 2, 12, 20);
    rail(a, cx - 1, 20, cx + 1, 20, 10, C.white);
    rail(a, cx - 2, 19, cx - 2, 19, 10, C.white);
    rail(a, cx + 2, 19, cx + 2, 19, 10, C.white);
    a.furn(LANTERN, cx - 2, 10, 20, F, C.pink).furn(LANTERN, cx + 2, 10, 20, F, C.lav);
    // a leafy fairy crown on top of the cap: it is a mushroom TREE
    for (const [x, y, z, r] of [[cx, 16.5, cz, 2.2], [cx - 3, 15.5, cz + 1, 1.6], [cx + 2.5, 15.5, cz - 2, 1.6]]) a.blob(x, y, z, r, 'leaves_fairy|leaves_cherry', { keep: true, ry: 1.3 });
    // the room in the cap (floor y = 9, stand at 10)
    const Y = 10;
    a.at(BED_CLOUD, 9, Y, 4, F, C.lav);
    a.at('nightstand', 11, Y, 4, F, C.white);
    a.furn('table_lamp', 11, Y + 1, 4, F, C.pink);
    a.at('vanity|dresser', 14, Y, 7, L, C.lav);
    a.at('wardrobe', 14, Y, 11, L, C.pink);
    a.at('bookshelf', 7, Y, 5, F, C.white);
    a.furn('teddy_bear', 7, Y + 1, 5, F);
    a.at('rug_round|rug_heart', 9, Y, 9, F, C.pink);
    a.at(COMFY, 12, Y, 14, B, C.sky).at(COMFY, 8, Y, 14, B, C.pink);
    a.at('toy_chest', 4, Y, 11, R, C.lav);
    for (const [x, z, k] of [[4, 8, 'crystal_pink'], [15, 9, 'crystal_blue'], [13, 5, 'crystal_purple'], [6, 13, 'crystal_blue']]) {
      a.block(x, Y, z, 'quartz_pillar|quartz').block(x, Y + 1, z, k + '|crystal_pink|lantern');
    }

    // the glade: toadstools, glowing mushrooms, crystals, a pond, lamps
    for (const [x, z, h] of [[2, 16, 3], [18, 3, 4], [17, 17, 2]]) {
      a.fill(x, 1, z, x, h - 1, z, 'mushroom_stem|wool_white');
      a.fill(x - 1, h, z - 1, x + 1, h, z + 1, 'mushroom_cap_red|wool_red');
      a.block(x, h + 1, z, 'mushroom_cap_red|wool_red');
    }
    for (const [x, z, k] of [[1, 8, 'crystal_pink'], [19, 12, 'crystal_blue'], [14, 1, 'crystal_purple|crystal_pink']]) {
      a.block(x, 1, z, k).block(x, 2, z, k).block(x + 1, 1, z, k).block(x, 1, z + 1, k);
    }
    for (let z = 15; z <= 18; z++) for (let x = 14; x <= 17; x++) if (Math.hypot(x - 15.5, z - 16.5) < 1.7) a.block(x, 0, z, 'water').block(x, 1, z, 'air');
    a.block(15, 1, 16, 'lily_pad|flower_tulip');
    a.furn(LANTERN, 8, 1, 17, F, C.lav).furn(LANTERN, 12, 1, 17, F, C.pink);
    a.air(8, 1, 17, 8, 2, 17).air(12, 1, 17, 12, 2, 17);
  },
};

// ---------------------------------------------------------------------------------------
// Lookout Treehouse: a tall tree on a little hill holds a big lookout deck (a telescope, a
// bench, a tiny cabin with a bed) reached by long stairs; a zip line runs from a tower on the
// deck down to a tower in the flower meadow ~23 blocks away.
// ---------------------------------------------------------------------------------------
export const lookoutTreehouse = {
  key: 'lookout_treehouse',
  name: 'Lookout Treehouse',
  blurb: 'A tall lookout with a telescope and a zip line',
  size: [39, 28, 17],
  iconZoom: 0.7,
  iconDir: [0.9, 0.75, 1.6],
  view: {
    deck: [9.8, 13.9, 10.8, 2, 12.6, 11.2],
    front: [25, 17, 31, 12, 10, 6],
    cabin: [4.3, 13.8, 4.4, 2, 12.4, 2.2],
    zipline: [24, 15, 14.5, 12, 15, 6],
    meadow: [29, 5.5, 14, 36, 3.5, 6],
  },
  build(a) {
    const P = 11; // deck floor layer (she stands at P + 1)
    const tx = 6, tz = 6; // trunk (2x2)
    const LEAF = (x, y, z) => (hash2(x * 5 + y, z, 51) < 0.25 ? 'leaves_birch|leaves_oak' : 'leaves_oak');
    // a little grassy hill round the tree
    for (let z = 0; z <= 13; z++) {
      for (let x = 0; x <= 13; x++) {
        const d = Math.hypot(x - (tx + 0.5), z - (tz + 0.5));
        if (d > 5.6) continue;
        const h = d < 3.2 ? 2 : 1;
        if (h > 1) a.fill(x, 1, z, x, h - 1, z, 'dirt');
        a.block(x, h, z, 'grass');
        if (hash2(x, z, 53) < 0.3) a.block(x, h + 1, z, FLOWERS[Math.floor(hash2(z, x, 54) * FLOWERS.length) % FLOWERS.length]);
      }
    }
    // the tall trunk, roots and struts under the deck
    a.fill(tx, 1, tz, tx + 1, 22, tz + 1, 'log_oak');
    for (const [x, z] of [[1, 1], [12, 1], [1, 12], [12, 12], [6, 1], [1, 6]]) a.fill(x, 1, z, x, P - 1, z, 'log_oak');
    for (const [x0, z0, x1, z1] of [[tx, tz, 3, 3], [tx + 1, tz, 10, 3], [tx, tz + 1, 3, 10], [tx + 1, tz + 1, 10, 10]]) a.line(x0, P - 3, z0, x1, P - 1, z1, 'log_oak');
    // the deck
    a.fill(1, P, 1, 12, P, 12, 'planks_oak');
    a.fill(tx, P, tz, tx + 1, P, tz + 1, 'log_oak');
    // a tiny cabin in the back corner with a pointy roof
    a.walls(1, 1, 5, 5, P + 1, P + 4, 'planks_white');
    a.corners(1, 1, 5, 5, P + 1, P + 4, 'log_oak');
    a.air(2, P + 1, 2, 4, P + 4, 4);
    a.fill(2, P + 2, 1, 3, P + 3, 1, 'glass').fill(1, P + 2, 3, 1, P + 3, 3, 'glass').fill(5, P + 2, 2, 5, P + 3, 2, 'glass');
    a.floor(1, 1, 5, 5, P + 5, 'planks_oak');
    a.hip(0, 0, 6, 6, P + 5, 'roof_red|roof_pink', { cap: 'roof_red|roof_pink' });
    a.block(3, P + 9, 3, 'lantern');
    a.door(3, P + 1, 5, { key: 'door', color: C.sky });
    a.at('bed_single|bed_double', 2, P + 1, 2, F, C.sky);
    a.at('nightstand', 4, P + 1, 2, F, C.white);
    a.furn('table_lamp', 4, P + 2, 2, F, C.sun);
    a.furn('picture_frame', 3, P + 3, 2, F);
    // railings round the deck (gaps for the landing at the front right and the tower)
    rail(a, 6, 1, 11, 1, P + 1, C.white);
    rail(a, 1, 6, 1, 11, P + 1, C.white);
    rail(a, 2, 12, 11, 12, P + 1, C.white);
    rail(a, 12, 2, 12, 3, P + 1, C.white);
    rail(a, 12, 8, 12, 10, P + 1, C.white);
    // lookout things: telescope, bench, flower boxes, lanterns
    a.at('lookout_telescope', 2, P + 1, 11, F, C.sky);
    a.at('lookout_telescope', 9, P + 1, 2, B, C.pink);
    a.at(BENCH, 4, P + 1, 11, F, C.pink);
    a.at('beanbag|armchair', 9, P + 1, 9, F, C.lav);
    a.block(12, P + 1, 1, 'lantern').block(1, P + 1, 12, 'lantern');
    a.furn('lamp_ceiling', 3, P + 4, 3, F, C.pink);
    // the zip line: a tower on the deck and one in the meadow (they link up by themselves)
    const zip = zipTower(a, 10, P + 1, 5, L, C.pink);
    if (zip) zipTower(a, 35, 1, 5, R, C.sky);
    else a.at(BENCH, 10, P + 1, 5, R, C.sky);
    // long stairs up from the meadow along the front, a landing, posts
    for (let k = 1; k <= 10; k++) {
      const x = 24 - k;
      a.fill(x, k, 14, x, k, 15, 'planks_oak');
      if (k % 2 === 0) a.fill(x, 1, 15, x, k - 1, 15, 'log_oak');
    }
    a.fill(13, P, 11, 13, P, 15, 'planks_oak');
    a.fill(13, 1, 15, 13, P - 1, 15, 'log_oak');
    a.block(13, P + 1, 15, 'lantern');
    // the canopy high above the deck
    a.dome(tx + 0.5, 21, tz + 0.5, 6.4, 5, 6.4, LEAF, { thick: 2 });
    for (const [x, y, z] of [[2, 21, 2], [11, 22, 2], [2, 21, 11], [3, 20, 7], [tx + 0.5, 25, tz + 0.5]]) a.blob(x, y, z, 2, LEAF, { keep: true, ry: 1.7 });
    a.line(tx, 17, tz, 1, 20, 1, 'log_oak').line(tx + 1, 17, tz + 1, 11, 20, 11, 'log_oak');
    // the meadow at the far end: picnic, hay bales, lamp, flowers, a path back to the stairs
    a.flowers(14, 0, 38, 12, 1, FLOWERS, { density: 0.28, seed: 121 });
    a.flowers(24, 13, 38, 16, 1, FLOWERS, { density: 0.28, seed: 122 });
    for (let x = 25; x <= 34; x++) a.block(x, 0, 11, 'path|gravel').block(x, 1, 11, 'air');
    a.at('picnic_blanket', 30, 1, 1, F, C.pink);
    a.block(31, 1, 9, 'hay').block(32, 1, 9, 'hay').block(31, 2, 9, 'hay');
    a.furn(LANTERN, 34, 1, 10, F, C.sun);
    a.air(30, 1, 1, 31, 1, 2).air(34, 1, 10, 34, 2, 10).air(34, 1, 4, 38, 8, 8);
  },
};
