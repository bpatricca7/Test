// The Storybook panel ('book'): four tiny gentle stories, each page illustrated on a canvas
// with big friendly text and Back / Next buttons. "Read to me" uses speech when the browser
// has it (and reads by itself when Settings > Read aloud is on).

import { icon } from '../../ui/icons.js';

const W = 600, H = 330;

// ---------- drawing kit ----------

function sky(g, top, bottom) {
  const gr = g.createLinearGradient(0, 0, 0, H);
  gr.addColorStop(0, top);
  gr.addColorStop(1, bottom);
  g.fillStyle = gr;
  g.fillRect(0, 0, W, H);
}
function circle(g, x, y, r, c) {
  g.fillStyle = c;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
}
function ellipse(g, x, y, rx, ry, c, rot = 0) {
  g.fillStyle = c;
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  g.fill();
}
function hills(g, c1 = '#A8E68F', c2 = '#8FDB7E') {
  ellipse(g, 150, H + 40, 260, 110, c1);
  ellipse(g, 470, H + 50, 280, 120, c2);
}
/** Cute face: eyes, smile (or frown / sleepy), blush. */
function faceAt(g, x, y, s, mood = 'happy') {
  g.fillStyle = '#3A1F4D';
  g.strokeStyle = '#3A1F4D';
  g.lineWidth = Math.max(2, s * 0.35);
  g.lineCap = 'round';
  if (mood === 'sleepy') {
    for (const dx of [-1, 1]) {
      g.beginPath();
      g.arc(x + dx * s * 1.6, y, s * 0.7, 0.1 * Math.PI, 0.9 * Math.PI);
      g.stroke();
    }
  } else {
    circle(g, x - s * 1.6, y, s * 0.75, '#3A1F4D');
    circle(g, x + s * 1.6, y, s * 0.75, '#3A1F4D');
    circle(g, x - s * 1.4, y - s * 0.3, s * 0.28, '#FFFFFF');
    circle(g, x + s * 1.8, y - s * 0.3, s * 0.28, '#FFFFFF');
  }
  g.beginPath();
  if (mood === 'sad') g.arc(x, y + s * 2.2, s * 0.9, 1.15 * Math.PI, 1.85 * Math.PI);
  else if (mood === 'wow') { circle(g, x, y + s * 1.5, s * 0.6, '#B03A5B'); }
  else g.arc(x, y + s * 0.8, s * 0.9, 0.15 * Math.PI, 0.85 * Math.PI);
  g.stroke();
  g.fillStyle = 'rgba(255,120,160,0.55)';
  g.beginPath();
  g.ellipse(x - s * 2.8, y + s * 1.1, s * 0.8, s * 0.5, 0, 0, Math.PI * 2);
  g.ellipse(x + s * 2.8, y + s * 1.1, s * 0.8, s * 0.5, 0, 0, Math.PI * 2);
  g.fill();
}
function sun(g, x, y, r, mood = 'happy') {
  g.fillStyle = '#FFE070';
  for (let i = 0; i < 12; i++) {
    const a = (i / 12) * Math.PI * 2;
    g.beginPath();
    g.arc(x + Math.cos(a) * r * 1.35, y + Math.sin(a) * r * 1.35, r * 0.18, 0, Math.PI * 2);
    g.fill();
  }
  circle(g, x, y, r, '#FFE070');
  faceAt(g, x, y - r * 0.05, r * 0.14, mood);
}
function cloud(g, x, y, s, color = '#FFFFFF', mood = null) {
  g.fillStyle = color;
  g.beginPath();
  g.arc(x - s * 0.9, y, s * 0.6, 0, Math.PI * 2);
  g.arc(x, y - s * 0.35, s * 0.8, 0, Math.PI * 2);
  g.arc(x + s * 0.9, y, s * 0.6, 0, Math.PI * 2);
  g.arc(x, y + s * 0.2, s * 0.65, 0, Math.PI * 2);
  g.fill();
  if (mood) faceAt(g, x, y, s * 0.11, mood);
}
function starShape(g, x, y, R, color, rot = 0, r = R * 0.5) {
  g.fillStyle = color;
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + rot + (i / 10) * Math.PI * 2;
    const rad = i % 2 === 0 ? R : r;
    g.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  g.closePath();
  g.fill();
}
function star(g, x, y, R, color = '#FFE070', mood = 'happy') {
  g.save();
  g.shadowColor = 'rgba(255,240,160,0.9)';
  g.shadowBlur = R * 0.6;
  starShape(g, x, y, R, color);
  g.restore();
  faceAt(g, x, y + R * 0.05, R * 0.1, mood);
}
function heartShape(g, x, y, s, color) {
  g.fillStyle = color;
  g.beginPath();
  g.moveTo(x, y + s * 0.35);
  g.bezierCurveTo(x - s * 0.9, y - s * 0.25, x - s * 0.4, y - s * 0.95, x, y - s * 0.45);
  g.bezierCurveTo(x + s * 0.4, y - s * 0.95, x + s * 0.9, y - s * 0.25, x, y + s * 0.35);
  g.fill();
}
function flowerAt(g, x, y, s, petal, mood = null) {
  g.fillStyle = '#6CC468';
  g.fillRect(x - s * 0.08, y, s * 0.16, s * 1.6);
  ellipse(g, x + s * 0.3, y + s * 0.9, s * 0.3, s * 0.14, '#6CC468', -0.5);
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    circle(g, x + Math.cos(a) * s * 0.42, y + Math.sin(a) * s * 0.42, s * 0.3, petal);
  }
  circle(g, x, y, s * 0.34, '#FFE070');
  if (mood) faceAt(g, x, y - s * 0.02, s * 0.07, mood);
}
function bunny(g, x, y, s, fur = '#FFFFFF', mood = 'happy') {
  ellipse(g, x - s * 0.35, y - s * 1.55, s * 0.18, s * 0.55, fur, -0.15);
  ellipse(g, x + s * 0.35, y - s * 1.55, s * 0.18, s * 0.55, fur, 0.15);
  ellipse(g, x - s * 0.35, y - s * 1.5, s * 0.08, s * 0.38, '#FFB8D6', -0.15);
  ellipse(g, x + s * 0.35, y - s * 1.5, s * 0.08, s * 0.38, '#FFB8D6', 0.15);
  ellipse(g, x, y, s * 0.7, s * 0.6, fur);
  circle(g, x, y - s * 0.75, s * 0.55, fur);
  circle(g, x + s * 0.68, y + s * 0.1, s * 0.18, fur);
  faceAt(g, x, y - s * 0.78, s * 0.09, mood);
  ellipse(g, x - s * 0.3, y + s * 0.55, s * 0.22, s * 0.12, fur);
  ellipse(g, x + s * 0.3, y + s * 0.55, s * 0.22, s * 0.12, fur);
}
function kitty(g, x, y, s, fur = '#FFB870', mood = 'happy') {
  ellipse(g, x, y, s * 0.75, s * 0.55, fur);
  g.fillStyle = fur;
  g.beginPath();
  g.moveTo(x - s * 0.55, y - s * 1.0);
  g.lineTo(x - s * 0.35, y - s * 1.55);
  g.lineTo(x - s * 0.05, y - s * 1.15);
  g.moveTo(x + s * 0.55, y - s * 1.0);
  g.lineTo(x + s * 0.35, y - s * 1.55);
  g.lineTo(x + s * 0.05, y - s * 1.15);
  g.fill();
  circle(g, x, y - s * 0.8, s * 0.58, fur);
  g.strokeStyle = fur;
  g.lineWidth = s * 0.18;
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(x + s * 0.7, y + s * 0.1);
  g.quadraticCurveTo(x + s * 1.3, y - s * 0.1, x + s * 1.1, y - s * 0.7);
  g.stroke();
  faceAt(g, x, y - s * 0.8, s * 0.09, mood);
  ellipse(g, x, y - s * 0.62, s * 0.06, s * 0.04, '#FF7FA4');
}
function bird(g, x, y, s, c = '#8FD0FF') {
  circle(g, x, y, s * 0.5, c);
  ellipse(g, x - s * 0.1, y + s * 0.05, s * 0.3, s * 0.18, '#6CB8F0', 0.4);
  g.fillStyle = '#FFB84F';
  g.beginPath();
  g.moveTo(x + s * 0.45, y - s * 0.1);
  g.lineTo(x + s * 0.8, y);
  g.lineTo(x + s * 0.45, y + s * 0.1);
  g.fill();
  circle(g, x + s * 0.2, y - s * 0.15, s * 0.08, '#3A1F4D');
}
function strawberry(g, x, y, s) {
  g.fillStyle = '#FF5F7A';
  g.beginPath();
  g.moveTo(x - s, y - s * 0.4);
  g.quadraticCurveTo(x - s, y + s * 0.8, x, y + s * 1.2);
  g.quadraticCurveTo(x + s, y + s * 0.8, x + s, y - s * 0.4);
  g.quadraticCurveTo(x, y - s * 0.8, x - s, y - s * 0.4);
  g.fill();
  g.fillStyle = '#FFE9A0';
  for (let i = 0; i < 12; i++) {
    const px = x + (((i * 37) % 17) / 17 - 0.5) * s * 1.4;
    const py = y + (((i * 23) % 13) / 13) * s * 1.1 - s * 0.2;
    g.fillRect(px, py, s * 0.07, s * 0.1);
  }
  g.fillStyle = '#6CC468';
  for (let i = 0; i < 5; i++) {
    const a = Math.PI + (i / 4) * Math.PI;
    ellipse(g, x + Math.cos(a) * s * 0.35, y - s * 0.55 + Math.sin(a) * s * 0.12, s * 0.3, s * 0.12, '#6CC468', a);
  }
}
function rainbow(g, x, y, r, width = 14) {
  const cols = ['#FF8FA3', '#FFB870', '#FFE070', '#9BE38A', '#7CC8FF', '#B79BFF'];
  cols.forEach((c, i) => {
    g.strokeStyle = c;
    g.lineWidth = width;
    g.beginPath();
    g.arc(x, y, r - i * width, Math.PI, 0);
    g.stroke();
  });
}
function moon(g, x, y, r, bg) {
  circle(g, x, y, r, '#FFF4B8');
  circle(g, x + r * 0.45, y - r * 0.2, r * 0.85, bg);
}
function twinkles(g, n, seed = 1) {
  for (let i = 0; i < n; i++) {
    const x = ((i * 97 + seed * 31) % W), y = ((i * 53 + seed * 17) % (H * 0.6));
    starShape(g, x, y, 3 + (i % 3) * 2, '#FFF4B8');
  }
}
function drops(g, x0, x1, y0, y1) {
  g.fillStyle = '#8FD0FF';
  for (let i = 0; i < 18; i++) {
    const x = x0 + ((i * 41) % (x1 - x0)), y = y0 + ((i * 67) % (y1 - y0));
    ellipse(g, x, y, 3, 6, '#8FD0FF');
  }
}
function firefly(g, x, y, s) {
  g.save();
  g.shadowColor = 'rgba(220,255,120,1)';
  g.shadowBlur = s * 2;
  circle(g, x, y, s * 0.5, '#E9FF8A');
  g.restore();
  circle(g, x - s * 0.6, y - s * 0.3, s * 0.35, '#3A3A6A');
  ellipse(g, x - s * 0.3, y - s * 0.8, s * 0.4, s * 0.2, 'rgba(255,255,255,0.8)', -0.5);
  faceAt(g, x - s * 0.6, y - s * 0.32, s * 0.06);
}
function grass(g, y = H - 40, c = '#9BE38A') {
  g.fillStyle = c;
  g.fillRect(0, y, W, H - y);
}

// ---------- the stories ----------

export const STORIES = [
  {
    key: 'strawberry', title: "Bunny's Big Strawberry", cover: '#FFD6E8',
    drawCover(g) { sky(g, '#BDEBFF', '#FFF1F8'); hills(g); strawberry(g, 300, 150, 60); bunny(g, 150, 250, 55); },
    pages: [
      ['Bunny found a tiny seed in the grass.', (g) => { sky(g, '#9ED8FF', '#E6F7FF'); hills(g); bunny(g, 250, 250, 60); circle(g, 370, 280, 7, '#C98A4B'); starShape(g, 385, 262, 8, '#FFE070'); cloud(g, 120, 70, 40); }],
      ['She planted it and gave it a drink of water.', (g) => { sky(g, '#9ED8FF', '#E6F7FF'); hills(g); bunny(g, 220, 250, 60); g.fillStyle = '#7CC8FF'; g.fillRect(280, 200, 50, 34); g.fillRect(328, 190, 30, 8); drops(g, 355, 395, 205, 260); g.fillStyle = '#6CC468'; g.fillRect(393, 262, 5, 25); ellipse(g, 405, 262, 12, 6, '#6CC468', -0.4); }],
      ['The sun smiled. The seed grew and grew!', (g) => { sky(g, '#8FD3FF', '#FFF6D8'); sun(g, 480, 80, 45); hills(g); g.fillStyle = '#6CC468'; g.fillRect(296, 150, 10, 150); for (const [x, y, r] of [[270, 190, 0.6], [330, 170, -0.6], [275, 240, 0.5], [330, 225, -0.5]]) ellipse(g, x, y, 30, 12, '#6CC468', r); bunny(g, 150, 260, 50, '#FFFFFF', 'wow'); }],
      ['Wow! A giant strawberry!', (g) => { sky(g, '#FFD6E8', '#FFF6D8'); hills(g); strawberry(g, 330, 150, 100); bunny(g, 140, 260, 55, '#FFFFFF', 'wow'); twinkles(g, 10, 3); }],
      ['Bunny shared it with all her friends. Yum!', (g) => { sky(g, '#BDEBFF', '#FFF1F8'); hills(g); strawberry(g, 300, 185, 55); bunny(g, 160, 265, 50); kitty(g, 440, 270, 50); bird(g, 300, 80, 40); heartShape(g, 230, 110, 30, '#FF6FA8'); heartShape(g, 380, 120, 24, '#FF9CCB'); }],
    ],
  },
  {
    key: 'star', title: 'Little Star Finds a Friend', cover: '#E6DDFF',
    drawCover(g) { sky(g, '#2E2A6E', '#6B4FA8'); twinkles(g, 20); star(g, 300, 150, 70); },
    pages: [
      ['Little Star lived high up in the night sky.', (g) => { sky(g, '#2E2A6E', '#6B4FA8'); twinkles(g, 30, 2); moon(g, 480, 90, 45, '#3A3480'); star(g, 250, 150, 50); }],
      ['But Little Star felt a little bit lonely.', (g) => { sky(g, '#26235E', '#4A3F8E'); twinkles(g, 12, 5); star(g, 300, 160, 45, '#FFE9A0', 'sad'); }],
      ['So she slid down a rainbow, whee!', (g) => { sky(g, '#6B4FA8', '#FFB3C6'); rainbow(g, 300, 330, 260, 18); star(g, 150, 120, 36); grass(g, H - 30); }],
      ['In the meadow she met Firefly. Blink, blink, hello!', (g) => { sky(g, '#2E2A6E', '#4A5FA8'); grass(g, H - 60, '#3E7A5A'); star(g, 220, 170, 45); firefly(g, 400, 160, 30); for (const x of [60, 120, 500, 560]) flowerAt(g, x, H - 90, 22, '#C8A6FF'); }],
      ['Now they light up the night together!', (g) => { sky(g, '#2E2A6E', '#4A5FA8'); twinkles(g, 20, 7); grass(g, H - 50, '#3E7A5A'); star(g, 250, 150, 45); firefly(g, 380, 140, 28); firefly(g, 470, 210, 18); firefly(g, 120, 220, 16); heartShape(g, 315, 80, 26, '#FF9CCB'); }],
    ],
  },
  {
    key: 'kitty', title: "Kitty's Cozy Nap", cover: '#FFF1D6',
    drawCover(g) { sky(g, '#FFF1D6', '#FFD6E8'); ellipse(g, 300, 260, 180, 40, '#FF9CCB'); kitty(g, 300, 220, 70, '#FFB870', 'sleepy'); },
    pages: [
      ['Kitty was sleepy. She looked for the coziest spot.', (g) => { sky(g, '#FFF1D6', '#FFE3F0'); g.fillStyle = '#E7BE8C'; g.fillRect(0, H - 60, W, 60); kitty(g, 300, 240, 70, '#FFB870', 'sleepy'); g.font = 'bold 36px sans-serif'; g.fillStyle = '#9C7BFF'; g.fillText('z z z', 390, 120); }],
      ['The box was too small!', (g) => { sky(g, '#FFF1D6', '#FFE3F0'); g.fillStyle = '#E7BE8C'; g.fillRect(0, H - 60, W, 60); g.fillStyle = '#D9A066'; g.fillRect(230, 200, 140, 90); g.fillStyle = '#C98A4B'; g.fillRect(230, 200, 140, 14); kitty(g, 300, 190, 60, '#FFB870', 'wow'); }],
      ['The basket was too wobbly!', (g) => { sky(g, '#FFF1D6', '#FFE3F0'); g.fillStyle = '#E7BE8C'; g.fillRect(0, H - 60, W, 60); g.save(); g.translate(300, 250); g.rotate(-0.25); g.fillStyle = '#E0B070'; g.fillRect(-80, -30, 160, 60); g.strokeStyle = '#C99555'; g.lineWidth = 4; for (let i = -70; i < 80; i += 20) { g.beginPath(); g.moveTo(i, -30); g.lineTo(i, 30); g.stroke(); } g.restore(); kitty(g, 290, 200, 55, '#FFB870', 'wow'); }],
      ['The soft blanket next to her best friend was just right. Purr!', (g) => { sky(g, '#FFE3F0', '#E6DDFF'); g.fillStyle = '#E7BE8C'; g.fillRect(0, H - 60, W, 60); ellipse(g, 300, 270, 200, 45, '#FF9CCB'); for (let i = 0; i < 8; i++) heartShape(g, 140 + i * 45, 270 + (i % 2) * 12, 14, '#FFFFFF'); kitty(g, 260, 235, 55, '#FFB870', 'sleepy'); bunny(g, 390, 240, 45, '#FFFFFF', 'sleepy'); heartShape(g, 330, 120, 30, '#FF6FA8'); }],
    ],
  },
  {
    key: 'cloud', title: 'The Cloud Who Made Rainbows', cover: '#DDF3FF',
    drawCover(g) { sky(g, '#9ED8FF', '#FFF1F8'); rainbow(g, 300, 260, 190, 16); cloud(g, 300, 150, 70, '#FFFFFF', 'happy'); },
    pages: [
      ['Cloud was sad. "All I make is rain," she said.', (g) => { sky(g, '#B8C8E0', '#E6EEF8'); cloud(g, 300, 110, 80, '#E4E8F4', 'sad'); drops(g, 220, 380, 170, 290); grass(g, H - 30); }],
      ['"But we love rain!" said the flowers. "It helps us grow!"', (g) => { sky(g, '#C8DAF0', '#EAF4FF'); cloud(g, 300, 80, 60, '#EEF0F8', 'wow'); grass(g, H - 40); for (const [x, c] of [[120, '#FF8FB8'], [220, '#FFE070'], [320, '#C8A6FF'], [420, '#FF9E8F'], [510, '#8FD0FF']]) flowerAt(g, x, 210, 38, c, 'happy'); }],
      ['Then Sun peeked out and gave Cloud a big hug.', (g) => { sky(g, '#9ED8FF', '#FFF6D8'); sun(g, 380, 130, 60); cloud(g, 240, 150, 70, '#FFFFFF', 'happy'); heartShape(g, 310, 60, 28, '#FF6FA8'); grass(g, H - 30); }],
      ['And look... a RAINBOW!', (g) => { sky(g, '#8FD3FF', '#FFF1F8'); rainbow(g, 300, 330, 270, 22); cloud(g, 90, 300, 60, '#FFFFFF', 'happy'); cloud(g, 510, 300, 60, '#FFFFFF', 'wow'); twinkles(g, 8, 9); }],
      ['Now Cloud smiles every time it rains.', (g) => { sky(g, '#9ED8FF', '#FFF1F8'); rainbow(g, 300, 250, 170, 14); cloud(g, 300, 110, 65, '#FFFFFF', 'happy'); grass(g, H - 45); for (const [x, c] of [[80, '#FF8FB8'], [200, '#FFE070'], [400, '#C8A6FF'], [520, '#FF9E8F']]) flowerAt(g, x, 250, 28, c, 'happy'); }],
    ],
  },
];

const CSS = /* css */ `
.sw-books { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 16px; }
.sw-bookcard { display: flex; flex-direction: column; align-items: center; gap: 8px; padding: 10px; border-radius: 22px; background: #fff; border: 4px solid var(--sw-pink-soft); cursor: pointer; box-shadow: 0 6px 14px var(--sw-shadow); transition: transform .18s var(--sw-bounce); font-family: var(--sw-font); }
.sw-bookcard:hover { transform: translateY(-4px) rotate(-1deg); }
.sw-bookcard:active { transform: scale(.95); }
.sw-bookcard canvas { width: 100%; aspect-ratio: 600 / 330; border-radius: 14px; border-left: 8px solid var(--bc, #FF9CCB); }
.sw-bookcard span { font-size: 18px; font-weight: 700; color: var(--sw-ink); text-align: center; line-height: 1.15; }
.sw-reader { display: flex; flex-direction: column; gap: 12px; }
.sw-reader canvas { width: 100%; max-height: 46vh; object-fit: contain; border-radius: 20px; border: 5px solid #fff; box-shadow: 0 8px 20px var(--sw-shadow); background: #fff; }
.sw-reader-text { font-size: clamp(22px, 3.2vw, 30px); font-weight: 600; text-align: center; color: var(--sw-ink); line-height: 1.3; min-height: 2.6em; display: flex; align-items: center; justify-content: center; padding: 0 8px; }
.sw-reader-nav { display: flex; align-items: center; justify-content: space-between; gap: 10px; }
.sw-dots-row { display: flex; gap: 8px; }
.sw-dots-row span { width: 14px; height: 14px; border-radius: 50%; background: var(--sw-lav-soft); }
.sw-dots-row span.sw-on { background: var(--sw-pink); transform: scale(1.2); }
.sw-reader-end { display: flex; gap: 12px; justify-content: center; flex-wrap: wrap; }
`;

export function installBook(game) {
  const ui = game.ui;
  ui.addStyles(CSS);
  let root, story = null, page = 0, canvas, textEl, dotsEl, navEl, endEl, speakBtn;
  const canSpeak = typeof window !== 'undefined' && 'speechSynthesis' in window && typeof window.SpeechSynthesisUtterance === 'function';

  function speak(text) {
    if (!canSpeak) return;
    try {
      window.speechSynthesis.cancel();
      const u = new window.SpeechSynthesisUtterance(text);
      u.rate = 0.9;
      u.pitch = 1.15;
      window.speechSynthesis.speak(u);
    } catch (_) { /* no voice here */ }
  }

  function showShelf() {
    story = null;
    ui.setTitle('book', 'Storybooks');
    root.innerHTML = '';
    const grid = ui.el('div', 'sw-books');
    for (const s of STORIES) {
      const card = ui.el('button', 'sw-bookcard');
      card.type = 'button';
      card.dataset.story = s.key;
      card.style.setProperty('--bc', s.cover);
      const c = document.createElement('canvas');
      c.width = W;
      c.height = H;
      s.drawCover(c.getContext('2d'));
      card.append(c, ui.el('span', '', s.title));
      card.addEventListener('click', () => {
        game.audio.play('page');
        openStory(s);
      });
      grid.appendChild(card);
    }
    root.appendChild(grid);
  }

  function openStory(s) {
    story = s;
    page = 0;
    ui.setTitle('book', s.title);
    root.innerHTML = '';
    const wrap = ui.el('div', 'sw-reader');
    canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    textEl = ui.el('div', 'sw-reader-text');
    navEl = ui.el('div', 'sw-reader-nav');
    const back = ui.button({ icon: 'back', label: 'Back', variant: 'white', className: 'sw-book-back', onClick: () => turn(-1) });
    const next = ui.button({ icon: 'play', label: 'Next', variant: 'pink', className: 'sw-book-next', onClick: () => turn(1) });
    dotsEl = ui.el('div', 'sw-dots-row');
    const mid = ui.el('div', 'sw-dots-row');
    mid.style.alignItems = 'center';
    mid.appendChild(dotsEl);
    if (canSpeak) {
      speakBtn = ui.button({ icon: 'sound', variant: 'sky', size: 'icon', title: 'Read to me', onClick: () => speak(story.pages[page][0]) });
      mid.appendChild(speakBtn);
    }
    navEl.append(back, mid, next);
    endEl = ui.el('div', 'sw-reader-end');
    endEl.append(
      ui.button({ icon: 'undo', label: 'Read again', variant: 'lav', onClick: () => openStory(story) }),
      ui.button({ icon: 'star', label: 'More books', variant: 'mint', className: 'sw-book-more', onClick: showShelf }),
    );
    wrap.append(canvas, textEl, navEl, endEl);
    root.appendChild(wrap);
    render();
  }

  function render() {
    const [text, draw] = story.pages[page];
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, W, H);
    try { draw(g); } catch (err) { console.warn('[book] page art failed', err); }
    const last = page === story.pages.length - 1;
    if (last) {
      g.font = 'bold 30px sans-serif';
      g.fillStyle = 'rgba(255,255,255,0.9)';
      g.fillRect(W - 170, 12, 156, 44);
      g.fillStyle = '#FF5FA2';
      g.fillText('The End', W - 150, 44);
    }
    textEl.textContent = text;
    dotsEl.innerHTML = '';
    story.pages.forEach((_, i) => dotsEl.appendChild(ui.el('span', i === page ? 'sw-on' : '')));
    navEl.children[0].style.visibility = page === 0 ? 'hidden' : 'visible';
    navEl.children[2].style.visibility = last ? 'hidden' : 'visible';
    endEl.style.display = last ? 'flex' : 'none';
    if (game.profile.settings.readAloud) speak(text);
  }

  function turn(dir) {
    if (!story) return;
    const n = page + dir;
    if (n < 0 || n >= story.pages.length) return;
    page = n;
    game.audio.play('page');
    render();
    if (page === story.pages.length - 1) game.audio.play('success', { volume: 0.6 });
  }

  const onKey = (e) => {
    if (!ui.isOpen('book') || !story || ui.dialogOpen) return;
    if (e.code === 'ArrowRight' || e.code === 'Space') { e.preventDefault(); turn(1); }
    else if (e.code === 'ArrowLeft') { e.preventDefault(); turn(-1); }
  };

  ui.registerPanel('book', {
    title: 'Storybooks',
    icon: 'star',
    width: 760,
    build(container) {
      root = ui.el('div');
      container.appendChild(root);
    },
    onOpen(args) {
      const want = args && args.story && STORIES.find((s) => s.key === args.story);
      if (want) openStory(want);
      else showShelf();
      window.addEventListener('keydown', onKey);
    },
    onClose() {
      window.removeEventListener('keydown', onKey);
      if (canSpeak) try { window.speechSynthesis.cancel(); } catch (_) { /* ignore */ }
    },
  });
  return { STORIES, turn };
}
