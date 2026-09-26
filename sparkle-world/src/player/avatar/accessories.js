// Accessories as small voxel models: head (bows, tiaras, crowns, ears, hats, halo), face
// (glasses on painted planes), back (wings on swinging bones, backpack, cape chain), neck
// and hand items (wand with a sparkle tip, purse, balloon on a string, teddy, ice cream).

import { shade, mixHex } from '../../core/util.js';
import { bow } from './outfit.js';

const GOLD = '#FFD54A';
const WHITE = '#FFFFFF';
const PINK = '#FF7EB6';

// ---------- head ----------

function flowerAt(b, x, y, z, r, petal, center, rot = 0) {
  b.save().rotateAt(x, y, z, 0, rot, 0);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    b.ccube(x + Math.cos(a) * r, y + Math.sin(a) * r, z, r * 1.25, r * 1.25, r * 0.7, r * 0.3, petal);
  }
  b.ccube(x, y, z + r * 0.25, r * 0.9, r * 0.9, r * 0.8, r * 0.25, center);
  b.restore();
}

const HEAD = {
  bow(P, b, c) {
    const x = 0.22, y = 1.76, z = 0.04;
    b.save().rotateAt(x, y, z, 0.1, -0.25, -0.55);
    const knot = shade(c, -0.12);
    for (const s of [-1, 1]) {
      b.save().rotateAt(x, y, z, 0, 0, s * 0.2);
      b.cbox(x + s * 0.035, y - 0.075, z - 0.04, x + s * 0.2, y + 0.075, z + 0.04, 0.035, c);
      b.cbox(x + s * 0.075, y - 0.04, z - 0.046, x + s * 0.16, y + 0.04, z + 0.046, 0.02, shade(c, 0.2));
      b.restore();
      b.save().rotateAt(x, y, z, 0, 0, s * 0.45);
      b.box(x + s * 0.01, y - 0.15, z - 0.02, x + s * 0.05, y - 0.02, z + 0.02, c);
      b.restore();
    }
    b.ccube(x, y, z, 0.075, 0.085, 0.09, 0.025, knot);
    b.restore();
  },
  tiara(P, b, c) {
    const gem = PINK;
    for (let i = -3; i <= 3; i++) {
      const a = i * 0.26;
      const x = Math.sin(a) * 0.3, z = Math.cos(a) * 0.27 - 0.06;
      const hgt = i === 0 ? 0.13 : Math.abs(i) === 1 ? 0.08 : Math.abs(i) === 2 ? 0.06 : 0.04;
      b.save().rotateAt(x, 1.76, z, 0, a, 0);
      b.box(x - 0.045, 1.735, z - 0.012, x + 0.045, 1.765, z + 0.012, c);
      b.save().rotateAt(x, 1.765, z, 0, 0, Math.PI / 4);
      b.box(x - hgt * 0.35, 1.765 - hgt * 0.35, z - 0.01, x + hgt * 0.35, 1.765 + hgt * 0.35, z + 0.01, c);
      b.restore();
      b.restore();
    }
    P.B('head', 'glow').ccube(0, 1.82, 0.215, 0.05, 0.05, 0.03, 0.01, gem);
  },
  crown(P, b, c) {
    b.save().rotateAt(0, 1.76, 0, 0, 0, 0.08);
    const w = 0.2, d = 0.17;
    b.box(-w, 1.74, -d, w, 1.84, -d + 0.03, c);
    b.box(-w, 1.74, d - 0.03, w, 1.84, d, c);
    b.box(-w, 1.74, -d, -w + 0.03, 1.84, d, c);
    b.box(w - 0.03, 1.74, -d, w, 1.84, d, c);
    for (const [x, z] of [[-w, d], [0, d], [w, d], [-w, -d], [w, -d], [0, -d], [-w, 0], [w, 0]]) {
      b.save().rotateAt(x, 1.87, z, 0, Math.PI / 4, 0);
      b.cone(x, 1.84, z, 0.04, 0.08, c, 4);
      b.restore();
    }
    const g = P.B('head', 'glow');
    g.ccube(0, 1.79, d + 0.01, 0.05, 0.05, 0.02, 0.01, PINK);
    g.ccube(-0.12, 1.79, d + 0.01, 0.035, 0.035, 0.02, 0.008, '#7FD3FF');
    g.ccube(0.12, 1.79, d + 0.01, 0.035, 0.035, 0.02, 0.008, '#9BE58A');
    b.restore();
  },
  flower_crown(P, b, c) {
    const petals = [c, WHITE, mixHex(c, WHITE, 0.5)];
    for (let i = 0; i < 11; i++) {
      const a = (i / 11) * Math.PI * 2;
      const x = Math.sin(a) * 0.345, z = Math.cos(a) * 0.31 - 0.01;
      flowerAt(b, x, 1.73 + (i % 2) * 0.015, z, 0.032, petals[i % 3], '#FFD43B', a);
      const la = a + Math.PI / 11;
      b.save().rotateAt(Math.sin(la) * 0.34, 1.72, Math.cos(la) * 0.3, 0, la, 0.5);
      b.cube(Math.sin(la) * 0.34, 1.72, Math.cos(la) * 0.3, 0.06, 0.025, 0.03, '#7BD389');
      b.restore();
    }
  },
  cat_ears(P, b, c) {
    for (const s of [-1, 1]) {
      b.save().rotateAt(s * 0.2, 1.74, 0, 0, 0, -s * 0.2);
      b.box(s * 0.12, 1.72, -0.06, s * 0.28, 1.8, 0.04, c);
      b.box(s * 0.14, 1.8, -0.05, s * 0.26, 1.86, 0.03, c);
      b.box(s * 0.165, 1.86, -0.04, s * 0.235, 1.91, 0.02, c);
      b.box(s * 0.155, 1.74, 0.04, s * 0.245, 1.84, 0.046, '#FFB6D0');
      b.restore();
    }
  },
  bunny_ears(P, b, c) {
    const inner = '#FFB6D0';
    b.save().rotateAt(0.12, 1.72, 0, 0, 0, -0.12);
    b.cbox(0.075, 1.72, -0.035, 0.175, 2.08, 0.035, 0.035, c);
    b.box(0.1, 1.78, 0.034, 0.15, 2.03, 0.04, inner);
    b.restore();
    b.save().rotateAt(-0.12, 1.72, 0, 0, 0, 0.12);
    b.cbox(-0.175, 1.72, -0.035, -0.075, 1.93, 0.035, 0.035, c);
    b.box(-0.15, 1.76, 0.034, -0.1, 1.9, 0.04, inner);
    b.save().rotateAt(-0.125, 1.92, 0, 0.1, 0, 1.2);
    b.cbox(-0.175, 1.92, -0.035, -0.075, 2.08, 0.035, 0.035, c);
    b.box(-0.15, 1.94, 0.034, -0.1, 2.05, 0.04, inner);
    b.restore();
    b.restore();
  },
  unicorn_horn(P, b, c) {
    b.save().rotateAt(0, 1.74, 0.16, 0.35, 0, 0);
    const n = 6;
    for (let i = 0; i < n; i++) {
      const s = 0.1 * (1 - i / (n + 0.5));
      b.save().rotateAt(0, 1.76 + i * 0.05, 0.16, 0, i * 0.5, 0);
      b.cbox(-s / 2, 1.74 + i * 0.05, 0.16 - s / 2, s / 2, 1.79 + i * 0.05, 0.16 + s / 2, s * 0.15, i % 2 ? shade(c, 0.25) : c);
      b.restore();
    }
    b.cone(0, 1.74 + n * 0.05, 0.16, 0.02, 0.06, shade(c, 0.35), 4);
    b.restore();
    for (const s of [-1, 1]) {
      b.save().rotateAt(s * 0.25, 1.72, -0.04, 0, 0, -s * 0.5);
      b.box(s * 0.2, 1.7, -0.08, s * 0.3, 1.82, 0.0, WHITE);
      b.box(s * 0.22, 1.72, 0.0, s * 0.28, 1.8, 0.006, '#FFB6D0');
      b.restore();
    }
    flowerAt(b, 0.14, 1.75, 0.22, 0.026, PINK, '#FFE27A', 0.3);
    flowerAt(b, -0.13, 1.755, 0.22, 0.022, '#C9A2FF', '#FFE27A', -0.3);
  },
  beanie(P, b, c) {
    const knit = P.cloth({ color: c, pattern: 'none', patternColor: WHITE, fabric: 'knit' });
    const k = P.B('head', knit);
    k.cbox(-0.355, 1.64, -0.335, 0.355, 1.82, 0.302, 0.07, WHITE);
    k.cbox(-0.3, 1.78, -0.28, 0.3, 1.9, 0.245, 0.07, WHITE);
    k.cbox(-0.2, 1.87, -0.19, 0.2, 1.94, 0.15, 0.04, WHITE);
    k.cbox(-0.366, 1.57, -0.345, 0.366, 1.68, 0.318, 0.035, '#DADADA');
    b.sphere(0, 1.99, -0.02, 0.1, 0.095, 0.1, mixHex(c, WHITE, 0.55), 10, 7);
  },
  sun_hat(P, b, c) {
    const straw = mixHex(c, '#FFF4E0', 0.55);
    b.save().rotateAt(0, 1.66, 0, -0.12, 0, 0.06);
    b.cyl(0, 1.64, 0, 0.56, 0.035, straw, 20);
    b.cyl(0, 1.66, 0, 0.3, 0.2, straw, 14);
    b.cyl(0, 1.66, 0, 0.308, 0.07, c, 14);
    flowerAt(b, 0.24, 1.72, 0.2, 0.04, WHITE, '#FFD43B', 0.8);
    flowerAt(b, 0.3, 1.71, 0.08, 0.03, PINK, '#FFD43B', 1.2);
    b.restore();
  },
  headband(P, b, c) {
    for (let i = 0; i <= 14; i++) {
      const a = (-0.5 + i / 14) * Math.PI * 0.86;
      const x = Math.sin(a) * 0.37, y = 1.43 + Math.cos(a) * 0.358;
      b.save().rotateAt(x, y, 0.1, 0, 0, -a);
      b.box(x - 0.045, y - 0.026, 0.06, x + 0.045, y + 0.026, 0.16, c);
      b.restore();
    }
    bow(b, 0.24, 1.73, 0.13, 1.1, shade(c, 0.15));
  },
  witch_hat(P, b, c) {
    b.save().rotateAt(0, 1.7, 0, -0.1, 0, 0.12);
    b.cyl(0, 1.68, 0, 0.47, 0.035, c, 18);
    b.cone(0, 1.7, 0, 0.27, 0.26, c, 12, 0.14);
    b.save().rotateAt(0, 1.96, 0, 0, 0, -0.5);
    b.cone(0, 1.95, 0, 0.14, 0.22, c, 10, 0.02);
    b.restore();
    b.cyl(0, 1.7, 0, 0.275, 0.06, shade(c, -0.3), 12);
    const g = P.B('head', 'glow');
    for (const [x, y, z] of [[0.12, 1.83, 0.14], [-0.1, 1.9, 0.08], [0.02, 1.98, 0.08], [0.2, 1.74, 0.2]]) {
      g.save().rotateAt(x, y, z, 0, 0, Math.PI / 4);
      g.cube(x, y, z, 0.035, 0.035, 0.02, '#FFE27A');
      g.restore();
    }
    g.cube(-0.18, 1.72, 0.24, 0.05, 0.05, 0.02, '#FFE27A');
    b.restore();
  },
  halo(P, b, c) {
    const bone = P.bone('halo', 'head', [0, 1.98, 0]);
    P.dyn.halo = bone;
    const g = P.B(bone, 'glow');
    g.torus(0, 1.98, 0, 0.2, 0.026, mixHex(c, '#FFF6C8', 0.35), 18, 6);
  },
};

// ---------- face ----------

const GLASS_DEFAULT = { glasses: '#FF5FA2', sunglasses: '#FFFFFF', heart_glasses: '#FF5FA2', star_glasses: '#FFC400' };

function buildFace(P) {
  const type = P.look.acc.face;
  if (!type || type === 'none') return;
  const color = P.look.acc.faceColor || GLASS_DEFAULT[type] || '#FF5FA2';
  const z = 0.305;
  P.B('head', `glasses:${type}:${color}`).quad([-0.25, 1.235, z], [0.25, 1.235, z], [0.25, 1.485, z], [-0.25, 1.485, z], WHITE);
  const b = P.B('head', 'plain');
  for (const s of [-1, 1]) {
    b.box(s * 0.26, 1.39, 0.29, s * 0.335, 1.41, 0.305, color);
    b.box(s * 0.318, 1.39, 0.0, s * 0.338, 1.41, 0.3, color);
  }
}

// ---------- back ----------

function wings(P, type, c) {
  const bz = P.backZ - 0.015;
  for (const side of [1, -1]) {
    const bone = P.bone(side > 0 ? 'wingL' : 'wingR', 'torso', [side * 0.04, 0.98, bz]);
    if (type === 'angel_wings') {
      const b = P.B(bone, 'bright');
      const tipC = mixHex(c, WHITE, 0.25);
      const soft = mixHex(c, WHITE, 0.82);
      // layered rows of feathers (longer toward the bottom), each with a scalloped edge
      const rows = [
        { y0: 1.12, y1: 1.38, x1: 0.42, rot: 0.34, col: WHITE, z: 0 },
        { y0: 0.97, y1: 1.19, x1: 0.53, rot: 0.24, col: soft, z: -0.012 },
        { y0: 0.82, y1: 1.03, x1: 0.62, rot: 0.14, col: WHITE, z: -0.024 },
      ];
      rows.forEach((r, ri) => {
        b.save().rotateAt(0, r.y1, bz, 0, 0, side * r.rot);
        const zf = bz + 0.02 + r.z, zb = zf - 0.045;
        b.cbox(side * 0.02, r.y0, zb, side * r.x1, r.y1, zf, 0.035, r.col);
        const n = 3 + ri;
        for (let k = 0; k < n; k++) {
          const xc = side * (0.07 + ((r.x1 - 0.1) * (k + 0.5)) / n);
          const tip = ri === 2 ? tipC : r.col;
          b.cbox(xc - 0.055, r.y0 - 0.06 - k * 0.012, zb + 0.004, xc + 0.055, r.y0 + 0.04, zf - 0.004, 0.035, tip);
        }
        b.restore();
      });
      P.dyn.wings.push({ bone, side, rest: 0.45, kind: 'angel' });
    } else {
      const key = `wing:${type}:${c}`;
      const up = P.B(bone, key + ':upper'), lo = P.B(bone, key + ':lower');
      const zz = bz - 0.01;
      const U = side > 0 ? [[0, 0], [1, 0], [1, 1], [0, 1]] : [[0, 0], [1, 0], [1, 1], [0, 1]];
      const big = type === 'butterfly_wings' ? 1.08 : 1;
      up.quad([side * 0.03, 0.9, zz], [side * 0.62 * big, 0.9, zz], [side * 0.62 * big, 1.5 * big - 0.05, zz], [side * 0.03, 1.5 * big - 0.05, zz], WHITE, U);
      lo.quad([side * 0.03, 0.56, zz], [side * 0.45 * big, 0.56, zz], [side * 0.45 * big, 0.98, zz], [side * 0.03, 0.98, zz], WHITE, U);
      P.dyn.wings.push({ bone, side, rest: 0.42, kind: 'fairy' });
    }
  }
  // wing root: a little bow where the wings meet
  bow(P.B('torso', 'plain'), 0, 0.98, bz - 0.02, 0.9, mixHex(c, WHITE, 0.35));
}

function buildBack(P) {
  const type = P.look.acc.back;
  const c = P.look.acc.backColor;
  if (!type || type === 'none') return;
  if (type === 'fairy_wings' || type === 'butterfly_wings' || type === 'angel_wings') return wings(P, type, c);
  if (type === 'backpack') {
    const b = P.B('torso', 'plain');
    const z0 = P.backZ + 0.005, z1 = z0 - 0.175;
    b.cbox(-0.17, 0.72, z1, 0.17, 1.04, z0, 0.05, c);
    b.cbox(-0.13, 0.74, z1 - 0.025, 0.13, 0.9, z1 + 0.03, 0.03, mixHex(c, WHITE, 0.35));
    b.cbox(-0.17, 0.97, z1 - 0.01, 0.17, 1.06, z1 + 0.09, 0.04, shade(c, -0.1));
    const heart = [[-1, 1], [1, 1], [-1, 0], [0, 0], [1, 0], [0, -1], [0, 1]];
    for (const [i, j] of heart) b.cube(i * 0.018, 0.82 + j * 0.018, z1 - 0.028, 0.018, 0.018, 0.008, PINK);
    for (const s of [-1, 1]) {
      b.box(s * 0.09, 0.8, 0.118, s * 0.14, 1.088, 0.133, shade(c, -0.15));
      b.box(s * 0.09, 1.075, z0, s * 0.14, 1.092, 0.133, shade(c, -0.15));
    }
    return;
  }
  if (type === 'cape') {
    const dz = P.backZ + 0.12;
    const pts = [[0, 1.07, -0.15 + dz], [0, 0.86, -0.19 + dz], [0, 0.64, -0.21 + dz], [0, 0.42, -0.22 + dz]];
    const bones = P.chain('cape', 'torso', pts, { kind: 'cape' });
    const inner = mixHex(c, WHITE, 0.45);
    const col = (p, n) => P.linColor(n.z > 0.5 ? inner : c);
    for (let i = 0; i < 3; i++) {
      const b = P.B(bones[i], 'plain2');
      const [x0, y0, z0] = pts[i], [, y1, z1] = pts[i + 1];
      const w0 = 0.25 + i * 0.05, w1 = 0.3 + i * 0.05;
      b.poly([[-w1, y1, z1], [w1, y1, z1], [w0, y0 + 0.005, z0], [-w0, y0 + 0.005, z0]], col);
      b.poly([[-w0, y0 + 0.005, z0 + 0.01], [w0, y0 + 0.005, z0 + 0.01], [w1, y1, z1 + 0.01], [-w1, y1, z1 + 0.01]], col);
      if (i === 2) b.box(-w1, y1 - 0.02, z1 - 0.012, w1, y1 + 0.025, z1 + 0.022, GOLD);
      void x0;
    }
    // a few glowing stars on the back of the cape
    const sg = P.B(bones[1], 'glow');
    for (const [x, y] of [[-0.12, 0.8], [0.1, 0.74], [0.0, 0.9]]) {
      sg.save().rotateAt(x, y, pts[1][2] - 0.01, 0, 0, Math.PI / 4);
      sg.cube(x, y, pts[1][2] - 0.018, 0.04, 0.04, 0.01, '#FFE27A');
      sg.restore();
    }
    const t = P.B('torso', 'plain');
    t.box(-0.2, 1.05, -0.16, 0.2, 1.1, -0.12, shade(c, -0.15));
    if (dz < -0.01) {
      // yoke from the collar over the hair to where the cape hangs
      const y2 = P.B('torso', 'plain2');
      y2.poly([[-0.25, 1.07, pts[0][2]], [0.25, 1.07, pts[0][2]], [0.2, 1.1, -0.13], [-0.2, 1.1, -0.13]], c);
    }
    for (const s of [-1, 1]) t.box(s * 0.16, 1.05, -0.14, s * 0.215, 1.1, 0.13, shade(c, -0.15));
    P.B('torso', 'glow').save().rotateAt(0, 1.07, 0.13, 0, 0, Math.PI / 4).cube(0, 1.07, 0.13, 0.05, 0.05, 0.02, '#FFE27A').restore();
  }
}

// ---------- neck ----------

function buildNeck(P) {
  const type = P.look.acc.neck;
  const c = P.look.acc.neckColor;
  if (!type || type === 'none') return;
  const b = P.B('torso', 'plain');
  if (type === 'necklace') {
    for (const s of [-1, 1]) {
      b.save().rotateAt(s * 0.075, 1.07, 0.125, 0, 0, s * 0.6);
      b.box(s * 0.062, 0.975, 0.12, s * 0.088, 1.09, 0.13, c);
      b.restore();
      b.box(s * 0.07, 1.075, -0.075, s * 0.095, 1.09, 0.125, c);
    }
    const hx = 0, hy = 0.96;
    const heart = [[-2, 1], [-1, 2], [1, 2], [2, 1], [-2, 0], [-1, 0], [0, 0], [1, 0], [2, 0], [-1, 1], [0, 1], [1, 1], [-1, -1], [0, -1], [1, -1], [0, -2]];
    for (const [i, j] of heart) b.cube(hx + i * 0.016, hy + j * 0.016, 0.134, 0.017, 0.017, 0.014, PINK);
    b.cube(hx - 0.018, hy + 0.017, 0.142, 0.012, 0.012, 0.004, '#FFD1E6');
    b.cube(hx, hy + 0.05, 0.13, 0.022, 0.022, 0.012, c);
  } else if (type === 'pearls') {
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const x = Math.sin(a) * 0.1, z = Math.cos(a) * 0.085 - 0.002;
      const droop = Math.max(0, Math.cos(a)) * 0.04;
      b.sphere(x, 1.075 - droop, z + Math.max(0, Math.cos(a)) * 0.04, 0.023, 0.023, 0.023, i % 2 ? mixHex(c, WHITE, 0.55) : mixHex(c, WHITE, 0.75), 6, 4);
    }
  } else if (type === 'scarf') {
    const knit = P.B('torso', P.cloth({ color: c, pattern: 'stripes', patternColor: mixHex(c, WHITE, 0.6), fabric: 'knit' }));
    knit.cbox(-0.14, 1.02, -0.11, 0.14, 1.13, 0.12, 0.04, WHITE);
    knit.save().rotateAt(0.1, 1.05, 0.13, 0.1, 0, 0.12);
    knit.cbox(0.05, 0.78, 0.115, 0.15, 1.06, 0.155, 0.02, WHITE);
    knit.restore();
    for (let i = 0; i < 4; i++) b.box(0.07 + i * 0.022 + 0.02 * 0.12, 0.74, 0.125, 0.082 + i * 0.022 + 0.004, 0.785, 0.14, shade(c, -0.1));
  } else if (type === 'bowtie') {
    b.save().translate(0, 1.035, 0.12);
    for (const s of [-1, 1]) {
      b.poly([[0, 0, 0.012], [s * 0.075, 0.035, 0.012], [s * 0.075, -0.035, 0.012]], c);
      b.cbox(s * 0.02, -0.03, 0, s * 0.075, 0.03, 0.02, 0.008, c);
    }
    b.cube(0, 0, 0.015, 0.03, 0.035, 0.025, shade(c, -0.15));
    b.restore();
  }
}

// ---------- hand ----------

const HAND_DEFAULT = { wand: '#FFE27A', purse: '#FF8CC6', balloon: '#FF5FA2', teddy: '#C8905E', ice_cream: '#FFB6D0' };

function buildHand(P) {
  const type = P.look.acc.hand;
  if (!type || type === 'none') return;
  const c = P.look.acc.handColor || HAND_DEFAULT[type];
  const hx = -0.275, hy = 0.6, hz = 0.02;
  P.handPose = type;
  if (type === 'wand') {
    const b = P.B('elbowR', 'plain');
    b.save().rotateAt(hx, hy, hz, -0.25, 0, 0);
    b.box(hx - 0.014, hy - 0.014, hz - 0.08, hx + 0.014, hy + 0.014, hz + 0.34, WHITE);
    for (const z of [hz + 0.08, hz + 0.18]) b.box(hx - 0.018, hy - 0.018, z, hx + 0.018, hy + 0.018, z + 0.03, PINK);
    const tip = [hx, hy, hz + 0.42];
    b.restore();
    // star lies in the x-z plane so it faces forward when the wand is raised
    const bone = P.bone('wandTip', 'elbowR', rotateAbout([hx, hy, hz], tip, -0.25));
    P.dyn.wandTip = bone;
    const s = P.B(bone, 'glow');
    const sp = rotateAbout([hx, hy, hz], tip, -0.25);
    s.save().translate(sp[0], sp[1], sp[2]).rotate(-0.25, 0, 0);
    starPrism(s, 0.1, 0.02, c);
    s.restore();
    return;
  }
  if (type === 'balloon') {
    const ball = P.bone('balloon', 'body', [hx, 1.5, 0.1]);
    const b = P.B(ball, 'plain');
    const hi = mixHex(c, WHITE, 0.6);
    b.sphere(hx, 1.5, 0.1, 0.17, 0.2, 0.17, (p, n) => P.linColor(n.y > 0.35 && n.z > 0.35 && n.x > -0.2 && n.x < 0.5 ? hi : c), 14, 10);
    b.save().translate(hx, 1.3, 0.1).rotate(Math.PI, 0, 0);
    b.cone(0, -0.02, 0, 0.035, 0.04, shade(c, -0.1), 6);
    b.restore();
    const str = P.bone('balloonString', 'body', [0, 0, 0]);
    P.B(str, 'plain').box(-0.005, -0.5, -0.005, 0.005, 0.5, 0.005, '#FFFFFF');
    P.dyn.balloon = { ball, string: str };
    return;
  }
  const up = P.bone('handItem', 'elbowR', [hx, hy, hz]);
  P.dyn.upright = up;
  const b = P.B(up, 'plain');
  if (type === 'purse') {
    b.box(hx - 0.012, hy - 0.12, hz - 0.012, hx + 0.012, hy + 0.02, hz + 0.012, shade(c, -0.25));
    b.cbox(hx - 0.1, hy - 0.26, hz - 0.045, hx + 0.1, hy - 0.11, hz + 0.045, 0.03, c);
    b.cbox(hx - 0.1, hy - 0.15, hz - 0.05, hx + 0.1, hy - 0.11, hz + 0.05, 0.02, shade(c, -0.12));
    const heart = [[-1, 1], [1, 1], [-1, 0], [0, 0], [1, 0], [0, -1]];
    for (const [i, j] of heart) b.cube(hx + i * 0.016, hy - 0.19 + j * 0.016, hz + 0.05, 0.017, 0.017, 0.008, GOLD);
  } else if (type === 'teddy') {
    const fur = c, light = mixHex(c, WHITE, 0.45);
    const y = hy + 0.02, z = hz + 0.1;
    b.ccube(hx, y + 0.05, z, 0.15, 0.16, 0.12, 0.04, fur); // body
    b.ccube(hx, y + 0.05, z + 0.055, 0.09, 0.1, 0.02, 0.02, light);
    b.ccube(hx, y + 0.19, z, 0.16, 0.14, 0.13, 0.04, fur); // head
    for (const s of [-1, 1]) {
      b.ccube(hx + s * 0.07, y + 0.27, z, 0.06, 0.06, 0.05, 0.02, fur);
      b.ccube(hx + s * 0.1, y + 0.08, z + 0.02, 0.05, 0.1, 0.06, 0.02, fur);
      b.ccube(hx + s * 0.045, y - 0.04, z + 0.03, 0.06, 0.06, 0.09, 0.02, fur);
      b.cube(hx + s * 0.035, y + 0.21, z + 0.066, 0.02, 0.02, 0.006, '#3B2230');
    }
    b.ccube(hx, y + 0.17, z + 0.07, 0.06, 0.045, 0.02, 0.01, light);
    b.cube(hx, y + 0.18, z + 0.082, 0.02, 0.014, 0.006, '#3B2230');
    bow(b, hx, y + 0.115, z + 0.066, 0.45, PINK);
  } else if (type === 'ice_cream') {
    const y = hy + 0.02;
    b.save().translate(hx, y + 0.12, hz + 0.02).rotate(Math.PI, 0, 0);
    b.cone(0, 0, 0, 0.055, 0.17, '#E9B26C', 8);
    b.restore();
    b.sphere(hx, y + 0.15, hz + 0.02, 0.07, 0.06, 0.07, c, 10, 7);
    b.sphere(hx, y + 0.24, hz + 0.02, 0.06, 0.055, 0.06, mixHex(c, '#FFF4E0', 0.5), 10, 7);
    b.sphere(hx, y + 0.31, hz + 0.02, 0.022, 0.022, 0.022, '#FF4D6D', 6, 4);
    const sprinkles = ['#7FD3FF', '#FFE27A', '#9BE58A', '#C9A2FF'];
    for (let i = 0; i < 8; i++) {
      const a = i * 0.8;
      b.cube(hx + Math.cos(a) * 0.055, y + 0.17 + (i % 3) * 0.02, hz + 0.02 + Math.sin(a) * 0.055, 0.014, 0.014, 0.014, sprinkles[i % 4]);
    }
  }
}

function rotateAbout(o, p, ax) {
  const dy = p[1] - o[1], dz = p[2] - o[2];
  const c = Math.cos(ax), s = Math.sin(ax);
  return [p[0], o[1] + dy * c - dz * s, o[2] + dy * s + dz * c];
}

/** Flat five-point star (thickness t) in the x-z plane, centred at the current origin. */
function starPrism(b, R, t, color) {
  const pts = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    const r = i % 2 === 0 ? R : R * 0.45;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const ctr = [0, 0, 0];
  for (let i = 0; i < 10; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % 10];
    b.poly([[0, t, 0], [x0, t, z0], [x1, t, z1]], color, { center: [0, -1, 0] });
    b.poly([[0, -t, 0], [x1, -t, z1], [x0, -t, z0]], color, { center: [0, 1, 0] });
    b.poly([[x0, -t, z0], [x1, -t, z1], [x1, t, z1], [x0, t, z0]], color, { center: ctr });
  }
}

export function buildAccessories(P) {
  const L = P.look;
  const head = L.acc.head;
  if (head && head !== 'none' && HEAD[head]) HEAD[head](P, P.B('head', 'plain'), L.acc.headColor);
  buildFace(P);
  buildBack(P);
  buildNeck(P);
  buildHand(P);
}
