// Cars: the Bubble Car, the Convertible, the Safari Jeep and the Go-Kart (furniture Kit).
// Model space: block units, footprint [0,w] x [0,h] x [0,d], nose = +Z, driver on +X.
// build(color, data): data.live puts the wheels in spinning parts (see kit.js axles()).

import { Kit } from '../furniture/kit.js';
import { heart } from '../furniture/palette.js';
import { shade, mixHex } from '../../core/util.js';
import { WHITE, INK, CHROME, TIRE, GLASS, LAMP, TAIL, discX, discZ, axles, headlamp, steeringWheel, seat, bumper, digits, onEllipsoid } from './kit.js';

const live = (data) => !!(data && data.live);

/** A little paw print lying flat against a side wall (x = the wall face, s = size). */
function paw(k, x, y, z, s, color) {
  const f = { sx: 0.25 };
  k.ball(s * 0.42, color, x, y, z, f);
  for (const [dy, dz] of [[0.5, -0.42], [0.66, -0.14], [0.66, 0.14], [0.5, 0.42]]) k.ball(s * 0.18, color, x, y + dy * s, z + dz * s, f);
  return k;
}

/** A five-petal flower lying flat against a side wall at x. */
export function sideFlower(k, x, y, z, s, petal, center = '#FFE38F') {
  const f = { sx: 0.25 };
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    k.ball(s * 0.32, petal, x, y + Math.sin(a) * s * 0.42, z + Math.cos(a) * s * 0.42, f);
  }
  k.ball(s * 0.26, center, x, y, z, f);
  return k;
}

// ---------- Bubble Car [2,2,2]: an egg on wheels with big eye headlamps ----------

export function bubbleCar(color, data) {
  const k = new Kit();
  const L = live(data);
  const dark = shade(color, -0.18), light = mixHex(color, WHITE, 0.55);
  axles(k, L, [0.45, 1.55], 0.26, [0.04, 0.16], [1.8, 0.16]);
  // skirt and the egg
  k.box(1.56, 0.2, 1.62, dark, 0.22, 0.26, 0.19);
  const C = [1, 0.72, 1.0], R = [0.9, 0.42, 0.94];
  k.ball(1, color, C[0], C[1], C[2], { seg: 20, sx: R[0], sy: R[1], sz: R[2] });
  // a light band round the middle
  k.ball(1, light, C[0], C[1] - 0.06, C[2], { seg: 20, sx: R[0] + 0.015, sy: 0.05, sz: R[2] + 0.015 });
  // polka dots
  for (const [a, b] of [[0.9, 0.35], [1.4, -0.2], [2.0, 0.4], [-0.9, 0.35], [-1.4, -0.2], [-2.0, 0.4], [2.6, -0.1], [-2.6, -0.1], [3.14, 0.45]]) {
    const p = onEllipsoid(C, R, a, b);
    k.ball(0.075, WHITE, p[0], p[1], p[2], { seg: 10 });
  }
  // glass dome over her seat, a headrest and the wheel
  k.ball(0.62, GLASS(), 1, 1.02, 0.92, { seg: 20, sx: 1.18, sy: 0.92, sz: 1.08 });
  k.ball(0.15, WHITE, 1, 1.22, 0.56, { seg: 12, sz: 0.6 });
  steeringWheel(k, 1, 1.12, 1.38, 0.15, INK);
  // big round "eye" headlamps with lashes, a smiley grille
  for (const x of [0.6, 1.4]) {
    discZ(k, 0.18, 0.04, WHITE, x, 0.8, 1.78);
    discZ(k, 0.12, 0.03, LAMP(), x, 0.8, 1.82);
    for (let i = -1; i <= 1; i++) k.box(0.025, 0.12, 0.025, INK, x + i * 0.09 - 0.0125, 0.96, 1.79, { rot: [0, 0, -i * 0.5], pivot: [x + i * 0.09, 0.96, 1.8] });
  }
  k.pixels(['X.....X', '.X...X.', '..XXX..'], 0.05, { X: INK }, 1 - 0.175, 0.44, 1.78, { depth: 0.03 });
  bumper(k, 0.4, 1.6, 0.3, 1.84, CHROME, 0.09);
  bumper(k, 0.4, 1.6, 0.3, 0.06, CHROME, 0.09);
  for (const x of [0.55, 1.45]) discZ(k, 0.07, 0.03, TAIL(), x, 0.72, 0.13);
  // the flower antenna topper
  k.stick([1.55, 1.08, 0.5], [1.62, 1.84, 0.42], 0.025, WHITE);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    k.ball(0.06, '#FF8CC6', 1.62 + Math.cos(a) * 0.07, 1.86 + Math.sin(a) * 0.07, 0.42, { seg: 8, sz: 0.5 });
  }
  k.ball(0.05, '#FFE38F', 1.62, 1.86, 0.43, { seg: 8 });
  return k.build();
}

// ---------- Convertible [2,2,3]: open top, white tufted seats, a heart steering wheel ----------

export function convertible(color, data) {
  const k = new Kit();
  const L = live(data);
  const dark = shade(color, -0.2);
  axles(k, L, [0.62, 2.38], 0.28, [0.02, 0.2], [1.78, 0.2]);
  // body: lower tub, hood, trunk, cockpit sides, fenders over the wheels
  k.box(1.56, 0.4, 2.86, color, 0.22, 0.28, 0.07);
  k.box(1.56, 0.14, 0.98, color, 0.22, 0.68, 1.96);
  k.box(1.56, 0.16, 0.84, color, 0.22, 0.68, 0.07);
  for (const x of [0.22, 1.66]) k.box(0.12, 0.22, 1.05, color, x, 0.68, 0.91);
  for (const z of [0.62, 2.38]) for (const x of [0.06, 1.78]) k.box(0.16, 0.12, 0.78, dark, x, 0.56, z - 0.39);
  // a white side stripe and a dark rocker
  for (const x of [0.2, 1.78]) k.box(0.02, 0.06, 2.4, WHITE, x, 0.54, 0.3);
  // dashboard, windshield and the heart steering wheel
  k.box(1.36, 0.22, 0.12, INK, 0.32, 0.7, 1.84);
  k.box(1.46, 0.4, 0.03, GLASS(), 0.27, 0.86, 1.92, { rot: [-0.35, 0, 0], pivot: [0, 0.86, 1.94] });
  k.box(1.5, 0.04, 0.05, CHROME, 0.25, 0.84, 1.9);
  k.torus(0.15, 0.03, '#FF5FA2', 1.32, 0.95, 1.7, { rot: [-1.15, 0, 0] });
  heart(k, 0.12, '#FF5FA2', 1.26, 0.9, 1.69, 0.03);
  // two white tufted seats (pink buttons)
  seat(k, 0.98, 0.5, 1.0, 0.66, 0.5, WHITE, 0.46, '#FF9CCB');
  seat(k, 0.36, 0.5, 1.0, 0.66, 0.5, WHITE, 0.46, '#FF9CCB');
  // tail fins with heart tail lamps
  for (const x of [0.24, 1.68]) {
    k.box(0.08, 0.3, 0.6, color, x, 0.74, 0.08, { rot: [0.35, 0, 0], pivot: [x, 0.74, 0.68] });
    heart(k, 0.16, '#FF5F8F', x - 0.04, 0.62, 0.035, 0.03);
  }
  // chrome bumpers, grille and headlamps
  bumper(k, 0.18, 1.82, 0.3, 2.9, CHROME, 0.12);
  bumper(k, 0.18, 1.82, 0.3, 0.0, CHROME, 0.12);
  for (let i = 0; i < 5; i++) k.box(0.04, 0.16, 0.03, CHROME, 0.78 + i * 0.1, 0.44, 2.93);
  headlamp(k, 0.45, 0.62, 2.93, 0.11);
  headlamp(k, 1.55, 0.62, 2.93, 0.11);
  return k.build();
}

// ---------- Safari Jeep [2,2,3]: boxy, a roll bar, a surfboard, a spare tire ----------

export function jeep(color, data) {
  const k = new Kit();
  const L = live(data);
  const dark = shade(color, -0.22), sand = mixHex(color, WHITE, 0.5);
  axles(k, L, [0.62, 2.38], 0.34, [0.0, 0.24], [1.76, 0.24], { knobs: true, wall: sand });
  // body tub, hood, grille, fenders, side steps
  k.box(1.52, 0.6, 2.86, color, 0.24, 0.36, 0.07);
  k.box(1.52, 0.1, 0.96, color, 0.24, 0.96, 1.97);
  k.box(1.44, 0.4, 0.04, dark, 0.28, 0.48, 2.93);
  for (let i = 0; i < 6; i++) k.box(0.08, 0.3, 0.02, INK, 0.5 + i * 0.18, 0.53, 2.965);
  for (const z of [0.62, 2.38]) for (const x of [0.0, 1.76]) k.box(0.24, 0.07, 0.84, dark, x, 0.74, z - 0.42);
  for (const x of [0.06, 1.76]) k.box(0.18, 0.05, 1.0, INK, x, 0.36, 1.0);
  // seats, dash, upright windshield frame
  seat(k, 0.98, 0.62, 1.05, 0.62, 0.5, sand, 0.42);
  seat(k, 0.4, 0.62, 1.05, 0.62, 0.5, sand, 0.42);
  k.box(1.36, 0.16, 0.12, INK, 0.32, 0.96, 1.86);
  steeringWheel(k, 1.32, 1.12, 1.72, 0.15, INK);
  for (const x of [0.24, 1.72]) k.box(0.04, 0.5, 0.04, WHITE, x, 1.06, 1.92);
  k.box(1.52, 0.04, 0.04, WHITE, 0.24, 1.54, 1.92);
  k.box(1.44, 0.44, 0.03, GLASS(), 0.28, 1.08, 1.93);
  // roll bar with a roof rack and a striped surfboard
  for (const x of [0.28, 1.68]) {
    k.stick([x + 0.02, 0.96, 0.92], [x + 0.02, 1.62, 0.92], 0.06, WHITE);
    k.stick([x + 0.02, 1.62, 0.92], [x + 0.02, 1.62, 0.22], 0.05, WHITE);
  }
  k.box(1.46, 0.06, 0.06, WHITE, 0.27, 1.6, 0.89);
  k.box(1.46, 0.05, 0.05, WHITE, 0.27, 1.6, 0.2);
  // the board rides over the passenger side, so the chase camera sees the driver's head
  k.ball(1, '#FFF6EC', 0.55, 1.7, 0.95, { seg: 16, sx: 0.32, sy: 0.05, sz: 1.0 });
  for (const [z, c] of [[0.55, '#FF6FA8'], [0.95, '#6CC6FF'], [1.35, '#FFC94D']]) k.box(0.52, 0.02, 0.12, c, 0.29, 1.73, z);
  // the spare tire on the back, fog lamps, round headlamps
  discZ(k, 0.3, 0.12, TIRE, 1.0, 0.86, 0.0, 18);
  discZ(k, 0.18, 0.02, sand, 1.0, 0.86, -0.02, 14);
  discZ(k, 0.08, 0.03, color, 1.0, 0.86, -0.04, 10);
  bumper(k, 0.14, 1.86, 0.32, 2.92, INK, 0.12);
  bumper(k, 0.14, 1.86, 0.32, 0.0, INK, 0.12);
  for (const x of [0.58, 1.42]) k.box(0.14, 0.1, 0.06, LAMP(), x - 0.07, 0.34, 3.0 - 0.06);
  headlamp(k, 0.4, 0.86, 2.94, 0.12);
  headlamp(k, 1.6, 0.86, 2.94, 0.12);
  for (const x of [0.38, 1.62]) discZ(k, 0.07, 0.03, TAIL(), x, 0.8, 0.04);
  // pastel paw prints on both sides
  for (const [x, s] of [[0.235, -1], [1.765, 1]]) {
    paw(k, x + s * 0.01, 0.56, 0.6, 0.3, '#FFFFFF');
    paw(k, x + s * 0.01, 0.62, 2.2, 0.24, '#FFFFFF');
  }
  return k.build();
}

// ---------- Go-Kart [1,1,2]: low frame, fat tires, number 8, a checkered flag ----------

export function kart(color, data) {
  const k = new Kit();
  const L = live(data);
  const dark = shade(color, -0.2);
  // wheels: fat at the back, small at the front
  const rear = L ? k.part('axle0', 0, 0.2, 0.35) : k;
  const front = L ? k.part('axle1', 0, 0.15, 1.62) : k;
  const ry = L ? 0 : 0.2, rz = L ? 0 : 0.35, fy = L ? 0 : 0.15, fz = L ? 0 : 1.62;
  for (const [x0, s] of [[0.0, -1], [0.8, 1]]) {
    discX(rear, 0.2, 0.2, TIRE, x0, ry, rz, 18);
    discX(rear, 0.1, 0.02, WHITE, s > 0 ? x0 + 0.2 : x0 - 0.02, ry, rz, 12);
  }
  for (const [x0, s] of [[0.04, -1], [0.84, 1]]) {
    discX(front, 0.15, 0.12, TIRE, x0, fy, fz, 16);
    discX(front, 0.07, 0.02, WHITE, s > 0 ? x0 + 0.12 : x0 - 0.02, fy, fz, 10);
  }
  // frame, side pods, axle bars
  k.box(0.56, 0.07, 1.72, '#8E82A8', 0.22, 0.1, 0.16);
  for (const x of [0.14, 0.76]) k.box(0.1, 0.14, 0.8, color, x, 0.14, 0.62);
  k.box(0.6, 0.04, 0.04, '#8E82A8', 0.2, 0.18, 0.33);
  k.box(0.68, 0.04, 0.04, '#8E82A8', 0.16, 0.13, 1.6);
  // nose with the number 8, bumper
  k.box(0.64, 0.12, 0.38, color, 0.18, 0.14, 1.5, { rot: [0.25, 0, 0], pivot: [0.5, 0.2, 1.5] });
  k.box(0.46, 0.26, 0.05, WHITE, 0.27, 0.18, 1.9);
  digits(k, '8', 0.04, color, 0.44, 0.21, 1.95, 0.02);
  k.box(0.9, 0.06, 0.06, dark, 0.05, 0.08, 1.94);
  headlamp(k, 0.3, 0.36, 1.92, 0.05);
  headlamp(k, 0.7, 0.36, 1.92, 0.05);
  // bucket seat, steering wheel, the engine behind her
  seat(k, 0.28, 0.28, 0.56, 0.44, 0.4, INK, 0.36);
  k.box(0.04, 0.3, 0.04, '#8E82A8', 0.48, 0.18, 1.2, { rot: [0.5, 0, 0], pivot: [0.5, 0.18, 1.22] });
  steeringWheel(k, 0.5, 0.48, 1.12, 0.12, INK);
  k.box(0.34, 0.2, 0.24, '#8E82A8', 0.33, 0.14, 0.12);
  k.cyl(0.05, 0.16, CHROME, 0.68, 0.18, 0.18, 10, { rot: [Math.PI / 2, 0, 0] });
  // spoiler and the checkered flag on its whip pole
  for (const x of [0.2, 0.76]) k.box(0.04, 0.3, 0.04, dark, x, 0.3, 0.06);
  k.box(0.86, 0.05, 0.22, color, 0.07, 0.6, 0.0);
  k.stick([0.14, 0.62, 0.08], [0.14, 1.5, 0.08], 0.025, WHITE);
  k.pixels(['XOXOXO', 'OXOXOX', 'XOXOXO', 'OXOXOX'], 0.05, { X: INK, O: WHITE }, 0.155, 1.28, 0.07, { depth: 0.015 });
  return k.build();
}
