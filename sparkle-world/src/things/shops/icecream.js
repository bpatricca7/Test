// Build-your-own ice cream: styles, flavors, toppings, prices, the self-describing basket key
// and the voxel model. A creation is { style, flavors: [1..3 flavor ids], tops: 'scwhg' subset }.
//
//   key:  'treat_ic_<style>_<f1>[-<f2>[-<f3>]]_<tops|x>'   e.g. 'treat_ic_sundae_straw-mint-uni_scw'
//   encode(spec) -> key      decode(key) -> spec | null
//   price(spec)              name(spec)            drawIceCream(spec)(kit)
//   FAVORITES: four ready-made treats with names of their own

import { rng, sprinkles, ballSprinkles, SPRINKLE_COLORS } from './candy.js';

export const STYLES = [
  { id: 'cone', name: 'Cone', price: 3 },
  { id: 'cup', name: 'Cup', price: 3 },
  { id: 'sundae', name: 'Sundae', price: 6 },
  { id: 'popsicle', name: 'Popsicle', price: 4 },
  { id: 'shake', name: 'Milkshake', price: 6 },
  { id: 'sandwich', name: 'Sandwich', price: 5, long: 'Ice Cream Sandwich' },
];

// color, a lighter shade, and bits (chips, swirls, sprinkles) mixed in
export const FLAVORS = [
  { id: 'van', name: 'Vanilla', color: '#FFF1CF', light: '#FFF9E8', bits: ['#E8C98E'], nbits: 5 },
  { id: 'choc', name: 'Chocolate', color: '#8B5A3C', light: '#A6704E', bits: ['#6B3E22'], nbits: 4 },
  { id: 'straw', name: 'Strawberry', color: '#FFB3C7', light: '#FFCCD9', bits: ['#FF4F6D'], nbits: 7 },
  { id: 'mint', name: 'Mint Chip', short: 'Mint', color: '#BDF2DA', light: '#D6F8E8', bits: ['#4A2A1C'], nbits: 9 },
  { id: 'dough', name: 'Cookie Dough', color: '#F5E0B8', light: '#FBEBCF', bits: ['#B07A48', '#6B3E22'], nbits: 8, chunky: true },
  { id: 'gum', name: 'Bubblegum', color: '#FF9FD6', light: '#FFC0E4', bits: ['#5BB8FF', '#FFD93D', '#6BD968'], nbits: 9 },
  { id: 'cotton', name: 'Cotton Candy', color: '#FFC2E2', light: '#FFDDEF', bits: ['#A8DDFF'], nbits: 6, swirl: true },
  { id: 'sherbet', name: 'Rainbow Sherbet', short: 'Rainbow', color: '#FFB27A', light: '#FFD0A6', bits: ['#FF8FA8', '#B6F0A0', '#FFE27A'], nbits: 11, swirl: true },
  { id: 'mango', name: 'Mango', color: '#FFC94D', light: '#FFDC85', bits: ['#FFB020'], nbits: 3 },
  { id: 'blue', name: 'Blueberry', color: '#A9B2FF', light: '#C4CAFF', bits: ['#5B6CFF'], nbits: 7 },
  { id: 'bday', name: 'Birthday Cake', short: 'Birthday', color: '#FFF0F5', light: '#FFFFFF', bits: SPRINKLE_COLORS.slice(0, 5), nbits: 12 },
  { id: 'uni', name: 'Unicorn', color: '#DCC8FF', light: '#EFE4FF', bits: ['#FF9CCB', '#9BE8CF', '#FFFFFF'], nbits: 9, swirl: true },
];

export const TOPPINGS = [
  { id: 's', key: 'sprinkles', name: 'Sprinkles', price: 1 },
  { id: 'c', key: 'cherry', name: 'Cherry', price: 1 },
  { id: 'w', key: 'whipped', name: 'Whipped Cream', short: 'Whipped', price: 2 },
  { id: 'h', key: 'sauce', name: 'Chocolate Sauce', short: 'Choc Sauce', price: 2 },
  { id: 'g', key: 'gummies', name: 'Gummy Bears', short: 'Gummies', price: 2 },
];

export const SCOOP_PRICE = 3;
export const MAX_SCOOPS = 3;

const STYLE = Object.fromEntries(STYLES.map((s) => [s.id, s]));
const FLAVOR = Object.fromEntries(FLAVORS.map((f) => [f.id, f]));
const TOP_ORDER = TOPPINGS.map((t) => t.id).join('');

export const flavorOf = (id) => FLAVOR[id] || null;
export const styleOf = (id) => STYLE[id] || null;

/** A clean copy of a creation (unknown bits dropped, toppings in a fixed order). */
export function normalize(spec) {
  if (!spec) return null;
  const style = STYLE[spec.style] ? spec.style : null;
  const flavors = (spec.flavors || []).filter((f) => FLAVOR[f]).slice(0, MAX_SCOOPS);
  if (!style || !flavors.length) return null;
  const tops = [...TOP_ORDER].filter((c) => (spec.tops || '').includes(c)).join('');
  return { style, flavors, tops };
}

export function encode(spec) {
  const s = normalize(spec);
  return s ? `treat_ic_${s.style}_${s.flavors.join('-')}_${s.tops || 'x'}` : null;
}

export function decode(key) {
  const m = /^treat_ic_([a-z]+)_([a-z-]+)_([a-z]+)$/.exec(key || '');
  if (!m) return null;
  const spec = normalize({ style: m[1], flavors: m[2].split('-'), tops: m[3] === 'x' ? '' : m[3] });
  return spec && encode(spec) === key ? spec : null;
}

export function price(spec) {
  const s = normalize(spec);
  if (!s) return 0;
  let p = STYLE[s.style].price + s.flavors.length * SCOOP_PRICE;
  for (const t of TOPPINGS) if (s.tops.includes(t.id)) p += t.price;
  return p;
}

export const FAVORITES = [
  { name: 'Unicorn Dream', spec: { style: 'sundae', flavors: ['uni', 'cotton', 'gum'], tops: 'scw' } },
  { name: 'Rainbow Cone', spec: { style: 'cone', flavors: ['sherbet', 'straw', 'blue'], tops: 's' } },
  { name: 'Choco Shake', spec: { style: 'shake', flavors: ['choc', 'van'], tops: 'cwh' } },
  { name: 'Mango Pop', spec: { style: 'popsicle', flavors: ['mango', 'straw'], tops: 'hs' } },
];
const FAV_NAMES = new Map(FAVORITES.map((f) => [encode(f.spec), f.name]));

/** A short, friendly name ("Mango Cone", "Triple Sundae", "Unicorn Dream"). */
export function name(spec) {
  const s = normalize(spec);
  if (!s) return 'Ice Cream';
  const fav = FAV_NAMES.get(encode(s));
  if (fav) return fav;
  const st = STYLE[s.style];
  if (s.flavors.length === 1) {
    const f = FLAVOR[s.flavors[0]];
    return `${f.short || f.name} ${s.style === 'sandwich' ? 'Sandwich' : st.name}`;
  }
  const layered = s.style === 'popsicle' || s.style === 'shake' || s.style === 'sandwich';
  if (layered) return `${s.flavors.length === 2 ? 'Swirly' : 'Rainbow'} ${s.style === 'sandwich' ? 'Sandwich' : st.name}`;
  return `${s.flavors.length === 2 ? 'Double' : 'Triple'} ${st.name}`;
}

export function plural(spec) {
  const n = name(spec);
  return n.endsWith('Sandwich') ? n + 'es' : n + 's';
}

/** The main color (sparkles when she eats it). */
export function colorOf(spec) {
  const s = normalize(spec);
  return s ? FLAVOR[s.flavors[s.flavors.length - 1]].color : '#FFB3D1';
}

// ---------- the model ----------

const CONE = '#E9B26C', CONE_DARK = '#C98A45', WAFER = '#6B4128', WAFER_DOT = '#4E2D1B';
const CREAM = '#FFFFFF', SAUCE = '#5A3220', CHERRY = '#E8203F';

/** A scoop: a round ball with a ruffled rim and the flavor's bits. */
function scoop(k, f, x, y, z, r = 0.085, seed = 1) {
  k.ball(r, f.color, x, y, z, 14, [1, 0.9, 1]);
  const n = 11;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + seed;
    k.ball(r * 0.34, i % 2 ? f.color : f.light, x + Math.cos(a) * r * 0.9, y - r * 0.42, z + Math.sin(a) * r * 0.9, 8, [1, 0.8, 1]);
  }
  k.ball(r * 0.55, f.light, x - r * 0.25, y + r * 0.35, z + r * 0.25, 10);
  const rnd = rng(seed * 31 + 7);
  for (let i = 0; i < f.nbits; i++) {
    const a = rnd() * Math.PI * 2, up = -0.35 + rnd() * 1.2;
    const h = Math.sqrt(Math.max(0, 1 - up * up));
    const c = f.bits[i % f.bits.length];
    const px = x + Math.cos(a) * h * r * 0.97, py = y + up * r * 0.88, pz = z + Math.sin(a) * h * r * 0.97;
    if (f.swirl) k.ball(r * 0.3, c, px, py, pz, 8, [1.3, 0.7, 1]);
    else if (f.chunky) k.cbox(0.026, 0.022, 0.026, c, px, py, pz, [rnd(), rnd(), rnd()]);
    else k.cbox(0.017, 0.017, 0.017, c, px, py, pz, [rnd(), rnd(), rnd()]);
  }
}

function cherry(k, x, y, z) {
  k.ball(0.03, CHERRY, x, y + 0.026, z, 10);
  k.ball(0.009, '#FFFFFF', x - 0.011, y + 0.04, z + 0.018, 6);
  k.cbox(0.006, 0.05, 0.006, '#4FA557', x + 0.008, y + 0.07, z, [0, 0, -0.35]);
}

function whipped(k, x, y, z, s = 1) {
  k.ball(0.064 * s, CREAM, x, y + 0.02 * s, z, 12, [1, 0.62, 1]);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    k.ball(0.028 * s, i % 2 ? CREAM : '#FFF8EE', x + Math.cos(a) * 0.05 * s, y + 0.012 * s, z + Math.sin(a) * 0.05 * s, 8);
  }
  k.ball(0.044 * s, CREAM, x, y + 0.058 * s, z, 10, [1, 0.8, 1]);
  k.ball(0.024 * s, CREAM, x, y + 0.09 * s, z, 8);
  return y + 0.11 * s; // top
}

/** Chocolate sauce over a scoop top: a cap plus a few drips. */
function sauce(k, x, y, z, r) {
  k.ball(r * 1.02, SAUCE, x, y + r * 0.2, z, 14, [1, 0.5, 1]);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2 + 0.4;
    const len = 0.03 + (i % 3) * 0.018;
    k.cbox(0.02, len, 0.02, SAUCE, x + Math.cos(a) * r * 0.86, y - len / 2 + 0.01, z + Math.sin(a) * r * 0.86);
    k.ball(0.013, SAUCE, x + Math.cos(a) * r * 0.86, y - len + 0.012, z + Math.sin(a) * r * 0.86, 6);
  }
}

function gummies(k, x, y, z, n = 3) {
  const cols = ['#FF5A7A', '#6BD968', '#FFD93D', '#A77BFF'];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.5;
    const bx = x + Math.cos(a) * 0.05, bz = z + Math.sin(a) * 0.05;
    k.ball(0.02, cols[i % 4], bx, y + 0.02, bz, 8, [1, 1.1, 0.85]);
    k.ball(0.016, cols[i % 4], bx, y + 0.05, bz, 8);
    k.ball(0.007, cols[i % 4], bx - 0.012, y + 0.064, bz, 6);
    k.ball(0.007, cols[i % 4], bx + 0.012, y + 0.064, bz, 6);
  }
}

/** Toppings on a round top at (x, y, z) (y = top of the scoop), radius r. Returns the new top. */
function topRound(k, s, x, y, z, r, seed) {
  let top = y;
  if (s.tops.includes('h')) sauce(k, x, y - r * 0.55, z, r);
  if (s.tops.includes('s')) ballSprinkles(k, 18, x, y - r, z, r * 1.02, seed + 3, SPRINKLE_COLORS, 0.3);
  if (s.tops.includes('g')) gummies(k, x, y - r * 0.35, z, 3);
  if (s.tops.includes('w')) top = whipped(k, x, top - 0.02, z, 0.95);
  if (s.tops.includes('c')) cherry(k, x, top - 0.012, z);
  return top;
}

const DRAW = {
  cone(k, s, F) {
    // waffle cone, narrow end down
    k.cyl(0.012, 0.26, CONE, 0, 0, 0, 14, null, 7.2);
    for (let i = 0; i < 5; i++) {
      const y = 0.05 + i * 0.045, r = 0.012 + (y / 0.26) * (0.086 - 0.012);
      k.cyl(r + 0.004, 0.008, CONE_DARK, 0, y, 0, 14);
    }
    for (let i = 0; i < 8; i++) {
      const a = (i / 8) * Math.PI * 2;
      k.cbox(0.008, 0.24, 0.008, CONE_DARK, Math.cos(a) * 0.052, 0.125, Math.sin(a) * 0.052, [Math.sin(a) * 0.3, 0, -Math.cos(a) * 0.3]);
    }
    k.cyl(0.094, 0.03, '#F2C98A', 0, 0.245, 0, 16);
    let y = 0.3, top = 0.3;
    F.forEach((f, i) => {
      const r = 0.088 - i * 0.005;
      scoop(k, f, 0, y, 0, r, i + 1);
      top = y + r * 0.9;
      y += 0.1 - i * 0.004;
    });
    topRound(k, s, 0, top, 0, 0.08, 5);
  },
  cup(k, s, F) {
    // a striped paper cup with a pink spoon
    k.cyl(0.085, 0.13, '#FFFFFF', 0, 0, 0, 18, null, 1.35);
    for (let i = 0; i < 9; i++) {
      const a = (i / 9) * Math.PI * 2;
      k.cbox(0.03, 0.128, 0.012, '#FF9CCB', Math.cos(a) * 0.1, 0.064, Math.sin(a) * 0.1, [0, -a, -0.23]);
    }
    k.cyl(0.118, 0.018, '#FFE3F0', 0, 0.125, 0, 18);
    const spots = F.length === 1 ? [[0, 0.19, 0]] : F.length === 2 ? [[-0.045, 0.185, 0], [0.045, 0.185, 0]] : [[-0.05, 0.18, 0.02], [0.05, 0.18, 0.02], [0, 0.265, -0.01]];
    F.forEach((f, i) => scoop(k, f, spots[i][0], spots[i][1], spots[i][2], F.length === 1 ? 0.09 : 0.07, i + 2));
    const top = spots[spots.length - 1];
    topRound(k, s, top[0], top[1] + (F.length === 1 ? 0.078 : 0.06), top[2], F.length === 1 ? 0.085 : 0.066, 11);
    k.cbox(0.02, 0.16, 0.012, '#FF8FC8', 0.075, 0.24, 0.05, [0.3, 0, -0.45]);
    k.ball(0.028, '#FF8FC8', 0.108, 0.3, 0.07, 8, [1, 1.3, 0.5]);
  },
  sundae(k, s, F) {
    // a glass sundae dish on a stem
    k.cyl(0.08, 0.018, '#DDF3FF', 0, 0, 0, 18);
    k.cyl(0.02, 0.08, '#EAF7FF', 0, 0.018, 0, 10);
    k.cyl(0.05, 0.1, '#DDF3FF', 0, 0.095, 0, 18, null, 2.9);
    k.cyl(0.148, 0.014, '#FFFFFF', 0, 0.19, 0, 20);
    k.cbox(0.012, 0.06, 0.012, '#FFFFFF', -0.07, 0.15, 0.06, [0, 0, 0.9]);
    const spots = F.length === 1 ? [[0, 0.255, 0]] : F.length === 2 ? [[-0.055, 0.245, 0.0], [0.055, 0.245, 0]] : [[-0.058, 0.24, 0.025], [0.058, 0.24, 0.025], [0, 0.325, -0.015]];
    const r = F.length === 1 ? 0.1 : 0.078;
    F.forEach((f, i) => scoop(k, f, spots[i][0], spots[i][1], spots[i][2], r, i + 4));
    const t = spots[spots.length - 1];
    // a wafer stick for style
    k.cbox(0.03, 0.15, 0.03, CONE, 0.06, 0.33, -0.05, [0.2, 0, -0.35]);
    topRound(k, s, t[0], t[1] + r * 0.9, t[2], r, 21);
  },
  popsicle(k, s, F) {
    k.cbox(0.036, 0.15, 0.014, '#EBC795', 0, 0.075, 0);
    const n = F.length, h = 0.24, y0 = 0.12, w = 0.13, d = 0.07;
    F.forEach((f, i) => {
      const hh = h / n, y = y0 + i * hh;
      k.cbox(w, hh + 0.002, d, f.color, 0, y + hh / 2, 0);
      k.cbox(0.02, hh * 0.7, 0.004, f.light, -0.035, y + hh / 2, d / 2 + 0.002);
    });
    const top = F[n - 1];
    k.cyl(w / 2, d, top.color, 0, y0 + h - d / 2 + 0.0, 0, 18, [Math.PI / 2, 0, 0]);
    let yt = y0 + h + w / 2;
    if (s.tops.includes('h')) {
      k.cbox(w + 0.01, 0.1, d + 0.01, SAUCE, 0, yt - 0.075 - 0.02, 0);
      k.cyl(w / 2 + 0.005, d + 0.01, SAUCE, 0, y0 + h - (d + 0.01) / 2, 0, 18, [Math.PI / 2, 0, 0]);
      for (const [x, len] of [[-0.04, 0.04], [0.0, 0.06], [0.045, 0.03]]) {
        k.cbox(0.018, len, 0.012, SAUCE, x, yt - 0.14 - len / 2 + 0.02, d / 2 + 0.004);
      }
    }
    if (s.tops.includes('s')) {
      const rnd = rng(61);
      for (let i = 0; i < 16; i++) {
        const x = (rnd() - 0.5) * w * 0.9, y = yt - 0.02 - rnd() * 0.08;
        k.cbox(0.022, 0.01, 0.012, SPRINKLE_COLORS[i % 6], x, y, d / 2 + 0.008, [0, 0, rnd() * 3]);
      }
      sprinkles(k, 6, 0, yt + 0.004, 0, 0.03, 62);
    }
    if (s.tops.includes('g')) gummies(k, 0, yt - 0.03, 0, 2);
    if (s.tops.includes('w')) yt = whipped(k, 0, yt - 0.03, 0, 0.8);
    if (s.tops.includes('c')) cherry(k, 0, yt - 0.01, 0);
  },
  shake(k, s, F) {
    // a tall glass: flavor layers, a candy-striped straw
    k.cyl(0.07, 0.015, '#DDF3FF', 0, 0, 0, 18);
    const n = F.length, h = 0.25;
    F.forEach((f, i) => {
      const y = 0.012 + (i * h) / n, rb = 0.066 + (i / n) * 0.02, rt = 0.066 + ((i + 1) / n) * 0.02;
      k.cyl(rb, h / n + 0.002, f.color, 0, y, 0, 18, null, rt / rb);
    });
    k.cyl(0.089, 0.02, '#FFFFFF', 0, h, 0, 18);
    k.cbox(0.014, h * 0.8, 0.006, '#FFFFFF', -0.05, h * 0.5, 0.06, [0, -0.7, 0.04]);
    let yt = h + 0.02;
    if (s.tops.includes('w')) yt = whipped(k, 0, yt - 0.01, 0, 1.2);
    else k.ball(0.085, F[n - 1].light, 0, h + 0.005, 0, 14, [1, 0.35, 1]);
    if (s.tops.includes('h')) {
      k.ball(0.06, SAUCE, 0, yt - 0.055, 0, 12, [1.05, 0.4, 1.05]);
      for (let i = 0; i < 4; i++) {
        const a = (i / 4) * Math.PI * 2 + 0.3;
        k.cbox(0.014, 0.05, 0.014, SAUCE, Math.cos(a) * 0.085, h - 0.02, Math.sin(a) * 0.085);
      }
    }
    if (s.tops.includes('s')) sprinkles(k, 14, 0, yt - 0.03, 0, 0.06, 71);
    if (s.tops.includes('g')) gummies(k, 0, yt - 0.06, 0, 3);
    if (s.tops.includes('c')) cherry(k, 0.01, yt - 0.02, 0);
    // straw
    for (let i = 0; i < 7; i++) k.cyl(0.013, 0.05, i % 2 ? '#FFFFFF' : '#FF5FA2', 0.04 + i * 0.012, 0.2 + i * 0.045, -0.02, 8, [0, 0, -0.26]);
  },
  sandwich(k, s, F) {
    // cookie wafers with flavor layers between (stood on its side a little)
    const w = 0.24, d = 0.13, t = 0.03;
    const wafer = (y) => {
      k.box(w, t, d, WAFER, -w / 2, y, -d / 2);
      for (let i = 0; i < 5; i++) for (let j = 0; j < 3; j++) k.box(0.016, 0.004, 0.016, WAFER_DOT, -w / 2 + 0.025 + i * 0.047, y + t, -d / 2 + 0.025 + j * 0.04);
    };
    wafer(0);
    const n = F.length, lh = 0.045;
    F.forEach((f, i) => {
      k.box(w - 0.016, lh, d - 0.012, f.color, -w / 2 + 0.008, t + i * lh, -d / 2 + 0.006);
      k.box(w - 0.06, lh * 0.5, 0.004, f.light, -w / 2 + 0.03, t + i * lh + lh * 0.3, d / 2 - 0.004);
    });
    const yTop = t + n * lh;
    wafer(yTop);
    if (s.tops.includes('s')) {
      const rnd = rng(81);
      for (let i = 0; i < 26; i++) {
        const side = i % 2 ? 1 : -1, x = (rnd() - 0.5) * (w - 0.03);
        k.cbox(0.022, 0.01, 0.01, SPRINKLE_COLORS[i % 6], x, t + rnd() * n * lh, side * (d / 2 - 0.002), [0, 0, rnd() * 3]);
      }
    }
    let yt = yTop + t + 0.004;
    if (s.tops.includes('h')) {
      for (let i = 0; i < 4; i++) k.cbox(0.2 - i * 0.02, 0.008, 0.016, SAUCE, 0, yt, -0.045 + i * 0.03, [0, 0.2 * (i % 2 ? 1 : -1), 0]);
      yt += 0.008;
    }
    if (s.tops.includes('g')) gummies(k, -0.05, yt, 0, 2);
    if (s.tops.includes('w')) yt = whipped(k, 0.04, yt, 0, 0.75);
    if (s.tops.includes('c')) cherry(k, 0.04, yt - 0.01, 0);
  },
};

/** A Kit draw function for a creation (null if the spec is not valid). */
export function drawIceCream(spec) {
  const s = normalize(spec);
  if (!s) return null;
  const F = s.flavors.map((id) => FLAVOR[id]);
  return (k) => DRAW[s.style](k, s, F);
}

/** How she holds each style (see candy.js). */
export function handOf(spec) {
  const s = normalize(spec);
  if (s && s.style === 'sandwich') return { rot: [-1.35, 0, 0], y: 0.13, s: 1 };
  if (s && s.style === 'sundae') return { rot: [0, 0, 0], y: -0.02, s: 0.9 };
  return null;
}
