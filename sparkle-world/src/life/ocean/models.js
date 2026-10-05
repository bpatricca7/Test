// The sea animals' models (docs/teams/ocean.md §3, §3.1, §4.2): cute rounded toy animals with
// big eyes and blush, baked once per kind with SeaKit into ONE geometry (drawn instanced, one
// draw call per kind), plus per-vertex bend data for the sea material. Block units, nose = +Z;
// origin at the body's center (dolphin, fish, turtle, jelly, seahorse, whale) or at the feet
// (octopus, crab, starfish).
//
// Masks: 0 = a fixed color (eyes, blush, saddle), 1 = tinted by the palette body color,
// 2 = tinted by the palette accent, 3 = the body color lightened toward white (SKIN: a turtle's
// head and flippers, so its shell reads as a shell). Limbs: 0 body, 1 flippers / claws / back fin / bell rim,
// 2 legs / tentacles / arms, 3 the dolphin's saddle (shown only on a ridden dolphin).

import * as THREE from 'three';
import { Kit } from '../../things/pets/kit.js';
import { PALETTES, SEA_KINDS } from './kinds.js';
import { SKIN } from './material.js';

const W = '#FFFFFF'; // tinted parts are baked white and colored by the shader
const EYE = '#2A1B33';
const SHINE = '#FFFFFF';
const BLUSH = '#FF9EC4';
const SMILE = '#5A4A6A';
const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);

/** Kit with a mask, a limb and a pivot per part, written as the aSea / aPivot attributes. */
export class SeaKit extends Kit {
  constructor(along) {
    super();
    this.along = along || (() => 0);
    this._mask = 1;
    this._limb = 0;
    this._pivot = [0, 0, 0];
  }

  /** The following primitives use this mask, limb and pivot. */
  part(mask, limb = 0, pivot = null) {
    this._mask = mask;
    this._limb = limb;
    this._pivot = pivot || [0, 0, 0];
    return this;
  }

  _tag() {
    const p = this.parts[this.parts.length - 1];
    p.mask = this._mask;
    p.limb = this._limb;
    p.pivot = this._pivot;
    return this;
  }

  cbox(...a) { super.cbox(...a); return this._tag(); }
  cyl(...a) { super.cyl(...a); return this._tag(); }
  ball(...a) { super.ball(...a); return this._tag(); }

  /** A smooth round tube through points [[x, y, z], ...] (a smile line), with round ends. */
  tube(points, r, color, seg = 24, radial = 6) {
    const curve = new THREE.CatmullRomCurve3(points.map((p) => new THREE.Vector3(p[0], p[1], p[2])));
    this.parts.push({ g: new THREE.TubeGeometry(curve, seg, r, radial, false), color, cx: 0, cy: 0, cz: 0, sx: 1, sy: 1, sz: 1, rot: null });
    this._tag();
    const a = points[0], b = points[points.length - 1];
    this.ball(r, color, a[0], a[1], a[2], radial);
    this.ball(r, color, b[0], b[1], b[2], radial);
    return this;
  }

  /** A cylinder by its centre (Kit.cyl takes the base). */
  cylC(r, h, color, cx, cy, cz, rot = null, seg = 10, topRatio = 1) {
    return this.cyl(r, h, color, cx, cy - h / 2, cz, seg, rot, topRatio);
  }

  /** A small face: two eyes with shine, two blush dots, a smile (all fixed colors). */
  face(x, y, z, { eye = 0.055, spread = 1, seg = 8, smile = true, blush = true } = {}) {
    this.part(0, 0);
    for (const s of [-1, 1]) {
      this.ball(eye, EYE, s * x, y, z, seg);
      this.ball(eye * 0.38, SHINE, s * (x + eye * 0.3), y + eye * 0.5, z + eye * 0.6, 6);
      if (blush) this.ball(eye * 0.8, BLUSH, s * (x + eye * 0.5 * spread), y - eye * 1.6, z - eye * 0.5, 6, [1, 0.6, 0.4]);
    }
    if (smile) this.cbox(x * 0.9, eye * 0.25, eye * 0.3, SMILE, 0, y - eye * 2.2, z + eye * 0.2);
    return this;
  }

  /** Bake, then add aSea = (along, mask, limb) and aPivot per vertex. */
  geometry(opts) {
    const geo = super.geometry(opts);
    const P = geo.attributes.position;
    const sea = new Float32Array(P.count * 3), piv = new Float32Array(P.count * 3);
    let v = 0;
    for (const p of this.parts) {
      const n = p.g.attributes.position.count;
      for (let i = 0; i < n; i++, v++) {
        sea[v * 3] = clamp01(this.along(P.getX(v), P.getY(v), P.getZ(v), p));
        sea[v * 3 + 1] = p.mask;
        sea[v * 3 + 2] = p.limb;
        piv[v * 3] = p.pivot[0]; piv[v * 3 + 1] = p.pivot[1]; piv[v * 3 + 2] = p.pivot[2];
      }
    }
    geo.setAttribute('aSea', new THREE.BufferAttribute(sea, 3));
    geo.setAttribute('aPivot', new THREE.BufferAttribute(piv, 3));
    return geo;
  }
}

/** Scale a baked geometry in place (positions and pivots; normals renormalised). */
function scaleGeometry(geo, sx, sy, sz) {
  const P = geo.attributes.position, V = geo.attributes.aPivot, N = geo.attributes.normal;
  for (let i = 0; i < P.count; i++) {
    P.setXYZ(i, P.getX(i) * sx, P.getY(i) * sy, P.getZ(i) * sz);
    V.setXYZ(i, V.getX(i) * sx, V.getY(i) * sy, V.getZ(i) * sz);
    const nx = N.getX(i) / sx, ny = N.getY(i) / sy, nz = N.getZ(i) / sz;
    const l = Math.hypot(nx, ny, nz) || 1;
    N.setXYZ(i, nx / l, ny / l, nz / l);
  }
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return geo;
}

/**
 * The small kinds are built bigger than life next to a dolphin, so a 6-year-old spots them at a
 * glance from her swim camera (owner review: a seahorse 10 pixels tall is never found). Pick boxes
 * (index.js BOX) and heights above the sea bed follow these.
 */
export const SIZE = { fish: 2.0, seahorse: 1.7, starfish: 2.0, crab: 1.4 };
const sized = (kind, geo) => (SIZE[kind] ? scaleGeometry(geo, SIZE[kind], SIZE[kind], SIZE[kind]) : geo);

// ---------- the nine builders ----------

function dolphinParts(k) {
  const S = 12;
  const rot = (r) => { k.parts[k.parts.length - 1].rot = r; };
  k.part(1, 0).ball(0.32, W, 0, 0, 0, S, [0.9, 0.85, 2.6]);                    // body
  k.part(2, 0).ball(0.27, W, 0, -0.08, 0.05, 10, [0.8, 0.6, 2.3]);             // belly
  // the head: a soft rounded forehead that slopes down into a long, gently tapered beak (a
  // dolphin's rostrum), the pale belly running up under the chin
  // (a long forehead that runs back into the body: one smooth line over the head, no neck)
  k.part(1, 0).ball(0.25, W, 0, 0.05, 0.5, S, [0.92, 0.84, 1.7]);              // forehead
  k.part(2, 0).ball(0.16, W, 0, -0.085, 0.66, 10, [0.66, 0.62, 1.25]);         // chin (inside the beak's sides)
  const B0 = 0.66, BL = 0.42, BR = 0.12, BT = 0.55, BY = -0.05, BV = 0.82;     // beak: start, length, radius, taper, y, height
  k.part(1, 0).cylC(BR, BL, W, 0, BY, B0 + BL / 2, [Math.PI / 2, 0, 0], 12, BT);
  k.parts[k.parts.length - 1].sz *= BV;                                       // a little flatter than round
  k.part(1, 0).ball(BR * BT, W, 0, BY, B0 + BL, 10, [1, BV, 1.15]);            // its rounded tip
  // the smile: a line along each side of the beak, curving up at the back toward the eye
  const beakR = (z) => BR * (1 - (1 - BT) * Math.min(1, Math.max(0, (z - B0) / BL)));
  for (const s of [-1, 1]) {
    const pts = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10, z = B0 + BL - 0.04 - t * 0.3, r = beakR(z) + 0.004;
      const a = -0.4 + 0.6 * t ** 2.5;                                        // angle round the beak: below the middle, a small curl up at the back
      pts.push([s * r * Math.cos(a), BY + r * BV * Math.sin(a), z]);
    }
    k.part(0, 0).tube(pts, 0.009, SMILE, 12, 4);
  }
  k.part(0, 0);
  const ey = 0.10, ez = 0.70, ex = 0.17;
  for (const s of [-1, 1]) {
    k.ball(0.055, EYE, s * ex, ey, ez, 8);
    k.ball(0.02, SHINE, s * (ex + 0.02), ey + 0.03, ez + 0.03, 6);
    k.ball(0.045, BLUSH, s * (ex + 0.03), ey - 0.1, ez - 0.04, 6, [1, 0.6, 0.4]);
  }
  // the dorsal fin: a tapered fin leaning back, with a thick root (from the front a fin, not a stick)
  k.part(1, 0).cylC(0.17, 0.34, W, 0, 0.33, -0.14, [-0.62, 0, 0], 10, 0.12);
  k.parts[k.parts.length - 1].sx *= 0.38;
  // the flippers: rounded paddles, swept back (edge-on a soft oval, not a slab)
  for (const s of [-1, 1]) {
    k.part(1, 1, [s * 0.16, -0.12, 0.3]).ball(0.19, W, s * 0.3, -0.13, 0.27, 10, [1, 0.2, 0.55]);
    rot([0, s * 0.45, s * -0.5]);
  }
  k.part(1, 0).ball(0.16, W, 0, 0, -0.82, 10, [0.8, 0.8, 2]);                 // tail stock
  // the flukes: two rounded lobes with real thickness, swept back and tipped up a little, so
  // from the side they show as a soft V, not a thin stick
  k.part(1, 0).ball(0.1, W, 0, 0, -1.08, 10, [1.1, 0.6, 1]);                  // fluke root
  for (const s of [-1, 1]) {
    k.part(1, 0).ball(0.22, W, s * 0.22, 0.02, -1.2, 10, [1.1, 0.22, 0.5]);
    rot([0.1, s * -0.75, s * 0.32]);
  }
  k.part(0, 3, [0, 0.12, 0.18]).cbox(0.30, 0.05, 0.34, '#FFD84D', 0, 0.30, 0.18);                  // saddle seat
  k.part(0, 3, [0, 0.12, 0.3]).cbox(0.16, 0.16, 0.03, '#FF5FA2', 0, 0.36, 0.36, [0, 0, Math.PI / 4]); // saddle star
}

function whaleParts(k) {
  const rot = (r) => { k.parts[k.parts.length - 1].rot = r; };
  // the head: an ellipsoid centred at H with radii R (block units before scaling)
  const H = [0, 0.03, 0.42], R = [0.36, 0.33, 0.46];
  const onHead = (th, y, out = 0) => {
    const kk = Math.sqrt(Math.max(0, 1 - ((y - H[1]) / R[1]) ** 2));
    return [(R[0] * kk + out) * Math.sin(th), y, H[2] + (R[2] * kk + out) * Math.cos(th)];
  };
  // smooth round shapes (many segments, so the head meets the body in one soft crease)
  k.part(1, 0).ball(0.36, W, 0, 0, -0.1, 24, [1, 0.86, 2.3]);               // the long body
  k.part(1, 0).ball(1, W, H[0], H[1], H[2], 24, R);                          // the big round head
  k.part(2, 0).ball(0.33, W, 0, -0.11, 0.3, 20, [0.96, 0.62, 2.0]);          // the pale throat and belly
  // a long smile from cheek to cheek, curling up at the ends: one smooth line
  const smile = [];
  for (let i = 0; i <= 12; i++) {
    const t = -1 + (i / 12) * 2;
    smile.push(onHead(t * 0.95, 0.02 + 0.035 * t * t, 0.002));                // just above the pale chin
  }
  k.part(0, 0).tube(smile, 0.014, SMILE, 32);
  // eyes on the sides of the head, just behind the smile's ends; blush below
  for (const s of [-1, 1]) {
    const [x, y, z] = onHead(s * 1.2, 0.12, -0.01);
    k.ball(0.06, EYE, x, y, z, 10);
    const [x2, y2, z2] = onHead(s * 1.1, 0.16, 0.02);
    k.ball(0.022, SHINE, x2, y2, z2, 6);
    const [x3, y3, z3] = onHead(s * 1.3, 0.03, -0.005);
    k.ball(0.05, BLUSH, x3, y3, z3, 8, [1, 0.6, 0.6]);
  }
  k.part(0, 0).ball(0.045, SMILE, 0, H[1] + R[1] - 0.012, 0.38, 8, [1.4, 0.4, 0.8]); // the blowhole
  k.part(1, 0).ball(0.08, W, 0, 0.27, -0.6, 10, [0.55, 0.55, 1.5]);         // a small hump (no tall fin)
  for (const s of [-1, 1]) {                                                 // long side flippers, swept back
    k.part(1, 1, [s * 0.3, -0.14, 0.3]).ball(0.34, W, s * 0.52, -0.2, 0.18, 12, [1, 0.1, 0.3]);
    rot([0, s * 0.6, s * -0.35]);
  }
  k.part(1, 0).ball(0.17, W, 0, 0.02, -0.98, 14, [0.85, 0.8, 1.9]);          // the tail stock
  for (const s of [-1, 1]) {                                                 // a wide flat tail
    k.part(1, 0).ball(0.32, W, s * 0.27, 0.03, -1.34, 12, [1, 0.12, 0.48]);
    rot([0, s * -0.5, 0]);
  }
}

const BUILDERS = {
  dolphin() {
    const k = new SeaKit((x, y, z) => (0.6 - z) / 1.8);
    dolphinParts(k);
    return k.geometry();
  },
  whale() {
    // its own body plan (not a big dolphin): a huge round blunt head with a long smile, a pale
    // grooved throat, a blowhole, only a little hump for a back fin, long side flippers and a
    // wide tail
    const k = new SeaKit((x, y, z) => (0.5 - z) / 2.0);
    whaleParts(k);
    return scaleGeometry(k.geometry(), 4.2, 3.6, 4.2);
  },
  fish() {
    const k = new SeaKit((x, y, z) => (0.08 - z) / 0.3);
    k.part(1, 0).ball(0.16, W, 0, 0, 0, 12, [0.7, 0.95, 1]);
    for (const s of [-1, 1]) k.part(1, 0).cbox(0.02, 0.16, 0.13, W, 0, s * 0.05, -0.2, [s * 0.5, 0, 0]); // fan tail
    // little round side fins, well behind the eyes (low and forward they read as a frown)
    for (const s of [-1, 1]) k.part(1, 1, [s * 0.1, -0.01, -0.04]).ball(0.05, W, s * 0.12, -0.01, -0.06, 8, [0.25, 0.7, 1]);
    k.part(1, 0).cbox(0.015, 0.06, 0.1, W, 0, 0.15, -0.02);                   // a little top fin
    for (const s of [-1, 1]) {                                               // three accent dots a side (never stripes)
      k.part(2, 0).ball(0.022, W, s * 0.104, 0.04, 0.0, 6);
      k.ball(0.02, W, s * 0.1, -0.03, -0.04, 6);
      k.ball(0.018, W, s * 0.092, 0.05, -0.08, 6);
    }
    k.face(0.07, 0.04, 0.115, { eye: 0.03, smile: false });
    // a small smile on the front, curving up (on the body's surface)
    const front = (x, y) => 0.16 * Math.sqrt(Math.max(0, 1 - (x / 0.112) ** 2 - (y / 0.152) ** 2)) + 0.004;
    const sm = [];
    for (let i = 0; i <= 6; i++) { const t = -1 + i / 3; const x = t * 0.032, y = -0.035 + 0.014 * t * t; sm.push([x, y, front(x, y)]); }
    k.part(0, 0).tube(sm, 0.006, SMILE, 12);
    return sized('fish', k.geometry());
  },
  sea_turtle() {
    const k = new SeaKit((x, y, z) => (0.3 - z) / 1.0);
    // the domed shell in the body colour, with rounded lighter plates lying flat on it (they follow
    // the dome, nothing pokes up) and a darker band around its lower edge (a band on the dome, not
    // a flat disc: that read as a saucer); a big head held up in front and broad paddle flippers in
    // a lighter skin colour, so from her camera above and behind it reads as a turtle, not a dome
    // on stick legs
    const SA = 0.45, SB = 0.2025, SC = 0.495, SY = 0.05;                 // the dome's radii and centre
    const dome = (x, z) => SY + SB * Math.sqrt(Math.max(0, 1 - (x / SA) ** 2 - (z / SC) ** 2));
    k.part(1, 0).ball(0.45, W, 0, SY, 0, 16, [1, 0.45, 1.1]);              // domed shell
    k.part(1, 0).ball(0.456, '#BDBDBD', 0, 0.035, 0, 16, [1, 0.27, 1.1]); // a darker band on its lower edge
    k.part(0, 0).ball(0.42, '#FFF2D6', 0, -0.04, 0, 12, [0.95, 0.22, 1.05]); // cream belly
    k.part(2, 0);                                                          // lighter plates, flat on the dome
    const rot = (r) => { k.parts[k.parts.length - 1].rot = r; };
    k.ball(0.12, W, 0, dome(0, 0) - 0.012, 0, 10, [1, 0.16, 1.1]);
    for (const [x, z] of [[0.2, 0.15], [-0.2, 0.15], [0.21, -0.12], [-0.21, -0.12], [0, 0.29], [0, -0.28]]) {
      const y = dome(x, z), ny = (y - SY) / SB ** 2;
      k.ball(0.085, W, x, y - 0.016, z, 8, [1, 0.18, 1]);
      rot([Math.atan2(z / SC ** 2, ny), 0, -Math.atan2(x / SA ** 2, ny)]);
    }
    k.part(3, 0).cylC(0.11, 0.2, W, 0, 0.07, 0.5, [Math.PI / 2 - 0.35, 0, 0], 10); // a short neck, held up
    k.part(3, 0).ball(0.21, W, 0, 0.13, 0.7, 14, [1, 0.92, 1.08]);           // big round head
    k.face(0.1, 0.17, 0.87, { eye: 0.05 });
    for (const s of [-1, 1]) {
      // long, broad front flippers sweeping back (a sea turtle's paddles), round back flippers
      k.part(3, 1, [s * 0.32, -0.02, 0.18]).ball(0.3, W, s * 0.55, -0.02, 0.1, 12, [1, 0.12, 0.55]);
      rot([0, s * 0.6, s * -0.12]);
      k.part(3, 1, [s * 0.2, -0.03, -0.36]).ball(0.15, W, s * 0.3, -0.03, -0.45, 10, [1, 0.22, 0.8]);
      rot([0, s * 0.5, 0]);
    }
    k.part(3, 0).ball(0.07, W, 0, -0.01, -0.56, 8, [0.8, 0.6, 1.2]);      // a little tail
    return k.geometry();
  },
  octopus() {
    const k = new SeaKit((x, y, z) => (y > 0.3 ? 0 : Math.hypot(x, z) / 0.48));
    k.part(1, 0).ball(0.3, W, 0, 0.52, 0, 12, [1, 1.1, 1]);                 // big round head
    k.part(2, 0);                                                           // a little crown of spots
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      k.ball(0.055, W, Math.cos(a) * 0.16, 0.8, Math.sin(a) * 0.16, 6);
    }
    k.face(0.12, 0.52, 0.27, { eye: 0.07 });
    for (let i = 0; i < 8; i++) {                                           // eight curly tentacles
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8, c = Math.cos(a), s = Math.sin(a);
      k.part(1, 2, [c * 0.15, 0.25, s * 0.15]);
      k.ball(0.075, W, c * 0.22, 0.2, s * 0.22, 8);
      k.ball(0.062, W, c * 0.33, 0.1, s * 0.33, 8);
      k.ball(0.05, W, c * 0.42, 0.13, s * 0.42, 8);
    }
    return k.geometry();
  },
  jelly() {
    const k = new SeaKit((x, y, z) => (0.15 - y) / 0.75);
    k.part(1, 0).ball(0.25, W, 0, 0.25, 0, 12, [1, 0.75, 1]);              // rounded bell
    k.part(2, 1);                                                           // a frilly rim
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      k.ball(0.05, W, Math.cos(a) * 0.235, 0.11, Math.sin(a) * 0.235, 6);
    }
    k.face(0.08, 0.27, 0.215, { eye: 0.04 });
    k.part(2, 2, [0, 0.1, 0]);                                              // four ribbon arms
    for (const [x, z] of [[0.06, 0.06], [-0.06, 0.06], [0.06, -0.06], [-0.06, -0.06]]) k.cbox(0.05, 0.42, 0.02, W, x, -0.12, z, [0, Math.atan2(x, z), 0]);
    k.part(1, 2, [0, 0.1, 0]);                                              // six thin tentacles
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2 + 0.3;
      k.cbox(0.018, 0.55, 0.018, W, Math.cos(a) * 0.17, -0.18, Math.sin(a) * 0.17);
    }
    return k.geometry();
  },
  seahorse() {
    const k = new SeaKit((x, y, z) => (0.05 - y) / 0.3);
    k.part(1, 0).ball(0.11, W, 0, 0, 0, 10, [0.85, 1.4, 0.9]);            // body
    k.part(2, 0).ball(0.08, W, 0, -0.01, 0.055, 8, [0.8, 1.2, 0.6]);      // round belly
    k.part(1, 0).ball(0.085, W, 0, 0.17, 0.03, 10);                        // head
    k.part(1, 0).cylC(0.03, 0.12, W, 0, 0.16, 0.14, [Math.PI / 2, 0, 0], 8); // snout
    k.part(1, 0);                                                          // little crown spikes
    for (const [x, z] of [[0, -0.01], [0.035, 0.02], [-0.035, 0.02]]) k.cylC(0.022, 0.06, W, x, 0.27, z, null, 6, 0);
    k.face(0.055, 0.19, 0.08, { eye: 0.03, smile: false });
    k.part(1, 0);                                                          // the curled tail
    k.ball(0.06, W, 0, -0.15, -0.02, 8);
    k.ball(0.045, W, 0, -0.22, -0.06, 8);
    k.ball(0.035, W, 0, -0.245, -0.115, 8);
    k.ball(0.028, W, 0, -0.22, -0.155, 8);
    k.ball(0.022, W, 0, -0.185, -0.14, 8);
    k.part(2, 1, [0, 0.02, -0.08]).cbox(0.015, 0.12, 0.08, W, 0, 0.02, -0.12); // the fluttering back fin
    return sized('seahorse', k.geometry());
  },
  crab() {
    const k = new SeaKit((x, y, z) => Math.hypot(x, z) / 0.4);
    k.part(1, 0).ball(0.2, W, 0, 0.16, 0, 12, [1.25, 0.6, 1]);            // round flat shell
    k.part(2, 0).ball(0.18, W, 0, 0.12, 0, 10, [1.2, 0.4, 0.9]);          // pale belly
    for (const s of [-1, 1]) {
      k.part(1, 0).cylC(0.02, 0.13, W, s * 0.07, 0.29, 0.12, null, 6);   // eye stalks
      k.part(0, 0).ball(0.05, '#FFFFFF', s * 0.07, 0.37, 0.12, 8);
      k.ball(0.028, EYE, s * 0.07, 0.375, 0.16, 6);
      k.ball(0.04, BLUSH, s * 0.15, 0.17, 0.2, 6, [1, 0.6, 0.4]);
      k.part(1, 1, [s * 0.22, 0.16, 0.1]);                                 // two big claws
      k.cbox(0.13, 0.05, 0.05, W, s * 0.28, 0.17, 0.14, [0, s * -0.5, 0]);
      k.ball(0.075, W, s * 0.34, 0.19, 0.22, 8, [1, 0.8, 1.3]);
      k.cbox(0.04, 0.03, 0.09, W, s * 0.34, 0.25, 0.3);
      k.part(1, 2, [s * 0.18, 0.1, 0]);                                    // six legs
      for (const z of [-0.1, -0.02, 0.06]) k.cbox(0.17, 0.03, 0.03, W, s * 0.27, 0.07, z, [0, 0, s * 0.6]);
    }
    k.part(0, 0).cbox(0.06, 0.012, 0.012, SMILE, 0, 0.14, 0.2);
    return sized('crab', k.geometry());
  },
  starfish() {
    const k = new SeaKit((x, y, z) => Math.hypot(x, z) / 0.25);
    k.part(1, 0).ball(0.11, W, 0, 0.04, 0, 10, [1, 0.4, 1]);
    for (let i = 0; i < 5; i++) {                                         // five plump arms
      const a = (i / 5) * Math.PI * 2 + Math.PI / 2, c = Math.cos(a), s = Math.sin(a);
      k.part(1, 2, [c * 0.08, 0.04, s * 0.08]);
      k.ball(0.08, W, c * 0.12, 0.04, s * 0.12, 8, [1, 0.45, 1]);
      k.ball(0.06, W, c * 0.2, 0.035, s * 0.2, 8, [1, 0.45, 1]);
      k.part(2, 2, [c * 0.08, 0.04, s * 0.08]);                            // white dots
      k.ball(0.016, W, c * 0.13, 0.075, s * 0.13, 6);
      k.ball(0.013, W, c * 0.2, 0.062, s * 0.2, 6);
    }
    k.part(0, 0);
    for (const s of [-1, 1]) {
      k.ball(0.022, EYE, s * 0.035, 0.085, 0.025, 6);
      k.ball(0.009, SHINE, s * 0.04, 0.097, 0.033, 6);
      k.ball(0.02, BLUSH, s * 0.065, 0.075, -0.01, 6, [1, 0.5, 1]);
    }
    k.cbox(0.025, 0.006, 0.008, SMILE, 0, 0.079, -0.025);                 // a tiny smile
    return sized('starfish', k.geometry());
  },
};

const cache = new Map();

/** The kind's geometry, built once and cached (never disposed). */
export function geometryFor(kind) {
  let g = cache.get(kind);
  if (!g) {
    g = BUILDERS[kind]();
    g.userData.shared = true;
    cache.set(kind, g);
  }
  return g;
}

/** Triangles of one animal of a kind (for the budget check). */
export function trianglesOf(kind) {
  const g = geometryFor(kind);
  return (g.index ? g.index.count : g.attributes.position.count) / 3;
}

const _c = new THREE.Color();
const _a = new THREE.Color();
const _k = new THREE.Color();
const _w = new THREE.Color(1, 1, 1);

/**
 * A plain, non-instanced mesh of one animal with its palette baked into the vertex colors (for
 * thumbnails and the Sea Friends strip). The geometry is a fresh copy; the caller disposes it.
 */
export function plainMesh(kind, variant = 0) {
  const src = geometryFor(kind);
  const pal = PALETTES[kind][variant] || PALETTES[kind][0];
  _c.set(pal[1]);
  _a.set(pal[2]);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', src.attributes.position.clone());
  geo.setAttribute('normal', src.attributes.normal.clone());
  const col = src.attributes.color.clone();
  const sea = src.attributes.aSea, piv = src.attributes.aPivot;
  const P = geo.attributes.position;
  for (let i = 0; i < col.count; i++) {
    const m = sea.getY(i);
    if (m > 0.5) {
      const t = m < 1.5 ? _c : m < 2.5 ? _a : _k.copy(_c).lerp(_w, SKIN);
      col.setXYZ(i, col.getX(i) * t.r, col.getY(i) * t.g, col.getZ(i) * t.b);
    }
    // the saddle is folded away (only a ridden dolphin shows it)
    if (Math.abs(sea.getZ(i) - 3) < 0.5) P.setXYZ(i, piv.getX(i), piv.getY(i), piv.getZ(i));
  }
  geo.setAttribute('color', col);
  geo.setIndex(src.index.clone());
  geo.computeBoundingBox();
  geo.computeBoundingSphere();
  return new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true }));
}

const THUMB_OPTS = {
  dolphin: { dir: [1.0, 0.45, 1.2], zoom: 0.92 },
  whale: { dir: [1.0, 0.45, 1.2], zoom: 0.92 },
  fish: { dir: [1.0, 0.3, 1.0], zoom: 0.85 },
  starfish: { dir: [0.2, 1.4, 0.8], zoom: 0.85 },
};

/** Promise of the animal's 96x96 picture (data URL; '' when thumbnails are off). */
export function thumbFor(game, kind, variant = 0, priority = 'normal') {
  if (!game.thumbs || SEA_KINDS.indexOf(kind) < 0) return Promise.resolve('');
  const o = THUMB_OPTS[kind] || { dir: [1.0, 0.6, 1.4], zoom: 0.85 };
  return game.thumbs.get(`sea:${kind}:${variant}`, () => plainMesh(kind, variant), { ...o, priority });
}
