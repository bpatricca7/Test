// Magic Houses, part 1: Flower Cottage and Princess Castle.
// Frame reminder: x left-to-right, y up (0 = ground layer), z back (0) to front (D-1).

import { F, R, B, L, C, FLOWERS, BED_BIG, BED_PRINCESS, SOFA, ARMCHAIR, COMFY, FLOOR_LAMP, LANTERN, CEIL_LAMP, BENCH } from './palette.js';

/** A little flag on a pole: pole at (x, y..y+2, z), flag cells to +x at the top. */
export function flag(a, x, y, z, c1 = 'wool_pink', c2 = 'wool_magenta') {
  a.fill(x, y, z, x, y + 2, z, 'wool_white|quartz');
  a.block(x + 1, y + 2, z, c1).block(x + 2, y + 2, z, c2).block(x + 1, y + 1, z, c2).block(x + 2, y + 1, z, c1);
}

// ---------------------------------------------------------------------------------------
// Flower Cottage: white walls, strawberry roof, flower boxes under every front window, a
// garden with a white picket fence, cherry trees and a path to the pink door. Inside:
// flowery wallpaper, a bedroom corner, a little kitchen, a dining nook and a reading chair.
// ---------------------------------------------------------------------------------------
export const cottage = {
  key: 'cottage',
  name: 'Flower Cottage',
  blurb: 'A cosy cottage with flower boxes and a garden',
  size: [19, 13, 21],
  view: { inside: [9, 2.7, 12.3, 7, 1.2, 6], kitchen: [7, 2.8, 12, 12.5, 1.3, 7] },
  build(a) {
    const X0 = 4, X1 = 14, Z0 = 4, Z1 = 14; // outer walls
    // garden: hedges on three sides, a white picket fence and gate in front
    a.walls(1, 1, 17, 19, 1, 1, 'hedge|leaves_oak');
    a.fill(2, 1, 19, 16, 1, 19, 'air');
    for (let x = 2; x <= 16; x++) if (x !== 9) a.furn('fence', x, 1, 19, F, C.white);
    a.furn('gate', 9, 1, 19, F, C.white);
    a.fill(9, 0, 15, 9, 0, 20, 'path|cobble');
    a.block(8, 0, 15, 'path|cobble').block(10, 0, 15, 'path|cobble');

    // house shell: cobble base, white planks, log corners, flowery wallpaper inside
    a.floor(X0, Z0, X1, Z1, 0, 'cobble');
    a.floor(X0 + 1, Z0 + 1, X1 - 1, Z1 - 1, 0, 'planks_oak');
    a.walls(X0, Z0, X1, Z1, 1, 4, 'planks_white');
    a.walls(X0, Z0, X1, Z1, 1, 1, 'cobble');
    a.corners(X0, Z0, X1, Z1, 1, 4, 'log_oak');
    a.floor(X0, Z0, X1, Z1, 5, 'planks_oak');
    a.air(X0 + 1, 1, Z0 + 1, X1 - 1, 4, Z1 - 1);
    // windows (front, back, sides) and the door
    a.fill(6, 2, Z1, 7, 3, Z1, 'glass').fill(11, 2, Z1, 12, 3, Z1, 'glass');
    a.fill(9, 2, Z0, 10, 3, Z0, 'glass');
    a.fill(X0, 2, 8, X0, 3, 9, 'glass').fill(X1, 2, 8, X1, 3, 9, 'glass');
    a.door(9, 1, Z1, { key: 'door_pink|door', color: C.pink });
    a.lining(X0, Z0, X1, Z1, 1, 4, 'wallpaper_flowers');
    // roof with gable ends, attic windows and a chimney
    a.gable(3, 3, 15, 15, 5, 'roof_red', { axis: 'x', gable: 'planks_white', gableAt: [X0, X1] });
    a.block(X0, 8, 9, 'glass_pink').block(X1, 8, 9, 'glass_pink');
    a.fill(12, 6, 6, 12, 12, 6, 'cobble');
    // ceiling lights
    a.block(7, 5, 8, 'lamp_block').block(11, 5, 10, 'lamp_block');

    // bedroom corner
    a.put(BED_BIG, 6, 1, 6, F, C.pink);
    a.put('nightstand', 8, 1, 6, F, C.white);
    a.furn('table_lamp', 8, 2, 6, F, C.pink);
    a.furn('picture_frame', 6, 3, 6, F);
    a.put('wardrobe', 6, 1, 11, R, C.lav);
    a.put('rug_round', 7, 1, 8, F, C.pink);
    // kitchen
    a.put('counter', 10, 1, 6, F);
    a.put('stove', 11, 1, 6, F, C.white);
    a.put('fridge', 12, 1, 6, F, C.mint);
    a.furn('plant_pot', 10, 2, 6, F, C.pink);
    a.furn('clock', 11, 3, 6, F, C.pink);
    a.put('sink_kitchen', 12, 1, 8, L);
    a.put('oven', 12, 1, 9, L, C.white);
    a.furn('fruit_bowl', 12, 2, 9, F);
    // dining nook
    a.put('table_round', 11, 1, 11, F, C.white);
    a.put('chair', 10, 1, 11, R, C.pink);
    a.put('chair', 12, 1, 11, L, C.pink);
    a.furn('cake_stand', 11, 2, 11, F, C.pink);
    // reading corner by the door
    a.put(FLOOR_LAMP, 6, 1, 12, F, C.sun);
    a.put(ARMCHAIR, 7, 1, 12, B, C.rose);
    a.furn('teddy_bear', 8, 1, 12, B);
    a.furn(CEIL_LAMP, 9, 4, 9, F, C.sun);

    // front garden: flower boxes, cherry trees, lanterns, bench, mailbox
    for (const x of [6, 7, 11, 12]) a.furn('flower_box', x, 1, Z1 + 1, F, C.white);
    a.flowers(2, 15, 7, 18, 1, FLOWERS, { density: 0.8, seed: 2 });
    a.flowers(11, 15, 16, 18, 1, FLOWERS, { density: 0.8, seed: 5 });
    a.air(6, 1, 15, 7, 1, 15).air(11, 1, 15, 12, 1, 15).air(13, 1, 16, 14, 1, 16);
    a.tree(3, 1, 17, { h: 3, r: 1.9, leaves: 'leaves_cherry' });
    a.tree(15, 1, 17, { h: 3, r: 1.9, leaves: 'leaves_cherry' });
    a.furn(LANTERN, 8, 1, 18, F, C.sun);
    a.furn(LANTERN, 10, 1, 18, F, C.sun);
    a.put(BENCH, 14, 1, 16, B, C.sky);
    a.furn('mailbox', 10, 1, 20, F, C.pink);
    // side and back gardens
    a.flowers(2, 2, 3, 14, 1, FLOWERS, { density: 0.7, seed: 8 });
    a.flowers(15, 2, 16, 14, 1, FLOWERS, { density: 0.7, seed: 9 });
    a.flowers(4, 2, 14, 3, 1, FLOWERS, { density: 0.6, seed: 11 });
    a.air(2, 1, 2, 2, 1, 2).furn('bird_house', 2, 1, 2, F, C.sky);
  },
};

// ---------------------------------------------------------------------------------------
// Princess Castle: four round towers with pointed pink roofs and flags, a central spire,
// a throne hall with a red carpet and a grand double staircase, and a princess suite with
// heart wallpaper, a canopy bed, vanity, dollhouse, bath corner and a cosy lounge.
// ---------------------------------------------------------------------------------------
export const princessCastle = {
  key: 'princess_castle',
  name: 'Princess Castle',
  blurb: 'Towers, flags, a throne room and a canopy bed',
  size: [25, 26, 25],
  iconZoom: 0.72,
  view: { inside: [12, 3.4, 17.5, 12, 2.2, 6], upstairs: [12, 8.6, 16.5, 12, 7.8, 7] },
  build(a) {
    const K0 = 5, K1 = 19; // keep walls
    const WALL = 'quartz', BAND = 'brick_pink', ROOF = 'roof_pink', WP = 'wallpaper_hearts';
    const towers = [[K0, K0], [K1, K0], [K0, K1], [K1, K1]];

    // towers: round walls, floors inside, cornice, cone roof and a flag
    for (const [cx, cz] of towers) {
      a.cyl(cx, cz, 3, 0, 0, WALL);
      a.cyl(cx, cz, 3, 1, 14, WALL, { hollow: true, inner: 'air' });
      for (const y of [1, 6, 11]) a.cyl(cx, cz, 3, y, y, BAND, { hollow: true });
      a.cyl(cx, cz, 2, 6, 6, WALL);
      a.cyl(cx, cz, 2, 11, 11, WALL);
      a.cyl(cx, cz, 3.45, 14, 14, BAND);
      a.cone(cx, cz, 3.5, 15, ROOF, { step: 0.7, tip: 'wool_white|quartz' });
      flag(a, cx, 21, cz);
    }

    // the keep: two floors, pink bands, flat roof with crenellations
    a.floor(K0, K0, K1, K1, 0, WALL);
    a.checker(K0 + 1, K0 + 1, K1 - 1, K1 - 1, 0, WALL, 'wool_pink');
    a.walls(K0, K0, K1, K1, 1, 11, WALL);
    for (const y of [1, 6, 11]) a.walls(K0, K0, K1, K1, y, y, BAND);
    a.floor(K0 + 1, K0 + 1, K1 - 1, K1 - 1, 6, WALL);
    a.floor(K0 + 1, K0 + 1, K1 - 1, K1 - 1, 11, WALL);
    a.air(K0 + 1, 1, K0 + 1, K1 - 1, 5, K1 - 1);
    a.air(K0 + 1, 7, K0 + 1, K1 - 1, 10, K1 - 1);
    for (let i = K0; i <= K1; i++) {
      if (i % 2 === 0) continue;
      a.block(i, 12, K0, BAND).block(i, 12, K1, BAND).block(K0, 12, i, BAND).block(K1, 12, i, BAND);
    }
    // tower windows (outward sides) and keep windows
    for (const [cx, cz] of towers) {
      const ox = cx === K0 ? -3 : 3, oz = cz === K0 ? -3 : 3;
      for (const y of [3, 8, 13]) {
        a.fill(cx + ox, y, cz, cx + ox, y + (y === 13 ? 0 : 1), cz, 'glass_pink');
        a.fill(cx, y, cz + oz, cx, y + (y === 13 ? 0 : 1), cz + oz, 'glass_pink');
      }
    }
    for (const x of [8, 16]) {
      a.fill(x - 1, 2, K1, x, 4, K1, 'glass_pink');
      a.fill(x - 1, 2, K0, x, 4, K0, 'glass_pink');
    }
    for (const x of [8, 10, 14, 16]) {
      a.fill(x, 8, K1, x, 9, K1, 'glass_heart');
      a.fill(x, 8, K0, x, 9, K0, 'glass_heart');
    }
    for (const z of [10, 14]) {
      a.fill(K0, 2, z, K0, 4, z + 1, 'glass_pink').fill(K1, 2, z, K1, 4, z + 1, 'glass_pink');
      a.fill(K0, 8, z, K0, 9, z + 1, 'glass_heart').fill(K1, 8, z, K1, 9, z + 1, 'glass_heart');
    }
    // back wall: heart window behind the throne, pink banners
    a.fill(11, 3, K0, 13, 4, K0, 'glass_heart').block(12, 5, K0, 'glass_heart');
    a.fill(9, 2, K0, 9, 5, K0, 'wool_magenta|wool_pink').fill(15, 2, K0, 15, 5, K0, 'wool_magenta|wool_pink');
    // heart wallpaper in the princess suite (back half of the upper floor)
    a.fill(K0 + 2, 7, K0 + 1, K1 - 2, 10, K0 + 1, WP);
    a.fill(K0 + 1, 7, K0 + 2, K0 + 1, 10, 12, WP).fill(K1 - 1, 7, K0 + 2, K1 - 1, 10, 12, WP);
    for (const x of [8, 10, 14, 16]) a.air(x, 8, K0 + 1, x, 9, K0 + 1);
    a.air(K0 + 1, 8, 10, K0 + 1, 9, 11).air(K1 - 1, 8, 10, K1 - 1, 9, 11);
    // open the towers into the keep corners
    for (const [cx, cz] of towers) {
      a.cyl(cx, cz, 1.99, 1, 5, 'air');
      a.cyl(cx, cz, 1.99, 7, 10, 'air');
      a.cyl(cx, cz, 1.99, 12, 13, 'air');
    }

    // grand entrance: triple pink doors, glass transom, pink pediment
    a.air(11, 1, K1, 13, 3, K1);
    a.fill(11, 3, K1, 13, 3, K1, 'glass_pink').block(12, 4, K1, 'glass_pink');
    for (const x of [11, 12, 13]) a.furn('door_pink|door', x, 1, K1, F, C.pink);
    a.fill(10, 5, K1, 14, 5, K1, BAND).block(11, 6, K1, BAND).block(13, 6, K1, BAND).block(12, 7, K1, BAND);
    a.block(12, 6, K1, 'glass_heart');

    // central spire on the roof
    a.cyl(12, 12, 2, 12, 17, WALL, { hollow: true, inner: 'air' });
    a.cyl(12, 12, 2.45, 17, 17, BAND);
    a.fill(12, 14, 10, 12, 15, 10, 'glass_heart').fill(12, 14, 14, 12, 15, 14, 'glass_heart');
    a.cone(12, 12, 2.5, 18, ROOF, { step: 0.7, tip: 'wool_white|quartz' });
    flag(a, 12, 23, 12, 'wool_magenta|wool_pink', 'wool_pink');

    // ---- throne hall ----
    a.fill(11, 1, 8, 13, 1, 18, 'carpet_pink');
    a.fill(10, 1, 6, 14, 1, 7, WALL);
    a.fill(10, 2, 6, 14, 2, 7, 'carpet_pink');
    a.put(ARMCHAIR, 12, 2, 6, F, C.gold);
    a.put(FLOOR_LAMP, 10, 2, 6, F, C.pink);
    a.put(FLOOR_LAMP, 14, 2, 6, F, C.pink);
    a.put('piano', 7, 1, 6, F, C.white);
    a.furn('picture_frame', 7, 3, 6, F);
    a.put('fireplace', 16, 1, 6, F, C.rose);
    a.furn('candle', 16, 3, 6, F, C.pink);
    a.put(ARMCHAIR, 9, 1, 10, R, C.lav);
    a.put(ARMCHAIR, 15, 1, 10, L, C.lav);
    a.furn('plant_pot', 10, 1, 18, F, C.pink);
    a.furn('plant_pot', 14, 1, 18, F, C.pink);
    a.furn(CEIL_LAMP, 12, 5, 10, F, C.sun);
    a.furn(CEIL_LAMP, 12, 5, 15, F, C.sun);
    a.block(9, 6, 9, 'lamp_block').block(15, 6, 9, 'lamp_block');

    // grand double staircase with pink carpet, openings and glass rails upstairs
    for (const [x0, x1, rail] of [[6, 8, 9], [16, 18, 15]]) {
      for (let k = 1; k <= 5; k++) {
        const z = 18 - k;
        a.fill(x0, 1, z, x1, k, z, WALL);
        a.fill(x0, k + 1, z, x1, k + 1, z, 'carpet_pink');
      }
      a.air(x0, 6, 13, x1, 6, 18);
      a.fill(rail, 7, 13, rail, 7, 18, 'glass_pink');
    }

    // ---- upstairs: the princess suite ----
    a.put(BED_PRINCESS, 11, 7, 7, F, C.pink);
    a.put('nightstand', 10, 7, 7, F, C.white);
    a.furn('table_lamp', 10, 8, 7, F, C.pink);
    a.put('nightstand', 13, 7, 7, F, C.white);
    a.furn('table_lamp', 13, 8, 7, F, C.pink);
    a.put('wardrobe', 7, 7, 7, F, C.lav);
    a.put('toy_chest', 9, 7, 7, F, C.pink);
    a.put('bookshelf', 14, 7, 7, F, C.white);
    a.furn('teddy_bear', 14, 8, 7, F);
    a.put('vanity', 15, 7, 7, F, C.pink);
    a.put('rug_heart', 11, 7, 9, F, C.pink);
    a.put('dollhouse', 7, 7, 10, R, C.pink);
    a.furn('fairy_lights', 12, 10, 8, F, C.pink);
    a.furn(CEIL_LAMP, 12, 10, 11, F, C.sun);
    // bath corner
    a.put('bathtub', 17, 7, 8, L, C.pink);
    a.put('sink_bath', 17, 7, 10, L, C.white);
    a.put('toilet', 17, 7, 11, L, C.white);
    a.furn('towel_rack', 17, 8, 9, L, C.pink);
    // lounge over the entrance
    a.put('tv', 12, 7, 18, B, C.pink);
    a.put('coffee_table', 11, 7, 16, F, C.white);
    a.put(SOFA, 11, 7, 14, F, C.lav);
    a.put(COMFY, 10, 7, 15, R, C.pink);
    a.put(COMFY, 13, 7, 15, L, C.sky);
    a.furn(CEIL_LAMP, 12, 10, 16, F, C.sun);

    // ---- front courtyard ----
    a.fill(11, 0, K1 + 1, 13, 0, 24, WALL);
    a.fill(12, 1, K1 + 1, 12, 1, 24, 'carpet_pink');
    a.flowers(9, 21, 10, 24, 1, ['flower_rose', 'flower_tulip', 'flower_rose'], { density: 0.9, seed: 4 });
    a.flowers(14, 21, 15, 24, 1, ['flower_rose', 'flower_tulip', 'flower_rose'], { density: 0.9, seed: 7 });
    a.furn(LANTERN, 10, 1, K1 + 1, F, C.pink);
    a.furn(LANTERN, 14, 1, K1 + 1, F, C.pink);
    for (const x of [0, 1, 23, 24]) a.flowers(x, 0, x, 24, 1, ['flower_rose', 'flower_tulip', 'flower_daisy'], { density: 0.5, seed: 13 + x });
    for (const [x, z] of [[1, 23], [23, 23], [1, 1], [23, 1]]) a.block(x, 1, z, 'leaves_cherry').block(x, 2, z, 'leaves_cherry');
  },
};
