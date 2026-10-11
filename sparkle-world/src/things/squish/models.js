// Squishy toy models (the squish team doc §7.1): one Kit recipe per `shape`, built from the
// game's own block-and-ball model kit (src/things/furniture/kit.js). Our own designs: closed
// smiles, no teeth, no other company's characters.
//
// toyModel(key, { glitter, live }):
//   live false: every mesh sits directly under the model (marked userData.batch by the Kit), so
//               a placed idle toy is baked into its square's static batch like furniture (0 extra
//               draw calls; a see-through shell keeps 1);
//   live true:  everything is in ONE part `toy` (origin at the toy's bottom centre), so scaling
//               it squashes the toy onto the table (the hand, the shelf, the unwrap, a placed toy
//               while it is being squished).
// sharedToy(key, glitter): a live model whose geometry is shared per key (userData.shared, so
// disposeObject leaves it); the cache is cleared when the world unloads (clearShared()).
// Models are in block units on a 1 x 1 x 1 cell, front +Z; the toy stands at the cell's centre.

import * as THREE from 'three';
import { Kit } from '../furniture/kit.js';
import { glow, sheer, fluffyMat } from '../furniture/paint.js';
import { mulberry32, hashString, mixHex, shade } from '../../core/util.js';
import { item, ITEMS } from './data.js';

/** Every shape a toy may use (tools/test-squish.mjs A1 reads this list). */
export const SHAPES = [
  'berry', 'toast', 'donut', 'cupcake', 'peach', 'icecream', 'macaron', 'melon', 'rocket', 'bunny',
  'catloaf', 'panda', 'bear', 'frog', 'penguin', 'dino', 'shark', 'unicorn', 'whale', 'sloth',
  'octopus', 'dolphin', 'mermaid', 'seadragon', 'blob', 'cube', 'heart', 'star', 'cloud', 'glitter',
  'jelly', 'jellycube', 'fuzzy', 'glow', 'animal', 'egg', 'zoom', 'ball', 'starfish', 'shell',
  'robot', 'volcano',
];

const INK = '#3A1F4D';
const WHITE = '#FFFFFF';
const BLUSH = '#FF9EB8';
const GOLD = '#FFD43B';
const PI = Math.PI;

// ---------------- the drawing helper: a Kit with an origin ----------------

/** Recipes draw around (0, 0, 0) = the toy's bottom centre; `pen` shifts them into the kit. */
function pen(kit, ox, oz) {
  const P = (x, z) => [x + ox, z + oz];
  return {
    kit,
    ball(r, paint, x, y, z, o) { const [a, b] = P(x, z); kit.ball(r, paint, a, y, b, o); return this; },
    box(w, h, d, paint, x, y, z, o) {
      const [a, b] = P(x, z);
      const opts = o && o.pivot ? { ...o, pivot: [o.pivot[0] + ox, o.pivot[1], o.pivot[2] + oz] } : o;
      kit.box(w, h, d, paint, a, y, b, opts);
      return this;
    },
    /** A box centred at (x, y, z). */
    cbox(w, h, d, paint, x, y, z, o) { return this.box(w, h, d, paint, x - w / 2, y - h / 2, z - d / 2, o); },
    cyl(r, h, paint, x, y, z, seg = 14, o) { const [a, b] = P(x, z); kit.cyl(r, h, paint, a, y, b, seg, o); return this; },
    cone(r0, r1, h, paint, x, y, z, seg = 14, o) { const [a, b] = P(x, z); kit.cone(r0, r1, h, paint, a, y, b, seg, o); return this; },
    torus(R, r, paint, x, y, z, o) { const [a, b] = P(x, z); kit.torus(R, r, paint, a, y, b, o); return this; },
    stick(p, q, t, paint) { kit.stick([p[0] + ox, p[1], p[2] + oz], [q[0] + ox, q[1], q[2] + oz], t, paint); return this; },
  };
}

/** z of the front surface of a ball (centre cx, cy, cz, radius r, z-scale sz) at (x, y). */
function front(cx, cy, cz, r, sz = 1) {
  return (x, y) => {
    const dx = (x - cx) / r, dy = (y - cy) / r;
    return cz + r * sz * Math.sqrt(Math.max(0.05, 1 - dx * dx - dy * dy));
  };
}

/**
 * A closed-smile face (eyes with a white shine pixel, a 3-piece smile, pink cheeks) facing +Z on
 * a surface: surf(x, y) gives the z of the surface there. s scales it.
 */
function face(d, cx, cy, surf, s = 1, o = {}) {
  const ink = o.ink || INK;
  const gap = (o.gap || 0.06) * s;
  const ew = 0.034 * s, eh = (o.sleepy ? 0.012 : 0.042) * s, t = 0.03;
  for (const sx of [-1, 1]) {
    const ex = cx + sx * gap;
    const z = surf(ex, cy) - t / 2;
    if (o.sleepy) {
      d.box(ew * 1.3, eh, t, ink, ex - ew * 0.65, cy, z);
    } else {
      d.box(ew, eh, t, ink, ex - ew / 2, cy - eh / 2, z);
      d.box(0.013 * s, 0.013 * s, t, WHITE, ex - ew / 2 + 0.004 * s, cy + eh / 2 - 0.017 * s, z + 0.004);
    }
    if (o.cheeks !== false) {
      const kx = cx + sx * (gap + 0.042 * s);
      d.box(0.04 * s, 0.018 * s, t, o.blush || BLUSH, kx - 0.02 * s, cy - 0.04 * s, surf(kx, cy - 0.04 * s) - t / 2);
    }
  }
  if (o.mouth === false) return;
  // the smile: a little "u", always closed (no teeth anywhere)
  const my = cy - (o.mouthDrop || 0.045) * s, p = 0.012 * s, w = (o.wide ? 0.05 : 0.026) * s;
  d.box(p, p, t, ink, cx - w / 2 - p, my + p * 0.6, surf(cx - w / 2, my) - t / 2);
  d.box(w, p, t, ink, cx - w / 2, my, surf(cx, my) - t / 2);
  d.box(p, p, t, ink, cx + w / 2, my + p * 0.6, surf(cx + w / 2, my) - t / 2);
}

/** n points spread over the front of a ball (golden angle), for seeds, spots and flecks. */
function spots(n, cx, cy, cz, r, { sz = 1, from = 0.15, to = 0.95, back = false, seed = 1 } = {}) {
  const out = [];
  const rand = mulberry32(seed);
  const ga = PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = to - (to - from) * ((i + 0.5) / n);
    const yy = Math.max(-0.92, Math.min(0.92, y));
    const rr = Math.sqrt(1 - yy * yy);
    const a = i * ga + rand() * 0.4;
    const x = Math.cos(a) * rr;
    let z = Math.abs(Math.sin(a) * rr);
    if (back) z = Math.sin(a) * rr;
    out.push([cx + x * r, cy + yy * r, cz + z * r * sz]);
  }
  return out;
}

// ---------------- recipes ----------------
// Each recipe(d, colors, it) draws the toy and returns { cy, r } (a rough body sphere, used for
// the glitter flecks). Puffums stand about 0.46-0.54 tall, Stretchums 0.36-0.42 (fit() sets the final heights, HEIGHTS).

const R = {};

R.berry = (d, [main, seed, leaf]) => {
  d.cone(0.03, 0.19, 0.16, main, 0, 0, 0, 16);
  d.ball(0.215, main, 0, 0.23, 0, { sy: 0.92, seg: 16 });
  for (const [x, y, z] of spots(12, 0, 0.21, 0, 0.215, { from: 0.1, to: 0.75, seed: 3 })) {
    if (Math.abs(x) < 0.09 && y > 0.17 && y < 0.3) continue; // keep the face clear
    d.cbox(0.022, 0.03, 0.02, seed, x, y, z - 0.004);
  }
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2;
    d.cbox(0.08, 0.02, 0.15, leaf, Math.sin(a) * 0.07, 0.42, Math.cos(a) * 0.07, { rot: [0.3, a, 0] });
  }
  d.cyl(0.018, 0.07, shade(leaf, -0.15), 0, 0.41, 0, 6);
  face(d, 0, 0.24, front(0, 0.23, 0, 0.215));
  return { cy: 0.22, r: 0.22 };
};

R.toast = (d, [bread, crust, cheek]) => {
  d.box(0.42, 0.32, 0.15, crust, -0.21, 0.0, -0.085);
  for (const sx of [-1, 1]) d.ball(0.12, crust, sx * 0.1, 0.33, -0.01, { sz: 0.62 });
  d.box(0.37, 0.3, 0.16, bread, -0.185, 0.012, -0.07);
  for (const sx of [-1, 1]) d.ball(0.105, bread, sx * 0.095, 0.33, 0.0, { sz: 0.75 });
  const surf = () => 0.09;
  face(d, 0, 0.2, surf, 1.05, { sleepy: true, blush: cheek });
  return { cy: 0.22, r: 0.22 };
};

R.donut = (d, [dough, icing]) => {
  const rot = { rot: [PI / 2, 0, 0] };
  d.torus(0.165, 0.085, dough, 0, 0.255, -0.01, rot);
  d.torus(0.165, 0.07, icing, 0, 0.255, 0.025, rot);
  const sprinkle = ['#FFFFFF', '#FFE066', '#6CC6FF', '#9BE86A', '#C8B4FF', '#FF5F7E'];
  for (let i = 0; i < 14; i++) {
    const a = (i / 14) * PI * 2 + 0.2;
    const rr = 0.165 + (i % 2 ? 0.03 : -0.03);
    d.cbox(0.036, 0.012, 0.012, sprinkle[i % sprinkle.length], Math.cos(a) * rr, 0.255 + Math.sin(a) * rr, 0.095, { rot: [0, 0, a * 2.3] });
  }
  return { cy: 0.255, r: 0.25 };
};

R.cupcake = (d, [wrap, frost, cherry]) => {
  d.cone(0.14, 0.18, 0.2, wrap, 0, 0, 0, 16);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * PI * 2;
    d.cbox(0.024, 0.2, 0.024, shade(wrap, -0.12), Math.sin(a) * 0.16, 0.1, Math.cos(a) * 0.16, { rot: [0, a, 0] });
  }
  d.ball(0.2, frost, 0, 0.245, 0, { sy: 0.55, seg: 16 });
  d.ball(0.145, frost, 0, 0.33, 0, { sy: 0.65 });
  d.ball(0.085, frost, 0, 0.405, 0, { sy: 0.8 });
  d.ball(0.045, cherry, 0, 0.485, 0);
  d.stick([0, 0.52, 0], [0.03, 0.56, -0.01], 0.012, '#4FB860');
  face(d, 0, 0.115, (x) => 0.165 + 0.01 - Math.abs(x) * 0.15, 0.95);
  return { cy: 0.26, r: 0.22 };
};

R.peach = (d, [main, blush, leaf]) => {
  d.ball(0.225, main, 0, 0.225, 0, { seg: 16 });
  d.box(0.022, 0.3, 0.03, shade(main, -0.12), -0.13, 0.09, 0.15, { rot: [0, -0.6, 0.15] });
  d.cbox(0.11, 0.02, 0.06, leaf, 0.06, 0.465, 0, { rot: [0, 0.3, 0.4] });
  d.cyl(0.015, 0.05, '#8A5A3C', 0, 0.44, 0, 6);
  face(d, 0.02, 0.22, front(0, 0.225, 0, 0.225), 1, { blush });
  return { cy: 0.225, r: 0.225 };
};

R.icecream = (d, [cone, mint, pink]) => {
  d.cone(0.025, 0.14, 0.24, cone, 0, 0, 0, 14);
  for (let i = 0; i < 6; i++) d.cbox(0.02, 0.02, 0.02, shade(cone, -0.2), (i % 3 - 1) * 0.045, 0.1 + Math.floor(i / 3) * 0.06, 0.07 + Math.floor(i / 3) * 0.03);
  d.ball(0.15, mint, 0, 0.29, 0, { seg: 16 });
  d.ball(0.12, pink, 0, 0.41, 0);
  d.ball(0.035, pink, 0.08, 0.34, 0.11, { sy: 1.6 });
  face(d, 0, 0.29, front(0, 0.29, 0, 0.15), 0.85);
  return { cy: 0.32, r: 0.17 };
};

R.macaron = (d, [shell, cream, cheek]) => {
  const rot = { rot: [PI / 2, 0, 0] };
  d.cyl(0.225, 0.085, shell, 0, 0.235, -0.13, 20, rot);
  d.cyl(0.205, 0.08, cream, 0, 0.235, -0.045, 20, rot);
  d.cyl(0.225, 0.085, shell, 0, 0.235, 0.035, 20, rot);
  face(d, 0, 0.25, () => 0.12, 1.1, { blush: cheek });
  return { cy: 0.235, r: 0.23 };
};

R.melon = (d, [red, rind, seed]) => {
  const rows = 10, H = 0.46, W = 0.25;
  for (let i = 0; i < rows; i++) {
    const y = (i / rows) * H;
    const u = (H - (y + H / rows / 2)) / H;
    const half = W * Math.sqrt(Math.max(0.02, 1 - u * u));
    d.box(half * 2, H / rows + 0.001, 0.16, rind, -half, y, -0.08);
    if (i > 0) d.box(half * 2 - 0.06, H / rows + 0.001, 0.02, red, -half + 0.03, y, 0.075);
  }
  d.box(0.44, 0.02, 0.15, '#DFFFC2', -0.22, H - 0.01, -0.075);
  for (const [x, y] of [[-0.14, 0.36], [0.14, 0.36], [-0.09, 0.14], [0.09, 0.14], [0, 0.07]]) d.box(0.018, 0.03, 0.02, seed, x - 0.009, y, 0.09);
  face(d, 0, 0.27, () => 0.095, 1);
  return { cy: 0.25, r: 0.24 };
};

R.rocket = (d, [body, red, sky]) => {
  d.ball(0.14, body, 0, 0.275, 0, { sy: 1.45, seg: 16 });
  d.cone(0.095, 0.0, 0.11, red, 0, 0.43, 0, 14);
  d.ball(0.075, sky, 0, 0.29, 0.1, { sz: 0.6 });
  d.torus(0.075, 0.012, '#C9D6E3', 0, 0.29, 0.115, { rot: [PI / 2, 0, 0] });
  face(d, 0, 0.29, () => 0.15, 0.6, { cheeks: false });
  for (let i = 0; i < 3; i++) {
    const a = (i / 3) * PI * 2 + PI / 3;
    d.cbox(0.025, 0.13, 0.1, red, Math.sin(a) * 0.15, 0.14, Math.cos(a) * 0.15, { rot: [0, a + PI / 2, 0] });
  }
  d.ball(0.065, '#FF9F43', 0, 0.06, 0);
  d.ball(0.045, '#FFD43B', -0.06, 0.045, 0.02);
  d.ball(0.045, '#FFD43B', 0.06, 0.045, -0.02);
  return { cy: 0.27, r: 0.2 };
};

R.bunny = (d, [fur, inner, ink]) => {
  d.ball(0.195, fur, 0, 0.195, 0, { seg: 16 });
  for (const sx of [-1, 1]) {
    d.ball(0.056, fur, sx * 0.075, 0.405, -0.02, { sy: 2.3, rot: [0, 0, sx * -0.18] });
    d.ball(0.03, inner, sx * 0.075, 0.405, 0.02, { sy: 2.1, sz: 0.6, rot: [0, 0, sx * -0.18] });
  }
  d.ball(0.055, WHITE, 0, 0.12, -0.2);
  face(d, 0, 0.2, front(0, 0.195, 0, 0.195), 1, { ink });
  d.ball(0.016, inner, 0, 0.175, front(0, 0.195, 0, 0.195)(0, 0.175));
  return { cy: 0.2, r: 0.2 };
};

R.catloaf = (d, [fur, paw, ink]) => {
  d.ball(0.21, fur, 0, 0.2, 0, { sy: 0.95, sz: 0.85, seg: 16 });
  d.box(0.36, 0.12, 0.3, fur, -0.18, 0.0, -0.15);
  for (const sx of [-1, 1]) {
    d.cone(0.055, 0.0, 0.1, fur, sx * 0.1, 0.35, 0.0, 8, { rot: [0, 0, sx * -0.25] });
    d.cone(0.03, 0.0, 0.06, BLUSH, sx * 0.1, 0.36, 0.02, 8, { rot: [0, 0, sx * -0.25] });
    d.ball(0.045, paw, sx * 0.08, 0.035, 0.16, { sz: 1.2 });
  }
  for (let i = 0; i < 4; i++) d.ball(0.04, fur, 0.2 - i * 0.02, 0.05 + i * 0.03, -0.1 + i * 0.07);
  face(d, 0, 0.22, front(0, 0.2, 0, 0.21, 0.85), 1, { ink });
  return { cy: 0.2, r: 0.21 };
};

R.panda = (d, [white, dark, cheek]) => {
  d.ball(0.21, white, 0, 0.21, 0, { seg: 16 });
  const surf = front(0, 0.21, 0, 0.21);
  for (const sx of [-1, 1]) {
    d.ball(0.062, dark, sx * 0.135, 0.375, -0.02);
    d.ball(0.048, dark, sx * 0.065, 0.24, surf(sx * 0.065, 0.24) - 0.025, { sy: 1.2, sz: 0.5, rot: [0, 0, sx * 0.4] });
    d.ball(0.06, dark, sx * 0.12, 0.05, 0.08);
  }
  face(d, 0, 0.24, (x, y) => surf(x, y) + 0.008, 1, { blush: cheek, ink: '#1E1230' });
  d.ball(0.02, dark, 0, 0.2, surf(0, 0.2));
  return { cy: 0.21, r: 0.21 };
};

R.bear = (d, [fur, cream, heart]) => {
  d.ball(0.16, fur, 0, 0.155, 0, { seg: 14 });
  d.ball(0.1, cream, 0, 0.15, 0.08, { sz: 0.6 });
  d.ball(0.145, fur, 0, 0.36, 0.01, { seg: 16 });
  const surf = front(0, 0.36, 0.01, 0.145);
  d.ball(0.06, cream, 0, 0.33, surf(0, 0.33) - 0.04, { sz: 0.7 });
  for (const sx of [-1, 1]) {
    d.ball(0.05, fur, sx * 0.11, 0.48, 0);
    d.ball(0.028, cream, sx * 0.11, 0.48, 0.025);
    d.ball(0.05, fur, sx * 0.1, 0.035, 0.1, { sz: 1.3 });
  }
  // hugging a little red heart (two balls and a cone)
  d.ball(0.04, heart, -0.03, 0.19, 0.155, { sz: 0.7 });
  d.ball(0.04, heart, 0.03, 0.19, 0.155, { sz: 0.7 });
  d.cone(0.0, 0.065, 0.06, heart, 0, 0.12, 0.152, 10);
  for (const sx of [-1, 1]) d.ball(0.045, fur, sx * 0.09, 0.2, 0.12, { sy: 1.4, rot: [0, 0, sx * 0.9] });
  // a small bow on one ear
  d.cbox(0.035, 0.035, 0.03, '#FFB8D6', 0.13, 0.51, 0.03, { rot: [0, 0, 0.5] });
  d.cbox(0.035, 0.035, 0.03, '#FFB8D6', 0.17, 0.48, 0.03, { rot: [0, 0, 0.5] });
  face(d, 0, 0.38, surf, 0.9);
  d.ball(0.018, INK, 0, 0.345, surf(0, 0.345) + 0.005);
  return { cy: 0.27, r: 0.25 };
};

R.frog = (d, [green, belly, cheek]) => {
  d.ball(0.215, green, 0, 0.19, 0, { sx: 1.12, sy: 0.85, seg: 16 });
  d.ball(0.14, belly, 0, 0.14, 0.09, { sx: 1.2, sz: 0.6 });
  for (const sx of [-1, 1]) {
    d.ball(0.075, green, sx * 0.1, 0.385, 0.03);
    d.ball(0.045, WHITE, sx * 0.1, 0.39, 0.075, { sz: 0.6 });
    d.cbox(0.03, 0.04, 0.02, INK, sx * 0.1, 0.385, 0.105);
    d.cbox(0.012, 0.012, 0.01, WHITE, sx * 0.1 - 0.006, 0.397, 0.117);
    d.ball(0.06, green, sx * 0.14, 0.035, 0.12, { sx: 1.3, sy: 0.5 });
    d.cbox(0.045, 0.02, 0.02, cheek, sx * 0.17, 0.25, front(0, 0.19, 0, 0.215)(sx * 0.17, 0.25) - 0.012);
  }
  // a big closed smile
  const surf = front(0, 0.19, 0, 0.215);
  d.cbox(0.12, 0.014, 0.03, INK, 0, 0.27, surf(0, 0.27) - 0.012);
  for (const sx of [-1, 1]) d.cbox(0.014, 0.022, 0.03, INK, sx * 0.065, 0.282, surf(sx * 0.065, 0.282) - 0.012);
  return { cy: 0.22, r: 0.24 };
};

R.penguin = (d, [navy, white, orange]) => {
  d.ball(0.18, navy, 0, 0.235, 0, { sy: 1.3, seg: 16 });
  d.ball(0.14, white, 0, 0.21, 0.05, { sy: 1.25, sz: 0.85 });
  const surf = front(0, 0.235, 0, 0.18);
  for (const sx of [-1, 1]) {
    d.ball(0.05, navy, sx * 0.17, 0.22, 0, { sy: 2.0, sz: 0.6, rot: [0, 0, sx * 0.3] });
    d.ball(0.05, orange, sx * 0.07, 0.02, 0.1, { sy: 0.45, sz: 1.5 });
    d.ball(0.05, white, sx * 0.06, 0.36, surf(sx * 0.06, 0.36) - 0.04, { sz: 0.6 });
  }
  d.cone(0.03, 0.0, 0.07, orange, 0, 0.31, surf(0, 0.31) - 0.01, 8, { rot: [PI / 2, 0, 0] });
  face(d, 0, 0.37, (x, y) => surf(x, y) + 0.005, 0.9, { mouth: false });
  return { cy: 0.235, r: 0.22 };
};

R.dino = (d, [green, spike, ink]) => {
  d.ball(0.19, green, 0, 0.19, -0.03, { sy: 0.95, seg: 16 });
  d.ball(0.135, green, 0, 0.35, 0.06, { seg: 16 });
  d.ball(0.1, mixHex(green, '#FFFFFF', 0.45), 0, 0.15, 0.08, { sz: 0.7 });
  d.cone(0.085, 0.02, 0.2, green, 0, 0.1, -0.16, 10, { rot: [-PI / 2 - 0.25, 0, 0] });
  for (let i = 0; i < 4; i++) {
    const a = -0.4 - i * 0.42;
    const y = 0.19 + Math.cos(a) * 0.18, z = -0.03 + Math.sin(a) * 0.18;
    d.cone(0.04, 0.012, 0.07, spike, 0, y, z, 8, { rot: [a, 0, 0] });
    d.ball(0.016, spike, 0, y + Math.cos(a) * 0.07, z + Math.sin(a) * 0.07);
  }
  for (const sx of [-1, 1]) {
    d.ball(0.035, green, sx * 0.12, 0.2, 0.13, { sy: 1.4, rot: [0.6, 0, sx * 0.4] });
    d.ball(0.05, green, sx * 0.1, 0.035, 0.08, { sz: 1.3 });
  }
  face(d, 0, 0.37, front(0, 0.35, 0.06, 0.135), 0.85, { ink });
  return { cy: 0.25, r: 0.24 };
};

R.shark = (d, [blue, belly, ink]) => {
  d.ball(0.2, blue, 0, 0.2, 0, { sx: 1.12, seg: 16 });
  d.ball(0.15, belly, 0, 0.15, 0.07, { sx: 1.1, sz: 0.7 });
  d.ball(0.075, blue, 0, 0.42, -0.03, { sx: 0.32, sy: 1.25, sz: 1.1, rot: [-0.35, 0, 0] });
  for (const sx of [-1, 1]) {
    d.ball(0.075, blue, sx * 0.075, 0.2, -0.24, { sx: 0.35, sy: 1.3, rot: [0, 0, sx * 0.7] });
    d.ball(0.05, blue, sx * 0.19, 0.12, 0.05, { sx: 0.4, sy: 1.3, rot: [0.4, 0, sx * 0.9] });
  }
  // closed smile and pink blush, no teeth
  face(d, 0, 0.25, front(0, 0.2, 0, 0.2), 1, { ink, wide: true });
  return { cy: 0.2, r: 0.22 };
};

R.unicorn = (d, [white, mane, horn]) => {
  d.ball(0.2, white, 0, 0.2, 0, { seg: 16 });
  d.cone(0.035, 0.0, 0.14, horn, 0, 0.37, 0.07, 10, { rot: [0.35, 0, 0] });
  for (let i = 0; i < 3; i++) d.cbox(0.06 - i * 0.012, 0.01, 0.01, shade(horn, -0.15), 0, 0.4 + i * 0.035, 0.085 + i * 0.012);
  const rainbow = ['#FFD1E6', '#C8B4FF', '#A6D8FF', '#BDF2DA', '#FFE9A8'];
  for (let i = 0; i < 5; i++) {
    const a = 0.25 + i * 0.42;
    d.ball(0.055, rainbow[i], -0.05, 0.2 + Math.cos(a) * 0.19, Math.sin(-a) * 0.17 + 0.02);
  }
  d.ball(0.05, mane, 0.04, 0.37, -0.06);
  for (const sx of [-1, 1]) d.cone(0.04, 0.0, 0.07, white, sx * 0.11, 0.35, 0.0, 8, { rot: [0, 0, sx * -0.4] });
  face(d, 0, 0.21, front(0, 0.2, 0, 0.2), 1);
  return { cy: 0.2, r: 0.21 };
};

R.whale = (d, [blue, belly, ink]) => {
  d.ball(0.205, blue, 0, 0.205, 0, { sx: 1.18, seg: 16 });
  d.ball(0.14, belly, 0, 0.14, 0.08, { sx: 1.3, sz: 0.6 });
  for (const sx of [-1, 1]) d.ball(0.07, blue, sx * 0.08, 0.3, -0.22, { sy: 0.35, sx: 1.4, rot: [0.5, 0, sx * 0.5] });
  d.ball(0.035, belly, 0, 0.44, 0);
  d.ball(0.03, belly, -0.04, 0.48, 0.01);
  d.ball(0.03, belly, 0.04, 0.48, -0.01);
  d.cyl(0.016, 0.05, belly, 0, 0.395, 0, 6);
  face(d, 0, 0.22, front(0, 0.205, 0, 0.205), 1, { ink });
  return { cy: 0.21, r: 0.23 };
};

R.sloth = (d, [fur, mask, ink]) => {
  d.ball(0.21, fur, 0, 0.23, 0, { sy: 1.05, seg: 16 });
  const surf = front(0, 0.23, 0, 0.21);
  d.ball(0.12, mask, 0, 0.27, surf(0, 0.27) - 0.09, { sx: 1.25, sy: 0.85, sz: 0.65 });
  for (const sx of [-1, 1]) d.cbox(0.06, 0.026, 0.02, shade(fur, -0.35), sx * 0.06, 0.285, surf(sx * 0.06, 0.285) + 0.004, { rot: [0, 0, sx * -0.3] });
  face(d, 0, 0.285, (x, y) => surf(x, y) + 0.012, 0.95, { sleepy: true, ink, mouthDrop: 0.05 });
  // long arms hugging itself
  for (const sx of [-1, 1]) d.ball(0.045, shade(fur, -0.08), sx * 0.05, 0.14, surf(sx * 0.05, 0.14) - 0.02, { sx: 3.0, rot: [0, 0, sx * 0.25] });
  return { cy: 0.23, r: 0.22 };
};

R.octopus = (d, [pink, spot, ink]) => {
  d.ball(0.19, pink, 0, 0.29, 0, { sy: 1.08, seg: 16 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * PI * 2 + PI / 6;
    const x = Math.sin(a), z = Math.cos(a);
    d.ball(0.055, pink, x * 0.12, 0.09, z * 0.12, { sy: 1.4 });
    d.ball(0.045, pink, x * 0.19, 0.045, z * 0.19);
    d.ball(0.032, pink, x * 0.235, 0.075, z * 0.235);
  }
  for (const [x, y, z] of spots(5, 0, 0.3, 0, 0.19, { from: 0.55, to: 0.95, seed: 7 })) if (Math.abs(x) > 0.06 || y > 0.42) d.ball(0.022, spot, x, y, z - 0.008, { sz: 0.5 });
  face(d, 0, 0.27, front(0, 0.29, 0, 0.19), 1, { ink });
  return { cy: 0.26, r: 0.22 };
};

R.dolphin = (d, [blue, belly, ink]) => {
  d.ball(0.185, blue, 0, 0.21, -0.02, { sz: 1.25, seg: 16 });
  d.ball(0.13, belly, 0, 0.15, 0.05, { sz: 1.2, sx: 0.95 });
  d.ball(0.06, blue, 0, 0.175, 0.24, { sz: 1.5, sy: 0.8 });
  d.ball(0.045, belly, 0, 0.155, 0.25, { sz: 1.4, sy: 0.6 });
  d.cbox(0.06, 0.01, 0.02, ink, 0, 0.165, 0.305);
  d.ball(0.075, blue, 0, 0.42, -0.06, { sx: 0.3, sy: 1.1, sz: 1.2, rot: [-0.5, 0, 0] });
  for (const sx of [-1, 1]) {
    d.ball(0.06, blue, sx * 0.17, 0.12, 0.06, { sx: 0.35, sy: 1.4, rot: [0.6, 0, sx * 0.9] });
    d.ball(0.07, blue, sx * 0.07, 0.3, -0.27, { sy: 0.3, sx: 1.5, rot: [0.9, 0, sx * 0.55] });
  }
  const surf = front(0, 0.21, -0.02, 0.185, 1.25);
  for (const sx of [-1, 1]) {
    const ex = sx * 0.085, ey = 0.27;
    const z = surf(ex, ey);
    d.cbox(0.032, 0.04, 0.03, ink, ex, ey, z - 0.012);
    d.cbox(0.012, 0.012, 0.01, WHITE, ex - 0.006, ey + 0.01, z + 0.004);
    d.cbox(0.04, 0.018, 0.03, BLUSH, sx * 0.13, 0.225, surf(sx * 0.13, 0.225) - 0.014);
  }
  return { cy: 0.22, r: 0.24 };
};

R.mermaid = (d, [green, lilac, pearl]) => {
  // a plump J-curl of tail standing on its curl, mint at the bottom to lilac at the top
  const curl = [[0.07, 0.115, 0.0, 0.115], [-0.05, 0.105, 0.0, 0.11], [-0.07, 0.22, 0.0, 0.1], [-0.04, 0.31, 0.0, 0.085], [-0.005, 0.38, 0.0, 0.07]];
  curl.forEach(([x, y, z, r], i) => d.ball(r, mixHex(green, lilac, i / 4), x, y, z, { seg: 14 }));
  for (const [x, y, z] of spots(10, -0.03, 0.25, 0, 0.1, { from: 0.0, to: 0.8, seed: 11 })) d.cbox(0.022, 0.016, 0.02, mixHex(lilac, '#FFFFFF', 0.5), x, y, z + 0.004, { rot: [0, 0, 0.6] });
  // merfolk's round two-lobed fin at the top
  for (const sx of [-1, 1]) d.ball(0.085, lilac, sx * 0.075, 0.47, 0.0, { sx: 1.15, sy: 0.6, sz: 0.4, rot: [0, 0, sx * 0.45] });
  d.ball(0.04, lilac, 0, 0.43, 0);
  d.ball(0.032, pearl, 0.12, 0.17, 0.08);
  face(d, 0.07, 0.125, front(0.07, 0.115, 0, 0.115), 0.75);
  return { cy: 0.25, r: 0.2 };
};

R.seadragon = (d, [teal, gold, ink]) => {
  // merfolk's Sea Dragon motifs (C9): a rounded fan fluke with five soft ribs, round bubble-dome
  // spikes along the back, leafy fronds on the tail, glow-spot pixels, two soft horn nubs
  d.ball(0.18, teal, 0, 0.18, -0.02, { seg: 16 });
  d.ball(0.11, mixHex(teal, '#FFFFFF', 0.45), 0, 0.15, 0.08, { sz: 0.65 });
  d.ball(0.135, teal, 0, 0.36, 0.04, { seg: 16 });
  for (const sx of [-1, 1]) {
    d.ball(0.028, gold, sx * 0.055, 0.49, 0.02, { sy: 1.4 });
    d.ball(0.045, teal, sx * 0.1, 0.035, 0.08, { sz: 1.3 });
    d.ball(0.035, teal, sx * 0.13, 0.19, 0.11, { sy: 1.4, rot: [0.6, 0, sx * 0.4] });
  }
  for (let i = 0; i < 4; i++) {
    const a = -0.5 - i * 0.45;
    d.ball(0.032, gold, 0, 0.18 + Math.cos(a) * 0.185, -0.02 + Math.sin(a) * 0.185);
  }
  // the tail with its fan fluke and fronds
  d.ball(0.07, teal, 0, 0.07, -0.2, { sz: 1.4 });
  d.ball(0.1, gold, 0, 0.16, -0.29, { sx: 1.3, sy: 1.0, sz: 0.25, rot: [-0.4, 0, 0] });
  for (let i = 0; i < 5; i++) {
    const a = -0.9 + i * 0.45;
    d.stick([0, 0.1, -0.27], [Math.sin(a) * 0.12, 0.1 + Math.cos(a) * 0.12, -0.3], 0.014, shade(gold, -0.2));
  }
  for (const sx of [-1, 1]) d.ball(0.035, '#7FD37A', sx * 0.07, 0.08, -0.2, { sx: 0.4, sy: 1.5, rot: [0, 0, sx * 0.8] });
  const glowSpot = glow('#BFFFF2', 0.6);
  const surf = front(0, 0.36, 0.04, 0.135);
  for (const [x, y] of [[-0.1, 0.33], [0.1, 0.33], [-0.13, 0.4], [0.13, 0.4]]) d.cbox(0.018, 0.018, 0.02, glowSpot, x, y, surf(x, y) - 0.006);
  face(d, 0, 0.375, surf, 0.85, { ink });
  return { cy: 0.26, r: 0.24 };
};

// Stretchums

R.blob = (d, [main, shine, ink]) => {
  d.ball(0.2, main, 0, 0.185, 0, { sy: 0.92, seg: 16 });
  const surf = front(0, 0.185, 0, 0.2);
  d.ball(0.025, shine, -0.1, 0.28, surf(-0.1, 0.28) - 0.015, { sz: 0.5 });
  face(d, 0, 0.19, surf, 0.8, { ink });
  return { cy: 0.185, r: 0.2 };
};

function roundCube(d, s, h, paint, y0 = 0) {
  const r = 0.05;
  d.box(s, h - 2 * r, s - 2 * r, paint, -s / 2, y0 + r, -s / 2 + r);
  d.box(s - 2 * r, h, s - 2 * r, paint, -s / 2 + r, y0, -s / 2 + r);
  d.box(s - 2 * r, h - 2 * r, s, paint, -s / 2 + r, y0 + r, -s / 2);
  for (const x of [-1, 1]) for (const y of [0, 1]) for (const z of [-1, 1]) d.ball(r, paint, x * (s / 2 - r), y0 + r + y * (h - 2 * r), z * (s / 2 - r), { seg: 8 });
  for (const x of [-1, 1]) for (const z of [-1, 1]) d.cyl(r, h - 2 * r, paint, x * (s / 2 - r), y0 + r, z * (s / 2 - r), 8);
}

R.cube = (d, [main, shine, ink]) => {
  roundCube(d, 0.36, 0.36, main);
  d.cbox(0.04, 0.04, 0.02, shine, -0.11, 0.29, 0.18);
  face(d, 0, 0.19, () => 0.18, 0.9, { ink });
  return { cy: 0.18, r: 0.21 };
};

R.heart = (d, [red, shine, ink]) => {
  for (const sx of [-1, 1]) d.ball(0.115, red, sx * 0.085, 0.27, 0, { sz: 0.75, seg: 14 });
  d.cbox(0.24, 0.24, 0.15, red, 0, 0.17, 0, { rot: [0, 0, PI / 4] }); // the point: a flat diamond
  d.ball(0.022, shine, -0.1, 0.32, 0.08, { sz: 0.5 });
  face(d, 0, 0.235, (x, y) => 0.1 - Math.abs(x) * 0.08, 0.8, { ink });
  return { cy: 0.22, r: 0.2 };
};

R.star = (d, [yellow, shine, ink]) => {
  const cy = 0.17;
  d.ball(0.11, yellow, 0, cy, 0, { sz: 0.85, seg: 14 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2;
    d.cone(0.075, 0.025, 0.17, yellow, 0, cy, 0, 10, { rot: [0, 0, -a] });
    d.ball(0.026, yellow, Math.sin(a) * 0.17, cy + Math.cos(a) * 0.17, 0);
  }
  face(d, 0, 0.18, () => 0.088, 0.75, { ink });
  return { cy, r: 0.2 };
};

R.cloud = (d, [white, shine, ink]) => {
  d.ball(0.13, white, 0, 0.23, 0, { seg: 14 });
  for (const sx of [-1, 1]) {
    d.ball(0.1, white, sx * 0.12, 0.14, 0);
    d.ball(0.075, white, sx * 0.2, 0.08, 0.0);
  }
  d.ball(0.11, white, 0, 0.11, 0.02, { sx: 1.3 });
  d.box(0.44, 0.05, 0.16, white, -0.22, 0.0, -0.08);
  face(d, 0, 0.19, front(0, 0.23, 0, 0.13), 0.8, { ink });
  return { cy: 0.16, r: 0.2 };
};

/** See-through stretchums: an inner atlas part plus a sheer shell (always its own mesh). */
function shellBall(d, paint, r = 0.19, cy = 0.19) {
  d.ball(r, sheer(paint, 0.55), 0, cy, 0, { seg: 18, sy: 0.96 });
}

R.glitter = (d, [main, a, b], it) => {
  const rand = mulberry32(hashString(it.key));
  const cols = it.key === 'st_rainbow' ? ['#FF5F7E', '#FFB347', '#FFE066', '#7FD37A', '#6CC6FF', '#9C7BFF'] : [a, b];
  for (let i = 0; i < 22; i++) {
    const rr = 0.13 * Math.cbrt(rand()), th = rand() * PI * 2, ph = Math.acos(2 * rand() - 1);
    const x = rr * Math.sin(ph) * Math.cos(th), y = 0.19 + rr * Math.cos(ph), z = rr * Math.sin(ph) * Math.sin(th);
    const c = glow(cols[i % cols.length], 0.6);
    if (it.key === 'st_galaxy') {
      d.cbox(0.034, 0.01, 0.01, c, x, y, z);
      d.cbox(0.01, 0.034, 0.01, c, x, y, z);
    } else d.cbox(0.02, 0.02, 0.02, c, x, y, z, { rot: [rand() * 3, rand() * 3, 0] });
  }
  d.ball(0.06, glow(a, 0.3), 0, 0.19, 0);
  shellBall(d, main);
  return { cy: 0.19, r: 0.2 };
};

R.jelly = (d, [main, inner, detail], it) => {
  const rand = mulberry32(hashString(it.key));
  if (it.key === 'st_ocean') {
    // two tiny plain orange fish (one color, no stripes)
    for (const [x, y, z, ry] of [[-0.05, 0.22, 0.02, 0.3], [0.06, 0.15, -0.03, PI + 0.4]]) {
      d.ball(0.032, inner, x, y, z, { sx: 1.5, rot: [0, ry, 0] });
      d.cone(0.025, 0.0, 0.04, inner, x - Math.cos(ry) * 0.06, y, z + Math.sin(ry) * 0.06, 6, { rot: [0, ry, PI / 2] });
    }
    for (let i = 0; i < 6; i++) d.ball(0.012, detail, (rand() - 0.5) * 0.2, 0.1 + rand() * 0.18, (rand() - 0.5) * 0.16);
  } else {
    for (let i = 0; i < 9; i++) d.ball(0.012 + rand() * 0.02, inner, (rand() - 0.5) * 0.22, 0.08 + rand() * 0.22, (rand() - 0.5) * 0.2);
    face(d, 0, 0.2, front(0, 0.19, 0, 0.19), 0.75, { ink: detail });
  }
  shellBall(d, main);
  return { cy: 0.19, r: 0.2 };
};

R.jellycube = (d, [main, inner, ink], it) => {
  const rand = mulberry32(hashString(it.key));
  for (let i = 0; i < 9; i++) d.ball(0.012 + rand() * 0.02, inner, (rand() - 0.5) * 0.24, 0.07 + rand() * 0.24, (rand() - 0.5) * 0.24);
  face(d, 0, 0.2, () => 0.18, 0.85, { ink });
  d.box(0.36, 0.36, 0.36, sheer(main, 0.55), -0.18, 0.0, -0.18);
  return { cy: 0.18, r: 0.21 };
};

R.fuzzy = (d, [main, accent, ink], it) => {
  d.ball(0.195, fluffyMat(main), 0, 0.19, 0, { sy: 0.95, seg: 16 });
  const surf = front(0, 0.19, 0, 0.195);
  if (it.key === 'st_snowball') {
    for (const [x, y, z] of spots(6, 0, 0.19, 0, 0.195, { from: -0.6, to: 0.9, seed: 5 })) {
      if (Math.abs(x) < 0.1 && y > 0.12 && y < 0.25) continue;
      d.cbox(0.04, 0.01, 0.015, accent, x, y, z - 0.004);
      d.cbox(0.01, 0.04, 0.015, accent, x, y, z - 0.004);
    }
    face(d, 0, 0.2, surf, 0.8, { ink });
  } else {
    d.cbox(0.014, 0.08, 0.02, shade(main, -0.12), -0.02, 0.33, surf(-0.02, 0.33) - 0.01, { rot: [0, 0, 0.2] });
    d.cbox(0.06, 0.02, 0.03, '#7FD37A', 0.03, 0.38, 0, { rot: [0, 0.3, 0.4] });
    face(d, 0, 0.2, surf, 0.8, { ink, blush: accent });
  }
  return { cy: 0.19, r: 0.2 };
};

R.glow = (d, [main, crater, ink]) => {
  d.ball(0.195, glow(main, 0.35), 0, 0.19, 0, { sy: 0.95, seg: 16 });
  const surf = front(0, 0.19, 0, 0.195);
  for (const [x, y, z] of [[-0.12, 0.28], [0.11, 0.3], [0.13, 0.12], [-0.09, 0.08]].map(([x, y]) => [x, y, surf(x, y)])) d.ball(0.025, crater, x, y, z - 0.012, { sz: 0.45 });
  face(d, 0, 0.2, surf, 0.8, { ink, sleepy: true });
  return { cy: 0.19, r: 0.2 };
};

R.animal = (d, [main, accent, ink], it) => {
  d.ball(0.195, main, 0, 0.185, 0, { sy: 0.95, seg: 16 });
  const surf = front(0, 0.185, 0, 0.195);
  if (it.key === 'st_kitty') {
    for (const sx of [-1, 1]) {
      d.cone(0.05, 0.0, 0.09, main, sx * 0.1, 0.32, 0, 8, { rot: [0, 0, sx * -0.3] });
      d.cone(0.028, 0.0, 0.05, accent, sx * 0.1, 0.33, 0.02, 8, { rot: [0, 0, sx * -0.3] });
      for (const dy of [-0.012, 0.012]) d.cbox(0.07, 0.007, 0.01, ink, sx * 0.17, 0.165 + dy, surf(sx * 0.15, 0.165) - 0.004, { rot: [0, 0, sx * dy * 8] });
    }
    d.ball(0.016, accent, 0, 0.165, surf(0, 0.165));
    face(d, 0, 0.2, surf, 0.8, { ink, mouthDrop: 0.06 });
  } else if (it.key === 'st_ducky') {
    d.ball(0.05, accent, 0, 0.16, surf(0, 0.16) - 0.01, { sx: 1.3, sy: 0.55, sz: 1.0 });
    for (let i = 0; i < 3; i++) d.ball(0.025, main, (i - 1) * 0.025, 0.37 + (i === 1 ? 0.02 : 0), 0.0, { sy: 1.6, rot: [0, 0, (i - 1) * -0.5] });
    face(d, 0, 0.22, surf, 0.8, { ink, mouth: false });
  } else {
    d.cyl(0.045, 0.04, accent, 0, 0.165, surf(0, 0.165) - 0.03, 12, { rot: [PI / 2, 0, 0] });
    for (const sx of [-1, 1]) {
      d.cbox(0.012, 0.016, 0.01, shade(accent, -0.3), sx * 0.015, 0.165, surf(0, 0.165) + 0.012);
      d.ball(0.05, accent, sx * 0.12, 0.31, 0.03, { sy: 0.4, sx: 1.2, rot: [0.6, 0, sx * -0.6] });
    }
    face(d, 0, 0.23, surf, 0.8, { ink, mouth: false });
  }
  return { cy: 0.185, r: 0.2 };
};

R.egg = (d, [shell, speck, ink]) => {
  d.ball(0.165, shell, 0, 0.21, 0, { sy: 1.25, seg: 16 });
  const surf = front(0, 0.21, 0, 0.165);
  for (const [x, y, z] of spots(9, 0, 0.21, 0, 0.165, { from: -0.7, to: 0.9, seed: 9 })) {
    if (Math.abs(x) < 0.08 && y > 0.2 && y < 0.32) continue;
    d.ball(0.018, speck, x, y, z - 0.008, { sz: 0.4 });
  }
  // the crack, and a little dino face peeking out of it
  for (let i = 0; i < 7; i++) {
    const x = -0.12 + i * 0.04;
    d.cbox(0.045, 0.012, 0.02, ink, x, 0.2 + (i % 2 ? 0.02 : -0.01), surf(x, 0.2) - 0.006, { rot: [0, 0, i % 2 ? -0.5 : 0.5] });
  }
  d.ball(0.075, speck, 0, 0.28, surf(0, 0.28) - 0.06, { sz: 0.7 });
  face(d, 0, 0.29, (x, y) => surf(x, y) + 0.004, 0.7, { ink });
  return { cy: 0.21, r: 0.2 };
};

R.zoom = (d, [teal, star, ink]) => {
  d.ball(0.18, teal, 0, 0.17, 0, { sy: 0.95, seg: 16 });
  const surf = front(0, 0.17, 0, 0.18);
  for (const sx of [-1, 1]) {
    // two big shiny eyes
    d.ball(0.045, WHITE, sx * 0.065, 0.21, surf(sx * 0.065, 0.21) - 0.03, { sz: 0.6 });
    d.cbox(0.03, 0.036, 0.02, ink, sx * 0.065, 0.205, surf(sx * 0.065, 0.205) + 0.004);
    d.cbox(0.012, 0.012, 0.01, WHITE, sx * 0.065 - 0.006, 0.215, surf(sx * 0.065, 0.215) + 0.016);
    // bendy antennae (3 tilted little balls) tipped with yellow stars
    for (let i = 0; i < 3; i++) d.ball(0.018, teal, sx * (0.06 + i * 0.022), 0.33 + i * 0.026, -0.01, { sy: 1.4, rot: [0, 0, sx * -0.6] });
    const tx = sx * 0.13, ty = 0.42;
    d.cbox(0.05, 0.016, 0.016, star, tx, ty, -0.01);
    d.cbox(0.016, 0.05, 0.016, star, tx, ty, -0.01);
    d.cbox(0.03, 0.03, 0.018, star, tx, ty, -0.01, { rot: [0, 0, PI / 4] });
  }
  face(d, 0, 0.21, surf, 0.8, { ink, gap: 0.08, mouthDrop: 0.07, cheeks: false });
  return { cy: 0.17, r: 0.19 };
};

R.ball = (d, [white, patch, cheek], it) => {
  d.ball(0.19, white, 0, 0.19, 0, { seg: 18 });
  const pts = spots(10, 0, 0.19, 0, 0.19, { from: -0.9, to: 0.95, back: true, seed: hashString(it.key) & 255 });
  for (const [x, y, z] of pts) {
    const n = [x, y - 0.19, z];
    const ry = Math.atan2(n[0], n[2]), rx = -Math.asin(Math.max(-1, Math.min(1, n[1] / 0.19)));
    d.cbox(0.06, 0.06, 0.02, patch, x, y, z, { rot: [rx, ry, 0] });
  }
  d.ball(0.02, cheek, 0, 0.395, 0);
  return { cy: 0.19, r: 0.2 };
};

R.starfish = (d, [orange, dots, ink]) => {
  // five plump arms, sitting up a little so its face shows (a starfish is flat)
  const cy = 0.18, tilt = -0.32;
  d.ball(0.085, orange, 0, cy, 0, { sz: 0.6, rot: [tilt, 0, 0] });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2;
    d.cone(0.075, 0.04, 0.16, orange, 0, cy, 0, 10, { rot: [tilt, 0, -a] });
    d.ball(0.042, orange, Math.sin(a) * 0.16, cy + Math.cos(a) * 0.16 * Math.cos(tilt), -Math.cos(a) * 0.16 * Math.sin(-tilt), { sz: 0.8 });
    for (const k of [0.07, 0.12]) d.cbox(0.016, 0.016, 0.016, dots, Math.sin(a) * k, cy + Math.cos(a) * k * Math.cos(tilt), 0.06 - Math.cos(a) * k * Math.sin(-tilt));
  }
  face(d, 0, cy + 0.01, (x, y) => 0.07 + (y - cy) * 0.3, 0.6, { ink, gap: 0.05 });
  return { cy, r: 0.2 };
};

R.shell = (d, [pink, cream, pearl]) => {
  for (let i = 0; i < 5; i++) {
    const a = -0.72 + i * 0.36;
    d.ball(0.065, i % 2 ? cream : pink, Math.sin(a) * 0.15, 0.06 + Math.cos(a) * 0.17, 0, { sy: 2.8, sz: 0.55, rot: [0, 0, -a] });
  }
  d.ball(0.12, pink, 0, 0.2, -0.02, { sx: 1.5, sy: 1.35, sz: 0.35 });
  d.ball(0.055, cream, 0, 0.05, 0.02, { sx: 1.5, sy: 0.7 });
  d.ball(0.035, pearl, 0, 0.08, 0.06);
  face(d, 0, 0.22, () => 0.05, 0.75, { ink: INK });
  return { cy: 0.2, r: 0.2 };
};

R.robot = (d, [grey, screen, light]) => {
  roundCube(d, 0.34, 0.33, grey);
  d.box(0.24, 0.17, 0.02, screen, -0.12, 0.1, 0.165);
  face(d, 0, 0.2, () => 0.19, 0.85, { ink: INK, cheeks: false });
  for (const sx of [-1, 1]) {
    d.cyl(0.035, 0.04, shade(grey, -0.2), sx * 0.17, 0.2, 0, 8, { rot: [0, 0, sx * -PI / 2] });
    d.cbox(0.03, 0.03, 0.03, light, sx * 0.13, 0.13, 0.17);
  }
  d.cyl(0.012, 0.05, shade(grey, -0.2), 0, 0.33, 0, 6);
  d.ball(0.03, glow(light, 0.5), 0, 0.395, 0);
  return { cy: 0.18, r: 0.21 };
};

R.volcano = (d, [rock, lava, drip]) => {
  d.cone(0.22, 0.1, 0.27, rock, 0, 0, 0, 16);
  d.ball(0.11, lava, 0, 0.29, 0, { sy: 0.55 });
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * PI * 2 + 0.3;
    d.ball(0.025, drip, Math.sin(a) * 0.12, 0.23 - (i % 2) * 0.04, Math.cos(a) * 0.12, { sy: 1.8 });
  }
  d.ball(0.04, glow(lava, 0.4), 0, 0.34, 0);
  face(d, 0, 0.13, (x) => 0.165 - Math.abs(x) * 0.25, 0.85, { ink: INK });
  return { cy: 0.17, r: 0.22 };
};

// ---------------- building ----------------

/** Toy heights in block units (the squish team doc §7.1): Puffums, Stretchums. */
export const HEIGHTS = { puff: [0.48, 0.54], stretch: [0.39, 0.42] };
const _box = new THREE.Box3();

/**
 * Scale the toy's meshes (about its bottom centre) into its kind's height range and stand it on
 * y = 0. Works the same for idle meshes (children of the model) and live ones (in part `toy`).
 */
function fit(g, key, live) {
  const it = item(key);
  if (!it) return;
  g.updateMatrixWorld(true);
  _box.makeEmpty();
  const meshes = [];
  g.traverse((o) => {
    if (o.isMesh && !o.userData.hitbox) {
      meshes.push(o);
      _box.expandByObject(o);
    }
  });
  if (_box.isEmpty()) return;
  const h = _box.max.y - _box.min.y;
  const [lo, hi] = HEIGHTS[it.kind] || [h, h];
  const s = h > hi ? hi / h : h < lo ? lo / h : 1;
  const y = -_box.min.y * s;
  for (const m of meshes) {
    m.scale.setScalar(s);
    if (live) m.position.set(0, y, 0);
    else m.position.set(0.5 * (1 - s), y, 0.5 * (1 - s));
  }
}

function drawToy(d, key, glitter) {
  const it = item(key);
  if (!it) throw new Error('unknown toy ' + key);
  const recipe = R[it.shape];
  if (!recipe) throw new Error('no recipe for ' + it.shape);
  const body = recipe(d, it.colors, it) || { cy: 0.2, r: 0.2 };
  if (glitter) {
    // 12 tiny star flecks on the surface and a gold rim on the base
    const fleck = glow('#FFF6C8', 0.8);
    for (const [x, y, z] of spots(12, 0, body.cy, 0, body.r + 0.012, { from: -0.5, to: 0.95, seed: hashString(key) })) {
      d.cbox(0.03, 0.009, 0.009, fleck, x, y, z);
      d.cbox(0.009, 0.03, 0.009, fleck, x, y, z);
    }
    d.torus(0.17, 0.014, GOLD, 0, 0.012, 0);
  }
}

const warned = new Set();
function fallback(d, key) {
  const it = item(key);
  d.ball(0.19, (it && it.colors[0]) || '#FF9CCB', 0, 0.19, 0, { seg: 14 });
}

/**
 * A toy model on a 1 x 1 x 1 cell. live: the meshes in one part `toy` (squishable); else
 * directly under the model (batched when placed). name = 'squish:<key>' (+ ':g').
 */
export function toyModel(key, { glitter = false, live = false, hitbox = true } = {}) {
  const k = new Kit();
  const target = live ? k.part('toy', 0.5, 0, 0.5) : k;
  const d = pen(target, live ? 0 : 0.5, live ? 0 : 0.5);
  try {
    drawToy(d, key, glitter);
  } catch (err) {
    if (!warned.has(key)) {
      warned.add(key);
      console.warn('[squish] drawing a plain ball for', key, err && err.message);
    }
    const k2 = new Kit();
    const t2 = live ? k2.part('toy', 0.5, 0, 0.5) : k2;
    fallback(pen(t2, live ? 0 : 0.5, live ? 0 : 0.5), key);
    if (hitbox) k2.hitbox(0.1, 0, 0.1, 0.9, 0.7, 0.9);
    const g2 = k2.build();
    g2.name = 'squish:' + key + (glitter ? ':g' : '');
    return g2;
  }
  // the Hand-tool target is almost the whole cell, not the toy's tight shape
  if (hitbox) k.hitbox(0.1, 0, 0.1, 0.9, 0.7, 0.9);
  const g = k.build();
  fit(g, key, live);
  g.name = 'squish:' + key + (glitter ? ':g' : '');
  return g;
}

// ---------------- shared geometry for the hand, the shelf, the unwrap and friends ----------------

const shared = new Map(); // key|g -> template Group (geometry marked shared)

/**
 * A squishable toy centred on its bottom (x, z = 0), geometry shared per key + glitter (the
 * caller may disposeObject it: shared geometry and materials are left alone). part `toy`.
 */
export function sharedToy(key, glitter = false) {
  const id = key + (glitter ? '|g' : '');
  let tpl = shared.get(id);
  if (!tpl) {
    tpl = toyModel(key, { glitter, live: true, hitbox: false });
    // Object3D.clone copies userData through JSON: the Kit's parts map (Groups) must not be in it
    tpl.traverse((o) => {
      if (o.geometry) o.geometry.userData.shared = true;
      delete o.userData.parts;
    });
    const part = tpl.getObjectByName('toy');
    if (part) part.position.set(0, 0, 0); // centred on its bottom (a placed toy's part sits at the cell's centre)
    shared.set(id, tpl);
  }
  const g = tpl.clone(true);
  setParts(g, { toy: g.getObjectByName('toy') });
  g.position.set(0, 0, 0);
  g.name = tpl.name;
  return g;
}

/** userData.parts, kept out of JSON (so the object can still be cloned). */
function setParts(obj, parts) {
  Object.defineProperty(obj.userData, 'parts', { value: parts, enumerable: false, configurable: true, writable: true });
}

/** Free the shared geometry (world unload). Objects still using it must be gone first. */
export function clearShared() {
  for (const tpl of shared.values()) {
    tpl.traverse((o) => {
      if (o.geometry) {
        o.geometry.userData.shared = false;
        o.geometry.dispose();
      }
    });
  }
  shared.clear();
}
export const sharedCount = () => shared.size;

/** The toy as held in the hand: scaled 0.85, facing forward, bottom in the palm. */
export function heldToy(key, glitter = false) {
  const inner = sharedToy(key, glitter);
  const g = new THREE.Group();
  g.name = inner.name;
  inner.name = 'squish-inner';
  inner.position.set(0, -0.05, 0);
  g.scale.setScalar(0.85);
  g.add(inner);
  setParts(g, inner.userData.parts);
  return g;
}

// ---------------- the mystery present ----------------

const WRAPS = [
  { pattern: 'dots', dot: '#FFFFFF', ribbon: '#FF6FA8' },
  { pattern: 'stripes', dot: '#FFE9F4', ribbon: '#8E7CFF' },
  { pattern: 'stars', dot: '#FFE38F', ribbon: '#FF6FA8' },
  { pattern: 'hearts', dot: '#FF9CCB', ribbon: '#FFFFFF' },
  { pattern: 'dots', dot: '#A6D8FF', ribbon: '#FFD43B' },
  { pattern: 'stripes', dot: '#BDF2DA', ribbon: '#FF8FC8' },
];
const LILAC = '#C8B4FF';
const QMARK = ['.XXX.', 'X...X', '...X.', '..X..', '.....', '..X..'];
const STAR5 = ['..X..', 'XXXXX', '.XXX.', 'X...X'];
const HEART5 = ['XX.XX', 'XXXXX', '.XXX.', '..X..'];

function patternOn(k, wrap, face, w, h, x0, y0, z0) {
  // face: 'pz' | 'nz' | 'px' | 'nx'; draws the wrap's pattern on that side of the box
  const cols = 4, rows = 5;
  for (let r = 0; r < rows; r++) {
    for (let c = 0; c < cols; c++) {
      if ((r + c) % 2) continue;
      const u = (c + 0.5) / cols, v = (r + 0.5) / rows;
      const px = 0.012;
      const rowsArt = wrap.pattern === 'stars' ? STAR5 : wrap.pattern === 'hearts' ? HEART5 : null;
      const put = (dx, dy, sw, sh) => {
        const a = u * w + dx, b = v * h + dy;
        if (face === 'pz') k.box(sw, sh, 0.01, wrap.dot, x0 + a, y0 + b, z0);
        else if (face === 'nz') k.box(sw, sh, 0.01, wrap.dot, x0 + w - a - sw, y0 + b, z0 - 0.01);
        else if (face === 'px') k.box(0.01, sh, sw, wrap.dot, x0, y0 + b, z0 + w - a - sw);
        else k.box(0.01, sh, sw, wrap.dot, x0 - 0.01, y0 + b, z0 + a);
      };
      if (wrap.pattern === 'stripes') {
        if (c === 0) put(-u * w, 0, w, 0.03);
      } else if (rowsArt) {
        for (let i = 0; i < rowsArt.length; i++) {
          for (let j = 0; j < 5; j++) if (rowsArt[i][j] === 'X') put((j - 2.5) * px, (rowsArt.length / 2 - i) * px, px, px);
        }
      } else put(-0.018, -0.018, 0.036, 0.036);
    }
  }
}

/**
 * The lilac mystery box, 0.5 x 0.62 x 0.5 (taller than wide), one of 6 wraps, a swirl ribbon,
 * a `lid` part that can fly off and a 4-loop `bow` part, and a "?" tag. Centred on x, z = 0.
 */
export function presentModel(wrapIndex = 0) {
  const wrap = WRAPS[((wrapIndex % WRAPS.length) + WRAPS.length) % WRAPS.length];
  const k = new Kit();
  const W = 0.5, H = 0.5, D = 0.5;
  k.box(W, H, D, LILAC, -W / 2, 0, -D / 2);
  patternOn(k, wrap, 'pz', W, H, -W / 2, 0, D / 2);
  patternOn(k, wrap, 'nz', W, H, -W / 2, 0, -D / 2);
  patternOn(k, wrap, 'px', W, H, W / 2, 0, -D / 2);
  patternOn(k, wrap, 'nx', W, H, -W / 2, 0, -D / 2);
  // the ribbon round the box (a swirl: two bands, one a little turned)
  k.box(0.08, H + 0.002, D + 0.02, wrap.ribbon, -0.04, 0, -D / 2 - 0.01);
  k.box(W + 0.02, H + 0.002, 0.08, wrap.ribbon, -W / 2 - 0.01, 0, -0.04);
  // the "?" tag on the front
  k.box(0.16, 0.2, 0.015, '#FFFFFF', 0.06, 0.12, D / 2 + 0.012, { rot: [0, 0, -0.12] });
  k.pixels(QMARK, 0.024, { X: '#8E5BD6' }, 0.08, 0.15, D / 2 + 0.025, { depth: 0.012 });
  k.stick([0.08, 0.32, D / 2 + 0.02], [0.03, 0.42, D / 2 + 0.01], 0.01, '#FFFFFF');
  // the lid (flies off at the reveal)
  const lid = k.part('lid', 0, H, 0);
  lid.box(W + 0.04, 0.12, D + 0.04, mixHex(LILAC, '#FFFFFF', 0.25), -W / 2 - 0.02, 0, -D / 2 - 0.02);
  lid.box(0.085, 0.122, D + 0.05, wrap.ribbon, -0.0425, 0, -D / 2 - 0.025);
  lid.box(W + 0.05, 0.122, 0.085, wrap.ribbon, -W / 2 - 0.025, 0, -0.0425);
  // the bow: four loops and a knot
  const bow = lid.part('bow', 0, 0.12, 0);
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * PI * 2 + PI / 4;
    bow.ball(0.07, wrap.ribbon, Math.sin(a) * 0.075, 0.055, Math.cos(a) * 0.075, { sx: 0.5, sy: 0.9, rot: [0, a, 0.9] });
  }
  bow.ball(0.045, shade(wrap.ribbon, -0.1), 0, 0.05, 0);
  const g = k.build();
  g.name = 'squish:present';
  return g;
}

// ---------------- the Toy Shelf ----------------

export const SHELF_COLORS = ['#E7BE8C', '#FFFFFF', '#A6D8FF', '#FF9CCB'];
const HEART_PX = ['XX.XX', 'XXXXX', '.XXX.', '..X..'];

/** A low 2-wide kid-height shelf; the inner boards are decoration only. Static (batched). */
export function toyShelf(color = SHELF_COLORS[0]) {
  const k = new Kit();
  const c = color || SHELF_COLORS[0];
  const dark = shade(c, -0.12);
  k.box(2, 0.08, 0.95, c, 0, 0.9, 0.05);
  k.box(1.96, 0.06, 0.9, dark, 0.02, 0.0, 0.07);
  for (const x of [0, 1.92]) k.box(0.08, 0.9, 0.95, c, x, 0, 0.05);
  k.box(0.06, 0.9, 0.9, c, 0.97, 0, 0.07);
  k.box(1.92, 0.88, 0.04, shade(c, -0.06), 0.04, 0.02, 0.05);
  // two inner decorative boards
  for (const y of [0.3, 0.6]) k.box(1.84, 0.04, 0.86, dark, 0.08, y, 0.08);
  // little toy-shaped bumps on the boards (decor)
  const deco = ['#FF9CCB', '#A6D8FF', '#FFE38F', '#9BE8CF'];
  deco.forEach((col, i) => k.ball(0.07, col, 0.3 + i * 0.45, i % 2 ? 0.41 : 0.11, 0.5, { sy: 0.9 }));
  if (c === '#FF9CCB') {
    for (const x of [-0.006, 1.996]) {
      for (let i = 0; i < 4; i++) {
        for (let j = 0; j < 5; j++) {
          if (HEART_PX[i][j] !== 'X') continue;
          k.box(0.012, 0.05, 0.05, '#FFE3F0', x, 0.55 - i * 0.05, 0.3 + j * 0.05);
        }
      }
    }
  }
  const g = k.build();
  g.name = 'squish:toy_shelf';
  return g;
}

/** Every toy key (for the grids and the shelf). */
export const ALL_KEYS = () => ITEMS.map((i) => i.key);
