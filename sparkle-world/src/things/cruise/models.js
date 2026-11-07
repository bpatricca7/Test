// Cruise furniture models (furniture Kit: static parts merge into the world's furniture
// batches; moving bits are named parts). Model space: block units, footprint [0,w] x [0,h] x
// [0,d], front = +Z. All designs are our own: candy-pastel ship fittings for the Glimmer Star.
//
//   slideGate      1x3x1  striped arch with the slide's name and a swinging gate bar
//   waterSlide     2x4x6  a whole little water slide (ladder, deck, twisting chute)
//   lift           1x2x1  a glass lift booth with a glowing button panel
//   arcade         1x2x1  arcade cabinet; the screen and marquee show its game
//   hoops          1x3x1  basketball hoop with a ball rack
//   ringToss       2x1x1  a table of bottles and rings
//   shuffle        1x1x4  a shuffleboard court with pucks and a cue
//   golfSign       1x2x1  "Mini Golf" sign with a ball on a tee
//   golfFlag       1x2x1  a hole's flag (waves) over the cup
//   djBooth        2x3x1  DJ deck with turntables, speakers and a disco ball
//   movieScreen    5x3x1  a big outdoor screen (any size from its data), per-piece canvas
//   wheel          1x2x1  the captain's wheel on a brass pedestal
//   board          2x2x1  the "What's On" board
//   float          1x1x1  pool floats: donut, duck, star, melon, unicorn, turtle
//   lounger        1x1x2  a sun lounger
//   towel          1x1x1  folded towel animals: swan, elephant, bunny, puppy
//   bell           1x2x1  the ship's bell

import * as THREE from 'three';
import { Kit } from '../furniture/kit.js';
import { material, paintTexture, glow, sheer } from '../furniture/paint.js';
import { shade, mixHex } from '../../core/util.js';
import { TV_W, TV_H } from '../furniture/tv.js';

const WHITE = '#FFFFFF', CREAM = '#FFF6EC', INK = '#3A1F4D', GOLD = '#FFC94D', NAVY = '#4B3A78', AQUA = '#4FB8FF';
const FONT = "'Fredoka', ui-rounded, 'Arial Rounded MT Bold', 'Trebuchet MS', system-ui, sans-serif";

export const GATE_COLORS = ['#FF7EB6', '#4FB8FF', '#FFC94D', '#3FD8B0', '#9C7BFF', '#FF9F43'];
export const SLIDE_COLORS = ['#4FB8FF', '#FF7EB6', '#FFC94D', '#3FD8B0', '#9C7BFF', '#FF9F43'];
export const LIFT_COLORS = ['#FFC94D', '#FF9CCB', '#A6D8FF', '#9BE8CF', '#C8B4FF', '#FFFFFF'];
// the arcade's color picks its game: pink Star Catcher, blue Bubble Pop, mint Fish Match
export const ARCADE_COLORS = ['#FF7EB6', '#4FB8FF', '#3FD8B0'];
export const GAME_COLORS = ['#FF9F43', '#FF7EB6', '#4FB8FF', '#3FD8B0', '#9C7BFF', '#FFC94D'];
export const DJ_COLORS = ['#9C7BFF', '#FF5FA2', '#4FB8FF', '#3FD8B0', '#FFC94D', '#4B3A78'];
export const SCREEN_COLORS = ['#FFFFFF', '#FF9CCB', '#4B3A78', '#A6D8FF', '#FFC94D', '#C8B4FF'];
export const WHEEL_COLORS = ['#C98F55', '#FF9CCB', '#A6D8FF', '#9BE8CF', '#C8B4FF', '#FFC94D'];
export const BOARD_COLORS = ['#4FB8FF', '#FF7EB6', '#3FD8B0', '#9C7BFF', '#FFC94D', '#FF9F43'];
// the float's color picks its shape: donut, duck, star, melon, unicorn, turtle
export const FLOAT_COLORS = ['#FF9CCB', '#FFE14D', '#4FB8FF', '#FF6F7D', '#C8B4FF', '#5FD39A'];
export const LOUNGER_COLORS = ['#4FB8FF', '#FF9CCB', '#FFE38F', '#9BE8CF', '#C8B4FF', '#FFBFA0'];
export const TOWEL_COLORS = ['#FFFFFF', '#FFD1E6', '#DDF3FF', '#E2FBF0', '#F1E8FF', '#FFF6D8'];
export const BELL_COLORS = ['#FFC94D', '#E8B04A', '#FFD98A', '#F2C14E'];
export const ARCADE_GAMES = ['star', 'bubble', 'fish'];
export const ARCADE_NAMES = { star: 'Star Catcher', bubble: 'Bubble Pop', fish: 'Fish Match' };

// ---------- textures ----------

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function star(ctx, x, y, R, r, rot = 0) {
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + rot + (i / 10) * Math.PI * 2;
    const rad = i % 2 === 0 ? R : r;
    ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad);
  }
  ctx.closePath();
}

/** Bubbly words on a rounded board. */
function signMat(key, text, { w = 256, h = 64, bg = '#FFFDF8', fg = '#FF5FA2', edge = '#FFD1E6', glowing = false } = {}) {
  const k = `cruise-sign|${key}|${text}|${bg}|${fg}`;
  const map = paintTexture(k, w, h, (ctx) => {
    ctx.fillStyle = bg;
    roundRect(ctx, 2, 2, w - 4, h - 4, h * 0.3);
    ctx.fill();
    ctx.fillStyle = edge;
    for (let x = 16; x < w - 8; x += 26) {
      ctx.beginPath(); ctx.arc(x, 8, 3, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(x, h - 8, 3, 0, Math.PI * 2); ctx.fill();
    }
    ctx.font = `700 ${Math.round(h * 0.55)}px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const tw = ctx.measureText(text).width;
    const s = Math.min(1, (w * 0.86) / Math.max(1, tw));
    ctx.save();
    ctx.translate(w / 2, h / 2 + 2);
    ctx.scale(s, 1);
    ctx.lineJoin = 'round';
    ctx.lineWidth = h * 0.1;
    ctx.strokeStyle = '#FFFFFF';
    ctx.strokeText(text, 0, 0);
    ctx.fillStyle = fg;
    ctx.fillText(text, 0, 0);
    ctx.restore();
  }, { repeat: false, smooth: true });
  return material(k, glowing ? { map, uvFit: true, emissive: '#FFFFFF', emissiveIntensity: 0.55, emissiveMap: map } : { map, uvFit: true });
}

/** An arcade screen picture (glowing): the game's own little title scene. */
function arcadeScreenMat(game) {
  const k = `cruise-arcade-screen|${game}`;
  const map = paintTexture(k, 64, 64, (ctx, w, h) => {
    const bg = ctx.createLinearGradient(0, 0, 0, h);
    if (game === 'bubble') { bg.addColorStop(0, '#7FD3F7'); bg.addColorStop(1, '#2F78C8'); }
    else if (game === 'fish') { bg.addColorStop(0, '#9BE8CF'); bg.addColorStop(1, '#2E9E86'); }
    else { bg.addColorStop(0, '#2A2766'); bg.addColorStop(1, '#6B4FA8'); }
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);
    if (game === 'bubble') {
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = 2;
      for (const [x, y, r] of [[16, 40, 9], [40, 24, 12], [48, 50, 6], [22, 14, 5]]) {
        ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.stroke();
        ctx.fillStyle = 'rgba(255,255,255,0.7)'; ctx.fillRect(x - r * 0.5, y - r * 0.5, 2, 2);
      }
      ctx.fillStyle = '#FF9F43';
      ctx.beginPath(); ctx.ellipse(40, 24, 5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
    } else if (game === 'fish') {
      const cols = ['#FF7EB6', '#FFC94D', '#4FB8FF', '#9C7BFF'];
      for (let i = 0; i < 6; i++) {
        const x = 6 + (i % 3) * 19, y = 10 + Math.floor(i / 3) * 24;
        ctx.fillStyle = '#FFFFFF';
        roundRect(ctx, x, y, 15, 20, 3); ctx.fill();
        ctx.fillStyle = cols[i % 4];
        ctx.beginPath(); ctx.ellipse(x + 7.5, y + 10, 5, 3.5, 0, 0, Math.PI * 2); ctx.fill();
      }
    } else {
      for (let i = 0; i < 14; i++) { ctx.fillStyle = 'rgba(255,246,216,0.8)'; ctx.fillRect((i * 37) % w, (i * 23) % h, 1.5, 1.5); }
      const cols = ['#FFE070', '#FF9CCB', '#9FE0FF'];
      for (let i = 0; i < 3; i++) {
        ctx.fillStyle = cols[i];
        star(ctx, 14 + i * 18, 18 + (i % 2) * 18, 8, 3.6, i * 0.3);
        ctx.fill();
      }
      ctx.fillStyle = '#FFFFFF';
      roundRect(ctx, 20, 50, 24, 7, 3); ctx.fill();
    }
  }, { repeat: false, smooth: false });
  return material(k, { map, uvFit: true, emissive: '#FFFFFF', emissiveIntensity: 0.9, emissiveMap: map });
}

/** Shuffleboard court lines: the scoring triangle at the far end. */
function courtMat(color) {
  const k = `cruise-court|${color}`;
  const map = paintTexture(k, 32, 128, (ctx, w, h) => {
    ctx.fillStyle = '#E9C99A';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = 'rgba(160,110,60,0.18)';
    for (let i = 0; i < 12; i++) ctx.fillRect(0, i * 11, w, 1);
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, 2, h);
    ctx.fillRect(w - 2, 0, 2, h);
    // the triangle (far end = top of the picture)
    ctx.strokeStyle = INK;
    ctx.lineWidth = 1.2;
    ctx.beginPath(); ctx.moveTo(w / 2, 4); ctx.lineTo(w - 4, 46); ctx.lineTo(4, 46); ctx.closePath(); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(7, 32); ctx.lineTo(w - 7, 32); ctx.moveTo(10, 20); ctx.lineTo(w - 10, 20); ctx.stroke();
    ctx.fillStyle = INK;
    ctx.font = '700 7px sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('10', w / 2, 17);
    ctx.fillText('8', w / 2, 29);
    ctx.fillText('7', w / 2, 42);
    ctx.fillStyle = color;
    ctx.fillRect(2, h - 22, w - 4, 2);
  }, { repeat: false, smooth: false });
  return material(k, { map, uvFit: true });
}

/** The "What's On" board's face: a title and little pictures of what there is to do. */
function boardMat(color) {
  const k = `cruise-board|${color}`;
  const map = paintTexture(k, 256, 192, (ctx, w, h) => {
    ctx.fillStyle = '#FFFDF8';
    roundRect(ctx, 0, 0, w, h, 22); ctx.fill();
    ctx.fillStyle = color;
    roundRect(ctx, 8, 8, w - 16, 44, 16); ctx.fill();
    ctx.font = `700 30px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#FFFFFF';
    ctx.fillText("What's On!", w / 2, 31);
    const tiles = [
      ['#4FB8FF', (x, y) => { ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 4; ctx.beginPath(); ctx.moveTo(x - 16, y + 6); ctx.quadraticCurveTo(x - 8, y - 2, x, y + 6); ctx.quadraticCurveTo(x + 8, y + 14, x + 16, y + 6); ctx.stroke(); }],
      ['#FF7EB6', (x, y) => { ctx.strokeStyle = '#FFFFFF'; ctx.lineWidth = 6; ctx.beginPath(); ctx.moveTo(x - 14, y - 14); ctx.bezierCurveTo(x + 14, y - 10, x - 14, y + 6, x + 14, y + 14); ctx.stroke(); }],
      ['#9C7BFF', (x, y) => { ctx.fillStyle = '#FFE070'; star(ctx, x, y, 15, 6.5); ctx.fill(); }],
      ['#FF9F43', (x, y) => { ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(x, y, 13, 0, Math.PI * 2); ctx.fill(); ctx.strokeStyle = '#FF9F43'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x - 13, y); ctx.lineTo(x + 13, y); ctx.moveTo(x, y - 13); ctx.lineTo(x, y + 13); ctx.stroke(); }],
      ['#3FD8B0', (x, y) => { ctx.fillStyle = '#FFFFFF'; ctx.fillRect(x - 1.5, y - 16, 3, 30); ctx.fillStyle = '#FF5FA2'; ctx.beginPath(); ctx.moveTo(x + 1.5, y - 16); ctx.lineTo(x + 16, y - 10); ctx.lineTo(x + 1.5, y - 4); ctx.fill(); }],
      ['#FF5FA2', (x, y) => { ctx.fillStyle = '#FFFFFF'; ctx.beginPath(); ctx.arc(x, y, 12, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = '#C8B4FF'; ctx.fillRect(x - 12, y - 1, 24, 3); ctx.fillRect(x - 1, y - 12, 3, 24); }],
    ];
    tiles.forEach(([c, draw], i) => {
      const x = 46 + (i % 3) * 82, y = 92 + Math.floor(i / 3) * 62;
      ctx.fillStyle = c;
      roundRect(ctx, x - 32, y - 24, 64, 50, 14); ctx.fill();
      draw(x, y);
    });
  }, { repeat: false, smooth: true });
  return material(k, { map, uvFit: true });
}

/** Disco ball tiles (glowing, a mirror-ish checker). */
function discoMat() {
  const k = 'cruise-disco';
  const map = paintTexture(k, 16, 16, (ctx) => {
    for (let y = 0; y < 16; y += 4) {
      for (let x = 0; x < 16; x += 4) {
        const v = 200 + ((x * 7 + y * 13) % 55);
        ctx.fillStyle = `rgb(${v},${v},${Math.min(255, v + 20)})`;
        ctx.fillRect(x, y, 4, 4);
        ctx.fillStyle = 'rgba(80,70,120,0.35)';
        ctx.fillRect(x, y, 4, 0.6);
        ctx.fillRect(x, y, 0.6, 4);
      }
    }
  });
  return material(k, { map, emissive: '#FFFFFF', emissiveIntensity: 0.35, emissiveMap: map });
}

// ---------- shared bits ----------

/** A standing disc facing +Z (base at z). */
function discZ(k, r, t, paint, x, y, z, seg = 20) {
  return k.cyl(r, t, paint, x, y, z, seg, { rot: [Math.PI / 2, 0, 0] });
}

/** A candy-striped post (square, bands of two colors). */
function stripedPost(k, x, z, h, c1, c2, t = 0.14, band = 0.22) {
  const n = Math.max(1, Math.round(h / band));
  const bh = h / n;
  for (let i = 0; i < n; i++) k.box(t, bh, t, i % 2 ? c2 : c1, x - t / 2, i * bh, z - t / 2);
}

/** A row of little glowing bulbs from a to b. */
function bulbs(k, a, b, n, colors, r = 0.045) {
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? 0.5 : i / (n - 1);
    k.ball(r, glow(colors[i % colors.length], 0.9), a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t, { seg: 6 });
  }
}

const BULB_COLS = ['#FFE070', '#FF9CCB', '#9FE0FF', '#B8F5C8'];

// ---------- slide gate ----------

export function slideGate(color = GATE_COLORS[0], data = {}) {
  const k = new Kit();
  const c = color || GATE_COLORS[0];
  const name = (data && typeof data.n === 'string' && data.n) || 'Water Slide';
  stripedPost(k, 0.1, 0.5, 2.5, c, WHITE);
  stripedPost(k, 0.9, 0.5, 2.5, c, WHITE);
  // a round arch over the top
  for (let i = 0; i <= 8; i++) {
    const a = Math.PI * (i / 8);
    k.box(0.16, 0.16, 0.16, i % 2 ? WHITE : c, 0.5 + Math.cos(a) * 0.42 - 0.08, 2.4 + Math.sin(a) * 0.22, 0.42);
  }
  // the name board (both sides)
  const sm = signMat('gate', name, { fg: shade(c, -0.15), edge: mixHex(c, '#FFFFFF', 0.6) });
  k.box(1.4, 0.4, 0.06, CREAM, -0.2, 2.62, 0.47, { faces: { pz: sm, nz: sm } });
  k.ball(0.11, glow(GOLD, 0.7), 0.5, 3.12, 0.5, { seg: 8 });
  bulbs(k, [-0.15, 2.66, 0.55], [1.15, 2.66, 0.55], 6, BULB_COLS);
  // the gate bar swings up when she goes
  const bar = k.part('bar', 0.17, 0.95, 0.5);
  bar.box(0.66, 0.08, 0.08, WHITE, 0, -0.04, -0.04);
  bar.box(0.12, 0.12, 0.1, c, 0.54, -0.06, -0.05);
  // a splashy wave sticker on each post
  k.ball(0.08, AQUA, 0.1, 1.6, 0.6, { seg: 6 });
  k.ball(0.08, AQUA, 0.9, 1.6, 0.6, { seg: 6 });
  k.hitbox(0, 0, 0.3, 1, 2.8, 0.7);
  return k.build();
}
export const GATE_COLLIDERS = [[0.02, 0, 0.42, 0.18, 2.5, 0.58], [0.82, 0, 0.42, 0.98, 2.5, 0.58]];

// ---------- the little water slide (Bag) ----------

// her seat along the chute, model space (back = ladder, front = +Z exit)
export const WATERSLIDE_TOP = [1, 3.22, 0.75];
function chuteAt(t) {
  const y = 0.32 + 2.9 * Math.pow(1 - t, 1.35) * (1 - 0.08 * Math.sin(t * Math.PI * 2));
  return [1 + 0.42 * Math.sin(t * Math.PI * 2), y, 1.25 + 4.5 * t];
}
/** The ride's points in model space: deck, chute, and out past the front (into a pool there). */
export function waterSlidePath() {
  const pts = [WATERSLIDE_TOP.slice(), [1, 3.22, 1.15]];
  const N = 18;
  for (let i = 0; i <= N; i++) {
    const p = chuteAt(i / N);
    pts.push([p[0], p[1] + 0.1, p[2]]);
  }
  pts.push([1, 0.3, 6.3]);
  return pts;
}

export function waterSlide(color = SLIDE_COLORS[0]) {
  const k = new Kit();
  const c = color || SLIDE_COLORS[0];
  const light = mixHex(c, '#FFFFFF', 0.55);
  // the tower: four posts, a deck with railings, a ladder at the back
  for (const [x, z] of [[0.15, 0.1], [1.85, 0.1], [0.15, 1.2], [1.85, 1.2]]) k.box(0.14, 3.1, 0.14, WHITE, x - 0.07, 0, z - 0.07);
  k.box(2, 0.14, 1.3, light, 0, 2.98, 0);
  for (const x of [0.04, 1.86]) k.box(0.1, 0.5, 1.3, WHITE, x, 3.12, 0);
  k.box(2, 0.08, 0.08, WHITE, 0, 3.55, 0);
  for (let y = 0.3; y < 3; y += 0.36) k.box(0.7, 0.06, 0.08, GOLD, 0.65, y, -0.04);
  k.box(0.07, 3.1, 0.08, WHITE, 0.6, 0, -0.06);
  k.box(0.07, 3.1, 0.08, WHITE, 1.33, 0, -0.06);
  // the chute: a U of sticks from the deck to the front, curving side to side
  const N = 18;
  let prev = chuteAt(0);
  const water = sheer('#9FE0FF', 0.55);
  for (let i = 1; i <= N; i++) {
    const p = chuteAt(i / N);
    const dx = p[0] - prev[0], dz = p[2] - prev[2];
    const L = Math.hypot(dx, dz) || 1;
    const nx = -dz / L, nz = dx / L; // sideways
    for (const off of [-0.24, -0.08, 0.08, 0.24]) {
      k.stick([prev[0] + nx * off, prev[1], prev[2] + nz * off], [p[0] + nx * off, p[1], p[2] + nz * off], 0.17, c);
    }
    for (const off of [-0.36, 0.36]) {
      k.stick([prev[0] + nx * off, prev[1] + 0.12, prev[2] + nz * off], [p[0] + nx * off, p[1] + 0.12, p[2] + nz * off], 0.1, i % 2 ? WHITE : light);
    }
    k.stick([prev[0], prev[1] + 0.1, prev[2]], [p[0], p[1] + 0.1, p[2]], 0.3, water);
    // little legs under the chute
    if (i % 4 === 0 && p[1] > 0.5) k.box(0.08, p[1] - 0.05, 0.08, WHITE, p[0] - 0.04, 0, p[2] - 0.04);
    prev = p;
  }
  // a splash lip at the end
  k.box(0.8, 0.1, 0.3, light, 0.6, 0.22, 5.65);
  k.ball(0.12, glow(GOLD, 0.6), 1, 3.75, 0.1, { seg: 8 });
  return k.build();
}
export const WATERSLIDE_COLLIDERS = (() => {
  const out = [[0, 2.98, 0, 2, 3.12, 1.3], [0.05, 0, 0.05, 1.95, 2.98, 0.2], [0.05, 0, 1.12, 1.95, 2.98, 1.3]];
  for (let z = 1; z < 6; z++) {
    const t = Math.min(1, Math.max(0, (z + 1 - 1.25) / 4.5));
    out.push([0.35, 0, z + 0.3, 1.65, Math.max(0.3, chuteAt(t)[1] - 0.05), z + 1]);
  }
  return out;
})();

// ---------- lift ----------

export function lift(color = LIFT_COLORS[0]) {
  const k = new Kit();
  const c = color || LIFT_COLORS[0];
  const glass = sheer('#CFEFFF', 0.32);
  for (const [x, z] of [[0.04, 0.04], [0.88, 0.04], [0.04, 0.88], [0.88, 0.88]]) k.box(0.08, 2, 0.08, c, x, 0, z);
  k.box(1, 0.1, 1, c, 0, 1.92, 0);
  k.box(1, 0.06, 1, mixHex(c, '#FFFFFF', 0.5), 0, 0, 0);
  // glass back and sides (the front is open)
  k.box(0.8, 1.8, 0.03, glass, 0.1, 0.08, 0.06);
  k.box(0.03, 1.8, 0.8, glass, 0.06, 0.08, 0.1);
  k.box(0.03, 1.8, 0.8, glass, 0.91, 0.08, 0.1);
  // the button panel on the right post: up and down arrows that glow
  k.box(0.12, 0.42, 0.06, WHITE, 0.82, 0.95, 0.9);
  k.pixels(['..X..', '.XXX.', 'XXXXX'], 0.022, { X: glow('#7CFFB0', 0.9) }, 0.828, 1.22, 0.96);
  k.pixels(['XXXXX', '.XXX.', '..X..'], 0.022, { X: glow('#FFB0D6', 0.9) }, 0.828, 1.0, 0.96);
  // a ceiling light and a gold star
  k.box(0.4, 0.04, 0.4, glow('#FFF4C8', 0.9), 0.3, 1.88, 0.3);
  k.ball(0.09, glow(GOLD, 0.6), 0.5, 2.08, 0.5, { seg: 8 });
  return k.build();
}
export const LIFT_COLLIDERS = [[0.02, 0, 0.02, 0.98, 1.95, 0.1], [0.02, 0, 0.02, 0.1, 1.95, 0.98], [0.9, 0, 0.02, 0.98, 1.95, 0.98]];

// ---------- arcade cabinet ----------

export function arcade(color = ARCADE_COLORS[0], data = {}) {
  const k = new Kit();
  const g = gameOf(color, data);
  const c = color || ARCADE_COLORS[0];
  const dark = shade(c, -0.25);
  // body
  k.box(0.8, 1.05, 0.7, c, 0.1, 0, 0.18);
  k.box(0.8, 0.85, 0.42, c, 0.1, 1.05, 0.18);
  // the sloping control panel
  k.box(0.8, 0.08, 0.36, dark, 0.1, 1.02, 0.6, { rot: [-0.35, 0, 0] });
  k.ball(0.05, '#FF5FA2', 0.32, 1.2, 0.74, { seg: 8 });
  k.box(0.03, 0.12, 0.03, INK, 0.305, 1.08, 0.725);
  for (const [x, col] of [[0.55, '#FFE070'], [0.68, '#7CC8FF'], [0.8, '#7CFFB0']]) k.cyl(0.045, 0.04, glow(col, 0.6), x, 1.1, 0.72, 10);
  // the screen (tilted back a little) in a dark bezel
  k.box(0.74, 0.62, 0.05, INK, 0.13, 1.18, 0.56, { rot: [-0.18, 0, 0] });
  k.box(0.62, 0.5, 0.02, arcadeScreenMat(g), 0.19, 1.24, 0.6, { rot: [-0.18, 0, 0] });
  // marquee
  const mm = signMat('marquee', ARCADE_NAMES[g] || 'Arcade', { w: 256, h: 64, bg: '#2A2766', fg: '#FFE070', edge: '#9C7BFF', glowing: true });
  k.box(0.84, 0.24, 0.06, INK, 0.08, 1.9, 0.5, { faces: { pz: mm } });
  k.box(0.84, 0.06, 0.5, dark, 0.08, 2.14, 0.18);
  // coin door and side stripes
  k.box(0.3, 0.3, 0.02, shade(c, -0.12), 0.35, 0.3, 0.88);
  k.box(0.08, 0.04, 0.02, GOLD, 0.46, 0.5, 0.9);
  for (const x of [0.08, 0.9]) {
    k.box(0.02, 1.9, 0.12, WHITE, x, 0, 0.3);
    k.box(0.02, 1.9, 0.06, GOLD, x, 0, 0.5);
  }
  return k.build();
}
export function gameOf(color, data) {
  if (data && ARCADE_GAMES.includes(data.g)) return data.g;
  const i = ARCADE_COLORS.indexOf(color);
  return ARCADE_GAMES[i >= 0 ? i : 0];
}
export const ARCADE_COLLIDERS = [[0.08, 0, 0.16, 0.92, 2.15, 0.9]];

// ---------- deck games ----------

export function hoops(color = GAME_COLORS[0]) {
  const k = new Kit();
  const c = color || GAME_COLORS[0];
  // base, pole, arm
  k.box(0.8, 0.14, 0.8, shade(c, -0.15), 0.1, 0, 0.05);
  k.box(0.12, 2.6, 0.12, WHITE, 0.44, 0.1, 0.12);
  k.box(0.12, 0.12, 0.35, WHITE, 0.44, 2.45, 0.12);
  // backboard and its square
  k.box(0.96, 0.62, 0.06, WHITE, 0.02, 2.2, 0.45);
  k.box(0.38, 0.28, 0.02, c, 0.31, 2.3, 0.51);
  k.box(0.3, 0.2, 0.02, WHITE, 0.35, 2.34, 0.515);
  // rim and net
  k.torus(0.2, 0.025, '#FF6A3D', 0.5, 2.3, 0.74);
  k.cone(0.2, 0.12, 0.3, sheer('#FFFFFF', 0.6), 0.5, 2.0, 0.74, 10, { open: true });
  // a little rack of balls
  k.box(0.7, 0.05, 0.25, c, 0.15, 0.5, 0.7);
  for (const x of [0.28, 0.5, 0.72]) k.ball(0.11, '#FF8A3D', x, 0.66, 0.82, { seg: 10 });
  for (const x of [0.2, 0.8]) k.box(0.05, 0.5, 0.05, WHITE, x - 0.025, 0, 0.8);
  return k.build();
}
export const HOOPS_COLLIDERS = [[0.38, 0, 0.06, 0.62, 2.6, 0.3], [0.1, 0, 0.6, 0.9, 0.55, 0.98]];

export function ringToss(color = GAME_COLORS[1]) {
  const k = new Kit();
  const c = color || GAME_COLORS[1];
  // a skirted table
  k.box(1.9, 0.08, 0.86, CREAM, 0.05, 0.62, 0.07);
  for (let i = 0; i < 8; i++) k.box(0.2375, 0.6, 0.02, i % 2 ? WHITE : c, 0.05 + i * 0.2375, 0.02, 0.92);
  k.box(1.86, 0.6, 0.8, shade(c, -0.1), 0.07, 0.02, 0.1);
  // bottles in rows
  const cols = ['#7CFFB0', '#7CC8FF', '#FFB0D6', '#FFE070'];
  let n = 0;
  for (let r = 0; r < 3; r++) {
    for (let i = 0; i < 4; i++) {
      const x = 0.32 + i * 0.45 + (r % 2) * 0.12, z = 0.22 + r * 0.24;
      const col = cols[n++ % cols.length];
      k.cyl(0.07, 0.22, sheer(col, 0.8), x, 0.7, z, 8);
      k.cyl(0.03, 0.1, sheer(col, 0.8), x, 0.92, z, 6);
    }
  }
  // a stack of rings at the front
  for (let i = 0; i < 4; i++) k.torus(0.11, 0.022, ['#FF5FA2', '#FFC94D', '#4FB8FF', '#3FD8B0'][i], 1.75, 0.73 + i * 0.045, 0.82);
  return k.build();
}
export const RINGTOSS_COLLIDERS = [[0.05, 0, 0.07, 1.95, 0.72, 0.95]];

export function shuffle(color = GAME_COLORS[2]) {
  const k = new Kit();
  const c = color || GAME_COLORS[2];
  // the court lies flat: the scoring triangle at the far end (local z = 0)
  const cm = courtMat(c);
  k.box(0.9, 0.1, 3.9, '#D9B482', 0.05, 0, 0.05, { faces: { py: cm } });
  k.box(0.06, 0.16, 3.9, c, 0, 0, 0.05);
  k.box(0.06, 0.16, 3.9, c, 0.94, 0, 0.05);
  k.box(1, 0.2, 0.08, c, 0, 0, 0);
  // pucks waiting at the near end, and one in the 10
  for (const [x, z, col] of [[0.3, 3.55, '#FF5FA2'], [0.5, 3.6, '#FF5FA2'], [0.7, 3.55, '#4FB8FF'], [0.5, 0.45, '#4FB8FF']]) k.cyl(0.09, 0.05, col, x, 0.1, z, 12);
  // the cue leaning on the side
  k.stick([0.92, 0.1, 3.95], [0.98, 0.9, 3.4], 0.04, WHITE);
  k.box(0.18, 0.04, 0.12, c, 0.82, 0.08, 3.84, { rot: [0, 0.3, 0] });
  return k.build();
}
export const SHUFFLE_COLLIDERS = [[0, 0, 0, 1, 0.12, 4]];

// ---------- mini golf ----------

export function golfSign(color = '#3FD8B0') {
  const k = new Kit();
  const c = color || '#3FD8B0';
  k.box(0.12, 1.5, 0.12, WHITE, 0.44, 0, 0.44);
  const sm = signMat('golf', 'Mini Golf', { fg: shade(c, -0.25), edge: mixHex(c, '#FFFFFF', 0.5) });
  k.box(1.1, 0.42, 0.08, CREAM, -0.05, 1.38, 0.46, { faces: { pz: sm, nz: sm } });
  k.box(1.14, 0.06, 0.1, c, -0.07, 1.8, 0.45);
  // the little flag on top
  k.box(0.03, 0.4, 0.03, WHITE, 0.485, 1.85, 0.485);
  const flag = k.part('flag', 0.515, 2.25, 0.5);
  flag.pixels(['XXXX..', 'XXXXXX', 'XXXX..'], 0.05, { X: '#FF5FA2' }, 0, -0.15, -0.015, { depth: 0.03 });
  // a ball on a tee and a putter
  k.cyl(0.02, 0.1, WHITE, 0.25, 0, 0.8, 6);
  k.ball(0.065, WHITE, 0.25, 0.16, 0.8, { seg: 10 });
  k.stick([0.75, 0, 0.75], [0.66, 0.8, 0.62], 0.035, '#C0C8D8');
  k.box(0.16, 0.06, 0.05, c, 0.68, 0, 0.73);
  // a patch of green
  k.box(0.9, 0.02, 0.9, '#7FD37A', 0.05, 0, 0.05);
  return k.build();
}
export const GOLF_COLLIDERS = [[0.4, 0, 0.4, 0.6, 1.8, 0.6]];

export function golfFlag(color = '#FF5FA2', data = {}) {
  const k = new Kit();
  const c = color || '#FF5FA2';
  // the cup's rim on the ground and a white pole with a waving flag
  k.torus(0.16, 0.03, WHITE, 0.5, 0.03, 0.5);
  k.cyl(0.13, 0.015, INK, 0.5, 0.005, 0.5, 14);
  k.cyl(0.025, 1.6, WHITE, 0.5, 0, 0.5, 6);
  const flag = k.part('flag', 0.52, 1.6, 0.5);
  flag.pixels(['XXXXX..', 'XXXXXXX', 'XXXXX..'], 0.07, { X: c }, 0, -0.21, -0.015, { depth: 0.03 });
  const n = Math.max(1, Math.min(9, (data && data.i | 0) + 1));
  const nm = signMat('hole', String(n), { w: 64, h: 64, fg: INK, bg: '#FFFFFF', edge: c });
  flag.box(0.16, 0.16, 0.035, WHITE, 0.12, -0.18, -0.02, { faces: { pz: nm, nz: nm } });
  k.ball(0.05, GOLD, 0.5, 1.62, 0.5, { seg: 8 });
  k.hitbox(0.25, 0, 0.25, 0.75, 1.7, 0.75);
  return k.build();
}

// ---------- DJ booth ----------

export function djBooth(color = DJ_COLORS[0]) {
  const k = new Kit();
  const c = color || DJ_COLORS[0];
  const dark = shade(c, -0.3);
  // the desk with a glowing striped front
  k.box(2, 0.95, 0.8, dark, 0, 0, 0.1);
  for (let i = 0; i < 6; i++) k.box(0.28, 0.6, 0.02, glow(['#FF5FA2', '#FFC94D', '#3FD8B0', '#4FB8FF', '#9C7BFF', '#FF9F43'][i], 0.85), 0.12 + i * 0.3, 0.2, 0.9);
  k.box(2.04, 0.08, 0.86, c, -0.02, 0.95, 0.07);
  // turntables (the records spin) and the mixer
  for (const x of [0.45, 1.55]) {
    k.box(0.6, 0.06, 0.55, '#2A2240', x - 0.3, 1.03, 0.2);
    const disc = k.part(x < 1 ? 'discL' : 'discR', x, 1.09, 0.47);
    disc.cyl(0.22, 0.02, INK, 0, 0, 0, 18);
    disc.cyl(0.07, 0.025, c, 0, 0, 0, 12);
    disc.box(0.2, 0.026, 0.02, '#8C82A8', 0.02, 0, -0.01);
  }
  k.box(0.36, 0.08, 0.45, '#2A2240', 0.82, 1.03, 0.25);
  for (let i = 0; i < 4; i++) k.box(0.04, 0.02, 0.2, glow(['#7CFFB0', '#FFE070', '#FF9CCB', '#9FE0FF'][i], 0.9), 0.88 + i * 0.07, 1.11, 0.3);
  // speakers on both ends
  for (const x of [-0.02, 1.62]) {
    k.box(0.4, 0.7, 0.4, INK, x, 1.03, 0.1);
    discZ(k, 0.13, 0.04, '#5A4A80', x + 0.2, 1.48, 0.5, 14);
    discZ(k, 0.07, 0.04, '#5A4A80', x + 0.2, 1.2, 0.5, 12);
  }
  // a pole with the disco ball (spins)
  k.box(0.07, 1.3, 0.07, WHITE, 0.965, 1.0, 0.04);
  k.box(0.07, 0.07, 0.4, WHITE, 0.965, 2.28, 0.04);
  const ball = k.part('disco', 1.0, 2.05, 0.42);
  ball.box(0.02, 0.22, 0.02, WHITE, -0.01, 0.2, -0.01);
  ball.ball(0.24, discoMat(), 0, 0, 0, { seg: 12 });
  // a star sign
  const sm = signMat('dj', 'DJ', { w: 64, h: 64, bg: '#2A2766', fg: '#FFE070', edge: c, glowing: true });
  k.box(0.32, 0.32, 0.04, INK, 0.84, 0.38, 0.9, { faces: { pz: sm } });
  return k.build();
}
export const DJ_COLLIDERS = [[0, 0, 0.1, 2, 1.05, 0.92], [-0.02, 1.0, 0.1, 0.38, 1.75, 0.5], [1.62, 1.0, 0.1, 2.02, 1.75, 0.5]];

// ---------- movie screen ----------

export const SCREEN_DEFAULT = { w: 5, h: 3 };
const SCREEN_PX = { w: TV_W * 2, h: TV_H * 2 };

/** Screen size (blocks) from data: whole numbers, at least the footprint, at most 24 x 14. */
export function screenSize(data) {
  const w = Math.round(Number(data && data.w)), h = Math.round(Number(data && data.h));
  return {
    w: Number.isFinite(w) ? Math.max(5, Math.min(24, w)) : SCREEN_DEFAULT.w,
    h: Number.isFinite(h) ? Math.max(3, Math.min(14, h)) : SCREEN_DEFAULT.h,
  };
}

export function movieScreen(color = SCREEN_COLORS[0], data = {}) {
  const k = new Kit();
  const c = color || SCREEN_COLORS[0];
  const { w, h } = screenSize(data);
  const x0 = 2.5 - w / 2, x1 = 2.5 + w / 2;
  const on = !!(data && data.ch > 0) && typeof document !== 'undefined';
  // the frame and two legs
  const fr = 0.14;
  k.box(w + fr * 2, fr, 0.16, c, x0 - fr, 0.1, 0.02);
  k.box(w + fr * 2, fr, 0.16, c, x0 - fr, h - fr, 0.02);
  k.box(fr, h - fr - 0.1, 0.16, c, x0 - fr, 0.1 + fr, 0.02);
  k.box(fr, h - fr - 0.1, 0.16, c, x1, 0.1 + fr, 0.02);
  k.box(fr, 0.1, 0.3, shade(c, -0.2), x0 - fr, 0, 0.02);
  k.box(fr, 0.1, 0.3, shade(c, -0.2), x1, 0, 0.02);
  // marquee bulbs all round
  const n = Math.max(6, Math.round(w * 2));
  bulbs(k, [x0 - 0.05, h + 0.02, 0.18], [x1 + 0.05, h + 0.02, 0.18], n, BULB_COLS, 0.05);
  bulbs(k, [x0 - 0.05, 0.18, 0.18], [x1 + 0.05, 0.18, 0.18], n, BULB_COLS, 0.05);
  // the picture
  let screen = null;
  if (on) {
    const canvas = document.createElement('canvas');
    canvas.width = SCREEN_PX.w;
    canvas.height = SCREEN_PX.h;
    const ctx = canvas.getContext('2d');
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    const mat = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
    const geo = new THREE.PlaneGeometry(w, h - 0.1 - fr * 2);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(2.5, 0.1 + fr + (h - 0.1 - fr * 2) / 2, 0.1);
    k.add(mesh);
    screen = { canvas, ctx, tex, t: 0, acc: 1, mat, geo };
  } else {
    k.box(w, h - 0.1 - fr * 2, 0.04, '#2A2766', x0, 0.1 + fr, 0.06);
    // a sleepy moon on the dark screen
    k.ball(0.25, glow('#FFF4B8', 0.5), 2.5, 0.1 + fr + (h - fr * 2) / 2, 0.12, { seg: 10 });
  }
  k.box(w, h - fr, 0.04, shade(c, -0.15), x0, 0.1, 0);
  k.hitbox(x0 - fr, 0, 0, x1 + fr, h + 0.1, 0.4);
  const g = k.build();
  if (screen) g.userData.screen = screen;
  return g;
}
export const SCREEN_COLLIDERS = [[0, 0, 0, 5, 3, 0.2]];
export { SCREEN_PX };

// ---------- the captain's wheel ----------

export function wheel(color = WHEEL_COLORS[0]) {
  const k = new Kit();
  const c = color || WHEEL_COLORS[0];
  const wood = shade(c, -0.05);
  // a brass pedestal
  k.cyl(0.32, 0.1, GOLD, 0.5, 0, 0.5, 14);
  k.cyl(0.14, 1.05, mixHex(GOLD, '#FFFFFF', 0.25), 0.5, 0.1, 0.5, 10);
  k.box(0.3, 0.3, 0.3, GOLD, 0.35, 1.0, 0.35);
  // the wheel turns about its axle (facing +Z, a little tilted back)
  const wh = k.part('wheel', 0.5, 1.28, 0.7, { rot: [-0.25, 0, 0] });
  wh.cyl(0.07, 0.12, GOLD, 0, 0, -0.06, 10, { rot: [Math.PI / 2, 0, 0] });
  wh.torus(0.42, 0.045, wood, 0, 0, 0, { rot: [Math.PI / 2, 0, 0] });
  for (let i = 0; i < 8; i++) {
    const a = (i / 8) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    wh.stick([ca * 0.06, sa * 0.06, 0], [ca * 0.6, sa * 0.6, 0], 0.05, wood);
    wh.ball(0.055, i % 2 ? c : GOLD, ca * 0.62, sa * 0.62, 0, { seg: 8 });
  }
  wh.ball(0.08, GOLD, 0, 0, 0.02, { seg: 10 });
  k.hitbox(0, 0.6, 0.3, 1, 2, 0.9);
  return k.build();
}
export const WHEEL_COLLIDERS = [[0.3, 0, 0.3, 0.7, 1.3, 0.7]];

// ---------- the "What's On" board ----------

export function board(color = BOARD_COLORS[0]) {
  const k = new Kit();
  const c = color || BOARD_COLORS[0];
  for (const x of [0.15, 1.75]) k.box(0.1, 1.95, 0.1, WHITE, x, 0, 0.45);
  const bm = boardMat(c);
  k.box(1.9, 1.3, 0.08, c, 0.05, 0.7, 0.42, { faces: { pz: bm } });
  k.box(2, 0.1, 0.14, c, 0, 2.0, 0.4);
  bulbs(k, [0.1, 2.12, 0.47], [1.9, 2.12, 0.47], 7, BULB_COLS, 0.05);
  k.ball(0.12, glow(GOLD, 0.6), 1, 2.28, 0.47, { seg: 8 });
  return k.build();
}
export const BOARD_COLLIDERS = [[0.05, 0, 0.4, 1.95, 2.1, 0.56]];

// ---------- pool floats ----------

export const FLOAT_SHAPES = ['donut', 'duck', 'star', 'melon', 'unicorn', 'turtle'];
export function floatShape(color, data) {
  if (data && FLOAT_SHAPES.includes(data.s)) return data.s;
  const i = FLOAT_COLORS.indexOf(color);
  return FLOAT_SHAPES[i >= 0 ? i : 0];
}

export function float(color = FLOAT_COLORS[0], data = {}) {
  const k = new Kit();
  const c = color || FLOAT_COLORS[0];
  const shape = floatShape(c, data);
  // everything rides on the 'body' part so the float can bob as one
  const b = k.part('body', 0.5, 0, 0.5);
  if (shape === 'star') {
    for (let i = 0; i < 5; i++) {
      const a = (i / 5) * Math.PI * 2;
      b.box(0.24, 0.16, 0.42, c, -0.12, 0, 0, { rot: [0, a, 0], pivot: [0, 0.08, 0] });
    }
    b.cyl(0.24, 0.17, c, 0, 0, 0, 10);
    b.ball(0.035, INK, -0.08, 0.17, 0.12, { seg: 6 });
    b.ball(0.035, INK, 0.08, 0.17, 0.12, { seg: 6 });
  } else if (shape === 'melon') {
    b.cyl(0.4, 0.14, '#7CD36B', 0, 0, 0, 16);
    b.cyl(0.36, 0.15, '#FFFFFF', 0, 0, 0, 16);
    b.cyl(0.33, 0.16, c, 0, 0, 0, 16);
    for (let i = 0; i < 7; i++) {
      const a = (i / 7) * Math.PI * 2;
      b.box(0.04, 0.02, 0.06, INK, Math.cos(a) * 0.2 - 0.02, 0.15, Math.sin(a) * 0.2 - 0.03);
    }
  } else if (shape === 'turtle') {
    b.ball(0.38, c, 0, 0.05, 0, { sy: 0.38, seg: 14 });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      b.ball(0.08, shade(c, -0.15), Math.cos(a) * 0.2, 0.17, Math.sin(a) * 0.2, { sy: 0.3, seg: 8 });
    }
    b.ball(0.14, mixHex(c, '#FFFFFF', 0.3), 0, 0.12, 0.42, { seg: 10 });
    b.ball(0.025, INK, -0.05, 0.17, 0.53, { seg: 6 });
    b.ball(0.025, INK, 0.05, 0.17, 0.53, { seg: 6 });
    for (const [x, z] of [[-0.3, 0.25], [0.3, 0.25], [-0.3, -0.25], [0.3, -0.25]]) b.ball(0.08, mixHex(c, '#FFFFFF', 0.3), x, 0.06, z, { sy: 0.5, seg: 8 });
  } else {
    // a ring (donut, duck, unicorn)
    b.torus(0.3, 0.12, c, 0, 0.12, 0);
    if (shape === 'donut') {
      b.torus(0.3, 0.1, '#FFFFFF', 0, 0.16, 0);
      const sp = ['#FF5FA2', '#FFC94D', '#4FB8FF', '#3FD8B0', '#9C7BFF'];
      for (let i = 0; i < 12; i++) {
        const a = (i / 12) * Math.PI * 2;
        b.box(0.06, 0.02, 0.02, sp[i % 5], Math.cos(a) * 0.3 - 0.03, 0.25, Math.sin(a) * 0.3 - 0.01, { rot: [0, a * 1.7, 0] });
      }
    } else if (shape === 'duck') {
      b.ball(0.13, c, 0, 0.38, 0.32, { seg: 10 });
      b.box(0.1, 0.05, 0.1, '#FF9F43', -0.05, 0.36, 0.42);
      b.ball(0.025, INK, -0.07, 0.43, 0.42, { seg: 6 });
      b.ball(0.025, INK, 0.07, 0.43, 0.42, { seg: 6 });
      b.ball(0.08, c, 0, 0.2, -0.36, { sy: 1.4, seg: 8 });
    } else {
      // unicorn: a white head with a gold horn and a rainbow mane
      b.ball(0.14, '#FFFFFF', 0, 0.38, 0.32, { seg: 10 });
      b.cone(0.05, 0.005, 0.2, GOLD, 0, 0.5, 0.34, 8);
      ['#FF9CCB', '#FFE070', '#9FE0FF'].forEach((m, i) => b.ball(0.06, m, 0, 0.34 + i * 0.06, 0.2 - i * 0.02, { seg: 6 }));
      b.ball(0.025, INK, -0.08, 0.4, 0.43, { seg: 6 });
      b.ball(0.025, INK, 0.08, 0.4, 0.43, { seg: 6 });
    }
  }
  k.hitbox(0.05, 0, 0.05, 0.95, 0.5, 0.95);
  return k.build();
}

// ---------- sun lounger ----------

export function lounger(color = LOUNGER_COLORS[0]) {
  const k = new Kit();
  const c = color || LOUNGER_COLORS[0];
  // white frame on little legs
  for (const [x, z] of [[0.1, 0.1], [0.82, 0.1], [0.1, 1.82], [0.82, 1.82]]) k.box(0.08, 0.28, 0.08, WHITE, x, 0, z);
  k.box(0.84, 0.06, 1.84, WHITE, 0.08, 0.28, 0.08);
  // the cushion in stripes, with a raised back (the head end is the back, z = 0)
  const stripe = (x, y, z, l, rot) => {
    for (let i = 0; i < 4; i++) k.box(0.19, 0.08, l, i % 2 ? WHITE : c, 0.12 + i * 0.19, y, z, rot ? { rot, pivot: [0.5, y, z + l] } : null);
  };
  stripe(0, 0.34, 0.65, 1.25, null);
  stripe(0, 0.34, 0.08, 0.6, [0.55, 0, 0]);
  // a little pillow and a folded towel at the foot
  k.box(0.5, 0.1, 0.18, mixHex(c, '#FFFFFF', 0.6), 0.25, 0.62, 0.12, { rot: [0.55, 0, 0] });
  k.box(0.6, 0.06, 0.3, '#FFFFFF', 0.2, 0.42, 1.55);
  k.box(0.6, 0.02, 0.06, c, 0.2, 0.48, 1.6);
  return k.build();
}
export const LOUNGER_COLLIDERS = [[0.06, 0, 0.06, 0.94, 0.42, 1.94]];
export const LOUNGER_LIE = [0.5, 0.42, 1.0];

// ---------- towel animals ----------

export const TOWEL_ANIMALS = ['swan', 'elephant', 'bunny', 'puppy'];
export const TOWEL_NAMES = { swan: 'Towel Swans', elephant: 'Towel Elephant', bunny: 'Towel Bunny', puppy: 'Towel Puppy' };

export function towel(color = TOWEL_COLORS[0], data = {}) {
  const k = new Kit();
  const c = color || TOWEL_COLORS[0];
  const a = TOWEL_ANIMALS[((data && data.a) | 0) % TOWEL_ANIMALS.length] || 'swan';
  const sh = shade(c, -0.06);
  const b = k.part('body', 0.5, 0, 0.5);
  const eye = (x, y, z) => b.ball(0.022, INK, x, y, z, { seg: 6 });
  if (a === 'swan') {
    // two swans whose necks make a heart
    for (const s of [-1, 1]) {
      b.ball(0.13, c, s * 0.16, 0.08, 0, { sx: 0.8, sy: 0.6, sz: 1.3, seg: 10 });
      for (let i = 0; i < 7; i++) {
        const t = i / 6;
        const ang = Math.PI * 0.95 * t;
        b.ball(0.045, sh, s * (0.16 - Math.sin(ang) * 0.1), 0.12 + (1 - Math.cos(ang)) * 0.16, 0.12 - t * 0.05, { seg: 6 });
      }
      b.box(0.04, 0.03, 0.06, '#FF9F43', s * 0.06 - 0.02, 0.42, 0.08);
      eye(s * 0.09, 0.44, 0.08);
    }
    b.ball(0.05, '#FF5FA2', 0, 0.26, 0.1, { seg: 6 });
  } else if (a === 'elephant') {
    b.ball(0.17, c, 0, 0.14, -0.05, { sx: 1, sy: 0.8, sz: 1.3, seg: 10 });
    b.ball(0.12, c, 0, 0.24, 0.18, { seg: 10 });
    for (const s of [-1, 1]) b.ball(0.09, sh, s * 0.13, 0.27, 0.15, { sx: 0.4, seg: 8 });
    for (let i = 0; i < 4; i++) b.ball(0.035, sh, 0, 0.2 - i * 0.04, 0.29 + i * 0.015, { seg: 6 });
    eye(-0.05, 0.28, 0.28);
    eye(0.05, 0.28, 0.28);
  } else if (a === 'bunny') {
    b.ball(0.15, c, 0, 0.13, 0, { sy: 0.85, seg: 10 });
    b.ball(0.1, c, 0, 0.3, 0.06, { seg: 10 });
    for (const s of [-1, 1]) b.ball(0.045, sh, s * 0.05, 0.46, 0.04, { sy: 2.2, seg: 6 });
    b.ball(0.05, '#FFFFFF', 0, 0.12, -0.15, { seg: 6 });
    eye(-0.04, 0.33, 0.15);
    eye(0.04, 0.33, 0.15);
    b.ball(0.018, '#FF7AA8', 0, 0.3, 0.16, { seg: 6 });
  } else {
    b.ball(0.15, c, 0, 0.12, -0.04, { sx: 0.9, sy: 0.75, sz: 1.2, seg: 10 });
    b.ball(0.11, c, 0, 0.28, 0.12, { seg: 10 });
    for (const s of [-1, 1]) b.ball(0.06, sh, s * 0.11, 0.26, 0.1, { sx: 0.5, sy: 1.5, seg: 6 });
    b.ball(0.045, sh, 0, 0.25, 0.22, { seg: 6 });
    b.ball(0.02, INK, 0, 0.27, 0.26, { seg: 6 });
    eye(-0.045, 0.32, 0.2);
    eye(0.045, 0.32, 0.2);
  }
  k.hitbox(0.15, 0, 0.15, 0.85, 0.5, 0.85);
  return k.build();
}

// ---------- ship's bell ----------

export function bell(color = BELL_COLORS[0]) {
  const k = new Kit();
  const c = color || BELL_COLORS[0];
  k.box(0.6, 0.08, 0.6, '#C98F55', 0.2, 0, 0.2);
  k.box(0.1, 1.9, 0.1, '#C98F55', 0.45, 0.05, 0.25);
  k.box(0.1, 0.1, 0.5, '#C98F55', 0.45, 1.85, 0.25);
  const b = k.part('bell', 0.5, 1.82, 0.62);
  b.cone(0.18, 0.1, 0.3, c, 0, -0.38, 0, 14);
  b.cyl(0.19, 0.05, shade(c, -0.15), 0, -0.4, 0, 14);
  b.ball(0.1, c, 0, -0.08, 0, { sy: 0.7, seg: 10 });
  b.ball(0.04, shade(c, -0.3), 0, -0.47, 0, { seg: 6 });
  b.stick([0, -0.4, 0], [0, -0.7, 0.05], 0.02, '#FFFFFF');
  k.hitbox(0.2, 0, 0.2, 0.8, 2, 0.9);
  return k.build();
}
export const BELL_COLLIDERS = [[0.42, 0, 0.22, 0.58, 1.95, 0.38]];
