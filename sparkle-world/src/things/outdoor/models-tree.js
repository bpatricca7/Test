// Treehouse & zip-line models: the Zip Tower (a tall wooden tower with a deck, a low picket
// railing, a ladder and a pointy pastel roof), the Tree Platform (a deck on stilts or braced
// against a tree trunk, with a rope ladder), the Rope Bridge (drawn whole by its first
// segment, swaying in the vertex shader) and the zip-line trolley + candy-striped cable.
//
// Model space as everywhere: block units, footprint [0,w] x [0,h] x [0,d], front = +Z.

import * as THREE from 'three';
import { Kit } from '../furniture/kit.js';
import { ATLAS_MAT } from '../furniture/atlas.js';
import { woodMat, stoneMat, glow, material, paintTexture } from '../furniture/paint.js';
import { C, flower } from '../furniture/palette.js';
import { shade, mixHex } from '../../core/util.js';

// ---------- shared shapes ----------

let pyramidGeo = null;
/** Square pyramid with flat faces, base centre at the origin, 1 x 1 x 1 (cached). */
function pyramid() {
  if (!pyramidGeo) {
    const g = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4, 1).toNonIndexed();
    g.rotateY(Math.PI / 4);
    g.translate(0, 0.5, 0);
    g.computeVertexNormals();
    pyramidGeo = g;
  }
  return pyramidGeo;
}

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
function placeGeo(k, geo, paint, x, y, z, sx, sy, sz) {
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  _q.identity();
  _m.compose(_p, _q, _s);
  return k.geo(geo, paint, _m.clone());
}

/** A little triangle pennant hanging from (x, y, z); alongX = it faces +/-Z. */
function pennant(k, x, y, z, color, alongX = true, size = 0.16) {
  const rows = 4;
  for (let r = 0; r < rows; r++) {
    const w = size * (1 - r / rows);
    const h = size * 0.28;
    if (alongX) k.box(w, h, 0.02, color, x - w / 2, y - (r + 1) * h, z - 0.01);
    else k.box(0.02, h, w, color, x - 0.01, y - (r + 1) * h, z - w / 2);
  }
}

/** Soft twisted rope texture (16x16, shared -> furniture atlas). */
export function ropeMat() {
  const key = 'outdoor-rope';
  return material(key, {
    map: paintTexture(key, 16, 16, (ctx) => {
      ctx.fillStyle = '#E9D3A6';
      ctx.fillRect(0, 0, 16, 16);
      ctx.fillStyle = '#D2B47E';
      for (let i = -16; i < 16; i += 4) {
        for (let y = 0; y < 16; y++) ctx.fillRect((i + y) & 15, y, 2, 1);
      }
      ctx.fillStyle = '#F6E6C4';
      for (let i = -16; i < 16; i += 4) {
        for (let y = 0; y < 16; y += 2) ctx.fillRect((i + y + 2) & 15, y, 1, 1);
      }
    }),
    uvScale: 4,
  });
}

// ---------- Zip Tower ----------

/** Heights on the tower (model units): deck top, railing top, where the cable hangs. */
export const TOWER = { DECK: 3.0, RAIL: 0.42, ANCHOR: 5.56, BEAM: 5.72, HALF: 0.9 };
const POSTS = [[0.08, 0.08], [1.7, 0.08], [0.08, 1.7], [1.7, 1.7]];

export function zipTower(color = '#FF9CCB') {
  const k = new Kit();
  const wood = woodMat('#E7BE8C');
  const woodLight = woodMat('#F3D7AE');
  const white = '#FFFFFF';
  const trim = color;
  const trimLight = mixHex(color, '#FFFFFF', 0.45);
  const D = TOWER.DECK;
  // stone feet and the four tall posts
  for (const [x, z] of POSTS) {
    k.box(0.36, 0.14, 0.36, stoneMat('#E6E0F5'), x - 0.07, 0, z - 0.07);
    k.box(0.22, TOWER.BEAM + 0.2 - 0.1, 0.22, wood, x, 0.1, z);
  }
  // X braces on the back and the sides (the ladder is on the front)
  const br = 0.07;
  const lo = 0.35, hi = D - 0.3;
  k.stick([0.3, lo, 0.14], [1.7, hi, 0.14], br, woodLight);
  k.stick([1.7, lo, 0.2], [0.3, hi, 0.2], br, woodLight);
  for (const x of [0.14, 1.86]) {
    k.stick([x, lo, 0.3], [x, hi, 1.7], br, woodLight);
    k.stick([x + (x < 1 ? 0.06 : -0.06), lo, 1.7], [x + (x < 1 ? 0.06 : -0.06), hi, 0.3], br, woodLight);
  }
  // deck: joists, boards (two tones), a pastel fascia with a heart on the front
  k.box(2.0, 0.18, 0.2, wood, 0, D - 0.36, 0.05);
  k.box(2.0, 0.18, 0.2, wood, 0, D - 0.36, 1.75);
  for (let i = 0; i < 6; i++) k.box(2.0, 0.16, 0.325, i % 2 ? wood : woodLight, 0, D - 0.16, i * (2 / 6) + 0.004);
  k.box(2.0, 0.1, 0.04, trim, 0, D - 0.2, 1.96).box(2.0, 0.1, 0.04, trim, 0, D - 0.2, 0);
  k.box(0.04, 0.1, 2.0, trim, 0, D - 0.2, 0).box(0.04, 0.1, 2.0, trim, 1.96, D - 0.2, 0);
  k.pixels(['.XX.XX.', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'], 0.035, { X: C.rose }, 0.2, D - 0.52, 1.98, { depth: 0.03 });
  // low picket railing all round, open over the ladder
  const R = TOWER.RAIL;
  const railSide = (x0, z0, x1, z1) => {
    const len = Math.hypot(x1 - x0, z1 - z0);
    const alongX = Math.abs(x1 - x0) > Math.abs(z1 - z0);
    if (alongX) k.box(len, 0.07, 0.1, trimLight, Math.min(x0, x1), D + R - 0.07, z0 - 0.05);
    else k.box(0.1, 0.07, len, trimLight, x0 - 0.05, D + R - 0.07, Math.min(z0, z1));
    const n = Math.max(1, Math.round(len / 0.2));
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = x0 + (x1 - x0) * t, z = z0 + (z1 - z0) * t;
      k.box(0.06, R - 0.1, 0.06, white, x - 0.03, D, z - 0.03);
      k.box(0.04, 0.04, 0.04, white, x - 0.02, D + R - 0.03, z - 0.02);
    }
  };
  railSide(0.19, 0.19, 1.81, 0.19);
  railSide(0.19, 0.19, 0.19, 1.81);
  railSide(1.81, 0.19, 1.81, 1.81);
  railSide(0.19, 1.81, 0.6, 1.81);
  railSide(1.4, 1.81, 1.81, 1.81);
  // flower boxes on the side rails
  for (const x of [-0.06, 1.96]) {
    k.box(0.1, 0.16, 0.9, trim, x, D + 0.12, 0.55);
    for (let i = 0; i < 4; i++) {
      const fc = [C.pink, C.butter, C.lav, C.sky][i];
      k.box(0.03, 0.12, 0.03, C.leaf, x + 0.035, D + 0.28, 0.65 + i * 0.22);
      k.ball(0.055, fc, x + 0.05, D + 0.42, 0.665 + i * 0.22);
      k.ball(0.025, C.butter, x + 0.05, D + 0.44, 0.665 + i * 0.22);
    }
  }
  // ladder up the front
  for (const x of [0.6, 1.34]) k.box(0.06, D + 0.6, 0.08, wood, x, 0, 1.9);
  for (let y = 0.3; y < D + 0.1; y += 0.3) k.box(0.68, 0.06, 0.06, trimLight, 0.66, y, 1.91);
  // ring beam under the roof: the cable hangs from its underside
  const B = TOWER.BEAM;
  k.box(2.0, 0.2, 0.22, wood, 0, B, 0.08).box(2.0, 0.2, 0.22, wood, 0, B, 1.7);
  k.box(0.22, 0.2, 2.0, wood, 0.08, B, 0).box(0.22, 0.2, 2.0, wood, 1.7, B, 0);
  // bunting under the beam
  const flags = [C.pink, C.butter, C.mint, C.sky, C.lav];
  for (let i = 0; i < 5; i++) {
    const t = 0.38 + i * 0.31;
    pennant(k, t, B, 1.95, flags[i % 5], true);
    pennant(k, t, B, 0.05, flags[(i + 2) % 5], true);
    pennant(k, 0.05, B, t, flags[(i + 1) % 5], false);
    pennant(k, 1.95, B, t, flags[(i + 3) % 5], false);
  }
  // pointy pastel roof with a white scalloped eave and a heart on top
  k.box(2.24, 0.08, 2.24, white, -0.12, B + 0.2, -0.12);
  placeGeo(k, pyramid(), trim, 1, B + 0.28, 1, 2.3, 0.78, 2.3);
  placeGeo(k, pyramid(), shade(trim, 0.3), 1, B + 0.28 + 0.5, 1, 0.8, 0.28, 0.8);
  for (let i = 0; i < 8; i++) {
    const t = -0.08 + i * 0.3 + 0.03;
    k.ball(0.07, white, t + 0.1, B + 0.2, -0.12);
    k.ball(0.07, white, t + 0.1, B + 0.2, 2.12);
    k.ball(0.07, white, -0.12, B + 0.2, t + 0.1);
    k.ball(0.07, white, 2.12, B + 0.2, t + 0.1);
  }
  k.box(0.03, 0.1, 0.03, white, 0.985, B + 1.04, 0.985);
  k.pixels(['.X.X.', 'XXXXX', '.XXX.', '..X..'], 0.035, { X: C.rose }, 0.9125, B + 1.12, 0.99, { depth: 0.03 });
  return k.build();
}

/** Colliders: lower body, deck, railing, upper posts, roof (model units). */
export function zipTowerColliders() {
  const D = TOWER.DECK, R = TOWER.RAIL, B = TOWER.BEAM;
  const out = [
    [0.08, 0, 0.08, 1.92, D - 0.18, 1.88],
    [0, D - 0.18, 0, 2, D, 2],
    [0.14, D, 0.14, 1.86, D + R, 0.24],
    [0.14, D, 0.14, 0.24, D + R, 1.86],
    [1.76, D, 0.14, 1.86, D + R, 1.86],
    [0.14, D, 1.76, 0.6, D + R, 1.86],
    [1.4, D, 1.76, 1.86, D + R, 1.86],
    [0, B, 0, 2, B + 0.5, 2],
  ];
  for (const [x, z] of POSTS) out.push([x, D, z, x + 0.22, B, z + 0.22]);
  return out;
}

// ---------- Tree Platform ----------

/** Deck top (model units) and railing height. */
export const PLATFORM = { TOP: 1.0, RAIL: 0.9 };

/**
 * data: { legs: post length under the deck (0 = braced against a tree trunk behind it),
 *         ladder: rope ladder length from the deck top down, open: bitmask of open railing
 *         cells (side * 3 + index; sides 0 front +Z, 1 right +X, 2 back -Z, 3 left -X) }
 */
export function treePlatform(color = '#FF9CCB', data = {}) {
  const k = new Kit();
  const wood = woodMat('#E7BE8C');
  const woodLight = woodMat('#F3D7AE');
  const top = PLATFORM.TOP;
  const legs = Math.max(0, +data.legs || 0);
  const ladder = Math.max(0, +data.ladder || 0);
  const open = data.open | 0;
  // joists and boards
  for (const x of [0.12, 1.4, 2.68]) k.box(0.2, 0.16, 3.0, wood, x, top - 0.38, 0);
  for (let i = 0; i < 9; i++) k.box(3.0, 0.16, 0.33, i % 2 ? wood : woodLight, 0, top - 0.16, i * (3 / 9) + 0.002);
  const fascia = color;
  k.box(3.0, 0.1, 0.04, fascia, 0, top - 0.24, 2.96).box(3.0, 0.1, 0.04, fascia, 0, top - 0.24, 0);
  k.box(0.04, 0.1, 3.0, fascia, 0, top - 0.24, 0).box(0.04, 0.1, 3.0, fascia, 2.96, top - 0.24, 0);
  // stilts with braces, or knee braces against the trunk behind the back edge
  if (legs > 0.05) {
    const y0 = top - 0.2 - legs;
    for (const [x, z] of [[0.12, 0.12], [2.66, 0.12], [0.12, 2.66], [2.66, 2.66]]) {
      k.box(0.22, legs, 0.22, wood, x, y0, z);
      k.box(0.32, 0.1, 0.32, stoneMat('#E6E0F5'), x - 0.05, y0, z - 0.05);
    }
    if (legs > 1.2) {
      const a = y0 + 0.3, b = top - 0.45;
      k.stick([0.3, a, 0.2], [2.66, b, 0.2], 0.07, woodLight);
      k.stick([0.3, b, 2.8], [2.66, a, 2.8], 0.07, woodLight);
      k.stick([0.2, a, 0.3], [0.2, b, 2.66], 0.07, woodLight);
      k.stick([2.8, b, 0.3], [2.8, a, 2.66], 0.07, woodLight);
    }
  } else {
    for (const x of [0.75, 2.25]) {
      k.stick([x, top - 0.36, 1.9], [1.5 + (x - 1.5) * 0.35, top - 1.9, 0.04], 0.1, wood);
    }
    k.box(1.0, 0.12, 0.1, wood, 1.0, top - 2.0, -0.02);
    // a rope wrapped round the trunk
    k.box(1.1, 0.06, 0.06, ropeMat(), 0.95, top - 0.5, -0.04);
  }
  // railing: a post at every cell corner, a rail over every closed cell
  const white = '#FFFFFF';
  const railTop = top + PLATFORM.RAIL;
  const corner = (x, z) => {
    k.box(0.12, PLATFORM.RAIL, 0.12, wood, x - 0.06, top, z - 0.06);
    k.ball(0.07, white, x, railTop + 0.03, z);
  };
  const sides = [
    (i) => [[i, 2.94], [i + 1, 2.94]], // front
    (i) => [[2.94, 2 - i + 1], [2.94, 2 - i]], // right (index runs front to back)
    (i) => [[2 - i + 1, 0.06], [2 - i, 0.06]], // back
    (i) => [[0.06, i], [0.06, i + 1]], // left
  ];
  const posts = new Set();
  for (let s = 0; s < 4; s++) {
    for (let i = 0; i < 3; i++) {
      const [[x0, z0], [x1, z1]] = sides[s](i);
      posts.add(`${x0},${z0}`);
      posts.add(`${x1},${z1}`);
      if (open & (1 << (s * 3 + i))) continue;
      const alongX = Math.abs(x1 - x0) > 0.5;
      if (alongX) {
        k.box(1.0, 0.08, 0.08, woodLight, Math.min(x0, x1), railTop - 0.08, z0 - 0.04);
        k.box(1.0, 0.04, 0.04, ropeMat(), Math.min(x0, x1), top + 0.42, z0 - 0.02);
        for (let p = 0.25; p < 1; p += 0.25) k.box(0.05, PLATFORM.RAIL - 0.08, 0.05, white, Math.min(x0, x1) + p - 0.025, top, z0 - 0.025);
      } else {
        k.box(0.08, 0.08, 1.0, woodLight, x0 - 0.04, railTop - 0.08, Math.min(z0, z1));
        k.box(0.04, 0.04, 1.0, ropeMat(), x0 - 0.02, top + 0.42, Math.min(z0, z1));
        for (let p = 0.25; p < 1; p += 0.25) k.box(0.05, PLATFORM.RAIL - 0.08, 0.05, white, x0 - 0.025, top, Math.min(z0, z1) + p - 0.025);
      }
    }
  }
  for (const key of posts) {
    const [x, z] = key.split(',').map(Number);
    corner(x, z);
  }
  // bunting along the back rail, a lantern on a corner post
  const flags = [C.pink, C.butter, C.mint, C.sky, C.lav];
  if (!(open & (7 << 6))) for (let i = 0; i < 8; i++) pennant(k, 0.3 + i * 0.34, railTop - 0.02, 0.1, flags[i % 5], true, 0.14);
  k.box(0.04, 0.2, 0.04, C.woodDark, 0.04, railTop + 0.05, 2.92);
  k.box(0.2, 0.05, 0.2, shade(color, -0.1), -0.04, railTop + 0.2, 2.84);
  k.box(0.14, 0.18, 0.14, glow('#FFE7A0', 0.9), -0.01, railTop + 0.02, 2.87);
  flower(k, 0.18, C.rose, 2.6, railTop + 0.04, 0.1, C.butter, 0.03);
  // rope ladder down the front, under the open middle cell
  if (ladder > 0.3) {
    const rope = ropeMat();
    const rungWood = woodMat(mixHex(color, '#E7BE8C', 0.5));
    for (const x of [1.14, 1.82]) k.box(0.05, ladder + 0.1, 0.05, rope, x, top - ladder, 3.0);
    for (let y = top - 0.28; y > top - ladder + 0.05; y -= 0.3) k.box(0.74, 0.06, 0.1, rungWood, 1.1, y, 2.98);
    k.box(0.9, 0.08, 0.14, C.woodDark, 1.05, top - 0.04, 2.9);
  }
  return k.build();
}

/** Colliders for a platform with this data (model units). */
export function treePlatformColliders(data = {}) {
  const top = PLATFORM.TOP;
  const open = data.open | 0;
  const legs = Math.max(0, +data.legs || 0);
  const out = [[0, top - 0.2, 0, 3, top, 3]];
  const R = PLATFORM.RAIL;
  for (let i = 0; i < 3; i++) {
    if (!(open & (1 << i))) out.push([i, top, 2.9, i + 1, top + R, 3]);
    if (!(open & (1 << (3 + i)))) out.push([2.9, top, 2 - i, 3, top + R, 3 - i]);
    if (!(open & (1 << (6 + i)))) out.push([2 - i, top, 0, 3 - i, top + R, 0.1]);
    if (!(open & (1 << (9 + i)))) out.push([0, top, i, 0.1, top + R, i + 1]);
  }
  if (legs > 0.05) {
    const y0 = top - 0.2 - legs;
    for (const [x, z] of [[0.12, 0.12], [2.66, 0.12], [0.12, 2.66], [2.66, 2.66]]) out.push([x, y0, z, x + 0.22, top - 0.2, z + 0.22]);
  }
  return out;
}

// ---------- Rope Bridge ----------

/** Shared uniforms of the swaying bridge material (driven by the outdoor system). */
export const SWAY = { uSwayT: { value: 0 }, uSwayA: { value: 0.05 }, uSwayB: { value: 0 } };
let swayMat = null;
/** The furniture atlas material plus a gentle sideways sway and a bounce, in the vertex shader. */
export function swayMaterial() {
  if (swayMat) return swayMat;
  const m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.name = 'outdoor|sway';
  m.userData.shared = true;
  m.onBeforeCompile = (shader) => {
    ATLAS_MAT.onBeforeCompile(shader);
    shader.uniforms.uSwayT = SWAY.uSwayT;
    shader.uniforms.uSwayA = SWAY.uSwayA;
    shader.uniforms.uSwayB = SWAY.uSwayB;
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', '#include <common>\nattribute vec2 aSway;\nuniform float uSwayT;\nuniform float uSwayA;\nuniform float uSwayB;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\n\ttransformed.x += aSway.x * uSwayA * sin( uSwayT * 1.7 + aSway.y );\n\ttransformed.y -= aSway.x * uSwayB * ( 0.65 + 0.35 * sin( uSwayT * 8.0 + aSway.y ) );');
  };
  m.customProgramCacheKey = () => 'sw-outdoor-sway';
  swayMat = m;
  return m;
}

export const BRIDGE_COLORS = ['#E7BE8C', '#FFC4DD', '#D8C8FF', '#BFEFDC', '#BFE2FF', '#FFE38F'];

/** Sag of a bridge n cells long, and its deck height at s (0..n) in segment-local y. */
export function bridgeSag(n) {
  return Math.min(0.4, 0.06 + 0.045 * n);
}
export function bridgeDeckY(s, n) {
  const u = Math.max(0, Math.min(1, s / Math.max(1, n)));
  return PLATFORM.TOP - bridgeSag(n) * 4 * u * (1 - u);
}

/**
 * Rope bridge segment i of n. Segment 0 draws the WHOLE bridge (one swaying mesh along +Z,
 * z from 0 to n) plus the end posts; the other segments only hold cells and colliders.
 */
export function ropeBridge(color = BRIDGE_COLORS[0], data = {}) {
  const k = new Kit();
  const i = data.i | 0;
  const n = Math.max(1, data.n | 0 || 1);
  if (i !== 0) return k.build();
  const plank = woodMat(color);
  const plankAlt = woodMat(mixHex(color, '#FFFFFF', 0.25));
  const rope = ropeMat();
  const deck = (s) => bridgeDeckY(s, n);
  const railSag = bridgeSag(n) * 0.55;
  const rail = (s) => {
    const u = s / n;
    return PLATFORM.TOP + 1.02 - railSag * 4 * u * (1 - u);
  };
  const p = k.part('sway', 0, 0, 0);
  // planks: three per cell, each tilted along the sag
  for (let c = 0; c < n; c++) {
    for (let j = 0; j < 3; j++) {
      const s = c + (j + 0.5) / 3;
      const y = deck(s);
      const slope = (deck(s + 0.05) - deck(s - 0.05)) / 0.1;
      const a = -Math.atan(slope);
      p.box(0.84, 0.06, 0.26, (c + j) % 2 ? plank : plankAlt, 0.08, y - 0.06, s - 0.13, { rot: [a, 0, 0], pivot: [0.5, y - 0.03, s] });
    }
  }
  // stringers under the plank ends, handrail ropes, hangers and a zig-zag net
  const step = 0.5;
  for (let s = 0; s < n - 1e-6; s += step) {
    const s1 = Math.min(n, s + step);
    for (const x of [0.14, 0.86]) p.stick([x, deck(s) - 0.07, s], [x, deck(s1) - 0.07, s1], 0.045, rope);
    for (const x of [0.06, 0.94]) {
      p.stick([x, rail(s), s], [x, rail(s1), s1], 0.055, rope);
      const sm = (s + s1) / 2;
      p.stick([x, rail(s), s], [x + (x < 0.5 ? 0.05 : -0.05), deck(sm) - 0.02, sm], 0.025, rope);
      p.stick([x + (x < 0.5 ? 0.05 : -0.05), deck(sm) - 0.02, sm], [x, rail(s1), s1], 0.025, rope);
    }
  }
  for (let c = 0; c <= n; c++) {
    for (const x of [0.06, 0.94]) p.stick([x, deck(c) - 0.04, c], [x, rail(c), c], 0.04, rope);
  }
  // little flags and hearts tied to the rails
  const flags = [C.pink, C.butter, C.mint, C.sky, C.lav];
  for (let c = 0; c < n; c++) {
    const s = c + 0.5;
    p.box(0.02, 0.12, 0.1, flags[c % 5], 0.02, rail(s) - 0.13, s - 0.05);
    p.box(0.02, 0.12, 0.1, flags[(c + 2) % 5], 0.96, rail(s) - 0.13, s - 0.05);
  }
  // sturdy end posts (static)
  const wood = woodMat('#E7BE8C');
  for (const s of [0, n]) {
    for (const x of [0.0, 0.84]) {
      k.box(0.16, 1.75, 0.16, wood, x, 0.5, s - 0.08);
      k.ball(0.1, shade(color, -0.05), x + 0.08, 2.3, s);
    }
  }
  const model = k.build();
  // the swaying part: swap its atlas meshes for the sway material, with a per-vertex
  // sway amount (0 at the posts, most in the middle) and a phase that travels along it
  const part = model.userData.parts.sway;
  if (part) {
    for (const mesh of part.children) {
      if (!mesh.isMesh || mesh.material !== ATLAS_MAT) continue;
      const pos = mesh.geometry.attributes.position;
      const arr = new Float32Array(pos.count * 2);
      for (let v = 0; v < pos.count; v++) {
        const s = pos.getZ(v);
        const bell = Math.sin(Math.PI * Math.max(0, Math.min(1, s / n)));
        const lift = Math.max(0, pos.getY(v) - deck(s));
        arr[v * 2] = bell * (0.8 + lift * 0.35);
        arr[v * 2 + 1] = s * 0.45;
      }
      mesh.geometry.setAttribute('aSway', new THREE.BufferAttribute(arr, 2));
      mesh.geometry.boundingSphere.radius += 0.4;
      mesh.material = swayMaterial();
    }
  }
  return model;
}

/** Colliders of segment i of n: the deck and two side guards (model units). */
export function ropeBridgeColliders(data = {}) {
  const i = data.i | 0;
  const n = Math.max(1, data.n | 0 || 1);
  const top = bridgeDeckY(i + 0.5, n);
  return [
    [0.06, top - 0.12, 0, 0.94, top, 1],
    [0, top, 0, 0.07, top + 0.95, 1],
    [0.93, top, 0, 1, top + 0.95, 1],
  ];
}

// ---------- zip-line trolley & cable ----------

/**
 * The trolley: a little pastel pulley car riding on the cable (wheels on top), and part
 * 'handle': two straps that splay out to a padded grip for each hand, beside her head (her
 * raised hands only reach the middle of her big chibi head, so no bar across it).
 */
export const HANDLE = { TOP: 0.18, STRAP: 0.56, SPREAD: 0.375 };
export const HANDLE_DROP = HANDLE.TOP + HANDLE.STRAP; // cable to the grips
export function trolley(color = '#FF9CCB') {
  const k = new Kit();
  const body = shade(color, -0.04);
  const light = mixHex(color, '#FFFFFF', 0.55);
  k.box(0.46, 0.15, 0.36, body, -0.23, -HANDLE.TOP, -0.18);
  k.box(0.5, 0.04, 0.4, light, -0.25, -HANDLE.TOP - 0.02, -0.2);
  k.box(0.12, 0.05, 0.34, light, -0.06, -0.05, -0.17);
  for (const z of [-0.1, 0.1]) {
    k.cyl(0.07, 0.05, '#8A86A0', 0.025, 0.0, z, 14, { rot: [0, 0, Math.PI / 2] });
    k.cyl(0.025, 0.07, '#FFFFFF', 0.035, 0.0, z, 8, { rot: [0, 0, Math.PI / 2] });
  }
  k.box(0.1, 0.04, 0.4, light, -0.05, 0.08, -0.2);
  k.pixels(['.X.X.', 'XXXXX', '.XXX.', '..X..'], 0.03, { X: '#FFFFFF' }, -0.075, -0.17, 0.181, { depth: 0.01 });
  k.pixels(['.X.X.', 'XXXXX', '.XXX.', '..X..'], 0.03, { X: '#FFFFFF' }, -0.075, -0.17, -0.191, { depth: 0.01 });
  const h = k.part('handle', 0, -HANDLE.TOP, 0);
  const L = HANDLE.STRAP;
  for (const sx of [-1, 1]) {
    h.stick([sx * 0.17, 0, 0], [sx * HANDLE.SPREAD, -L + 0.06, 0], 0.03, '#FFFFFF');
    h.cyl(0.052, 0.22, color, sx * HANDLE.SPREAD, -L, -0.11, 12, { rot: [Math.PI / 2, 0, 0] });
    h.cyl(0.058, 0.03, '#FFFFFF', sx * HANDLE.SPREAD, -L, -0.125, 12, { rot: [Math.PI / 2, 0, 0] });
    h.cyl(0.058, 0.03, '#FFFFFF', sx * HANDLE.SPREAD, -L, 0.095, 12, { rot: [Math.PI / 2, 0, 0] });
  }
  return k.build();
}

let cableMat = null;
/** Candy-striped cable material (shared). */
export function cableMaterial() {
  if (cableMat) return cableMat;
  const tex = paintTexture('outdoor-cable', 16, 16, (ctx) => {
    ctx.fillStyle = '#FFFFFF';
    ctx.fillRect(0, 0, 16, 16);
    ctx.fillStyle = '#FF8CC6';
    for (let x = 0; x < 16; x++) for (let y = 0; y < 16; y++) if (((x + y) & 15) < 7) ctx.fillRect(x, y, 1, 1);
  });
  cableMat = new THREE.MeshLambertMaterial({ map: tex, color: '#FFFFFF' });
  cableMat.name = 'outdoor|cable';
  cableMat.userData.shared = true;
  return cableMat;
}

/** Tube along points (Vector3[]), stripes every ~0.3 blocks. */
export function cableMesh(points, length) {
  const curve = new THREE.CatmullRomCurve3(points, false, 'centripetal');
  const geo = new THREE.TubeGeometry(curve, Math.max(8, points.length * 2), 0.04, 6, false);
  const uv = geo.attributes.uv;
  const rep = Math.max(1, length / 0.3);
  for (let i = 0; i < uv.count; i++) uv.setX(i, uv.getX(i) * rep);
  const mesh = new THREE.Mesh(geo, cableMaterial());
  mesh.name = 'zip-cable';
  return mesh;
}

/** Rows of a pixel font for little signs. */
export const LETTERS = {
  Z: ['XXX', '..X', '.X.', 'X..', 'XXX'],
  I: ['X', 'X', 'X', 'X', 'X'],
  P: ['XX.', 'X.X', 'XX.', 'X..', 'X..'],
};
