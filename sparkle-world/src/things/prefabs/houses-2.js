// Magic Houses, part 2: Treehouse, Candy House, Beach Hut and Igloo.
// Frame reminder: x left-to-right, y up (0 = ground layer), z back (0) to front (D-1).

import { hash2 } from './kit.js';
import { F, R, B, L, C, FLOWERS, BED_BIG, BED_HEART, BED_CLOUD, BED_BUNK, SOFA, ARMCHAIR, COMFY, STOOL, TABLE_LONG, FLOOR_LAMP, CEIL_LAMP, BENCH } from './palette.js';

const GUMDROPS = ['gumdrop_pink', 'gumdrop_yellow', 'gumdrop_blue', 'gumdrop_green', 'gumdrop_purple', 'gumdrop_orange'];

/** Palm tree: a gently bent trunk (leaning +x, or -x with lean -1) and drooping fronds. */
export function palm(a, x, y, z, h = 6, reach = 3, lean = 1) {
  const bend = Math.floor(h / 2);
  a.fill(x, y, z, x, y + bend - 1, z, 'palm_log');
  const cx = x + lean, top = y + h;
  a.fill(cx, y + bend, z, cx, top - 1, z, 'palm_log');
  a.block(cx, top, z, 'palm_leaves');
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    for (let i = 1; i < reach; i++) a.block(cx + dx * i, top, z + dz * i, 'palm_leaves');
    a.block(cx + dx * reach, top - 1, z + dz * reach, 'palm_leaves');
  }
  for (const [dx, dz] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) a.block(cx + dx, top, z + dz, 'palm_leaves').block(cx + dx * 2, top - 1, z + dz * 2, 'palm_leaves');
  a.block(cx + 1, top - 1, z, 'wool_brown|planks_oak').block(cx, top - 1, z + 1, 'wool_brown|planks_oak');
}

/** Snowy pine: short trunk, stacked shrinking layers of needles, snow on top. */
export function pine(a, x, y, z, h = 6) {
  a.fill(x, y, z, x, y + 1, z, 'log_oak');
  let r = 1.45;
  for (let k = 0; k < h - 2; k++, r -= 0.35) a.cyl(x, z, Math.max(0.2, r), y + 2 + k, y + 2 + k, k % 2 ? 'snow_leaves|pine_leaves' : 'pine_leaves');
  a.block(x, y + h, z, 'snow');
}

// ---------------------------------------------------------------------------------------
// Treehouse: a pink cabin built around the trunk of a giant cherry-blossom tree, a porch
// with a railing and hanging lanterns, stairs winding up the side, rope ladders up the trunk
// through a hatch, a swing below. Inside: bunk bed, desk, reading nook, fairy lights.
// ---------------------------------------------------------------------------------------
export const treehouse = {
  key: 'treehouse',
  name: 'Treehouse',
  blurb: 'A cabin in a cherry-blossom tree',
  size: [19, 25, 19],
  view: { inside: [11.5, 9.8, 9, 5, 8.8, 4.5], porch: [5, 9.3, 12.6, 16, 3, 16] },
  build(a) {
    const P = 7; // platform height
    const LEAF = (x, y, z) => (hash2(x * 3 + y, z, 21) < 0.72 ? 'leaves_cherry' : 'leaves_oak');
    // the giant tree: 2x2 trunk with roots, branch struts holding the platform
    a.fill(8, 1, 7, 9, 19, 8, 'log_oak');
    for (const [x, z] of [[7, 7], [7, 8], [10, 7], [10, 8], [9, 6], [8, 9], [9, 9]]) a.block(x, 1, z, 'log_oak');
    a.line(8, 3, 7, 4, 6, 3, 'log_oak').line(9, 3, 7, 13, 6, 3, 'log_oak');
    a.line(8, 3, 8, 4, 6, 12, 'log_oak').line(9, 3, 8, 13, 6, 12, 'log_oak');
    // platform
    a.fill(3, P, 2, 14, P, 13, 'planks_oak');
    // the cabin
    const X0 = 4, X1 = 13, Z0 = 3, Z1 = 10;
    a.walls(X0, Z0, X1, Z1, P + 1, P + 4, 'planks_pink');
    a.corners(X0, Z0, X1, Z1, P + 1, P + 4, 'log_oak');
    a.floor(X0, Z0, X1, Z1, P + 5, 'planks_oak');
    a.air(X0 + 1, P + 1, Z0 + 1, X1 - 1, P + 4, Z1 - 1);
    a.fill(5, P + 2, Z1, 6, P + 3, Z1, 'glass').fill(11, P + 2, Z1, 12, P + 3, Z1, 'glass');
    a.fill(X0, P + 2, 5, X0, P + 3, 6, 'glass').fill(X1, P + 2, 5, X1, P + 3, 6, 'glass');
    a.fill(11, P + 2, Z0, 12, P + 3, Z0, 'glass');
    a.door(10, P + 1, Z1, { key: 'door', color: C.mint });
    a.gable(3, 2, 14, 11, P + 5, 'roof_blue', { axis: 'x', gable: 'planks_pink', gableAt: [X0, X1] });
    a.block(X0, P + 7, 6, 'glass_heart').block(X1, P + 7, 6, 'glass_heart');
    a.fill(8, P + 1, 7, 9, 19, 8, 'log_oak'); // the trunk goes up through the roof
    // blossom canopy: a big dome, branches, and leafy clumps hugging the roof corners
    a.line(9, 16, 8, 13, 19, 11, 'log_oak').line(8, 16, 7, 4, 19, 4, 'log_oak').line(9, 16, 7, 13, 19, 4, 'log_oak').line(8, 16, 8, 4, 19, 11, 'log_oak');
    a.dome(8.5, 18, 7.5, 7.5, 5.5, 7, LEAF, { thick: 2 });
    for (const [x, z] of [[3, 3], [14, 3], [3, 11], [14, 11], [8.5, 1.5]]) a.blob(x, 17, z, 2.4, LEAF, { keep: true, ry: 2 });
    a.block(11, P + 5, 5, 'lantern').block(6, P + 5, 8, 'lantern');
    // hanging lanterns under the eaves, a flowery rail round the back
    a.block(X0, P + 4, 11, 'lantern').block(X1, P + 4, 11, 'lantern');
    for (let x = 3; x <= 14; x++) a.block(x, P + 1, 2, 'leaves_cherry');
    for (let z = 3; z <= 10; z++) a.block(3, P + 1, z, 'leaves_cherry').block(14, P + 1, z, 'leaves_cherry');
    // porch railing (fences) with the stair landing at the front-right
    for (let x = 3; x <= 14; x++) a.furn('fence', x, P + 1, 13, F, C.white);
    a.furn('fence', 3, P + 1, 11, F, C.white).furn('fence', 3, P + 1, 12, F, C.white).furn('fence', 14, P + 1, 12, F, C.white);
    // stairs up the right side (with posts)
    for (let k = 1; k < P; k++) {
      const z = 5 + k;
      a.fill(15, k, z, 16, k, z, 'planks_oak');
      if (k % 2 === 0) a.fill(16, 1, z, 16, k - 1, z, 'log_oak');
    }
    a.air(14, P + 1, 11, 14, P + 1, 11);
    // rope ladders up the back of the trunk, through a hatch in the floor
    for (const y of [1, 4, 7]) a.furn('tree_house_ladder', 8, y, 6, B, C.wood);
    a.air(8, P, 6, 8, P, 6);

    // inside: bunk bed, desk, reading nook, fairy lights
    a.put(BED_BUNK, 5, P + 1, 4, F, C.pink);
    a.put('desk', 6, P + 1, 4, F, C.white);
    a.put('chair', 6, P + 1, 5, B, C.sky);
    a.furn('table_lamp', 7, P + 2, 4, F, C.sun);
    a.furn('picture_frame', 6, P + 3, 4, F);
    a.put('bookshelf', 10, P + 1, 4, F, C.white);
    a.furn('teddy_bear', 10, P + 2, 4, F);
    a.put('toy_chest', 11, P + 1, 4, F, C.mint);
    a.put('rug_round', 10, P + 1, 6, F, C.lav);
    a.put(COMFY, 12, P + 1, 6, L, C.pink);
    a.put(COMFY, 12, P + 1, 8, L, C.sky);
    a.put('table_round', 6, P + 1, 8, F, C.white);
    a.put(STOOL, 5, P + 1, 8, R, C.pink);
    a.furn('fruit_bowl', 6, P + 2, 8, F);
    a.furn('fairy_lights', 6, P + 4, 6, F, C.pink);
    a.furn('fairy_lights', 11, P + 4, 8, F, C.pink);
    // porch: bench and flower boxes
    a.put(BENCH, 5, P + 1, 11, F, C.sky);
    a.furn('flower_box', 11, P + 1, 11, F, C.white).furn('flower_box', 12, P + 1, 11, F, C.white);
    // down below: a swing, flowers, a picnic and a mailbox
    a.put('swing', 11, 1, 12, F, C.pink);
    a.put('picnic_blanket', 3, 1, 15, F, C.pink);
    a.furn('mailbox', 17, 1, 5, F, C.pink);
    a.flowers(0, 14, 18, 18, 1, FLOWERS, { density: 0.35, seed: 31 });
    a.flowers(0, 0, 2, 13, 1, FLOWERS, { density: 0.4, seed: 32 });
    a.air(3, 1, 15, 4, 1, 16);
  },
};

// ---------------------------------------------------------------------------------------
// Candy House: gingerbread walls with white icing, a frosting roof with drips and gumdrops,
// candy-cane pillars, a cotton-candy chimney, a gumdrop fence and lollipop trees. Inside:
// a heart bed, a candy kitchen, a party table with cake, a sofa and a heart rug.
// ---------------------------------------------------------------------------------------
export const candyHouse = {
  key: 'candy_house',
  name: 'Candy House',
  blurb: 'Gingerbread walls, frosting roof and gumdrops',
  size: [19, 15, 19],
  view: { inside: [9, 2.7, 12, 9, 1.4, 5], party: [12, 2.8, 11.5, 6, 1.2, 8] },
  build(a) {
    // candy garden: frosting ground, a gumdrop fence, chocolate path
    a.floor(0, 0, 18, 18, 0, 'frosting_pink');
    for (let x = 0; x <= 18; x++) for (const z of [0, 18]) if (z === 0 || x < 8 || x > 10) a.block(x, 1, z, GUMDROPS[(x + z) % GUMDROPS.length]);
    for (let z = 1; z < 18; z++) for (const x of [0, 18]) a.block(x, 1, z, GUMDROPS[(x + z) % GUMDROPS.length]);
    a.fill(9, 0, 14, 9, 0, 18, 'chocolate');
    a.block(8, 0, 16, 'frosting_white').block(10, 0, 16, 'frosting_white');

    const X0 = 4, X1 = 14, Z0 = 4, Z1 = 13;
    a.checker(X0 + 1, Z0 + 1, X1 - 1, Z1 - 1, 0, 'frosting_pink', 'frosting_white');
    a.walls(X0, Z0, X1, Z1, 0, 0, 'chocolate');
    a.walls(X0, Z0, X1, Z1, 1, 4, 'cookie');
    a.walls(X0, Z0, X1, Z1, 5, 5, 'frosting_white');
    a.floor(X0 + 1, Z0 + 1, X1 - 1, Z1 - 1, 5, 'cookie');
    a.air(X0 + 1, 1, Z0 + 1, X1 - 1, 4, Z1 - 1);
    a.corners(X0, Z0, X1, Z1, 1, 5, 'candy_cane');
    // frosted windows
    const win = (x0, x1, z0, z1) => {
      a.fill(x0 - (x0 === x1 ? 0 : 1), 1, z0 - (z0 === z1 ? 0 : 1), x1 + (x0 === x1 ? 0 : 1), 4, z1 + (z0 === z1 ? 0 : 1), 'frosting_white');
      a.fill(x0, 2, z0, x1, 3, z1, 'glass_pink');
    };
    win(6, 7, Z1, Z1);
    win(11, 12, Z1, Z1);
    win(X0, X0, 8, 9);
    win(X1, X1, 8, 9);
    win(9, 10, Z0, Z0);
    a.corners(X0, Z0, X1, Z1, 1, 5, 'candy_cane');
    a.fill(8, 1, Z1, 10, 3, Z1, 'frosting_white');
    a.door(9, 1, Z1, { key: 'door_pink|door', color: C.pink });
    // frosting roof: white eaves with drips, pink slopes, white ridge with gumdrops
    a.gable(3, 3, 15, 14, 5, 'frosting_pink', { axis: 'x', eave: 'frosting_white', ridge: 'frosting_white', gable: 'cookie', gableAt: [X0, X1] });
    for (let x = 3; x <= 15; x += 2) a.block(x, 4, 3, 'frosting_white').block(x, 4, 14, 'frosting_white');
    for (let x = 4; x <= 14; x += 2) a.block(x, 11, 8, GUMDROPS[x % GUMDROPS.length]);
    // hearts on both gable ends
    for (const x of [X0, X1]) {
      a.block(x, 8, 7, 'frosting_pink').block(x, 8, 10, 'frosting_pink');
      a.fill(x, 7, 7, x, 7, 10, 'frosting_pink').fill(x, 6, 8, x, 6, 9, 'frosting_pink');
    }
    // chocolate chimney puffing cotton candy
    a.fill(12, 6, 6, 12, 11, 6, 'chocolate');
    a.block(12, 12, 6, 'cotton_candy').block(12, 13, 7, 'cotton_candy').block(11, 13, 6, 'cotton_candy');
    // porch: candy cane pillars and an icing roof with gumdrops
    a.fill(7, 1, 15, 7, 4, 15, 'candy_cane').fill(11, 1, 15, 11, 4, 15, 'candy_cane');
    a.fill(6, 5, 14, 12, 5, 15, 'frosting_white');
    a.block(7, 6, 15, 'gumdrop_pink').block(9, 6, 15, 'gumdrop_yellow').block(11, 6, 15, 'gumdrop_blue');
    // lollipop trees, candy canes, gumdrop bushes, cotton-candy puffs
    for (const [x, z] of [[2, 15], [16, 15]]) {
      a.fill(x, 1, z, x, 3, z, 'wool_white|quartz');
      a.fill(x - 1, 5, z, x + 1, 5, z, 'lollipop_block').fill(x, 4, z, x, 6, z, 'lollipop_block');
      a.block(x - 1, 4, z, 'frosting_white').block(x + 1, 6, z, 'frosting_white');
    }
    for (const [x, z, d] of [[2, 2, 1], [16, 2, -1]]) {
      a.fill(x, 1, z, x, 4, z, 'candy_cane').block(x + d, 4, z, 'candy_cane').block(x + d * 2, 4, z, 'candy_cane').block(x + d * 2, 3, z, 'candy_cane');
    }
    for (const [x, z] of [[2, 9], [16, 8], [5, 16], [13, 16], [6, 2], [12, 2]]) a.block(x, 1, z, GUMDROPS[(x * 3 + z) % GUMDROPS.length]);
    a.fill(9, 1, 1, 9, 2, 1, 'candy_cane').fill(8, 3, 1, 10, 3, 1, 'cotton_candy').block(9, 4, 1, 'cotton_candy');

    // inside: heart bed, candy kitchen, party table, sofa, heart rug
    a.put(BED_HEART, 10, 1, 5, F, C.pink);
    a.put('nightstand', 12, 1, 5, F, C.white);
    a.furn('table_lamp', 12, 2, 5, F, C.pink);
    a.put('oven', 5, 1, 5, F, C.pink);
    a.put('stove', 6, 1, 5, F, C.white);
    a.put('counter', 7, 1, 5, F, C.pink);
    a.furn('cake_stand', 7, 2, 5, F, C.pink);
    a.put('fridge', 8, 1, 5, F, C.mint);
    a.put(TABLE_LONG, 6, 1, 9, F, C.pink);
    a.put('chair', 6, 1, 8, F, C.mint).put('chair', 7, 1, 8, F, C.sky);
    a.put('chair', 6, 1, 10, B, C.sun).put('chair', 7, 1, 10, B, C.lav);
    a.furn('cake_stand', 6, 2, 9, F, C.lav);
    a.furn('candle', 7, 2, 9, F, C.pink);
    a.put(SOFA, 12, 1, 12, B, C.pink);
    a.put('rug_heart', 11, 1, 9, F, C.pink);
    a.put('toy_chest', 13, 1, 8, L, C.sun);
    a.put('balloon_bunch', 5, 1, 12, F, C.pink);
    a.furn('plant_pot', 13, 1, 11, F, C.mint);
    a.furn('clock', 9, 3, 5, F, C.pink);
    a.furn(CEIL_LAMP, 9, 4, 8, F, C.pink);
    a.block(7, 5, 7, 'lamp_block').block(11, 5, 10, 'lamp_block');
  },
};

// ---------------------------------------------------------------------------------------
// Beach Hut: a striped hut on palm-log stilts with a thatched roof, a deck with a railing,
// wooden steps down to the sand, a hammock, surfboards, a beach umbrella and towel, a
// sandcastle, tiki torches and palm trees. Inside: a comfy bed, a kitchenette and a table.
// ---------------------------------------------------------------------------------------
export const beachHut = {
  key: 'beach_hut',
  name: 'Beach Hut',
  blurb: 'A striped hut on stilts with a hammock and surfboards',
  size: [17, 13, 19],
  view: { inside: [8, 6.7, 8.2, 6, 5.2, 4], deck: [4.5, 6.2, 11.5, 12, 3, 17] },
  build(a) {
    const P = 4; // deck height
    for (let z = 0; z <= 18; z++) for (let x = 0; x <= 16; x++) if (Math.hypot((x - 8) / 9.2, (z - 9) / 10.2) <= 1) a.block(x, 0, z, 'sand');
    // stilts and deck
    for (const x of [3, 8, 13]) for (const z of [2, 8, 13]) a.fill(x, 1, z, x, P - 1, z, 'palm_log');
    a.fill(3, P, 2, 13, P, 13, 'planks_oak');
    // striped walls
    const X0 = 4, X1 = 12, Z0 = 3, Z1 = 9;
    for (let y = P + 1; y <= P + 4; y++) {
      for (let x = X0; x <= X1; x++) for (const z of [Z0, Z1]) a.block(x, y, z, x % 2 ? 'wool_sky' : 'planks_white');
      for (let z = Z0; z <= Z1; z++) for (const x of [X0, X1]) a.block(x, y, z, z % 2 ? 'wool_sky' : 'planks_white');
    }
    a.corners(X0, Z0, X1, Z1, P + 1, P + 4, 'palm_log');
    a.air(X0 + 1, P + 1, Z0 + 1, X1 - 1, P + 4, Z1 - 1);
    a.fill(5, P + 2, Z1, 6, P + 3, Z1, 'glass').fill(10, P + 2, Z1, 11, P + 3, Z1, 'glass');
    a.fill(7, P + 2, Z0, 8, P + 3, Z0, 'glass');
    a.fill(X0, P + 2, 5, X0, P + 3, 6, 'glass').fill(X1, P + 2, 5, X1, P + 3, 7, 'glass');
    a.door(8, P + 1, Z1, { key: 'door', color: C.sky });
    // thatched roof with a palm-leaf fringe
    a.floor(X0, Z0, X1, Z1, P + 5, 'planks_oak');
    a.hip(3, 2, 13, 10, P + 5, 'hay');
    a.walls(3, 2, 13, 10, P + 5, P + 5, 'palm_leaves');
    // deck railing and steps down to the sand
    for (let x = 3; x <= 13; x++) if (x < 7 || x > 9) a.furn('fence', x, P + 1, 13, F, C.white);
    for (let z = 10; z <= 12; z++) a.furn('fence', 3, P + 1, z, F, C.white).furn('fence', 13, P + 1, z, F, C.white);
    a.fill(7, 1, 14, 9, 3, 14, 'planks_oak').fill(7, 1, 15, 9, 2, 15, 'planks_oak').fill(7, 1, 16, 9, 1, 16, 'planks_oak');

    // inside: bed, kitchenette, table, beanbag
    a.put(BED_BIG, 5, P + 1, 4, F, C.sky);
    a.put('nightstand', 7, P + 1, 4, F, C.white);
    a.furn('table_lamp', 7, P + 2, 4, F, C.mint);
    a.furn('picture_frame', 5, P + 3, 4, F);
    a.put('fridge', 9, P + 1, 4, F, C.sky);
    a.put('counter', 10, P + 1, 4, F, C.white);
    a.furn('fruit_bowl', 10, P + 2, 4, F);
    a.put('sink_kitchen', 11, P + 1, 4, F, C.white);
    a.put('table_round', 10, P + 1, 7, F, C.white);
    a.put(STOOL, 9, P + 1, 7, R, C.pink).put(STOOL, 11, P + 1, 7, L, C.mint);
    a.furn('cake_stand', 10, P + 2, 7, F, C.sun);
    a.put(COMFY, 5, P + 1, 8, R, C.pink);
    a.furn('plant_pot', 6, P + 1, 8, F, C.mint);
    a.furn(CEIL_LAMP, 8, P + 4, 6, F, C.sun);
    // deck: sun chairs and an outdoor shower
    a.put('chair', 5, P + 1, 12, F, C.pink).put('chair', 11, P + 1, 12, F, C.sky);
    a.put('shower', 12, P + 1, 10, L, C.sky);
    a.furn('plant_pot', 4, P + 1, 10, F, C.pink);

    // beach: hammock, surfboards, umbrella and towel, sandcastle, tiki torches, palms
    a.fill(15, 1, 4, 15, 3, 4, 'palm_log').fill(15, 1, 9, 15, 3, 9, 'palm_log');
    a.fill(15, 2, 5, 15, 2, 8, 'carpet_cyan|carpet_pink');
    a.fill(1, 1, 11, 1, 3, 11, 'wool_pink').block(1, 2, 11, 'wool_white');
    a.fill(1, 1, 13, 1, 3, 13, 'wool_sky').block(1, 2, 13, 'wool_yellow');
    a.fill(11, 1, 16, 11, 2, 16, 'planks_white');
    for (let x = 10; x <= 12; x++) for (let z = 15; z <= 17; z++) a.block(x, 3, z, (x + z) % 2 ? 'wool_white' : 'wool_pink');
    a.block(11, 4, 16, 'wool_pink');
    for (let z = 15; z <= 17; z++) a.block(12, 1, z, z % 2 ? 'carpet_pink' : 'carpet_white').block(13, 1, z, z % 2 ? 'carpet_pink' : 'carpet_white');
    a.fill(3, 1, 15, 5, 1, 17, 'sand');
    for (const [x, z] of [[3, 15], [5, 15], [3, 17], [5, 17]]) a.block(x, 2, z, 'sand');
    a.fill(4, 2, 16, 4, 3, 16, 'sand').block(4, 4, 16, 'wool_pink');
    for (const x of [6, 10]) a.fill(x, 1, 18, x, 2, 18, 'palm_log').block(x, 3, 18, 'lantern');
    a.furn('pool_float', 1, 1, 16, F, C.pink);
    palm(a, 2, 1, 16, 7, 2, 1);
    palm(a, 15, 1, 12, 7, 2, -1);
  },
};

// ---------------------------------------------------------------------------------------
// Igloo: a snow dome with ice windows, a glowing skylight and lanterns, an entrance tunnel,
// a wooden floor and a crackling fireplace. Outside: a snowman, snowy pines, a frozen pond
// and lantern posts along an icy path. Inside: a cloud bed, armchair, books and cocoa.
// ---------------------------------------------------------------------------------------
export const igloo = {
  key: 'igloo',
  name: 'Snow Igloo',
  blurb: 'A cosy snow dome with a fireplace',
  size: [17, 10, 19],
  view: { inside: [8, 2.6, 11.6, 8, 1.4, 3], bed: [11, 2.6, 10, 4, 1.2, 7] },
  build(a) {
    for (let z = 0; z <= 18; z++) for (let x = 0; x <= 16; x++) if (Math.hypot((x - 8) / 9.2, (z - 9) / 10.2) <= 1) a.block(x, 0, z, 'snow');
    const cx = 8, cz = 8;
    a.dome(cx, 0.5, cz, 6.5, 6.5, 6.5, 'snow', { thick: 1 });
    a.cyl(cx, cz, 5.5, 0, 0, 'planks_oak');
    // ice windows, a glowing skylight and lanterns in the dome
    a.fill(2, 2, 7, 2, 3, 8, 'ice').fill(14, 2, 7, 14, 3, 8, 'ice');
    a.block(cx, 7, cz, 'sea_lantern');
    for (const [x, z] of [[cx - 4, cz], [cx + 4, cz], [cx, cz - 4]]) a.block(x, 5, z, 'lantern');
    for (const [x, z] of [[4, 4], [12, 4], [4, 12], [12, 12]]) a.block(x, 2, z, 'lantern');
    // entrance tunnel with a door
    for (let z = 12; z <= 16; z++) {
      a.fill(7, 1, z, 7, 2, z, 'snow').fill(9, 1, z, 9, 2, z, 'snow').fill(7, 3, z, 9, 3, z, 'snow');
      a.block(8, 0, z, 'planks_oak');
    }
    a.fill(7, 3, 16, 9, 3, 16, 'ice');
    a.air(8, 1, 11, 8, 2, 16);
    a.furn('door', 8, 1, 16, F, C.white);

    // inside: fireplace, cloud bed, armchair, books, cocoa table, pet bed
    a.put('fireplace', 7, 1, 3, F, C.sky);
    a.put(BED_CLOUD, 4, 1, 8, R, C.sky);
    a.put('nightstand', 4, 1, 9, R, C.white);
    a.furn('table_lamp', 4, 2, 9, F, C.sky);
    a.put(ARMCHAIR, 12, 1, 7, L, C.rose);
    a.put(FLOOR_LAMP, 12, 1, 6, L, C.sun);
    a.put('bookshelf', 12, 1, 9, L, C.white);
    a.furn('teddy_bear', 12, 2, 9, L);
    a.put('rug_round', 7, 1, 7, F, C.sky);
    a.put('table_round', 10, 1, 11, F, C.white);
    a.put('chair', 11, 1, 11, L, C.sky);
    a.furn('cake_stand', 10, 2, 11, F, C.white);
    a.put('pet_bed', 5, 1, 11, F, C.lav);
    a.put('toy_chest', 6, 1, 4, F, C.sky);
    a.furn(CEIL_LAMP, cx, 5, cz, F, C.sun);

    // outside: snowman, pines, frozen pond, icy path with lanterns
    a.fill(13, 1, 15, 13, 2, 15, 'snow').block(13, 3, 15, 'snowman_head|snow').block(13, 4, 15, 'wool_black|cobble');
    a.block(12, 2, 15, 'log_oak').block(14, 2, 15, 'log_oak');
    pine(a, 1, 1, 1, 7);
    pine(a, 15, 1, 1, 6);
    pine(a, 15, 1, 12, 5);
    for (let z = 14; z <= 17; z++) for (let x = 1; x <= 5; x++) if (Math.hypot((x - 3) / 2.3, (z - 15.5) / 1.8) <= 1) a.block(x, 0, z, 'ice');
    a.fill(8, 0, 17, 8, 0, 18, 'ice');
    for (const x of [6, 10]) a.block(x, 1, 17, 'snow').block(x, 2, 17, 'lantern');
  },
};
