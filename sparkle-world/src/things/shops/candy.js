// Candy Shop treats: twenty cute voxel candies (vertex-colored, baked once into shared
// geometry with the life team's Kit, like every other food). Each draw function builds the
// candy standing on y = 0, centred on x / z, about half a block wide, so it looks right in the
// basket pictures, on a table and in her hand.
//
//   CANDY: [{ key, name, plural, price, color, hand? }]   (key = basket / FOOD key, 'treat_*')
//   CANDY_DRAW[key](kit)                                   draws the model
//   hand: how she holds it ({ rot: [x, y, z], y, s }: turned, lifted, scaled in her hand)

import * as THREE from 'three';

export const CANDY = [
  { key: 'treat_lollipop', name: 'Lollipop', plural: 'Lollipops', price: 3, color: '#FF7EB8' },
  { key: 'treat_rainbow_lollipop', name: 'Rainbow Lollipop', plural: 'Rainbow Lollipops', price: 6, color: '#FFD27A' },
  { key: 'treat_cotton_candy_pink', name: 'Pink Cotton Candy', plural: 'Pink Cotton Candies', price: 5, color: '#FFB8DE' },
  { key: 'treat_cotton_candy_blue', name: 'Blue Cotton Candy', plural: 'Blue Cotton Candies', price: 5, color: '#A8DDFF' },
  { key: 'treat_gummy_bears', name: 'Gummy Bears', plural: 'Gummy Bears', price: 4, color: '#FF6B8A' },
  { key: 'treat_jelly_beans', name: 'Jelly Beans', plural: 'Jelly Beans', price: 3, color: '#9BE58A' },
  { key: 'treat_chocolate_bar', name: 'Chocolate Bar', plural: 'Chocolate Bars', price: 5, color: '#8B5A3C', hand: { rot: [0, -Math.PI / 2, -Math.PI / 2], y: 0.1, s: 1 } },
  { key: 'treat_candy_cane', name: 'Candy Cane', plural: 'Candy Canes', price: 3, color: '#FF4F6D' },
  { key: 'treat_gumdrops', name: 'Gumdrops', plural: 'Gumdrops', price: 3, color: '#B892FF' },
  { key: 'treat_rock_candy', name: 'Rock Candy', plural: 'Rock Candies', price: 7, color: '#D6B8FF' },
  { key: 'treat_taffy', name: 'Taffy', plural: 'Taffies', price: 4, color: '#FFB3D1' },
  { key: 'treat_candy_apple', name: 'Candy Apple', plural: 'Candy Apples', price: 8, color: '#FF3B5C', hand: { rot: [Math.PI, 0, 0], y: 0.46, s: 0.95 } },
  { key: 'treat_macarons', name: 'Macarons', plural: 'Macarons', price: 9, color: '#BDF2DA' },
  { key: 'treat_sprinkle_donut', name: 'Sprinkle Donut', plural: 'Sprinkle Donuts', price: 6, color: '#FF9ACB', hand: { rot: [1.25, 0, 0], y: 0.13, s: 1 } },
  { key: 'treat_marshmallow', name: 'Marshmallows', plural: 'Marshmallows', price: 3, color: '#FFE3F0' },
  { key: 'treat_sour_straws', name: 'Sour Straws', plural: 'Sour Straws', price: 4, color: '#FFE27A' },
  { key: 'treat_bubblegum', name: 'Bubblegum', plural: 'Bubblegum', price: 5, color: '#FF8FD0' },
  { key: 'treat_caramel', name: 'Caramels', plural: 'Caramels', price: 4, color: '#E9A13B' },
  { key: 'treat_heart_chocolates', name: 'Heart Chocolates', plural: 'Heart Chocolates', price: 15, color: '#FF4F7A' },
  { key: 'treat_cake_pop', name: 'Cake Pop', plural: 'Cake Pops', price: 6, color: '#FF9CCB' },
];

export const RAINBOW = ['#FF5A7A', '#FF9F43', '#FFD93D', '#6BD968', '#5BB8FF', '#A77BFF'];
export const SPRINKLE_COLORS = ['#FF5FA2', '#FFC94D', '#3FD8B0', '#6CC6FF', '#9C7BFF', '#FFFFFF'];

/** Seeded random numbers (the same candy always looks the same). */
export function rng(seed = 1) {
  let s = seed % 2147483647 || 1;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

// ---------- shared pieces ----------

const torusGeos = new Map();
/** A flat ring (torus around the Y axis) as a Kit part: radius R, tube = R * tube. */
export function torus(k, R, tube, color, x, y, z, sy = 1, rot = null) {
  const key = Math.round(tube * 100);
  let g = torusGeos.get(key);
  if (!g) {
    g = new THREE.TorusGeometry(1, key / 100, 10, 22).rotateX(Math.PI / 2);
    torusGeos.set(key, g);
  }
  k.parts.push({ g, color, cx: x, cy: y, cz: z, sx: R, sy: R * sy, sz: R, rot });
  return k;
}

/** Tiny sprinkles scattered on a round top (centre cx,cy,cz, radius r). */
export function sprinkles(k, n, cx, cy, cz, r, seed = 3, colors = SPRINKLE_COLORS, size = 1) {
  const rnd = rng(seed);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd()) * r;
    k.cbox(0.026 * size, 0.012 * size, 0.012 * size, colors[i % colors.length], cx + Math.cos(a) * d, cy, cz + Math.sin(a) * d, [0, rnd() * 3, 0]);
  }
}

/** Sprinkles on the upper half of a ball (centre, radius). */
export function ballSprinkles(k, n, cx, cy, cz, r, seed = 5, colors = SPRINKLE_COLORS, minUp = 0.25) {
  const rnd = rng(seed);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, up = minUp + rnd() * (1 - minUp);
    const h = Math.sqrt(1 - up * up);
    k.cbox(0.024, 0.011, 0.011, colors[i % colors.length], cx + Math.cos(a) * h * r, cy + up * r, cz + Math.sin(a) * h * r, [rnd() * 3, rnd() * 3, 0]);
  }
}

/** Little white sugar sparkles on the surface of a ball. */
function sugar(k, n, cx, cy, cz, r, seed = 9, minUp = -0.2) {
  const rnd = rng(seed);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, up = minUp + rnd() * (1 - minUp);
    const h = Math.sqrt(Math.max(0, 1 - up * up));
    k.cbox(0.012, 0.012, 0.012, '#FFFFFF', cx + Math.cos(a) * h * r, cy + up * r, cz + Math.sin(a) * h * r, [rnd(), rnd(), rnd()]);
  }
}

function stick(k, h, x = 0, y = 0, z = 0, color = '#FFFDF8', r = 0.014) {
  k.cyl(r, h, color, x, y, z, 8);
}

/** A little paper candy cup (pleated) with room for a heap of candy on top. */
function candyCup(k, color, r = 0.13, h = 0.07) {
  k.cyl(r * 0.75, h, color, 0, 0, 0, 16, null, 1.33);
  const n = 16;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    k.cbox(0.02, h * 0.95, 0.012, i % 2 ? '#FFFFFF' : color, Math.cos(a) * r * 0.9, h / 2, Math.sin(a) * r * 0.9, [0, -a, -0.25]);
  }
  k.cyl(r * 0.9, 0.012, '#FFF8FC', 0, h - 0.01, 0, 16);
}

/** A bow tie (two loops and a knot) facing +z at (x, y, z). */
function bow(k, color, x, y, z, s = 1) {
  k.cbox(0.07 * s, 0.05 * s, 0.025 * s, color, x - 0.035 * s, y, z, [0, 0, 0.45]);
  k.cbox(0.07 * s, 0.05 * s, 0.025 * s, color, x + 0.035 * s, y, z, [0, 0, -0.45]);
  k.ball(0.02 * s, color, x, y, z + 0.004, 8);
}

/** A disc facing +z (a lollipop head): centre (x, y, z), radius r, thickness t. */
function disc(k, r, t, color, x, y, z, seg = 20) {
  k.cyl(r, t, color, x, y - t / 2, z, seg, [Math.PI / 2, 0, 0]);
}

/** A white spiral of dots on a disc (both faces). */
function spiral(k, cx, cy, cz, rMax, t, color = '#FFFFFF', turns = 2.6, size = 0.024) {
  const steps = Math.round(turns * 14);
  for (let i = 2; i < steps; i++) {
    const u = i / steps, a = u * turns * Math.PI * 2, r = u * rMax;
    k.cbox(size, size, t, color, cx + Math.cos(a) * r, cy + Math.sin(a) * r, cz, [0, 0, a]);
  }
}

/** A small gummy bear sitting up (facing +z). */
function gummyBear(k, color, x, y, z, s = 1, ry = 0) {
  const c = Math.cos(ry), sn = Math.sin(ry);
  const at = (dx, dz) => [x + dx * c + dz * sn, z - dx * sn + dz * c];
  let [px, pz] = at(0, 0);
  k.ball(0.034 * s, color, px, y + 0.035 * s, pz, 10, [1, 1.15, 0.85]);
  k.ball(0.028 * s, color, px, y + 0.088 * s, pz, 10);
  for (const sx of [-1, 1]) {
    [px, pz] = at(sx * 0.022 * s, 0);
    k.ball(0.011 * s, color, px, y + 0.113 * s, pz, 6);
    [px, pz] = at(sx * 0.033 * s, 0.012 * s);
    k.ball(0.013 * s, color, px, y + 0.045 * s, pz, 6);
    [px, pz] = at(sx * 0.02 * s, 0.02 * s);
    k.ball(0.014 * s, color, px, y + 0.012 * s, pz, 6);
  }
}

/** A wrapped sweet lying along its local x (turned ry): candy body, paper twists both ends. */
function wrappedSweet(k, color, stripe, x, y, z, ry, paper, square = false) {
  const c = Math.cos(ry), s = Math.sin(ry);
  const at = (d) => [x + d * c, z - d * s];
  const w = square ? 0.085 : 0.11, h = square ? 0.075 : 0.06;
  k.cbox(w, h, h, color, x, y, z, [0, ry, 0]);
  k.cbox(w * 0.9, h * 0.25, h + 0.004, stripe, x, y + h * 0.18, z, [0, ry, 0]);
  if (square) k.cbox(w * 0.8, 0.01, h * 0.8, stripe, x, y + h / 2, z, [0, ry, 0]);
  for (const sd of [-1, 1]) {
    let [px, pz] = at(sd * (w / 2 + 0.012));
    k.cbox(0.02, h * 0.55, h * 0.55, paper, px, y, pz, [0, ry, 0]);
    [px, pz] = at(sd * (w / 2 + 0.035));
    k.cbox(0.02, h * 1.25, h * 1.2, paper, px, y, pz, [0.35 * sd, ry, 0]);
  }
}

// ---------- the candies ----------

export const CANDY_DRAW = {
  treat_lollipop(k) {
    stick(k, 0.3);
    disc(k, 0.125, 0.05, '#FF7EB8', 0, 0.42, 0);
    k.cyl(0.128, 0.036, '#FF9CCB', 0, 0.42 - 0.018, 0, 20, [Math.PI / 2, 0, 0]);
    spiral(k, 0, 0.42, 0, 0.118, 0.056, '#FFFFFF', 2.4, 0.026);
    bow(k, '#9C7BFF', 0, 0.29, 0.02, 0.9);
  },
  treat_rainbow_lollipop(k) {
    stick(k, 0.3, 0, 0, 0, '#FFFFFF', 0.016);
    const R = 0.155;
    RAINBOW.forEach((c, i) => {
      const r = R * (1 - i / RAINBOW.length) + 0.012;
      disc(k, r, 0.05 + i * 0.004, c, 0, 0.46, 0, 24);
    });
    spiral(k, 0, 0.46, 0, R * 0.95, 0.078, '#FFFFFF', 3, 0.02);
    bow(k, '#FF5FA2', 0, 0.31, 0.022, 1);
  },
  treat_cotton_candy_pink(k) { cottonCandy(k, ['#FFB8DE', '#FFD1EC', '#FF9FD2', '#FFC6E6'], '#FF8CC6'); },
  treat_cotton_candy_blue(k) { cottonCandy(k, ['#A8DDFF', '#C9EBFF', '#8FCBFF', '#B8E6FF'], '#6CC6FF'); },
  treat_gummy_bears(k) {
    candyCup(k, '#FFB6D9', 0.13, 0.08);
    const cols = ['#FF5A7A', '#FFB020', '#6BD968', '#FFD93D', '#FF8FD0', '#A77BFF'];
    const spots = [[-0.05, 0.075, 0.02, 0.3], [0.05, 0.075, 0.025, -0.3], [0, 0.08, -0.05, 0], [0.0, 0.14, 0.0, 0.1], [-0.07, 0.07, -0.05, 0.6], [0.07, 0.07, -0.04, -0.6]];
    spots.forEach(([x, y, z, ry], i) => gummyBear(k, cols[i], x, y, z, 1.05, ry));
  },
  treat_jelly_beans(k) {
    // a striped paper bag of beans, heaped
    k.box(0.2, 0.17, 0.14, '#FFFFFF', -0.1, 0, -0.07);
    for (let i = 0; i < 5; i++) k.box(0.022, 0.17, 0.142, '#FF8FB1', -0.09 + i * 0.043, 0, -0.071);
    k.box(0.12, 0.06, 0.004, '#FFFFFF', -0.06, 0.06, 0.071);
    k.box(0.05, 0.03, 0.004, '#FF5FA2', -0.025, 0.075, 0.073);
    const rnd = rng(21);
    const cols = ['#FF5A7A', '#FFB020', '#FFD93D', '#6BD968', '#5BB8FF', '#A77BFF', '#FF8FD0', '#FFFFFF'];
    for (let i = 0; i < 26; i++) {
      const a = rnd() * Math.PI * 2, d = Math.sqrt(rnd());
      const x = Math.cos(a) * d * 0.085, z = Math.sin(a) * d * 0.06;
      const y = 0.18 + (1 - d) * 0.06 + rnd() * 0.015;
      k.ball(0.022, cols[i % cols.length], x, y, z, 8, [1.45, 0.9, 0.9]);
    }
  },
  treat_chocolate_bar(k) {
    // lying flat, half unwrapped: gold foil and a pink wrapper with a heart
    k.box(0.3, 0.035, 0.16, '#6B3E22', -0.15, 0, -0.08);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) k.box(0.068, 0.02, 0.064, '#8B5A3C', -0.14 + i * 0.075, 0.035, -0.07 + j * 0.074);
    k.box(0.03, 0.058, 0.168, '#FFD36B', 0.075, -0.003, -0.084);
    k.box(0.1, 0.062, 0.172, '#FF8FC8', 0.1, -0.004, -0.086);
    k.box(0.1, 0.004, 0.172, '#FFFFFF', 0.1, 0.058, -0.086);
    for (const [x, z] of [[0.13, -0.015], [0.16, -0.015], [0.145, 0.0], [0.13, 0.0], [0.16, 0.0], [0.145, 0.015]]) k.box(0.016, 0.006, 0.016, '#FF3B7F', x, 0.06, z);
  },
  treat_candy_cane(k) {
    const r = 0.03, n = 10, h = 0.3;
    for (let i = 0; i < n; i++) k.cyl(r, h / n, i % 2 ? '#FFFFFF' : '#FF3B5C', 0, (i * h) / n, 0, 12, [0, 0, (i % 2 ? 1 : -1) * 0.12]);
    // the hook
    const R = 0.075, m = 11;
    for (let i = 0; i <= m; i++) {
      const a = (i / m) * Math.PI * 1.15;
      k.ball(r * 1.02, i % 2 ? '#FFFFFF' : '#FF3B5C', -R + Math.cos(a) * R, h + Math.sin(a) * R, 0, 10);
    }
    bow(k, '#3FB86A', 0, h - 0.03, r * 0.9, 0.95);
  },
  treat_gumdrops(k) {
    candyCup(k, '#E6DDFF', 0.13, 0.06);
    const cols = ['#FF5A7A', '#6BD968', '#FFD93D', '#FF9F43', '#A77BFF', '#5BB8FF'];
    const spots = [[-0.055, 0.06, 0.035], [0.06, 0.06, 0.035], [0, 0.06, -0.06], [-0.07, 0.06, -0.045], [0.07, 0.06, -0.04], [0.0, 0.13, 0.0]];
    spots.forEach(([x, y, z], i) => {
      k.cyl(0.058, 0.07, cols[i], x, y, z, 14, null, 0.6);
      k.ball(0.036, cols[i], x, y + 0.07, z, 10, [1, 0.7, 1]);
      sugar(k, 9, x, y + 0.045, z, 0.054, 30 + i, 0);
    });
  },
  treat_rock_candy(k) {
    stick(k, 0.46, 0, 0, 0, '#E7BE8C', 0.013);
    const rnd = rng(77);
    const cols = ['#C9A2FF', '#FF9CCB', '#9FD8FF', '#E3C6FF', '#FFB8E6', '#B6A0FF'];
    for (let i = 0; i < 34; i++) {
      const y = 0.13 + (i / 34) * 0.27 + rnd() * 0.02, a = i * 2.4 + rnd(), d = 0.035 + rnd() * 0.03;
      const s = 0.045 + rnd() * 0.035;
      k.cbox(s * 0.8, s * 1.3, s * 0.8, cols[i % cols.length], Math.cos(a) * d, y, Math.sin(a) * d, [rnd() * 1.2, rnd() * 3, rnd() * 1.2]);
    }
    for (let i = 0; i < 14; i++) {
      const y = 0.14 + rnd() * 0.26, a = rnd() * Math.PI * 2;
      k.cbox(0.014, 0.014, 0.014, '#FFFFFF', Math.cos(a) * 0.085, y, Math.sin(a) * 0.085, [rnd(), rnd(), 0]);
    }
  },
  treat_taffy(k) {
    k.cyl(0.15, 0.016, '#FFFFFF', 0, 0, 0, 18);
    k.cyl(0.14, 0.018, '#FFF3B0', 0, 0, 0, 18);
    const pieces = [['#FFB3D1', '#FFFFFF', -0.04, 0.05, 0.05, 0.5], ['#BDF2DA', '#FFFFFF', 0.05, 0.05, -0.03, -0.4], ['#FFE27A', '#FF8FB1', 0.0, 0.1, 0.0, 1.4], ['#C9B6FF', '#FFFFFF', -0.05, 0.05, -0.07, 1.9]];
    for (const [c, stripe, x, y, z, ry] of pieces) wrappedSweet(k, c, stripe, x, y, z, ry, '#FFF8EC');
  },
  treat_candy_apple(k) {
    // resting on its sprinkly bottom, stick up (in her hand it turns over: stick down)
    k.ball(0.115, '#E8203F', 0, 0.12, 0, 16, [1, 0.92, 1]);
    k.ball(0.1, '#FF3B5C', 0, 0.13, 0, 14);
    k.ball(0.03, '#FFB3C0', -0.05, 0.18, 0.06, 8);
    // a sprinkle collar round the bottom
    k.cyl(0.108, 0.03, '#FF3B5C', 0, 0.012, 0, 16, null, 1.02);
    const rnd = rng(8);
    for (let i = 0; i < 22; i++) {
      const a = (i / 22) * Math.PI * 2;
      k.cbox(0.022, 0.011, 0.011, SPRINKLE_COLORS[i % 6], Math.cos(a) * 0.113, 0.02 + rnd() * 0.02, Math.sin(a) * 0.113, [0, -a, rnd()]);
    }
    k.cyl(0.013, 0.24, '#E7BE8C', 0, 0.2, 0, 8);
    // little leaf
    k.cbox(0.05, 0.01, 0.03, '#6BD968', 0.03, 0.225, 0, [0, 0.3, 0.4]);
  },
  treat_macarons(k) {
    k.cyl(0.14, 0.015, '#FFFFFF', 0, 0, 0, 20);
    k.cyl(0.13, 0.017, '#FFE3F0', 0, 0, 0, 20);
    const one = (c, fill, x, y, z, tilt) => {
      const rot = [tilt, 0, tilt * 0.5];
      k.cyl(0.078, 0.028, c, x, y, z, 18, rot);
      k.cyl(0.082, 0.01, c, x, y + 0.028, z, 18, rot);
      k.cyl(0.072, 0.02, fill, x, y + 0.036, z, 18, rot);
      k.cyl(0.082, 0.01, c, x, y + 0.056, z, 18, rot);
      k.cyl(0.078, 0.024, c, x, y + 0.064, z, 18, rot, 0.85);
    };
    one('#FF9CCB', '#FFFFFF', -0.02, 0.017, 0.01, 0);
    one('#9BE8CF', '#FFF6D8', 0.01, 0.105, -0.005, 0.05);
    one('#C8B4FF', '#FFE3F0', -0.005, 0.193, 0.006, -0.04);
  },
  treat_sprinkle_donut(k) {
    torus(k, 0.1, 0.52, '#E9B872', 0, 0.052, 0, 0.9);
    torus(k, 0.101, 0.47, '#FF9ACB', 0, 0.07, 0, 0.62);
    // frosting drips over the outer edge
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2 + 0.3;
      k.ball(0.022, '#FF9ACB', Math.cos(a) * 0.14, 0.055, Math.sin(a) * 0.14, 8, [1, 1.4, 1]);
    }
    const rnd = rng(12);
    for (let i = 0; i < 34; i++) {
      const a = rnd() * Math.PI * 2, d = 0.07 + rnd() * 0.06;
      k.cbox(0.026, 0.011, 0.011, SPRINKLE_COLORS[i % 6], Math.cos(a) * d, 0.1, Math.sin(a) * d, [0, rnd() * 3, 0]);
    }
  },
  treat_marshmallow(k) {
    stick(k, 0.46, 0, 0, 0, '#E7BE8C', 0.012);
    const cols = ['#FFFFFF', '#FFD1E6', '#E6DDFF'];
    cols.forEach((c, i) => {
      const y = 0.17 + i * 0.1;
      k.cyl(0.06, 0.075, c, 0, y, 0, 16, [0, i * 0.3, 0.06 * (i - 1)]);
      k.cyl(0.052, 0.012, c === '#FFFFFF' ? '#FFF6FA' : c, 0, y + 0.074, 0, 16);
      k.ball(0.012, '#FFFFFF', 0.03, y + 0.05, 0.05, 6);
    });
  },
  treat_sour_straws(k) {
    // a paper sleeve of rainbow straws, sugary
    k.cyl(0.07, 0.14, '#FFFFFF', 0, 0, 0, 14, null, 1.1);
    for (let i = 0; i < 6; i++) k.cyl(0.074 + i * 0.001, 0.016, i % 2 ? '#FFE27A' : '#6BD968', 0, 0.02 + i * 0.022, 0, 14);
    const cols = [['#FF5A7A', '#FFD93D'], ['#6BD968', '#FFFFFF'], ['#5BB8FF', '#FF8FD0'], ['#A77BFF', '#FFE27A'], ['#FF9F43', '#FFFFFF'], ['#FF8FD0', '#5BB8FF']];
    cols.forEach(([a, b], i) => {
      const ang = (i / 6) * Math.PI * 2, x = Math.cos(ang) * 0.035, z = Math.sin(ang) * 0.035;
      const tilt = [Math.sin(ang) * 0.14, 0, -Math.cos(ang) * 0.14];
      for (let j = 0; j < 6; j++) k.cyl(0.018, 0.05, j % 2 ? b : a, x + Math.cos(ang) * j * 0.007, 0.05 + j * 0.05, z + Math.sin(ang) * j * 0.007, 8, tilt);
    });
    sugar(k, 14, 0, 0.33, 0, 0.07, 44, -0.4);
  },
  treat_bubblegum(k) {
    // a little gumball machine full of gumballs
    k.cyl(0.085, 0.1, '#FF3B5C', 0, 0, 0, 16, null, 0.8);
    k.box(0.05, 0.035, 0.012, '#FFD36B', -0.025, 0.045, 0.068);
    k.box(0.02, 0.018, 0.014, '#C99A3B', -0.01, 0.053, 0.072);
    k.cyl(0.075, 0.02, '#E8EEF6', 0, 0.1, 0, 16);
    const rnd = rng(5);
    const cols = ['#FF5A7A', '#FFD93D', '#6BD968', '#5BB8FF', '#A77BFF', '#FF8FD0', '#FFFFFF', '#FF9F43'];
    const R = 0.1, cy = 0.205;
    for (let i = 0; i < 44; i++) {
      const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2, h = Math.sqrt(1 - u * u);
      k.ball(0.027, cols[i % cols.length], Math.cos(a) * h * (R - 0.022), cy + u * (R - 0.022), Math.sin(a) * h * (R - 0.022), 8);
    }
    k.ball(0.03, '#FFFFFF', -0.045, cy + 0.05, 0.05, 8, [1, 1, 0.4]);
    k.cyl(0.05, 0.03, '#FF3B5C', 0, cy + R - 0.012, 0, 14, null, 0.7);
    k.ball(0.02, '#FF3B5C', 0, cy + R + 0.03, 0, 8);
  },
  treat_caramel(k) {
    k.cyl(0.15, 0.016, '#FFFFFF', 0, 0, 0, 18);
    k.cyl(0.14, 0.018, '#FFE3F0', 0, 0, 0, 18);
    const pieces = [[-0.05, 0.05, 0.04, 0.3], [0.055, 0.05, 0.03, -0.5], [0.0, 0.05, -0.06, 1.3], [0.0, 0.112, 0.0, 0.8]];
    for (const [x, y, z, ry] of pieces) wrappedSweet(k, '#D98B2B', '#F2B35C', x, y, z, ry, '#FFF6E6', true);
  },
  treat_heart_chocolates(k) {
    // an open heart box: lid leaning behind, chocolates inside
    const heartShape = (s, h, c, y, z = 0, rot = null) => {
      k.cbox(0.16 * s, h, 0.16 * s, c, 0, y + h / 2, z + 0.025 * s, [0, Math.PI / 4, 0]);
      k.cyl(0.08 * s, h, c, -0.057 * s, y, z - 0.032 * s, 18, rot);
      k.cyl(0.08 * s, h, c, 0.057 * s, y, z - 0.032 * s, 18, rot);
    };
    heartShape(1.35, 0.06, '#FF4F7A', 0);
    heartShape(1.22, 0.02, '#FFE3F0', 0.045);
    const choc = [['#6B3E22', -0.07, -0.05], ['#8B5A3C', 0.07, -0.05], ['#F2D0A4', 0, -0.0], ['#6B3E22', -0.04, 0.06], ['#FF8FC8', 0.04, 0.06], ['#8B5A3C', 0, 0.12]];
    for (const [c, x, z] of choc) {
      k.cyl(0.03, 0.012, '#FFFFFF', x, 0.06, z, 10);
      k.ball(0.028, c, x, 0.078, z, 10, [1, 0.75, 1]);
      k.cbox(0.03, 0.006, 0.006, c === '#F2D0A4' ? '#8B5A3C' : '#FFF3E0', x, 0.098, z, [0, 0.6, 0]);
    }
    // the lid, leaning behind
    k.cbox(0.24, 0.03, 0.2, '#FF4F7A', 0, 0.14, -0.17, [-1.15, 0, 0]);
    k.cyl(0.11, 0.03, '#FF4F7A', -0.08, 0.2, -0.21, 18, [-1.15 + Math.PI / 2, 0, 0]);
    k.cyl(0.11, 0.03, '#FF4F7A', 0.08, 0.2, -0.21, 18, [-1.15 + Math.PI / 2, 0, 0]);
    bow(k, '#FFD36B', 0, 0.2, -0.155, 1.2);
  },
  treat_cake_pop(k) {
    k.cyl(0.07, 0.05, '#E6DDFF', 0, 0, 0, 14);
    k.cyl(0.074, 0.012, '#FFFFFF', 0, 0.045, 0, 14);
    stick(k, 0.26, 0, 0.05, 0, '#FFFFFF', 0.012);
    k.ball(0.085, '#FF9CCB', 0, 0.36, 0, 14);
    k.ball(0.086, '#FFB6D9', 0, 0.375, 0, 14, [1, 0.6, 1]);
    ballSprinkles(k, 26, 0, 0.36, 0, 0.087, 17, SPRINKLE_COLORS, -0.1);
    bow(k, '#9C7BFF', 0, 0.28, 0.018, 0.85);
  },
};

function cottonCandy(k, cols, stripe) {
  // paper cone (narrow end down), fluffy cloud on top
  k.cyl(0.018, 0.2, '#FFFFFF', 0, 0, 0, 12, null, 3.6);
  for (let i = 0; i < 3; i++) {
    const y = 0.04 + i * 0.055;
    const r = 0.018 + (y + 0.02) * (0.065 - 0.018) / 0.2;
    k.cyl(r + 0.003, 0.022, stripe, 0, y, 0, 12, [0, 0, 0.1], 1 + 0.022 / 0.2 * 2.3);
  }
  const rnd = rng(cols.length * 13 + cols[0].charCodeAt(1));
  k.ball(0.12, cols[0], 0, 0.31, 0, 14, [1, 0.9, 1]);
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2, u = rnd() * 1.6 - 0.6;
    const h = Math.sqrt(Math.max(0, 1 - u * u * 0.6));
    const r = 0.055 + rnd() * 0.035;
    k.ball(r, cols[i % cols.length], Math.cos(a) * h * 0.1, 0.31 + u * 0.08, Math.sin(a) * h * 0.1, 10);
  }
  k.ball(0.07, cols[1], 0.01, 0.42, 0, 12);
}
