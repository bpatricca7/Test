// Shop furniture models (furniture Kit: static parts merge into the world's furniture batches).
// Model space: block units, footprint [0,w] x [0,h] x [0,d], front (where she shops) = +Z.
//
//   candyShop(color)      3x3x2 striped-awning stall, glass candy jars, lollipop sign
//   iceCreamParlor(color) 3x3x2 glass freezer with tubs, menu board, big cone sign
//   iceCreamTruck(color)  3x3x2 pastel truck with a serving window and a cone on the roof

import { Kit } from '../furniture/kit.js';
import { material, paintTexture, sheer, glow } from '../furniture/paint.js';
import { heart, STAR_ROWS } from '../furniture/palette.js';
import { shade, mixHex } from '../../core/util.js';

export const SHOP_COLORS = ['#FF9CCB', '#C8B4FF', '#9BE8CF', '#A6D8FF', '#FFE38F', '#FFBFA0'];
export const TRUCK_COLORS = ['#A6D8FF', '#FF9CCB', '#9BE8CF', '#C8B4FF', '#FFE38F', '#FFBFA0'];

const WHITE = '#FFFFFF', CREAM = '#FFF6EC', INK = '#3A1F4D';
const CANDY_COLS = ['#FF5A7A', '#FFD93D', '#6BD968', '#5BB8FF', '#A77BFF', '#FF8FD0', '#FF9F43', '#FFFFFF'];
const FONT = "'Fredoka', ui-rounded, 'Arial Rounded MT Bold', 'Trebuchet MS', system-ui, sans-serif";

function rnd(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}

/** A sign board picture: white board, bubbly outlined words. parts = [[text, color], ...] */
function signMat(key, words, { w = 512, h = 128, gap = 0 } = {}) {
  const k = `shops-sign|${key}`;
  return material(k, {
    map: paintTexture(k, w, h, (ctx) => {
      const r = h * 0.3;
      ctx.fillStyle = '#FFFDF8';
      ctx.beginPath();
      ctx.roundRect ? ctx.roundRect(2, 2, w - 4, h - 4, r) : ctx.rect(2, 2, w - 4, h - 4);
      ctx.fill();
      // little dots round the edge
      ctx.fillStyle = '#FFD1E6';
      for (let x = 22; x < w - 12; x += 36) {
        ctx.beginPath(); ctx.arc(x, 12, 5, 0, Math.PI * 2); ctx.fill();
        ctx.beginPath(); ctx.arc(x, h - 12, 5, 0, Math.PI * 2); ctx.fill();
      }
      ctx.font = `700 ${Math.round(h * 0.62)}px ${FONT}`;
      ctx.textBaseline = 'middle';
      ctx.lineJoin = 'round';
      const widths = words.map(([t]) => ctx.measureText(t).width);
      const total = widths.reduce((a, b) => a + b, 0) + gap * (words.length - 1);
      const scale = Math.min(1, (w * 0.86) / total);
      ctx.save();
      ctx.translate(w / 2, h / 2 + h * 0.04);
      ctx.scale(scale, 1);
      let x = -total / 2;
      words.forEach(([t, col], i) => {
        ctx.lineWidth = h * 0.12;
        ctx.strokeStyle = shade(col, -0.25);
        ctx.strokeText(t, x, h * 0.03);
        ctx.fillStyle = col;
        ctx.fillText(t, x, 0);
        ctx.fillStyle = 'rgba(255,255,255,0.55)';
        ctx.fillRect(x + 4, -h * 0.2, Math.max(0, widths[i] - 8), h * 0.05);
        x += widths[i] + gap;
      });
      ctx.restore();
    }, { repeat: false, smooth: true }),
    uvFit: true,
  });
}

/** The ice cream menu board: little pictures of treats on a chalk-pastel board. */
function menuMat() {
  const k = 'shops-menu';
  return material(k, {
    map: paintTexture(k, 256, 128, (ctx, w, h) => {
      ctx.fillStyle = '#FFF8FC';
      ctx.fillRect(0, 0, w, h);
      ctx.fillStyle = '#FFD1E6';
      ctx.fillRect(0, 0, w, 20);
      ctx.fillStyle = '#FF5FA2';
      ctx.font = `700 16px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('MENU', w / 2, 11);
      const cone = (x, y, c1, c2) => {
        ctx.fillStyle = '#E9B26C';
        ctx.beginPath(); ctx.moveTo(x - 12, y); ctx.lineTo(x + 12, y); ctx.lineTo(x, y + 34); ctx.closePath(); ctx.fill();
        ctx.fillStyle = c1; ctx.beginPath(); ctx.arc(x, y - 6, 14, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = c2; ctx.beginPath(); ctx.arc(x, y - 24, 12, 0, Math.PI * 2); ctx.fill();
        ctx.fillStyle = '#E8203F'; ctx.beginPath(); ctx.arc(x, y - 38, 5, 0, Math.PI * 2); ctx.fill();
      };
      const cup = (x, y, c1) => {
        ctx.fillStyle = '#FF9CCB'; ctx.fillRect(x - 14, y + 6, 28, 22);
        ctx.fillStyle = c1; ctx.beginPath(); ctx.arc(x, y + 4, 15, Math.PI, 0); ctx.fill();
      };
      const shake = (x, y, c1) => {
        ctx.fillStyle = c1; ctx.fillRect(x - 11, y - 8, 22, 38);
        ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(x, y - 10, 12, Math.PI, 0); ctx.fill();
        ctx.strokeStyle = '#FF5FA2'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x + 4, y - 14); ctx.lineTo(x + 12, y - 34); ctx.stroke();
      };
      cone(38, 72, '#FFB3C7', '#BDF2DA');
      cup(98, 70, '#DCC8FF');
      shake(158, 72, '#8B5A3C');
      cone(218, 72, '#FFC94D', '#A9B2FF');
      ctx.fillStyle = '#C8B4FF';
      for (let i = 0; i < 4; i++) { ctx.beginPath(); ctx.arc(38 + i * 60, 118, 4, 0, Math.PI * 2); ctx.fill(); }
    }, { repeat: false, smooth: true }),
    uvFit: true,
  });
}

// ---------- shared bits ----------

/** A standing disc facing +Z (base at z): lollipop heads, polka dots, wheels. */
function discZ(k, r, t, paint, x, y, z, seg = 20) {
  return k.cyl(r, t, paint, x, y, z, seg, { rot: [Math.PI / 2, 0, 0] });
}

/** A lollipop swirl on a stick, facing +Z. */
function lollipopSign(k, x, y, z, r, color, stickLen = 0.5) {
  k.box(0.06, stickLen, 0.06, WHITE, x - 0.03, y - r - stickLen + 0.05, z - 0.03);
  discZ(k, r, 0.1, color, x, y, z - 0.05);
  const n = 34;
  for (let i = 3; i < n; i++) {
    const u = i / n, a = u * Math.PI * 5, rr = u * r * 0.92;
    k.box(0.055, 0.055, 0.12, WHITE, x + Math.cos(a) * rr - 0.0275, y + Math.sin(a) * rr - 0.0275, z - 0.06, { rot: [0, 0, a] });
  }
}

/** A striped awning sloping down toward the front, with scallops along the front edge. */
function awning(k, color, { x0 = 0, x1 = 3, zBack = 0.16, zFront = 2, yBack = 2.3, yFront = 2.02, stripes = 6 } = {}) {
  const len = Math.hypot(zFront - zBack, yBack - yFront);
  const ang = Math.atan2(yBack - yFront, zFront - zBack);
  const sw = (x1 - x0) / stripes;
  for (let i = 0; i < stripes; i++) {
    k.box(sw, 0.07, len, i % 2 ? WHITE : color, x0 + i * sw, yBack - 0.035, zBack, { rot: [ang, 0, 0], pivot: [x0 + i * sw, yBack, zBack] });
  }
  // scallops: half discs hanging from the front edge
  const n = stripes * 2;
  const s = (x1 - x0) / n;
  for (let i = 0; i < n; i++) {
    const c = Math.floor(i / 2) % 2 ? WHITE : color;
    discZ(k, s * 0.5, 0.05, c, x0 + s * (i + 0.5), yFront - 0.04, zFront - 0.05, 12);
  }
  k.box(x1 - x0, 0.1, 0.06, shade(color, -0.08), x0, yFront - 0.06, zFront - 0.06);
}

/** A candy-cane striped post (square), bottom at y0. */
function candyPost(k, color, x, z, y0, h, t = 0.16) {
  const n = Math.round(h / 0.18);
  const step = h / n;
  for (let i = 0; i < n; i++) k.box(t, step, t, i % 2 ? WHITE : color, x - t / 2, y0 + i * step, z - t / 2);
  k.ball(t * 0.7, color, x, y0 + h + 0.05, z, { seg: 12 });
}

/** A glass jar (lid in `lid` color) full of candy balls. */
function candyJar(k, x, z, y, lid, seed = 1, { r = 0.16, h = 0.32, kind = 'balls' } = {}) {
  const R = rnd(seed);
  if (kind === 'balls') {
    for (let i = 0; i < 26; i++) {
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * (r - 0.05);
      k.ball(0.045, CANDY_COLS[i % CANDY_COLS.length], x + Math.cos(a) * d, y + 0.05 + R() * (h - 0.12), z + Math.sin(a) * d, { seg: 8 });
    }
  } else if (kind === 'canes') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2, px = x + Math.cos(a) * 0.06, pz = z + Math.sin(a) * 0.06;
      for (let j = 0; j < 6; j++) k.box(0.04, 0.06, 0.04, j % 2 ? WHITE : '#FF3B5C', px - 0.02, y + 0.02 + j * 0.06, pz - 0.02);
      k.box(0.1, 0.04, 0.04, i % 2 ? WHITE : '#FF3B5C', px - 0.1, y + 0.38, pz - 0.02);
    }
  } else {
    // wrapped sweets
    for (let i = 0; i < 18; i++) {
      const a = R() * Math.PI * 2, d = Math.sqrt(R()) * (r - 0.06);
      const px = x + Math.cos(a) * d, py = y + 0.04 + R() * (h - 0.12), pz = z + Math.sin(a) * d;
      const c = CANDY_COLS[i % 6];
      k.box(0.07, 0.045, 0.045, c, px - 0.035, py, pz - 0.022, { rot: [0, R() * 3, 0] });
    }
  }
  k.cyl(r, h, sheer('#E4F6FF', 0.3), x, y, z, 18);
  k.cyl(r + 0.015, 0.05, lid, x, y + h, z, 18);
  k.cyl(r * 0.5, 0.03, shade(lid, 0.15), x, y + h + 0.05, z, 14);
  k.ball(0.04, WHITE, x, y + h + 0.1, z, { seg: 10 });
}

/** Big sprinkly lollipops standing in a little pot (display on the counter). */
function lollipopPot(k, x, z, y) {
  k.cyl(0.13, 0.14, '#FFFFFF', x, y, z, 16);
  k.cyl(0.14, 0.03, '#FF9CCB', x, y + 0.12, z, 16);
  const heads = [['#FF5A7A', -0.07, 0.42, 0.02], ['#FFD93D', 0.07, 0.46, -0.02], ['#5BB8FF', 0, 0.52, -0.05], ['#A77BFF', -0.02, 0.38, 0.07], ['#6BD968', 0.09, 0.36, 0.06]];
  for (const [c, dx, hy, dz] of heads) {
    k.stick([x + dx * 0.3, y + 0.1, z + dz * 0.3], [x + dx, y + hy, z + dz], 0.02, WHITE);
    discZ(k, 0.08, 0.035, c, x + dx, y + hy + 0.06, z + dz - 0.017, 14);
    discZ(k, 0.045, 0.045, WHITE, x + dx, y + hy + 0.06, z + dz - 0.022, 10);
    discZ(k, 0.022, 0.05, c, x + dx, y + hy + 0.06, z + dz - 0.025, 8);
  }
}

// ---------- the candy shop ----------

export function candyShop(color = SHOP_COLORS[0]) {
  const k = new Kit();
  const dark = shade(color, -0.12), light = mixHex(color, WHITE, 0.55);
  // floor: little tiles
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) k.box(0.5, 0.04, 0.5, (i + j) % 2 ? WHITE : light, i * 0.5, 0, j * 0.5);
  // back wall with candy stripes and two shelves of jars
  k.box(3, 2.28, 0.16, CREAM, 0, 0.04, 0);
  for (let i = 0; i < 7; i++) k.box(0.18, 2.1, 0.02, light, 0.16 + i * 0.42, 0.1, 0.16);
  for (const y of [1.2, 1.7]) {
    k.box(2.7, 0.06, 0.3, WHITE, 0.15, y, 0.16);
    k.box(2.7, 0.05, 0.04, color, 0.15, y - 0.05, 0.43);
  }
  const shelfJar = (x, y, lid, seed, kind) => candyJar(k, x, 0.33, y + 0.06, lid, seed, { r: 0.11, h: 0.24, kind });
  shelfJar(0.45, 1.2, '#FF8FD0', 3, 'balls'); shelfJar(1.1, 1.2, '#A77BFF', 4, 'wrapped'); shelfJar(1.9, 1.2, '#6BD968', 5, 'balls'); shelfJar(2.55, 1.2, '#FFD93D', 6, 'wrapped');
  shelfJar(0.75, 1.7, '#5BB8FF', 7, 'wrapped'); shelfJar(1.5, 1.7, '#FF5A7A', 8, 'balls'); shelfJar(2.25, 1.7, '#FF9F43', 9, 'balls');
  // the counter: candy stripes, a big heart, a white top
  k.box(2.8, 0.96, 0.72, color, 0.1, 0.04, 1.18);
  for (let i = 0; i < 7; i++) k.box(0.14, 0.8, 0.02, WHITE, 0.24 + i * 0.4, 0.1, 1.9);
  heart(k, 0.46, '#FF5FA2', 1.27, 0.34, 1.92, 0.05);
  heart(k, 0.24, WHITE, 1.38, 0.43, 1.97, 0.02);
  k.box(2.94, 0.08, 0.84, WHITE, 0.03, 1.0, 1.12);
  k.box(2.94, 0.04, 0.04, dark, 0.03, 0.98, 1.94);
  // on the counter: jars and a pot of lollipops
  candyJar(k, 0.55, 1.52, 1.08, '#FF8FD0', 11, { kind: 'balls' });
  lollipopPot(k, 1.5, 1.5, 1.08);
  candyJar(k, 2.45, 1.52, 1.08, '#9BE8CF', 12, { kind: 'canes' });
  // a little cash box (pink, with a heart button)
  k.box(0.3, 0.16, 0.2, '#FFD1E6', 1.9, 1.08, 1.25);
  k.box(0.08, 0.06, 0.02, '#FF5FA2', 2.01, 1.13, 1.45);
  // candy cane posts and the striped awning
  candyPost(k, '#FF5A7A', 0.17, 1.87, 1.08, 1.02);
  candyPost(k, '#FF5A7A', 2.83, 1.87, 1.08, 1.02);
  awning(k, color, { yBack: 2.34, yFront: 2.12, zFront: 1.99 });
  // the sign, with a big lollipop each side
  k.box(2.0, 0.5, 0.1, dark, 0.5, 2.32, 0.04);
  k.box(1.9, 0.42, 0.02, signMat('candy', [['Candy', '#FF5FA2'], [' Shop', '#9C7BFF']]), 0.55, 2.36, 0.14, { faces: { px: null, nx: null, py: null, ny: null, nz: null } });
  lollipopSign(k, 0.28, 2.64, 0.12, 0.24, '#FF8FD0', 0.3);
  lollipopSign(k, 2.72, 2.64, 0.12, 0.24, '#9C7BFF', 0.3);
  return k.build();
}

// ---------- the ice cream parlor ----------

const TUBS = ['#FFB3C7', '#8B5A3C', '#BDF2DA', '#FFF1CF', '#DCC8FF', '#FFC94D'];

/** A giant waffle cone with scoops (the parlor / truck sign), base centre at (x, y, z). */
function giantCone(k, x, y, z, s = 1) {
  k.cone(0.03 * s, 0.2 * s, 0.46 * s, '#E9B26C', x, y, z, 16);
  for (let i = 0; i < 4; i++) {
    const yy = y + (0.1 + i * 0.09) * s, rr = (0.03 + ((0.1 + i * 0.09) / 0.46) * 0.17) * s;
    k.cyl(rr + 0.01 * s, 0.02 * s, '#C98A45', x, yy, z, 16);
  }
  k.cyl(0.22 * s, 0.07 * s, '#F2C98A', x, y + 0.44 * s, z, 18);
  k.ball(0.22 * s, '#FFB3C7', x, y + 0.62 * s, z, { seg: 16, sy: 0.9 });
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2;
    k.ball(0.07 * s, '#FFCCD9', x + Math.cos(a) * 0.2 * s, y + 0.53 * s, z + Math.sin(a) * 0.2 * s, { seg: 8 });
  }
  k.ball(0.18 * s, '#BDF2DA', x, y + 0.9 * s, z, { seg: 16, sy: 0.9 });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2 + 0.3;
    k.ball(0.06 * s, '#D6F8E8', x + Math.cos(a) * 0.16 * s, y + 0.82 * s, z + Math.sin(a) * 0.16 * s, { seg: 8 });
  }
  const R = rnd(33);
  for (let i = 0; i < 18; i++) {
    const a = R() * Math.PI * 2, up = 0.2 + R() * 0.7, h = Math.sqrt(1 - up * up);
    k.box(0.05 * s, 0.02 * s, 0.02 * s, CANDY_COLS[i % 7], x + Math.cos(a) * h * 0.18 * s, y + 0.9 * s + up * 0.16 * s, z + Math.sin(a) * h * 0.18 * s, { rot: [R(), R() * 3, 0] });
  }
  k.ball(0.07 * s, '#E8203F', x, y + 1.1 * s, z, { seg: 12 });
  k.stick([x, y + 1.15 * s, z], [x + 0.05 * s, y + 1.28 * s, z], 0.02 * s, '#4FA557');
}

export function iceCreamParlor(color = SHOP_COLORS[2]) {
  const k = new Kit();
  const dark = shade(color, -0.12), light = mixHex(color, WHITE, 0.55);
  for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) k.box(0.5, 0.04, 0.5, (i + j) % 2 ? WHITE : '#FFE3F0', i * 0.5, 0, j * 0.5);
  // back wall: pastel stripes, the menu board and a shelf of cones
  k.box(3, 2.28, 0.16, CREAM, 0, 0.04, 0);
  for (let i = 0; i < 6; i++) k.box(0.25, 2.16, 0.02, i % 2 ? '#FFE3F0' : light, 0.1 + i * 0.47, 0.08, 0.16);
  k.box(1.46, 0.78, 0.06, dark, 0.77, 1.22, 0.16);
  k.box(1.36, 0.68, 0.02, menuMat(), 0.82, 1.27, 0.22, { faces: { px: null, nx: null, py: null, ny: null, nz: null } });
  for (const x of [0.28, 2.72]) {
    k.box(0.4, 0.05, 0.22, WHITE, x - 0.2, 1.4, 0.16);
    for (let i = 0; i < 3; i++) k.cone(0.012, 0.06, 0.2, '#E9B26C', x - 0.1 + i * 0.1, 1.45, 0.27, 10, { rot: [Math.PI, 0, 0] });
    for (let i = 0; i < 3; i++) k.cone(0.012, 0.06, 0.2, '#E9B26C', x - 0.1 + i * 0.1, 1.65, 0.27, 10, { rot: [Math.PI, 0, 0] });
  }
  // the freezer counter
  k.box(2.8, 0.78, 0.74, color, 0.1, 0.04, 1.18);
  for (let i = 0; i < 6; i++) discZ(k, 0.09, 0.02, i % 2 ? WHITE : light, 0.35 + i * 0.46, 0.42, 1.92, 14);
  k.box(2.8, 0.06, 0.06, WHITE, 0.1, 0.8, 1.86);
  // tubs of ice cream inside, under the glass
  k.box(2.7, 0.03, 0.62, '#EAF6FF', 0.15, 0.82, 1.22);
  TUBS.forEach((c, i) => {
    const x = 0.38 + i * 0.45, z = 1.55;
    k.cyl(0.17, 0.14, '#FFFFFF', x, 0.83, z, 16);
    k.cyl(0.155, 0.02, shade(c, -0.08), x, 0.96, z, 16);
    k.ball(0.15, c, x, 0.97, z, { seg: 14, sy: 0.45 });
    k.ball(0.06, mixHex(c, WHITE, 0.35), x - 0.04, 1.02, z + 0.03, { seg: 8 });
  });
  k.box(0.04, 0.2, 0.04, '#E8EEF6', 1.62, 1.0, 1.5, { rot: [0.5, 0, 0.3] });
  // glass: a slanted front and a flat top
  const glass = sheer('#E4F6FF', 0.28);
  k.box(2.8, 0.52, 0.02, glass, 0.1, 0.82, 1.84, { rot: [-0.55, 0, 0], pivot: [0.1, 0.82, 1.86] });
  k.box(2.8, 0.02, 0.36, glass, 0.1, 1.24, 1.18);
  k.box(2.84, 0.05, 0.06, WHITE, 0.08, 1.24, 1.14);
  for (const x of [0.08, 2.86]) k.box(0.06, 0.46, 0.7, WHITE, x, 0.82, 1.18);
  // posts, awning, sign and the giant cone
  candyPost(k, color, 0.12, 1.9, 0.04, 2.08, 0.14);
  candyPost(k, color, 2.88, 1.9, 0.04, 2.08, 0.14);
  awning(k, color, { yBack: 2.36, yFront: 2.14, zFront: 1.99, stripes: 6 });
  k.box(2.4, 0.46, 0.1, dark, 0.3, 2.34, 0.04);
  k.box(2.3, 0.38, 0.02, signMat('icecream', [['Ice', '#FF5FA2'], ['Cream', '#3FB8A0']], { gap: 150 }), 0.35, 2.38, 0.14, { faces: { px: null, nx: null, py: null, ny: null, nz: null } });
  k.box(0.5, 0.08, 0.3, WHITE, 1.25, 2.22, 0.24);
  giantCone(k, 1.5, 2.28, 0.4, 0.6);
  return k.build();
}

// ---------- the ice cream truck ----------

export function iceCreamTruck(color = TRUCK_COLORS[0]) {
  const k = new Kit();
  const dark = shade(color, -0.15), light = mixHex(color, WHITE, 0.6);
  const zb = 0.12, zf = 1.72; // body back / front (the serving side)
  // wheels (four, pastel hubcaps)
  for (const x of [0.62, 2.35]) {
    for (const [z, dir] of [[zb - 0.1, 0], [zf - 0.06, 1]]) {
      discZ(k, 0.27, 0.16, '#4B3F5E', x, 0.27, z, 18);
      discZ(k, 0.15, 0.03, WHITE, x, 0.27, dir ? z + 0.16 : z - 0.03, 14);
      discZ(k, 0.07, 0.04, color, x, 0.27, dir ? z + 0.17 : z - 0.04, 10);
    }
  }
  // chassis and body
  k.box(2.9, 0.2, zf - zb - 0.08, '#8E82A8', 0.05, 0.22, zb + 0.04);
  // the cab (front end toward -x): hood, windshield, roof
  k.box(0.88, 0.72, zf - zb, color, 0.05, 0.38, zb);
  k.box(0.6, 0.62, zf - zb, color, 0.32, 1.1, zb);
  k.box(0.02, 0.5, zf - zb - 0.2, sheer('#D8F0FF', 0.45), 0.3, 1.16, zb + 0.1, { rot: [0, 0, 0.35], pivot: [0.32, 1.16, 0] });
  k.box(0.46, 0.34, 0.02, sheer('#D8F0FF', 0.5), 0.4, 1.3, zf);
  k.box(0.46, 0.34, 0.02, sheer('#D8F0FF', 0.5), 0.4, 1.3, zb - 0.02);
  k.box(0.64, 0.06, zf - zb + 0.04, WHITE, 0.3, 1.72, zb - 0.02);
  // headlights, bumper, a smiley grille
  for (const z of [zb + 0.25, zf - 0.25]) {
    k.box(0.04, 0.14, 0.18, glow('#FFF3B0', 0.8), 0.02, 0.8, z - 0.09);
  }
  k.box(0.08, 0.12, zf - zb + 0.1, WHITE, -0.0, 0.38, zb - 0.05);
  k.box(0.03, 0.04, 0.5, INK, 0.03, 0.62, (zb + zf) / 2 - 0.25);
  // stripes and polka dots down the side
  k.box(2.9, 0.12, 0.02, WHITE, 0.05, 1.0, zf);
  k.box(2.9, 0.08, 0.02, '#FF5FA2', 0.05, 0.9, zf);
  k.box(2.9, 0.12, 0.02, WHITE, 0.05, 1.0, zb - 0.02);
  const dots = [[1.1, 0.62], [1.45, 0.52], [1.8, 0.66], [2.15, 0.54], [2.5, 0.64], [2.8, 0.5]];
  for (const [x, y] of dots) {
    discZ(k, 0.07, 0.02, WHITE, x, y, zf, 12);
    discZ(k, 0.07, 0.02, light, x, y, zb - 0.04, 12);
  }
  // the serving window: a cozy inside, a white frame, a shelf with treats and a bell
  const wx0 = 1.15, wx1 = 2.7, wy0 = 1.12, wy1 = 1.84;
  k.box(2.05, wy0 - 0.38, zf - zb, color, 0.9, 0.38, zb);
  k.box(2.05, 2.1 - wy1, zf - zb, color, 0.9, wy1, zb);
  k.box(wx0 - 0.06 - 0.9, wy1 - wy0, zf - zb, color, 0.9, wy0, zb);
  k.box(2.95 - (wx1 + 0.06), wy1 - wy0, zf - zb, color, wx1 + 0.06, wy0, zb);
  k.box(wx1 - wx0 + 0.12, wy1 - wy0, zf - 0.3 - zb, color, wx0 - 0.06, wy0, zb);
  k.box(wx1 - wx0, wy1 - wy0, 0.04, '#FFE3F0', wx0, wy0, zf - 0.3);
  for (let i = 0; i < 4; i++) k.box(0.18, 0.5, 0.03, TUBS[i + 1], wx0 + 0.12 + i * 0.36, wy0 + 0.08, zf - 0.27);
  k.box(wx1 - wx0, 0.02, 0.28, '#FFFFFF', wx0, wy0, zf - 0.28);
  k.box(0.06, wy1 - wy0, 0.3, WHITE, wx0 - 0.06, wy0, zf - 0.28);
  k.box(0.06, wy1 - wy0, 0.3, WHITE, wx1, wy0, zf - 0.28);
  k.box(wx1 - wx0 + 0.12, 0.06, 0.3, WHITE, wx0 - 0.06, wy1, zf - 0.28);
  k.box(wx1 - wx0 + 0.2, 0.06, 0.24, WHITE, wx0 - 0.1, wy0 - 0.06, zf - 0.04);
  giantScoopHolder(k, wx0 + 0.25, wy0, zf + 0.08);
  k.cyl(0.05, 0.03, '#FFD36B', wx1 - 0.2, wy0, zf + 0.08, 12);
  k.ball(0.05, '#FFD36B', wx1 - 0.2, wy0 + 0.05, zf + 0.08, { seg: 10, sy: 0.8 });
  // flip-up awning over the window
  const aw = 0.26;
  for (let i = 0; i < 6; i++) {
    const sw = (wx1 - wx0 + 0.2) / 6;
    k.box(sw, 0.05, aw, i % 2 ? WHITE : '#FF8FC8', wx0 - 0.1 + i * sw, wy1 + 0.1, zf, { rot: [0.35, 0, 0], pivot: [wx0 - 0.1 + i * sw, wy1 + 0.12, zf] });
  }
  // the roof: white trim, a sign and a giant cone
  k.box(2.1, 0.08, zf - zb + 0.06, WHITE, 0.88, 2.1, zb - 0.03);
  k.box(1.5, 0.42, 0.08, dark, 0.95, 2.18, (zb + zf) / 2 + 0.1);
  k.box(1.42, 0.34, 0.02, signMat('truck', [['Ice', '#FF5FA2'], [' Cream', '#9C7BFF']]), 0.99, 2.22, (zb + zf) / 2 + 0.18, { faces: { px: null, nx: null, py: null, ny: null, nz: null } });
  giantCone(k, 2.62, 2.18, (zb + zf) / 2, 0.62);
  // little stars on the back doors
  k.pixels(STAR_ROWS, 0.05, { X: '#FFE38F' }, 2.3, 1.3, zb - 0.06, { depth: 0.03 });
  return k.build();
}

/** Three little cones in a holder on the truck's shelf. */
function giantScoopHolder(k, x, y, z) {
  k.box(0.3, 0.1, 0.12, '#FF9CCB', x - 0.15, y, z - 0.06);
  const cols = ['#FFB3C7', '#BDF2DA', '#FFC94D'];
  for (let i = 0; i < 3; i++) {
    const cx = x - 0.09 + i * 0.09;
    k.cone(0.01, 0.035, 0.12, '#E9B26C', cx, y + 0.04, z, 10);
    k.ball(0.04, cols[i], cx, y + 0.19, z, { seg: 10 });
  }
}

/** Colliders (model units) so she can walk round a stall and behind its counter. */
export const STALL_COLLIDERS = [[0.05, 0, 1.12, 2.95, 1.1, 1.97], [0, 0, 0, 3, 2.3, 0.35]];
export const TRUCK_COLLIDERS = [[0.0, 0, 0.02, 3.0, 2.15, 1.9]];

export function makeModel(kind, color) {
  if (kind === 'candy') return candyShop(color);
  if (kind === 'parlor') return iceCreamParlor(color);
  return iceCreamTruck(color);
}

