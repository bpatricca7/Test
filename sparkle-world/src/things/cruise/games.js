// The cruise's mini games, drawn on one canvas (logical 640 x 400; play.js scales it). Tap or
// click only, every round ends happily with a score:
//   star    Star Catcher  tap the falling stars (rainbow stars are worth 3), 40 s
//   bubble  Bubble Pop    pop each rising bubble (a golden starfish inside is worth 3), 40 s
//   fish    Fish Match    find the six pairs of sea friends (a little magic helps after 70 s)
//   hoops / ring / shuffle  the deck games: five throws, tap when the arrow is on the star
//   golf    Mini Golf     tap the green to aim, tap Putt! when the power is right
// A game: { key, title, hint, time (s, 0 = no clock), act (button label or null), score,
// finished, status(), update(dt), draw(c), tap(x, y), action(), timeUp(), result() }.

import {
  meterValue, meterQuality, throwPoints, meterSpeed, GOLF, golfCourse, newBall, putt, stepBall,
  holeStars, matchScore, shuffled,
} from './logic.js';

export const W = 640, H = 400;
const FONT = "'Fredoka', ui-rounded, 'Arial Rounded MT Bold', 'Trebuchet MS', system-ui, sans-serif";
const INK = '#3A1F4D';
const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ease = (t) => t * t * (3 - 2 * t);

// ---------- drawing helpers ----------

function rr(c, x, y, w, h, r) {
  c.beginPath();
  c.moveTo(x + r, y);
  c.arcTo(x + w, y, x + w, y + h, r);
  c.arcTo(x + w, y + h, x, y + h, r);
  c.arcTo(x, y + h, x, y, r);
  c.arcTo(x, y, x + w, y, r);
  c.closePath();
}

function starShape(c, x, y, R, r = R * 0.45, rot = 0) {
  c.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + rot + (i / 10) * TAU;
    const d = i % 2 === 0 ? R : r;
    c.lineTo(x + Math.cos(a) * d, y + Math.sin(a) * d);
  }
  c.closePath();
}

function text(c, s, x, y, size, color = '#FFFFFF', align = 'center', outline = INK) {
  c.font = `700 ${size}px ${FONT}`;
  c.textAlign = align;
  c.textBaseline = 'middle';
  if (outline) {
    c.lineJoin = 'round';
    c.lineWidth = Math.max(3, size * 0.18);
    c.strokeStyle = outline;
    c.strokeText(s, x, y);
  }
  c.fillStyle = color;
  c.fillText(s, x, y);
}

function face(c, x, y, s) {
  c.fillStyle = INK;
  c.beginPath(); c.arc(x - s * 0.35, y, s * 0.12, 0, TAU); c.fill();
  c.beginPath(); c.arc(x + s * 0.35, y, s * 0.12, 0, TAU); c.fill();
  c.strokeStyle = INK;
  c.lineWidth = Math.max(1.5, s * 0.1);
  c.lineCap = 'round';
  c.beginPath(); c.arc(x, y + s * 0.12, s * 0.22, 0.2, Math.PI - 0.2); c.stroke();
}

/** A little sea friend (the Fish Match cards and what floats in a bubble). */
export function creature(c, kind, x, y, s) {
  c.save();
  c.translate(x, y);
  c.lineJoin = 'round';
  if (kind === 'fish') {
    c.fillStyle = '#FF9F43';
    c.beginPath(); c.moveTo(s * 0.45, 0); c.lineTo(s * 0.95, -s * 0.38); c.lineTo(s * 0.95, s * 0.38); c.closePath(); c.fill();
    c.beginPath(); c.ellipse(0, 0, s * 0.58, s * 0.4, 0, 0, TAU); c.fill();
    c.fillStyle = '#FFFFFF';
    c.fillRect(-s * 0.1, -s * 0.38, s * 0.12, s * 0.76);
    c.fillStyle = INK; c.beginPath(); c.arc(-s * 0.3, -s * 0.06, s * 0.08, 0, TAU); c.fill();
  } else if (kind === 'starfish') {
    c.fillStyle = '#FF7EB6';
    starShape(c, 0, 0, s * 0.75, s * 0.33);
    c.fill();
    face(c, 0, 0, s * 0.35);
  } else if (kind === 'crab') {
    c.fillStyle = '#FF6F61';
    for (const sx of [-1, 1]) {
      c.beginPath(); c.arc(sx * s * 0.62, -s * 0.38, s * 0.2, 0, TAU); c.fill();
      c.fillRect(sx * s * 0.5 - s * 0.05, -s * 0.25, s * 0.1, s * 0.3);
      for (let i = 0; i < 3; i++) c.fillRect(sx * (s * 0.4 + i * s * 0.02), s * 0.05 + i * s * 0.12, sx * s * 0.3, s * 0.07);
    }
    c.beginPath(); c.ellipse(0, s * 0.05, s * 0.5, s * 0.36, 0, 0, TAU); c.fill();
    face(c, 0, s * 0.02, s * 0.32);
  } else if (kind === 'jelly') {
    c.fillStyle = '#C8B4FF';
    c.beginPath(); c.arc(0, -s * 0.05, s * 0.5, Math.PI, 0); c.closePath(); c.fill();
    c.strokeStyle = '#C8B4FF'; c.lineWidth = s * 0.08; c.lineCap = 'round';
    for (let i = -2; i <= 2; i++) {
      c.beginPath(); c.moveTo(i * s * 0.18, 0); c.quadraticCurveTo(i * s * 0.18 + s * 0.12, s * 0.35, i * s * 0.18, s * 0.65); c.stroke();
    }
    face(c, 0, -s * 0.2, s * 0.3);
  } else if (kind === 'whale') {
    c.fillStyle = '#4FB8FF';
    c.beginPath(); c.ellipse(-s * 0.05, s * 0.08, s * 0.62, s * 0.42, 0, 0, TAU); c.fill();
    c.beginPath(); c.moveTo(s * 0.48, 0); c.lineTo(s * 0.9, -s * 0.32); c.lineTo(s * 0.8, s * 0.12); c.closePath(); c.fill();
    c.fillStyle = '#CFEFFF'; c.beginPath(); c.ellipse(-s * 0.1, s * 0.3, s * 0.4, s * 0.15, 0, 0, Math.PI); c.fill();
    c.strokeStyle = '#9FE0FF'; c.lineWidth = s * 0.07; c.lineCap = 'round';
    c.beginPath(); c.moveTo(-s * 0.2, -s * 0.36); c.quadraticCurveTo(-s * 0.3, -s * 0.7, -s * 0.45, -s * 0.62); c.moveTo(-s * 0.2, -s * 0.36); c.quadraticCurveTo(-s * 0.1, -s * 0.7, s * 0.05, -s * 0.62); c.stroke();
    c.fillStyle = INK; c.beginPath(); c.arc(-s * 0.4, 0, s * 0.07, 0, TAU); c.fill();
  } else if (kind === 'puffer') {
    c.fillStyle = '#FFD43B';
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * TAU;
      c.beginPath(); c.moveTo(Math.cos(a - 0.15) * s * 0.45, Math.sin(a - 0.15) * s * 0.45); c.lineTo(Math.cos(a) * s * 0.66, Math.sin(a) * s * 0.66); c.lineTo(Math.cos(a + 0.15) * s * 0.45, Math.sin(a + 0.15) * s * 0.45); c.fill();
    }
    c.beginPath(); c.arc(0, 0, s * 0.5, 0, TAU); c.fill();
    face(c, 0, 0, s * 0.36);
  } else {
    // a shell
    c.fillStyle = '#FFBFA0';
    c.beginPath(); c.moveTo(0, s * 0.45); c.arc(0, s * 0.45, s * 0.6, Math.PI * 1.15, Math.PI * 1.85); c.closePath(); c.fill();
    c.strokeStyle = '#FF9F80'; c.lineWidth = s * 0.06;
    for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(0, s * 0.42); c.lineTo(i * s * 0.2, -s * 0.05); c.stroke(); }
  }
  c.restore();
}

// ---------- little bursts and floating words, shared by every game ----------

class Bits {
  constructor() {
    this.list = [];
  }

  burst(x, y, colors, n = 10, speed = 140) {
    for (let i = 0; i < n && this.list.length < 260; i++) {
      const a = Math.random() * TAU, v = speed * (0.4 + Math.random() * 0.8);
      this.list.push({ k: 'dot', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0.6 + Math.random() * 0.4, t: 0, col: colors[i % colors.length], r: 3 + Math.random() * 4 });
    }
  }

  word(x, y, s, col = '#FFE070', size = 26) {
    if (this.list.length < 260) this.list.push({ k: 'word', x, y, s, col, size, life: 1.1, t: 0 });
  }

  ring(x, y, r, col = '#FFFFFF') {
    if (this.list.length < 260) this.list.push({ k: 'ring', x, y, r, col, life: 0.45, t: 0 });
  }

  update(dt) {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const b = this.list[i];
      b.t += dt;
      if (b.k === 'dot') {
        b.x += b.vx * dt;
        b.y += b.vy * dt;
        b.vy += 260 * dt;
      } else if (b.k === 'word') b.y -= 40 * dt;
      if (b.t >= b.life) this.list.splice(i, 1);
    }
  }

  draw(c) {
    for (const b of this.list) {
      const k = 1 - b.t / b.life;
      c.globalAlpha = clamp(k * 1.5, 0, 1);
      if (b.k === 'dot') {
        c.fillStyle = b.col;
        starShape(c, b.x, b.y, b.r, b.r * 0.5, b.t * 6);
        c.fill();
      } else if (b.k === 'ring') {
        c.strokeStyle = b.col;
        c.lineWidth = 3 * k + 1;
        c.beginPath(); c.arc(b.x, b.y, b.r * (1 + b.t * 2.2), 0, TAU); c.stroke();
      } else {
        text(c, b.s, b.x, b.y, b.size * (1 + 0.25 * Math.min(1, b.t * 6) - 0.25 * Math.min(1, b.t * 3)), b.col);
      }
    }
    c.globalAlpha = 1;
  }
}

const SPARK = ['#FFE070', '#FF9CCB', '#9FE0FF', '#B8F5C8', '#FFFFFF'];

// ---------- Star Catcher ----------

class StarCatcher {
  constructor(env) {
    this.env = env;
    this.key = 'star';
    this.title = 'Star Catcher';
    this.hint = 'Tap the stars before they fall! Rainbow stars are worth 3.';
    this.time = 40;
    this.act = null;
    this.score = 0;
    this.finished = false;
    this.stars = [];
    this.bits = new Bits();
    this.t = 0;
    this.spawn = 0.3;
    this.rainbowT = 6;
    this.streak = 0;
    const r = env.rand;
    this.sky = Array.from({ length: 50 }, () => [r() * W, r() * H * 0.85, 0.6 + r() * 1.6, r() * TAU]);
  }

  status() {
    return `${this.score} ${this.score === 1 ? 'star' : 'stars'}`;
  }

  update(dt) {
    this.t += dt;
    const r = this.env.rand;
    if (!this.ending) {
      this.spawn -= dt;
      if (this.spawn <= 0) {
        this.spawn = Math.max(0.42, 0.85 - this.t * 0.011) * (0.7 + r() * 0.6);
        const cols = ['#FFE070', '#FF9CCB', '#9FE0FF', '#B8F5C8', '#FFC08A'];
        this.stars.push({ x: 40 + r() * (W - 80), y: -30, vx: (r() - 0.5) * 30, vy: 70 + r() * 50 + this.t * 1.4, R: 22 + r() * 10, rot: r() * TAU, vr: (r() - 0.5) * 2, col: cols[Math.floor(r() * cols.length)], rainbow: false, fade: 0 });
      }
      this.rainbowT -= dt;
      if (this.rainbowT <= 0) {
        this.rainbowT = 7 + r() * 4;
        const left = r() < 0.5;
        this.stars.push({ x: left ? -30 : W + 30, y: 40 + r() * 80, vx: left ? 150 : -150, vy: 55, R: 26, rot: 0, vr: 3, col: '#FFFFFF', rainbow: true, fade: 0 });
      }
    }
    for (let i = this.stars.length - 1; i >= 0; i--) {
      const s = this.stars[i];
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      s.rot += s.vr * dt;
      if (s.y > H - 40) s.fade += dt * 3;
      if (s.fade >= 1 || s.x < -60 || s.x > W + 60) {
        if (!s.rainbow && s.fade >= 1) this.streak = 0;
        this.stars.splice(i, 1);
      }
    }
    this.bits.update(dt);
    if (this.ending && !this.stars.length) this.finished = true;
  }

  tap(x, y) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < this.stars.length; i++) {
      const s = this.stars[i];
      const d = Math.hypot(s.x - x, s.y - y);
      if (d < s.R + 22 && d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) return;
    const s = this.stars.splice(best, 1)[0];
    const pts = s.rainbow ? 3 : 1;
    this.score += pts;
    this.streak++;
    this.bits.burst(s.x, s.y, s.rainbow ? ['#FF5FA2', '#FFC94D', '#3FD8B0', '#4FB8FF', '#9C7BFF'] : [s.col, '#FFFFFF'], s.rainbow ? 18 : 10);
    this.bits.word(s.x, s.y - 20, `+${pts}`, s.rainbow ? '#FFE070' : '#FFFFFF', s.rainbow ? 32 : 24);
    if (this.streak > 0 && this.streak % 5 === 0) this.bits.word(W / 2, 80, ['Super!', 'Sparkly!', 'Wow!', 'Amazing!'][(this.streak / 5) % 4], '#FFE070', 36);
    this.env.sfx.blip(this.streak);
  }

  action() {}

  timeUp() {
    this.ending = true;
    for (const s of this.stars) s.vy = Math.max(s.vy, 220);
  }

  draw(c) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#22205E');
    g.addColorStop(1, '#6B4FA8');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    for (const [x, y, r, p] of this.sky) {
      c.globalAlpha = 0.4 + 0.4 * Math.sin(this.t * 2 + p);
      c.fillStyle = '#FFF6D8';
      c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    }
    c.globalAlpha = 1;
    // a sleepy moon and soft clouds along the bottom
    c.fillStyle = '#FFF4B8';
    c.beginPath(); c.arc(570, 64, 30, 0, TAU); c.fill();
    c.fillStyle = '#2C2A70';
    c.beginPath(); c.arc(584, 56, 26, 0, TAU); c.fill();
    c.fillStyle = 'rgba(255,255,255,0.18)';
    for (let i = 0; i < 7; i++) { c.beginPath(); c.arc(i * 110 - 10, H + 10, 70, 0, TAU); c.fill(); }
    for (const s of this.stars) {
      c.globalAlpha = 1 - s.fade;
      if (s.rainbow) {
        const cols = ['#FF5FA2', '#FFC94D', '#3FD8B0', '#4FB8FF', '#9C7BFF'];
        for (let i = 0; i < cols.length; i++) {
          c.strokeStyle = cols[i];
          c.lineWidth = 4;
          c.beginPath();
          c.moveTo(s.x - Math.sign(s.vx) * 20, s.y - 8 + i * 4);
          c.lineTo(s.x - Math.sign(s.vx) * 90, s.y - 30 + i * 4);
          c.stroke();
        }
      }
      c.fillStyle = s.rainbow ? `hsl(${(this.t * 220) % 360},95%,72%)` : s.col;
      starShape(c, s.x, s.y, s.R, s.R * 0.5, s.rot);
      c.fill();
      c.lineWidth = 3;
      c.strokeStyle = 'rgba(255,255,255,0.85)';
      c.stroke();
      face(c, s.x, s.y + 2, s.R * 0.42);
    }
    c.globalAlpha = 1;
    this.bits.draw(c);
  }

  result() {
    return { score: this.score, line: `You caught ${this.score} ${this.score === 1 ? 'star' : 'stars'}!` };
  }
}

// ---------- Bubble Pop ----------

class BubblePop {
  constructor(env) {
    this.env = env;
    this.key = 'bubble';
    this.title = 'Bubble Pop';
    this.hint = 'Pop each bubble as it floats up! A golden starfish is worth 3.';
    this.time = 40;
    this.act = null;
    this.score = 0;
    this.finished = false;
    this.pops = [];
    this.bits = new Bits();
    this.t = 0;
    this.spawn = 0.2;
    const r = env.rand;
    this.weeds = Array.from({ length: 9 }, (_, i) => [30 + i * 72 + r() * 20, 50 + r() * 60, r() * TAU]);
  }

  status() {
    return `${this.score} popped`;
  }

  update(dt) {
    this.t += dt;
    const r = this.env.rand;
    if (!this.ending) {
      this.spawn -= dt;
      if (this.spawn <= 0) {
        this.spawn = Math.max(0.38, 0.75 - this.t * 0.009) * (0.7 + r() * 0.6);
        const roll = r();
        const inside = roll < 0.12 ? 'gold' : roll < 0.45 ? 'fish' : roll < 0.6 ? 'shell' : 'none';
        this.pops.push({ x: 50 + r() * (W - 100), y: H + 40, R: 26 + r() * 14, vy: -(60 + r() * 45 + this.t * 1.2), ph: r() * TAU, inside, tint: ['#9FE0FF', '#C8B4FF', '#FFC6E2', '#B8F5C8'][Math.floor(r() * 4)] });
      }
    }
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const b = this.pops[i];
      b.y += b.vy * dt;
      b.ph += dt * 2.4;
      b.x += Math.sin(b.ph) * 18 * dt;
      if (b.y < -60) this.pops.splice(i, 1);
    }
    this.bits.update(dt);
    if (this.ending && !this.pops.length) this.finished = true;
  }

  tap(x, y) {
    let best = -1, bestD = Infinity;
    for (let i = 0; i < this.pops.length; i++) {
      const b = this.pops[i];
      const d = Math.hypot(b.x - x, b.y - y);
      if (d < b.R + 18 && d < bestD) { bestD = d; best = i; }
    }
    if (best < 0) return;
    const b = this.pops.splice(best, 1)[0];
    const pts = b.inside === 'gold' ? 3 : 1;
    this.score += pts;
    this.bits.ring(b.x, b.y, b.R, '#FFFFFF');
    this.bits.burst(b.x, b.y, b.inside === 'gold' ? ['#FFE070', '#FFC94D', '#FFFFFF'] : ['#FFFFFF', b.tint], b.inside === 'gold' ? 16 : 8, 110);
    this.bits.word(b.x, b.y - 24, `+${pts}`, b.inside === 'gold' ? '#FFE070' : '#FFFFFF', b.inside === 'gold' ? 32 : 24);
    this.env.sfx.pop();
    if (b.inside === 'gold') this.env.sfx.yay(false);
  }

  action() {}

  timeUp() {
    this.ending = true;
    for (const b of this.pops) b.vy = Math.min(b.vy, -260);
  }

  draw(c) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#7FD3F7');
    g.addColorStop(1, '#2F78C8');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // light rays
    c.fillStyle = 'rgba(255,255,255,0.08)';
    for (let i = 0; i < 5; i++) {
      const x = 60 + i * 140 + Math.sin(this.t * 0.4 + i) * 20;
      c.beginPath(); c.moveTo(x, 0); c.lineTo(x + 50, 0); c.lineTo(x - 30, H); c.lineTo(x - 90, H); c.closePath(); c.fill();
    }
    // sand and seaweed
    c.fillStyle = '#F6DFA8';
    c.beginPath(); c.moveTo(0, H - 26);
    for (let x = 0; x <= W; x += 40) c.quadraticCurveTo(x + 20, H - 36, x + 40, H - 26);
    c.lineTo(W, H); c.lineTo(0, H); c.closePath(); c.fill();
    c.strokeStyle = '#3FD8B0';
    c.lineCap = 'round';
    c.lineWidth = 8;
    for (const [x, h, p] of this.weeds) {
      c.beginPath(); c.moveTo(x, H - 26);
      c.quadraticCurveTo(x + Math.sin(this.t * 1.5 + p) * 14, H - 26 - h * 0.5, x + Math.sin(this.t * 1.5 + p + 1) * 10, H - 26 - h);
      c.stroke();
    }
    for (const b of this.pops) {
      if (b.inside === 'gold') {
        c.fillStyle = '#FFD43B';
        starShape(c, b.x, b.y, b.R * 0.6, b.R * 0.27, Math.sin(b.ph) * 0.3);
        c.fill();
        face(c, b.x, b.y, b.R * 0.26);
      } else if (b.inside === 'fish') creature(c, 'fish', b.x, b.y, b.R * 0.7);
      else if (b.inside === 'shell') creature(c, 'shell', b.x, b.y, b.R * 0.65);
      const grd = c.createRadialGradient(b.x - b.R * 0.3, b.y - b.R * 0.3, b.R * 0.1, b.x, b.y, b.R);
      grd.addColorStop(0, 'rgba(255,255,255,0.45)');
      grd.addColorStop(0.7, 'rgba(255,255,255,0.08)');
      grd.addColorStop(1, b.tint);
      c.fillStyle = grd;
      c.globalAlpha = 0.75;
      c.beginPath(); c.arc(b.x, b.y, b.R, 0, TAU); c.fill();
      c.globalAlpha = 1;
      c.strokeStyle = 'rgba(255,255,255,0.9)';
      c.lineWidth = 2.5;
      c.stroke();
      c.fillStyle = '#FFFFFF';
      c.beginPath(); c.ellipse(b.x - b.R * 0.4, b.y - b.R * 0.42, b.R * 0.18, b.R * 0.1, -0.7, 0, TAU); c.fill();
    }
    this.bits.draw(c);
  }

  result() {
    return { score: this.score, line: `You popped ${this.score} bubble${this.score === 1 ? '' : 's'}!` };
  }
}

// ---------- Fish Match (memory) ----------

const KINDS = ['fish', 'starfish', 'crab', 'jelly', 'whale', 'puffer'];
const CARD_COLS = ['#FFE6F3', '#E1F4FF', '#FFF6D8', '#E2FBF0', '#F1E8FF', '#FFE8DC'];

class FishMatch {
  constructor(env) {
    this.env = env;
    this.key = 'fish';
    this.title = 'Fish Match';
    this.hint = 'Find the pairs! Tap two cards to turn them over.';
    this.time = 0;
    this.act = null;
    this.finished = false;
    this.bits = new Bits();
    this.t = 0;
    this.flips = 0;
    this.pairs = 0;
    this.open = [];
    this.wait = 0;
    this.helpT = 70;
    const deck = shuffled([...KINDS, ...KINDS], env.rand);
    const cw = 118, ch = 108, gx = 22, gy = 16;
    const x0 = (W - (cw * 4 + gx * 3)) / 2, y0 = (H - (ch * 3 + gy * 2)) / 2;
    this.cards = deck.map((kind, i) => ({ kind, x: x0 + (i % 4) * (cw + gx), y: y0 + Math.floor(i / 4) * (ch + gy), w: cw, h: ch, up: false, done: false, turn: 0, glow: 0 }));
  }

  get score() {
    return this.finished ? this.final : this.pairs * 10;
  }

  status() {
    return `${this.pairs} of 6 pairs`;
  }

  update(dt) {
    this.t += dt;
    for (const cd of this.cards) {
      const want = cd.up || cd.done ? 1 : 0;
      cd.turn += clamp(want - cd.turn, -dt * 6, dt * 6);
      cd.glow = Math.max(0, cd.glow - dt);
    }
    if (this.wait > 0) {
      this.wait -= dt;
      if (this.wait <= 0) {
        for (const cd of this.open) cd.up = false;
        this.open = [];
      }
    }
    // after a while a little magic finds a pair now and then, so every round ends
    if (this.t > this.helpT && this.pairs < 6 && !this.open.length && this.wait <= 0) {
      this.helpT = this.t + 1.4;
      const left = this.cards.filter((cd) => !cd.done);
      if (left.length) {
        const a = left[0], b = left.find((cd) => cd !== a && cd.kind === a.kind);
        if (b) this._match(a, b, true);
      }
    }
    this.bits.update(dt);
    if (this.pairs >= 6 && !this.finished) {
      this.endT = (this.endT || 0) + dt;
      if (this.endT > 0.9) {
        this.final = matchScore(6, this.doneAt || this.t, this.flips);
        this.finished = true;
      }
    }
  }

  _match(a, b, magic = false) {
    a.done = b.done = true;
    a.up = b.up = true;
    a.glow = b.glow = 1;
    this.pairs++;
    for (const cd of [a, b]) this.bits.burst(cd.x + cd.w / 2, cd.y + cd.h / 2, SPARK, 10, 120);
    this.bits.word((a.x + b.x) / 2 + a.w / 2, (a.y + b.y) / 2 + a.h / 2 - 20, magic ? 'Magic!' : ['Match!', 'Yay!', 'Pair!', 'Hooray!'][this.pairs % 4], '#FFE070', 30);
    this.env.sfx.yay(this.pairs >= 6);
    if (this.pairs >= 6) this.doneAt = this.t;
  }

  tap(x, y) {
    if (this.wait > 0 || this.pairs >= 6) return;
    const cd = this.cards.find((q) => x >= q.x && x <= q.x + q.w && y >= q.y && y <= q.y + q.h);
    if (!cd || cd.done || cd.up) return;
    cd.up = true;
    this.flips++;
    this.env.sfx.flip();
    this.open.push(cd);
    if (this.open.length === 2) {
      const [a, b] = this.open;
      if (a.kind === b.kind) {
        this._match(a, b);
        this.open = [];
      } else this.wait = 0.85;
    }
  }

  action() {}

  timeUp() {}

  draw(c) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#9BE8CF');
    g.addColorStop(1, '#2E9E86');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    c.fillStyle = 'rgba(255,255,255,0.12)';
    for (let i = 0; i < 12; i++) { c.beginPath(); c.arc((i * 97) % W, (i * 61) % H, 6 + (i % 3) * 4, 0, TAU); c.fill(); }
    for (const cd of this.cards) {
      const s = Math.abs(Math.cos(cd.turn * Math.PI));
      const showFace = cd.turn > 0.5;
      const cx = cd.x + cd.w / 2;
      c.save();
      c.translate(cx, cd.y + cd.h / 2);
      c.scale(Math.max(0.04, s), 1);
      if (cd.glow > 0) {
        c.shadowColor = '#FFE070';
        c.shadowBlur = 30 * cd.glow;
      }
      rr(c, -cd.w / 2, -cd.h / 2, cd.w, cd.h, 18);
      if (showFace) {
        c.fillStyle = CARD_COLS[KINDS.indexOf(cd.kind)] || '#FFFFFF';
        c.fill();
        c.shadowBlur = 0;
        c.lineWidth = 5;
        c.strokeStyle = cd.done ? '#FFC94D' : '#FFFFFF';
        c.stroke();
        creature(c, cd.kind, 0, 4, 40);
      } else {
        c.fillStyle = '#4FB8FF';
        c.fill();
        c.shadowBlur = 0;
        c.lineWidth = 5;
        c.strokeStyle = '#FFFFFF';
        c.stroke();
        c.strokeStyle = 'rgba(255,255,255,0.55)';
        c.lineWidth = 4;
        for (let i = -1; i <= 1; i++) {
          c.beginPath();
          c.moveTo(-cd.w / 2 + 14, i * 22);
          c.quadraticCurveTo(-cd.w / 4, i * 22 - 10, 0, i * 22);
          c.quadraticCurveTo(cd.w / 4, i * 22 + 10, cd.w / 2 - 14, i * 22);
          c.stroke();
        }
        text(c, '?', 0, 2, 40, '#FFFFFF', 'center', '#2F78C8');
      }
      c.restore();
    }
    this.bits.draw(c);
  }

  result() {
    return { score: this.score, line: `All six pairs found in ${Math.round(this.doneAt || this.t)} seconds!` };
  }
}

// ---------- the deck games (timing) ----------

const THROWS = 5;
const DECK = {
  hoops: { title: 'Hoops', hint: 'Tap Throw! when the arrow is on the star.', act: 'Throw!', words: ['In!', 'Nice shot!', 'Swish!'] },
  ring: { title: 'Ring Toss', hint: 'Tap Toss! when the arrow is on the star.', act: 'Toss!', words: ['Ringer!', 'Nice toss!', 'Gold bottle!'] },
  shuffle: { title: 'Shuffleboard', hint: 'Tap Slide! when the arrow is on the star.', act: 'Slide!', words: ['7 zone!', '8 zone!', '10 zone!'] },
};

class DeckGame {
  constructor(env, kind) {
    const d = DECK[kind] || DECK.hoops;
    this.env = env;
    this.key = kind in DECK ? kind : 'hoops';
    this.title = d.title;
    this.hint = d.hint;
    this.act = d.act;
    this.words = d.words;
    this.time = 0;
    this.score = 0;
    this.finished = false;
    this.bits = new Bits();
    this.n = 0; // throws made
    this.t = 0;
    this.mt = env.rand() * 2; // the meter's clock
    this.anim = null; // { t, pts, level }
    this.target = this._target();
    this.landed = []; // rings on bottles / pucks on the court, kept to look at
  }

  _target() {
    return 0.35 + this.env.rand() * 0.3;
  }

  status() {
    return `Throw ${Math.min(THROWS, this.n + 1)} of ${THROWS}`;
  }

  update(dt) {
    this.t += dt;
    if (!this.anim) {
      const before = meterValue(this.mt, meterSpeed(this.n));
      this.mt += dt;
      const now = meterValue(this.mt, meterSpeed(this.n));
      if ((before < this.target) !== (now < this.target)) this.env.sfx.tick();
    } else {
      const a = this.anim;
      a.t += dt / 1.25;
      if (!a.scored && a.t >= 0.72) {
        a.scored = true;
        this.score += a.pts;
        const [wx, wy] = this._spot(a.level);
        this.bits.burst(wx, wy, SPARK, a.level === 2 ? 18 : 10);
        this.bits.word(wx, wy - 40, `+${a.pts} ${this.words[a.level]}`, a.level === 2 ? '#FFE070' : '#FFFFFF', a.level === 2 ? 30 : 24);
        if (this.key === 'hoops') this.env.sfx.swish();
        else if (this.key === 'ring') this.env.sfx.clink();
        else this.env.sfx.thunk();
        if (a.level === 2) this.env.sfx.yay(false);
        if (this.key !== 'hoops') this.landed.push(a.level);
      }
      if (a.t >= 1) {
        this.anim = null;
        this.n++;
        this.target = this._target();
        if (this.n >= THROWS) this.finished = true;
      }
    }
    this.bits.update(dt);
  }

  tap() {
    this.action();
  }

  action() {
    if (this.anim || this.finished) return;
    const v = meterValue(this.mt, meterSpeed(this.n));
    const q = meterQuality(v, this.target, 0.3);
    const pts = throwPoints(q);
    this.anim = { t: 0, pts, level: pts - 1, scored: false, v };
    this.env.sfx.throw(0.4 + q * 0.6);
  }

  timeUp() {}

  /** Where a throw of this level ends (logical px). */
  _spot(level) {
    if (this.key === 'hoops') return [470, 150];
    if (this.key === 'ring') return [[440, 250], [320, 205], [320, 150]][level];
    return [320, [190, 140, 92][level]];
  }

  draw(c) {
    if (this.key === 'hoops') this._hoops(c);
    else if (this.key === 'ring') this._ring(c);
    else this._shuffle(c);
    this._meter(c);
    this.bits.draw(c);
    // the throws so far
    for (let i = 0; i < THROWS; i++) {
      c.fillStyle = i < this.n ? '#FFC94D' : 'rgba(255,255,255,0.6)';
      starShape(c, 24 + i * 30, 26, 11, 5);
      c.fill();
    }
  }

  _meter(c) {
    const x0 = 140, x1 = 500, y = 352;
    rr(c, x0 - 8, y - 18, x1 - x0 + 16, 36, 18);
    c.fillStyle = 'rgba(255,255,255,0.92)';
    c.fill();
    const g = c.createLinearGradient(x0, 0, x1, 0);
    g.addColorStop(0, '#FFD1E6');
    g.addColorStop(1, '#D9CCFF');
    rr(c, x0, y - 10, x1 - x0, 20, 10);
    c.fillStyle = g;
    c.fill();
    // the sweet spot
    const tx = x0 + (x1 - x0) * this.target;
    const zw = (x1 - x0) * 0.3 * 0.25;
    rr(c, tx - zw * 3, y - 10, zw * 6, 20, 10);
    c.fillStyle = '#B8F5C8';
    c.fill();
    rr(c, tx - zw, y - 10, zw * 2, 20, 10);
    c.fillStyle = '#3FD8B0';
    c.fill();
    c.fillStyle = '#FFE070';
    starShape(c, tx, y, 14, 6);
    c.fill();
    c.strokeStyle = INK;
    c.lineWidth = 2;
    c.stroke();
    // the arrow
    const v = this.anim ? this.anim.v : meterValue(this.mt, meterSpeed(this.n));
    const ax = x0 + (x1 - x0) * v;
    c.fillStyle = '#FF5FA2';
    c.beginPath(); c.moveTo(ax, y - 4); c.lineTo(ax - 13, y - 28); c.lineTo(ax + 13, y - 28); c.closePath(); c.fill();
    c.strokeStyle = '#FFFFFF';
    c.lineWidth = 3;
    c.stroke();
  }

  _hoops(c) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#A6D8FF');
    g.addColorStop(1, '#E1F4FF');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // the deck: planks and a rail with the sea beyond
    c.fillStyle = '#4FB8FF';
    c.fillRect(0, 210, W, 30);
    c.fillStyle = '#E9C99A';
    c.fillRect(0, 240, W, H - 240);
    c.strokeStyle = 'rgba(160,110,60,0.25)';
    c.lineWidth = 2;
    for (let y = 252; y < H; y += 22) { c.beginPath(); c.moveTo(0, y); c.lineTo(W, y); c.stroke(); }
    c.fillStyle = '#FFFFFF';
    c.fillRect(0, 200, W, 8);
    for (let x = 10; x < W; x += 40) c.fillRect(x, 200, 6, 40);
    // the hoop
    c.fillStyle = '#FFFFFF';
    c.fillRect(548, 60, 14, 250);
    rr(c, 500, 70, 90, 70, 8); c.fill();
    c.strokeStyle = '#FF7EB6'; c.lineWidth = 4;
    c.strokeRect(526, 92, 36, 28);
    // the ball in flight
    let bx = 120, by = 300, behind = false;
    const a = this.anim;
    if (a) {
      const t = Math.min(1, a.t / 0.72);
      const end = a.level === 2 ? [470, 150] : a.level === 1 ? [452, 142] : [520, 112];
      bx = 120 + (end[0] - 120) * t;
      by = 300 + (end[1] - 300) * t - Math.sin(t * Math.PI) * 170;
      if (a.t > 0.72) {
        // then into the net (a bounce first for the "ok" ones)
        const k = (a.t - 0.72) / 0.28;
        const bounce = a.level === 0 ? Math.sin(k * Math.PI * 2) * 22 * (1 - k) : a.level === 1 ? Math.sin(k * Math.PI) * 10 : 0;
        bx = end[0] + (470 - end[0]) * ease(Math.min(1, k * 1.6));
        by = Math.min(end[1], 150) - bounce + k * 70;
        behind = true;
      }
    }
    const drawBall = () => {
      c.fillStyle = '#FF8A3D';
      c.beginPath(); c.arc(bx, by, 18, 0, TAU); c.fill();
      c.strokeStyle = INK; c.lineWidth = 2;
      c.beginPath(); c.moveTo(bx - 18, by); c.lineTo(bx + 18, by); c.moveTo(bx, by - 18); c.lineTo(bx, by + 18); c.stroke();
    };
    if (!behind) drawBall();
    // net and rim (the ball drops behind the front of the rim)
    c.strokeStyle = 'rgba(255,255,255,0.95)';
    c.lineWidth = 2.5;
    for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(440 + i * 15, 152); c.lineTo(452 + i * 9, 210); c.stroke(); }
    if (behind) drawBall();
    c.strokeStyle = '#FF6A3D';
    c.lineWidth = 6;
    c.beginPath(); c.ellipse(470, 150, 32, 7, 0, 0, TAU); c.stroke();
    // her hands, ready to throw
    if (!a) {
      c.fillStyle = '#FFD7BF';
      c.beginPath(); c.arc(104, 318, 12, 0, TAU); c.arc(136, 318, 12, 0, TAU); c.fill();
    }
  }

  _ring(c) {
    const g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#FFE6F3');
    g.addColorStop(1, '#FFF6D8');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // the table, three rows of bottles (the gold one in the middle at the back)
    c.fillStyle = '#FF7EB6';
    rr(c, 90, 250, 460, 40, 10); c.fill();
    for (let i = 0; i < 10; i++) { c.fillStyle = i % 2 ? '#FFFFFF' : '#FF7EB6'; c.fillRect(90 + i * 46, 290, 46, 50); }
    const rows = [[150, [200, 260, 320, 380, 440], 0.9], [205, [230, 320, 410], 1], [250, [170, 260, 380, 470], 1.1]];
    const cols = ['#7CFFB0', '#7CC8FF', '#FFB0D6', '#FFE070', '#C8B4FF'];
    rows.forEach(([y, xs, s], r) => {
      xs.forEach((x, i) => {
        const gold = r === 0 && x === 320;
        c.fillStyle = gold ? '#FFC94D' : cols[(i + r) % cols.length];
        c.globalAlpha = 0.9;
        rr(c, x - 14 * s, y - 50 * s, 28 * s, 50 * s, 8 * s); c.fill();
        c.fillRect(x - 5 * s, y - 72 * s, 10 * s, 24 * s);
        c.globalAlpha = 1;
        c.fillStyle = 'rgba(255,255,255,0.5)';
        c.fillRect(x - 9 * s, y - 44 * s, 4 * s, 30 * s);
        if (gold) { c.fillStyle = '#FFFFFF'; starShape(c, x, y - 26 * s, 8 * s, 3.5 * s); c.fill(); }
      });
    });
    // rings that landed stay on their bottles
    const ringAt = (x, y, col) => {
      c.strokeStyle = col;
      c.lineWidth = 5;
      c.beginPath(); c.ellipse(x, y, 20, 6, 0, 0, TAU); c.stroke();
    };
    const RC = ['#4FB8FF', '#3FD8B0', '#FF5FA2', '#9C7BFF', '#FF9F43'];
    this.landed.forEach((lv, i) => {
      const [x, y] = this._spot(lv);
      ringAt(x + ((i % 2) - 0.5) * 4, y - 40 + i * 2, RC[i % RC.length]);
    });
    const a = this.anim;
    if (a) {
      const t = Math.min(1, a.t / 0.72);
      const [ex, ey] = this._spot(a.level);
      const x = 320 + (ex - 320) * t, y = 380 + (ey - 40 - 380) * t - Math.sin(t * Math.PI) * 120;
      c.save();
      c.translate(x, y);
      c.rotate(t * 6);
      c.scale(1, 0.35 + 0.65 * (1 - t) * 0.5 + 0.0);
      c.strokeStyle = RC[this.n % RC.length];
      c.lineWidth = 6;
      c.beginPath(); c.arc(0, 0, 22, 0, TAU); c.stroke();
      c.restore();
    } else {
      c.strokeStyle = RC[this.n % RC.length];
      c.lineWidth = 7;
      c.beginPath(); c.arc(320, 318, 24, 0, TAU); c.stroke();
    }
  }

  _shuffle(c) {
    c.fillStyle = '#9FE0FF';
    c.fillRect(0, 0, W, H);
    // the court from above: long, the triangle at the far end (top)
    const x0 = 230, x1 = 410;
    c.fillStyle = '#E9C99A';
    rr(c, x0, 20, x1 - x0, 300, 12); c.fill();
    c.strokeStyle = '#4FB8FF'; c.lineWidth = 6;
    c.strokeRect(x0, 20, x1 - x0, 300);
    c.strokeStyle = INK; c.lineWidth = 3;
    c.beginPath(); c.moveTo(320, 60); c.lineTo(395, 210); c.lineTo(245, 210); c.closePath(); c.stroke();
    c.beginPath(); c.moveTo(283, 135); c.lineTo(357, 135); c.moveTo(264, 172); c.lineTo(376, 172); c.stroke();
    text(c, '10', 320, 108, 22, INK, 'center', null);
    text(c, '8', 320, 155, 22, INK, 'center', null);
    text(c, '7', 320, 192, 22, INK, 'center', null);
    c.fillStyle = 'rgba(255,255,255,0.6)';
    c.fillRect(x0 + 6, 280, x1 - x0 - 12, 4);
    // pucks that stopped stay where they are
    const puck = (x, y, col) => {
      c.fillStyle = 'rgba(58,31,77,0.25)';
      c.beginPath(); c.arc(x + 2, y + 3, 15, 0, TAU); c.fill();
      c.fillStyle = col;
      c.beginPath(); c.arc(x, y, 15, 0, TAU); c.fill();
      c.strokeStyle = '#FFFFFF'; c.lineWidth = 3; c.stroke();
    };
    const PC = ['#FF5FA2', '#4FB8FF'];
    this.landed.forEach((lv, i) => {
      const [, y] = this._spot(lv);
      puck(320 + ((i * 37) % 60) - 30, y, PC[i % 2]);
    });
    const a = this.anim;
    if (a) {
      const t = Math.min(1, a.t / 0.72);
      const [, ey] = this._spot(a.level);
      const k = 1 - Math.pow(1 - t, 2.2); // slows down as it slides
      const x = 320 + Math.sin(t * 3) * 6 * (1 - t);
      puck(x, 300 + (ey - 300) * k, PC[this.n % 2]);
    } else puck(320, 300, PC[this.n % 2]);
    // the cue
    if (!a) {
      c.strokeStyle = '#FFFFFF'; c.lineWidth = 6; c.lineCap = 'round';
      c.beginPath(); c.moveTo(320, 318); c.lineTo(320, 392); c.stroke();
    }
  }

  result() {
    const best = THROWS * 3;
    return { score: this.score, line: this.score >= best ? 'Every throw a star throw!' : `${this.score} points from ${THROWS} throws!` };
  }
}

// ---------- Mini Golf ----------

class Golf {
  constructor(env) {
    this.env = env;
    this.key = 'golf';
    this.title = 'Mini Golf';
    this.hint = 'Tap the green to aim, then tap Putt! when the power is right.';
    this.time = 0;
    this.act = 'Putt!';
    this.finished = false;
    this.bits = new Bits();
    const o = env.opts || {};
    this.course = golfCourse(o.holes || 6, o.pars || null);
    this.hole = Math.max(0, Math.min(this.course.length - 1, (o.start | 0) || 0));
    this.first = this.hole;
    this.stars = [];
    this.strokesAll = 0;
    this.t = 0;
    this._startHole();
  }

  get score() {
    return this.stars.reduce((s, n) => s + n, 0);
  }

  _startHole() {
    const h = this.course[this.hole];
    this.h = h;
    this.ball = newBall(h);
    this.strokes = 0;
    this.aim = { x: h.cup[0], y: h.cup[1] };
    this.pt = this.env.rand() * 2;
    this.banner = null;
    this.magic = null;
  }

  status() {
    return `Hole ${this.hole + 1} of ${this.course.length} - Par ${this.h.par} - Putts ${this.strokes}`;
  }

  power() {
    return meterValue(this.pt, 0.55);
  }

  update(dt) {
    this.t += dt;
    const b = this.ball;
    if (this.magic) {
      // the ball rolls in by magic after many putts: every hole ends happily
      const m = this.magic;
      m.t += dt / 1.1;
      const k = ease(Math.min(1, m.t));
      b.x = m.x + (this.h.cup[0] - m.x) * k;
      b.y = m.y + (this.h.cup[1] - m.y) * k;
      if (m.t >= 1) {
        this.magic = null;
        this._inCup(true);
      }
    } else if (b.moving) {
      const ev = stepBall(b, this.h, dt);
      if (ev === 'bump') this.env.sfx.boing();
      if (ev === 'cup') this._inCup(false);
    } else if (!this.banner) {
      this.pt += dt;
    }
    if (this.banner) {
      this.banner.t += dt;
      if (this.banner.t > 1.9) {
        this.banner = null;
        if (this.hole + 1 < this.course.length) {
          this.hole++;
          this._startHole();
        } else this.finished = true;
      }
    }
    this.bits.update(dt);
  }

  _inCup(magic) {
    const h = this.h;
    const s = holeStars(this.strokes, h.par);
    this.stars.push(s);
    this.env.sfx.plop();
    this.env.sfx.yay(s === 3);
    this.bits.burst(h.cup[0], h.cup[1], SPARK, 22, 160);
    let word;
    if (magic) word = 'In it goes!';
    else if (this.strokes === 1) word = 'Hole in one!';
    else if (this.strokes < h.par) word = 'Super putt!';
    else if (this.strokes === h.par) word = 'Par! Great!';
    else word = ['You did it!', 'In the cup!', 'Hooray!'][this.strokes % 3];
    this.banner = { t: 0, word, stars: s };
  }

  tap(x, y) {
    if (this.ball.moving || this.magic || this.banner) return;
    if (x < 20 || x > W - 20 || y < 20 || y > H - 20) return;
    if (Math.hypot(x - this.ball.x, y - this.ball.y) < 14) return;
    this.aim = { x, y };
    this.env.sfx.tick();
  }

  action() {
    const b = this.ball;
    if (b.moving || this.magic || this.banner || this.finished) return;
    this.strokes++;
    this.strokesAll++;
    if (this.strokes > GOLF.MAX_STROKES) {
      this.magic = { t: 0, x: b.x, y: b.y };
      this.env.sfx.throw(0.5);
      return;
    }
    const p = 0.12 + 0.88 * this.power();
    putt(b, this.aim.x, this.aim.y, p);
    this.env.sfx.throw(p);
  }

  timeUp() {}

  draw(c) {
    const h = this.h, b = this.ball;
    c.fillStyle = '#9FE0FF';
    c.fillRect(0, 0, W, H);
    // the green inside a wooden border
    rr(c, 6, 6, W - 12, H - 12, 22);
    c.fillStyle = '#C98F55'; c.fill();
    rr(c, 20, 20, W - 40, H - 40, 14);
    const g = c.createLinearGradient(0, 20, 0, H - 20);
    g.addColorStop(0, '#8BDC86');
    g.addColorStop(1, '#6CC46A');
    c.fillStyle = g; c.fill();
    c.fillStyle = 'rgba(255,255,255,0.07)';
    for (let x = 20; x < W - 20; x += 40) c.fillRect(x, 20, 20, H - 40);
    for (const w of h.walls) {
      rr(c, w[0], w[1], w[2] - w[0], w[3] - w[1], 6);
      c.fillStyle = '#C98F55'; c.fill();
      c.strokeStyle = '#A8723F'; c.lineWidth = 2; c.stroke();
    }
    for (const bp of h.bumpers) {
      c.fillStyle = '#FF7EB6';
      c.beginPath(); c.arc(bp[0], bp[1], bp[2], 0, TAU); c.fill();
      c.strokeStyle = '#FFFFFF'; c.lineWidth = 4; c.stroke();
      c.fillStyle = '#FFFFFF'; starShape(c, bp[0], bp[1], bp[2] * 0.45, bp[2] * 0.2); c.fill();
    }
    // tee and cup with its flag
    c.fillStyle = 'rgba(255,255,255,0.35)';
    c.beginPath(); c.arc(h.tee[0], h.tee[1], 18, 0, TAU); c.fill();
    c.fillStyle = '#3A3050';
    c.beginPath(); c.arc(h.cup[0], h.cup[1], GOLF.CUP, 0, TAU); c.fill();
    c.strokeStyle = '#FFFFFF'; c.lineWidth = 3;
    c.beginPath(); c.moveTo(h.cup[0], h.cup[1]); c.lineTo(h.cup[0], h.cup[1] - 60); c.stroke();
    c.fillStyle = '#FF5FA2';
    const wave = Math.sin(this.t * 4) * 4;
    c.beginPath(); c.moveTo(h.cup[0], h.cup[1] - 60); c.lineTo(h.cup[0] + 34, h.cup[1] - 50 + wave); c.lineTo(h.cup[0], h.cup[1] - 40); c.closePath(); c.fill();
    // aim: a dotted line and the power bar
    const ready = !b.moving && !this.magic && !this.banner;
    if (ready) {
      const dx = this.aim.x - b.x, dy = this.aim.y - b.y;
      const d = Math.hypot(dx, dy) || 1;
      const len = 40 + 130 * this.power();
      c.setLineDash([8, 8]);
      c.strokeStyle = 'rgba(255,255,255,0.9)';
      c.lineWidth = 4;
      c.beginPath(); c.moveTo(b.x, b.y); c.lineTo(b.x + (dx / d) * len, b.y + (dy / d) * len); c.stroke();
      c.setLineDash([]);
      const ax = b.x + (dx / d) * len, ay = b.y + (dy / d) * len;
      c.fillStyle = '#FFE070';
      c.beginPath(); c.moveTo(ax + (dx / d) * 14, ay + (dy / d) * 14); c.lineTo(ax - (dy / d) * 10, ay + (dx / d) * 10); c.lineTo(ax + (dy / d) * 10, ay - (dx / d) * 10); c.closePath(); c.fill();
      // power bar on the right edge
      rr(c, W - 52, 70, 26, 260, 13);
      c.fillStyle = 'rgba(255,255,255,0.9)'; c.fill();
      const p = this.power();
      const pg = c.createLinearGradient(0, 330, 0, 70);
      pg.addColorStop(0, '#3FD8B0');
      pg.addColorStop(0.6, '#FFC94D');
      pg.addColorStop(1, '#FF5FA2');
      rr(c, W - 48, 74 + 252 * (1 - p), 18, 252 * p, 9);
      c.fillStyle = pg; c.fill();
    }
    // the ball
    if (!(this.banner && this.banner.t > 0.05)) {
      c.fillStyle = 'rgba(58,31,77,0.25)';
      c.beginPath(); c.arc(b.x + 2, b.y + 3, GOLF.BALL, 0, TAU); c.fill();
      c.fillStyle = this.magic ? '#FFF6B0' : '#FFFFFF';
      c.beginPath(); c.arc(b.x, b.y, GOLF.BALL, 0, TAU); c.fill();
      c.strokeStyle = '#D9D2E6'; c.lineWidth = 1.5; c.stroke();
      if (this.magic) this.bits.burst(b.x, b.y, SPARK, 1, 40);
    }
    // hole name
    text(c, `${this.hole + 1}. ${h.name}`, 40, 40, 18, '#FFFFFF', 'left');
    if (this.banner) {
      const k = Math.min(1, this.banner.t * 4);
      c.globalAlpha = k;
      rr(c, W / 2 - 170, H / 2 - 60, 340, 120, 30);
      c.fillStyle = 'rgba(255,255,255,0.95)'; c.fill();
      text(c, this.banner.word, W / 2, H / 2 - 20, 38, '#FF5FA2');
      for (let i = 0; i < 3; i++) {
        c.fillStyle = i < this.banner.stars ? '#FFC94D' : '#E8E0F0';
        starShape(c, W / 2 - 50 + i * 50, H / 2 + 30, 20, 9);
        c.fill();
      }
      c.globalAlpha = 1;
    }
    this.bits.draw(c);
  }

  result() {
    const n = this.stars.length;
    const all3 = n && this.stars.every((s) => s === 3);
    return { score: this.score, line: all3 ? 'Par or better on every hole!' : `${n} ${n === 1 ? 'hole' : 'holes'} played, ${this.score} stars!` };
  }
}

/** Make a game: key star | bubble | fish | hoops | ring | shuffle | golf. env: { sfx, rand, opts }. */
export function makeGame(key, env) {
  if (key === 'star') return new StarCatcher(env);
  if (key === 'bubble') return new BubblePop(env);
  if (key === 'fish') return new FishMatch(env);
  if (key === 'golf') return new Golf(env);
  return new DeckGame(env, key);
}

export const GAME_KEYS = ['star', 'bubble', 'fish', 'hoops', 'ring', 'shuffle', 'golf'];
