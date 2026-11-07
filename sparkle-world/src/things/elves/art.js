// The three elf stickers' art (100 x 100 box, src/life/sticker-art.js turns it into a glossy
// die-cut sticker): "Peekaboo!" (an elf peeking over a present), "Super Seeker" (three elves
// with stars) and "Elf Best Friend" (an elf waving from its little door).

import { SCHEMES } from './data.js';

const INK = 'rgba(58,31,77,0.55)';

function paint(g, fill, stroke = INK, w = 2.4) {
  g.fillStyle = fill;
  g.fill();
  if (stroke) {
    g.lineJoin = 'round';
    g.lineCap = 'round';
    g.strokeStyle = stroke;
    g.lineWidth = w;
    g.stroke();
  }
}

function star(g, x, y, r, fill) {
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, rr = i % 2 ? r * 0.48 : r;
    if (i) g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr); else g.moveTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
  }
  g.closePath();
  paint(g, fill, 'rgba(58,31,77,0.45)', 1.6);
}

/** An elf head (face, ears, hat with a star) centred at (x, y), face radius r. */
function elfHead(g, x, y, r, s, { tilt = 0 } = {}) {
  g.save();
  g.translate(x, y);
  g.rotate(tilt);
  const k = r / 20;
  g.scale(k, k);
  // ears
  for (const sx of [-1, 1]) {
    g.beginPath(); g.moveTo(sx * 16, -4); g.quadraticCurveTo(sx * 34, -14, sx * 36, -20); g.quadraticCurveTo(sx * 28, 2, sx * 15, 6); g.closePath(); paint(g, s.skin);
  }
  // hair at the sides
  g.beginPath(); g.ellipse(-15, -6, 8, 12, 0.3, 0, Math.PI * 2); paint(g, s.hair, false);
  g.beginPath(); g.ellipse(15, -6, 8, 12, -0.3, 0, Math.PI * 2); paint(g, s.hair, false);
  // face
  g.beginPath(); g.arc(0, 0, 20, 0, Math.PI * 2); paint(g, s.skin);
  // eyes, shine, cheeks, smile
  for (const sx of [-1, 1]) {
    g.beginPath(); g.ellipse(sx * 7, -1, 3, 3.8, 0, 0, Math.PI * 2); paint(g, '#2A1B33', false);
    g.beginPath(); g.arc(sx * 7 + 1.1, -2.4, 1.1, 0, Math.PI * 2); paint(g, '#FFFFFF', false);
    g.beginPath(); g.ellipse(sx * 12.5, 6, 4, 2.6, 0, 0, Math.PI * 2); paint(g, s.cheek, false);
  }
  g.beginPath(); g.arc(0, 6, 5, 0.25, Math.PI - 0.25); g.strokeStyle = '#7A2F4F'; g.lineWidth = 2; g.stroke();
  // hat: a floppy cone, a fluffy band, the star at the tip
  g.beginPath(); g.moveTo(-19, -10); g.quadraticCurveTo(-8, -40, 10, -44); g.quadraticCurveTo(28, -46, 30, -34); g.quadraticCurveTo(14, -36, 19, -10); g.closePath(); paint(g, s.hat);
  g.beginPath(); g.ellipse(0, -11, 22, 6.5, 0, 0, Math.PI * 2); paint(g, s.brim);
  g.restore();
  // the hat tip (30, -38) in the head's own units, turned with the head
  const px = 30, py = -38, c = Math.cos(tilt), sn = Math.sin(tilt);
  star(g, x + k * (px * c - py * sn), y + k * (px * sn + py * c), 7 * k, s.star === '#FFFFFF' ? '#FFF3B0' : s.star);
}

/** Peekaboo!: an elf peeking over a wrapped present. */
function firstArt(g) {
  const s = SCHEMES[0];
  elfHead(g, 50, 46, 22, s, { tilt: -0.12 });
  // two mittens on the edge
  for (const x of [30, 70]) { g.beginPath(); g.ellipse(x, 62, 7, 6, 0, 0, Math.PI * 2); paint(g, s.mitt); }
  // the present
  g.beginPath(); g.rect(16, 64, 68, 28); paint(g, '#A78BFA');
  g.beginPath(); g.rect(45, 64, 10, 28); paint(g, '#FFD24D', false);
  g.beginPath(); g.rect(16, 64, 68, 28); g.strokeStyle = INK; g.lineWidth = 2.4; g.stroke();
  star(g, 14, 22, 6, '#FFF3B0');
  star(g, 88, 30, 5, '#FFF3B0');
}

/** Super Seeker: three happy elves side by side under stars. */
function allArt(g) {
  elfHead(g, 24, 64, 14, SCHEMES[2], { tilt: -0.2 });
  elfHead(g, 76, 64, 14, SCHEMES[1], { tilt: 0.15 });
  elfHead(g, 50, 52, 17, SCHEMES[6]);
  star(g, 16, 22, 6, '#FFD43B');
  star(g, 50, 12, 5, '#FFF3B0');
  star(g, 86, 24, 6, '#FFD43B');
}

/** Elf Best Friend: an elf waving from its little round door, a heart. */
function homeArt(g) {
  // the door
  g.beginPath(); g.moveTo(24, 92); g.lineTo(24, 46); g.arc(50, 46, 26, Math.PI, 0); g.lineTo(76, 92); g.closePath(); paint(g, '#FF8CC6');
  g.beginPath(); g.moveTo(31, 92); g.lineTo(31, 48); g.arc(50, 48, 19, Math.PI, 0); g.lineTo(69, 92); g.closePath(); paint(g, '#5C3A8E', false);
  elfHead(g, 50, 64, 15, SCHEMES[3]);
  // a waving mitten
  g.beginPath(); g.ellipse(76, 60, 6, 7, 0.3, 0, Math.PI * 2); paint(g, SCHEMES[3].mitt);
  // a heart
  g.beginPath();
  const hx = 82, hy = 22, hs = 16;
  g.moveTo(hx, hy + hs * 0.38);
  g.bezierCurveTo(hx - hs * 0.62, hy - hs * 0.02, hx - hs * 0.3, hy - hs * 0.52, hx, hy - hs * 0.2);
  g.bezierCurveTo(hx + hs * 0.3, hy - hs * 0.52, hx + hs * 0.62, hy - hs * 0.02, hx, hy + hs * 0.38);
  g.closePath();
  paint(g, '#FF5FA2', 'rgba(58,31,77,0.45)', 1.8);
}

export const ELF_STICKERS = [
  { id: 'elf_first', name: 'Peekaboo!', hint: 'Find a Twinkle Elf', icon: 'star', art: firstArt },
  { id: 'elf_all', name: 'Super Seeker', hint: 'Find all the elves in Holiday Village', icon: 'star', art: allArt },
  { id: 'elf_home', name: 'Elf Best Friend', hint: 'Find your house elf on 5 mornings', icon: 'heart', art: homeArt },
];
