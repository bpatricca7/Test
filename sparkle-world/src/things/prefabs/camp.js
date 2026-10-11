// Wave 2 Magic Builds: big campers you can camp in and do things inside, and a campground.
//   Sparkle Camper      a BIG pink camper with rounded ends: bunks, kitchenette, lounge,
//                       bathroom; an awning with string lights, a roof deck with railings
//                       (stairs up, a big slide down into the pop-out pool) and a camp fire
//   Retro Mini Trailer  a round mint-and-cream teardrop: cosy double bed inside, a fold-out
//                       kitchen under the lifted back hatch, a camp fire with camp chairs
//   Camper Van          a pastel van: pop-top roof bed (ladder up the back), bench seats,
//                       mini kitchen, surfboards on the roof, a parasol picnic outside
//   Campground          three tents round a camp fire ring, a picnic table, a hammock
//                       between two trees, a cooler, string lights and a little path
// Pieces from the outdoor team (tents, camp fires, bunks, string lights...) are used when they
// exist; outdoor.js has the look-alikes used without them.
// Frame reminder: x left-to-right, y up (0 = ground layer), z back (0) to front (D-1).

import { F, R, B, L, C, FLOWERS, BED_BIG, SOFA, COMFY, BENCH, LANTERN, CEIL_LAMP } from './palette.js';
import { campfire, tent, campChair, cooler, bunk, stringLights, hammock, picnicTable, rail, bigSlide, parasol, roundWindow, bushyTree } from './outdoor.js';

/**
 * A hollow body: every cell with inside(x, y, z) true becomes a shell block (key(x, y, z))
 * when it touches the outside, else air. Rounded shapes come from inside() cutting edges.
 */
function body(a, x0, y0, z0, x1, y1, z1, inside, key) {
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) {
        if (!inside(x, y, z)) continue;
        const edge = !inside(x + 1, y, z) || !inside(x - 1, y, z) || !inside(x, y + 1, z) || !inside(x, y - 1, z) || !inside(x, y, z + 1) || !inside(x, y, z - 1);
        a.block(x, y, z, edge ? key(x, y, z) : 'air');
      }
    }
  }
}

/** Chunky 2x2 wheels set into the skirt of a body (x0, x0 + 1) on both sides zs. */
function wheels(a, xs, zs) {
  for (const x of xs) for (const z of zs) a.fill(x, 0, z, x + 1, 1, z, 'wool_black|cobble');
}

/** Striped awning along x on layer y over rows z0..z1. */
function awning(a, x0, x1, y, z0, z1, c1 = 'wool_pink', c2 = 'wool_white') {
  for (let x = x0; x <= x1; x++) a.fill(x, y, z0, x, y, z1, x % 2 ? c1 : c2);
}

// ---------------------------------------------------------------------------------------
// Sparkle Camper
// ---------------------------------------------------------------------------------------
export const sparkleCamper = {
  key: 'sparkle_camper',
  name: 'Sparkle Camper',
  blurb: 'A big pink camper with a roof deck, a slide and a pool',
  size: [29, 12, 17],
  iconZoom: 0.8,
  view: {
    bunks: [11, 3.7, 7.6, 4.5, 2.7, 7],
    kitchen: [14, 3.7, 8.6, 9.5, 2.6, 5],
    bathroom: [16.4, 4, 8.9, 17.2, 2.4, 5.2],
    deck: [4.6, 8.9, 8.4, 17, 7.6, 6.2],
    front: [22, 7, 22, 10, 3, 7],
    pool: [23, 5.6, 15.4, 23, 2, 6],
  },
  build(a) {
    const X0 = 3, X1 = 18, Z0 = 4, Z1 = 10;
    const bodyKey = (x, y) => (y === 1 || y === 6 ? 'quartz' : y === 2 ? 'wool_pink' : y === 5 ? 'wool_white|quartz' : 'concrete_pink|wool_pink');
    // the body: a long box with its ends and top edges rounded off
    body(a, X0, 1, Z0, X1, 6, Z1, (x, y, z) => {
      if (x < X0 || x > X1 || z < Z0 || z > Z1 || y < 1 || y > 6) return false;
      const ex = x === X0 || x === X1, sz = z === Z0 || z === Z1;
      if (ex && sz) return false;
      if (y === 6 && (ex || sz)) return false;
      if (y === 1 && ex) return false;
      return true;
    }, bodyKey);
    wheels(a, [6, 13], [Z0, Z1]);
    // floors: white planks, a pink kitchen, a blue bathroom
    a.fill(X0 + 1, 1, Z0 + 1, X1 - 1, 1, Z1 - 1, 'planks_white');
    a.checker(8, 5, 12, 6, 1, 'tile_pink|wool_pink', 'planks_white');
    a.fill(16, 1, 5, 17, 1, 9, 'tile_bath');
    // the roof is a candy-striped deck
    for (let x = X0 + 1; x <= X1 - 1; x++) a.fill(x, 6, Z0 + 1, x, 6, Z1 - 1, x % 2 ? 'planks_pink' : 'planks_white');
    // big windows all round, a heart window by the bathroom
    a.fill(5, 3, Z1, 7, 4, Z1, 'glass_pink').fill(12, 3, Z1, 14, 4, Z1, 'glass_pink');
    a.fill(16, 4, Z1, 17, 4, Z1, 'glass_blue|glass');
    a.fill(9, 4, Z0, 12, 4, Z0, 'glass_pink').fill(5, 3, Z0, 6, 4, Z0, 'glass_pink').fill(13, 3, Z0, 14, 4, Z0, 'glass_pink');
    a.block(X0, 4, 8, 'glass_heart|glass_pink');
    a.block(X1, 4, 7, 'glass_heart|glass_pink');
    // door with a half step, striped awning
    a.door(10, 2, Z1, { key: 'door_pink|door', color: C.pink });
    a.block(10, 1, Z1 + 1, 'slab_white|slab_oak');
    awning(a, 5, 14, 5, Z1 + 1, Z1 + 2);

    // ---- inside ----
    // bunk room: two camper bunks along the end wall, a nightstand with a lamp between
    bunk(a, 4, 2, 5, R, C.pink);
    bunk(a, 4, 2, 9, R, C.lav);
    a.at('nightstand', 4, 2, 7, R, C.white);
    a.furn('table_lamp', 4, 3, 7, F, C.pink);
    a.at('rug_round|rug_heart', 6, 2, 6, F, C.lav);
    a.furn('picture_frame', 4, 4, 7, R);
    a.furn('fairy_lights', 5, 5, 7, F, C.pink);
    // kitchenette along the back
    a.at('fridge', 8, 2, 5, F, C.pink);
    a.at('counter', 9, 2, 5, F, C.pink);
    a.at('stove', 10, 2, 5, F, C.white);
    a.at('sink_kitchen', 11, 2, 5, F, C.pink);
    a.at('counter', 12, 2, 5, F, C.pink);
    a.furn('cake_stand', 9, 3, 5, F, C.pink);
    a.furn('fruit_bowl', 12, 3, 5, F);
    a.furn(CEIL_LAMP, 10, 5, 7, F, C.sun);
    // lounge: sofa, coffee table, beanbag, books, pictures
    a.at(SOFA, 12, 2, 9, B, C.lav);
    a.at('coffee_table|table_round', 12, 2, 8, F, C.white);
    a.furn('candle', 12, 3, 8, F, C.pink);
    a.at(COMFY, 14, 2, 9, B, C.pink);
    a.at('bookshelf', 13, 2, 5, F, C.white).at('bookshelf', 14, 2, 5, F, C.white);
    a.furn('plant_pot', 13, 3, 5, F, C.mint).furn('teddy_bear', 14, 3, 5, F);
    a.furn('picture_frame', 13, 4, 5, F).furn('clock', 14, 4, 8, L);
    // bathroom behind a white wall: shower, toilet, sink, towels
    a.fill(15, 2, 5, 15, 5, 9, 'wool_white|quartz');
    a.door(15, 2, 7, { key: 'door', rot: L, color: C.white });
    a.at('shower', 17, 2, 5, L, C.sky);
    a.at('sink_bath', 16, 2, 5, F, C.white);
    a.at('toilet', 17, 2, 9, L, C.white);
    a.furn('towel_rack', 16, 3, 9, B, C.pink);
    a.at('bath_mat', 16, 2, 7, F, C.pink);
    a.furn(CEIL_LAMP, 16, 5, 7, F, C.white);

    // ---- stairs up the left end to the roof deck (open steps on white posts) ----
    for (let k = 1; k <= 5; k++) {
      const z = 12 - k;
      a.fill(1, k, z, 2, k, z, 'planks_pink');
      if (k > 1 && k % 2 === 1) a.fill(1, 1, z, 1, k - 1, z, 'quartz_pillar|planks_white');
    }
    a.fill(1, 6, 5, 3, 6, 6, 'planks_pink');
    a.fill(1, 1, 5, 1, 5, 5, 'quartz_pillar|planks_white');
    a.block(1, 7, 5, 'lantern');
    // roof deck: railings, parasol, beanbags, a table with cake, plants
    rail(a, 5, 5, 17, 5, 7, C.white);
    rail(a, 4, 9, 17, 9, 7, C.white);
    rail(a, 4, 7, 4, 8, 7, C.white);
    rail(a, 17, 6, 17, 6, 7, C.white);
    rail(a, 17, 8, 17, 8, 7, C.white);
    parasol(a, 11, 7, 7, 'wool_pink', 'wool_white');
    a.at(COMFY, 8, 7, 7, R, C.pink).at(COMFY, 14, 7, 7, L, C.sky);
    a.at('table_round', 12, 7, 8, F, C.white);
    a.furn('cake_stand', 12, 8, 8, F, C.lav);
    a.furn('plant_pot', 5, 7, 6, F, C.pink).furn('plant_pot', 16, 7, 6, F, C.mint);
    // landing over the pool rim and the big slide down into the water
    a.fill(18, 6, 6, 19, 6, 8, 'quartz');
    a.fill(19, 3, 6, 19, 5, 6, 'quartz_pillar|quartz').fill(19, 3, 8, 19, 5, 8, 'quartz_pillar|quartz');
    rail(a, 18, 6, 19, 6, 7, C.white);
    rail(a, 18, 8, 19, 8, 7, C.white);
    bigSlide(a, 20, 7, 7, R, C.pink);

    // ---- pop-out pool ----
    a.floor(19, 4, 27, 10, 0, 'tile_bath');
    a.walls(19, 4, 27, 10, 1, 2, 'quartz');
    a.fill(20, 1, 5, 26, 2, 9, 'water');
    a.block(23, 1, 11, 'quartz');
    a.furn('pool_float', 24, 2, 6, F, C.pink, { water: true });
    a.furn('pool_float', 22, 2, 9, F, C.sky, { water: true });
    a.at(COMFY, 21, 1, 12, B, C.sky).at(COMFY, 25, 1, 12, B, C.pink);
    parasol(a, 27, 1, 13, 'wool_sky', 'wool_white');

    // ---- patio: string lights under the awning, a camp fire with chairs, a cooler ----
    stringLights(a, 12, 1, 12, F, C.white);
    a.furn(LANTERN, 5, 1, 12, F, C.sky);
    campfire(a, 7, 1, 14);
    campChair(a, 5, 1, 14, R, C.pink);
    campChair(a, 9, 1, 14, L, C.sky);
    campChair(a, 7, 1, 16, B, C.lav);
    cooler(a, 11, 1, 15, F, C.sky);
    a.furn(LANTERN, 3, 1, 13, F, C.pink);
    a.flowers(0, 0, 28, 2, 1, FLOWERS, { density: 0.3, seed: 91 });
    a.flowers(0, 12, 4, 16, 1, FLOWERS, { density: 0.35, seed: 92 });
    a.flowers(16, 13, 20, 16, 1, FLOWERS, { density: 0.35, seed: 93 });
    a.air(3, 1, 13, 3, 2, 13);
  },
};

// ---------------------------------------------------------------------------------------
// Retro Mini Trailer: a round teardrop in mint and cream. A cosy double bed, a lamp, fairy
// lights and a rug inside; the back hatch lifts up over a fold-out kitchen; a camp fire with
// camp chairs, string lights, a cooler and a picnic outside.
// ---------------------------------------------------------------------------------------
const TEAR = [3, 4, 5, 5, 5, 5, 5, 4, 4, 3]; // top layer of each column x = 3..12

export const retroTrailer = {
  key: 'retro_trailer',
  name: 'Retro Mini Trailer',
  blurb: 'A round little trailer with a fold-out kitchen',
  size: [17, 8, 18],
  iconZoom: 0.82,
  view: { front: [14.5, 5.2, 19.5, 7, 2.6, 7], inside: [9.6, 3.4, 7.6, 4.4, 2.3, 6.8], kitchen: [15.2, 3.4, 7, 11, 2.3, 7], camp: [12, 3.4, 16.5, 6, 1.4, 12] },
  build(a) {
    const X0 = 3, X1 = 12, Z0 = 5, Z1 = 9;
    const top = (x) => TEAR[x - X0];
    const inside = (x, y, z) => x >= X0 && x <= X1 && z >= Z0 && z <= Z1 && y >= 1 && y <= top(x) && !((x === X0 || x === X1) && (z === Z0 || z === Z1));
    // teardrop body: a white chassis, a cream belly band, mint panels and a white roof cap
    body(a, X0, 1, Z0, X1, 6, Z1, inside, (x, y, z) => {
      if (y === 1) return 'wool_white|quartz';
      if (y === top(x) && z !== Z0 && z !== Z1) return 'wool_white|quartz';
      return y === 2 ? 'concrete_yellow|wool_yellow' : 'concrete_mint|wool_lime';
    });
    a.fill(X0 + 1, 1, Z0 + 1, X1 - 1, 1, Z1 - 1, 'planks_oak');
    wheels(a, [7], [Z0, Z1]);
    // hitch
    a.fill(1, 1, 7, 2, 1, 7, 'wool_lightgray|cobble');
    // porthole windows and a door
    roundWindow(a, 9, 3, Z1, 'x', 'glass_mint|glass');
    roundWindow(a, 7, 3, Z0, 'x', 'glass_mint|glass');
    a.door(6, 2, Z1, { key: 'door', color: C.mint });
    a.block(6, 1, Z1 + 1, 'slab_white|slab_oak');
    // the back hatch lifts up over the kitchen
    a.air(X1, 2, Z0 + 1, X1, 3, Z1 - 1);
    a.fill(X1, 4, Z0, X1 + 1, 4, Z1, 'concrete_mint|wool_lime');
    a.fill(X1 + 1, 4, Z0 + 1, X1 + 1, 4, Z1 - 1, 'quartz');
    a.block(X1 + 1, 3, Z0, 'lantern').block(X1 + 1, 3, Z1, 'lantern');

    // inside: double bed, nightstand + lamp, rug, beanbag, fairy lights, a picture
    a.at(BED_BIG, 4, 2, 6, R, C.mint);
    a.at('nightstand', 4, 2, 8, R, C.white);
    a.furn('table_lamp', 4, 3, 8, F, C.pink);
    a.at('rug_round|rug_heart', 7, 2, 6, F, C.pink);
    a.at(COMFY, 9, 2, 8, L, C.pink);
    a.furn('fairy_lights', 7, 4, 7, F, C.sun);
    a.furn('picture_frame', 10, 3, 6, F);
    // fold-out kitchen facing out of the back
    a.at('counter', 11, 2, 6, R, C.mint);
    a.at('stove', 11, 2, 7, R, C.white);
    a.at('sink_kitchen', 11, 2, 8, R, C.mint);
    a.furn('fruit_bowl', 11, 3, 6, F);

    // camp: fire, camp chairs, string lights, cooler, picnic, lamp, flowers
    campfire(a, 7, 1, 14);
    campChair(a, 5, 1, 14, R, C.mint);
    campChair(a, 9, 1, 14, L, C.pink);
    campChair(a, 7, 1, 16, B, C.sun);
    stringLights(a, 2, 1, 12, F, C.white);
    cooler(a, 10, 1, 12, F, C.mint);
    a.at('picnic_blanket', 12, 1, 14, F, C.pink);
    a.furn(LANTERN, 15, 1, 11, F, C.sun);
    a.flowers(0, 0, 16, 2, 1, FLOWERS, { density: 0.4, seed: 93 });
    a.flowers(14, 3, 16, 10, 1, FLOWERS, { density: 0.35, seed: 94 });
    a.air(15, 1, 11, 15, 2, 11);
  },
};

// ---------------------------------------------------------------------------------------
// Camper Van: a long sky-and-white van with a big windscreen and heart tail lights. A low
// striped roof tent with a cosy bed (ladder up the back), bench seats round a table, a mini
// kitchen, driver seats; surfboards on the roof; a parasol picnic and string lights outside.
// ---------------------------------------------------------------------------------------
export const camperVan = {
  key: 'camper_van',
  name: 'Camper Van',
  blurb: 'A pastel van with a roof tent bed and surfboards',
  size: [17, 9, 16],
  iconZoom: 0.82,
  view: { front: [16.6, 5.6, 16.8, 8, 3, 7], inside: [11.4, 3.6, 7.5, 3.5, 2.4, 7], rooftent: [1.4, 6.6, 7, 6.5, 6.1, 7], camp: [13, 3.4, 15, 6, 1.3, 11] },
  build(a) {
    const X0 = 2, X1 = 14, Z0 = 5, Z1 = 9;
    body(a, X0, 1, Z0, X1, 5, Z1, (x, y, z) => {
      if (x < X0 || x > X1 || z < Z0 || z > Z1 || y < 1 || y > 5) return false;
      const ex = x === X0 || x === X1, sz = z === Z0 || z === Z1;
      if (ex && sz) return false;
      if (y === 5 && (ex || sz)) return false;
      return true;
    }, (x, y) => (y <= 3 ? 'concrete_sky|wool_sky' : 'wool_white|quartz'));
    a.fill(X0 + 1, 1, Z0 + 1, X1 - 1, 1, Z1 - 1, 'planks_oak');
    wheels(a, [4, 11], [Z0, Z1]);
    // front: a big windscreen, headlights, a white bumper; back: heart tail lights, a window
    a.fill(X1, 3, 6, X1, 4, 8, 'glass');
    a.block(X1, 2, 6, 'lamp_block').block(X1, 2, 8, 'lamp_block').block(X1, 2, 7, 'wool_white|quartz');
    a.fill(X1, 1, 6, X1, 1, 8, 'wool_white|quartz');
    a.block(X0, 2, 6, 'heart_lamp|lamp_block').block(X0, 2, 8, 'heart_lamp|lamp_block');
    a.block(X0, 4, 7, 'glass');
    // a band of windows all round and the side door with a step
    a.fill(3, 4, Z1, 6, 4, Z1, 'glass').fill(10, 4, Z1, 12, 4, Z1, 'glass');
    a.fill(3, 4, Z0, 12, 4, Z0, 'glass');
    a.door(8, 2, Z1, { key: 'door', color: C.sky });
    a.block(8, 1, Z1 + 1, 'slab_white|slab_oak');

    // roof tent on the back half of the roof: striped canvas, a cosy bed inside, a little door
    // at the back (climb the ladder and tap the bed to snuggle in)
    for (let x = 3; x <= 8; x++) {
      const k = x % 2 ? 'wool_yellow' : 'wool_white';
      a.block(x, 6, Z0 + 1, k).block(x, 6, Z1 - 1, k);
      a.fill(x, 7, Z0 + 1, x, 7, Z1 - 1, x % 2 ? 'wool_pink' : 'wool_white');
    }
    a.block(3, 6, 7, 'air').block(8, 6, 7, 'glass');
    a.block(6, 6, Z0 + 1, 'glass').block(6, 6, Z1 - 1, 'glass');
    a.at('bed_single|bed_double', 4, 6, 7, R, C.sky);
    a.furn(CEIL_LAMP, 7, 6, 7, F, C.pink);
    for (let y = 1; y <= 4; y++) a.furn('ladder', 1, y, 7, L, C.white);
    // surfboards on the front of the roof
    a.fill(10, 6, 6, 13, 6, 6, 'carpet_pink').block(11, 6, 6, 'carpet_white');
    a.fill(10, 6, 8, 13, 6, 8, 'carpet_yellow').block(12, 6, 8, 'carpet_sky');

    // inside: benches round a table, a rug, mini kitchen with a fridge, driver seats, a lamp
    a.at(BENCH, 3, 2, 6, F, C.pink);
    a.at(BENCH, 3, 2, 8, B, C.pink);
    a.at('table_round', 3, 2, 7, F, C.white);
    a.furn('cake_stand', 3, 3, 7, F, C.sky);
    a.at('rug_round|rug_heart', 5, 2, 7, F, C.lav);
    a.at('counter', 8, 2, 6, F, C.sky);
    a.at('stove', 9, 2, 6, F, C.white);
    a.at('sink_kitchen', 10, 2, 6, F, C.sky);
    a.at('fridge', 11, 2, 6, F, C.pink);
    a.furn('fruit_bowl', 8, 3, 6, F);
    a.at('armchair|chair', 13, 2, 6, R, C.sun).at('armchair|chair', 13, 2, 8, R, C.sun);
    a.furn(CEIL_LAMP, 7, 4, 7, F, C.sun);

    // outside: parasol picnic, camp chairs, string lights, a lamp
    parasol(a, 3, 1, 13, 'wool_sky', 'wool_white');
    a.at('picnic_blanket', 5, 1, 12, F, C.sky);
    campChair(a, 9, 1, 12, L, C.pink);
    campChair(a, 14, 1, 12, L, C.mint);
    stringLights(a, 12, 1, 2, F, C.white);
    a.furn(LANTERN, 16, 1, 7, F, C.sun);
    a.flowers(0, 0, 16, 1, 1, FLOWERS, { density: 0.35, seed: 95 });
    a.flowers(0, 14, 16, 15, 1, FLOWERS, { density: 0.3, seed: 96 });
  },
};

// ---------------------------------------------------------------------------------------
// Campground: a little path leads in to a camp fire ring with camp chairs and a log bench;
// three pastel tents face the fire; a picnic table with a cooler; a hammock slung between
// two trees; string lights; trees, flowers and a bird house all round.
// ---------------------------------------------------------------------------------------
export const campground = {
  key: 'campground',
  name: 'Campground',
  blurb: 'Tents round a camp fire, a hammock and a picnic',
  size: [26, 11, 22],
  iconZoom: 0.8,
  view: { front: [21, 9, 27, 12, 1, 10], fire: [13, 3.4, 17, 13, 1.2, 8], tents: [18, 3.8, 14.5, 6, 1.6, 9], hammock: [4, 3.2, 21.2, 4, 1.4, 16.5] },
  build(a) {
    const FX = 13, FZ = 10;
    a.flowers(0, 0, 25, 21, 1, FLOWERS, { density: 0.1, seed: 97 });
    // the path in from the front, and round the fire ring (nothing growing on it)
    const path = (x0, z0, x1, z1) => a.fill(x0, 0, z0, x1, 0, z1, 'path|gravel').air(x0, 1, z0, x1, 1, z1);
    path(FX, FZ + 3, FX, 21);
    for (const [x0, z0, x1, z1] of [[FX - 3, FZ - 3, FX + 3, FZ - 3], [FX - 3, FZ + 3, FX + 3, FZ + 3], [FX - 3, FZ - 3, FX - 3, FZ + 3], [FX + 3, FZ - 3, FX + 3, FZ + 3]]) path(x0, z0, x1, z1);
    for (const [x0, z0, x1, z1] of [[7, FZ, FX - 4, FZ], [FX + 4, FZ, 19, FZ], [FX, 5, FX, FZ - 4], [FX + 1, 16, 17, 16]]) path(x0, z0, x1, z1);
    a.air(FX - 2, 1, FZ - 2, FX + 2, 1, FZ + 2);
    campfire(a, FX, 1, FZ);
    // seats round the fire
    campChair(a, FX - 2, 1, FZ, R, C.pink);
    campChair(a, FX + 2, 1, FZ, L, C.sky);
    campChair(a, FX - 1, 1, FZ + 2, B, C.mint);
    campChair(a, FX + 1, 1, FZ + 2, B, C.lav);
    a.at(BENCH, FX - 1, 1, FZ - 2, F, C.wood);
    // three tents facing the fire
    tent(a, 5, 1, 9, R, C.pink, 'wool_pink');
    tent(a, 12, 1, 3, F, C.lav, 'wool_purple');
    tent(a, 20, 1, 9, L, C.mint, 'wool_lime');
    // picnic table with a cooler and a cake
    picnicTable(a, 17, 1, 14, F, C.pink);
    a.furn('cake_stand', 17, 2, 14, F, C.pink);
    cooler(a, 19, 1, 15, L, C.sky);
    // hammock between two trees
    hammock(a, 3, 1, 17, F, C.pink);
    bushyTree(a, 2, 1, 17, 5, 'leaves_oak', 'log_oak', 2.2);
    bushyTree(a, 6, 1, 17, 5, 'leaves_cherry', 'log_oak', 2.2);
    // string lights, lamps at the way in
    stringLights(a, 8, 1, 14, F, C.white);
    a.furn(LANTERN, 17, 1, 6, F, C.lav);
    a.furn(LANTERN, FX - 1, 1, 19, F, C.pink).furn(LANTERN, FX + 1, 1, 19, F, C.sky);
    // a log arch over the way in with a lantern
    a.fill(FX - 2, 1, 21, FX - 2, 4, 21, 'log_oak').fill(FX + 2, 1, 21, FX + 2, 4, 21, 'log_oak');
    a.fill(FX - 3, 5, 21, FX + 3, 5, 21, 'log_oak');
    a.fill(FX - 1, 5, 21, FX + 1, 5, 21, 'planks_pink').block(FX, 6, 21, 'heart_lamp|lantern').block(FX, 4, 21, 'lantern');
    // woods and flowers all round, a woodpile and a bird house
    for (const [x, z, leaves, h] of [[2, 3, 'leaves_birch|leaves_oak', 6], [23, 3, 'leaves_oak', 5], [23, 17, 'leaves_cherry', 5], [8, 2, 'leaves_oak', 5], [18, 2, 'leaves_birch|leaves_oak', 6], [23, 12, 'leaves_oak', 4]]) {
      bushyTree(a, x, 1, z, h, leaves, leaves.startsWith('leaves_birch') ? 'log_birch' : 'log_oak', 2.1);
    }
    a.fill(20, 1, 4, 21, 1, 4, 'log_oak').block(20, 2, 4, 'log_oak');
    a.furn('bird_house', 22, 1, 13, L, C.sky);
  },
};
