// Kitchen and bathroom models.

import { Kit } from './kit.js';
import { woodMat, fabricMat, tileMat, quiltMat, stripeMat, fluffyMat, glow, sheer, streamMat, paintingMat, material } from './paint.js';
import { C, SW, drawer, knob, heart, flower, legs, HEART_ROWS, STAR_ROWS, FLOWER_ROWS } from './palette.js';
import { shade, mixHex } from '../../core/util.js';

const COUNTER_TOP = '#FDF8FF';
const CHROME = C.chrome;

function cabinet(k, color, { top = COUNTER_TOP, door = true, drawerRow = true } = {}) {
  const wood = woodMat(color);
  k.box(0.9, 0.08, 0.76, shade(color, -0.25), 0.05, 0, 0.12);
  k.box(0.92, 0.76, 0.8, wood, 0.04, 0.08, 0.08);
  if (drawerRow) drawer(k, 0.09, 0.64, 0.82, 0.16, 0.88, color, C.gold, false);
  if (door) {
    k.box(0.82, 0.5, 0.03, shade(color, 0.08), 0.09, 0.11, 0.88);
    k.box(0.66, 0.36, 0.015, shade(color, -0.05), 0.17, 0.18, 0.91);
    knob(k, 0.8, 0.46, 0.91, C.gold, true);
  }
  if (top) k.box(1.0, 0.07, 0.92, top, 0, 0.84, 0.04);
}

/** Stove with four burners and a cute pot. */
export function stove(color = SW.appliance[0]) {
  const k = new Kit();
  k.box(0.92, 0.08, 0.76, shade(color, -0.25), 0.04, 0, 0.12);
  k.box(0.92, 0.78, 0.8, color, 0.04, 0.08, 0.08);
  k.box(0.96, 0.06, 0.86, shade(color, 0.3), 0.02, 0.86, 0.06);
  for (const [x, z] of [[0.28, 0.3], [0.72, 0.3], [0.28, 0.68], [0.72, 0.68]]) {
    k.cyl(0.13, 0.015, '#6A5F8E', x, 0.92, z, 14);
    k.cyl(0.08, 0.02, '#8A7FAE', x, 0.92, z, 12);
  }
  // pot with a lid
  k.cyl(0.15, 0.18, '#8FE0D0', 0.28, 0.94, 0.3, 14);
  k.cyl(0.16, 0.03, shade('#8FE0D0', 0.3), 0.28, 1.12, 0.3, 14);
  k.ball(0.035, C.rose, 0.28, 1.17, 0.3);
  k.box(0.08, 0.03, 0.04, '#8FE0D0', 0.43, 1.05, 0.28);
  heart(k, 0.12, '#FFFFFF', 0.22, 1.0, 0.45, 0.01);
  // control strip + knobs
  k.box(0.86, 0.12, 0.03, shade(color, -0.08), 0.07, 0.7, 0.88);
  ['#FF8FB8', '#FFE38F', '#9FD8FF', '#9BE8CF'].forEach((c, i) => k.cyl(0.035, 0.04, c, 0.2 + i * 0.2, 0.76, 0.91, 10, { rot: [Math.PI / 2, 0, 0] }));
  // oven door with window and a handle
  k.box(0.8, 0.5, 0.03, shade(color, 0.12), 0.1, 0.14, 0.88);
  k.box(0.56, 0.24, 0.02, '#5A4E7A', 0.22, 0.24, 0.91);
  k.box(0.2, 0.04, 0.02, '#8A7FAE', 0.26, 0.42, 0.915);
  k.box(0.6, 0.04, 0.05, CHROME, 0.2, 0.56, 0.93);
  k.box(0.9, 0.2, 0.05, shade(color, 0.2), 0.05, 0.92, 0.04);
  return k.build();
}

/** Oven with a glowing window and a cupcake baking inside. */
export function oven(color = SW.appliance[1]) {
  const k = new Kit();
  k.box(0.92, 0.08, 0.76, shade(color, -0.25), 0.04, 0, 0.12);
  k.box(0.92, 0.8, 0.8, color, 0.04, 0.08, 0.08);
  k.box(0.98, 0.06, 0.88, shade(color, 0.3), 0.01, 0.88, 0.05);
  // door: a frame around a big window so you can peek at the cupcake baking inside
  const door = shade(color, 0.12);
  k.box(0.82, 0.12, 0.04, door, 0.09, 0.12, 0.88);
  k.box(0.82, 0.16, 0.04, door, 0.09, 0.58, 0.88);
  k.box(0.12, 0.34, 0.04, door, 0.09, 0.24, 0.88);
  k.box(0.12, 0.34, 0.04, door, 0.79, 0.24, 0.88);
  k.box(0.58, 0.34, 0.01, sheer('#FFE9C8', 0.3), 0.21, 0.24, 0.9);
  k.box(0.6, 0.36, 0.3, glow('#FFB870', 0.5), 0.2, 0.23, 0.56, { faces: { pz: null } });
  k.box(0.56, 0.02, 0.2, '#C8C0D8', 0.22, 0.3, 0.64);
  k.pixels(['..X..', '.XXX.', 'XXXXX', '.OOO.', '.OOO.'], 0.05, { X: '#FFB8D6', O: '#E7BE8C' }, 0.375, 0.32, 0.68, { depth: 0.1 });
  k.ball(0.025, '#FF6F8F', 0.5, 0.58, 0.73);
  k.box(0.62, 0.04, 0.05, CHROME, 0.19, 0.66, 0.93);
  k.box(0.86, 0.1, 0.03, shade(color, -0.08), 0.07, 0.75, 0.88);
  ['#FF8FB8', '#FFE38F', '#9FD8FF'].forEach((c, i) => k.cyl(0.035, 0.04, c, 0.25 + i * 0.25, 0.8, 0.91, 10, { rot: [Math.PI / 2, 0, 0] }));
  heart(k, 0.1, '#FFFFFF', 0.45, 0.78, 0.915, 0.01);
  return k.build();
}

/** Retro fridge; doors (parts 'door', 'freezer') swing open. */
export function fridge(color = SW.appliance[2]) {
  const k = new Kit();
  k.box(0.9, 1.84, 0.78, color, 0.05, 0.06, 0.1);
  k.box(0.84, 0.06, 0.74, shade(color, 0.2), 0.08, 1.9, 0.12);
  k.box(0.92, 0.06, 0.8, shade(color, -0.2), 0.04, 0, 0.1);
  // inside
  k.box(0.8, 1.72, 0.02, '#FFFFFF', 0.1, 0.1, 0.14);
  for (const y of [0.45, 0.85, 1.28]) k.box(0.8, 0.02, 0.66, sheer('#E8F7FF', 0.7), 0.1, y, 0.16);
  k.cyl(0.07, 0.24, '#FFFFFF', 0.25, 0.47, 0.45, 10);
  k.cyl(0.03, 0.05, '#8FD0FF', 0.25, 0.71, 0.45, 8);
  for (let i = 0; i < 5; i++) k.ball(0.045, '#FF5F7A', 0.55 + (i % 3) * 0.08, 0.5 + Math.floor(i / 3) * 0.06, 0.5 + (i % 2) * 0.06);
  k.box(0.22, 0.14, 0.16, '#FFE38F', 0.55, 0.87, 0.4);
  k.box(0.22, 0.04, 0.16, '#FF9CCB', 0.55, 1.01, 0.4);
  k.cyl(0.06, 0.2, '#FFB870', 0.3, 0.87, 0.5, 10);
  // doors hinge on the right edge (x = 0.95)
  const door = k.part('door', 0.95, 0.08, 0.88);
  door.box(0.9, 1.14, 0.08, color, -0.9, 0, 0);
  door.box(0.05, 0.5, 0.06, CHROME, -0.84, 0.5, 0.08);
  door.pixels(HEART_ROWS, 0.03, { X: C.rose }, -0.55, 0.8, 0.08, { depth: 0.03 });
  door.pixels(STAR_ROWS, 0.03, { X: '#FFD95A' }, -0.3, 0.62, 0.08, { depth: 0.03 });
  door.pixels(FLOWER_ROWS, 0.035, { X: '#C8A6FF', O: '#FFF4B8' }, -0.62, 0.42, 0.08, { depth: 0.03 });
  door.box(0.26, 0.26, 0.01, paintingMat(0), -0.42, 0.2, 0.08, { faces: { px: null, nx: null, py: null, ny: null, nz: null } });
  door.box(0.06, 0.06, 0.02, C.rose, -0.32, 0.43, 0.085);
  const freezer = k.part('freezer', 0.95, 1.24, 0.88);
  freezer.box(0.9, 0.66, 0.08, color, -0.9, 0, 0);
  freezer.box(0.05, 0.3, 0.06, CHROME, -0.84, 0.05, 0.08);
  freezer.box(0.3, 0.1, 0.01, '#FFFFFF', -0.55, 0.4, 0.08);
  k.hitbox(0, 0, 0, 1, 1.96, 1);
  return k.build();
}

export function counter(color = SW.wood[1]) {
  const k = new Kit();
  cabinet(k, color);
  return k.build();
}

/** Kitchen sink; part 'water' shows a running stream. */
export function sinkKitchen(color = SW.wood[1]) {
  const k = new Kit();
  cabinet(k, color, { top: null, drawerRow: false });
  k.box(0.82, 0.12, 0.03, shade(color, 0.08), 0.09, 0.66, 0.88);
  // countertop around a basin
  k.box(1.0, 0.07, 0.22, COUNTER_TOP, 0, 0.84, 0.04);
  k.box(1.0, 0.07, 0.16, COUNTER_TOP, 0, 0.84, 0.8);
  k.box(0.16, 0.07, 0.54, COUNTER_TOP, 0, 0.84, 0.26);
  k.box(0.16, 0.07, 0.54, COUNTER_TOP, 0.84, 0.84, 0.26);
  k.box(0.68, 0.02, 0.54, '#C9D4E4', 0.16, 0.66, 0.26);
  k.box(0.68, 0.24, 0.02, '#DCE4F0', 0.16, 0.67, 0.26, { faces: { nz: null } });
  k.box(0.68, 0.24, 0.02, '#DCE4F0', 0.16, 0.67, 0.78, { faces: { pz: null } });
  k.box(0.02, 0.24, 0.52, '#DCE4F0', 0.16, 0.67, 0.27, { faces: { nx: null } });
  k.box(0.02, 0.24, 0.52, '#DCE4F0', 0.82, 0.67, 0.27, { faces: { px: null } });
  // faucet
  k.cyl(0.035, 0.34, CHROME, 0.5, 0.91, 0.14, 8);
  k.box(0.06, 0.06, 0.24, CHROME, 0.47, 1.22, 0.12);
  k.box(0.05, 0.08, 0.05, CHROME, 0.475, 1.15, 0.31);
  k.cyl(0.04, 0.05, '#FF8FB8', 0.3, 0.91, 0.14, 10);
  k.cyl(0.04, 0.05, '#8FD0FF', 0.7, 0.91, 0.14, 10);
  k.box(0.14, 0.08, 0.08, '#FFE38F', 0.72, 0.91, 0.84);
  const water = k.part('water', 0.5, 1.15, 0.335, { visible: false });
  water.cyl(0.025, 0.47, streamMat(), 0, -0.47, 0, 6);
  water.cyl(0.12, 0.02, sheer('#BDEBFF', 0.7), 0, -0.47, 0, 12);
  return k.build();
}

export function tableRound(color = SW.wood[0]) {
  const k = new Kit();
  const wood = woodMat(color);
  k.cyl(0.26, 0.05, shade(color, -0.12), 0.5, 0, 0.5, 16);
  k.cyl(0.07, 0.7, wood, 0.5, 0.04, 0.5, 10);
  k.cyl(0.47, 0.07, wood, 0.5, 0.73, 0.5, 20);
  k.cyl(0.44, 0.02, shade(color, 0.2), 0.5, 0.8, 0.5, 20);
  k.cyl(0.24, 0.012, '#FFFFFF', 0.5, 0.815, 0.5, 16);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.cyl(0.04, 0.012, '#FFFFFF', 0.5 + Math.cos(a) * 0.24, 0.815, 0.5 + Math.sin(a) * 0.24, 8);
  }
  return k.build();
}

/** Long table with a gingham tablecloth. */
export function tableLong(color = SW.bedding[0]) {
  const k = new Kit();
  const wood = woodMat(C.wood);
  legs(k, 0.05, 0.05, 1.9, 0.9, 0.76, wood, 0.09, 0.05);
  k.box(1.9, 0.05, 0.9, wood, 0.05, 0.74, 0.05);
  const cloth = quiltMat(color, 'gingham');
  k.box(2.0, 0.03, 1.0, cloth, 0, 0.79, 0);
  k.box(2.0, 0.18, 0.02, cloth, 0, 0.62, 0);
  k.box(2.0, 0.18, 0.02, cloth, 0, 0.62, 0.98);
  k.box(0.02, 0.18, 0.96, cloth, 0, 0.62, 0.02);
  k.box(0.02, 0.18, 0.96, cloth, 1.98, 0.62, 0.02);
  for (let i = 0; i < 10; i++) {
    k.box(0.12, 0.04, 0.02, '#FFFFFF', 0.04 + i * 0.2, 0.6, 1.0);
    k.box(0.12, 0.04, 0.02, '#FFFFFF', 0.04 + i * 0.2, 0.6, -0.02);
  }
  return k.build();
}

/** Chair with a heart-shaped back. */
export function chair(color = SW.fabric[0]) {
  const k = new Kit();
  const woodCol = mixHex(color, '#FFFFFF', 0.55);
  const wood = woodMat(woodCol);
  legs(k, 0.15, 0.15, 0.7, 0.7, 0.45, wood, 0.08, 0.02);
  k.box(0.7, 0.07, 0.7, wood, 0.15, 0.43, 0.15);
  k.box(0.62, 0.07, 0.6, fabricMat(color), 0.19, 0.5, 0.2);
  k.box(0.56, 0.02, 0.54, shade(color, 0.15), 0.22, 0.57, 0.23);
  k.box(0.08, 0.36, 0.08, wood, 0.17, 0.5, 0.15);
  k.box(0.08, 0.36, 0.08, wood, 0.75, 0.5, 0.15);
  const rows = ['.XX.XX.', 'XXXXXXX', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'];
  k.pixels(rows, 0.1, { X: wood }, 0.15, 0.62, 0.16, { depth: 0.06 });
  k.pixels(['XX.XX', 'XXXXX', '.XXX.', '..X..'], 0.07, { X: color }, 0.325, 0.78, 0.22, { depth: 0.02 });
  return k.build();
}

export function stool(color = SW.fabric[3]) {
  const k = new Kit();
  const wood = woodMat(C.wood);
  for (const [x, z, rx, rz] of [[0.22, 0.22, -0.12, 0.12], [0.7, 0.22, -0.12, -0.12], [0.22, 0.7, 0.12, 0.12], [0.7, 0.7, 0.12, -0.12]]) {
    k.box(0.07, 0.58, 0.07, wood, x, 0, z, { rot: [rx, 0, rz], pivot: [x + 0.035, 0.58, z + 0.035] });
  }
  k.torus(0.24, 0.02, C.gold, 0.5, 0.22, 0.5);
  k.cyl(0.28, 0.06, wood, 0.5, 0.54, 0.5, 16);
  k.cyl(0.25, 0.07, fabricMat(color), 0.5, 0.6, 0.5, 16);
  k.cyl(0.2, 0.01, shade(color, 0.3), 0.5, 0.67, 0.5, 16);
  return k.build();
}

/** A two-tier cake on a stand (stands on tables). */
export function cakeStand(color = SW.bedding[0]) {
  const k = new Kit();
  k.cyl(0.12, 0.03, '#FFFFFF', 0.5, 0, 0.5, 14);
  k.cyl(0.03, 0.14, '#FFFFFF', 0.5, 0.03, 0.5, 8);
  k.cyl(0.28, 0.03, '#FFFFFF', 0.5, 0.16, 0.5, 20);
  k.cyl(0.21, 0.15, shade(color, 0.2), 0.5, 0.19, 0.5, 18);
  k.cyl(0.215, 0.03, '#FFFFFF', 0.5, 0.31, 0.5, 18);
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    k.box(0.04, 0.05 + (i % 3) * 0.02, 0.04, '#FFFFFF', 0.48 + Math.cos(a) * 0.205, 0.26 - (i % 3) * 0.02, 0.48 + Math.sin(a) * 0.205);
  }
  k.cyl(0.14, 0.12, color, 0.5, 0.34, 0.5, 16);
  k.cyl(0.145, 0.025, '#FFFFFF', 0.5, 0.44, 0.5, 16);
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    k.ball(0.02, '#FFFFFF', 0.5 + Math.cos(a) * 0.12, 0.47, 0.5 + Math.sin(a) * 0.12);
  }
  k.ball(0.05, '#FF4F6F', 0.5, 0.52, 0.5);
  k.box(0.01, 0.06, 0.01, C.leafDark, 0.5, 0.55, 0.5);
  return k.build();
}

export function fruitBowl(color = SW.bright[1]) {
  const k = new Kit();
  k.cone(0.12, 0.26, 0.14, color, 0.5, 0, 0.5, 16);
  k.cyl(0.262, 0.02, shade(color, 0.3), 0.5, 0.13, 0.5, 16);
  k.ball(0.09, '#FF5F7A', 0.4, 0.2, 0.46);
  k.box(0.02, 0.05, 0.02, C.woodDark, 0.4, 0.28, 0.46);
  k.box(0.05, 0.02, 0.03, C.leaf, 0.41, 0.3, 0.46);
  k.ball(0.085, '#FFA54F', 0.6, 0.19, 0.44);
  k.ball(0.08, '#B6E36A', 0.52, 0.19, 0.6);
  for (let i = 0; i < 7; i++) k.ball(0.035, '#B07BE0', 0.33 + (i % 3) * 0.05, 0.2 + Math.floor(i / 3) * 0.04, 0.6 + (i % 2) * 0.03);
  k.box(0.26, 0.05, 0.06, '#FFE36B', 0.44, 0.26, 0.38, { rot: [0, 0.4, 0.35] });
  return k.build();
}

// ---------- bathroom ----------

/** Claw-foot bathtub with bubbles and a rubber duck. */
export function bathtub(color = SW.bright[0]) {
  const k = new Kit();
  const inner = '#FFFFFF';
  for (const [x, z] of [[0.08, 0.1], [0.8, 0.1], [0.08, 1.78], [0.8, 1.78]]) {
    k.box(0.12, 0.14, 0.12, C.gold, x, 0, z);
  }
  k.box(0.9, 0.08, 1.86, inner, 0.05, 0.12, 0.07);
  k.box(0.9, 0.5, 0.07, color, 0.05, 0.12, 0.05, { faces: { pz: inner } });
  k.box(0.9, 0.5, 0.07, color, 0.05, 0.12, 1.88, { faces: { nz: inner } });
  k.box(0.07, 0.5, 1.9, color, 0.05, 0.12, 0.05, { faces: { px: inner } });
  k.box(0.07, 0.5, 1.9, color, 0.88, 0.12, 0.05, { faces: { nx: inner } });
  k.box(0.98, 0.05, 0.1, '#FFFFFF', 0.01, 0.62, 0.02);
  k.box(0.98, 0.05, 0.1, '#FFFFFF', 0.01, 0.62, 1.88);
  k.box(0.1, 0.05, 1.96, '#FFFFFF', 0.01, 0.62, 0.02);
  k.box(0.1, 0.05, 1.96, '#FFFFFF', 0.89, 0.62, 0.02);
  // bubbly water
  k.box(0.76, 0.02, 1.76, sheer('#BDEBFF', 0.75), 0.12, 0.46, 0.12);
  const foam = [[0.3, 0.5, 0.4, 0.1], [0.5, 0.52, 0.3, 0.12], [0.7, 0.5, 0.5, 0.1], [0.25, 0.5, 1.5, 0.11], [0.68, 0.51, 1.6, 0.12], [0.45, 0.5, 1.72, 0.09], [0.72, 0.5, 0.9, 0.08], [0.2, 0.5, 1.0, 0.08]];
  for (const [x, y, z, r] of foam) k.ball(r, '#FFFFFF', x, y, z, { sy: 0.7 });
  // duck
  k.ball(0.07, '#FFE36B', 0.5, 0.52, 1.25, { sz: 1.3 });
  k.ball(0.05, '#FFE36B', 0.5, 0.61, 1.3);
  k.box(0.05, 0.02, 0.05, '#FF9E4F', 0.475, 0.6, 1.34);
  k.box(0.012, 0.012, 0.01, C.ink, 0.47, 0.63, 1.34);
  k.box(0.012, 0.012, 0.01, C.ink, 0.52, 0.63, 1.34);
  // faucet at the head end
  k.cyl(0.03, 0.3, CHROME, 0.5, 0.55, 0.06, 8);
  k.box(0.05, 0.05, 0.16, CHROME, 0.475, 0.82, 0.06);
  k.ball(0.04, '#FF8FB8', 0.38, 0.72, 0.08);
  k.ball(0.04, '#8FD0FF', 0.62, 0.72, 0.08);
  heart(k, 0.2, '#FFFFFF', 0.4, 0.3, 1.955, 0.02);
  return k.build();
}

/** Shower stall; part 'rain' is the running water. */
export function shower(color = SW.bright[1]) {
  const k = new Kit();
  const tiles = tileMat(mixHex(color, '#FFFFFF', 0.35));
  k.box(1.0, 0.08, 1.0, tileMat('#FFFFFF', '#E6E0F0'), 0, 0, 0);
  k.box(0.96, 1.84, 0.06, tiles, 0.02, 0.08, 0.02);
  const glass = sheer('#DFF4FF', 0.35);
  for (const x of [0.02, 0.94]) {
    k.box(0.04, 1.78, 0.9, glass, x, 0.08, 0.08);
    k.box(0.05, 0.05, 0.92, CHROME, x - 0.005, 1.86, 0.08);
    k.box(0.05, 1.8, 0.05, CHROME, x - 0.005, 0.08, 0.95);
  }
  k.box(0.96, 0.05, 0.05, CHROME, 0.02, 1.86, 0.95);
  // shower head + pipe + knobs
  k.cyl(0.025, 0.3, CHROME, 0.5, 1.45, 0.08, 8);
  k.box(0.05, 0.05, 0.28, CHROME, 0.475, 1.75, 0.08);
  k.cyl(0.13, 0.05, CHROME, 0.5, 1.68, 0.4, 14);
  k.cyl(0.1, 0.01, '#B8C4D8', 0.5, 1.675, 0.4, 14);
  k.ball(0.05, '#FF8FB8', 0.4, 1.1, 0.1);
  k.ball(0.05, '#8FD0FF', 0.6, 1.1, 0.1);
  // shelf with bottles and a duck
  k.box(0.3, 0.03, 0.14, CHROME, 0.62, 0.8, 0.08);
  k.cyl(0.035, 0.14, '#FF8FB8', 0.68, 0.83, 0.15, 8);
  k.cyl(0.035, 0.11, '#9BE8CF', 0.78, 0.83, 0.15, 8);
  k.ball(0.05, '#FFE36B', 0.2, 0.13, 0.7);
  k.ball(0.035, '#FFE36B', 0.2, 0.2, 0.74);
  const rain = k.part('rain', 0.5, 1.66, 0.4, { visible: false });
  const stream = streamMat();
  for (let i = 0; i < 9; i++) {
    const a = (i / 9) * Math.PI * 2;
    const r = i === 0 ? 0 : 0.08 + (i % 2) * 0.03;
    rain.cyl(0.022, 1.56, stream, Math.cos(a) * r, -1.56, Math.sin(a) * r, 5);
  }
  rain.cone(0.3, 0.12, 1.56, sheer('#CDEFFF', 0.28), 0, -1.56, 0, 16, { open: true });
  rain.cyl(0.3, 0.012, sheer('#BDEBFF', 0.6), 0, -1.56, 0, 16);
  k.hitbox(0, 0, 0, 1, 1.95, 1);
  return k.build();
}

/** A tidy little toilet with a heart handle. */
export function toilet(color = SW.bright[0]) {
  const k = new Kit();
  k.box(0.34, 0.24, 0.3, '#FFFFFF', 0.33, 0, 0.35);
  k.cyl(0.24, 0.2, '#FFFFFF', 0.5, 0.22, 0.56, 16);
  k.cyl(0.2, 0.02, '#D8F0FF', 0.5, 0.41, 0.56, 16);
  k.torus(0.2, 0.045, color, 0.5, 0.44, 0.57);
  // lid standing up against the tank
  k.box(0.44, 0.44, 0.05, color, 0.28, 0.47, 0.3, { rot: [-0.12, 0, 0] });
  heart(k, 0.18, '#FFFFFF', 0.41, 0.6, 0.35, 0.01);
  k.box(0.56, 0.42, 0.2, '#FFFFFF', 0.22, 0.44, 0.08);
  k.box(0.6, 0.05, 0.24, color, 0.2, 0.86, 0.06);
  k.pixels(['X.X', 'XXX', '.X.'], 0.035, { X: C.gold }, 0.66, 0.76, 0.28, { depth: 0.03 });
  return k.build();
}

/** Pedestal bathroom sink; part 'water'. */
export function sinkBath(color = SW.bright[2]) {
  const k = new Kit();
  k.cyl(0.14, 0.04, '#FFFFFF', 0.5, 0, 0.45, 12);
  k.cyl(0.09, 0.62, '#FFFFFF', 0.5, 0.02, 0.45, 12);
  k.box(0.66, 0.06, 0.52, '#FFFFFF', 0.17, 0.62, 0.2);
  k.box(0.66, 0.16, 0.04, '#FFFFFF', 0.17, 0.68, 0.2);
  k.box(0.66, 0.16, 0.04, '#FFFFFF', 0.17, 0.68, 0.68);
  k.box(0.04, 0.16, 0.44, '#FFFFFF', 0.17, 0.68, 0.24);
  k.box(0.04, 0.16, 0.44, '#FFFFFF', 0.79, 0.68, 0.24);
  k.box(0.58, 0.02, 0.44, '#D8F0FF', 0.21, 0.68, 0.24);
  k.box(0.7, 0.03, 0.56, color, 0.15, 0.84, 0.18, { faces: { py: null } });
  k.box(0.7, 0.03, 0.06, color, 0.15, 0.84, 0.18);
  k.box(0.7, 0.03, 0.06, color, 0.15, 0.84, 0.68);
  k.box(0.7, 0.2, 0.06, '#FFFFFF', 0.15, 0.84, 0.12);
  k.cyl(0.03, 0.2, CHROME, 0.5, 0.86, 0.2, 8);
  k.box(0.05, 0.05, 0.16, CHROME, 0.475, 1.02, 0.2);
  k.ball(0.035, '#FF8FB8', 0.36, 0.9, 0.2);
  k.ball(0.035, '#8FD0FF', 0.64, 0.9, 0.2);
  k.cyl(0.045, 0.1, color, 0.26, 1.04, 0.16, 8);
  k.box(0.015, 0.12, 0.015, '#FF8FB8', 0.25, 1.1, 0.15);
  k.box(0.015, 0.12, 0.015, '#9BE8CF', 0.27, 1.1, 0.17);
  k.box(0.1, 0.05, 0.07, '#FFB8D6', 0.68, 1.04, 0.14);
  const water = k.part('water', 0.5, 1.02, 0.35, { visible: false });
  water.cyl(0.02, 0.32, streamMat(), 0, -0.32, 0, 6);
  return k.build();
}

/** Towel rack for the wall with two soft striped towels. */
export function towelRack(color = SW.bedding[0]) {
  const k = new Kit();
  for (const x of [0.08, 0.86]) k.box(0.06, 0.1, 0.14, CHROME, x, 0.7, 0);
  k.cyl(0.022, 0.84, CHROME, 0.08, 0.76, 0.12, 8, { rot: [0, 0, -Math.PI / 2] });
  const towel = (x, w, c, c2) => {
    const m = stripeMat(c, c2);
    k.box(w, 0.5, 0.03, m, x, 0.3, 0.14);
    k.box(w, 0.3, 0.03, m, x, 0.5, 0.07);
    k.box(w, 0.05, 0.1, m, x, 0.77, 0.07);
    k.box(w, 0.04, 0.035, shade(c, 0.4), x, 0.3, 0.14);
  };
  towel(0.14, 0.36, color, '#FFFFFF');
  towel(0.53, 0.33, mixHex(color, '#A6D8FF', 0.6), '#FFFFFF');
  heart(k, 0.1, '#FFFFFF', 0.27, 0.4, 0.175, 0.01);
  return k.build();
}

/** Fluffy cloud-shaped bath mat (flat). */
export function bathMat(color = SW.bedding[2]) {
  const k = new Kit();
  const rows = ['..XXX.....', '.XXXXX.XX.', 'XXXXXXXXXX', 'XXXXXXXXXX', '.XXXXXXXX.', '..XX..XX..'];
  const px = 0.094;
  k.pixels(rows, px, { X: fluffyMat(color) }, 0.03, 0, 0.22, { plane: 'xz', depth: 0.04 });
  k.pixels(['.XX.XX.', 'XXXXXXX', '.XXXXX.', '..XXX..', '...X...'], 0.05, { X: shade(color, 0.6) }, 0.32, 0.04, 0.34, { plane: 'xz', depth: 0.01 });
  return k.build();
}

export { flower };
