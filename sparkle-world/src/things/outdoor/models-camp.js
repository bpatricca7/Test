// Camping models: pastel dome tent, camp fire (flickering flames), folding camp chair,
// hammock on a stand, string lights, picnic table with a gingham cloth, cooler, the narrow
// camper bunk, and the little juice box that pops out of the cooler.
//
// Model space: block units, footprint [0,w] x [0,h] x [0,d], front = +Z.

import * as THREE from 'three';
import { Kit } from '../furniture/kit.js';
import { woodMat, quiltMat, stripeMat, fabricMat, glow, sheer, material, paintTexture } from '../furniture/paint.js';
import { C, heart, pillow, STAR_ROWS, HEART_ROWS } from '../furniture/palette.js';
import { shade, mixHex } from '../../core/util.js';
import { haloPoints } from './glow.js';
import { ropeMat, bloom } from './models-tree.js';

export const TENT_COLORS = ['#FF9CCB', '#C8B4FF', '#9BE8CF', '#A6D8FF', '#FFE38F', '#FFBFA0'];
export const CAMP_FABRIC = ['#FF9CCB', '#A6D8FF', '#9BE8CF', '#C8B4FF', '#FFE38F', '#FFBFA0'];
export const CLOTH_COLORS = ['#FF9CCB', '#A6D8FF', '#9BE8CF', '#C8B4FF', '#FFE38F', '#FF8C94'];
export const BULB_COLORS = ['#FF9CCB', '#FFE38F', '#9BE8CF', '#A6D8FF', '#C8B4FF', '#FFBFA0'];

const _m = new THREE.Matrix4();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();
const _p = new THREE.Vector3();
function place(k, geo, paint, x, y, z, sx, sy, sz, rx = 0, ry = 0, rz = 0) {
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  _q.setFromEuler(_e.set(rx, ry, rz));
  _m.compose(_p, _q, _s);
  return k.geo(geo, paint, _m);
}

const geoCache = new Map();
function cached(key, make) {
  let g = geoCache.get(key);
  if (!g) {
    g = make();
    geoCache.set(key, g);
  }
  return g;
}

/** Soft canvas weave for tents (16x16, shared -> furniture atlas). */
function tentMat(color) {
  const key = `outdoor-tent|${color}`;
  return material(key, {
    map: paintTexture(key, 16, 16, (ctx) => {
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 16, 16);
      ctx.fillStyle = shade(color, 0.12);
      for (let y = 0; y < 16; y += 2) ctx.fillRect(0, y, 16, 1);
      ctx.fillStyle = shade(color, -0.06);
      for (let x = 0; x < 16; x += 8) ctx.fillRect(x, 0, 1, 16);
    }),
    uvScale: 6,
    side: THREE.DoubleSide,
  });
}

/** Pastel gingham (picnic cloth). */
function ginghamMat(color) {
  const key = `outdoor-gingham|${color}`;
  return material(key, {
    map: paintTexture(key, 16, 16, (ctx) => {
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, 16, 16);
      ctx.fillStyle = mixHex(color, '#FFFFFF', 0.45);
      for (let i = 0; i < 16; i += 8) {
        ctx.fillRect(i, 0, 4, 16);
        ctx.fillRect(0, i, 16, 4);
      }
      ctx.fillStyle = color;
      for (let x = 0; x < 16; x += 8) for (let y = 0; y < 16; y += 8) ctx.fillRect(x, y, 4, 4);
    }),
    uvScale: 3,
  });
}

/** Rainbow stripes for the hammock (whole image across the net). */
function rainbowMat() {
  const key = 'outdoor-rainbow';
  return material(key, {
    map: paintTexture(key, 16, 16, (ctx) => {
      const cols = ['#FF9CCB', '#FFBFA0', '#FFE38F', '#9BE8CF', '#A6D8FF', '#C8B4FF', '#FF9CCB', '#FFFFFF'];
      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = cols[i];
        ctx.fillRect(i * 2, 0, 2, 16);
      }
      ctx.fillStyle = 'rgba(255,255,255,0.35)';
      for (let y = 0; y < 16; y += 3) ctx.fillRect(0, y, 16, 1);
    }),
    uvScale: 1,
    side: THREE.DoubleSide,
  });
}

// ---------- tent ----------

export const TENT_SLEEP = [1.0, 0.1, 1.05];

export function tent(color = TENT_COLORS[0]) {
  const k = new Kit();
  const light = mixHex(color, '#FFFFFF', 0.55);
  const inner = mixHex(shade(color, -0.25), '#6E5A9E', 0.2);
  const GAP = 0.5;
  const dome = cached('tent-dome', () => new THREE.SphereGeometry(1, 22, 10, Math.PI / 2 + GAP, Math.PI * 2 - GAP * 2, 0, Math.PI / 2));
  const cap = cached('tent-cap', () => new THREE.SphereGeometry(1, 22, 4, 0, Math.PI * 2, 0, Math.PI / 5));
  const R = 0.95, H = 1.32;
  // floor, lining, outer shell and a light rain-fly cap
  k.cyl(R, 0.03, mixHex(color, '#FFFFFF', 0.3), 1, 0, 1, 22);
  place(k, dome, material(`outdoor-tent-in|${inner}`, { color: inner, side: THREE.DoubleSide }), 1, 0.02, 1, R * 0.95, H * 0.95, R * 0.95);
  place(k, dome, tentMat(color), 1, 0.02, 1, R, H, R);
  place(k, cap, tentMat(light), 1, 0.02, 1, R * 1.02, H * 1.02, R * 1.02);
  // poles crossing over the top
  const arc = cached('tent-arc', () => new THREE.TorusGeometry(1, 0.026, 5, 24, Math.PI));
  for (const a of [Math.PI / 4, -Math.PI / 4]) place(k, arc, '#FFFFFF', 1, 0.02, 1, R * 1.03, H * 1.03, R * 1.03, 0, a, 0);
  // rolled-up door flaps along both sides of the doorway, tied with little bows
  for (const side of [-1, 1]) {
    const phi = Math.PI / 2 + side * GAP;
    const pt = (th) => [1 - R * 1.02 * Math.cos(phi) * Math.sin(th), 0.02 + H * 1.02 * Math.cos(th), 1 + R * 1.02 * Math.sin(phi) * Math.sin(th)];
    let prev = pt(Math.PI / 2 - 0.02);
    for (let i = 1; i <= 8; i++) {
      const cur = pt((Math.PI / 2) * (1 - i / 9));
      k.stick(prev, cur, 0.12, light);
      prev = cur;
    }
    for (const th of [1.05, 0.5]) {
      const [x, y, z] = pt(th);
      k.box(0.14, 0.05, 0.14, C.rose, x - 0.07, y - 0.025, z - 0.07);
      k.ball(0.04, C.rose, x + side * 0.08, y, z + 0.03);
    }
  }
  // guy ropes and stakes
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const ax = 1 + dx * 0.48, az = 1 + dz * 0.48;
    const bx = 1 + dx * 0.86, bz = 1 + dz * 0.86;
    k.stick([ax, 0.9, az], [bx, 0.05, bz], 0.015, '#FFF1D6');
    k.box(0.04, 0.1, 0.04, '#B98A5E', bx - 0.02, 0, bz - 0.02);
  }
  // a little flag on top and a heart patch
  k.box(0.025, 0.34, 0.025, '#FFFFFF', 0.99, H, 0.99);
  k.pixels(['XXX.', 'XXXX', 'XXX.'], 0.05, { X: C.rose }, 1.01, H + 0.18, 0.99, { depth: 0.02 });
  heart(k, 0.22, light, 1.62, 0.55, 0.62, 0.02);
  // sleeping bag, pillow and a teddy inside (seen through the doorway)
  k.box(0.72, 0.08, 1.35, shade(color, -0.08), 0.64, 0.03, 0.42);
  k.box(0.66, 0.02, 0.2, mixHex(color, '#FFFFFF', 0.4), 0.67, 0.11, 1.52);
  pillow(k, 0.5, 0.12, 0.26, '#FFFFFF', 0.75, 0.1, 0.26);
  k.ball(0.07, '#E7BE8C', 1.52, 0.1, 0.5).ball(0.05, '#E7BE8C', 1.52, 0.21, 0.5);
  // a tiny glowing lantern hanging under the apex
  k.box(0.01, 0.2, 0.01, '#FFFFFF', 1.0, H - 0.34, 0.8);
  k.ball(0.06, glow('#FFE7A0', 1), 1.0, H - 0.4, 0.8, { sy: 1.3 });
  // the quilt that tucks her in (part 'cover', shown while she sleeps)
  const cv = k.part('cover', 0, 0, 0, { visible: false });
  cv.box(0.76, 0.16, 1.0, quiltMat(color, 'stars'), 0.62, 0.1, 0.85);
  cv.box(0.7, 0.05, 0.94, shade(color, 0.2), 0.65, 0.26, 0.88);
  return k.build();
}

// ---------- camp fire ----------

export function campfire(color = '#E6E0F5') {
  const k = new Kit();
  // ash bed, a ring of pastel stones
  k.cyl(0.3, 0.02, '#6E6278', 0.5, 0, 0.5, 16);
  const n = 10;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2 + 0.2;
    const c = shade(mixHex(color, i % 3 === 0 ? '#FFE3F0' : i % 3 === 1 ? '#DDF3FF' : '#FFFFFF', 0.25), (i % 2 ? -0.06 : 0.04));
    k.ball(0.095, c, 0.5 + Math.cos(a) * 0.36, 0.06, 0.5 + Math.sin(a) * 0.36, { sy: 0.65, seg: 9 });
  }
  // logs in a little tent shape, with light cut ends
  const bark = woodMat('#9C6B4A');
  for (let i = 0; i < 4; i++) {
    const a = (i / 4) * Math.PI * 2 + 0.4;
    const bx = 0.5 + Math.cos(a) * 0.24, bz = 0.5 + Math.sin(a) * 0.24;
    k.stick([bx, 0.02, bz], [0.5 + Math.cos(a) * 0.04, 0.3, 0.5 + Math.sin(a) * 0.04], 0.07, bark);
    k.box(0.074, 0.02, 0.074, '#F3D7AE', bx - 0.037, 0.0, bz - 0.037);
  }
  k.stick([0.22, 0.05, 0.38], [0.78, 0.05, 0.62], 0.08, bark);
  // glowing embers
  for (const [x, z] of [[0.42, 0.45], [0.57, 0.52], [0.49, 0.6], [0.58, 0.4]]) k.box(0.07, 0.05, 0.07, glow('#FF8A3C', 0.9), x - 0.035, 0.02, z - 0.035);
  // flames (part 'flames' flickers; tongues move on their own)
  const f = k.part('flames', 0.5, 0.04, 0.5);
  f.ball(0.15, glow('#FF8A3C', 1), 0, 0.08, 0, { sy: 0.6, seg: 10 });
  f.cone(0.16, 0.0, 0.52, glow('#FF9A3C', 1), 0, 0.02, 0, 9);
  f.cone(0.11, 0.0, 0.4, glow('#FFD35C', 1), 0.01, 0.03, 0.03, 8);
  f.cone(0.06, 0.0, 0.25, glow('#FFF6C8', 1), 0.01, 0.04, 0.05, 7);
  const t1 = f.part('tongueA', 0.1, 0.04, 0.02);
  t1.cone(0.07, 0.0, 0.3, glow('#FFB14A', 1), 0, 0, 0, 7);
  const t2 = f.part('tongueB', -0.1, 0.04, -0.03);
  t2.cone(0.065, 0.0, 0.27, glow('#FFC45C', 1), 0, 0, 0, 7);
  const t3 = f.part('tongueC', 0.0, 0.04, -0.1);
  t3.cone(0.06, 0.0, 0.24, glow('#FFB14A', 1), 0, 0, 0, 7);
  // a marshmallow stick leaning on the stones
  k.stick([0.95, 0.02, 0.8], [0.62, 0.42, 0.62], 0.025, '#C99A6B');
  k.ball(0.045, '#FFFFFF', 0.6, 0.44, 0.61, { sy: 1.2 });
  k.add(haloPoints([[0.5, 0.35, 0.5, '#FFB25C']], 2.4));
  return k.build();
}

// ---------- folding camp chair ----------

export function campChair(color = CAMP_FABRIC[0]) {
  const k = new Kit();
  const metal = '#E8EEF6';
  const fabric = stripeMat(color, mixHex(color, '#FFFFFF', 0.6));
  for (const x of [0.16, 0.84]) {
    k.stick([x, 0, 0.22], [x, 0.4, 0.8], 0.035, metal);
    k.stick([x, 0, 0.8], [x, 0.4, 0.22], 0.035, metal);
    k.stick([x, 0.4, 0.2], [x, 1.02, 0.12], 0.035, metal);
    k.box(0.08, 0.04, 0.6, color, x - 0.04, 0.62, 0.2);
    k.stick([x, 0.4, 0.8], [x, 0.62, 0.78], 0.03, metal);
  }
  // sagging sling seat and back
  k.box(0.64, 0.04, 0.6, fabric, 0.18, 0.4, 0.2);
  k.box(0.5, 0.03, 0.34, fabric, 0.25, 0.36, 0.33);
  k.box(0.66, 0.6, 0.04, fabric, 0.17, 0.42, 0.14, { rot: [-0.12, 0, 0], pivot: [0.5, 0.42, 0.16] });
  k.box(0.2, 0.2, 0.03, mixHex(color, '#FFFFFF', 0.5), 0.4, 0.62, 0.19, { rot: [-0.12, 0, 0], pivot: [0.5, 0.42, 0.16] });
  heart(k, 0.12, C.rose, 0.44, 0.66, 0.215, 0.02);
  // cup holder with a tiny juice box
  k.torus(0.05, 0.012, '#FFFFFF', 0.95, 0.63, 0.64);
  k.box(0.06, 0.1, 0.05, '#9BE8CF', 0.92, 0.6, 0.615);
  k.box(0.008, 0.06, 0.008, '#FFFFFF', 0.94, 0.7, 0.63);
  return k.build();
}

// ---------- hammock ----------

export const HAMMOCK = { PIVOT: [1.5, 1.35, 0.5], BED_Y: 0.64 };

export function hammock(color = CAMP_FABRIC[0]) {
  const k = new Kit();
  const wood = woodMat('#E7BE8C');
  // stand: a ground beam and two posts with little feet
  k.box(2.8, 0.08, 0.1, wood, 0.1, 0, 0.45);
  for (const x of [0.06, 2.8]) {
    k.box(0.14, 1.45, 0.14, wood, x, 0, 0.43);
    k.box(0.16, 0.08, 0.5, wood, x - 0.01, 0, 0.25);
    k.ball(0.08, color, x + 0.07, 1.5, 0.5);
  }
  const [px, py, pz] = HAMMOCK.PIVOT;
  const b = k.part('bed', px, py, pz);
  const rope = ropeMat();
  const drop = py - HAMMOCK.BED_Y;
  const end = 1.2, spread = 0.34, sag = 0.34;
  const netY = -drop + sag - 0.02; // the net's ends (spreader bars), part space
  for (const sx of [-1, 1]) {
    const hx = sx * 1.37;
    for (const dz of [-spread, 0, spread]) b.stick([hx, 0, 0], [sx * end, netY + 0.03, dz], 0.018, rope);
    b.box(0.06, 0.06, spread * 2 + 0.1, wood, sx * end - 0.03, netY, -spread - 0.05);
  }
  // the net: a sagging, curled surface with rainbow stripes (flat where she lies)
  const net = cached('hammock-net', () => {
    const g = new THREE.PlaneGeometry(1, 1, 22, 6);
    g.rotateX(-Math.PI / 2);
    const P = g.attributes.position;
    for (let i = 0; i < P.count; i++) {
      const x = P.getX(i) * 2 * end, z = P.getZ(i) * 2 * spread;
      const u = Math.abs(x / end), w = z / spread;
      P.setXYZ(i, x, -sag * (1 - u * u * u) + 0.12 * w * w, z);
    }
    g.computeVertexNormals();
    return g;
  });
  place(b, net, rainbowMat(), 0, netY + 0.02, 0, 1, 1, 1);
  pillow(b, 0.26, 0.1, 0.44, '#FFFFFF', -1.12, netY - 0.1, -0.22);
  bloom(b, -0.9, netY + 0.02, 0.2, C.rose, 0.05, 0);
  return k.build();
}

// ---------- string lights ----------

export function stringLights(color = '#FFFFFF', data = {}) {
  const on = data.on !== false;
  const k = new Kit();
  const post = color;
  for (const x of [0.12, 2.88]) {
    k.box(0.28, 0.08, 0.28, shade(post, -0.08), x - 0.14, 0, 0.36);
    k.cyl(0.045, 1.86, post, x, 0.08, 0.5, 8);
    k.pixels(STAR_ROWS, 0.03, { X: on ? glow('#FFF4B8', 0.7) : '#FFF4B8' }, x - 0.105, 1.9, 0.49, { depth: 0.02 });
  }
  const wireY = (t) => 1.84 - Math.sin(t * Math.PI) * 0.38;
  const N = 20;
  for (let i = 0; i < N; i++) {
    const t0 = i / N, t1 = (i + 1) / N;
    k.stick([0.12 + t0 * 2.76, wireY(t0), 0.5], [0.12 + t1 * 2.76, wireY(t1), 0.5], 0.018, '#6A8F6A');
  }
  const A = k.part('twinkleA', 0, 0, 0);
  const B = k.part('twinkleB', 0, 0, 0);
  const halos = [];
  const bulbs = 9;
  for (let i = 0; i < bulbs; i++) {
    const t = (i + 0.5) / bulbs;
    const x = 0.12 + t * 2.76, y = wireY(t) - 0.09;
    const c = BULB_COLORS[i % BULB_COLORS.length];
    k.box(0.04, 0.05, 0.04, '#6A8F6A', x - 0.02, y + 0.04, 0.48);
    k.ball(0.055, on ? glow(c, 0.95) : c, x, y, 0.5, { sy: 1.3, seg: 10 });
    if (on) {
      (i % 2 ? A : B).ball(0.1, sheer(c, 0.32), x, y, 0.5, { seg: 10 });
      halos.push([x, y, 0.5, c]);
    }
  }
  if (on) k.add(haloPoints(halos, 0.8));
  return k.build();
}

// ---------- picnic table ----------

export function picnicTable(color = CLOTH_COLORS[0]) {
  const k = new Kit();
  const wood = woodMat('#E7BE8C');
  const woodLight = woodMat('#F3D7AE');
  // benches with their cross beams
  for (const z of [0.05, 1.65]) for (let i = 0; i < 2; i++) k.box(1.8, 0.05, 0.14, i ? wood : woodLight, 0.1, 0.42, z + i * 0.16);
  for (const x of [0.22, 1.7]) {
    k.box(0.08, 0.06, 1.9, wood, x, 0.36, 0.05);
    // A-frame legs
    k.stick([x + 0.04, 0, 0.35], [x + 0.04, 0.74, 0.85], 0.07, wood);
    k.stick([x + 0.04, 0, 1.65], [x + 0.04, 0.74, 1.15], 0.07, wood);
  }
  // table top with a gingham cloth that drapes over the sides
  for (let i = 0; i < 4; i++) k.box(1.9, 0.05, 0.28, i % 2 ? wood : woodLight, 0.05, 0.74, 0.42 + i * 0.29);
  const cloth = ginghamMat(color);
  k.box(1.7, 0.02, 1.24, cloth, 0.15, 0.79, 0.38);
  k.box(1.7, 0.14, 0.02, cloth, 0.15, 0.67, 0.36).box(1.7, 0.14, 0.02, cloth, 0.15, 0.67, 1.62);
  // a jar with daisies in the middle
  k.cyl(0.07, 0.14, sheer('#DDF3FF', 0.7), 1.0, 0.81, 1.0, 10);
  for (const [dx, dz, c] of [[0, 0, '#FFFFFF'], [0.06, 0.03, '#FFE38F'], [-0.05, 0.04, '#FF9CCB']]) {
    k.box(0.015, 0.14, 0.015, C.leaf, 1.0 + dx * 0.5, 0.93, 1.0 + dz * 0.5);
    k.ball(0.045, c, 1.0 + dx, 1.08, 1.0 + dz, { sy: 0.5 });
    k.ball(0.02, '#FFD35C', 1.0 + dx, 1.1, 1.0 + dz);
  }
  return k.build();
}

// ---------- cooler ----------

export function cooler(color = CAMP_FABRIC[1]) {
  const k = new Kit();
  const white = '#FFFFFF';
  // body
  k.box(0.76, 0.4, 0.52, color, 0.12, 0.06, 0.24);
  k.box(0.8, 0.06, 0.56, shade(color, -0.12), 0.1, 0.02, 0.22);
  for (const [x, z] of [[0.14, 0.26], [0.8, 0.26], [0.14, 0.7], [0.8, 0.7]]) k.box(0.06, 0.04, 0.06, '#8A86A0', x, 0, z);
  k.box(0.68, 0.08, 0.02, mixHex(color, '#FFFFFF', 0.5), 0.16, 0.12, 0.76);
  heart(k, 0.16, C.rose, 0.42, 0.24, 0.76, 0.02);
  for (const x of [0.06, 0.9]) k.box(0.04, 0.06, 0.18, white, x, 0.3, 0.41);
  // inside: ice and juice boxes (seen when the lid opens)
  k.box(0.68, 0.02, 0.44, '#DDF3FF', 0.16, 0.4, 0.28);
  for (const [x, z, c] of [[0.24, 0.36, '#9BE8CF'], [0.42, 0.5, '#C8B4FF'], [0.62, 0.38, '#FF9CCB'], [0.72, 0.56, '#FFE38F']]) {
    k.box(0.1, 0.1, 0.07, c, x, 0.36, z);
    k.box(0.01, 0.06, 0.01, white, x + 0.03, 0.46, z + 0.03);
  }
  for (const [x, z] of [[0.3, 0.62], [0.52, 0.34], [0.58, 0.62]]) k.box(0.07, 0.06, 0.07, sheer('#E8F8FF', 0.8), x, 0.4, z);
  // lid (part 'lid', hinged at the back top edge)
  const lid = k.part('lid', 0.5, 0.46, 0.24);
  lid.box(0.8, 0.09, 0.56, white, -0.4, 0, -0.02);
  lid.box(0.7, 0.03, 0.46, mixHex(color, '#FFFFFF', 0.7), -0.35, 0.09, 0.03);
  lid.box(0.04, 0.08, 0.04, color, -0.2, 0.09, 0.24).box(0.04, 0.08, 0.04, color, 0.16, 0.09, 0.24);
  lid.box(0.4, 0.04, 0.05, color, -0.2, 0.16, 0.235);
  lid.box(0.08, 0.05, 0.02, '#FFE38F', -0.04, -0.05, 0.54);
  return k.build();
}

/** The juice box that pops out of the cooler (flavor color). */
export function juiceBox(color = '#9BE8CF') {
  const k = new Kit();
  k.box(0.16, 0.24, 0.1, color, -0.08, -0.12, -0.05);
  k.box(0.12, 0.12, 0.012, '#FFFFFF', -0.06, -0.08, 0.05);
  heart(k, 0.07, C.rose, -0.035, -0.06, 0.062, 0.01);
  k.box(0.012, 0.12, 0.012, '#FFFFFF', 0.03, 0.12, -0.006);
  k.box(0.05, 0.012, 0.012, '#FF9CCB', 0.03, 0.235, -0.006);
  return k.build();
}

// ---------- camper bunk ----------

export const BUNK_SPOTS = [[0.5, 0.38, 1.0], [0.5, 1.3, 1.0]];

export function camperBunk(color = '#FF9CCB') {
  const k = new Kit();
  const frame = '#FFFFFF';
  const trim = mixHex(color, '#FFFFFF', 0.4);
  for (const [x, z] of [[0.04, 0.04], [0.86, 0.04], [0.04, 1.86], [0.86, 1.86]]) k.box(0.1, 1.9, 0.1, frame, x, 0, z);
  for (const [y0, pat] of [[0.18, 'hearts'], [1.1, 'stars']]) {
    k.box(0.92, 0.1, 1.92, woodMat('#F3D7AE'), 0.04, y0, 0.04);
    k.box(0.84, 0.1, 1.84, quiltMat(color, pat), 0.08, y0 + 0.1, 0.08);
    pillow(k, 0.6, 0.12, 0.3, '#FFFFFF', 0.2, y0 + 0.2, 0.12);
    k.box(0.84, 0.03, 0.5, trim, 0.08, y0 + 0.2, 1.4);
  }
  // guard rail, ladder at the foot end, reading lights, sheer curtains tied back
  k.box(0.06, 0.08, 1.2, frame, 0.9, 1.5, 0.35);
  k.box(0.06, 0.08, 1.2, frame, 0.04, 1.5, 0.35);
  for (let y = 0.35; y < 1.2; y += 0.28) k.box(0.3, 0.05, 0.05, trim, 0.62, y, 1.92);
  k.box(0.04, 1.3, 0.04, frame, 0.6, 0, 1.92).box(0.04, 1.3, 0.04, frame, 0.9, 0, 1.92);
  for (const y of [0.72, 1.62]) {
    k.box(0.14, 0.08, 0.05, color, 0.43, y, 0.06);
    k.ball(0.035, glow('#FFF3C4', 1), 0.5, y - 0.02, 0.12);
  }
  k.box(0.02, 0.02, 1.9, frame, 0.97, 1.02, 0.05);
  for (const z of [0.1, 1.72]) {
    k.box(0.03, 0.66, 0.16, sheer(trim, 0.55), 0.955, 0.36, z);
    k.box(0.04, 0.04, 0.18, C.rose, 0.95, 0.62, z - 0.01);
  }
  k.pixels(HEART_ROWS, 0.03, { X: C.rose }, 0.39, 1.72, 1.96, { depth: 0.02 });
  // quilts that tuck her in (parts 'cover' lower bunk, 'cover2' upper bunk)
  const c1 = k.part('cover', 0, 0, 0, { visible: false });
  c1.box(0.86, 0.14, 1.1, quiltMat(color, 'hearts'), 0.07, 0.36, 0.82);
  const c2 = k.part('cover2', 0, 0, 0, { visible: false });
  c2.box(0.86, 0.14, 1.1, quiltMat(color, 'stars'), 0.07, 1.28, 0.82);
  return k.build();
}

export { fabricMat };
