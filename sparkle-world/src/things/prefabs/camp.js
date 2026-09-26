// Wave 2 Magic Builds: campers you can camp in and do things inside.
// Sparkle Camper (big pink camper with bunk beds, kitchenette, sofa, bathroom, a rooftop
// deck and a pop-out pool with a slide), Retro Mini Trailer and Camper Van.
// Frame reminder: x left-to-right, y up (0 = ground layer), z back (0) to front (D-1).

import { F, R, B, L, C, FLOWERS, BED_BIG, BED_BUNK, SOFA, ARMCHAIR, COMFY, STOOL, BENCH, LANTERN, CEIL_LAMP } from './palette.js';
import { umbrella } from './houses-3.js';

/** Chunky wheels: 2x2 tyres standing at the given cells. */
function wheels(a, xs, zs) {
  for (const x of xs) for (const z of zs) a.fill(x, 0, z, x + 1, 1, z, 'wool_black|cobble');
}

/** A cosy camp fire: a stone ring, a glowing ember in the ground and a flame on top. */
export function campfire(a, x, z) {
  a.block(x - 1, 1, z, 'cobble').block(x + 1, 1, z, 'cobble').block(x, 1, z - 1, 'cobble').block(x, 1, z + 1, 'cobble');
  a.block(x, 0, z, 'lamp_block');
  a.furn('candle', x, 1, z, F, C.peach);
}

/** Striped awning along x at height y, depth row z. */
function awning(a, x0, x1, y, z, c1 = 'wool_pink', c2 = 'wool_white') {
  for (let x = x0; x <= x1; x++) a.block(x, y, z, x % 2 ? c1 : c2);
}

// ---------------------------------------------------------------------------------------
// Sparkle Camper
// ---------------------------------------------------------------------------------------
export const sparkleCamper = {
  key: 'sparkle_camper',
  name: 'Sparkle Camper',
  blurb: 'A big pink camper with a roof deck and a pool',
  size: [21, 11, 15],
  view: { inside: [8, 3.4, 7.2, 4.5, 2.4, 5.5], bath: [12, 3.4, 6.5, 15.5, 2.2, 6.5], deck: [5, 8.4, 5.5, 15, 7, 8] },
  build(a) {
    const X0 = 3, X1 = 17, Z0 = 4, Z1 = 9;
    // chassis, wheels, body with a white stripe and magenta skirt, roof
    a.fill(X0, 1, Z0, X1, 1, Z1, 'planks_white');
    wheels(a, [5, 14], [Z0 - 1, Z1 + 1]);
    for (let y = 2; y <= 5; y++) a.walls(X0, Z0, X1, Z1, y, y, y === 5 ? 'wool_white' : y === 2 ? 'wool_magenta|wool_pink' : 'wool_pink');
    a.floor(X0, Z0, X1, Z1, 6, 'wool_white');
    a.air(X0 + 1, 2, Z0 + 1, X1 - 1, 5, Z1 - 1);
    a.checker(X0 + 1, Z0 + 1, X1 - 1, Z1 - 1, 1, 'wool_pink', 'wool_white');
    // rounded roof corners, windscreen, headlights, windows
    for (const x of [X0, X1]) for (const z of [Z0, Z1]) a.block(x, 6, z, 'air');
    a.fill(X1, 3, Z0 + 1, X1, 4, Z1 - 1, 'glass');
    a.block(X1, 2, Z0 + 1, 'lamp_block').block(X1, 2, Z1 - 1, 'lamp_block');
    a.fill(5, 3, Z1, 6, 4, Z1, 'glass_pink').fill(11, 3, Z1, 12, 4, Z1, 'glass_pink');
    a.fill(6, 3, Z0, 7, 4, Z0, 'glass_pink').fill(12, 3, Z0, 13, 4, Z0, 'glass_pink');
    a.fill(X0, 3, 6, X0, 4, 7, 'glass_pink');
    a.fill(15, 3, Z0, 15, 4, Z0, 'glass').fill(15, 3, Z1, 15, 4, Z1, 'glass');
    // front door with a step, striped awning with fairy lights
    a.door(8, 2, Z1, { key: 'door_pink|door', color: C.pink });
    a.block(8, 1, Z1 + 1, 'planks_white');
    awning(a, 5, 11, 5, Z1 + 1);
    a.furn('fairy_lights', 6, 4, Z1 + 1, F, C.pink).furn('fairy_lights', 10, 4, Z1 + 1, F, C.sky);

    // inside: bunk beds, kitchenette, sofa and table, a little bathroom, driver seats
    a.put(BED_BUNK, 4, 2, 5, R, C.pink);
    a.put(BED_BUNK, 4, 2, 8, R, C.lav);
    a.put('nightstand', 4, 2, 6, R, C.white);
    a.furn('table_lamp', 4, 3, 6, F, C.pink);
    a.put('stove', 7, 2, 5, F, C.white).put('counter', 8, 2, 5, F, C.pink).put('sink_kitchen', 9, 2, 5, F, C.white);
    a.put('fridge', 10, 2, 5, F, C.pink);
    a.furn('cake_stand', 8, 3, 5, F, C.pink);
    a.put(SOFA, 11, 2, 8, B, C.lav);
    a.put('table_round', 11, 2, 6, F, C.white);
    a.furn('fruit_bowl', 11, 3, 6, F);
    a.fill(13, 2, Z0 + 1, 13, 5, Z1 - 1, 'wool_white');
    a.door(13, 2, 7, { key: 'door', rot: R, color: C.white });
    a.put('toilet', 14, 2, 5, F, C.white).put('sink_bath', 15, 2, 5, F, C.white);
    a.put('shower', 15, 2, 8, B, C.sky);
    a.put(ARMCHAIR, 16, 2, 5, R, C.pink).put(ARMCHAIR, 16, 2, 8, R, C.pink);
    a.furn('fairy_lights', 6, 5, 7, F, C.pink);
    a.furn(CEIL_LAMP, 10, 5, 7, F, C.sun);
    a.block(8, 6, 7, 'lamp_block');

    // stairs up the back to the roof deck: railing, loungers, a parasol, plants
    for (let k = 1; k <= 5; k++) a.fill(3 + k, 1, 2, 3 + k, k, 3, 'planks_white');
    a.fill(9, 1, 2, 10, 5, 3, 'planks_white');
    for (let x = X0; x <= X1; x++) for (const z of [Z0, Z1]) if (!(z === Z0 && (x === 9 || x === 10))) a.block(x, 7, z, 'wool_white');
    for (let z = Z0; z <= Z1; z++) a.block(X0, 7, z, 'wool_white').block(X1, 7, z, 'wool_white');
    a.put(BENCH, 5, 7, 8, B, C.pink).put(BENCH, 14, 7, 8, B, C.sky);
    a.put('table_round', 12, 7, 6, F, C.white);
    a.furn('plant_pot', 4, 7, 5, F, C.pink).furn('plant_pot', 16, 7, 5, F, C.mint);
    a.furn('cake_stand', 12, 8, 6, F, C.lav);
    umbrella(a, 11, 7, 7, 'wool_pink', 'wool_white');

    // pop-out pool with a slide and a float
    a.walls(12, 11, 18, 14, 1, 1, 'quartz');
    a.floor(12, 12, 17, 13, 0, 'tile_bath');
    a.fill(12, 1, 12, 17, 1, 13, 'water');
    a.furn('pool_float', 15, 1, 12, F, C.pink);
    a.fill(8, 1, 12, 8, 2, 12, 'planks_pink').block(7, 1, 12, 'planks_pink');
    a.put('slide', 9, 1, 12, R, C.pink);
    // camp fire with chairs, a lamp post, flowers
    campfire(a, 3, 12);
    a.put('chair', 1, 1, 12, R, C.sky).put('chair', 3, 1, 14, B, C.pink);
    a.furn(LANTERN, 19, 1, 9, F, C.pink);
    a.flowers(0, 0, 20, 1, 1, FLOWERS, { density: 0.35, seed: 91 });
    a.flowers(19, 2, 20, 14, 1, FLOWERS, { density: 0.4, seed: 92 });
    a.air(19, 1, 9, 19, 1, 9);
  },
};

// ---------------------------------------------------------------------------------------
// Retro Mini Trailer: a little silver trailer with a mint stripe, a cosy double bed, a tiny
// kitchen and table, a striped awning, chairs round a camp fire and a picnic blanket.
// ---------------------------------------------------------------------------------------
export const retroTrailer = {
  key: 'retro_trailer',
  name: 'Retro Trailer',
  blurb: 'A little silver trailer and a camp fire',
  size: [13, 8, 14],
  view: { inside: [7.6, 3.3, 6.2, 4, 2.3, 4.2] },
  build(a) {
    const X0 = 3, X1 = 9, Z0 = 3, Z1 = 7;
    a.fill(X0, 1, Z0, X1, 1, Z1, 'planks_oak');
    wheels(a, [7], [Z0 - 1, Z1 + 1]);
    for (let y = 2; y <= 4; y++) a.walls(X0, Z0, X1, Z1, y, y, y === 3 ? 'wool_cyan|wool_sky' : 'wool_lightgray|quartz');
    a.floor(X0 + 1, Z0, X1 - 1, Z1, 5, 'wool_lightgray|quartz');
    a.air(X0 + 1, 2, Z0 + 1, X1 - 1, 4, Z1 - 1);
    for (const x of [X0, X1]) for (const z of [Z0, Z1]) a.block(x, 4, z, 'air');
    a.fill(7, 3, Z1, 8, 3, Z1, 'glass').fill(X1, 3, 4, X1, 3, 6, 'glass').fill(X0, 3, 5, X0, 3, 5, 'glass').fill(6, 3, Z0, 7, 3, Z0, 'glass');
    a.door(5, 2, Z1, { key: 'door', color: C.mint });
    a.block(5, 1, Z1 + 1, 'planks_oak');
    a.fill(10, 1, 5, 11, 1, 5, 'planks_oak');
    awning(a, 4, 8, 5, Z1 + 1, 'wool_cyan|wool_sky', 'wool_white');
    // inside
    a.put(BED_BIG, 4, 2, 5, R, C.mint);
    a.put('counter', 7, 2, 4, F, C.mint).put('stove', 8, 2, 4, F, C.white);
    a.put('table_round', 8, 2, 6, F, C.white);
    a.put(STOOL, 7, 2, 6, R, C.pink);
    a.furn('cake_stand', 8, 3, 6, F, C.pink);
    a.furn('fairy_lights', 6, 4, 5, F, C.sun);
    // camp: fire, chairs, picnic, lamp, flowers
    campfire(a, 8, 11);
    a.put('chair', 6, 1, 11, R, C.mint).put('chair', 10, 1, 11, L, C.pink);
    a.put('picnic_blanket', 2, 1, 10, F, C.pink);
    a.furn(LANTERN, 1, 1, 6, F, C.sun);
    a.flowers(0, 0, 12, 1, 1, FLOWERS, { density: 0.4, seed: 93 });
    a.flowers(11, 2, 12, 9, 1, FLOWERS, { density: 0.4, seed: 94 });
  },
};

// ---------------------------------------------------------------------------------------
// Camper Van: a sky-blue van with a pop-up roof, a bed and a little kitchen inside,
// surfboards, a beach umbrella, chairs and a picnic outside.
// ---------------------------------------------------------------------------------------
export const camperVan = {
  key: 'camper_van',
  name: 'Camper Van',
  blurb: 'A sky-blue van with a pop-up roof',
  size: [13, 9, 14],
  view: { inside: [7.5, 3.3, 5.8, 4, 2.3, 5] },
  build(a) {
    const X0 = 3, X1 = 9, Z0 = 4, Z1 = 7;
    a.fill(X0, 1, Z0, X1, 1, Z1, 'planks_white');
    wheels(a, [4, 8], [Z0 - 1, Z1 + 1]);
    for (let y = 2; y <= 4; y++) a.walls(X0, Z0, X1, Z1, y, y, y <= 3 ? 'wool_sky' : 'wool_white');
    a.floor(X0, Z0, X1, Z1, 5, 'wool_white');
    a.air(X0 + 1, 2, Z0 + 1, X1 - 1, 4, Z1 - 1);
    // front: windscreen, a white V, headlights; side windows
    a.fill(X1, 4, Z0 + 1, X1, 4, Z1 - 1, 'glass');
    a.block(X1, 3, Z0 + 1, 'wool_white').block(X1, 3, Z1 - 1, 'wool_white').block(X1, 2, Z0 + 1, 'lamp_block').block(X1, 2, Z1 - 1, 'lamp_block');
    a.fill(4, 3, Z1, 4, 4, Z1, 'glass').fill(8, 3, Z1, 8, 4, Z1, 'glass').fill(5, 3, Z0, 7, 4, Z0, 'glass');
    a.door(6, 2, Z1, { key: 'door', color: C.sky });
    a.block(6, 1, Z1 + 1, 'planks_white');
    // pop-up roof tent
    a.fill(4, 6, Z0, 7, 6, Z1, 'wool_orange|wool_yellow');
    a.fill(4, 7, Z0 + 1, 7, 7, Z1 - 1, 'wool_orange|wool_yellow');
    a.block(4, 6, Z0 + 1, 'glass').block(4, 6, Z1 - 1, 'glass').block(7, 6, Z0 + 1, 'glass').block(7, 6, Z1 - 1, 'glass');
    // inside
    a.put('bed_single', 4, 2, 5, R, C.sky);
    a.put('counter', 7, 2, 5, F, C.white).put('stove', 8, 2, 5, F, C.white);
    a.furn('fruit_bowl', 7, 3, 5, F);
    a.put(COMFY, 5, 2, 6, R, C.pink);
    a.furn(CEIL_LAMP, 6, 4, 6, F, C.sun);
    // outside: surfboards, umbrella, picnic, chairs, flowers
    a.fill(1, 1, 5, 1, 3, 5, 'wool_pink').block(1, 2, 5, 'wool_white');
    a.fill(1, 1, 7, 1, 3, 7, 'wool_yellow').block(1, 2, 7, 'wool_sky');
    umbrella(a, 10, 1, 11, 'wool_sky', 'wool_white');
    a.put('picnic_blanket', 6, 1, 10, F, C.sky);
    a.put('chair', 4, 1, 11, R, C.pink);
    a.furn(LANTERN, 11, 1, 3, F, C.sun);
    a.flowers(0, 0, 12, 1, 1, FLOWERS, { density: 0.4, seed: 95 });
    a.flowers(0, 12, 12, 13, 1, FLOWERS, { density: 0.3, seed: 96 });
    a.air(10, 1, 13, 10, 1, 13);
  },
};
