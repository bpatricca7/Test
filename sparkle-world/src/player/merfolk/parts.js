// Sea-form parts (docs/teams/merfolk.md §7): the tail, the fin at its tip, the mermaid's waist
// frill and the sea dragon's creature parts (a long curving tail with light belly plates, a row
// of round-tipped crest spikes from the waist down the tail to the fin, bold leafy fronds and
// small forearm fins, glowing spots, curved horn nubs and a big ribbed fan fin with long outer
// lobes). Built lazily by the avatar the first time it turns (never in build()), shown or
// hidden with `visible`, and freed by the avatar's disposeSea().
//
//   buildSea(P, form, hex, look) -> { root, tip, tube, fluke, frill, bones, keys }
//   class TailTube: one CPU-deformed tube (like Flare), up to three material groups
//   paintScales / paintFin: the textures (light gray-scale; the color comes from vertex colors)
//
// The face, ears and cheeks are never touched: everything sits on the hips, the tail, the
// outside of the forearms and (only with no head accessory or a bow) two horn nubs on top of
// the head.

import * as THREE from 'three';
import { mixHex, shade } from '../../core/util.js';
import { lin } from '../avatar/geo.js';

const RINGS = 8;
const SIDES = 12;
const EXP = 2.6; // superellipse exponent: soft-boxy, like the blocky style
const ROOT_Y = 0.62 - 0.64; // the root ring sits inside the hip block (hip pivot at 0.64)
// where the crest plates and horns sample the scales texture: inside a belly plate (plain light)
export const CREST_V = 1 / 6;

export const TAIL = {
  mermaid: {
    len: 0.86,
    rx: [0.205, 0.19, 0.17, 0.15, 0.125, 0.10, 0.075, 0.05],
    rz: [0.13, 0.125, 0.12, 0.11, 0.095, 0.08, 0.06, 0.04],
  },
  // a creature's tail: longer and thicker (widest just under the hips), with a gentle S curve
  // at rest (bend: radians per joint, toward the back when positive)
  sea_dragon: {
    len: 0.96,
    rx: [0.2, 0.235, 0.23, 0.215, 0.19, 0.16, 0.125, 0.085],
    rz: [0.125, 0.16, 0.16, 0.15, 0.135, 0.115, 0.09, 0.065],
    bend: [0, 0.05, 0.09, 0.09, 0.05, -0.03, -0.08],
  },
};

// The dragon's accent (horns, crest tips, fin ribs) and belly: a rich gold of its own and warm
// cream plates (not mixed with the tail, so a pink tail never turns them peach). Some tails get
// accents of their own, so no tail color adds up to a famous dragon's colors: Purple has rose
// pink horns and crest with a pale lavender belly (never purple + gold + yellow, never purple
// with green spikes), Coral aqua with a shell-pink belly, Orange berry pink, Gold a deep teal
// with amber (not olive) shading.
const GOLD = '#FFC83A';
const BELLY = '#FFD36E';
const ACCENTS = {
  '#9C7BFF': { A: '#FF5FA8', B: '#F3E6FF' }, // Purple
  '#FF6B6B': { A: '#3FE0CF', B: '#FFDCD2' }, // Coral
  '#FFA94D': { A: '#E2458F', B: '#FFE9CF' }, // Orange
  '#FFD43B': { A: '#13958F', dark: '#A8430E' }, // Gold
};

/** Tail colors: C the tail, L fins, D edges, A the dragon's accent (crest tips, horns, fin
 *  ribs), S its dark back (it shades from S along the spine to C on the flanks: a dark shape
 *  in light water), B its belly plates, F / R its fronds and fan fin (deep root, light rim in
 *  its own color, never mixed with the accent: teal + gold turned them leaf green), K the root
 *  of its crest spikes, G / H the glow spots (core, halo), N the dark root band of its horns. */
export function seaPalette(hex) {
  const up = String(hex).toUpperCase();
  const x = ACCENTS[up] || {};
  // darker shades: toward black, or for Gold toward a deep amber (a darker yellow is olive)
  const dk = (k) => (x.dark ? mixHex(hex, x.dark, Math.min(1, k * 1.5)) : shade(hex, -k));
  return {
    C: hex, L: mixHex(hex, '#FFFFFF', 0.45), D: dk(0.25), A: x.A || GOLD,
    S: dk(0.45),
    B: x.B ? mixHex(hex, x.B, 0.85) : mixHex(hex, BELLY, 0.85), F: dk(0.38), R: mixHex(hex, '#FFFFFF', 0.32),
    K: dk(0.3),
    G: mixHex(hex, '#FFFFFF', 0.86), H: mixHex(hex, '#C8FFF4', 0.5),
    N: dk(0.55),
  };
}

/** A crest spike's color by height: its root in the tail color, its tip the accent. */
const _cc = new THREE.Color();
export function crestColor(pal, frac, out = _cc) {
  const k = Math.min(1, Math.max(0, (frac - 0.12) / 0.43));
  return out.copy(lin(pal.K)).lerp(lin(pal.A), k * k * (3 - 2 * k));
}

/**
 * One crest spike as triangles in a local frame: x across, y along the spine (toward the head),
 * z out of the back (negative). From the side it is a tall spike with a soft round tip (w long
 * at the base, h tall, the outline sin^peak, its tip leaning `lean` toward -y, the tail tip);
 * seen from behind or above it is a lens (thickest in the middle, 2t, thin at its edges).
 * Every triangle faces outward. cb(x, y, z) per vertex.
 */
export function crestPlate(w, h, t, lean, cb, z0 = 0, N = 8, peak = 1.5) {
  const rim = [], inP = [], inM = [];
  const base = [0, 0, z0 + 0.012];
  for (let j = 0; j <= N; j++) {
    const th = (j / N) * Math.PI, sn = Math.sin(th);
    const y = Math.cos(th) * w * 0.5 - lean * h * sn * sn;
    const z = z0 - h * Math.pow(sn, peak);
    rim.push([0, y, z]);
    // the inner ridge: the outline pulled 45 % toward the middle of the base, pushed out to ±t
    const iy = y * 0.55, iz = z0 + (z - z0) * 0.62;
    const tt = t * (0.55 + 0.45 * Math.pow(sn, 0.5));
    inP.push([tt, iy, iz]);
    inM.push([-tt, iy, iz]);
  }
  const ctr = [0, -lean * h * 0.4, z0 - h * 0.35];
  const tri = (a, b, c) => {
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const m = [(a[0] + b[0] + c[0]) / 3 - ctr[0], (a[1] + b[1] + c[1]) / 3 - ctr[1], (a[2] + b[2] + c[2]) / 3 - ctr[2]];
    const flip = n[0] * m[0] + n[1] * m[1] + n[2] * m[2] < 0;
    for (const v of flip ? [a, c, b] : [a, b, c]) cb(v[0], v[1], v[2]);
  };
  for (const side of [inP, inM]) {
    for (let j = 0; j < N; j++) {
      tri(rim[j], side[j], side[j + 1]);
      tri(rim[j], side[j + 1], rim[j + 1]);
      tri(base, side[j + 1], side[j]);
    }
  }
}

/** A leafy frond outline (three soft lobes, no points) as a fan of triangles from its root, in
 *  a local 2D frame: a along the leaf (0 at the root), b across. cb(a, b, edge) per vertex. */
function leafFan(len, wid, cb) {
  const N = 14, out = [];
  for (let j = 0; j <= N; j++) {
    const s = j / N; // 0 = upper edge at the root .. 1 = lower edge at the root
    const th = s * Math.PI;
    const lobe = 1 + 0.2 * Math.sin(th * 3) ** 2;
    out.push([len * Math.pow(Math.sin(th), 0.55) * lobe, Math.cos(th) * wid]);
  }
  for (let j = 0; j < N; j++) {
    cb(0, 0, 0);
    cb(out[j][0], out[j][1], 1);
    cb(out[j + 1][0], out[j + 1][1], 1);
  }
}

const se = (c) => Math.sign(c) * Math.pow(Math.abs(c), 2 / EXP);

// The tail's rest layout (ring index, offset, uv, color per vertex, and the group starts), made
// once per form and color and shared by every tail of that kind (turning stays cheap).
const TEMPLATES = new Map();
function tubeTemplate(form, pal) {
  const key = `${form}|${pal.C}`;
  const hit = TEMPLATES.get(key);
  if (hit) return hit;
  const T = TAIL[form] || TAIL.mermaid;
  const dragon = form === 'sea_dragon';
  const ring = [], off = [], uv = [], col = [];
  const white = lin(pal.C); // the scales texture is light gray: the vertex color is the tail's
  const belly = dragon ? lin(pal.B) : white;
  const push = (k, x, y, z, u, v, c) => {
    ring.push(k);
    off.push(x, y, z);
    uv.push(u, v);
    col.push(c.r, c.g, c.b);
  };
  // one triangle facing along `out` (a direction in the ring frame)
  const tri = (k, a, b, c, out, ca, cb = ca, cc = ca) => {
    const e1x = b[0] - a[0], e1y = b[1] - a[1], e1z = b[2] - a[2];
    const e2x = c[0] - a[0], e2y = c[1] - a[1], e2z = c[2] - a[2];
    const nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
    const v = nx * out[0] + ny * out[1] + nz * out[2] < 0 ? [[a, ca], [c, cc], [b, cb]] : [[a, ca], [b, cb], [c, cc]];
    for (const [p, cl] of v) push(k, p[0], p[1], p[2], p[3], p[4], cl);
  };
  const pt = (k, i) => {
    const a = (i / SIDES) * Math.PI * 2;
    return [-se(Math.sin(a)) * T.rx[k], 0, -se(Math.cos(a)) * T.rz[k], i / SIDES, (k / (RINGS - 1)) * 3];
  };
  // group 0: the tube (outside faces) and a small cap at the tip; the dragon's two front
  // columns (i 5, 6: she faces +Z) are its light belly plates
  // the dragon's flank color by column: its dark back (S) along the spine shading into the
  // tail color on the flanks (countershading, like a real sea creature)
  const back = dragon ? lin(pal.S) : white;
  const side = (u) => {
    if (!dragon) return white;
    const d = Math.max(0, Math.cos(u * Math.PI * 2)); // 1 on the spine .. 0 on the flanks
    return white.clone().lerp(back, Math.pow(d, 0.7));
  };
  for (let k = 0; k < RINGS - 1; k++) {
    for (let i = 0; i < SIDES; i++) {
      const a0 = pt(k, i), a1 = pt(k, i + 1), b0 = pt(k + 1, i), b1 = pt(k + 1, i + 1);
      const plate = i === 5 || i === 6;
      const quad = [[k, a0], [k + 1, b0], [k + 1, b1], [k, a0], [k + 1, b1], [k, a1]];
      for (const [kk, p] of quad) push(kk, p[0], 0, p[2], p[3], p[4], plate ? belly : side(p[3]));
    }
  }
  const last = RINGS - 1;
  for (let i = 0; i < SIDES; i++) {
    const a0 = pt(last, i), a1 = pt(last, i + 1);
    push(last, 0, -0.01, 0, 0.5, 3, white);
    push(last, a1[0], 0, a1[2], a1[3], a1[4], side(a1[3]));
    push(last, a0[0], 0, a0[2], a0[3], a0[4], side(a0[3]));
  }
  let g1 = ring.length, g2 = g1;
  if (dragon) {
    // everything here but the glow spots is drawn with the scales (one opaque draw), sampling
    // the plain middle of a belly plate (CREST_V): the colors are per vertex
    const flat = (k, x, y, z, c) => push(k, x, y, z, 0.5, CREST_V, c);
    // the crest: a tall row of round-tipped spikes down the back (-Z), one per ring, tall at
    // the waist and smaller toward the fin; each spike grows out of the tail color into a gold tip
    for (let k = 0; k < RINGS; k++) {
      const f = k / (RINGS - 1);
      const w = 0.18 - 0.07 * f, h = 0.31 - 0.16 * f, t = 0.065 - 0.027 * f, z0 = -T.rz[k] + 0.012;
      crestPlate(w, h, t, 0.4, (x, y, z) => flat(k, x, y, z, crestColor(pal, (z0 - z) / h).clone()), z0);
    }
    // leafy fronds: a big rounded three-lobed leaf on each side at rings 2, 4 and 6, swept
    // down toward the fin and a little back (so they show from behind too); solid, both faces,
    // a deep root growing into a lighter, gold-tinged rim
    const L = lin(pal.F), R = lin(pal.R);
    for (const [k, len, wid] of [[2, 0.3, 0.105], [4, 0.24, 0.085], [6, 0.17, 0.062]]) {
      for (const s of [-1, 1]) {
        const phi = 0.5;
        const d = [s * Math.cos(phi), -Math.sin(phi), -0.32], dl = Math.hypot(...d);
        d[0] /= dl; d[1] /= dl; d[2] /= dl;
        const e = [s * Math.sin(phi), Math.cos(phi), 0];
        const x0 = s * (T.rx[k] - 0.02);
        const at = (a, b) => [x0 + d[0] * a + e[0] * b, d[1] * a + e[1] * b, d[2] * a + e[2] * b];
        const tmp = [];
        leafFan(len, wid, (a, b, edge) => tmp.push([at(a, b), edge ? R : L]));
        // three gold ribs fanning from the root (a webbed fin, like the fan fin), a hair
        // proud of each face
        const A = lin(pal.A), nrm = [d[1] * e[2] - d[2] * e[1], d[2] * e[0] - d[0] * e[2], d[0] * e[1] - d[1] * e[0]];
        for (const r of [-0.55, 0, 0.55]) {
          const ea = len * (r === 0 ? 0.95 : 0.8), eb = wid * r * 0.95, w0 = 0.014, w1 = 0.006;
          const ra = Math.hypot(ea, eb), na = -eb / ra, nb = ea / ra;
          for (const f of [1, -1]) {
            const lift = (P3) => [P3[0] + nrm[0] * 0.004 * f, P3[1] + nrm[1] * 0.004 * f, P3[2] + nrm[2] * 0.004 * f];
            const q = [at(na * w0, nb * w0), at(ea + na * w1, eb + nb * w1), at(ea - na * w1, eb - nb * w1), at(-na * w0, -nb * w0)].map(lift);
            for (const P3 of [q[0], q[1], q[2], q[0], q[2], q[3]]) tmp.push([P3, A, f]);
          }
        }
        for (let j = 0; j < tmp.length; j += 3) {
          const f = tmp[j][2];
          let orders = [[0, 1, 2], [0, 2, 1]]; // the leaf: both faces
          if (f !== undefined) {
            // a rib: one face, toward its own side of the leaf
            const [a, b, c] = [tmp[j][0], tmp[j + 1][0], tmp[j + 2][0]];
            const u = [b[0] - a[0], b[1] - a[1], b[2] - a[2]], v = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
            const dot = (u[1] * v[2] - u[2] * v[1]) * nrm[0] + (u[2] * v[0] - u[0] * v[2]) * nrm[1] + (u[0] * v[1] - u[1] * v[0]) * nrm[2];
            orders = [dot * f > 0 ? [0, 1, 2] : [0, 2, 1]];
          }
          for (const o of orders) for (const i of o) flat(k, ...tmp[j + i][0], tmp[j + i][1]);
        }
      }
    }
    g1 = g2 = ring.length;
    // glow spots: a round spot with a soft halo on each side of the crest at rings 1..6
    // (unlit, gently pulsing: they shine at night and in deep water)
    const G = lin(pal.G), Hh = lin(pal.H);
    for (let k = 1; k <= 6; k++) {
      const r = 0.046 - 0.0035 * (k - 1);
      for (const s of [-1, 1]) {
        const a = s * 1.05, ep = 0.01;
        const P = (aa) => [-se(Math.sin(aa)) * T.rx[k], -se(Math.cos(aa)) * T.rz[k]];
        const p = P(a), p1 = P(a + ep), p0 = P(a - ep);
        let tx = p1[0] - p0[0], tz = p1[1] - p0[1];
        const tl = Math.hypot(tx, tz) || 1;
        tx /= tl; tz /= tl;
        let nx = tz, nz = -tx;
        if (nx * p[0] + nz * p[1] < 0) { nx = -nx; nz = -nz; }
        const out = [nx, 0, nz];
        const disc = (rad, lift, rad0, c0, c1) => {
          const cx = p[0] + nx * lift, cz = p[1] + nz * lift;
          const q = (rr, j) => {
            const an = (j / 8) * Math.PI * 2;
            return [cx + tx * Math.cos(an) * rr, Math.sin(an) * rr, cz + tz * Math.cos(an) * rr, 0, 0];
          };
          for (let j = 0; j < 8; j++) {
            if (rad0 === 0) tri(k, [cx, 0, cz, 0, 0], q(rad, j), q(rad, j + 1), out, c0, c1, c1);
            else {
              tri(k, q(rad0, j), q(rad, j), q(rad, j + 1), out, c0, c1, c1);
              tri(k, q(rad0, j), q(rad, j + 1), q(rad0, j + 1), out, c0, c1, c0);
            }
          }
        };
        disc(r * 1.75, 0.006, r * 0.95, Hh, white); // the halo, fading into the tail color
        disc(r, 0.008, 0, G, G);
      }
    }
    // and a glowing bead at the tip of each frond's middle rib (at night the spots and beads
    // draw the whole tail's outline)
    for (const [k, len] of [[2, 0.3], [4, 0.24], [6, 0.17]]) {
      for (const s of [-1, 1]) {
        const phi = 0.5;
        const d = [s * Math.cos(phi), -Math.sin(phi), -0.32], dl = Math.hypot(...d);
        d[0] /= dl; d[1] /= dl; d[2] /= dl;
        const c = [s * (T.rx[k] - 0.02) + d[0] * len * 0.93, d[1] * len * 0.93, d[2] * len * 0.93];
        const r = 0.024 - 0.003 * (k - 2) / 2;
        // a small octahedron (seen from anywhere)
        const v = [[r, 0, 0], [-r, 0, 0], [0, r, 0], [0, -r, 0], [0, 0, r], [0, 0, -r]].map((q) => [c[0] + q[0], c[1] + q[1], c[2] + q[2], 0, 0]);
        for (const [a, b] of [[0, 2], [2, 1], [1, 3], [3, 0]]) {
          for (const z of [4, 5]) {
            const o = [(v[a][0] + v[b][0] + v[z][0]) / 3 - c[0], (v[a][1] + v[b][1] + v[z][1]) / 3 - c[1], (v[a][2] + v[b][2] + v[z][2]) / 3 - c[2]];
            tri(k, v[a], v[b], v[z], o, G);
          }
        }
      }
    }
  }
  const tpl = { ring: Uint8Array.from(ring), off: Float32Array.from(off), uv: Float32Array.from(uv), col: Float32Array.from(col), g1, g2 };
  TEMPLATES.set(key, tpl);
  return tpl;
}

/**
 * The tail: RINGS rings of SIDES sides along a spine (rest direction -Y from the root), flat
 * shaded, with extras (crest spikes, fronds, glow spots) riding on the rings. Every vertex is
 * stored as (ring index, offset in that ring's frame), so deform() moves everything with the
 * spine, in place (no allocation). Groups: the scales (tube, and the dragon's crest spikes and
 * fronds), then the dragon's glow spots (the mermaid's tail is one group).
 */
export class TailTube {
  constructor(form, pal) {
    const T = TAIL[form] || TAIL.mermaid;
    this.seg = T.len / (RINGS - 1);
    this.bend = T.bend || null;
    const tpl = tubeTemplate(form, pal);
    const { ring, off, g1, g2 } = tpl;
    const n = ring.length;
    this.count = n;
    this.lit = g2; // vertices before the unlit glow spots: only these need normals
    this.ring = ring; // shared with the template: read only
    this.off = off;
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr = new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3);
    this.nrmAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('normal', this.nrmAttr);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(tpl.uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(tpl.col, 3));
    // the tube (and the dragon's crest spikes and fronds): one draw (the uv / color attributes
    // copy the template's arrays); then fins, then glow spots, each only if there are any, with
    // material indices in that order (buildSea's tubeMats match)
    g.addGroup(0, g1, 0);
    let mi = 1;
    if (g2 > g1) g.addGroup(g1, g2 - g1, mi++);
    if (n > g2) g.addGroup(g2, n - g2, mi++);
    this.geometry = g;
    this.groupCount = g.groups.length;
    // spine scratch (made once)
    this.P = new Float32Array(RINGS * 3);
    this.F = new Float32Array(RINGS * 9);
    this.tipPos = new THREE.Vector3();
    this.tipDir = new THREE.Vector3(0, -1, 0);
    this.tipMat = new THREE.Matrix4();
    this.deform(null, null);
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(0, -0.4, 0), 1.2);
  }

  /**
   * Bend the tail: angles[i] about X (toward her back when positive) and sides[i] about Z, for
   * joint i = 0..RINGS-2. Clamped to ±1.2 rad; a non-finite value counts as 0. Writes positions
   * and flat normals in place; this.tipPos / tipDir / tipMat give the tip.
   */
  deform(angles, sides) {
    const P = this.P, F = this.F;
    P[0] = 0; P[1] = ROOT_Y; P[2] = 0;
    F[0] = 1; F[1] = 0; F[2] = 0; F[3] = 0; F[4] = 1; F[5] = 0; F[6] = 0; F[7] = 0; F[8] = 1; // column-major 3x3
    const clampA = (v) => (Number.isFinite(v) ? Math.max(-1.2, Math.min(1.2, v)) : 0);
    for (let i = 0; i < RINGS - 1; i++) {
      const a = (angles ? clampA(angles[i]) : 0) + (this.bend ? this.bend[i] : 0);
      const s = sides ? clampA(sides[i]) : 0;
      const o = i * 9, q = o + 9;
      // R = Rx(a) * Rz(s) (column-major); F' = F * R
      const ca = Math.cos(a), sa = Math.sin(a), cs = Math.cos(s), ss = Math.sin(s);
      // R columns
      const r00 = cs, r10 = ca * ss, r20 = sa * ss;
      const r01 = -ss, r11 = ca * cs, r21 = sa * cs;
      const r02 = 0, r12 = -sa, r22 = ca;
      for (let row = 0; row < 3; row++) {
        const f0 = F[o + row], f1 = F[o + 3 + row], f2 = F[o + 6 + row];
        F[q + row] = f0 * r00 + f1 * r10 + f2 * r20;
        F[q + 3 + row] = f0 * r01 + f1 * r11 + f2 * r21;
        F[q + 6 + row] = f0 * r02 + f1 * r12 + f2 * r22;
      }
      const p = i * 3, pn = p + 3, L = this.seg;
      // step along -Y of the new frame
      P[pn] = P[p] - F[q + 3] * L;
      P[pn + 1] = P[p + 1] - F[q + 4] * L;
      P[pn + 2] = P[p + 2] - F[q + 5] * L;
    }
    const out = this.posAttr.array, ring = this.ring, off = this.off;
    for (let v = 0, n = this.count; v < n; v++) {
      const k = ring[v], o = k * 9, p = k * 3, v3 = v * 3;
      const x = off[v3], y = off[v3 + 1], z = off[v3 + 2];
      out[v3] = P[p] + F[o] * x + F[o + 3] * y + F[o + 6] * z;
      out[v3 + 1] = P[p + 1] + F[o + 1] * x + F[o + 4] * y + F[o + 7] * z;
      out[v3 + 2] = P[p + 2] + F[o + 2] * x + F[o + 5] * y + F[o + 8] * z;
    }
    const nr = this.nrmAttr.array;
    for (let t = 0, n = this.lit; t < n; t += 3) {
      const a = t * 3, b = a + 3, c = a + 6;
      const e1x = out[b] - out[a], e1y = out[b + 1] - out[a + 1], e1z = out[b + 2] - out[a + 2];
      const e2x = out[c] - out[a], e2y = out[c + 1] - out[a + 1], e2z = out[c + 2] - out[a + 2];
      let nx = e1y * e2z - e1z * e2y, ny = e1z * e2x - e1x * e2z, nz = e1x * e2y - e1y * e2x;
      const len = Math.hypot(nx, ny, nz) || 1;
      nx /= len; ny /= len; nz /= len;
      for (let k = 0; k < 9; k += 3) {
        nr[a + k] = nx;
        nr[a + k + 1] = ny;
        nr[a + k + 2] = nz;
      }
    }
    this.posAttr.needsUpdate = true;
    this.nrmAttr.needsUpdate = true;
    const lp = (RINGS - 1) * 3, lo = (RINGS - 1) * 9;
    this.tipPos.set(P[lp], P[lp + 1], P[lp + 2]);
    this.tipDir.set(-F[lo + 3], -F[lo + 4], -F[lo + 5]);
    const m = this.tipMat.elements;
    m[0] = F[lo]; m[1] = F[lo + 1]; m[2] = F[lo + 2]; m[3] = 0;
    m[4] = F[lo + 3]; m[5] = F[lo + 4]; m[6] = F[lo + 5]; m[7] = 0;
    m[8] = F[lo + 6]; m[9] = F[lo + 7]; m[10] = F[lo + 8]; m[11] = 0;
    m[12] = P[lp]; m[13] = P[lp + 1]; m[14] = P[lp + 2]; m[15] = 1;
    return this.tipPos;
  }

  dispose() {
    this.geometry.dispose();
  }
}

/**
 * The fin at the tail's tip, flat in the tip's X-Y plane (faces toward ±Z: horizontal when she
 * swims flat, like a dolphin's), hanging down -Y from the tip. Mermaid: two rounded scalloped
 * lobes with a little notch (see-through, the fin material). Sea dragon: a big fan of five
 * rounded lobes whose outer lobes reach furthest (a tail fin, not a round shell), held by five
 * gold ribs, no pointed tips; solid, both faces, drawn with the scales (plain, CREST_V uv), a
 * deep tail-colored root growing into a gold-tinged rim.
 */
export function flukeGeometry(form, pal) {
  const pos = [], uv = [], col = [];
  const dragon = form === 'sea_dragon';
  const L = lin(dragon ? pal.F : pal.L), A = lin(dragon ? pal.R : pal.L);
  const W = dragon ? 0.8 : 0.52, H = dragon ? 0.44 : 0.26;
  const outline = [];
  const N = dragon ? 40 : 30;
  const fanY = (s) => {
    // five round lobes (one per rib) with soft dips; the outer lobes reach furthest
    const side = Math.abs(2 * s - 1); // 0 middle .. 1 edge
    const env = Math.sin(s * Math.PI) ** 0.3; // back up toward the root at the two edges
    const cres = 0.62 + 0.38 * side ** 1.3;
    return -H * (0.12 + 0.88 * env * cres) * (0.84 + 0.16 * Math.sin(s * Math.PI * 5) ** 2);
  };
  for (let j = 0; j <= N; j++) {
    const s = j / N; // 0 = left edge root, 1 = right edge root
    const x = (s - 0.5) * W;
    let y;
    if (dragon) y = fanY(s);
    else {
      // two lobes with a notch in the middle and small scallops
      const side = Math.abs(s - 0.5) * 2; // 0 middle .. 1 edge
      const lobe = Math.sin(Math.min(1, side) * Math.PI) ** 0.8;
      const notch = 0.25 + 0.75 * Math.min(1, side * 3);
      const scallop = 1 - 0.07 * Math.abs(Math.sin(side * Math.PI * 5));
      y = -H * (0.3 + 0.7 * lobe) * notch * scallop;
    }
    outline.push([x, y]);
  }
  const root = [0, 0.02];
  // the dragon's fan folds its outer lobes a little toward its back (a shallow V seen end on),
  // so from the side it shows as a wedge, not a thin stick
  const FOLD = dragon ? 0.42 : 0;
  const put = (x, y, z, c) => {
    pos.push(x, y, z - FOLD * Math.abs(x));
    if (dragon) uv.push(0.5, CREST_V);
    else uv.push(0.5 + x / W, -y / H);
    col.push(c.r, c.g, c.b);
  };
  // one triangle; the dragon's (solid, one-sided material) also gets its back face
  const tri = (a, b, c, ca, cb, cc, z = 0, faces = dragon ? [1, -1] : [1]) => {
    for (const f of faces) {
      const zz = z * f;
      if (f > 0) { put(a[0], a[1], zz, ca); put(b[0], b[1], zz, cb); put(c[0], c[1], zz, cc); }
      else { put(a[0], a[1], zz, ca); put(c[0], c[1], zz, cc); put(b[0], b[1], zz, cb); }
    }
  };
  for (let j = 0; j < N; j++) {
    const p = outline[j], q = outline[j + 1];
    if (!dragon) { put(root[0], root[1], 0, L); put(p[0], p[1], 0, A); put(q[0], q[1], 0, A); }
    else tri(root, p, q, L, A, A); // faces +Z (p is left of q), and its back face
  }
  if (dragon) {
    // five ribs from the root to the middle of each lobe, a thin strip on each face
    const Ar = lin(pal.A);
    for (let r = 0; r < 5; r++) {
      const s = 0.1 + 0.2 * r;
      const ex = (s - 0.5) * W * 0.92, ey = fanY(s) * 0.93;
      const dl = Math.hypot(ex - root[0], ey - root[1]);
      const nx = -(ey - root[1]) / dl, ny = (ex - root[0]) / dl;
      const w0 = 0.02, w1 = 0.009;
      const a0 = [root[0] + nx * w0, root[1] + ny * w0], a1 = [root[0] - nx * w0, root[1] - ny * w0];
      const b0 = [ex + nx * w1, ey + ny * w1], b1 = [ex - nx * w1, ey - ny * w1];
      // a0 -> b0 -> b1 turns one way; pick the winding that faces +Z
      const cz = (b0[0] - a0[0]) * (b1[1] - a0[1]) - (b0[1] - a0[1]) * (b1[0] - a0[0]);
      const [u, v] = cz > 0 ? [b0, b1] : [b1, b0];
      tri(a0, u, v, Ar, Ar, Ar, 0.005);
      const cz2 = (b1[0] - a0[0]) * (a1[1] - a0[1]) - (b1[1] - a0[1]) * (a1[0] - a0[0]);
      const [u2, v2] = cz2 > 0 ? [b1, a1] : [a1, b1];
      tri(a0, u2, v2, Ar, Ar, Ar, 0.005);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 0; i < nrm.length; i += 9) {
    // flat: each face's own normal by its winding (the mermaid's see-through fin: +Z)
    if (!dragon) { nrm[i + 2] = nrm[i + 5] = nrm[i + 8] = 1; continue; }
    const ux = pos[i + 3] - pos[i], uy = pos[i + 4] - pos[i + 1], uz = pos[i + 5] - pos[i + 2];
    const vx = pos[i + 6] - pos[i], vy = pos[i + 7] - pos[i + 1], vz = pos[i + 8] - pos[i + 2];
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l; ny /= l; nz /= l;
    for (let k = 0; k < 9; k += 3) { nrm[i + k] = nx; nrm[i + k + 1] = ny; nrm[i + k + 2] = nz; }
  }
  g.setAttribute('normal', new THREE.Float32BufferAttribute(nrm, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.computeBoundingSphere();
  return g;
}

// ---------- textures (light gray-scale; vertex colors give the hue) ----------

/** Scales: mermaid half-round scales in offset rows; dragon diamond scales with a lighter belly. */
export function paintScales(g, w, h, form) {
  g.fillStyle = '#C9C9C9';
  g.fillRect(0, 0, w, h);
  const cols = 8, rows = 8, cw = w / cols, ch = h / rows;
  if (form === 'sea_dragon') {
    // soft diamond scales on the sides and back
    for (let r = -1; r <= rows; r++) {
      for (let c = -1; c <= cols; c++) {
        const cx = (c + (r % 2 ? 0.5 : 0)) * cw, cy = r * ch;
        g.beginPath();
        g.moveTo(cx, cy - ch * 0.62);
        g.lineTo(cx + cw * 0.5, cy);
        g.lineTo(cx, cy + ch * 0.62);
        g.lineTo(cx - cw * 0.5, cy);
        g.closePath();
        const grd = g.createLinearGradient(cx, cy - ch * 0.6, cx, cy + ch * 0.6);
        grd.addColorStop(0, '#F4F4F4');
        grd.addColorStop(1, '#BDBDBD');
        g.fillStyle = grd;
        g.fill();
        g.strokeStyle = '#8E8E8E';
        g.lineWidth = 1.2;
        g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.fillRect(cx - 1.5, cy - ch * 0.35, 3, 3);
      }
    }
    // the belly (u 0.4-0.6, her front): three wide smooth plates per repeat, like a dragon's
    // belly, not fish scales (the crest and horns sample a plate's plain middle, CREST_V)
    const x0 = w * 0.4, bw = w * 0.2, ph = h / 3;
    for (let j = 0; j < 3; j++) {
      const y0 = j * ph;
      const grd = g.createLinearGradient(0, y0, 0, y0 + ph);
      grd.addColorStop(0, '#FFFFFF');
      grd.addColorStop(0.7, '#F7F7F7');
      grd.addColorStop(1, '#C8C8C8');
      g.fillStyle = grd;
      g.fillRect(x0, y0, bw, ph);
      g.fillStyle = '#9A9A9A';
      g.fillRect(x0, y0 + ph - 3, bw, 3);
    }
    g.fillStyle = '#F7F7F7';
    g.fillRect(x0 + 2, h * (1 - CREST_V) - 6, bw - 4, 12);
  } else {
    for (let r = -1; r <= rows; r++) {
      for (let c = -1; c <= cols; c++) {
        const cx = (c + 0.5 + (r % 2 ? 0.5 : 0)) * cw, cy = r * ch;
        g.beginPath();
        g.arc(cx, cy, cw * 0.56, 0, Math.PI);
        g.closePath();
        const grd = g.createRadialGradient(cx, cy, 1, cx, cy, cw * 0.6);
        grd.addColorStop(0, '#FFFFFF');
        grd.addColorStop(1, '#C2C2C2');
        g.fillStyle = grd;
        g.fill();
        g.strokeStyle = '#9A9A9A';
        g.lineWidth = 1;
        g.stroke();
        g.fillStyle = '#FFFFFF';
        g.beginPath();
        g.arc(cx - cw * 0.12, cy + ch * 0.18, 1.6, 0, Math.PI * 2);
        g.fill();
      }
    }
  }
}

/** Fins (the mermaid's; the sea dragon has no see-through fins): translucent, 0.85 alpha at the
 *  base (v 0) to 0.55 at the edge, 7 ribs, a white rim. */
export function paintFin(g, w, h) {
  g.clearRect(0, 0, w, h);
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgba(255,255,255,0.85)');
  grd.addColorStop(1, 'rgba(255,255,255,0.55)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = 'rgba(190,190,190,0.7)';
  g.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    g.beginPath();
    g.moveTo(w / 2, 0);
    g.lineTo(((i + 0.5) / 7) * w, h);
    g.stroke();
  }
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, w - 3, h - 3);
}

// Where the horn nubs grow (the right one; the left mirrors it), or null: x, y, z its root, out
// its outward tilt, back its backward tilt, size. They sit on top of the head a little behind
// the middle. Only with no head accessory or a bow (a small piece at the side or front): every
// other head accessory sits on top of the head (hats, crowns, tiaras, headbands, ears, a
// unicorn horn, a halo, headphones), and horns there would grow out of it, so they are left
// out. Hair that sits where they grow moves them: out past a fauxhawk's ridge or a top bun,
// behind space buns, up out of tall hair (an afro, curls, spikes) so they never end in it.
const HORN_ACC = {
  none: {},
  bow: { x: 0.21, y: 1.73, z: -0.22, out: 0.55 },
};
const HORN_HAIR = {
  afro: { y: 1.92 }, curly: { y: 1.78 }, spiky: { y: 1.76 }, short_curly: { y: 1.7 }, bun: { x: 0.24 }, space_buns: { z: -0.2 },
  fauxhawk: { x: 0.21, out: 0.45 },
};
export function hornSpot(look) {
  const head = (look && look.acc && look.acc.head) || 'none';
  if (!Object.prototype.hasOwnProperty.call(HORN_ACC, head)) return null;
  const a = HORN_ACC[head];
  const hs = look && look.hair && look.hair.style;
  const h = (Object.prototype.hasOwnProperty.call(HORN_HAIR, hs) && HORN_HAIR[hs]) || {};
  // tall hair lifts a horn that sits out at the side less (the hair is lower there)
  const lift = a.out > 0.6 && h.y ? Math.max(0, h.y - 1.66) * 0.6 : Math.max(0, (h.y || 0) - 1.66);
  return {
    x: Math.max(0.14, h.x || 0, a.x || 0), y: Math.max(1.66, a.y || 0) + lift, z: Math.min(-0.04, h.z ?? 0, a.z ?? 0),
    out: a.out ?? h.out ?? 0.3, back: a.back ?? 0, size: a.size ?? 1,
  };
}

/** One curved horn: a tapered tube along a spine that sweeps back ring by ring, with a dark
 *  root band, ridge bands down its length and a soft light tip. base: its root (avatar space),
 *  rot: its starting tilt (Euler XYZ), size: its scale; c = { root, body, ridge, tip }. */
const _hm = new THREE.Matrix4(), _hs = new THREE.Matrix4(), _hv = new THREE.Vector3(), _he = new THREE.Euler();
const HORN_STEPS = [ // [radius, length to the next ring, bend back]; odd rings are the ridges
  [0.084, 0.055, -0.1], [0.088, 0.05, -0.18], [0.07, 0.05, -0.22], [0.072, 0.05, -0.26], [0.054, 0.045, -0.28],
  [0.054, 0.045, -0.3], [0.036, 0.04, -0.3], [0.024, 0.03, -0.2], [0.012, 0, 0],
];
function horn(H, base, rot, c, size = 1) {
  const SEG = 7;
  _hm.makeTranslation(base[0], base[1], base[2]).multiply(_hs.makeRotationFromEuler(_he.set(rot[0], rot[1], rot[2])));
  _hm.multiply(_hs.makeScale(size, size, size));
  const rings = [], centers = [];
  for (const [r, len, bend] of HORN_STEPS) {
    const ring = [];
    for (let i = 0; i < SEG; i++) {
      const a = (i / SEG) * Math.PI * 2;
      _hv.set(Math.cos(a) * r, 0, Math.sin(a) * r).applyMatrix4(_hm);
      ring.push([_hv.x, _hv.y, _hv.z]);
    }
    _hv.set(0, 0, 0).applyMatrix4(_hm);
    centers.push([_hv.x, _hv.y, _hv.z]);
    rings.push(ring);
    _hm.multiply(_hs.makeTranslation(0, len, 0)).multiply(_hs.makeRotationX(bend));
  }
  _hv.set(0, 0.012, 0).applyMatrix4(_hm);
  const top = [_hv.x, _hv.y, _hv.z];
  const n = rings.length;
  for (let k = 0; k < n - 1; k++) {
    const A = rings[k], B = rings[k + 1];
    const ctr = [(centers[k][0] + centers[k + 1][0]) / 2, (centers[k][1] + centers[k + 1][1]) / 2, (centers[k][2] + centers[k + 1][2]) / 2];
    const col = k === 0 ? c.root : k >= n - 3 ? c.tip : k % 2 ? c.ridge : c.body;
    for (let i = 0; i < SEG; i++) {
      const j = (i + 1) % SEG;
      H.poly([A[i], A[j], B[j], B[i]], col, { center: ctr });
    }
  }
  const L = rings[n - 1], lc = centers[n - 1];
  const ctr = [(lc[0] + top[0]) / 2 - (top[0] - lc[0]), (lc[1] + top[1]) / 2 - (top[1] - lc[1]), (lc[2] + top[2]) / 2 - (top[2] - lc[2])];
  for (let i = 0; i < SEG; i++) H.poly([L[i], L[(i + 1) % SEG], top], c.tip, { center: ctr });
}

// ---------- the whole set ----------

/**
 * Build the sea parts for one avatar. P: the avatar's BuildContext (P.B(boneOrGroup, matKey)
 * merges extras per bone and material). Returns what the avatar turns into meshes:
 *   root (Group for the hips), tip (Object3D at the tail's tip), tube (TailTube),
 *   tubeMats ([scales, fins, glow] material keys in group order), fluke geometry + key,
 *   bones (Groups the avatar adds and later removes: horn nubs, back crest), keys (the sea
 *   material keys disposeSea() owns: scale, fin and, for the dragon, seaglow).
 */
export function buildSea(P, form, hex, look) {
  const pal = seaPalette(hex);
  const scale = `scale:${hex}:${form}`;
  const fin = `fin:${hex}:${form}`;
  const bones = P.av.bones;
  const root = new THREE.Group();
  root.name = 'sea';
  root.userData.origin = [0, 0.64, 0];
  bones.hips.add(root);
  const tip = new THREE.Object3D();
  tip.name = 'seaTip';
  tip.matrixAutoUpdate = false;
  root.add(tip);
  const tube = new TailTube(form, pal);
  const fluke = flukeGeometry(form, pal);
  const extraBones = [];
  if (form === 'mermaid') {
    // a little fin frill at the waist: 10 petals tilted out
    const F = P.B(root, fin);
    const L = pal.L;
    for (let i = 0; i < 10; i++) {
      const a0 = (i / 10) * Math.PI * 2, a1 = ((i + 1) / 10) * Math.PI * 2, am = (a0 + a1) / 2;
      const r = 0.2, out = 0.075;
      const at = (a, rr, y) => [Math.sin(a) * rr, y, Math.cos(a) * rr * 0.68];
      const top0 = at(a0, r, 0.64), top1 = at(a1, r, 0.64);
      const bot0 = at(a0 - 0.05, r + out, 0.56), bot1 = at(a1 + 0.05, r + out, 0.56), mid = at(am, r + out * 1.25, 0.545);
      F.poly([top0, bot0, mid, top1], L, { center: [0, 0.6, 0], uvs: [[0.2, 0], [0, 0.9], [0.5, 1], [0.8, 0]] });
      F.poly([top1, mid, bot1], L, { center: [0, 0.6, 0], uvs: [[0.8, 0], [0.5, 1], [1, 0.9]] });
    }
  } else if (form === 'sea_dragon') {
    // two curved horn nubs on top of the head, swept back, rounded tips, clearly above the hair
    // (only with no head accessory or a bow; moved for a bow and for hair where they grow)
    const spot = hornSpot(look);
    if (spot) {
      const g = new THREE.Group();
      g.name = 'seaHorns';
      g.position.set(0, 1.74 - 1.1, -0.06);
      g.userData.origin = [0, 1.74, -0.06];
      bones.head.add(g);
      extraBones.push(g);
      const H = P.B(g, 'plain');
      const hc = { root: pal.N, body: pal.A, ridge: shade(pal.A, -0.13), tip: mixHex(pal.A, '#FFF4D6', 0.5) };
      for (const s of [-1, 1]) horn(H, [s * spot.x, spot.y, spot.z], [-0.15 - spot.back, 0, -s * spot.out], hc, spot.size);
    }
    // the crest runs from the waist down the whole tail: it is not carried up the back, where
    // it would sit on her own shirt (over a shirt number), under long hair or a backpack
    // small leafy fins on the outside of each forearm, lying back along the arm toward the
    // elbow (solid, both faces). Each hangs on its own sea group under the elbow (in `bones`),
    // so the avatar hides it with the tail on land and grows it with the tail.
    for (const s of [-1, 1]) {
      const x0 = s * 0.33, y0 = 0.7, len = 0.16, wid = 0.05;
      const elbow = s > 0 ? bones.elbowL : bones.elbowR;
      const eo = elbow.userData.origin;
      const fg = new THREE.Group();
      fg.name = s > 0 ? 'seaFinL' : 'seaFinR';
      fg.position.set(x0 - eo[0], y0 - eo[1], -0.04 - eo[2]); // grows from the fin's root
      fg.userData.origin = [x0, y0, -0.04];
      elbow.add(fg);
      extraBones.push(fg);
      const F = P.B(fg, scale);
      const d = [s * 0.3, 0.9, -0.32], dl = Math.hypot(...d);
      const e = [s * 0.55, 0, -0.84];
      const at = (aa, bb) => [x0 + (d[0] / dl) * aa + e[0] * bb, y0 + (d[1] / dl) * aa + e[1] * bb, -0.04 + (d[2] / dl) * aa + e[2] * bb];
      const v = [];
      leafFan(len, wid, (aa, bb) => v.push(at(aa, bb)));
      const uvs = [[0.5, CREST_V], [0.5, CREST_V], [0.5, CREST_V]];
      const root = at(0, 0), cF = lin(pal.F), cR = lin(pal.R);
      const col = (p) => (Math.abs(p.x - root[0]) + Math.abs(p.y - root[1]) + Math.abs(p.z - root[2]) < 1e-4 ? cF : cR);
      for (let i = 0; i < v.length; i += 3) {
        F.poly([v[i], v[i + 1], v[i + 2]], col, { uvs });
        F.poly([v[i], v[i + 2], v[i + 1]], col, { uvs });
      }
    }
  }
  // the dragon is drawn with the scales and its glow spots only (no see-through fins)
  if (form === 'sea_dragon') {
    const glow = `seaglow:${hex}`;
    return { root, tip, tube, tubeMats: [scale, glow], fluke, flukeMat: scale, bones: extraBones, keys: [scale, glow], palette: pal };
  }
  return { root, tip, tube, tubeMats: [scale], fluke, flukeMat: fin, bones: extraBones, keys: [scale, fin], palette: pal };
}
