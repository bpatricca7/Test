// Sea-form parts (docs/teams/merfolk.md §7): the tail, the fin at its tip, the mermaid's waist
// frill and the sea dragon's bubble spikes, leafy fronds, glow spots and soft horn nubs. Built
// lazily by the avatar the first time it turns (never in build()), shown or hidden with
// `visible`, and freed by the avatar's disposeSea().
//
//   buildSea(P, form, hex, look) -> { root, tip, tube, fluke, frill, bones, keys }
//   class TailTube: one CPU-deformed tube (like Flare), up to three material groups
//   paintScales / paintFin: the textures (light gray-scale; the color comes from vertex colors)
//
// The face, ears and cheeks are never touched: everything sits on the hips, the tail, the back
// of the neck and (with no head accessory) two small nubs on top of the head.

import * as THREE from 'three';
import { mixHex, shade } from '../../core/util.js';
import { lin } from '../avatar/geo.js';

const RINGS = 8;
const SIDES = 12;
const EXP = 2.6; // superellipse exponent: soft-boxy, like the blocky style
const ROOT_Y = 0.62 - 0.64; // the root ring sits inside the hip block (hip pivot at 0.64)

export const TAIL = {
  mermaid: {
    len: 0.86,
    rx: [0.205, 0.19, 0.17, 0.15, 0.125, 0.10, 0.075, 0.05],
    rz: [0.13, 0.125, 0.12, 0.11, 0.095, 0.08, 0.06, 0.04],
  },
  sea_dragon: {
    len: 0.74,
    rx: [0.21, 0.2, 0.185, 0.165, 0.14, 0.115, 0.09, 0.06],
    rz: [0.14, 0.135, 0.13, 0.12, 0.105, 0.09, 0.07, 0.05],
  },
};

/** Tail colors: C the tail, L fins, D edges, A the dragon's accent. */
export function seaPalette(hex) {
  return { C: hex, L: mixHex(hex, '#FFFFFF', 0.45), D: shade(hex, -0.25), A: mixHex(hex, '#FFD43B', 0.4) };
}

const se = (c) => Math.sign(c) * Math.pow(Math.abs(c), 2 / EXP);

/**
 * The tail: RINGS rings of SIDES sides along a spine (rest direction -Y from the root), flat
 * shaded, with extras (domes, fronds, glow spots) riding on the rings. Every vertex is stored as
 * (ring index, offset in that ring's frame), so deform() moves everything with the spine, in
 * place (no allocation). Groups: 0 scales (tube + domes), 1 fins (fronds), 2 glow (spots).
 */
export class TailTube {
  constructor(form, pal) {
    const T = TAIL[form] || TAIL.mermaid;
    this.seg = T.len / (RINGS - 1);
    const ring = [], off = [], uv = [], col = [];
    const white = lin(pal.C); // the scales texture is light gray: the vertex color is the tail's
    const push = (k, x, y, z, u, v, c) => {
      ring.push(k);
      off.push(x, y, z);
      uv.push(u, v);
      col.push(c.r, c.g, c.b);
    };
    const pt = (k, i) => {
      const a = (i / SIDES) * Math.PI * 2;
      return [-se(Math.sin(a)) * T.rx[k], 0, -se(Math.cos(a)) * T.rz[k], i / SIDES, (k / (RINGS - 1)) * 3];
    };
    // group 0: the tube (outside faces) and a small cap at the tip
    for (let k = 0; k < RINGS - 1; k++) {
      for (let i = 0; i < SIDES; i++) {
        const a0 = pt(k, i), a1 = pt(k, i + 1), b0 = pt(k + 1, i), b1 = pt(k + 1, i + 1);
        const quad = [[k, a0], [k + 1, b0], [k + 1, b1], [k, a0], [k + 1, b1], [k, a1]];
        for (const [kk, p] of quad) push(kk, p[0], 0, p[2], p[3], p[4], white);
      }
    }
    const last = RINGS - 1;
    for (let i = 0; i < SIDES; i++) {
      const a0 = pt(last, i), a1 = pt(last, i + 1);
      push(last, 0, -0.01, 0, 0.5, 3, white);
      push(last, a1[0], 0, a1[2], a1[3], a1[4], white);
      push(last, a0[0], 0, a0[2], a0[3], a0[4], white);
    }
    const g0 = ring.length;
    let g1 = g0, g2 = g0;
    if (form === 'sea_dragon') {
      const A = lin(pal.A);
      // round bubble spikes along the back (-Z), rings 1..6
      for (let k = 1; k <= 6; k++) {
        const r = 0.045 - (0.02 * (k - 1)) / 5, h = r * 0.9;
        const z0 = -T.rz[k] + 0.006;
        const hexAt = (rad, i) => {
          const a = (i / 6) * Math.PI * 2;
          return [Math.cos(a) * rad, Math.sin(a) * rad];
        };
        for (let i = 0; i < 6; i++) {
          const p0 = hexAt(r, i), p1 = hexAt(r, i + 1), q0 = hexAt(r * 0.62, i), q1 = hexAt(r * 0.62, i + 1);
          // lower band
          push(k, p0[0], p0[1], z0, 0.5, 0.5, A); push(k, q1[0], q1[1], z0 - h * 0.75, 0.5, 0.5, A); push(k, p1[0], p1[1], z0, 0.5, 0.5, A);
          push(k, p0[0], p0[1], z0, 0.5, 0.5, A); push(k, q0[0], q0[1], z0 - h * 0.75, 0.5, 0.5, A); push(k, q1[0], q1[1], z0 - h * 0.75, 0.5, 0.5, A);
          // top
          push(k, q0[0], q0[1], z0 - h * 0.75, 0.5, 0.5, A); push(k, 0, 0, z0 - h, 0.5, 0.5, A); push(k, q1[0], q1[1], z0 - h * 0.75, 0.5, 0.5, A);
        }
      }
      g1 = ring.length;
      // leafy fronds: a rounded three-lobed leaf on each side at rings 2, 4, 6
      const L = lin(pal.L), Ac = lin(pal.A);
      for (const k of [2, 4, 6]) {
        const len = 0.12 - (0.05 * (k - 2)) / 4;
        for (const s of [-1, 1]) {
          const x0 = s * (T.rx[k] - 0.01);
          const outline = [];
          const N = 12;
          for (let j = 0; j <= N; j++) {
            const a = (j / N) * Math.PI; // from the top edge around to the bottom edge
            const lobe = 1 + 0.22 * Math.cos(a * 3 - Math.PI * 0.5) ** 2;
            const rr = len * lobe * Math.sin(a) ** 0.6;
            outline.push([x0 + s * rr, Math.cos(a) * len * 0.42 + 0.01, 0]);
          }
          for (let j = 0; j < N; j++) {
            const p = outline[j], q = outline[j + 1];
            const uOf = (pp) => 0.5 + (pp[1] / (len * 0.9));
            const vOf = (pp) => Math.abs(pp[0] - x0) / len;
            push(k, x0, 0.01, 0, 0.5, 0, L);
            push(k, p[0], p[1], p[2], uOf(p), vOf(p), j % 4 === 2 ? Ac : L);
            push(k, q[0], q[1], q[2], uOf(q), vOf(q), (j + 1) % 4 === 2 ? Ac : L);
          }
        }
      }
      g2 = ring.length;
      // glow spots: a small diamond on each side at rings 1..6
      const Lg = lin(pal.L);
      for (let k = 1; k <= 6; k++) {
        const d = T.rx[k] * 2 * 0.07;
        for (const s of [-1, 1]) {
          const x = s * (se(1) * T.rx[k] + 0.004);
          const zc = T.rz[k] * 0.25;
          const pts = [[x, d, zc], [x, 0, zc + d * 0.8], [x, -d, zc], [x, 0, zc - d * 0.8]];
          const tri = s > 0 ? [0, 1, 2, 0, 2, 3] : [0, 2, 1, 0, 3, 2];
          for (const t of tri) push(k, pts[t][0], pts[t][1], pts[t][2], 0, 0, Lg);
        }
      }
    }
    const n = ring.length;
    this.count = n;
    this.ring = Uint8Array.from(ring);
    this.off = Float32Array.from(off);
    const g = new THREE.BufferGeometry();
    this.posAttr = new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3);
    this.posAttr.setUsage(THREE.DynamicDrawUsage);
    this.nrmAttr = new THREE.Float32BufferAttribute(new Float32Array(n * 3), 3);
    this.nrmAttr.setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('position', this.posAttr);
    g.setAttribute('normal', this.nrmAttr);
    g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
    g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    g.addGroup(0, g1, 0); // the tube and the dragon's bubble domes: one draw
    if (g2 > g1) g.addGroup(g1, g2 - g1, 1);
    if (n > g2) g.addGroup(g2, n - g2, 2);
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
      const a = angles ? clampA(angles[i]) : 0;
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
    for (let t = 0, n = this.count; t < n; t += 3) {
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
 * lobes with a little notch. Sea dragon: a rounded fan with five soft ribs, no pointed tips.
 */
export function flukeGeometry(form, pal) {
  const pos = [], uv = [], col = [];
  const L = lin(pal.L), A = lin(form === 'sea_dragon' ? pal.A : pal.L);
  const W = form === 'sea_dragon' ? 0.46 : 0.52, H = form === 'sea_dragon' ? 0.28 : 0.26;
  const outline = [];
  const N = 30;
  for (let j = 0; j <= N; j++) {
    const s = j / N; // 0 = left edge root, 1 = right edge root
    const x = (s - 0.5) * W;
    let y;
    if (form === 'sea_dragon') {
      // a rounded fan: deepest in the middle, soft ribs as a gentle wave
      const fan = Math.sin(s * Math.PI) ** 0.7;
      y = -H * (0.25 + 0.75 * fan) * (1 - 0.06 * Math.abs(Math.sin(s * Math.PI * 5)));
    } else {
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
  for (let j = 0; j < N; j++) {
    const p = outline[j], q = outline[j + 1];
    for (const [v, c] of [[root, L], [p, A], [q, A]]) {
      pos.push(v[0], v[1], 0);
      uv.push(0.5 + v[0] / W, -v[1] / H);
      col.push(c.r, c.g, c.b);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const nrm = new Float32Array(pos.length);
  for (let i = 2; i < nrm.length; i += 3) nrm[i] = 1;
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
    // belly band (u 0.4-0.6 is her front)
    g.fillStyle = '#E6E6E6';
    g.fillRect(w * 0.4, 0, w * 0.2, h);
    for (let r = -1; r <= rows; r++) {
      for (let c = -1; c <= cols; c++) {
        const cx = (c + (r % 2 ? 0.5 : 0)) * cw, cy = r * ch;
        const belly = cx > w * 0.4 && cx < w * 0.6;
        g.beginPath();
        g.moveTo(cx, cy - ch * 0.62);
        g.lineTo(cx + cw * 0.5, cy);
        g.lineTo(cx, cy + ch * 0.62);
        g.lineTo(cx - cw * 0.5, cy);
        g.closePath();
        const grd = g.createLinearGradient(cx, cy - ch * 0.6, cx, cy + ch * 0.6);
        grd.addColorStop(0, belly ? '#FFFFFF' : '#F4F4F4');
        grd.addColorStop(1, belly ? '#E0E0E0' : '#BDBDBD');
        g.fillStyle = grd;
        g.fill();
        g.strokeStyle = '#8E8E8E';
        g.lineWidth = 1.2;
        g.stroke();
        g.fillStyle = 'rgba(255,255,255,0.9)';
        g.fillRect(cx - 1.5, cy - ch * 0.35, 3, 3);
      }
    }
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

/** Fins: translucent, 0.85 alpha at the base (v 0) to 0.55 at the edge, 7 ribs, a white rim. */
export function paintFin(g, w, h, form) {
  g.clearRect(0, 0, w, h);
  const grd = g.createLinearGradient(0, 0, 0, h);
  grd.addColorStop(0, 'rgba(255,255,255,0.85)');
  grd.addColorStop(1, 'rgba(255,255,255,0.55)');
  g.fillStyle = grd;
  g.fillRect(0, 0, w, h);
  g.strokeStyle = form === 'sea_dragon' ? 'rgba(150,150,150,0.75)' : 'rgba(190,190,190,0.7)';
  g.lineWidth = 2;
  for (let i = 0; i < 7; i++) {
    g.beginPath();
    g.moveTo(w / 2, 0);
    g.lineTo(((i + 0.5) / 7) * w, h);
    g.stroke();
  }
  if (form === 'sea_dragon') {
    // leaf veins
    g.strokeStyle = 'rgba(140,140,140,0.5)';
    g.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      g.beginPath();
      g.moveTo(0, (i / 6) * h);
      g.lineTo(w, (i / 6) * h + 6);
      g.stroke();
    }
  }
  g.strokeStyle = 'rgba(255,255,255,0.95)';
  g.lineWidth = 3;
  g.strokeRect(1.5, 1.5, w - 3, h - 3);
}

// ---------- the whole set ----------

/**
 * Build the sea parts for one avatar. P: the avatar's BuildContext (P.B(boneOrGroup, matKey)
 * merges extras per bone and material). Returns what the avatar turns into meshes:
 *   root (Group for the hips), tip (Object3D at the tail's tip), tube (TailTube),
 *   tubeMats ([scales, fins, glow] material keys in group order), fluke geometry + key,
 *   bones (Groups the avatar adds and later removes: horn nubs, neck spikes), keys.
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
    // two soft horn nubs on top of the head (left out under any head accessory)
    if (!look.acc || look.acc.head === 'none') {
      const g = new THREE.Group();
      g.name = 'seaHorns';
      g.position.set(0, 1.74 - 1.1, -0.06);
      g.userData.origin = [0, 1.74, -0.06];
      bones.head.add(g);
      extraBones.push(g);
      const H = P.B(g, scale);
      // rooted in the hair, poking out of most hair styles (a big afro covers them)
      for (const s of [-1, 1]) H.cone(s * 0.12, 1.7, -0.06, 0.055, 0.12, pal.A, 6, 0.026);
    }
    // three bubble domes down the back of the neck and upper back
    const n = new THREE.Group();
    n.name = 'seaSpikes';
    n.position.set(0, 1.0 - 0.68, -0.12);
    n.userData.origin = [0, 1.0, -0.12];
    bones.torso.add(n);
    extraBones.push(n);
    const S = P.B(n, scale);
    [[1.06, 0.05], [0.95, 0.042], [0.84, 0.035]].forEach(([y, r]) => {
      S.save().translate(0, y, -0.118).rotate(-Math.PI / 2, 0, 0);
      S.cone(0, 0, 0, r, r * 0.95, pal.A, 6, r * 0.45);
      S.restore();
    });
  }
  return { root, tip, tube, tubeMats: [scale, fin, 'glow'], fluke, flukeMat: fin, bones: extraBones, keys: [scale, fin], palette: pal };
}
