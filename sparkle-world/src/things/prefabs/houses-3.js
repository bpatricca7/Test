// Magic Houses, part 3: Bakery, Pet Shop, Modern House and Barn.
// Frame reminder: x left-to-right, y up (0 = ground layer), z back (0) to front (D-1).

import { F, R, B, L, C, FLOWERS, BED_BIG, SOFA, ARMCHAIR, COMFY, STOOL, TABLE_LONG, FLOOR_LAMP, LANTERN, CEIL_LAMP, BENCH } from './palette.js';

/** Striped beach/café umbrella: pole at (x, y..y+1, z), canopy centred above. */
export function umbrella(a, x, y, z, c1 = 'wool_pink', c2 = 'wool_white') {
  a.fill(x, y, z, x, y + 1, z, 'planks_white');
  for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) a.block(x + dx, y + 2, z + dz, (dx + dz) % 2 ? c2 : c1);
  a.block(x, y + 3, z, c1);
}

/** Stairs going up toward -z: steps (x0..x1) from (z0, y0+1) rising one per row. */
function stairsBack(a, x0, x1, z0, y0, n, key, withFurniture = false) {
  for (let k = 1; k <= n; k++) {
    const z = z0 - (k - 1);
    if (withFurniture) {
      if (k > 1) a.fill(x0, y0 + 1, z, x1, y0 + k - 1, z, key);
      for (let x = x0; x <= x1; x++) a.furn('stairs', x, y0 + k, z, F, C.white, null, { orBlock: key });
    } else {
      a.fill(x0, y0 + 1, z, x1, y0 + k, z, key);
    }
  }
}

// ---------------------------------------------------------------------------------------
// Bakery: pink brick shop with big display windows, a striped awning and a giant cupcake on
// the front gable; ovens, a display counter with cakes, a café table inside and two outside
// under umbrellas, a menu easel. Upstairs: a striped-wallpaper home with a bed and a bath.
// ---------------------------------------------------------------------------------------
export const bakery = {
  key: 'bakery',
  name: 'Sweet Bakery',
  blurb: 'Cakes, ovens, a café and a home upstairs',
  size: [19, 17, 19],
  view: { inside: [9, 2.8, 10.2, 7, 1.4, 4], upstairs: [11.5, 7.8, 5.2, 6, 6.4, 9] },
  build(a) {
    const X0 = 4, X1 = 14, Z0 = 3, Z1 = 11;
    a.floor(X0, Z0, X1, Z1, 0, 'brick_pink');
    a.checker(X0 + 1, Z0 + 1, X1 - 1, Z1 - 1, 0, 'tile_kitchen', 'wool_pink');
    a.walls(X0, Z0, X1, Z1, 1, 4, 'brick_pink');
    a.walls(X0, Z0, X1, Z1, 5, 5, 'planks_white');
    a.floor(X0 + 1, Z0 + 1, X1 - 1, Z1 - 1, 5, 'planks_oak');
    a.walls(X0, Z0, X1, Z1, 6, 9, 'planks_white');
    a.floor(X0, Z0, X1, Z1, 10, 'planks_white');
    a.air(X0 + 1, 1, Z0 + 1, X1 - 1, 4, Z1 - 1);
    a.air(X0 + 1, 6, Z0 + 1, X1 - 1, 9, Z1 - 1);
    // shop front: display windows, glass door, striped awning
    a.fill(5, 2, Z1, 7, 3, Z1, 'glass').fill(11, 2, Z1, 13, 3, Z1, 'glass');
    a.fill(8, 1, Z1, 10, 3, Z1, 'planks_white');
    a.door(9, 1, Z1, { key: 'door_glass|door', color: C.white });
    for (let x = X0; x <= X1; x++) {
      const k = x % 2 ? 'wool_pink' : 'wool_white';
      a.block(x, 5, Z1 + 1, k).block(x, 4, Z1 + 2, k);
    }
    // upstairs windows with pink shutters, side and back windows
    for (const x0 of [6, 11]) {
      a.fill(x0, 7, Z1, x0 + 1, 8, Z1, 'glass');
      a.fill(x0 - 1, 7, Z1, x0 - 1, 8, Z1, 'wool_pink').fill(x0 + 2, 7, Z1, x0 + 2, 8, Z1, 'wool_pink');
    }
    a.fill(X0, 2, 6, X0, 3, 7, 'glass').fill(X1, 7, 6, X1, 8, 7, 'glass').fill(X0, 7, 6, X0, 8, 7, 'glass');
    a.fill(7, 7, Z0, 8, 8, Z0, 'glass');
    // roof with the gable to the front: a giant cupcake sign
    a.gable(3, 2, 15, 12, 10, 'roof_pink', { axis: 'z', gable: 'planks_white', gableAt: [Z0, Z1] });
    const S = Z1 + 1; // the sign stands just out from the gable
    a.fill(8, 11, S, 10, 11, S, 'cookie').fill(7, 12, S, 11, 12, S, 'cookie');
    a.fill(7, 13, S, 11, 13, S, 'frosting_pink').block(8, 13, S, 'wool_yellow').block(10, 13, S, 'wool_sky');
    a.fill(8, 14, S, 10, 14, S, 'frosting_pink').block(9, 14, S, 'frosting_white');
    a.block(9, 15, S, 'wool_red');
    a.fill(9, 12, Z0, 9, 13, Z0, 'glass_heart');
    a.fill(13, 10, 5, 13, 14, 5, 'brick_pink');
    a.lining(X0, Z0, X1, Z1, 6, 9, 'wallpaper_stripes');

    // the shop: ovens and kitchen along the back, a display counter of cakes
    a.put('oven', 5, 1, 4, F, C.pink).put('oven', 6, 1, 4, F, C.white);
    a.put('stove', 7, 1, 4, F, C.white);
    a.put('fridge', 8, 1, 4, F, C.mint);
    a.put('sink_kitchen', 9, 1, 4, F);
    a.put('counter', 10, 1, 4, F);
    a.furn('fruit_bowl', 10, 2, 4, F);
    a.furn('clock', 7, 3, 4, F, C.pink);
    for (let x = 5; x <= 8; x++) a.put('counter', x, 1, 7, F, C.white);
    a.furn('cake_stand', 5, 2, 7, F, C.pink).furn('cake_stand', 7, 2, 7, F, C.lav);
    a.furn('plant_pot', 6, 2, 7, F, C.mint).furn('cake_stand', 8, 2, 7, F, C.sun);
    a.put('table_round', 6, 1, 9, F, C.white);
    a.put('chair', 5, 1, 9, R, C.pink).put('chair', 7, 1, 9, L, C.pink);
    a.furn('cake_stand', 6, 2, 9, F, C.pink);
    a.furn('plant_pot', 13, 1, 10, F, C.pink);
    a.furn(CEIL_LAMP, 7, 4, 6, F, C.sun);
    a.furn(CEIL_LAMP, 10, 4, 8, F, C.sun);
    // stairs up along the right, glass rail upstairs
    stairsBack(a, 11, 12, 9, 0, 4, 'planks_oak');
    a.air(11, 5, 6, 12, 5, 9);
    a.fill(10, 6, 6, 10, 6, 7, 'glass_pink');
    // upstairs home: bed, wardrobe, vanity, bath corner, rug
    a.put(BED_BIG, 6, 6, 5, F, C.pink);
    a.put('nightstand', 8, 6, 5, F, C.white);
    a.furn('table_lamp', 8, 7, 5, F, C.pink);
    a.put('wardrobe', 9, 6, 5, F, C.lav);
    a.put('vanity', 6, 6, 8, R, C.pink);
    a.put('rug_round', 7, 6, 7, F, C.rose);
    a.put('toilet', 8, 6, 9, B, C.white);
    a.put('sink_bath', 9, 6, 9, B, C.white);
    a.put('bathtub', 10, 6, 9, B, C.pink);
    a.furn(CEIL_LAMP, 8, 9, 7, F, C.sun);

    // outdoor café, menu easel, lanterns, flowers
    a.fill(9, 0, Z1 + 1, 9, 0, 18, 'path|cobble');
    for (const x of [5, 13]) {
      a.put('table_round', x, 1, 15, F, C.white);
      a.put('chair', x - 1, 1, 15, R, C.pink).put('chair', x + 1, 1, 15, L, C.mint);
      a.furn('cake_stand', x, 2, 15, F, C.pink);
      umbrella(a, x, 1, 16, x === 5 ? 'wool_pink' : 'wool_sky');
    }
    a.put('easel', 8, 1, 13, F, C.wood);
    a.furn(LANTERN, 8, 1, 18, F, C.sun).furn(LANTERN, 10, 1, 18, F, C.sun);
    a.flowers(0, 1, 2, 18, 1, FLOWERS, { density: 0.6, seed: 41 });
    a.flowers(16, 1, 18, 18, 1, FLOWERS, { density: 0.6, seed: 42 });
    a.furn('plant_pot', 3, 1, 12, F, C.pink).furn('plant_pot', 15, 1, 12, F, C.pink);
  },
};

// ---------------------------------------------------------------------------------------
// Pet Shop: a mint shop with a big pink paw over the door, a fish tank, a bird house, pet
// beds and bowls, toys and a treat counter; the shop keeper's bedroom behind a door, with a
// pet bed at the foot of the bed. Outside: a little dog house and a garden bench.
// ---------------------------------------------------------------------------------------
export const petShop = {
  key: 'pet_shop',
  name: 'Pet Shop',
  blurb: 'Pet beds, bowls, toys and a fish tank',
  size: [19, 13, 19],
  view: { inside: [9, 2.8, 10.4, 5.5, 1.4, 4.5], bedroom: [11.2, 2.8, 9.8, 13, 1.2, 4] },
  build(a) {
    const X0 = 3, X1 = 15, Z0 = 3, Z1 = 11;
    a.floor(X0, Z0, X1, Z1, 0, 'planks_white');
    a.floor(X0 + 1, Z0 + 1, X1 - 1, Z1 - 1, 0, 'planks_oak');
    a.walls(X0, Z0, X1, Z1, 1, 5, 'planks_mint');
    a.walls(X0, Z0, X1, Z1, 1, 1, 'planks_white');
    a.corners(X0, Z0, X1, Z1, 1, 5, 'planks_white');
    a.floor(X0, Z0, X1, Z1, 6, 'planks_white');
    a.air(X0 + 1, 1, Z0 + 1, X1 - 1, 5, Z1 - 1);
    // shop windows, door, the big pink paw
    a.fill(4, 2, Z1, 6, 4, Z1, 'glass');
    a.fill(12, 2, Z1, 13, 3, Z1, 'glass');
    a.door(9, 1, Z1, { key: 'door_glass|door', color: C.white });
    a.fill(8, 3, Z1, 10, 4, Z1, 'wool_pink').block(7, 4, Z1, 'wool_pink').block(11, 4, Z1, 'wool_pink');
    a.block(8, 5, Z1, 'wool_pink').block(10, 5, Z1, 'wool_pink');
    a.fill(X0, 2, 6, X0, 4, 8, 'glass').fill(X1, 2, 6, X1, 3, 7, 'glass').fill(12, 2, Z0, 13, 3, Z0, 'glass');
    // hip roof
    a.hip(2, 2, 16, 12, 6, 'roof_blue');
    // partition with a door to the bedroom
    a.fill(10, 1, Z0 + 1, 10, 5, Z1 - 1, 'planks_white');
    a.air(10, 1, 7, 10, 2, 7);
    a.furn('door', 10, 1, 7, R, C.mint);

    // fish tank on a glowing stand
    a.fill(4, 1, 4, 8, 1, 6, 'quartz').fill(5, 1, 5, 7, 1, 5, 'sea_lantern');
    a.fill(4, 2, 4, 8, 3, 6, 'glass');
    a.fill(5, 2, 5, 7, 3, 5, 'water').block(5, 2, 5, 'coral');
    // bird house, pet corner with beds and bowls, treat counter, toys
    a.put('bird_house', 9, 1, 4, F, C.sky);
    a.put('pet_bed', 4, 1, 8, R, C.pink).put('pet_bed', 4, 1, 10, R, C.lav);
    a.put('toy_chest', 4, 1, 9, R, C.sun);
    a.furn('fruit_bowl', 5, 1, 8, F).furn('fruit_bowl', 5, 1, 10, F);
    a.put('counter', 7, 1, 8, F, C.white).put('counter', 8, 1, 8, F, C.white);
    a.furn('cake_stand', 8, 2, 8, F, C.sun).furn('plant_pot', 7, 2, 8, F, C.pink);
    a.put('rug_round', 6, 1, 9, F, C.mint);
    a.fill(9, 1, 6, 9, 3, 6, 'log_birch').block(9, 4, 6, 'wool_pink');
    a.furn('picture_frame', 6, 4, 4, F);
    a.furn(CEIL_LAMP, 6, 5, 7, F, C.sun);
    // the keeper's bedroom
    a.put(BED_BIG, 12, 1, 4, F, C.mint);
    a.put('nightstand', 14, 1, 4, F, C.white);
    a.furn('table_lamp', 14, 2, 4, F, C.pink);
    a.put('pet_bed', 12, 1, 6, F, C.pink);
    a.put('rug_round', 12, 1, 8, F, C.lav);
    a.put('wardrobe', 14, 1, 9, L, C.white);
    a.put(COMFY, 11, 1, 10, R, C.pink);
    a.furn('picture_frame', 13, 3, 4, F);
    a.furn(CEIL_LAMP, 12, 5, 7, F, C.sun);

    // outside: flowers first, then a dog house, bench, bird house, lanterns
    a.flowers(0, 12, 7, 18, 1, FLOWERS, { density: 0.35, seed: 51 });
    a.flowers(10, 12, 18, 18, 1, FLOWERS, { density: 0.3, seed: 52 });
    a.flowers(0, 0, 2, 11, 1, FLOWERS, { density: 0.4, seed: 53 });
    a.air(1, 1, 13, 5, 2, 17).air(8, 1, 12, 10, 1, 13).air(12, 1, 14, 14, 1, 14);
    a.fill(2, 0, 14, 4, 0, 16, 'planks_oak');
    a.walls(2, 14, 4, 16, 1, 3, 'planks_pink');
    a.air(3, 1, 16, 3, 2, 16);
    a.gable(1, 13, 5, 17, 3, 'roof_red', { axis: 'z', gable: 'planks_pink', gableAt: [14, 16] });
    a.block(3, 4, 16, 'wool_white');
    a.put('pet_bed', 3, 1, 15, F, C.sky);
    a.furn('fruit_bowl', 5, 1, 17, F);
    a.put(BENCH, 13, 1, 14, F, C.pink);
    a.put('bird_house', 16, 1, 17, F, C.pink);
    a.fill(9, 0, Z1 + 1, 9, 0, 18, 'path|cobble');
    a.furn(LANTERN, 8, 1, 13, F, C.mint).furn(LANTERN, 10, 1, 13, F, C.mint);
  },
};

// ---------------------------------------------------------------------------------------
// Modern House: white cubes with glass walls, two floors joined by a staircase, an open
// kitchen with an island, a living room, a little bathroom, a bedroom upstairs, roof
// terraces with glass railings, and a pool with loungers and an umbrella.
// ---------------------------------------------------------------------------------------
export const modernHouse = {
  key: 'modern_house',
  name: 'Modern House',
  blurb: 'Glass walls, two floors and a pool',
  size: [23, 13, 23],
  iconZoom: 0.74,
  view: { inside: [5, 2.9, 10.8, 11, 1.2, 4], upstairs: [5.5, 7.9, 3.8, 8, 6.2, 8.5] },
  build(a) {
    const W = 'quartz';
    // ground floor box
    a.floor(2, 2, 14, 12, 0, W);
    a.floor(3, 3, 13, 11, 0, 'planks_oak');
    a.walls(2, 2, 14, 12, 1, 4, W);
    a.floor(2, 2, 14, 13, 5, W);
    a.air(3, 1, 3, 13, 4, 11);
    // glass curtain walls: front and right, ribbon windows left and back
    for (let x = 3; x <= 13; x++) if (x !== 6 && x !== 10) a.fill(x, 1, 12, x, 4, 12, 'glass');
    for (let z = 3; z <= 11; z++) if (z !== 6 && z !== 10) a.fill(14, 1, z, 14, 4, z, 'glass');
    a.fill(2, 3, 4, 2, 3, 10, 'glass');
    a.fill(4, 3, 2, 5, 4, 2, 'glass').fill(11, 3, 2, 13, 4, 2, 'glass');
    a.door(8, 1, 12, { key: 'door_glass|door', color: C.white });
    // upper floor box with a glass front, flat roof with overhang
    a.walls(2, 2, 9, 9, 6, 9, W);
    a.floor(1, 1, 10, 10, 10, W);
    a.air(3, 6, 3, 8, 9, 8);
    for (let x = 3; x <= 8; x++) a.fill(x, 6, 9, x, 9, 9, 'glass');
    for (let z = 3; z <= 8; z++) a.fill(9, 6, z, 9, 9, z, 'glass');
    a.fill(2, 8, 4, 2, 8, 7, 'glass');
    a.fill(2, 6, 2, 2, 9, 9, 'planks_mint').fill(2, 8, 4, 2, 8, 7, 'glass');
    a.door(6, 6, 9, { key: 'door_glass|door', color: C.white });
    // terrace railings (glass) round the lower roof, lanterns on the corners
    for (let x = 2; x <= 14; x++) for (const z of [2, 13]) if (x > 9 || z === 13) a.block(x, 6, z, 'glass');
    for (let z = 2; z <= 13; z++) {
      a.block(14, 6, z, 'glass');
      if (z > 9) a.block(2, 6, z, 'glass');
    }
    a.block(14, 7, 13, 'lantern').block(2, 7, 13, 'lantern').block(14, 7, 2, 'lantern');
    // staircase (furniture steps where they exist) with an opening and a glass rail upstairs
    stairsBack(a, 3, 4, 9, 0, 5, W, true);
    a.air(3, 5, 5, 4, 5, 9);
    a.fill(5, 6, 5, 5, 6, 8, 'glass');
    // bathroom behind a partition
    a.fill(11, 1, 3, 11, 4, 5, W).fill(11, 1, 6, 13, 4, 6, W);
    a.door(12, 1, 6, { key: 'door', color: C.white });
    a.put('sink_bath', 12, 1, 3, F, C.white).put('toilet', 13, 1, 3, F, C.white);
    a.put('shower', 13, 1, 5, L, C.sky);
    a.put('bath_mat', 12, 1, 4, F, C.mint);

    // open kitchen with an island
    a.put('fridge', 6, 1, 3, F, C.white).put('oven', 7, 1, 3, F, C.white).put('stove', 8, 1, 3, F, C.white);
    a.put('sink_kitchen', 9, 1, 3, F).put('counter', 10, 1, 3, F);
    a.furn('fruit_bowl', 10, 2, 3, F);
    for (let x = 7; x <= 9; x++) {
      a.put('counter', x, 1, 6, F, C.mint);
      a.put(STOOL, x, 1, 7, B, C.mint);
    }
    a.furn('plant_pot', 8, 2, 6, F, C.mint);
    // living room
    a.put('tv', 12, 1, 7, F, C.white);
    a.put('rug_round', 11, 1, 9, F, C.mint);
    a.put('coffee_table', 11, 1, 9, F, C.white);
    a.put(SOFA, 12, 1, 11, B, C.mint);
    a.put(FLOOR_LAMP, 13, 1, 11, F, C.white);
    // dining
    a.put(TABLE_LONG, 4, 1, 10, F, C.white);
    a.put('chair', 4, 1, 11, B, C.mint).put('chair', 5, 1, 11, B, C.mint).put('chair', 6, 1, 10, L, C.mint);
    a.furn('cake_stand', 4, 2, 10, F, C.pink);
    a.furn('plant_pot', 13, 1, 8, F, C.mint);
    a.furn(CEIL_LAMP, 8, 4, 5, F, C.white).furn(CEIL_LAMP, 11, 4, 9, F, C.white).furn(CEIL_LAMP, 6, 4, 9, F, C.white);
    // upstairs bedroom
    a.put(BED_BIG, 6, 6, 3, F, C.mint);
    a.put('nightstand', 5, 6, 3, F, C.white).put('nightstand', 8, 6, 3, F, C.white);
    a.furn('table_lamp', 5, 7, 3, F, C.mint).furn('table_lamp', 8, 7, 3, F, C.mint);
    a.put('wardrobe', 8, 6, 7, L, C.white);
    a.put('desk', 8, 6, 5, L, C.white);
    a.put('chair', 7, 6, 5, R, C.mint);
    a.put('rug_round', 6, 6, 6, F, C.pink);
    a.put(COMFY, 6, 6, 8, B, C.pink);
    a.furn(CEIL_LAMP, 6, 9, 5, F, C.white);
    // terraces: café table, loungers, a little roof garden
    a.put('table_round', 4, 6, 11, F, C.white);
    a.put('chair', 3, 6, 11, R, C.pink).put('chair', 5, 6, 11, L, C.pink);
    a.furn('plant_pot', 8, 6, 11, F, C.pink);
    a.put(BENCH, 11, 6, 4, F, C.white);
    a.fill(12, 6, 8, 13, 6, 9, 'grass');
    a.flowers(12, 8, 13, 9, 7, ['flower_tulip', 'flower_rose', 'flower_daisy'], { density: 1, seed: 61 });

    // pool with a deck, loungers and an umbrella
    a.fill(15, 0, 2, 22, 0, 16, 'planks_oak');
    a.walls(15, 3, 21, 13, 1, 1, W);
    a.fill(16, 0, 4, 20, 0, 12, 'tile_bath');
    a.fill(16, 1, 4, 20, 1, 12, 'water');
    a.furn('pool_float', 18, 1, 7, F, C.pink);
    a.put(BENCH, 16, 1, 15, B, C.white).put(BENCH, 21, 1, 15, B, C.white);
    umbrella(a, 18, 1, 15, 'wool_sky', 'wool_white');
    // garden: path, lanterns, flowers, a birch tree, mailbox
    a.fill(8, 0, 13, 8, 0, 22, W);
    a.furn(LANTERN, 7, 1, 16, F, C.white).furn(LANTERN, 9, 1, 19, F, C.white);
    a.flowers(2, 15, 6, 21, 1, FLOWERS, { density: 0.45, seed: 62 });
    a.flowers(10, 17, 14, 21, 1, FLOWERS, { density: 0.45, seed: 63 });
    a.tree(4, 1, 18, { h: 4, r: 2, log: 'log_birch', leaves: 'leaves_oak' });
    a.furn('mailbox', 9, 1, 21, F, C.white);
  },
};

// ---------------------------------------------------------------------------------------
// Barn: a red barn with white trim, a gambrel roof and a weathervane, big open doors with
// X-braced panels, a hay loft with a cosy bed, pony stalls with straw, hay bales, a silo,
// a fenced paddock for your pony and a pumpkin patch.
// ---------------------------------------------------------------------------------------
export const barn = {
  key: 'barn',
  name: 'Happy Barn',
  blurb: 'Hay, pony stalls, a loft bed and a weathervane',
  size: [21, 17, 21],
  view: { inside: [9, 3, 12.2, 5, 1.5, 5], loft: [12, 7.6, 6.5, 4, 6, 4.5] },
  build(a) {
    const WALL = 'wool_red|brick_red', TRIM = 'planks_white', ROOF = 'roof_blue';
    const X0 = 3, X1 = 15, Z0 = 3, Z1 = 13;
    a.floor(X0, Z0, X1, Z1, 0, 'planks_oak');
    a.walls(X0, Z0, X1, Z1, 1, 5, WALL);
    a.corners(X0, Z0, X1, Z1, 1, 5, TRIM);
    a.air(X0 + 1, 1, Z0 + 1, X1 - 1, 5, Z1 - 1);
    // gambrel roof along z, white trim on both gable edges, gable walls
    const H = [5, 7, 9, 10, 11, 11, 12, 12];
    for (let x = 2; x <= 16; x++) {
      const e = Math.min(x - 2, 16 - x);
      const top = H[e], bottom = e === 0 ? 5 : Math.min(H[e - 1] + 1, top);
      for (let z = 2; z <= 14; z++) a.fill(x, bottom, z, x, top, z, z === 2 || z === 14 ? TRIM : ROOF);
      if (x >= X0 && x <= X1 && bottom - 1 >= 6) {
        a.fill(x, 6, Z0, x, bottom - 1, Z0, WALL);
        a.fill(x, 6, Z1, x, bottom - 1, Z1, WALL);
      }
    }
    // big doors with a white frame, X-braced side panels, hayloft door with a beam
    a.air(8, 1, Z1, 10, 4, Z1);
    a.fill(7, 1, Z1, 7, 5, Z1, TRIM).fill(11, 1, Z1, 11, 5, Z1, TRIM).fill(7, 5, Z1, 11, 5, Z1, TRIM);
    for (const x0 of [4, 12]) {
      for (let i = 0; i < 3; i++) a.block(x0 + i, 1 + i, Z1, TRIM).block(x0 + 2 - i, 1 + i, Z1, TRIM);
    }
    a.air(9, 7, Z1, 9, 8, Z1);
    a.fill(8, 7, Z1, 8, 9, Z1, TRIM).fill(10, 7, Z1, 10, 9, Z1, TRIM).block(9, 9, Z1, TRIM);
    a.block(9, 10, Z1 + 1, 'log_oak');
    a.fill(X0, 2, 6, X0, 3, 7, 'glass').fill(X1, 2, 6, X1, 3, 7, 'glass');
    a.fill(X0, 2, 10, X0, 3, 11, 'glass').fill(X1, 2, 10, X1, 3, 11, 'glass');
    a.fill(9, 7, Z0, 9, 8, Z0, 'glass');
    // weathervane
    a.fill(9, 13, 8, 9, 14, 8, 'wool_white|quartz');
    a.block(8, 15, 8, 'wool_black|cobble').block(9, 15, 8, 'wool_black|cobble').block(10, 15, 8, 'wool_yellow');
    a.block(9, 16, 8, 'wool_red');
    // lanterns in the walls
    for (const z of [5, 9]) a.block(X0, 4, z, 'lantern').block(X1, 4, z, 'lantern');

    // pony stalls with straw and hay
    a.fill(4, 1, 4, 5, 1, 12, 'carpet_yellow');
    for (const z of [6, 9]) a.fill(4, 1, z, 6, 2, z, 'planks_oak');
    for (const [rail, gate] of [[4, 5], [7, 8], [10, 11]]) {
      a.block(6, 1, rail, 'planks_oak');
      a.furn('gate', 6, 1, gate, R, C.white);
    }
    a.block(6, 1, 12, 'planks_oak');
    for (const z of [4, 7, 10]) a.block(4, 1, z, 'hay');
    // hay bales and a stair up to the loft
    a.fill(12, 1, 4, 14, 2, 5, 'hay').block(14, 3, 4, 'hay');
    stairsBack(a, 13, 14, 11, 0, 4, 'planks_oak');
    // the hay loft: floor, hay bale rail, a cosy bed with a lamp and teddy
    a.fill(4, 5, 4, 14, 5, 7, 'planks_oak');
    for (let x = 4; x <= 12; x++) a.block(x, 6, 7, 'hay');
    a.put('bed_single', 4, 6, 4, F, C.red);
    a.put('nightstand', 5, 6, 4, F, C.wood);
    a.furn('table_lamp', 5, 7, 4, F, C.sun);
    a.furn('teddy_bear', 6, 6, 4, F);
    a.fill(10, 6, 4, 12, 6, 5, 'hay').block(11, 7, 4, 'hay');
    a.put('toy_chest', 8, 6, 4, F, C.red);
    a.furn(CEIL_LAMP, 9, 4, 6, F, C.sun);
    a.furn(CEIL_LAMP, 7, 10, 5, F, C.sun);
    a.put('pet_bed', 12, 1, 12, B, C.red);
    a.furn('fruit_bowl', 11, 1, 12, F);

    // silo
    a.cyl(18.5, 4.5, 1.8, 1, 10, 'brick_white|quartz');
    a.cyl(18.5, 4.5, 1.8, 4, 4, 'wool_red|brick_red').cyl(18.5, 4.5, 1.8, 8, 8, 'wool_red|brick_red');
    a.dome(18.5, 10, 4.5, 2.1, 2.2, 2.1, ROOF);
    // paddock for a pony
    for (let x = 1; x <= 6; x++) for (const z of [15, 19]) a.furn('fence', x, 1, z, F, C.white);
    for (let z = 16; z <= 18; z++) {
      a.furn('fence', 1, 1, z, F, C.white);
      if (z !== 17) a.furn('fence', 6, 1, z, F, C.white);
    }
    a.furn('gate', 6, 1, 17, R, C.white);
    a.block(2, 1, 16, 'hay').block(2, 1, 18, 'hay');
    // pumpkin patch, path, hay by the door, lanterns
    a.fill(13, 0, 16, 19, 0, 16, 'farmland|dirt').fill(13, 0, 18, 19, 0, 18, 'farmland|dirt');
    for (const [x, z] of [[13, 16], [16, 16], [19, 16], [14, 18], [17, 18]]) a.block(x, 1, z, 'pumpkin|wool_orange');
    a.flowers(13, 20, 19, 20, 1, ['flower_sunflower'], { density: 0.7, seed: 71 });
    a.fill(8, 0, 14, 10, 0, 20, 'path|dirt');
    a.fill(11, 1, 14, 12, 1, 15, 'hay').block(12, 2, 14, 'hay');
    a.furn(LANTERN, 7, 1, 15, F, C.sun);
    a.flowers(0, 0, 1, 14, 1, FLOWERS, { density: 0.4, seed: 72 });
  },
};
