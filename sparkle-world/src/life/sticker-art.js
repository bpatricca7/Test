// Sticker art, painted on canvas: every sticker is a cute motif turned into a glossy die-cut
// sticker (thick white border following the shape, soft shadow, a shine across the top).
// Locked stickers are soft lavender silhouettes. stickerCanvas(id, def, { locked, size }) gives a
// ready <canvas> (no pixel read-back, so it never stalls a frame); stickerImage() a cached PNG
// data URL. Other teams can give their own stickers art with
// def.art = (ctx) => { ... } drawing in a 100 x 100 box.

const INK = '#3A1F4D';

// ---------- little drawing kit (100 x 100 units) ----------

function shade(hex, amt) {
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
    g.strokeStyle = stroke || shade(fill, -0.28);
    g.lineWidth = width;
    g.stroke();
  }
}

function circle(g, x, y, r, fill, stroke) {
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  paint(g, fill, stroke);
}

function ellipse(g, x, y, rx, ry, fill, stroke, rot = 0) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
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

function heart(g, x, y, s, fill, stroke) {
  g.beginPath();
  g.moveTo(x, y + s * 0.36);
  g.bezierCurveTo(x - s * 0.62, y - s * 0.02, x - s * 0.32, y - s * 0.52, x, y - s * 0.2);
  g.bezierCurveTo(x + s * 0.32, y - s * 0.52, x + s * 0.62, y - s * 0.02, x, y + s * 0.36);
  g.closePath();
  paint(g, fill, stroke);
}

function star(g, x, y, R, r, fill, stroke, rot = -Math.PI / 2, n = 5) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * Math.PI * 2;
    const d = i % 2 ? r : R;
    g.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
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

function shine(g, x, y, rx, ry, rot = -0.6, a = 0.75) {
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  g.fillStyle = `rgba(255,255,255,${a})`;
  g.fill();
}

/** Kawaii face: eyes with highlights, blush, smile. */
function face(g, x, y, s, { sleepy = false, eye = INK } = {}) {
  const ex = s * 0.3;
  if (sleepy) {
    g.strokeStyle = eye; g.lineWidth = s * 0.07; g.lineCap = 'round';
    for (const sx of [-1, 1]) { g.beginPath(); g.arc(x + sx * ex, y - s * 0.02, s * 0.1, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke(); }
  } else {
    for (const sx of [-1, 1]) {
      g.beginPath(); g.ellipse(x + sx * ex, y, s * 0.085, s * 0.11, 0, 0, Math.PI * 2); g.fillStyle = eye; g.fill();
      g.beginPath(); g.arc(x + sx * ex + s * 0.03, y - s * 0.04, s * 0.032, 0, Math.PI * 2); g.fillStyle = '#fff'; g.fill();
    }
  }
  g.fillStyle = 'rgba(255,120,160,0.55)';
  for (const sx of [-1, 1]) { g.beginPath(); g.ellipse(x + sx * s * 0.5, y + s * 0.16, s * 0.12, s * 0.07, 0, 0, Math.PI * 2); g.fill(); }
  g.strokeStyle = eye; g.lineWidth = s * 0.06; g.lineCap = 'round';
  g.beginPath(); g.arc(x, y + s * 0.12, s * 0.1, 0.15 * Math.PI, 0.85 * Math.PI); g.stroke();
}

function isoCube(g, cx, cy, s, [top, left, right], stroke) {
  const T = [cx, cy - s], R = [cx + s * 0.95, cy - s * 0.5], L = [cx - s * 0.95, cy - s * 0.5], M = [cx, cy];
  const B = [cx, cy + s * 1.05], BL = [cx - s * 0.95, cy + s * 0.55], BR = [cx + s * 0.95, cy + s * 0.55];
  poly(g, [L, M, B, BL], left, stroke);
  poly(g, [M, R, BR, B], right, stroke);
  poly(g, [T, R, M, L], top, stroke);
}

function cloud(g, x, y, s, fill = '#FFFFFF', stroke = '#C9D6F2') {
  g.beginPath();
  g.moveTo(x - s * 0.9, y + s * 0.35);
  g.arc(x - s * 0.55, y + s * 0.05, s * 0.36, Math.PI * 0.55, Math.PI * 1.55);
  g.arc(x, y - s * 0.12, s * 0.5, Math.PI * 1.1, Math.PI * 1.95);
  g.arc(x + s * 0.55, y + s * 0.08, s * 0.34, Math.PI * 1.45, Math.PI * 0.5);
  g.closePath();
  paint(g, fill, stroke, 2.2);
}

function drop(g, x, y, s, fill) {
  g.beginPath();
  g.moveTo(x, y - s);
  g.bezierCurveTo(x + s * 0.3, y - s * 0.4, x + s * 0.7, y, x + s * 0.7, y + s * 0.35);
  g.arc(x, y + s * 0.35, s * 0.7, 0, Math.PI);
  g.bezierCurveTo(x - s * 0.7, y, x - s * 0.3, y - s * 0.4, x, y - s);
  g.closePath();
  paint(g, fill);
}

// ---------- the motifs ----------

const MOTIFS = {
  first_block(g) {
    isoCube(g, 48, 52, 30, ['#FFC4E0', '#FF8CC6', '#FF5FA2'], '#D94A8C');
    face(g, 33, 67, 16);
    star(g, 80, 22, 13, 6, '#FFD95A', '#F2A91F');
    sparkle(g, 20, 20, 7);
  },
  builder(g) {
    isoCube(g, 31, 64, 17, ['#B8F5E6', '#6FE3C4', '#3FD8B0'], '#2BAE8C');
    isoCube(g, 69, 64, 17, ['#CDEBFF', '#8FD3FF', '#6CC6FF'], '#4BA6E0');
    isoCube(g, 50, 36, 17, ['#FFF0B3', '#FFD95A', '#FFC94D'], '#E0A21F');
    sparkle(g, 84, 20, 8);
    sparkle(g, 16, 30, 6, '#FFD1E6');
  },
  home_sweet_home(g) {
    rrect(g, 64, 20, 9, 18, 2, '#B69CFF');
    rrect(g, 25, 44, 50, 42, 5, '#FFC4E0', '#E07AAE');
    poly(g, [[16, 50], [50, 18], [84, 50]], '#9C7BFF', '#7353D6');
    rrect(g, 43, 62, 15, 24, 6, '#FF8CC6');
    circle(g, 54, 75, 1.8, '#FFFFFF', false);
    heart(g, 34, 60, 14, '#FF5FA2');
    circle(g, 67, 59, 6, '#CDEBFF', '#6CC6FF');
    heart(g, 76, 12, 9, '#FF8CC6');
    heart(g, 86, 5, 6, '#FFB3D6', false);
  },
  sweet_dreams(g) {
    rrect(g, 12, 40, 16, 44, 7, '#B69CFF', '#7F63E0');
    rrect(g, 14, 62, 74, 14, 5, '#FFFFFF', '#C9B8F0');
    rrect(g, 36, 54, 52, 20, 7, '#FF8CC6', '#E0569A');
    heart(g, 50, 63, 9, '#FFFFFF', false);
    heart(g, 71, 63, 9, '#FFFFFF', false);
    rrect(g, 20, 50, 20, 11, 5, '#FFFFFF', '#C9B8F0');
    rrect(g, 16, 76, 6, 10, 2, '#7F63E0', false);
    rrect(g, 80, 76, 6, 10, 2, '#7F63E0', false);
    g.beginPath(); g.arc(70, 24, 13, 0.6, Math.PI * 1.75); g.arc(76, 20, 10, Math.PI * 1.6, 0.9, true); g.closePath(); paint(g, '#FFD95A', '#F2A91F');
    g.font = 'bold 15px sans-serif'; g.fillStyle = '#9C7BFF'; g.fillText('z', 44, 32); g.font = 'bold 11px sans-serif'; g.fillText('z', 54, 22);
  },
  best_friends(g) {
    g.beginPath();
    g.moveTo(50, 50);
    g.bezierCurveTo(70, 50, 82, 70, 76, 80);
    g.bezierCurveTo(70, 90, 58, 84, 50, 84);
    g.bezierCurveTo(42, 84, 30, 90, 24, 80);
    g.bezierCurveTo(18, 70, 30, 50, 50, 50);
    paint(g, '#FF8CC6', '#E0569A');
    ellipse(g, 24, 44, 9, 11, '#FF8CC6', '#E0569A', -0.35);
    ellipse(g, 40, 28, 9, 12, '#FF8CC6', '#E0569A', -0.1);
    ellipse(g, 60, 28, 9, 12, '#FF8CC6', '#E0569A', 0.1);
    ellipse(g, 76, 44, 9, 11, '#FF8CC6', '#E0569A', 0.35);
    heart(g, 50, 70, 20, '#FFD1E6', false);
    shine(g, 38, 60, 6, 3);
  },
  pet_lover(g) {
    heart(g, 50, 54, 80, '#FF5FA2', '#D94A8C');
    circle(g, 50, 62, 10, '#FFFFFF', false);
    for (const [x, y] of [[36, 48], [45, 42], [55, 42], [64, 48]]) circle(g, x, y, 4.5, '#FFFFFF', false);
    shine(g, 30, 38, 8, 4);
    heart(g, 84, 18, 14, '#FFB3D6');
    heart(g, 16, 22, 10, '#FF8CC6');
  },
  little_chef(g) {
    poly(g, [[28, 56], [72, 56], [65, 88], [35, 88]], '#8EE8CF', '#3FB894');
    g.strokeStyle = '#3FD8B0'; g.lineWidth = 3;
    for (const x of [38, 46, 54, 62]) { g.beginPath(); g.moveTo(x, 58); g.lineTo(x - (x - 50) * 0.2, 86); g.stroke(); }
    ellipse(g, 50, 54, 26, 10, '#FFC4E0', '#E07AAE');
    ellipse(g, 50, 45, 21, 9, '#FFC4E0', '#E07AAE');
    ellipse(g, 50, 36, 14, 8, '#FFC4E0', '#E07AAE');
    const sprinkle = [['#9C7BFF', 36, 50, 0.6], ['#FFD95A', 60, 52, -0.4], ['#6CC6FF', 46, 42, 0.3], ['#3FD8B0', 56, 40, -0.8], ['#FF5FA2', 42, 55, -0.2]];
    for (const [c, x, y, r] of sprinkle) { g.save(); g.translate(x, y); g.rotate(r); rrect(g, -3.5, -1.2, 7, 2.4, 1.2, c, false); g.restore(); }
    g.strokeStyle = '#3FB894'; g.lineWidth = 2.4; g.beginPath(); g.moveTo(50, 24); g.quadraticCurveTo(54, 16, 60, 14); g.stroke();
    circle(g, 50, 26, 6.5, '#FF5A7A', '#D93A5C');
    shine(g, 48, 24, 2.2, 1.4);
  },
  master_chef(g) {
    rrect(g, 20, 58, 60, 28, 6, '#FFE7BD', '#E8B870');
    g.beginPath(); g.moveTo(20, 64);
    for (let x = 20; x <= 80; x += 10) g.quadraticCurveTo(x + 5, 74, x + 10, 64);
    g.lineTo(80, 60); g.lineTo(20, 60); g.closePath(); paint(g, '#FF8CC6', false);
    rrect(g, 30, 38, 40, 22, 6, '#FFC4E0', '#E07AAE');
    g.beginPath(); g.moveTo(30, 44);
    for (let x = 30; x < 70; x += 8) g.quadraticCurveTo(x + 4, 51, x + 8, 44);
    g.lineTo(70, 40); g.lineTo(30, 40); g.closePath(); paint(g, '#FFFFFF', false);
    const candles = [[38, '#9C7BFF'], [50, '#3FD8B0'], [62, '#6CC6FF']];
    for (const [x, c] of candles) {
      rrect(g, x - 3, 24, 6, 15, 2, c);
      drop(g, x, 16, 5, '#FFD95A');
    }
    circle(g, 30, 74, 2.5, '#FFFFFF', false); circle(g, 50, 78, 2.5, '#FFFFFF', false); circle(g, 70, 74, 2.5, '#FFFFFF', false);
  },
  green_thumb(g) {
    g.strokeStyle = '#56B85C'; g.lineWidth = 5; g.lineCap = 'round';
    g.beginPath(); g.moveTo(50, 70); g.lineTo(50, 40); g.stroke();
    ellipse(g, 38, 56, 11, 6, '#8EDB7E', '#56B85C', -0.6);
    ellipse(g, 62, 52, 11, 6, '#8EDB7E', '#56B85C', 0.6);
    for (let i = 0; i < 10; i++) {
      const a = (i / 10) * Math.PI * 2;
      ellipse(g, 50 + Math.cos(a) * 15, 30 + Math.sin(a) * 15, 8, 5, '#FFD95A', '#F2A91F', a);
    }
    circle(g, 50, 30, 12, '#C98B5E', '#9C6641');
    face(g, 50, 30, 14, { eye: '#5A3A28' });
    poly(g, [[30, 68], [70, 68], [65, 90], [35, 90]], '#FFA98C', '#E07A5C');
    rrect(g, 27, 64, 46, 9, 4, '#FFBFA8', '#E07A5C');
  },
  fashionista(g) {
    g.strokeStyle = '#E0569A'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(40, 22); g.lineTo(42, 34); g.moveTo(60, 22); g.lineTo(58, 34); g.stroke();
    poly(g, [[38, 32], [62, 32], [60, 50], [40, 50]], '#FF8CC6', '#E0569A');
    g.beginPath(); g.moveTo(40, 50); g.lineTo(60, 50); g.quadraticCurveTo(80, 70, 86, 88); g.quadraticCurveTo(50, 96, 14, 88); g.quadraticCurveTo(20, 70, 40, 50); g.closePath();
    paint(g, '#FF8CC6', '#E0569A');
    g.strokeStyle = 'rgba(255,255,255,.6)'; g.lineWidth = 2;
    g.beginPath(); g.moveTo(30, 88); g.quadraticCurveTo(34, 68, 44, 54); g.moveTo(70, 88); g.quadraticCurveTo(66, 68, 56, 54); g.stroke();
    heart(g, 50, 50, 16, '#9C7BFF', '#7353D6');
    sparkle(g, 36, 74, 5); sparkle(g, 62, 80, 4); sparkle(g, 54, 66, 3.5);
    sparkle(g, 82, 26, 8, '#FFD95A');
  },
  gem_hunter(g) {
    const c = ['#B8FFF0', '#7CF0D2', '#3FD8B0', '#2BB894'];
    poly(g, [[26, 38], [36, 24], [64, 24], [74, 38]], c[0], '#2BAE8C');
    poly(g, [[26, 38], [74, 38], [50, 88]], c[2], '#2BAE8C');
    poly(g, [[36, 38], [50, 88], [26, 38]], c[1], false);
    poly(g, [[64, 38], [74, 38], [50, 88]], c[3], false);
    poly(g, [[44, 24], [56, 24], [60, 38], [40, 38]], '#E4FFF8', false);
    g.beginPath(); g.moveTo(26, 38); g.lineTo(36, 24); g.lineTo(64, 24); g.lineTo(74, 38); g.lineTo(50, 88); g.closePath();
    g.strokeStyle = '#2BAE8C'; g.lineWidth = 2.6; g.lineJoin = 'round'; g.stroke();
    sparkle(g, 80, 20, 9); sparkle(g, 18, 60, 6); sparkle(g, 76, 70, 5);
  },
  gem_master(g) {
    poly(g, [[18, 74], [16, 34], [34, 52], [50, 26], [66, 52], [84, 34], [82, 74]], '#FFD95A', '#E0A21F');
    rrect(g, 16, 70, 68, 14, 5, '#FFC94D', '#E0A21F');
    circle(g, 16, 32, 5, '#FFE89A', '#E0A21F'); circle(g, 50, 24, 5.5, '#FFE89A', '#E0A21F'); circle(g, 84, 32, 5, '#FFE89A', '#E0A21F');
    ellipse(g, 32, 77, 5, 4, '#FF6FB5', '#D94A8C'); ellipse(g, 50, 77, 5.5, 4.5, '#5CC8FF', '#3A9AD6'); ellipse(g, 68, 77, 5, 4, '#3FE0B5', '#2BAE8C');
    heart(g, 50, 56, 13, '#FF6FB5', '#D94A8C');
    shine(g, 28, 50, 5, 2.5, -1.2);
    sparkle(g, 84, 12, 7);
  },
  rainbow_maker(g) {
    const bands = ['#FF8C8C', '#FFB86B', '#FFE066', '#8EE08A', '#7CCBFF', '#B69CFF'];
    bands.forEach((c, i) => {
      g.beginPath();
      g.arc(50, 70, 42 - i * 5, Math.PI, 0);
      g.strokeStyle = c; g.lineWidth = 5.4; g.lineCap = 'butt'; g.stroke();
    });
    cloud(g, 16, 70, 16);
    cloud(g, 84, 70, 16);
    sparkle(g, 50, 16, 6);
  },
  night_owl(g) {
    g.beginPath(); g.arc(78, 22, 13, 0.7, Math.PI * 1.8); g.arc(84, 17, 10, Math.PI * 1.65, 1.0, true); g.closePath(); paint(g, '#FFE38A', '#F2A91F');
    poly(g, [[28, 30], [34, 16], [42, 30]], '#9C7BFF', '#7353D6');
    poly(g, [[58, 30], [66, 16], [72, 30]], '#9C7BFF', '#7353D6');
    ellipse(g, 50, 58, 28, 32, '#B69CFF', '#7F63E0');
    ellipse(g, 50, 66, 17, 20, '#E6DDFF', false);
    for (let r = 0; r < 3; r++) for (let c = -1; c <= 1; c++) {
      g.beginPath(); g.arc(50 + c * 8, 62 + r * 7, 3, 0, Math.PI); g.strokeStyle = '#C3B1F5'; g.lineWidth = 1.6; g.stroke();
    }
    ellipse(g, 24, 62, 7, 16, '#9C7BFF', '#7F63E0', 0.25);
    ellipse(g, 76, 62, 7, 16, '#9C7BFF', '#7F63E0', -0.25);
    circle(g, 39, 44, 11, '#FFFFFF', '#7F63E0');
    circle(g, 61, 44, 11, '#FFFFFF', '#7F63E0');
    circle(g, 40, 45, 6, INK, false); circle(g, 60, 45, 6, INK, false);
    circle(g, 42, 42, 2.2, '#FFFFFF', false); circle(g, 62, 42, 2.2, '#FFFFFF', false);
    poly(g, [[46, 52], [54, 52], [50, 58]], '#FFB13B', '#E08A1F');
    ellipse(g, 43, 88, 5, 3, '#FFB13B', false); ellipse(g, 57, 88, 5, 3, '#FFB13B', false);
    sparkle(g, 14, 16, 5, '#FFE38A');
  },
  musician(g) {
    const c = '#9C7BFF', s = '#7353D6';
    ellipse(g, 30, 74, 11, 8, c, s, -0.4);
    ellipse(g, 68, 66, 11, 8, c, s, -0.4);
    rrect(g, 37, 26, 5, 48, 2, c, s);
    rrect(g, 75, 18, 5, 48, 2, c, s);
    poly(g, [[37, 26], [80, 16], [80, 28], [37, 38]], c, s);
    shine(g, 27, 71, 3.5, 2);
    shine(g, 65, 63, 3.5, 2);
    heart(g, 16, 30, 12, '#FF8CC6');
    sparkle(g, 88, 44, 6);
  },
  photographer(g) {
    rrect(g, 30, 26, 16, 12, 3, '#8FD3FF', '#4BA6E0');
    rrect(g, 14, 34, 72, 48, 9, '#6CC6FF', '#3A9AD6');
    rrect(g, 14, 42, 72, 10, 0, '#8FD3FF', false);
    circle(g, 50, 58, 17, '#FFFFFF', '#3A9AD6');
    circle(g, 50, 58, 11, '#5A4A9A', '#3F2F80');
    shine(g, 46, 54, 4, 2.5);
    rrect(g, 70, 38, 10, 6, 2, '#FFD95A', '#E0A21F');
    heart(g, 25, 70, 10, '#FF8CC6', false);
  },
  unicorn_rider(g) {
    const mane = ['#FF8CC6', '#FFD95A', '#8EE8CF', '#8FD3FF', '#B69CFF'];
    mane.forEach((c, i) => ellipse(g, 62 + i * 3, 26 + i * 12, 12, 9, c, shade(c, -0.25), 0.6));
    g.beginPath();
    g.moveTo(58, 26);
    g.bezierCurveTo(40, 22, 26, 36, 24, 52);
    g.bezierCurveTo(22, 62, 20, 72, 26, 78);
    g.bezierCurveTo(32, 84, 44, 82, 48, 74);
    g.bezierCurveTo(54, 66, 64, 72, 66, 86);
    g.lineTo(82, 86);
    g.bezierCurveTo(80, 60, 76, 36, 58, 26);
    paint(g, '#FFFFFF', '#C9B8F0');
    ellipse(g, 28, 72, 9, 8, '#FFD1E6', false);
    circle(g, 25, 72, 1.6, '#E07AAE', false);
    poly(g, [[50, 24], [58, 4], [60, 26]], '#FFE38A', '#E0A21F');
    g.strokeStyle = '#E0A21F'; g.lineWidth = 1.6;
    g.beginPath(); g.moveTo(52, 20); g.lineTo(58, 18); g.moveTo(53, 14); g.lineTo(58, 12); g.stroke();
    poly(g, [[62, 28], [68, 16], [70, 32]], '#FFFFFF', '#C9B8F0');
    g.strokeStyle = INK; g.lineWidth = 2.4; g.lineCap = 'round';
    g.beginPath(); g.arc(42, 46, 5, 0.1 * Math.PI, 0.9 * Math.PI); g.stroke();
    g.beginPath(); g.moveTo(38, 49); g.lineTo(35, 52); g.moveTo(41, 51); g.lineTo(40, 55); g.stroke();
    ellipse(g, 40, 58, 5, 3, 'rgba(255,120,160,0.5)', false);
    sparkle(g, 14, 24, 6);
  },
  magic_builder(g) {
    g.save(); g.translate(40, 64); g.rotate(-0.8);
    rrect(g, -4, -4, 44, 8, 4, '#FFFFFF', '#C9B8F0');
    g.fillStyle = '#B69CFF';
    for (let x = 4; x < 40; x += 9) g.fillRect(x, -4, 4, 8);
    g.restore();
    star(g, 68, 32, 20, 9, '#FFD95A', '#E0A21F');
    face(g, 68, 34, 12);
    sparkle(g, 30, 30, 7); sparkle(g, 88, 60, 6); sparkle(g, 48, 14, 5, '#FFD1E6'); sparkle(g, 20, 52, 4, '#CDEBFF');
  },
  world_maker(g) {
    g.beginPath(); g.ellipse(50, 54, 44, 12, -0.3, Math.PI, Math.PI * 2); g.strokeStyle = '#B69CFF'; g.lineWidth = 6; g.stroke();
    circle(g, 50, 50, 28, '#8FD3FF', '#4BA6E0');
    g.save(); g.beginPath(); g.arc(50, 50, 27, 0, Math.PI * 2); g.clip();
    ellipse(g, 38, 42, 12, 9, '#8EE8A8', '#56B85C', 0.4);
    ellipse(g, 62, 62, 13, 8, '#8EE8A8', '#56B85C', -0.3);
    ellipse(g, 64, 34, 6, 4, '#8EE8A8', '#56B85C');
    g.restore();
    shine(g, 38, 36, 7, 4);
    g.beginPath(); g.ellipse(50, 54, 44, 12, -0.3, 0, Math.PI); g.strokeStyle = '#B69CFF'; g.lineWidth = 6; g.stroke();
    sparkle(g, 84, 18, 7); sparkle(g, 14, 20, 5, '#FFD95A');
  },
  splash(g) {
    g.beginPath();
    g.arc(50, 56, 30, 0, Math.PI * 2);
    g.arc(50, 56, 12, 0, Math.PI * 2, true);
    paint(g, '#FF8CC6', '#E0569A');
    g.save();
    g.beginPath(); g.arc(50, 56, 29, 0, Math.PI * 2); g.arc(50, 56, 13, 0, Math.PI * 2, true); g.clip('evenodd');
    g.fillStyle = '#FFFFFF';
    for (let i = 0; i < 4; i++) {
      g.beginPath(); g.moveTo(50, 56); g.arc(50, 56, 32, (i / 4) * Math.PI * 2 + 0.3, (i / 4) * Math.PI * 2 + 0.3 + 0.55); g.closePath(); g.fill();
    }
    g.restore();
    shine(g, 36, 40, 7, 3.5);
    drop(g, 16, 22, 7, '#8FD3FF');
    drop(g, 84, 26, 6, '#8FD3FF');
    drop(g, 86, 76, 5, '#6CC6FF');
  },
  sky_high(g) {
    cloud(g, 26, 80, 18);
    cloud(g, 78, 84, 14);
    g.strokeStyle = '#B98A5E'; g.lineWidth = 1.8;
    g.beginPath(); g.moveTo(38, 56); g.lineTo(44, 72); g.moveTo(62, 56); g.lineTo(56, 72); g.stroke();
    rrect(g, 42, 70, 16, 12, 3, '#E8B070', '#B98A5E');
    g.beginPath(); g.moveTo(50, 62); g.bezierCurveTo(26, 50, 22, 12, 50, 12); g.bezierCurveTo(78, 12, 74, 50, 50, 62); g.closePath();
    paint(g, '#FF8CC6', '#E0569A');
    g.save(); g.clip();
    g.fillStyle = '#FFE38A'; g.fillRect(26, 10, 7, 60); g.fillRect(67, 10, 7, 60);
    g.fillStyle = '#FFFFFF'; g.fillRect(36, 10, 7, 60); g.fillRect(57, 10, 7, 60);
    g.fillStyle = '#B69CFF'; g.fillRect(46, 10, 8, 60);
    g.restore();
    g.beginPath(); g.moveTo(50, 62); g.bezierCurveTo(26, 50, 22, 12, 50, 12); g.bezierCurveTo(78, 12, 74, 50, 50, 62); g.closePath();
    g.strokeStyle = '#E0569A'; g.lineWidth = 2.6; g.stroke();
    shine(g, 38, 24, 5, 3);
    sparkle(g, 86, 20, 6);
  },
  // generic art for stickers other teams add without their own
  _star(g) { star(g, 50, 54, 38, 18, '#FFD95A', '#E0A21F'); face(g, 50, 58, 22); },
  _heart(g) { heart(g, 50, 52, 84, '#FF8CC6', '#E0569A'); face(g, 50, 50, 22); },
  _palette(g) {
    g.beginPath();
    g.moveTo(50, 16);
    g.bezierCurveTo(80, 16, 90, 40, 86, 56);
    g.bezierCurveTo(82, 72, 66, 64, 62, 74);
    g.bezierCurveTo(58, 86, 44, 88, 30, 82);
    g.bezierCurveTo(12, 74, 10, 44, 20, 32);
    g.bezierCurveTo(28, 22, 38, 16, 50, 16);
    paint(g, '#FFE7BD', '#E8B870');
    circle(g, 44, 66, 6, '#FFF6E6', '#E8B870');
    const dots = [[34, 34, '#FF5FA2'], [52, 28, '#FFC94D'], [70, 34, '#3FD8B0'], [74, 50, '#6CC6FF'], [26, 52, '#9C7BFF']];
    for (const [x, y, c] of dots) circle(g, x, y, 7, c);
  },
};

const ICON_ART = { star: '_star', heart: '_heart', home: 'home_sweet_home', moon: 'night_owl', gem: 'gem_hunter', music: 'musician', photo: 'photographer', dress: 'fashionista', fly: 'sky_high', build: 'builder' };

function motifFor(id, def) {
  if (def && typeof def.art === 'function') return def.art;
  if (MOTIFS[id]) return MOTIFS[id];
  return MOTIFS[ICON_ART[def && def.icon]] || MOTIFS._palette;
}

// ---------- die-cut sticker ----------

const cache = new Map(); // key -> { art, shape } master canvases
const urls = new Map();

function canvas(n) {
  const c = document.createElement('canvas');
  c.width = c.height = n;
  return c;
}

/**
 * The master canvases of a sticker: { art (glossy die-cut, or the locked silhouette), shape
 * (the sticker outline in white, for shine effects) }. Cached. Painting only queues canvas
 * commands; nothing is read back here, so it does not stall the game.
 */
function master(id, def, locked, size) {
  const key = `${id}|${locked ? 1 : 0}|${size}`;
  let m = cache.get(key);
  if (m) return m;
  const S = size;
  const motif = canvas(S);
  const mg = motif.getContext('2d');
  mg.save();
  mg.translate(S * 0.1, S * 0.1);
  mg.scale((S * 0.8) / 100, (S * 0.8) / 100);
  try {
    motifFor(id, def)(mg);
  } catch (err) {
    console.warn('[stickers] art failed', id, err);
  }
  mg.restore();

  // the white die-cut border: the motif grown outward in every direction
  const border = canvas(S);
  const bg = border.getContext('2d');
  const bw = S * 0.052;
  for (const r of [bw * 0.5, bw]) {
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2;
      bg.drawImage(motif, Math.cos(a) * r, Math.sin(a) * r);
    }
  }
  bg.globalCompositeOperation = 'source-in';
  bg.fillStyle = locked ? '#F4EFFB' : '#FFFFFF';
  bg.fillRect(0, 0, S, S);

  const out = canvas(S);
  const g = out.getContext('2d');
  // soft drop shadow: the outline, tinted and nudged down (no blur filter needed)
  const shadow = canvas(S);
  const shg = shadow.getContext('2d');
  shg.drawImage(border, 0, 0);
  shg.globalCompositeOperation = 'source-in';
  shg.fillStyle = 'rgba(58,31,77,0.16)';
  shg.fillRect(0, 0, S, S);
  g.drawImage(shadow, 0, S * 0.022);
  g.drawImage(shadow, S * 0.006, S * 0.012);
  g.drawImage(border, 0, 0);
  if (locked) {
    const sil = canvas(S);
    const sg = sil.getContext('2d');
    sg.drawImage(motif, 0, 0);
    sg.globalCompositeOperation = 'source-in';
    sg.fillStyle = '#D9CEEE';
    sg.fillRect(0, 0, S, S);
    g.drawImage(sil, 0, 0);
  } else {
    g.drawImage(motif, 0, 0);
    // glossy shine over the top of the sticker (border included)
    const gloss = canvas(S);
    const gg = gloss.getContext('2d');
    gg.drawImage(border, 0, 0);
    gg.globalCompositeOperation = 'source-in';
    const lg = gg.createLinearGradient(0, 0, S * 0.7, S);
    lg.addColorStop(0, 'rgba(255,255,255,0.55)');
    lg.addColorStop(0.38, 'rgba(255,255,255,0.12)');
    lg.addColorStop(0.4, 'rgba(255,255,255,0)');
    gg.fillStyle = lg;
    gg.fillRect(0, 0, S, S);
    g.drawImage(gloss, 0, 0);
  }
  m = { art: out, shape: border };
  cache.set(key, m);
  return m;
}

function copy(src, className) {
  const c = canvas(src.width);
  c.className = className;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

/** A new <canvas> showing the sticker (glossy, or a locked silhouette). Cheap to call. */
export function stickerCanvas(id, def = null, { locked = false, size = 256 } = {}) {
  return copy(master(id, def, locked, size).art, 'sw-stk-art');
}

/** A new <canvas> with the sticker's outline in white (for a moving shine on top). */
export function stickerShape(id, def = null, { size = 256 } = {}) {
  return copy(master(id, def, false, size).shape, 'sw-stk-shape');
}

/**
 * The sticker as a PNG data URL (cached). This reads the pixels back, which can take a
 * moment on slow devices: prefer stickerCanvas() for anything shown during play.
 */
export function stickerImage(id, def = null, { locked = false, size = 256 } = {}) {
  const key = `${id}|${locked ? 1 : 0}|${size}`;
  let url = urls.get(key);
  if (!url) {
    url = master(id, def, locked, size).art.toDataURL('image/png');
    urls.set(key, url);
  }
  return url;
}

export const STICKER_MOTIFS = Object.keys(MOTIFS).filter((k) => !k.startsWith('_'));
