// Twelve hair styles as layered voxel geometry: a "helmet" over the head, anime bangs,
// side locks, and swinging parts (ponytails, pigtails, braids, long back hair) on spring
// chains. Colors come from hairColors(): one color, or a second color as ombre / streaks /
// tips, or a pastel rainbow. The strand texture adds shine (an "angel ring" at the crown).

import * as THREE from 'three';
import { mulberry32 } from '../../core/util.js';
import { lin } from './geo.js';
import { RAINBOW } from '../wardrobe-data.js';

// ---------- colors ----------

const RANGES = {
  long: [1.62, 0.8], wavy_long: [1.62, 0.72], ponytail: [1.6, 1.0], pigtails: [1.6, 0.95], braids: [1.6, 0.78],
  bun: [1.66, 1.3], space_buns: [1.66, 1.3], curly: [1.66, 1.02], bob: [1.62, 1.2], short: [1.7, 1.36],
  side_pony: [1.6, 0.92], pixie: [1.72, 1.42],
};

/** colorFor(index) -> (p) => THREE.Color. index >= 10 marks a strand (streaks use every 3rd). */
export function hairColors(look) {
  const { color, color2, mix, style } = look.hair;
  const base = lin(color);
  const range = RANGES[style] || [1.6, 1.0];
  const out = new THREE.Color();
  const c2 = new THREE.Color();
  const rainbow = color2 === 'rainbow';
  const second = color2 && !rainbow ? lin(color2) : null;
  const rainbowAt = (i) => lin(RAINBOW[((i % RAINBOW.length) + RAINBOW.length) % RAINBOW.length]);
  return (index = 0) => (p) => {
    const vary = index >= 10 ? 1 + (((index * 37) % 7) - 3) * 0.012 : 1;
    out.copy(base).multiplyScalar(vary);
    if (!color2) return out;
    if (rainbow) c2.copy(rainbowAt(index >= 10 ? index : Math.floor((p.x + 0.45) * 8)));
    else c2.copy(second);
    if (mix === 'streaks') {
      if (index >= 10 && index % 3 === 1) out.copy(c2);
      return out;
    }
    const t = Math.min(1, Math.max(0, (range[0] - p.y) / (range[0] - range[1])));
    let k;
    if (mix === 'tips') k = t < 0.66 ? 0 : Math.min(1, (t - 0.66) / 0.14);
    else k = t < 0.2 ? 0 : Math.min(1, (t - 0.2) / 0.65);
    k = k * k * (3 - 2 * k);
    return out.lerp(c2, k);
  };
}

// ---------- shared pieces ----------

function helmet(h, C, { sideBottom = 1.34, backBottom = 1.2, puff = 0, sideFront = 0.16 } = {}) {
  const w = 0.338 + puff, top = 1.758 + puff * 0.7, bz = -0.302 - puff;
  h.cbox(-w, 1.6, bz, w, top, 0.296, 0.045, C(0)); // crown
  h.cbox(-w + 0.05, 1.7, bz + 0.04, w - 0.05, top + 0.022, 0.17, 0.05, C(0)); // a little dome
  // back of the head in strands with a soft, uneven edge
  const nb = 7, bw = (2 * w - 0.008) / nb;
  for (let i = 0; i < nb; i++) {
    const x0 = -w + 0.004 + i * bw;
    const dip = ((i * 5) % 3) * 0.018 + (i === 3 ? 0.02 : 0);
    h.box(x0, backBottom - dip, bz, x0 + bw + 0.002, 1.64, -0.22, C(1));
  }
  // sides, also in strands
  const ns = 4, sd = (sideFront - bz - 0.004) / ns;
  for (const s of [-1, 1]) {
    for (let i = 0; i < ns; i++) {
      const z0 = bz + 0.004 + i * sd;
      const dip = ((i + (s > 0 ? 1 : 0)) % 2) * 0.025 + (i === ns - 1 ? -0.02 : 0);
      h.box(s * 0.296, sideBottom - dip, z0, s * w, 1.64, z0 + sd + 0.002, C(s > 0 ? 3 : 2));
    }
  }
}

const BANGS = {
  swept: [1.43, 1.48, 1.52, 1.555, 1.58, 1.545, 1.47],
  swept2: [1.47, 1.545, 1.58, 1.555, 1.52, 1.48, 1.43],
  parted: [1.42, 1.5, 1.56, 1.615, 1.56, 1.5, 1.42],
  blunt: [1.5, 1.505, 1.5, 1.505, 1.5, 1.505, 1.5],
  wispy: [1.55, 1.6, 1.545, 1.605, 1.55, 1.6, 1.555],
  short: [1.52, 1.55, 1.575, 1.6, 1.61, 1.595, 1.56],
};

function bangs(h, C, kind = 'swept', { z0 = 0.252, z1 = 0.302 } = {}) {
  const B = BANGS[kind];
  const n = B.length, x0 = -0.338, W = 0.676 / n;
  for (let i = 0; i < n; i++) {
    const xa = x0 + i * W, xb = xa + W + 0.004;
    const tilt = kind === 'parted' ? (i - (n - 1) / 2) * -0.07 : kind === 'swept' ? 0.1 : kind === 'swept2' ? -0.1 : 0;
    h.save();
    if (tilt) h.rotateAt((xa + xb) / 2, 1.66, 0.28, 0, 0, tilt);
    const col = C(10 + i);
    const zz = z1 + (i % 2) * 0.008;
    h.box(xa, B[i], z0, xb, 1.665, zz, col);
    if (kind !== 'blunt') {
      // anime points: each strand narrows to a tip
      h.box(xa + W * 0.16, B[i] - 0.03, z0 + 0.006, xb - W * 0.16, B[i] + 0.005, zz - 0.004, col);
      h.box(xa + W * 0.34, B[i] - 0.055, z0 + 0.01, xb - W * 0.34, B[i] - 0.025, zz - 0.008, col);
    }
    h.restore();
  }
  h.box(-0.338, 1.6, 0.2, 0.338, 1.7, 0.3, C(4)); // fills the top of the fringe
}

function sideLocks(h, C, bottom, { z0 = 0.06, z1 = 0.285, x = 0.296, w = 0.052, tip = true } = {}) {
  for (const s of [-1, 1]) {
    const col = C(s > 0 ? 21 : 20);
    h.box(s * x, bottom, z0, s * (x + w), 1.645, z1, col);
    if (tip) h.box(s * (x + 0.008), bottom - 0.05, z0 + 0.05, s * (x + w - 0.01), bottom + 0.004, z1 - 0.06, col);
  }
}

function orientDown(h, from, to) {
  const d = new THREE.Vector3(to[0] - from[0], to[1] - from[1], to[2] - from[2]);
  const len = d.length();
  d.normalize();
  const q = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), d);
  h.translate(from[0], from[1], from[2]);
  h.m.multiply(new THREE.Matrix4().makeRotationFromQuaternion(q));
  h.nm.getNormalMatrix(h.m);
  return len;
}

/**
 * Hair on a swinging chain. points: pivots from the root down; seg(h, i, len) draws segment
 * i hanging from its pivot along -y (the builder is already oriented).
 */
function chain(P, name, parent, points, opts, seg) {
  const bones = P.chain(name, parent, points, opts);
  for (let i = 0; i < points.length - 1; i++) {
    const h = P.B(bones[i], 'hair', { uv: 'hair' });
    h.save();
    const len = orientDown(h, points[i], points[i + 1]);
    seg(h, i, len);
    h.restore();
  }
  return bones;
}

function tie(P, bone, x, y, z, rot, color) {
  const b = P.B(bone, 'plain');
  b.save().translate(x, y, z).rotate(rot[0], rot[1], rot[2]);
  b.torus(0, 0, 0, 0.062, 0.03, color, 12, 6);
  b.restore();
}

function tailSeg(C, widths, depths, idx) {
  return (h, i, len) => {
    const w = widths[i], d = depths[i];
    const col = C(idx + i);
    h.cbox(-w / 2, -len - 0.02, -d / 2, w / 2, 0.02, d / 2, 0.03, col);
    if (i === widths.length - 1) {
      h.cbox(-w * 0.3, -len - 0.08, -d * 0.3, w * 0.3, -len + 0.01, d * 0.3, 0.02, col);
    }
  };
}

// ---------- styles ----------

const STYLES = {
  long(P, h, C) {
    P.backZ = -0.35;
    helmet(h, C, { sideBottom: 1.12, backBottom: 1.1 });
    bangs(h, C, 'swept');
    sideLocks(h, C, 0.98);
    backCurtain(P, C, { bottom: 0.74, wave: false });
  },
  wavy_long(P, h, C) {
    P.backZ = -0.36;
    helmet(h, C, { sideBottom: 1.1, backBottom: 1.08, puff: 0.012 });
    bangs(h, C, 'parted');
    sideLocks(h, C, 0.92, { w: 0.06 });
    backCurtain(P, C, { bottom: 0.66, wave: true });
  },
  ponytail(P, h, C) {
    helmet(h, C, { sideBottom: 1.3, backBottom: 1.24 });
    bangs(h, C, 'swept');
    sideLocks(h, C, 1.3, { w: 0.04, z0: 0.14 });
    const pts = [[0, 1.6, -0.34], [0, 1.47, -0.45], [0, 1.28, -0.48], [0, 1.08, -0.45], [0, 0.94, -0.41]];
    chain(P, 'tail', 'head', pts, { swing: 1 }, tailSeg(C, [0.18, 0.17, 0.14, 0.1], [0.15, 0.14, 0.12, 0.09], 30));
    tie(P, 'head', 0, 1.6, -0.33, [1.1, 0, 0], P.tieColor);
  },
  pigtails(P, h, C) {
    helmet(h, C, { sideBottom: 1.3, backBottom: 1.22 });
    bangs(h, C, 'parted');
    for (const s of [-1, 1]) {
      const pts = [[s * 0.36, 1.46, -0.1], [s * 0.43, 1.33, -0.11], [s * 0.45, 1.16, -0.1], [s * 0.43, 1.0, -0.08]];
      chain(P, s > 0 ? 'pigL' : 'pigR', 'head', pts, { swing: 1 }, tailSeg(C, [0.15, 0.14, 0.1], [0.14, 0.13, 0.1], s > 0 ? 30 : 40));
      tie(P, 'head', s * 0.35, 1.47, -0.1, [0, 0, s * 1.2], P.tieColor);
    }
  },
  bun(P, h, C) {
    helmet(h, C, { sideBottom: 1.3, backBottom: 1.3 });
    bangs(h, C, 'swept2');
    sideLocks(h, C, 1.26, { w: 0.035, z0: 0.16, tip: false });
    h.ccube(0, 1.8, -0.1, 0.28, 0.2, 0.26, 0.07, C(11));
    h.save().rotateAt(0, 1.86, -0.1, 0, Math.PI / 4, 0);
    h.ccube(0, 1.88, -0.1, 0.2, 0.14, 0.2, 0.06, C(12));
    h.restore();
    tie(P, 'head', 0, 1.74, -0.1, [0, 0, 0], P.tieColor);
  },
  space_buns(P, h, C) {
    helmet(h, C, { sideBottom: 1.28, backBottom: 1.24 });
    bangs(h, C, 'parted');
    sideLocks(h, C, 1.18, { w: 0.03, z0: 0.18, tip: false });
    for (const s of [-1, 1]) {
      h.save().rotateAt(s * 0.21, 1.8, -0.02, 0, s * 0.5, 0);
      h.ccube(s * 0.21, 1.81, -0.02, 0.22, 0.2, 0.22, 0.075, C(s > 0 ? 13 : 16));
      h.restore();
      tie(P, 'head', s * 0.2, 1.73, -0.02, [0, 0, s * 0.25], P.tieColor);
    }
  },
  braids(P, h, C) {
    helmet(h, C, { sideBottom: 1.3, backBottom: 1.2 });
    bangs(h, C, 'parted');
    for (const s of [-1, 1]) {
      const pts = [[s * 0.31, 1.32, -0.06], [s * 0.31, 1.17, 0.05], [s * 0.3, 1.02, 0.12], [s * 0.29, 0.88, 0.14], [s * 0.285, 0.76, 0.14]];
      chain(P, s > 0 ? 'braidL' : 'braidR', 'head', pts, { swing: 0.7 }, (b, i, len) => {
        const col = C((s > 0 ? 30 : 40) + i);
        const n = 2;
        for (let k = 0; k < n; k++) {
          const y0 = -((k + 0.0) / n) * len, y1 = -((k + 1) / n) * len;
          const off = (k + i) % 2 ? 0.022 : -0.022;
          b.cbox(-0.055 + off, y1 - 0.02, -0.05, 0.055 + off, y0 + 0.01, 0.05, 0.025, col);
        }
        if (i === pts.length - 2) {
          b.cbox(-0.04, -len - 0.1, -0.035, 0.04, -len - 0.02, 0.035, 0.015, col);
        }
      });
      const last = pts[pts.length - 1];
      tie(P, s > 0 ? 'braidL3' : 'braidR3', last[0], last[1] - 0.01, last[2], [0, 0, 0], P.tieColor);
      tie(P, 'head', s * 0.31, 1.32, -0.06, [0.4, 0, s * 1.3], P.tieColor);
    }
  },
  curly(P, h, C) {
    P.backZ = -0.41;
    helmet(h, C, { sideBottom: 1.12, backBottom: 1.06, puff: 0.03 });
    const rand = mulberry32(99);
    // a halo of curls around the crown, sides and back
    const curl = (x, y, z, s, i) => {
      h.save().rotateAt(x, y, z, (rand() - 0.5) * 0.6, (rand() - 0.5) * 0.8, (rand() - 0.5) * 0.6);
      h.ccube(x, y, z, s, s, s, s * 0.3, C(10 + i));
      h.restore();
    };
    let i = 0;
    for (let a = 0; a < 16; a++) {
      const ang = (a / 16) * Math.PI * 2;
      const x = Math.sin(ang) * 0.36, z = Math.cos(ang) * 0.31 - 0.02;
      if (z > 0.2 && Math.abs(x) < 0.22) continue; // leave the face open
      curl(x, 1.66 + rand() * 0.06, z, 0.12 + rand() * 0.03, i++);
    }
    for (let a = 0; a < 7; a++) curl(-0.24 + a * 0.08, 1.63 + (a % 2) * 0.03, 0.27, 0.1 + rand() * 0.02, i++); // bangs
    for (let a = 0; a < 7; a++) curl(-0.3 + a * 0.1, 1.77 + rand() * 0.02, -0.05 + (a % 2) * 0.12, 0.13, i++); // top
    for (let y = 1.5; y >= 1.08; y -= 0.1) {
      for (const s of [-1, 1]) curl(s * (0.36 + rand() * 0.03), y, -0.02 - rand() * 0.2, 0.12 + rand() * 0.03, i++);
      for (let x = -0.28; x <= 0.29; x += 0.14) curl(x + (rand() - 0.5) * 0.04, y + (rand() - 0.5) * 0.04, -0.34, 0.13, i++);
    }
    for (const s of [-1, 1]) for (let y = 1.4; y >= 1.15; y -= 0.1) curl(s * 0.34, y, 0.17, 0.1, i++);
  },
  bob(P, h, C) {
    helmet(h, C, { sideBottom: 1.2, backBottom: 1.2, sideFront: 0.22 });
    bangs(h, C, 'blunt');
    // the bob's rounded ends, curling in at the jaw line
    for (const s of [-1, 1]) {
      h.box(s * 0.3, 1.2, -0.3, s * 0.36, 1.58, 0.24, C(s > 0 ? 21 : 20));
      h.box(s * 0.305, 1.17, -0.28, s * 0.35, 1.22, 0.22, C(s > 0 ? 23 : 22));
    }
    h.box(-0.36, 1.2, -0.33, 0.36, 1.6, -0.25, C(24));
    h.box(-0.33, 1.17, -0.32, 0.33, 1.22, -0.26, C(25));
  },
  short(P, h, C) {
    helmet(h, C, { sideBottom: 1.42, backBottom: 1.34 });
    bangs(h, C, 'short');
    sideLocks(h, C, 1.4, { w: 0.03, z0: 0.12, z1: 0.26 });
    // a little clip
    const b = P.B('head', 'plain');
    b.cbox(0.25, 1.56, 0.29, 0.33, 1.59, 0.31, 0.008, P.tieColor);
    b.cube(0.25, 1.575, 0.305, 0.04, 0.04, 0.02, P.tieColor);
  },
  side_pony(P, h, C) {
    helmet(h, C, { sideBottom: 1.3, backBottom: 1.24 });
    bangs(h, C, 'swept2');
    sideLocks(h, C, 1.3, { w: 0.04, z0: 0.14 });
    const pts = [[-0.34, 1.42, -0.14], [-0.41, 1.3, -0.04], [-0.4, 1.14, 0.1], [-0.36, 0.98, 0.16], [-0.33, 0.86, 0.16]];
    chain(P, 'sidepony', 'head', pts, { swing: 0.8 }, tailSeg(C, [0.17, 0.16, 0.13, 0.09], [0.15, 0.14, 0.12, 0.08], 30));
    tie(P, 'head', -0.345, 1.43, -0.14, [0.5, 0, -1.2], P.tieColor);
  },
  pixie(P, h, C) {
    helmet(h, C, { sideBottom: 1.44, backBottom: 1.4 });
    bangs(h, C, 'wispy');
    sideLocks(h, C, 1.4, { w: 0.03, z0: 0.14, z1: 0.27 });
    const tufts = [[-0.18, 1.76, 0.1, 0.4], [0.02, 1.78, 0.05, -0.2], [0.2, 1.76, 0.0, -0.5], [-0.05, 1.77, -0.18, 0.2], [0.14, 1.75, -0.22, -0.3]];
    tufts.forEach(([x, y, z, r], i) => {
      h.save().rotateAt(x, y, z, 0.3, 0, r);
      h.ccube(x, y + 0.02, z, 0.09, 0.08, 0.14, 0.025, C(10 + i));
      h.restore();
    });
  },
};

/** Long hair down the back, on a swinging "curtain" bone. */
function backCurtain(P, C, { bottom = 0.74, wave = false }) {
  const pivot = [0, 1.18, -0.29];
  const bone = P.bone('hairBack', 'head', pivot);
  P.addSwing(bone, { kind: 'curtain' });
  const h = P.B(bone, 'hair', { uv: 'hair' });
  const n = 9, x0 = -0.35, W = 0.7 / n;
  h.save().rotateAt(pivot[0], pivot[1], pivot[2], -0.16, 0, 0);
  for (let i = 0; i < n; i++) {
    const xa = x0 + i * W, xb = xa + W + 0.003;
    const edge = Math.abs(i - (n - 1) / 2) / ((n - 1) / 2);
    const yb = bottom + edge * edge * 0.12 + ((i * 7) % 3) * 0.012;
    const col = C(10 + i);
    if (!wave) {
      h.box(xa, yb, -0.335, xb, 1.2, -0.25, col);
      h.box(xa + W * 0.2, yb - 0.04, -0.325, xb - W * 0.2, yb + 0.005, -0.26, col);
    } else {
      const steps = 5;
      for (let k = 0; k < steps; k++) {
        const y1 = 1.2 - ((1.2 - yb) * k) / steps, y0 = 1.2 - ((1.2 - yb) * (k + 1)) / steps;
        const off = ((k + i) % 2 ? 1 : -1) * 0.018;
        h.box(xa + off, y0 - 0.01, -0.34 - Math.abs(off), xb + off, y1 + 0.01, -0.245, col);
      }
      h.box(xa + W * 0.2, yb - 0.045, -0.33, xb - W * 0.2, yb + 0.005, -0.26, col);
    }
  }
  h.restore();
}

/** Build the chosen style onto the head. */
export function buildHair(P) {
  const C = hairColors(P.look);
  const h = P.B('head', 'hair', { uv: 'hair' });
  h.under = 0.78;
  const style = STYLES[P.look.hair.style] || STYLES.long;
  style(P, h, C);
}
