// Food models (Pets/Garden/Cooking team): cute voxel food for thumbnails, tables, eating,
// pet snacks and the cooking panel. Every model is baked once into shared vertex-colored
// geometry (see pets/kit.js); foodModel(key) returns a small Group standing on y = 0,
// centred on x/z, about half a block wide.
//
//   FOOD[key] = { name, plural, kind: 'meal'|'crop'|'flower'|'treat', color }
//   INGREDIENTS[key] = { name, color }   (pantry basics; garden crops live in FOOD)
//   foodModel(key) -> THREE.Group        foodIcon(game, key) -> Promise<dataURL>

import * as THREE from 'three';
import { baked, VC_MAT, glowMat } from './pets/kit.js';

export const FOOD = {
  // meals (cooked)
  cupcake: { name: 'Cupcake', plural: 'Cupcakes', kind: 'meal', color: '#FF8CC6' },
  cookies: { name: 'Cookies', plural: 'Cookies', kind: 'meal', color: '#E0A96D' },
  pizza: { name: 'Pizza', plural: 'Pizzas', kind: 'meal', color: '#FFD65A' },
  pancakes: { name: 'Pancakes', plural: 'Pancakes', kind: 'meal', color: '#F2C27A' },
  ice_cream: { name: 'Ice Cream', plural: 'Ice Creams', kind: 'meal', color: '#FFB3D1' },
  fruit_salad: { name: 'Fruit Salad', plural: 'Fruit Salads', kind: 'meal', color: '#FF6F8A' },
  birthday_cake: { name: 'Birthday Cake', plural: 'Birthday Cakes', kind: 'meal', color: '#FFB6D9' },
  smoothie: { name: 'Smoothie', plural: 'Smoothies', kind: 'meal', color: '#C69CFF' },
  carrot_soup: { name: 'Carrot Soup', plural: 'Carrot Soups', kind: 'meal', color: '#FF9A3C' },
  strawberry_pie: { name: 'Strawberry Pie', plural: 'Strawberry Pies', kind: 'meal', color: '#FF4F6D' },
  pumpkin_pie: { name: 'Pumpkin Pie', plural: 'Pumpkin Pies', kind: 'meal', color: '#FF9F2E' },
  watermelon_popsicle: { name: 'Melon Popsicle', plural: 'Melon Popsicles', kind: 'meal', color: '#FF6B7A' },
  // crops (garden)
  carrot: { name: 'Carrot', plural: 'Carrots', kind: 'crop', color: '#FF9A3C' },
  strawberry: { name: 'Strawberry', plural: 'Strawberries', kind: 'crop', color: '#FF4F6D' },
  pumpkin: { name: 'Pumpkin', plural: 'Pumpkins', kind: 'crop', color: '#FF9F2E' },
  watermelon: { name: 'Watermelon', plural: 'Watermelons', kind: 'crop', color: '#5DBB63' },
  blueberry: { name: 'Blueberries', plural: 'Blueberries', kind: 'crop', color: '#5B6CFF' },
  // flowers (picked bouquets)
  rose: { name: 'Rose Bouquet', plural: 'Rose Bouquets', kind: 'flower', color: '#FF6F98' },
  tulip: { name: 'Tulip Bouquet', plural: 'Tulip Bouquets', kind: 'flower', color: '#B892FF' },
  sunflower: { name: 'Sunflower Bouquet', plural: 'Sunflower Bouquets', kind: 'flower', color: '#FFD23F' },
  // pet treats (always free)
  bone: { name: 'Bone Treat', plural: 'Bone Treats', kind: 'treat', color: '#FFF4E0' },
  fish: { name: 'Fishy Treat', plural: 'Fishy Treats', kind: 'treat', color: '#7CC7FF' },
  apple: { name: 'Apple', plural: 'Apples', kind: 'treat', color: '#FF5A5A' },
  star_cookie: { name: 'Star Cookie', plural: 'Star Cookies', kind: 'treat', color: '#FFE27A' },
  bamboo: { name: 'Bamboo', plural: 'Bamboo', kind: 'treat', color: '#8EDB7E' },
  seeds: { name: 'Seeds', plural: 'Seeds', kind: 'treat', color: '#E8C98E' },
};

export const INGREDIENTS = {
  flour: { name: 'Flour', color: '#FFF1DA' },
  sugar: { name: 'Sugar', color: '#FFE0EE' },
  egg: { name: 'Egg', color: '#FFD65A' },
  milk: { name: 'Milk', color: '#EAF4FF' },
  butter: { name: 'Butter', color: '#FFE58A' },
  chocolate: { name: 'Chocolate', color: '#7A4A2A' },
  cheese: { name: 'Cheese', color: '#FFD24A' },
  tomato: { name: 'Tomato', color: '#FF5A4A' },
  sprinkles: { name: 'Sprinkles', color: '#FF8CC6' },
  banana: { name: 'Banana', color: '#FFE27A' },
  yogurt: { name: 'Yogurt', color: '#FFF0F5' },
  honey: { name: 'Honey', color: '#FFB938' },
  ice: { name: 'Ice', color: '#D8F4FF' },
  cream: { name: 'Cream', color: '#FFF0C4' },
  water: { name: 'Water', color: '#BDE8FF' },
  cinnamon: { name: 'Cinnamon', color: '#C0763C' },
};

const WHITE = '#FFFDF9';
const PLATE = '#FFFFFF';
const PLATE_RIM = '#FFD1E6';
const SPRINKLES = ['#FF5FA2', '#FFC94D', '#3FD8B0', '#6CC6FF', '#9C7BFF', '#FFFFFF'];

// ---------- little helpers ----------

function plate(k, r = 0.24, color = PLATE, rim = PLATE_RIM) {
  k.cyl(r, 0.022, rim, 0, 0, 0, 20);
  k.cyl(r - 0.03, 0.026, color, 0, 0, 0, 20);
}

function sprinkle(k, n, cx, cy, cz, spread, seed = 1) {
  let s = seed;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < n; i++) {
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * spread;
    k.cbox(0.024, 0.012, 0.012, SPRINKLES[i % SPRINKLES.length], cx + Math.cos(a) * r, cy, cz + Math.sin(a) * r, [0, rnd() * 3, 0]);
  }
}

function strawberryAt(k, x, y, z, s = 1, rot = 0) {
  k.ball(0.055 * s, '#FF4F6D', x, y + 0.05 * s, z, 10, [1, 1.1, 1]);
  k.ball(0.04 * s, '#FF6F86', x, y + 0.075 * s, z, 8);
  k.cbox(0.07 * s, 0.015 * s, 0.07 * s, '#5DBB63', x, y + 0.108 * s, z, [0, rot + 0.4, 0]);
  k.cbox(0.02 * s, 0.03 * s, 0.02 * s, '#4FA557', x, y + 0.122 * s, z);
  for (let i = 0; i < 5; i++) {
    const a = i * 1.26 + rot;
    k.cbox(0.012 * s, 0.012 * s, 0.012 * s, '#FFE27A', x + Math.cos(a) * 0.05 * s, y + (0.035 + (i % 2) * 0.03) * s, z + Math.sin(a) * 0.05 * s);
  }
}

function blueberryAt(k, x, y, z, s = 1) {
  k.ball(0.034 * s, '#5B6CFF', x, y + 0.034 * s, z, 8);
  k.cbox(0.02 * s, 0.01 * s, 0.02 * s, '#3A3F9E', x, y + 0.066 * s, z);
}

function leaf(k, x, y, z, rot, s = 1, color = '#6CCB6A') {
  k.cbox(0.07 * s, 0.012, 0.12 * s, color, x, y, z, rot);
}

// ---------- models (draw functions on a Kit; y = 0 is the bottom) ----------

const MODELS = {
  cupcake(k) {
    plate(k, 0.17);
    k.cyl(0.1, 0.15, '#FF8CC6', 0, 0.02, 0, 12, null, 1.3);
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      k.cbox(0.02, 0.15, 0.02, '#FF6FB2', Math.cos(a) * 0.118, 0.095, Math.sin(a) * 0.118, [0, -a, 0]);
    }
    // a big fluffy swirl of frosting
    k.ball(0.15, '#FFF1F7', 0, 0.2, 0, 14, [1, 0.55, 1]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      k.ball(0.06, i % 2 ? '#FFE0EE' : '#FFF1F7', Math.cos(a) * 0.11, 0.205, Math.sin(a) * 0.11, 10);
    }
    k.ball(0.11, '#FFE0EE', 0, 0.26, 0, 14, [1, 0.6, 1]);
    k.ball(0.07, '#FFF1F7', 0, 0.31, 0, 12, [1, 0.75, 1]);
    k.ball(0.035, '#FFE0EE', 0, 0.355, 0, 10);
    k.ball(0.04, '#FF3B5C', 0.01, 0.39, 0, 10);
    k.ball(0.012, '#FFFFFF', -0.005, 0.405, 0.03, 6);
    k.cbox(0.008, 0.06, 0.008, '#4FA557', 0.02, 0.44, 0, [0, 0, -0.4]);
    sprinkle(k, 18, 0, 0.27, 0, 0.12, 3);
  },
  cookies(k) {
    plate(k, 0.25);
    const cookie = (x, y, z, rx, rz) => {
      k.cyl(0.1, 0.032, '#E0A96D', x, y, z, 14, [rx, 0, rz]);
      k.cyl(0.085, 0.034, '#EBBB83', x, y + 0.002, z, 14, [rx, 0, rz]);
      for (let i = 0; i < 5; i++) {
        const a = i * 1.3 + x * 10;
        k.cbox(0.028, 0.02, 0.028, '#6B3E22', x + Math.cos(a) * 0.055, y + 0.035, z + Math.sin(a) * 0.055, [rx, a, rz]);
      }
    };
    cookie(-0.08, 0.03, 0.05, 0, 0);
    cookie(0.09, 0.03, 0.03, 0, 0);
    cookie(0.0, 0.07, -0.02, 0.25, 0.1);
    cookie(0.01, 0.03, -0.12, 0, 0);
  },
  pizza(k) {
    k.cbox(0.56, 0.03, 0.56, '#E7B47E', 0, 0.015, 0);
    k.cbox(0.1, 0.03, 0.08, '#E7B47E', 0, 0.015, 0.31);
    k.cyl(0.25, 0.045, '#E8B36A', 0, 0.03, 0, 22);
    k.cyl(0.215, 0.05, '#FF6B5A', 0, 0.032, 0, 22);
    k.cyl(0.2, 0.054, '#FFD65A', 0, 0.033, 0, 22);
    const pep = [[0.1, 0.05], [-0.09, 0.1], [-0.05, -0.1], [0.08, -0.09], [0, 0.0], [-0.13, -0.02], [0.14, 0.03]];
    for (const [x, z] of pep) k.cyl(0.034, 0.012, '#E2474B', x, 0.086, z, 10);
    for (const [x, z, r] of [[0.02, 0.12, 0.4], [-0.12, 0.08, 1.2], [0.12, -0.12, 2]]) leaf(k, x, 0.09, z, [0, r, 0], 0.6, '#4FAE57');
    for (let i = 0; i < 4; i++) k.cbox(0.44, 0.004, 0.012, '#E8A94E', 0, 0.09, 0, [0, (i * Math.PI) / 4, 0]);
  },
  pancakes(k) {
    plate(k, 0.23);
    for (let i = 0; i < 4; i++) {
      k.cyl(0.155 - i * 0.004, 0.045, '#E9B266', 0, 0.025 + i * 0.047, 0, 18);
      k.cyl(0.14 - i * 0.004, 0.047, '#F6CD8A', 0, 0.025 + i * 0.047, 0, 18);
    }
    k.cyl(0.13, 0.014, '#E08E1B', 0, 0.21, 0, 18);
    for (const [a, h] of [[0.4, 0.07], [2.1, 0.11], [3.6, 0.06], [5.1, 0.09]]) {
      k.cbox(0.035, h, 0.02, '#E08E1B', Math.cos(a) * 0.15, 0.22 - h / 2, Math.sin(a) * 0.15, [0, -a, 0]);
    }
    k.cbox(0.07, 0.035, 0.06, '#FFE58A', 0, 0.235, 0, [0, 0.4, 0]);
    strawberryAt(k, 0.13, 0.02, 0.13, 0.8);
    blueberryAt(k, -0.14, 0.02, 0.12, 0.9);
    blueberryAt(k, -0.1, 0.02, 0.17, 0.9);
  },
  ice_cream(k) {
    k.cyl(0.1, 0.02, '#E4F4FF', 0, 0, 0, 16);
    k.cyl(0.022, 0.1, '#E4F4FF', 0, 0.02, 0, 8);
    k.cyl(0.08, 0.1, '#E4F4FF', 0, 0.11, 0, 16, null, 1.7);
    k.cyl(0.125, 0.02, '#FFFFFF', 0, 0.2, 0, 16);
    k.ball(0.085, '#FFB3D1', -0.055, 0.25, 0.02, 12);
    k.ball(0.085, '#A8EBCB', 0.06, 0.25, -0.01, 12);
    k.ball(0.08, '#FFF3D6', 0, 0.32, 0.0, 12);
    k.ball(0.03, '#FF3B5C', 0, 0.41, 0.01, 8);
    k.cbox(0.006, 0.05, 0.006, '#4FA557', 0.008, 0.45, 0.01, [0, 0, -0.4]);
    k.cbox(0.035, 0.16, 0.02, '#F2C27A', 0.08, 0.36, -0.06, [0, 0, -0.35]);
    sprinkle(k, 10, 0, 0.36, 0, 0.07, 7);
  },
  fruit_salad(k) {
    k.cyl(0.13, 0.05, '#E9F9FF', 0, 0, 0, 18);
    k.cyl(0.16, 0.13, '#BDE8FF', 0, 0.04, 0, 20, null, 1.45);
    k.cyl(0.215, 0.02, '#FFFFFF', 0, 0.16, 0, 20);
    k.cyl(0.2, 0.03, '#FFF3E6', 0, 0.16, 0, 20);
    let s = 5;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 16; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.15, x = Math.cos(a) * r, z = Math.sin(a) * r;
      const pick = i % 4;
      if (pick === 0) strawberryAt(k, x, 0.16, z, 0.7, a);
      else if (pick === 1) blueberryAt(k, x, 0.18, z);
      else if (pick === 2) k.cyl(0.04, 0.02, '#FFF1B8', x, 0.19, z, 10, [0.3, 0, 0.2]);
      else k.cbox(0.05, 0.05, 0.05, '#FF7A8A', x, 0.2, z, [0, a, 0]);
    }
    leaf(k, 0.02, 0.26, 0.02, [0.3, 0.4, 0], 0.8, '#5DBB63');
  },
  birthday_cake(k) {
    k.cyl(0.26, 0.03, '#FFFFFF', 0, 0, 0, 22);
    k.cyl(0.07, 0.07, '#FFFFFF', 0, 0.02, 0, 12);
    k.cyl(0.3, 0.025, '#FFD1E6', 0, 0.08, 0, 24);
    k.cyl(0.25, 0.15, '#FFB6D9', 0, 0.1, 0, 22);
    k.cyl(0.252, 0.03, '#FFFFFF', 0, 0.22, 0, 22);
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2, h = 0.03 + (i % 3) * 0.02;
      k.cbox(0.05, h, 0.03, '#FFFFFF', Math.cos(a) * 0.245, 0.22 - h / 2, Math.sin(a) * 0.245, [0, -a, 0]);
    }
    k.cyl(0.17, 0.12, '#FFF6FB', 0, 0.25, 0, 20);
    k.cyl(0.172, 0.025, '#C9B6FF', 0, 0.25, 0, 20);
    k.cyl(0.175, 0.02, '#FFB6D9', 0, 0.36, 0, 20);
    sprinkle(k, 18, 0, 0.375, 0, 0.14, 11);
    const candle = (x, z, c) => {
      k.cyl(0.018, 0.11, c, x, 0.37, z, 8);
      k.cyl(0.02, 0.018, '#FFFFFF', x, 0.4, z, 8);
    };
    candle(-0.07, 0.03, '#7CC7FF');
    candle(0.07, 0.02, '#FFC94D');
    candle(0.0, -0.07, '#3FD8B0');
    for (const [x, z] of [[-0.07, 0.03], [0.07, 0.02], [0.0, -0.07]]) k.ball(0.022, '#FFB020', x, 0.505, z, 8, [1, 1.5, 1]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      strawberryAt(k, Math.cos(a) * 0.2, 0.22, Math.sin(a) * 0.2, 0.55, a);
    }
  },
  smoothie(k) {
    k.cyl(0.085, 0.02, '#EAF7FF', 0, 0, 0, 14);
    k.cyl(0.09, 0.26, '#C69CFF', 0, 0.02, 0, 14, null, 1.15);
    k.cyl(0.1, 0.05, '#E6D6FF', 0, 0.25, 0, 14);
    k.cyl(0.105, 0.012, '#FFFFFF', 0, 0.28, 0, 14);
    k.ball(0.075, '#FFFFFF', 0, 0.3, 0, 12, [1, 0.6, 1]);
    k.ball(0.05, '#FFFFFF', 0, 0.34, 0, 10);
    k.cyl(0.013, 0.26, '#FF6FA5', 0.035, 0.26, 0.01, 8, [0, 0, -0.3]);
    for (let i = 0; i < 4; i++) k.cyl(0.0135, 0.025, '#FFFFFF', 0.035 + 0.3 * (0.28 + i * 0.05) - 0.08, 0.3 + i * 0.05, 0.01, 8, [0, 0, -0.3]);
    strawberryAt(k, -0.085, 0.25, 0.02, 0.75);
    blueberryAt(k, 0.02, 0.35, 0.03, 0.8);
  },
  carrot_soup(k) {
    plate(k, 0.24);
    k.cyl(0.12, 0.05, '#FFFFFF', 0, 0.02, 0, 18);
    k.cyl(0.17, 0.1, '#FFFFFF', 0, 0.06, 0, 20, null, 1.3);
    k.cyl(0.2, 0.012, '#FFB6D9', 0, 0.155, 0, 20);
    k.cyl(0.19, 0.02, '#FF9A3C', 0, 0.148, 0, 20);
    k.cyl(0.06, 0.005, '#FFF3E0', 0.03, 0.168, 0.02, 12);
    k.cyl(0.03, 0.006, '#FFB36B', 0.03, 0.17, 0.02, 10);
    for (const [x, z] of [[-0.08, 0.05], [0.09, -0.06], [-0.04, -0.1], [0.1, 0.07]]) k.cbox(0.022, 0.008, 0.022, '#4FAE57', x, 0.172, z);
    k.cbox(0.03, 0.012, 0.2, '#D6D9E6', 0.13, 0.19, 0.08, [0, 0.5, 0.3]);
    k.cbox(0.07, 0.015, 0.08, '#D6D9E6', 0.08, 0.172, 0.0, [0, 0.5, 0]);
  },
  strawberry_pie(k) {
    k.cyl(0.25, 0.03, PLATE_RIM, 0, 0, 0, 22);
    k.cyl(0.22, 0.08, '#E6B57C', 0, 0.02, 0, 22, null, 1.08);
    k.cyl(0.2, 0.085, '#FF4F6D', 0, 0.022, 0, 22);
    for (let i = -2; i <= 2; i++) {
      const len = 0.4 * Math.sqrt(1 - (i / 2.6) ** 2);
      k.cbox(0.035, 0.02, len, '#F2C98F', i * 0.075, 0.11, 0);
      k.cbox(len, 0.022, 0.035, '#F2C98F', 0, 0.112, i * 0.075);
    }
    for (let i = 0; i < 18; i++) {
      const a = (i / 18) * Math.PI * 2;
      k.cbox(0.05, 0.035, 0.04, '#EFC08A', Math.cos(a) * 0.22, 0.1, Math.sin(a) * 0.22, [0, -a, 0]);
    }
    k.ball(0.05, '#FFFFFF', 0, 0.14, 0, 10, [1, 0.7, 1]);
    strawberryAt(k, 0, 0.15, 0, 0.7);
  },
  pumpkin_pie(k) {
    k.cyl(0.25, 0.03, PLATE_RIM, 0, 0, 0, 22);
    k.cyl(0.22, 0.08, '#E6B57C', 0, 0.02, 0, 22, null, 1.08);
    k.cyl(0.2, 0.09, '#FF9F2E', 0, 0.022, 0, 22);
    k.cyl(0.16, 0.092, '#FFAE4A', 0, 0.022, 0, 22);
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      k.cbox(0.045, 0.04, 0.04, i % 2 ? '#EFC08A' : '#E2AE70', Math.cos(a) * 0.215, 0.105, Math.sin(a) * 0.215, [0, -a, 0.2]);
    }
    k.ball(0.06, '#FFFFFF', 0, 0.12, 0, 10, [1, 0.6, 1]);
    k.ball(0.04, '#FFFFFF', 0, 0.15, 0, 10);
    k.ball(0.022, '#FFF6E8', 0, 0.18, 0, 8);
    for (const [x, z] of [[0.09, 0.05], [-0.08, -0.07], [0.02, -0.12]]) k.cbox(0.02, 0.01, 0.02, '#C0763C', x, 0.115, z);
  },
  watermelon_popsicle(k) {
    plate(k, 0.2, '#FFFFFF', '#BDE8FF');
    const pop = (x, z, ry, rz) => {
      k.cbox(0.035, 0.12, 0.018, '#EBC795', x, 0.09, z, [0, ry, rz]);
      const sx = Math.sin(rz), cy = Math.cos(rz);
      const at = (h) => [x - sx * h, 0.03 + cy * h];
      let [px, py] = at(0.17);
      k.cbox(0.13, 0.05, 0.05, '#5DBB63', px, py, z, [0, ry, rz]);
      [px, py] = at(0.2);
      k.cbox(0.13, 0.014, 0.052, '#FFFFFF', px, py, z, [0, ry, rz]);
      [px, py] = at(0.28);
      k.cbox(0.13, 0.15, 0.05, '#FF6B7A', px, py, z, [0, ry, rz]);
      for (const [ox, oy] of [[-0.03, 0.26], [0.03, 0.3], [0.0, 0.24], [-0.035, 0.32]]) {
        const [qx, qy] = at(oy);
        k.cbox(0.016, 0.024, 0.056, '#2B2230', qx + ox * Math.cos(rz), qy + ox * Math.sin(rz), z, [0, ry, rz]);
      }
    };
    pop(-0.06, 0.02, 0.1, 0.18);
    pop(0.07, -0.02, -0.15, -0.2);
  },

  // ----- crops -----
  carrot(k) {
    k.cyl(0.012, 0.28, '#FF9A3C', 0, 0.0, 0, 10, [0, 0, 0], 6);
    for (let i = 0; i < 4; i++) k.cbox(0.078 - i * 0.012, 0.008, 0.02, '#E07E25', 0, 0.07 + i * 0.05, 0.062 - i * 0.012);
    k.cbox(0.03, 0.14, 0.03, '#5DBB63', 0, 0.34, 0, [0, 0, 0.35]);
    k.cbox(0.03, 0.16, 0.03, '#6CCB6A', 0, 0.35, 0, [0, 0, -0.3]);
    k.cbox(0.03, 0.15, 0.03, '#4FA557', 0, 0.35, 0, [0.35, 0, 0]);
    k.cbox(0.06, 0.012, 0.05, '#8EDB7E', 0.05, 0.4, 0, [0, 0, 0.5]);
    k.cbox(0.06, 0.012, 0.05, '#8EDB7E', -0.05, 0.41, 0, [0, 0, -0.5]);
  },
  strawberry(k) {
    strawberryAt(k, 0, 0, 0, 2.6);
    leaf(k, 0.1, 0.02, 0.06, [0, 0.6, 0], 1.2);
  },
  pumpkin(k) {
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      k.ball(0.12, i % 2 ? '#FF9F2E' : '#FFAE4A', Math.cos(a) * 0.1, 0.13, Math.sin(a) * 0.1, 12, [0.8, 1, 0.8]);
    }
    k.ball(0.15, '#FFA43B', 0, 0.13, 0, 14, [1, 0.85, 1]);
    k.cyl(0.025, 0.08, '#6E8B3D', 0, 0.23, 0, 8, [0, 0, 0.2]);
    leaf(k, 0.06, 0.25, 0.03, [0.2, 0.5, 0.3], 1.1);
  },
  watermelon(k) {
    k.ball(0.16, '#4FA557', 0, 0.14, -0.02, 14, [1.3, 0.9, 1]);
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      k.ball(0.07, '#2E7D3A', Math.cos(a) * 0.185, 0.14, -0.02 + Math.sin(a) * 0.13, 8, [0.4, 1.25, 0.4]);
    }
    // a slice leaning in front
    const sx = 0.02, sz = 0.19;
    k.cbox(0.24, 0.03, 0.06, '#5DBB63', sx, 0.015, sz);
    k.cbox(0.22, 0.012, 0.062, '#FFFFFF', sx, 0.036, sz);
    k.cbox(0.2, 0.05, 0.06, '#FF6B7A', sx, 0.066, sz);
    k.cbox(0.14, 0.05, 0.06, '#FF6B7A', sx, 0.11, sz);
    k.cbox(0.07, 0.04, 0.06, '#FF6B7A', sx, 0.15, sz);
    for (const [x, y] of [[-0.05, 0.07], [0.05, 0.08], [0.0, 0.12], [-0.03, 0.12], [0.03, 0.14]]) k.cbox(0.014, 0.022, 0.064, '#2B2230', sx + x, y, sz);
  },
  blueberry(k) {
    const pts = [[0, 0, 0], [0.07, 0, 0.03], [-0.06, 0, 0.04], [0.02, 0, -0.07], [-0.04, 0.06, -0.01], [0.04, 0.06, 0.0], [0.0, 0.11, 0.02]];
    for (const [x, y, z] of pts) blueberryAt(k, x, y, z, 1.35);
    leaf(k, 0.05, 0.16, -0.03, [0.3, 0.8, 0.2], 1);
    leaf(k, -0.04, 0.16, -0.04, [0.3, -0.6, -0.2], 0.9, '#5DBB63');
  },

  // ----- flowers (a bouquet in a vase) -----
  rose(k) { bouquet(k, '#FF6F98', '#FF9DBA', 'rose'); },
  tulip(k) { bouquet(k, '#B892FF', '#D8C4FF', 'tulip'); },
  sunflower(k) { bouquet(k, '#FFD23F', '#FFE27A', 'sunflower'); },

  // ----- treats -----
  bone(k) {
    k.cbox(0.2, 0.05, 0.05, '#FFF4E0', 0, 0.035, 0);
    for (const x of [-0.11, 0.11]) for (const z of [-0.03, 0.03]) k.ball(0.036, '#FFF4E0', x, 0.035, z, 10);
  },
  fish(k) {
    k.cbox(0.18, 0.1, 0.05, '#7CC7FF', 0, 0.06, 0);
    k.cbox(0.12, 0.13, 0.045, '#8FD3FF', -0.01, 0.065, 0);
    k.cbox(0.06, 0.06, 0.04, '#6CB4F0', 0.12, 0.06, 0, [0, 0, 0.785]);
    k.cbox(0.02, 0.02, 0.052, '#2A1B33', -0.05, 0.08, 0);
    k.cbox(0.05, 0.016, 0.052, '#FFB6D9', 0.02, 0.05, 0);
  },
  apple(k) {
    k.ball(0.1, '#FF5A5A', 0, 0.1, 0, 14, [1, 0.92, 1]);
    k.ball(0.04, '#FF8A8A', -0.04, 0.14, 0.06, 8);
    k.cbox(0.014, 0.06, 0.014, '#8A5A3C', 0, 0.21, 0, [0, 0, 0.2]);
    leaf(k, 0.04, 0.22, 0, [0.4, 0.5, 0.4], 0.8);
  },
  star_cookie(k) {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      k.cbox(0.07, 0.03, 0.1, '#FFE27A', Math.sin(a) * 0.055, 0.02, Math.cos(a) * 0.055, [0, a, 0]);
    }
    k.cyl(0.07, 0.035, '#FFE27A', 0, 0.005, 0, 10);
    k.cyl(0.045, 0.012, '#FFFFFF', 0, 0.04, 0, 10);
    sprinkle(k, 6, 0, 0.042, 0, 0.05, 13);
  },
  bamboo(k) {
    for (let i = 0; i < 3; i++) k.cyl(0.03, 0.11, i % 2 ? '#8EDB7E' : '#7FD174', 0, 0.02 + i * 0.115, 0, 8, [0.05, 0, 0.1]);
    for (let i = 1; i < 3; i++) k.cyl(0.034, 0.012, '#5DBB63', 0.01 * i, 0.02 + i * 0.115, 0, 8, [0.05, 0, 0.1]);
    leaf(k, 0.06, 0.3, 0, [0.2, 0.3, 0.6], 1);
    leaf(k, -0.05, 0.25, 0.02, [0.2, -0.4, -0.6], 0.9, '#5DBB63');
  },
  seeds(k) {
    k.cyl(0.1, 0.03, '#FFD1E6', 0, 0, 0, 14);
    let s = 17;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 14; i++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.07;
      k.cbox(0.022, 0.016, 0.032, i % 3 ? '#E8C98E' : '#C9A26A', Math.cos(a) * r, 0.035 + rnd() * 0.02, Math.sin(a) * r, [0, a, 0]);
    }
  },

  // ----- pantry ingredients (for the cooking panel) -----
  flour(k) {
    k.cbox(0.2, 0.24, 0.14, '#FFF4E4', 0, 0.12, 0);
    k.cbox(0.2, 0.05, 0.1, '#F2E3CC', 0, 0.26, 0, [0.3, 0, 0]);
    k.cbox(0.16, 0.08, 0.005, '#7CC7FF', 0, 0.12, 0.071);
    k.cbox(0.06, 0.03, 0.006, '#FFFFFF', 0, 0.12, 0.072);
  },
  sugar(k) {
    k.cbox(0.2, 0.22, 0.14, '#FFD1E6', 0, 0.11, 0);
    k.cbox(0.2, 0.05, 0.1, '#FFB6D9', 0, 0.245, 0, [0.3, 0, 0]);
    k.cbox(0.14, 0.09, 0.005, '#FFFFFF', 0, 0.11, 0.071);
    k.cbox(0.05, 0.05, 0.05, '#FFFFFF', 0, 0.11, 0.08, [0.3, 0.4, 0]);
    for (const [x, z, r] of [[0.13, 0.08, 0.3], [0.17, -0.02, 1.1]]) {
      k.cbox(0.06, 0.06, 0.06, '#FFFFFF', x, 0.03, z, [0, r, 0]);
      k.cbox(0.02, 0.02, 0.062, '#EEF4FF', x + 0.015, 0.045, z, [0, r, 0]);
    }
  },
  egg(k) {
    k.cyl(0.07, 0.05, '#9FD8FF', 0, 0, 0, 12, null, 1.25);
    k.ball(0.075, '#FFF1DC', 0, 0.12, 0, 14, [1, 1.3, 1]);
    k.ball(0.02, '#FFFFFF', -0.03, 0.16, 0.05, 8);
  },
  milk(k) {
    k.cbox(0.14, 0.22, 0.14, '#FFFFFF', 0, 0.11, 0);
    k.cbox(0.142, 0.08, 0.142, '#7CC7FF', 0, 0.08, 0);
    k.cbox(0.14, 0.06, 0.1, '#FFFFFF', 0, 0.245, 0, [0, 0, 0]);
    k.cbox(0.02, 0.05, 0.1, '#FFFFFF', 0, 0.28, 0);
    k.cbox(0.05, 0.03, 0.005, '#FFFFFF', 0, 0.08, 0.072);
  },
  butter(k) {
    k.cbox(0.24, 0.02, 0.14, '#FFFFFF', 0, 0.01, 0);
    k.cbox(0.18, 0.08, 0.1, '#FFE58A', 0, 0.06, 0);
    k.cbox(0.12, 0.02, 0.1, '#FFF1B8', 0.03, 0.1, 0);
  },
  chocolate(k) {
    k.cbox(0.26, 0.03, 0.16, '#7A4A2A', 0, 0.015, 0);
    for (let i = 0; i < 3; i++) for (let j = 0; j < 2; j++) k.cbox(0.075, 0.02, 0.065, '#8C5A36', -0.085 + i * 0.085, 0.04, -0.037 + j * 0.074);
    k.cbox(0.26, 0.032, 0.07, '#FF8CC6', 0.0, 0.016, 0.07);
  },
  cheese(k) {
    for (let i = 0; i < 5; i++) k.cbox(0.22 - i * 0.04, 0.12, 0.14, '#FFD24A', -0.02 * i, 0.06, 0);
    for (const [x, y] of [[-0.03, 0.05], [0.05, 0.08], [-0.07, 0.09]]) k.cbox(0.03, 0.03, 0.142, '#F0B52E', x, y, 0);
  },
  tomato(k) {
    k.ball(0.1, '#FF5A4A', 0, 0.09, 0, 14, [1, 0.85, 1]);
    k.ball(0.035, '#FF8A7A', -0.04, 0.13, 0.05, 8);
    k.cbox(0.08, 0.012, 0.03, '#4FAE57', 0, 0.175, 0, [0, 0.5, 0]);
    k.cbox(0.08, 0.012, 0.03, '#4FAE57', 0, 0.175, 0, [0, -0.6, 0]);
    k.cbox(0.014, 0.04, 0.014, '#4FAE57', 0, 0.19, 0);
  },
  sprinkles(k) {
    k.cyl(0.075, 0.18, '#E8F7FF', 0, 0, 0, 14);
    k.cyl(0.078, 0.04, '#FF6FA5', 0, 0.18, 0, 14);
    for (let i = 0; i < 18; i++) {
      const a = i * 1.1, y = 0.02 + (i % 6) * 0.026;
      k.cbox(0.022, 0.012, 0.012, SPRINKLES[i % 6], Math.cos(a) * 0.076, y, Math.sin(a) * 0.076, [0, -a, 0.5]);
    }
  },
  banana(k) {
    k.cbox(0.07, 0.06, 0.12, '#FFE27A', 0, 0.05, -0.1, [-0.5, 0, 0]);
    k.cbox(0.07, 0.06, 0.12, '#FFE27A', 0, 0.02, 0.0);
    k.cbox(0.07, 0.06, 0.12, '#FFE27A', 0, 0.05, 0.1, [0.5, 0, 0]);
    k.cbox(0.03, 0.03, 0.04, '#8A6A3E', 0, 0.09, 0.17, [0.5, 0, 0]);
    k.cbox(0.03, 0.03, 0.03, '#5E4630', 0, 0.09, -0.17);
  },
  yogurt(k) {
    k.cyl(0.07, 0.14, '#FFFFFF', 0, 0, 0, 14, null, 1.2);
    k.cyl(0.09, 0.02, '#FF8CC6', 0, 0.14, 0, 14);
    k.cbox(0.08, 0.05, 0.005, '#FFB6D9', 0, 0.07, 0.078);
  },
  honey(k) {
    k.cyl(0.085, 0.15, '#FFB938', 0, 0, 0, 14);
    k.cyl(0.09, 0.04, '#FFFFFF', 0, 0.14, 0, 14);
    k.cyl(0.092, 0.02, '#FF8CC6', 0, 0.16, 0, 14);
    k.cbox(0.02, 0.2, 0.02, '#D9A45A', 0.04, 0.2, 0, [0, 0, -0.3]);
    k.ball(0.03, '#E9A13B', 0.08, 0.3, 0, 8, [1, 1.3, 1]);
  },
  ice(k) {
    for (const [x, y, z, r] of [[0, 0.045, 0, 0.2], [0.09, 0.045, 0.02, 0.6], [0.04, 0.13, 0, 1], [-0.07, 0.045, 0.03, 1.3]]) {
      k.cbox(0.085, 0.085, 0.085, '#D8F4FF', x, y, z, [0, r, 0]);
      k.cbox(0.03, 0.03, 0.088, '#FFFFFF', x - 0.02, y + 0.02, z, [0, r, 0]);
    }
  },
  cream(k) {
    // a little pink jug of whipped cream with a fluffy top
    k.cyl(0.075, 0.15, '#FFB6D9', 0, 0, 0, 14, null, 0.85);
    k.cyl(0.078, 0.03, '#FFFFFF', 0, 0.05, 0, 14);
    k.cbox(0.05, 0.03, 0.04, '#FFB6D9', 0.075, 0.14, 0);
    k.cbox(0.02, 0.09, 0.03, '#FF8CC6', -0.085, 0.07, 0);
    k.ball(0.07, '#FFF6E0', 0, 0.17, 0, 12, [1, 0.6, 1]);
    k.ball(0.045, '#FFFBF0', 0, 0.21, 0, 10);
    k.ball(0.02, '#FFFFFF', 0, 0.25, 0, 8);
  },
  water(k) {
    k.cyl(0.07, 0.18, '#BDE8FF', 0, 0, 0, 14, null, 1.1);
    k.cyl(0.078, 0.02, '#FFFFFF', 0, 0.18, 0, 14);
    k.cbox(0.025, 0.05, 0.005, '#FFFFFF', -0.03, 0.12, 0.072);
  },
  cinnamon(k) {
    for (const [x, z, r] of [[-0.035, 0, 0.1], [0.035, 0.01, -0.1], [0, -0.04, 0.3]]) k.cyl(0.03, 0.24, '#C0763C', x, 0.03, z, 8, [Math.PI / 2, r, 0]);
  },
};

function bouquet(k, petal, light, kind) {
  k.cyl(0.07, 0.03, '#BDE8FF', 0, 0, 0, 12);
  k.cyl(0.08, 0.18, '#BDE8FF', 0, 0.02, 0, 12, null, 0.7);
  k.cyl(0.06, 0.02, '#FF8CC6', 0, 0.12, 0, 12);
  const heads = [[0, 0.44, 0, 0], [-0.08, 0.38, 0.04, 0.35], [0.08, 0.37, -0.02, -0.35], [0.02, 0.35, 0.09, 0.2]];
  for (const [x, y, z, lean] of heads) {
    k.cbox(0.02, y - 0.12, 0.02, '#4FAE57', x / 2, 0.12 + (y - 0.12) / 2, z / 2, [lean * 0.5, 0, -lean * 0.4]);
    if (kind === 'sunflower') {
      for (let i = 0; i < 8; i++) k.cbox(0.035, 0.07, 0.02, petal, x + Math.cos(i * 0.785) * 0.05, y + Math.sin(i * 0.785) * 0.05, z, [0, 0, i * 0.785 + 1.57]);
      k.cbox(0.06, 0.06, 0.03, '#8A5A3C', x, y, z + 0.005);
    } else if (kind === 'tulip') {
      k.cbox(0.075, 0.08, 0.075, petal, x, y, z);
      k.cbox(0.03, 0.04, 0.078, light, x - 0.025, y + 0.045, z);
      k.cbox(0.03, 0.04, 0.078, light, x + 0.025, y + 0.045, z);
    } else {
      k.ball(0.05, petal, x, y, z, 10);
      k.ball(0.035, light, x, y + 0.02, z + 0.01, 8);
      k.cbox(0.02, 0.02, 0.02, '#E24C78', x, y + 0.035, z + 0.02);
    }
  }
  leaf(k, 0.07, 0.2, 0.02, [0.3, 0.5, 0.7], 1, '#6CCB6A');
  leaf(k, -0.07, 0.22, 0.0, [0.3, -0.5, -0.7], 1, '#5DBB63');
}

/** A generic treat for unknown keys (a pink gift box). */
function unknownModel(k) {
  k.cbox(0.2, 0.16, 0.2, '#FF8CC6', 0, 0.08, 0);
  k.cbox(0.21, 0.16, 0.04, '#FFFFFF', 0, 0.08, 0);
  k.cbox(0.04, 0.16, 0.21, '#FFFFFF', 0, 0.08, 0);
}

export function hasFoodModel(key) {
  return !!MODELS[key];
}

/** A Group with the food standing on y = 0 (shared geometry: cheap to create). */
export function foodModel(key) {
  const g = new THREE.Group();
  g.name = 'food:' + key;
  const geo = baked('food:' + key, MODELS[key] || unknownModel);
  g.add(new THREE.Mesh(geo, VC_MAT));
  if (key === 'birthday_cake') {
    // softly glowing candle flames
    const flames = new THREE.Mesh(baked('food:cake-flames', (k) => {
      for (const [x, z] of [[-0.07, 0.03], [0.07, 0.02], [0.0, -0.07]]) k.ball(0.014, '#FFFFFF', x, 0.51, z, 8, [1, 1.4, 1]);
    }), glowMat('#FFE9A8', 0.9));
    g.add(flames);
  }
  return g;
}

/** 96px thumbnail of a food / ingredient (cached by game.thumbs). */
export function foodIcon(game, key) {
  return game.thumbs.get('food:' + key, () => foodModel(key), { dir: [0.75, 0.9, 1.4], zoom: 0.85 });
}

/** Display name for any food / ingredient key. */
export function foodName(key, n = 1) {
  const f = FOOD[key] || INGREDIENTS[key];
  if (!f) return key;
  return n === 1 ? f.name : (f.plural || f.name);
}

export function install() {}
