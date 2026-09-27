// Rig helpers shared by every pet builder (species.js, breeds.js, turtle.js, horse.js):
// pivot groups placed at root-space points, baked vertex-colored parts, big shiny eyes (with a
// "^" happy eye and a closed sleepy eye), and the empty rig record a builder fills in.
//
// Models face +Z with the origin at the feet. A part drawn with part() uses ROOT coordinates
// (block units); partL() draws in the pivot's own coordinates (for parts several pivots share).

import * as THREE from 'three';
import { baked, VC_MAT, blobShadow } from './kit.js';
import { shade } from '../../core/util.js';

export const INK = '#2A1B33';
export const BLUSH = '#FF9EBE';
export const GOLD = '#FFD86B';
export const RAINBOW = ['#FF7A9A', '#FFB36B', '#FFE27A', '#8FE3A0', '#7CC7FF', '#B79CFF'];

/** A pivot group at world point w (root space), inside a parent whose world point is pw. */
export function pivot(parent, pw, w) {
  const g = new THREE.Group();
  g.position.set(w[0] - pw[0], w[1] - pw[1], w[2] - pw[2]);
  g.userData.w = w;
  parent.add(g);
  return g;
}

/** Baked mesh drawn in ROOT coordinates, placed inside a pivot group at world w. */
export function part(group, key, draw, material = VC_MAT) {
  const w = group.userData.w || [0, 0, 0];
  const geo = baked(key, (kit) => {
    const k = offsetKit(kit, w);
    draw(k);
  });
  const m = new THREE.Mesh(geo, material);
  group.add(m);
  return m;
}

/** Baked mesh drawn in the pivot's OWN coordinates (for parts shared by several pivots). */
export function partL(group, key, draw, material = VC_MAT) {
  const m = new THREE.Mesh(baked(key, (kit) => { draw(kit); }), material);
  group.add(m);
  return m;
}

/** Wrap a Kit so every position is given in root space and stored relative to w. */
export function offsetKit(kit, w) {
  const [ox, oy, oz] = w;
  return {
    cbox: (sx, sy, sz, c, x, y, z, rot) => kit.cbox(sx, sy, sz, c, x - ox, y - oy, z - oz, rot),
    cyl: (r, h, c, x, y, z, seg, rot, top) => kit.cyl(r, h, c, x - ox, y - oy, z - oz, seg, rot, top),
    ball: (r, c, x, y, z, seg, sc) => kit.ball(r, c, x - ox, y - oy, z - oz, seg, sc),
  };
}

/**
 * Eye mesh centred on its own origin (so scale.y blinks around the middle), facing +Z.
 * userData.happy is the "^" eye shown when overjoyed, userData.sleepy the closed "v" eye.
 */
export function eyeMesh(parent, key, x, y, z, w, h, { iris = null, slit = false, lashes = 0, ring = false } = {}) {
  const geo = baked(`eye:${key}:${w}:${h}:${iris}:${slit}:${lashes}:${ring}`, (kit) => {
    const d = 0.02;
    if (ring) kit.cbox(w + 0.035, h + 0.035, d, '#FFFFFF', 0, 0, -0.004);
    kit.cbox(w, h, d, INK, 0, 0, 0);
    if (iris) {
      kit.cbox(w * 0.8, h * 0.52, d, iris, 0, -h * 0.17, 0.003);
      kit.cbox(w * 0.8, h * 0.14, d, shade(iris, 0.35), 0, -h * 0.36, 0.004);
    }
    if (slit) kit.cbox(w * 0.26, h * 0.72, d, '#1B1022', 0, -h * 0.04, 0.005);
    kit.cbox(w * 0.42, w * 0.42, d, '#FFFFFF', -w * 0.17, h * 0.2, 0.008);
    kit.cbox(w * 0.2, w * 0.2, d, '#FFFFFF', w * 0.22, -h * 0.26, 0.008);
    if (lashes) {
      // a little flick at the outer top corner (lashes = +1 right eye, -1 left eye)
      kit.cbox(w * 0.34, h * 0.13, d, INK, lashes * w * 0.52, h * 0.44, 0.002, [0, 0, lashes * 0.5]);
      kit.cbox(w * 0.26, h * 0.11, d, INK, lashes * w * 0.58, h * 0.26, 0.002, [0, 0, lashes * 0.15]);
    }
  });
  const m = new THREE.Mesh(geo, VC_MAT);
  const pw = parent.userData.w || [0, 0, 0];
  m.position.set(x - pw[0], y - pw[1], z - pw[2]);
  parent.add(m);
  const hc = ring ? '#FFFFFF' : INK;
  const t = Math.max(0.022, h * 0.2), len = w * 0.62;
  // "^" happy eye
  const hg = baked(`eye-happy:${w}:${h}:${hc}`, (kit) => {
    kit.cbox(len, t, 0.02, hc, -w * 0.2, 0, 0.004, [0, 0, 0.62]);
    kit.cbox(len, t, 0.02, hc, w * 0.2, 0, 0.004, [0, 0, -0.62]);
  });
  // "v" sleepy closed eye (its own geometry: a merged rig cannot flip a part with scale -1)
  const sg = baked(`eye-sleepy:${w}:${h}:${hc}`, (kit) => {
    kit.cbox(len, t, 0.02, hc, -w * 0.2, 0, 0.004, [0, 0, -0.62]);
    kit.cbox(len, t, 0.02, hc, w * 0.2, 0, 0.004, [0, 0, 0.62]);
  });
  const hm = new THREE.Mesh(hg, VC_MAT);
  hm.position.copy(m.position);
  hm.visible = false;
  hm.scale.setScalar(0);
  parent.add(hm);
  const sm = new THREE.Mesh(sg, VC_MAT);
  sm.position.copy(m.position);
  sm.visible = false;
  sm.scale.setScalar(0);
  parent.add(sm);
  m.userData.happy = hm;
  m.userData.sleepy = sm;
  return m;
}

/** The empty rig record a species builder fills in. */
export function newRig(species, spec, variant) {
  const root = new THREE.Group();
  root.name = 'pet:' + species;
  const jumper = new THREE.Group();
  jumper.userData.w = [0, 0, 0];
  root.add(jumper);
  const shadow = blobShadow(spec.shadow);
  shadow.position.y = 0.02;
  root.add(shadow);
  return {
    species, variant, spec, root, jumper, shadow,
    body: null, head: null, eyes: [], ears: [], earBase: [], tail: null, tail2: null,
    legs: [], front: [], back: [], wings: [], tongue: null, horn: null, mane: null,
    bodyY: 0, legLen: 0.25, lashes: false,
    canHide: false, // turtles pull head, legs and tail into the shell
    skinned: null, // the merged SkinnedMesh of a live pet (see skin.js)
  };
}
