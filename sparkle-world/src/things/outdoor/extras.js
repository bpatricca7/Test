// Outdoor extras that plug into other registries through their public shapes:
//  - three new stickers (Zip Zoom!, Happy Camper, S'mores Star) with their own sticker art
//  - a Bag tab for camping gear (added to the tab list when it is missing)
//  - the S'more, a food that camp-fire marshmallows turn into (FOOD entry + baked model), so
//    the basket, the Bag's Food tab, pets and tables all know it.

import { FOOD } from '../food-models.js';
import { baked } from '../pets/kit.js';
import { ITEM_CATEGORIES } from '../../core/registry.js';

export const CAMP_TAB = 'camping';

// ---------- sticker art (100 x 100 units, same style as src/life/sticker-art.js) ----------

function shadeHex(hex, amt) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  const t = amt < 0 ? 0 : 255, k = Math.abs(amt);
  r = Math.round(r + (t - r) * k); g = Math.round(g + (t - g) * k); b = Math.round(b + (t - b) * k);
  return `rgb(${r},${g},${b})`;
}
function paint(g, fill, stroke = null, width = 2.6) {
  g.fillStyle = fill;
  g.fill();
  if (stroke !== false) {
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = stroke || shadeHex(fill, -0.28);
    g.lineWidth = width;
    g.stroke();
  }
}
function circle(g, x, y, r, fill, stroke) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  paint(g, fill, stroke);
}
function rrect(g, x, y, w, h, r, fill, stroke) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
  paint(g, fill, stroke);
}
function poly(g, pts, fill, stroke) {
  g.beginPath();
  pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)));
  g.closePath();
  paint(g, fill, stroke);
}
function sparkle(g, x, y, s, fill = '#FFFFFF') {
  g.beginPath();
  g.moveTo(x, y - s);
  g.quadraticCurveTo(x + s * 0.18, y - s * 0.18, x + s, y);
  g.quadraticCurveTo(x + s * 0.18, y + s * 0.18, x, y + s);
  g.quadraticCurveTo(x - s * 0.18, y + s * 0.18, x - s, y);
  g.quadraticCurveTo(x - s * 0.18, y - s * 0.18, x, y - s);
  g.closePath();
  paint(g, fill, fill === '#FFFFFF' ? '#FFD95A' : false, 1.4);
}
function face(g, x, y, s) {
  for (const sx of [-1, 1]) {
    g.beginPath(); g.ellipse(x + sx * s * 0.3, y, s * 0.085, s * 0.11, 0, 0, Math.PI * 2); g.fillStyle = '#3A1F4D'; g.fill();
    g.beginPath(); g.arc(x + sx * s * 0.3 + s * 0.03, y - s * 0.04, s * 0.032, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    g.beginPath(); g.ellipse(x + sx * s * 0.48, y + s * 0.16, s * 0.1, s * 0.06, 0, 0, Math.PI * 2); g.fillStyle = 'rgba(255,120,170,.55)'; g.fill();
  }
  g.beginPath(); g.arc(x, y + s * 0.1, s * 0.12, 0.15 * Math.PI, 0.85 * Math.PI);
  g.strokeStyle = '#3A1F4D'; g.lineWidth = s * 0.06; g.lineCap = 'round'; g.stroke();
}

const ART = {
  zip_zoom(g) {
    // two towers, a candy cable and a zooming girl-shaped handle with a star trail
    rrect(g, 6, 40, 14, 52, 3, '#F3D7AE', '#C99A6B');
    poly(g, [[2, 42], [13, 24], [24, 42]], '#FF8CC6', '#E0569A');
    rrect(g, 80, 58, 14, 34, 3, '#F3D7AE', '#C99A6B');
    poly(g, [[76, 60], [87, 44], [98, 60]], '#9C7BFF', '#7353D6');
    g.beginPath(); g.moveTo(14, 44); g.quadraticCurveTo(50, 70, 87, 62);
    g.strokeStyle = '#FF5FA2'; g.lineWidth = 3.4; g.stroke();
    g.setLineDash([3, 4]); g.strokeStyle = '#FFFFFF'; g.lineWidth = 3.4; g.stroke(); g.setLineDash([]);
    rrect(g, 52, 50, 10, 7, 2, '#6CC6FF', '#4BA6E0');
    g.beginPath(); g.moveTo(52, 56); g.lineTo(49, 66); g.moveTo(62, 56); g.lineTo(65, 66);
    g.strokeStyle = '#FFFFFF'; g.lineWidth = 2; g.stroke();
    rrect(g, 45, 64, 24, 5, 2.5, '#FFD95A', '#E0A21F');
    circle(g, 57, 78, 9, '#FFD7BE', '#E8A988');
    face(g, 57, 78, 16);
    for (const [x, y, s] of [[36, 64, 6], [26, 58, 4.5], [18, 52, 3.5]]) sparkle(g, x, y, s);
  },
  happy_camper(g) {
    circle(g, 78, 20, 11, '#FFF3B0', '#F2C94C');
    circle(g, 83, 16, 9, '#FFFFFF', false);
    g.beginPath(); g.moveTo(8, 86); g.bezierCurveTo(10, 36, 90, 36, 92, 86); g.closePath();
    paint(g, '#FF8CC6', '#E0569A');
    g.beginPath(); g.moveTo(50, 45); g.lineTo(38, 86); g.lineTo(62, 86); g.closePath();
    paint(g, '#8C5AA8', '#6E3F8C');
    g.beginPath(); g.moveTo(50, 45); g.lineTo(36, 86); g.lineTo(40, 86); g.closePath(); paint(g, '#FFD1E6', false);
    g.beginPath(); g.moveTo(50, 45); g.lineTo(64, 86); g.lineTo(60, 86); g.closePath(); paint(g, '#FFD1E6', false);
    rrect(g, 42, 76, 16, 8, 3, '#B69CFF', false);
    g.font = 'bold 13px sans-serif'; g.fillStyle = '#9C7BFF'; g.fillText('z', 58, 36); g.font = 'bold 10px sans-serif'; g.fillText('z', 66, 28);
    sparkle(g, 18, 22, 6);
    sparkle(g, 30, 12, 4, '#FFD1E6');
  },
  smores_star(g) {
    g.beginPath(); g.moveTo(8, 92); g.lineTo(58, 42); g.strokeStyle = '#C99A6B'; g.lineWidth = 4; g.lineCap = 'round'; g.stroke();
    rrect(g, 44, 22, 36, 30, 12, '#F2B25C', '#C98534');
    rrect(g, 48, 24, 28, 10, 5, '#F8D08E', false);
    face(g, 62, 38, 20);
    g.beginPath();
    for (let k = 0; k < 10; k++) {
      const aa = -Math.PI / 2 + (k / 10) * Math.PI * 2;
      const r = k % 2 ? 5 : 12;
      g.lineTo(24 + Math.cos(aa) * r, 26 + Math.sin(aa) * r);
    }
    g.closePath();
    paint(g, '#FFD95A', '#F2A91F');
    sparkle(g, 88, 60, 6);
    sparkle(g, 34, 56, 4, '#FFD1E6');
  },
};

export const STICKERS = [
  ['zip_zoom', 'Zip Zoom!', 'Ride a zip line', 'star'],
  ['happy_camper', 'Happy Camper', 'Sleep in a tent', 'moon'],
  ['smores_star', "S'mores Star", 'Roast a golden marshmallow', 'star'],
];

export function installExtras(game) {
  const reg = game.registry.stickers;
  if (reg) {
    for (const [id, name, hint, icon] of STICKERS) {
      if (!reg.has(id)) reg.set(id, { id, name, hint, icon, art: ART[id] });
    }
  }
  // a Bag tab for camping gear, right after Fun & Toys (other tabs keep their order)
  if (!ITEM_CATEGORIES.some(([id]) => id === CAMP_TAB)) {
    const at = ITEM_CATEGORIES.findIndex(([id]) => id === 'fun');
    ITEM_CATEGORIES.splice(at >= 0 ? at + 1 : ITEM_CATEGORIES.length, 0, [CAMP_TAB, 'Camping']);
  }
  // the S'more: a food like any other (basket, Bag Food tab, tables, pets)
  if (!FOOD.smores) {
    FOOD.smores = { name: "S'more", plural: "S'mores", kind: 'meal', color: '#E9B872' };
    baked('food:smores', smoreModel);
  }
}

/** A s'more: two graham crackers, melty chocolate and a toasty marshmallow (y = 0 bottom). */
export function smoreModel(k) {
  k.cyl(0.19, 0.012, '#FFFFFF', 0, 0, 0, 16);
  k.cyl(0.17, 0.018, '#FFE3F0', 0, 0.006, 0, 16);
  const cracker = (y) => {
    k.cbox(0.26, 0.04, 0.26, '#D9A066', 0, y, 0);
    for (const [x, z] of [[-0.06, -0.06], [0.06, -0.06], [-0.06, 0.06], [0.06, 0.06]]) k.cbox(0.018, 0.006, 0.018, '#B87E45', x, y + 0.022, z);
    k.cbox(0.004, 0.006, 0.24, '#C48B52', 0, y + 0.021, 0);
  };
  cracker(0.045);
  k.cbox(0.22, 0.03, 0.22, '#7A4A2A', 0, 0.08, 0);
  k.cbox(0.25, 0.025, 0.08, '#6B3E22', 0.03, 0.078, 0.1);
  k.cyl(0.12, 0.08, '#F2C98A', 0, 0.095, 0, 14);
  k.cyl(0.125, 0.03, '#FFF4E0', 0, 0.12, 0, 14);
  k.ball(0.03, '#FFF4E0', 0.12, 0.12, 0.02, 8);
  cracker(0.185);
  return undefined;
}
