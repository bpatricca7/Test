// The sea animals' models (docs/teams/ocean.md §3, §3.1, §4.2): cute rounded toy animals with
// big eyes and blush, baked once per kind with SeaKit into ONE geometry (drawn instanced, one
// draw call per kind), plus per-vertex bend data for the sea material. Block units, nose = +Z;
// origin at the body's center (dolphin, fish, turtle, jelly, seahorse, whale) or at the feet
// (octopus, crab, starfish).
//
// Masks: 0 = a fixed color (eyes, blush, saddle), 1 = tinted by the palette body color,
// 2 = tinted by the palette accent. Limbs: 0 body, 1 flippers / claws / back fin / bell rim,
// 2 legs / tentacles / arms, 3 the dolphin's saddle (shown only on a ridden dolphin).

import * as THREE from 'three';
import { Kit } from '../../things/pets/kit.js';
import { PALETTES, SEA_KINDS } from './kinds.js';

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

// ---------- the nine builders ----------

function dolphinParts(k, { whale = false } = {}) {
  const S = whale ? 12 : 12;
  k.part(1, 0).ball(0.32, W, 0, 0, 0, S, [0.9, 0.85, 2.6]);                    // body
  k.part(2, 0).ball(0.27, W, 0, -0.08, 0.05, S, [0.8, 0.6, 2.3]);              // belly
  if (whale) {
    k.part(1, 0).ball(0.3, W, 0, 0.02, 0.5, S, [1.05, 0.95, 1.1]);            // a wide round head
    for (const z of [0.05, 0.2, 0.35]) k.part(0, 0).cbox(0.3, 0.02, 0.03, '#FFFFFF', 0, -0.225, z); // belly stripes (just showing)
  } else {
    k.part(1, 0).ball(0.24, W, 0, 0.06, 0.6, S);                              // forehead
    k.part(1, 0).cylC(0.09, 0.32, W, 0, -0.04, 0.8, [Math.PI / 2, 0, 0], 10);  // beak
    k.part(1, 0).ball(0.09, W, 0, -0.04, 0.96, 8);
    k.part(0, 0).cbox(0.14, 0.015, 0.02, SMILE, 0, -0.05, 1.0);               // smile line
  }
  k.part(0, 0);
  const ey = whale ? 0.08 : 0.10, ez = whale ? 0.74 : 0.72, ex = whale ? 0.23 : 0.17;
  for (const s of [-1, 1]) {
    k.ball(0.055, EYE, s * ex, ey, ez, 8);
    k.ball(0.02, SHINE, s * (ex + 0.02), ey + 0.03, ez + 0.03, 6);
    k.ball(0.045, BLUSH, s * (ex + 0.03), ey - 0.1, ez - 0.04, 6, [1, 0.6, 0.4]);
  }
  if (whale) k.part(0, 0).cbox(0.2, 0.015, 0.02, SMILE, 0, -0.06, 0.8);
  k.part(1, 0).cbox(0.05, 0.30, 0.28, W, 0, 0.32, -0.1, [-0.5, 0, 0]);         // dorsal fin
  for (const s of [-1, 1]) {
    k.part(1, 1, [s * 0.16, -0.12, 0.3]).cbox(0.32, 0.04, 0.16, W, s * 0.30, -0.12, 0.3, [0, 0, s * 0.5]); // flippers
  }
  k.part(1, 0).ball(0.16, W, 0, 0, -0.82, 10, [0.8, 0.8, 2]);                 // tail stock
  for (const s of [-1, 1]) k.part(1, 0).cbox(0.30, 0.04, 0.20, W, s * 0.16, 0, -1.12, [0, s * 0.4, 0]); // flukes (V)
  if (!whale) {
    k.part(0, 3, [0, 0.12, 0.18]).cbox(0.30, 0.05, 0.34, '#FFD84D', 0, 0.30, 0.18);                  // saddle seat
    k.part(0, 3, [0, 0.12, 0.3]).cbox(0.16, 0.16, 0.03, '#FF5FA2', 0, 0.36, 0.36, [0, 0, Math.PI / 4]); // saddle star
  }
}

const BUILDERS = {
  dolphin() {
    const k = new SeaKit((x, y, z) => (0.6 - z) / 1.8);
    dolphinParts(k);
    return k.geometry();
  },
  whale() {
    const k = new SeaKit((x, y, z) => (0.6 - z) / 1.8);
    dolphinParts(k, { whale: true });
    return scaleGeometry(k.geometry(), 4.2, 3.6, 4.2);
  },
  fish() {
    const k = new SeaKit((x, y, z) => (0.08 - z) / 0.3);
    k.part(1, 0).ball(0.16, W, 0, 0, 0, 10, [0.7, 0.95, 1]);
    for (const s of [-1, 1]) k.part(1, 0).cbox(0.02, 0.16, 0.13, W, 0, s * 0.05, -0.2, [s * 0.5, 0, 0]); // fan tail
    for (const s of [-1, 1]) k.part(1, 1, [s * 0.09, -0.03, 0.02]).cbox(0.09, 0.015, 0.06, W, s * 0.12, -0.04, 0.0, [0, 0, s * 0.4]);
    k.part(1, 0).cbox(0.015, 0.06, 0.1, W, 0, 0.15, -0.02);                   // a little top fin
    for (const s of [-1, 1]) {                                               // three accent dots a side (never stripes)
      k.part(2, 0).ball(0.022, W, s * 0.104, 0.04, 0.0, 6);
      k.ball(0.02, W, s * 0.1, -0.03, -0.04, 6);
      k.ball(0.018, W, s * 0.092, 0.05, -0.08, 6);
    }
    k.face(0.07, 0.04, 0.115, { eye: 0.03, smile: false });
    return k.geometry();
  },
  sea_turtle() {
    const k = new SeaKit((x, y, z) => (0.3 - z) / 1.0);
    k.part(1, 0).ball(0.45, W, 0, 0.05, 0, 12, [1, 0.45, 1.1]);             // domed shell
    k.part(0, 0).ball(0.42, '#FFF2D6', 0, -0.03, 0, 10, [0.95, 0.25, 1.05]); // cream belly
    k.part(2, 0);                                                           // lighter scutes on top
    k.cbox(0.17, 0.035, 0.17, W, 0, 0.255, 0, [0, Math.PI / 4, 0]);
    for (const [x, z] of [[0.21, 0.13], [-0.21, 0.13], [0.21, -0.13], [-0.21, -0.13], [0, 0.27], [0, -0.27]]) {
      k.cbox(0.13, 0.03, 0.13, W, x, 0.215, z, [Math.atan2(x, z) * 0.15, Math.PI / 4, 0]);
    }
    k.part(1, 0).ball(0.17, W, 0, 0.05, 0.6, 10);                           // round head
    k.face(0.085, 0.11, 0.7, { eye: 0.04 });
    for (const s of [-1, 1]) {
      k.part(1, 1, [s * 0.26, -0.02, 0.25]).cbox(0.44, 0.04, 0.16, W, s * 0.45, -0.03, 0.27, [0, s * -0.45, s * 0.15]); // long front flippers
      k.part(1, 1, [s * 0.2, -0.03, -0.36]).cbox(0.2, 0.04, 0.12, W, s * 0.29, -0.04, -0.42, [0, s * 0.5, 0]);       // short back flippers
    }
    k.part(1, 0).ball(0.06, W, 0, 0, -0.55, 8);
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
    return k.geometry();
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
    return k.geometry();
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
    return k.geometry();
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
      const t = m < 1.5 ? _c : _a;
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
