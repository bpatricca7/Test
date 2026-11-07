// The Twinkle Elves' 3D models (our own little characters: a round face with rosy cheeks and
// pointy ears, a floppy hat with a glowing star at its tip, a fluffy hat band, a striped scarf,
// a soft tunic with a zigzag hem, mittens and curly shoes with tiny bells), their tiny scenes,
// the Elf Door and the elves' cottage sign.
//
// An elf is four meshes (body, head, waving arm, hat star) so it can look at the player, giggle, hop
// and wave; each mesh's geometry is baked once per scheme / pose / scene (pets/kit.js) and
// shared by every elf like it. Model units are blocks; the model spans the [0,1]^3 cell with
// its feet at the cell's middle, front +Z (entities.js). data.dy lowers the whole elf onto a
// low top (a bed, a sofa seat), see docs/teams/elves.md §4.

import * as THREE from 'three';
import { baked, VC_MAT, glowMat } from '../pets/kit.js';
import { canvasTexture } from '../../core/models.js';
import { SCHEMES, GREETER_SCHEME, SCENES, POSES } from './data.js';

const DARK = '#2A1B33';
const WHITE = '#FFFFFF';
const SHOULDER_Y = 0.29;
const SHOULDER_X = 0.112;
const NECK_Y = 0.31;

function darken(hex, k = 0.18) {
  const n = parseInt(String(hex).slice(1), 16) || 0;
  const f = (v) => Math.max(0, Math.min(255, Math.round(v * (1 - k))));
  return '#' + [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => f(v).toString(16).padStart(2, '0')).join('');
}

/** The scheme for an elf's data (the greeter has its own). */
export function schemeOf(data, idx) {
  if (data && data.role === 'greet') return GREETER_SCHEME;
  return SCHEMES[idx] || SCHEMES[0];
}

// ---------- baked parts (origin: between the feet; body parts in "stand" units) ----------

/** Legs, shoes, tunic, belt, scarf and the left arm (the right arm waves on its own). */
function bodyParts(k, s, pose) {
  const sit = pose === 'sit';
  const low = sit ? -0.1 : 0;
  if (sit) {
    // legs forward over the edge, shoes up
    for (const sx of [-1, 1]) {
      k.cyl(0.032, 0.13, s.suit, sx * 0.055, 0.03 - 0.065, 0.06, 10, [Math.PI / 2, 0, 0]);
      k.cyl(0.033, 0.03, WHITE, sx * 0.055, 0.03 - 0.015, 0.12, 10, [Math.PI / 2, 0, 0]);
      k.cbox(0.07, 0.09, 0.05, s.shoe, sx * 0.055, 0.06, 0.15);
      k.ball(0.022, s.shoe, sx * 0.055, 0.115, 0.165);
      k.ball(0.014, '#FFD84D', sx * 0.055, 0.135, 0.175);
    }
  } else if (pose !== 'cup') {
    for (const sx of [-1, 1]) {
      k.cbox(0.075, 0.05, 0.11, s.shoe, sx * 0.055, 0.025, 0.015);
      k.ball(0.022, s.shoe, sx * 0.055, 0.06, 0.075);
      k.ball(0.014, '#FFD84D', sx * 0.055, 0.082, 0.09);
      // striped stockings
      k.cyl(0.032, 0.035, s.suit, sx * 0.055, 0.045, 0, 10);
      k.cyl(0.033, 0.035, WHITE, sx * 0.055, 0.08, 0, 10);
    }
  }
  // tunic (a soft bell shape) with a zigzag hem
  k.cyl(0.125, 0.2, s.suit, 0, 0.11 + low, 0, 16, null, 0.72);
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    k.cyl(0.032, 0.05, s.brim, Math.sin(a) * 0.118, 0.095 + low, Math.cos(a) * 0.118, 6, [Math.PI, 0, 0], 0);
  }
  // belt, buckle, buttons
  k.cyl(0.113, 0.026, s.shoe, 0, 0.19 + low, 0, 16);
  k.cbox(0.05, 0.036, 0.012, '#FFD84D', 0, 0.203 + low, 0.112);
  k.ball(0.013, s.brim, 0, 0.245 + low, 0.1);
  k.ball(0.013, s.brim, 0, 0.275 + low, 0.088);
  // scarf: a ring and a striped tail
  k.cyl(0.098, 0.045, s.scarf, 0, 0.292 + low, 0, 16);
  k.cbox(0.048, 0.13, 0.022, s.scarf, -0.045, 0.245 + low, 0.098, [0.12, 0, 0.12]);
  for (const y of [0.21, 0.25]) k.cbox(0.05, 0.016, 0.024, s.stripe, -0.045 + (0.27 - y) * 0.12, y + low, 0.1, [0.12, 0, 0.12]);
  // left arm (+X side), resting
  const a = 0.42;
  const len = 0.12;
  const cx = SHOULDER_X + Math.sin(a) * len * 0.5, cy = SHOULDER_Y + low - Math.cos(a) * len * 0.5;
  k.cyl(0.03, len, s.suit, cx, cy - len / 2, 0, 10, [0, 0, a]);
  k.ball(0.04, s.mitt, SHOULDER_X + Math.sin(a) * len, SHOULDER_Y + low - Math.cos(a) * len, 0);
}

/** The right arm hanging from its shoulder pivot (straight down), with what it holds. */
function armParts(k, s, hold) {
  const len = 0.12;
  k.cyl(0.03, len, s.suit, 0, -len, 0, 10);
  k.ball(0.04, s.mitt, 0, -len - 0.01, 0);
  const hy = -len - 0.03;
  if (hold === 'cookie') {
    k.cyl(0.04, 0.014, '#D9A066', 0, hy - 0.007, 0.03, 12, [Math.PI / 2, 0, 0]);
    for (const [x, y] of [[-0.012, 0.01], [0.015, -0.008], [0.004, 0.018]]) k.ball(0.007, '#6B3F26', x, hy + y, 0.05);
  } else if (hold === 'plane') {
    k.cbox(0.02, 0.012, 0.16, WHITE, 0, hy - 0.04, 0.02);
    k.cbox(0.13, 0.006, 0.09, '#EAF4FF', -0.045, hy - 0.035, 0.0, [0, 0, 0.25]);
    k.cbox(0.13, 0.006, 0.09, '#EAF4FF', 0.045, hy - 0.035, 0.0, [0, 0, -0.25]);
  } else if (hold === 'candy') {
    for (let i = 0; i < 5; i++) k.cyl(0.014, 0.03, i % 2 ? WHITE : '#F25C5C', 0, hy - 0.08 + i * 0.03, 0.02, 8);
    k.cyl(0.014, 0.04, '#F25C5C', 0.016, hy + 0.068, 0.02, 8, [0, 0, -1.1]);
    k.cyl(0.014, 0.035, WHITE, 0.042, hy + 0.06, 0.02, 8, [0, 0, -2.4]);
  } else if (hold === 'book') {
    k.cbox(0.09, 0.11, 0.012, s.scarf, -0.03, hy, 0.04, [0, 0.5, 0]);
    k.cbox(0.085, 0.1, 0.016, '#FFF8EC', -0.03, hy, 0.048, [0, 0.5, 0]);
  }
}

/** Head, face, ears, hair and the floppy hat (origin: the neck pivot). */
function headParts(k, s) {
  const darkSkin = darken(s.skin, 0.12);
  // hair behind and at the sides
  k.ball(0.132, s.hair, 0, 0.15, -0.035, 14);
  k.ball(0.055, s.hair, 0.112, 0.1, -0.03, 10);
  k.ball(0.055, s.hair, -0.112, 0.1, -0.03, 10);
  // the round face
  k.ball(0.14, s.skin, 0, 0.13, 0, 16, [1.04, 0.95, 1]);
  // pointy ears
  for (const sx of [-1, 1]) {
    const th = -sx * 1.18;
    const h = 0.095;
    const ax = -Math.sin(th), ay = Math.cos(th);
    const bx = sx * 0.125, by = 0.13;
    const cx = bx + ax * h * 0.5, cy = by + ay * h * 0.5;
    k.cyl(0.036, h, s.skin, cx, cy - h / 2, -0.01, 8, [0, 0, th], 0);
    k.ball(0.02, '#FFB7C9', bx + ax * 0.02, by + ay * 0.02, 0.01, 8, [1, 0.7, 0.5]);
  }
  // eyes with a shine, rosy cheeks, a button nose, a happy little mouth
  for (const sx of [-1, 1]) {
    k.ball(0.026, DARK, sx * 0.05, 0.135, 0.124, 10, [1, 1.25, 0.55]);
    k.ball(0.009, WHITE, sx * 0.05 + 0.009, 0.149, 0.138, 6);
    k.ball(0.029, s.cheek, sx * 0.086, 0.092, 0.11, 10, [1.25, 0.8, 0.4]);
  }
  k.ball(0.02, darkSkin, 0, 0.107, 0.138, 8);
  k.ball(0.017, '#C2456E', 0, 0.067, 0.131, 8, [1.5, 0.75, 0.5]);
  // bangs under the brim
  for (const x of [-0.07, 0, 0.07]) k.ball(0.042, s.hair, x, 0.205, 0.085, 8, [1, 0.7, 0.8]);
  // the hat: a fluffy band, a cone and a floppy tip
  k.cyl(0.148, 0.05, s.brim, 0, 0.2, 0, 18);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.ball(0.03, s.brim, Math.sin(a) * 0.14, 0.226, Math.cos(a) * 0.14, 8);
  }
  k.cyl(0.13, 0.16, s.hat, 0, 0.245, -0.005, 16, null, 0.55);
  const tip = hatTip();
  k.cyl(0.0715, 0.17, s.hat, tip.cx, tip.cy - 0.085, tip.cz, 12, [tip.rx, 0, tip.rz], 0.08);
  // a little stripe on the cone
  k.cyl(0.118, 0.022, s.brim, 0, 0.31, -0.005, 16, null, 0.95);
}

/** Where the floppy part of the hat sits (centre, tilt) and its tip (the star). */
function hatTip() {
  const rx = -0.62, rz = -0.42, h = 0.17;
  const base = new THREE.Vector3(0, 0.395, -0.01);
  const axis = new THREE.Vector3(0, 1, 0).applyEuler(new THREE.Euler(rx, 0, rz));
  const c = base.clone().addScaledVector(axis, h / 2);
  const t = base.clone().addScaledVector(axis, h);
  return { rx, rz, cx: c.x, cy: c.y, cz: c.z, tx: t.x, ty: t.y, tz: t.z };
}

/** A five-pointed star of little rays (the glowing hat star, the "found" star). */
function starParts(k) {
  k.ball(0.03, WHITE, 0, 0, 0, 8);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    k.cbox(0.022, 0.06, 0.02, WHITE, Math.sin(a) * 0.03, Math.cos(a) * 0.03, 0, [0, 0, -a]);
  }
}

/** The tiny scenes: props beside the elf (feet origin). */
function sceneParts(k, s, scene) {
  switch (scene) {
    case 'cookies': {
      k.cyl(0.095, 0.012, WHITE, 0.22, 0, 0.12, 16);
      for (const [x, y, z] of [[0.2, 0.012, 0.1], [0.245, 0.012, 0.135], [0.215, 0.026, 0.13], [0.24, 0.04, 0.11]]) {
        k.cyl(0.036, 0.013, '#D9A066', x, y, z, 12);
        k.ball(0.007, '#6B3F26', x + 0.01, y + 0.014, z + 0.005, 6);
        k.ball(0.007, '#6B3F26', x - 0.012, y + 0.014, z - 0.006, 6);
      }
      break;
    }
    case 'note': {
      k.cbox(0.14, 0.1, 0.012, WHITE, 0.22, 0.05, 0.12, [-0.35, -0.4, 0]);
      k.ball(0.018, '#FF5FA2', 0.21, 0.065, 0.14, 8, [1, 1, 0.4]);
      k.ball(0.018, '#FF5FA2', 0.235, 0.065, 0.13, 8, [1, 1, 0.4]);
      k.cbox(0.03, 0.03, 0.01, '#FF5FA2', 0.222, 0.048, 0.137, [-0.35, -0.4, Math.PI / 4]);
      break;
    }
    case 'angel': {
      // a snow angel in sugar under the elf (the elf lies on it)
      k.ball(0.17, WHITE, 0, 0.004, -0.05, 12, [0.8, 0.03, 1.5]);
      k.ball(0.13, WHITE, -0.17, 0.004, -0.12, 12, [1, 0.03, 0.75]);
      k.ball(0.13, WHITE, 0.17, 0.004, -0.12, 12, [1, 0.03, 0.75]);
      k.ball(0.09, WHITE, -0.1, 0.004, 0.2, 10, [0.7, 0.03, 1]);
      k.ball(0.09, WHITE, 0.1, 0.004, 0.2, 10, [0.7, 0.03, 1]);
      for (const [x, z] of [[-0.28, 0.1], [0.3, 0.02], [0.05, -0.38], [-0.2, -0.32], [0.25, -0.3]]) k.ball(0.012, '#FFF3B0', x, 0.01, z, 6);
      break;
    }
    case 'cocoa': {
      k.cyl(0.19, 0.22, s.scarf, 0, 0, 0, 20);
      k.cyl(0.198, 0.02, WHITE, 0, 0.2, 0, 20);
      k.cyl(0.172, 0.012, '#7A4A2A', 0, 0.214, 0, 20);
      for (const [x, z] of [[0.1, 0.08], [-0.11, 0.07], [0.06, -0.12], [-0.08, -0.1], [0.13, -0.03]]) k.cbox(0.045, 0.035, 0.045, WHITE, x, 0.228, z, [0, x * 9, 0]);
      // the handle
      k.cbox(0.03, 0.03, 0.08, s.scarf, 0.21, 0.17, 0, null);
      k.cbox(0.03, 0.03, 0.08, s.scarf, 0.21, 0.05, 0, null);
      k.cbox(0.03, 0.15, 0.03, s.scarf, 0.245, 0.11, 0, null);
      break;
    }
    case 'bath': {
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        k.ball(0.045 + (i % 3) * 0.012, i % 2 ? '#EAF6FF' : WHITE, Math.sin(a) * 0.17, 0.16 + (i % 2) * 0.03, Math.cos(a) * 0.17, 8);
      }
      break;
    }
    case 'snowman': {
      const x = 0.24, z = 0.05;
      k.ball(0.07, WHITE, x, 0.065, z, 12);
      k.ball(0.052, WHITE, x, 0.165, z, 12);
      k.ball(0.04, WHITE, x, 0.245, z, 10);
      k.cyl(0.012, 0.045, '#FF8F3C', x, 0.24, z + 0.04, 6, [Math.PI / 2, 0, 0], 0);
      k.ball(0.008, DARK, x - 0.015, 0.258, z + 0.035, 6);
      k.ball(0.008, DARK, x + 0.015, 0.258, z + 0.035, 6);
      k.cyl(0.046, 0.016, s.scarf, x, 0.2, z, 12);
      break;
    }
    case 'gift': {
      k.cbox(0.13, 0.12, 0.13, s.scarf, 0.22, 0.06, 0.1);
      k.cbox(0.135, 0.125, 0.025, s.brim, 0.22, 0.06, 0.1);
      k.cbox(0.025, 0.125, 0.135, s.brim, 0.22, 0.06, 0.1);
      k.ball(0.028, s.brim, 0.2, 0.135, 0.1, 8, [1.2, 0.7, 0.8]);
      k.ball(0.028, s.brim, 0.24, 0.135, 0.1, 8, [1.2, 0.7, 0.8]);
      break;
    }
    case 'book':
    case 'candy':
    case 'plane':
    default:
      break;
  }
}

/** What the waving arm holds for a scene. */
function holdOf(scene) {
  return scene === 'cookies' ? 'cookie' : scene === 'plane' ? 'plane' : scene === 'candy' ? 'candy' : scene === 'book' ? 'book' : '';
}

/** The pose for an elf's data (a scene brings its own). */
export function poseOf(data) {
  const sc = data && SCENES[data.scene];
  if (sc) return sc.pose;
  const p = data && data.pose;
  return POSES.includes(p) ? p : 'stand';
}

// ---------- the elf ----------

/**
 * The elf model. data: { sc, role, pose, scene, dy } (all optional). Returns a Group whose
 * userData.elf holds the moving parts for the animation (index.js).
 */
export function buildElf(idx, data = {}) {
  const d = data || {};
  const s = schemeOf(d, idx);
  const key = d.role === 'greet' ? 'g' : String(idx);
  const pose = poseOf(d);
  const scene = SCENES[d.scene] ? d.scene : '';
  const hold = holdOf(scene);
  const root = new THREE.Group();
  root.name = 'elf';
  const dy = Number.isFinite(d.dy) ? Math.max(-0.95, Math.min(0.05, d.dy)) : 0;
  // feet in the middle of the cell, lowered onto a low top
  const base = new THREE.Group();
  base.position.set(0.5, dy, 0.5);
  root.add(base);
  // the scene's props stay put; the elf itself bobs and hops (inner)
  if (scene) {
    const props = new THREE.Mesh(baked(`elf:scene:${key}:${scene}`, (k) => sceneParts(k, s, scene)), VC_MAT);
    base.add(props);
  }
  const inner = new THREE.Group();
  base.add(inner);
  const body = new THREE.Mesh(baked(`elf:body:${key}:${pose}`, (k) => bodyParts(k, s, pose)), VC_MAT);
  const head = new THREE.Group();
  const headMesh = new THREE.Mesh(baked(`elf:head:${key}`, (k) => headParts(k, s)), VC_MAT);
  head.add(headMesh);
  const arm = new THREE.Mesh(baked(`elf:arm:${key}:${hold}`, (k) => armParts(k, s, hold)), VC_MAT);
  const star = new THREE.Mesh(baked('elf:star', starParts), glowMat(s.star, 0.95));
  const tip = hatTip();
  star.position.set(tip.tx, tip.ty, tip.tz);
  star.scale.setScalar(0.9);
  head.add(star);
  const found = new THREE.Mesh(baked('elf:star', starParts), glowMat('#FFD84D', 1));
  found.scale.setScalar(1.3);
  found.visible = false;
  inner.add(body, head, arm, found);
  const low = pose === 'sit' ? -0.1 : 0;
  head.position.set(0, NECK_Y + low, 0);
  arm.position.set(-SHOULDER_X, SHOULDER_Y + low, 0);
  found.position.set(0, 1.0 + low, 0);
  let armRest = { x: 0, z: -0.42 };
  if (hold === 'cookie' || hold === 'book') armRest = { x: -1.2, z: -0.25 };
  if (hold === 'plane') armRest = { x: -0.4, z: -2.5 };
  if (hold === 'candy') armRest = { x: -0.9, z: -0.3 };
  if (pose === 'lie') {
    // a snow angel: on its back, arms out wide
    inner.rotation.x = -Math.PI / 2;
    inner.position.set(0, 0.14, 0.3);
    armRest = { x: 0, z: -1.5 };
  } else if (pose === 'cup') {
    inner.position.y = scene === 'cocoa' ? -0.035 : -0.12;
    armRest = { x: -0.5, z: -0.9 };
  }
  arm.rotation.set(armRest.x, 0, armRest.z);
  root.userData.elf = { base, inner, body, head, arm, star, found, armRest, pose, baseY: inner.position.y };
  return root;
}

// ---------- the Elf Door (a tiny door at the foot of a wall: an elf moves in) ----------

export const DOOR_COLORS = ['#FF8CC6', '#5ED6B4', '#A78BFA', '#FFC93C', '#6CC6FF', '#F25C5C'];

function doorParts(k, c) {
  const frame = darken(c, 0.3);
  // stepping stone and a doormat
  k.cbox(0.5, 0.02, 0.3, '#E8DDF5', 0.5, 0.01, 0.2);
  k.cbox(0.36, 0.022, 0.16, '#FF8CC6', 0.5, 0.02, 0.17);
  k.cbox(0.3, 0.024, 0.02, WHITE, 0.5, 0.024, 0.17);
  // frame and door with a round top
  k.cbox(0.42, 0.42, 0.05, frame, 0.5, 0.21, 0.025);
  k.cyl(0.21, 0.05, frame, 0.5, 0.42, 0.0, 20, [Math.PI / 2, 0, 0]);
  k.cbox(0.34, 0.38, 0.06, c, 0.5, 0.19, 0.03);
  k.cyl(0.17, 0.06, c, 0.5, 0.38, 0.0, 20, [Math.PI / 2, 0, 0]);
  // planks
  for (const x of [0.42, 0.5, 0.58]) k.cbox(0.008, 0.36, 0.062, darken(c, 0.12), x, 0.19, 0.031);
  // a round window and a gold knob
  k.cyl(0.05, 0.065, '#BFE6FF', 0.5, 0.41, 0.0, 14, [Math.PI / 2, 0, 0]);
  k.cbox(0.1, 0.01, 0.066, frame, 0.5, 0.41, 0.033);
  k.ball(0.022, '#FFD84D', 0.6, 0.2, 0.07, 8);
  // a tiny wreath with berries
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    k.ball(0.022, '#3FB894', 0.5 + Math.sin(a) * 0.055, 0.27 + Math.cos(a) * 0.055, 0.07, 6);
  }
  k.ball(0.014, '#F25C5C', 0.47, 0.22, 0.085, 6);
  k.ball(0.014, '#F25C5C', 0.53, 0.22, 0.085, 6);
  // a tiny lantern post beside the door
  k.cyl(0.012, 0.3, '#5C3A8E', 0.82, 0, 0.12, 6);
  k.cbox(0.07, 0.08, 0.07, '#5C3A8E', 0.82, 0.33, 0.12);
}

export function buildElfDoor(color) {
  const c = DOOR_COLORS.includes(color) ? color : DOOR_COLORS[0];
  const root = new THREE.Group();
  const m = new THREE.Mesh(baked(`elf:door:${c}`, (k) => doorParts(k, c)), VC_MAT);
  root.add(m);
  const glow = new THREE.Mesh(baked('elf:lamp', (k) => k.cbox(0.05, 0.06, 0.05, WHITE, 0, 0, 0)), glowMat('#FFE38A', 1));
  glow.position.set(0.82, 0.33, 0.12);
  root.add(glow);
  return root;
}

// ---------- the elves' cottage sign ----------

export const SIGN_COLORS = ['#D9A066', '#FF8CC6', '#5ED6B4', '#A78BFA'];

let signTex = null;
function signTexture() {
  if (signTex || typeof document === 'undefined') return signTex;
  signTex = canvasTexture(256, 128, (g, W, H) => {
    g.fillStyle = '#FFF8EC';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#E8475F';
    g.lineWidth = 10;
    g.strokeRect(8, 8, W - 16, H - 16);
    g.fillStyle = '#3A1F4D';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = "700 40px 'Fredoka', ui-rounded, 'Arial Rounded MT Bold', sans-serif";
    g.fillText('Twinkle', W / 2, H * 0.36);
    g.fillText('Elves', W / 2, H * 0.7);
    // little stars
    g.fillStyle = '#FFC93C';
    for (const [x, y] of [[30, 30], [W - 30, 30], [30, H - 30], [W - 30, H - 30]]) {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 4 : 10;
        g.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
    }
  });
  signTex.userData.shared = true;
  return signTex;
}

function signParts(k, c) {
  const wood = darken(c, 0.25);
  k.cyl(0.05, 1.5, wood, 0.5, 0, 0.5, 10);
  k.cyl(0.09, 0.08, darken(c, 0.4), 0.5, 0, 0.5, 10);
  // the board's frame (the painted face is a separate textured plane)
  k.cbox(0.82, 0.46, 0.06, c, 0.5, 1.12, 0.52);
  // two little chains / hooks
  k.cbox(0.02, 0.12, 0.02, '#9C8CB8', 0.25, 1.4, 0.52);
  k.cbox(0.02, 0.12, 0.02, '#9C8CB8', 0.75, 1.4, 0.52);
  k.cbox(0.62, 0.04, 0.06, wood, 0.5, 1.44, 0.52);
  // holly on the top corner
  k.ball(0.05, '#3FB894', 0.82, 1.38, 0.56, 8, [1.4, 0.6, 0.6]);
  k.ball(0.05, '#3FB894', 0.74, 1.4, 0.56, 8, [1.4, 0.6, 0.6]);
  k.ball(0.025, '#F25C5C', 0.79, 1.42, 0.6, 6);
}

export function buildElfSign(color) {
  const c = SIGN_COLORS.includes(color) ? color : SIGN_COLORS[0];
  const root = new THREE.Group();
  root.add(new THREE.Mesh(baked(`elf:sign:${c}`, (k) => signParts(k, c)), VC_MAT));
  const tex = signTexture();
  if (tex) {
    const face = new THREE.Mesh(new THREE.PlaneGeometry(0.74, 0.38), new THREE.MeshLambertMaterial({ map: tex }));
    face.position.set(0.5, 1.12, 0.552);
    root.add(face);
  }
  const star = new THREE.Mesh(baked('elf:star', starParts), glowMat('#FFE066', 1));
  star.position.set(0.5, 1.6, 0.5);
  star.scale.setScalar(1.6);
  root.add(star);
  return root;
}
