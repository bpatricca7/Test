'use strict';
// ECHO — every frame of the film is drawn here, as a pure function of time.
// render.js loads this page, calls init(timeline, audioEnv) once, then
// renderFrame(t) for each frame and captures the canvas.

const W = 1920, H = 1080;
const cv = document.getElementById('c');
const ctx = cv.getContext('2d');
const FONT = '"FreeMono", "Courier New", monospace';

let TL = null;       // timeline.json
let ENV = null;      // audio_env.json (optional)
let SKY = null, FAR = null, NEAR = null, WATERFALL_NOISE = null, SCANLINES = null, VIGNETTE = null;
let BRIGHT_STARS = [];
let GLOW = {};

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function mulberry32(a) {
  return function () {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}
const clamp = (x, a = 0, b = 1) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0)); return t * t * (3 - 2 * t); };
const easeInOut = t => t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const window01 = (t, a, b, fin, fout) => smooth(a, a + fin, t) * (1 - smooth(b - fout, b, t));

function gauss(rnd) {
  let u = 0, v = 0;
  while (u === 0) u = rnd();
  while (v === 0) v = rnd();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function makeCanvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

function glowSprite(r, g, b) {
  const s = makeCanvas(64, 64);
  const x = s.getContext('2d');
  const grd = x.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, `rgba(${r},${g},${b},1)`);
  grd.addColorStop(0.25, `rgba(${r},${g},${b},0.35)`);
  grd.addColorStop(1, `rgba(${r},${g},${b},0)`);
  x.fillStyle = grd;
  x.fillRect(0, 0, 64, 64);
  return s;
}

function envAt(key, t) {
  if (!ENV || !ENV[key]) return 0;
  const arr = ENV[key];
  const f = t * ENV.fps;
  const i = Math.floor(f);
  if (i < 0 || i >= arr.length - 1) return 0;
  return lerp(arr[i], arr[i + 1], f - i);
}

// 1-D fractal value noise for mountain ridges
function ridgeNoise(seed) {
  const rnd = mulberry32(seed);
  const vals = Array.from({ length: 512 }, () => rnd());
  const at = x => {
    const i = Math.floor(x), f = x - i;
    const a = vals[((i % 512) + 512) % 512], b = vals[(((i + 1) % 512) + 512) % 512];
    const u = f * f * (3 - 2 * f);
    return a + (b - a) * u;
  };
  return x => {
    let s = 0, amp = 1, fr = 1, norm = 0;
    for (let o = 0; o < 6; o++) { s += amp * at(x * fr); norm += amp; amp *= 0.5; fr *= 2.03; }
    return s / norm;
  };
}

// ---------------------------------------------------------------------------
// one-time scene assets
// ---------------------------------------------------------------------------

function buildSky() {
  const S = 2800;
  const c = makeCanvas(S, S);
  const x = c.getContext('2d');
  const rnd = mulberry32(3141);
  const blobs = [glowSprite(170, 190, 255), glowSprite(255, 228, 200), glowSprite(205, 215, 235)];

  // Milky Way band
  const ang = -0.62;
  const ca = Math.cos(ang), sa = Math.sin(ang);
  x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 9000; i++) {
    const u = (rnd() * 2 - 1) * 1500;
    const width = 170 + 90 * Math.sin(u * 0.004 + 1.3) + 50 * Math.sin(u * 0.011);
    const v = gauss(rnd) * width;
    const px = S / 2 + u * ca - v * sa, py = S / 2 + u * sa + v * ca;
    const r = 18 + rnd() * 80;
    x.globalAlpha = 0.010 + rnd() * 0.022;
    x.drawImage(blobs[i % 3], px - r, py - r, r * 2, r * 2);
  }
  // dust lanes through the band
  x.globalCompositeOperation = 'destination-out';
  for (let i = 0; i < 2600; i++) {
    const u = (rnd() * 2 - 1) * 1500;
    const v = gauss(rnd) * 38 + 30 * Math.sin(u * 0.006);
    const px = S / 2 + u * ca - v * sa, py = S / 2 + u * sa + v * ca;
    const r = 10 + rnd() * 40;
    x.globalAlpha = 0.05 + rnd() * 0.09;
    x.drawImage(blobs[2], px - r, py - r, r * 2, r * 2);
  }
  // dense faint stars in the band
  x.globalCompositeOperation = 'lighter';
  for (let i = 0; i < 16000; i++) {
    const u = (rnd() * 2 - 1) * 1500;
    const v = gauss(rnd) * 200;
    const px = S / 2 + u * ca - v * sa, py = S / 2 + u * sa + v * ca;
    x.globalAlpha = 0.15 + rnd() * 0.45;
    x.fillStyle = rnd() < 0.3 ? '#ffe9d0' : '#dfe8ff';
    x.fillRect(px, py, 1, 1);
  }
  // field stars
  for (let i = 0; i < 5200; i++) {
    const px = rnd() * S, py = rnd() * S;
    const m = Math.pow(rnd(), 3.2);
    x.globalAlpha = 0.18 + m * 0.8;
    const tint = rnd();
    x.fillStyle = tint < 0.15 ? '#ffd9b0' : tint < 0.35 ? '#c9d8ff' : '#f4f6ff';
    const s = m > 0.55 ? 2 : m > 0.25 ? 1.5 : 1;
    x.fillRect(px, py, s, s);
  }
  x.globalAlpha = 1;
  x.globalCompositeOperation = 'source-over';

  // the brightest stars twinkle individually
  BRIGHT_STARS = [];
  for (let i = 0; i < 170; i++) {
    BRIGHT_STARS.push({
      x: rnd() * S, y: rnd() * S,
      r: 1.2 + Math.pow(rnd(), 2) * 2.4,
      ph: rnd() * 6.283, fr: 1.5 + rnd() * 4,
      tint: rnd() < 0.2 ? 1 : rnd() < 0.4 ? 2 : 0,
    });
  }
  return c;
}

function buildRidges() {
  const pad = 200;
  const w = W + pad * 2;
  const far = makeCanvas(w, H);
  const near = makeCanvas(w, H);
  const nf = ridgeNoise(7), nn = ridgeNoise(19);

  // far ridge
  let x = far.getContext('2d');
  x.beginPath();
  x.moveTo(0, H);
  for (let i = 0; i <= w; i += 3) {
    const y = H * 0.705 - 150 * nf(i / 260) + 40 * nf(i / 60);
    x.lineTo(i, y);
  }
  x.lineTo(w, H);
  x.closePath();
  const g1 = x.createLinearGradient(0, H * 0.55, 0, H);
  g1.addColorStop(0, '#0a1222');
  g1.addColorStop(1, '#03060c');
  x.fillStyle = g1;
  x.fill();

  // near ridge with the telescope
  x = near.getContext('2d');
  const ridgeY = i => H * 0.80 - 90 * nn(i / 380) - 16 * nn(i / 45);
  x.beginPath();
  x.moveTo(0, H);
  for (let i = 0; i <= w; i += 3) x.lineTo(i, ridgeY(i));
  x.lineTo(w, H);
  x.closePath();
  x.fillStyle = '#010102';
  x.fill();

  // the telescope
  const dx = pad + W * 0.70;
  const base = ridgeY(dx) + 8;
  const towerH = 190;
  x.fillStyle = '#010102';
  x.beginPath();
  x.moveTo(dx - 60, base);
  x.lineTo(dx - 22, base - towerH);
  x.lineTo(dx + 22, base - towerH);
  x.lineTo(dx + 60, base);
  x.closePath();
  x.fill();
  // lattice hints on the tower
  x.strokeStyle = 'rgba(70,90,130,0.16)';
  x.lineWidth = 1.2;
  for (let k = 0; k < 5; k++) {
    const y0 = base - k * towerH / 5, y1 = base - (k + 1) * towerH / 5;
    const hw0 = 60 - 38 * (k / 5), hw1 = 60 - 38 * ((k + 1) / 5);
    x.beginPath(); x.moveTo(dx - hw0, y0); x.lineTo(dx + hw1, y1); x.stroke();
    x.beginPath(); x.moveTo(dx + hw0, y0); x.lineTo(dx - hw1, y1); x.stroke();
  }
  // dish: a tilted bowl facing up-left
  const hubX = dx, hubY = base - towerH - 20;
  const tilt = -0.62;
  x.save();
  x.translate(hubX, hubY);
  x.rotate(tilt);
  x.fillStyle = '#010102';
  x.beginPath();
  x.ellipse(0, 0, 190, 58, 0, 0, Math.PI * 2);
  x.fill();
  x.beginPath();
  x.ellipse(0, 0, 190, 118, 0, 0, Math.PI, false); // back of the bowl
  x.fill();
  // rim light on the lip
  x.strokeStyle = 'rgba(130,160,220,0.33)';
  x.lineWidth = 2;
  x.beginPath();
  x.ellipse(0, 0, 190, 58, 0, Math.PI * 1.02, Math.PI * 1.98);
  x.stroke();
  // feed legs converging on the focal point
  x.strokeStyle = '#010102';
  x.lineWidth = 5;
  const fy = -175;
  for (const lx of [-150, 0, 150]) {
    x.beginPath(); x.moveTo(lx, lx === 0 ? -40 : -8); x.lineTo(0, fy); x.stroke();
  }
  x.fillRect(-12, fy - 22, 24, 26);
  x.strokeStyle = 'rgba(130,160,220,0.18)';
  x.lineWidth = 1.2;
  for (const lx of [-150, 150]) {
    x.beginPath(); x.moveTo(lx, -8); x.lineTo(0, fy); x.stroke();
  }
  x.restore();
  // counterweight between tower and bowl
  x.fillRect(dx - 30, base - towerH - 30, 60, 30);

  // control hut with one warm window
  const hx = pad + W * 0.595, hb = ridgeY(hx) + 6;
  x.fillStyle = '#010102';
  x.fillRect(hx - 55, hb - 44, 110, 44);
  x.beginPath(); x.moveTo(hx - 62, hb - 44); x.lineTo(hx, hb - 66); x.lineTo(hx + 62, hb - 44); x.fill();
  x.fillRect(hx + 30, hb - 90, 3, 40); // antenna mast

  const feed = {
    x: hubX + Math.cos(tilt) * 0 - Math.sin(tilt) * fy - pad,
    y: hubY + Math.sin(tilt) * 0 + Math.cos(tilt) * fy - 22,
  };
  const hut = { x: hx - pad, y: hb, mast: { x: hx + 31.5 - pad, y: hb - 90 } };
  return { far, near, pad, feed, hut };
}

function buildWaterfallNoise() {
  const c = makeCanvas(1680, 400);
  const x = c.getContext('2d');
  const rnd = mulberry32(99);
  for (let i = 0; i < 26000; i++) {
    const px = rnd() * 1680, py = rnd() * 400;
    const a = Math.pow(rnd(), 3) * 0.55;
    x.fillStyle = `rgba(90,255,190,${a})`;
    x.fillRect(px, py, 1 + (rnd() < 0.2 ? 1 : 0), 1);
  }
  return c;
}

function buildScanlines() {
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  x.fillStyle = 'rgba(0,0,0,0.28)';
  for (let y = 0; y < H; y += 3) x.fillRect(0, y, W, 1);
  return c;
}

function buildVignette() {
  const c = makeCanvas(W, H);
  const x = c.getContext('2d');
  const g = x.createRadialGradient(W / 2, H / 2, H * 0.35, W / 2, H / 2, H * 1.05);
  g.addColorStop(0, 'rgba(0,0,0,0)');
  g.addColorStop(1, 'rgba(0,0,0,0.72)');
  x.fillStyle = g;
  x.fillRect(0, 0, W, H);
  return c;
}

// ---------------------------------------------------------------------------
// typewriter text
// ---------------------------------------------------------------------------

function slotPos(slot) {
  if (slot === 'center') return { x: 0.14 * W, y: 0.5 * H, size: 34 };
  if (slot === 'center-high') return { x: 0.14 * W, y: 0.5 * H - 76, size: 34 };
  if (slot === 'lower') return { x: 0.14 * W, y: 0.845 * H, size: 34 };
  if (slot.startsWith('col')) {
    const i = +slot.slice(3);
    return { x: 0.455 * W, y: 0.30 * H + i * 66, size: 32 };
  }
  return { x: 0.14 * W, y: 0.5 * H, size: 34 };
}

function charsTyped(cue, t) {
  const ct = cue.char_times;
  let lo = 0, hi = ct.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (ct[m] <= t) lo = m + 1; else hi = m; }
  return lo;
}

function drawText(t) {
  // the newest line that has started owns the cursor
  let cursorCue = null;
  for (const cue of TL.text) {
    if (cue.start <= t && t <= cue.hold_until) cursorCue = cue;
  }
  for (const cue of TL.text) {
    const end = cue.hold_until + cue.fade;
    if (t < cue.start || t > end) continue;
    const n = charsTyped(cue, t);
    const alpha = 1 - smooth(cue.hold_until, end, t);
    const p = slotPos(cue.slot);
    const emph = cue.style === 'emph';
    const txt = cue.text.slice(0, n);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `bold ${p.size}px ${FONT}`;
    ctx.textBaseline = 'middle';
    ctx.shadowColor = emph ? 'rgba(255,150,70,0.6)' : 'rgba(210,225,255,0.35)';
    ctx.shadowBlur = emph ? 16 : 10;
    ctx.fillStyle = emph ? '#ffc98a' : '#ecebe4';
    ctx.fillText(txt, p.x, p.y);
    if (cue === cursorCue) {
      const typing = t < cue.typed_end + 0.06;
      const on = typing || Math.floor((t - cue.typed_end) / 0.53) % 2 === 1;
      if (on) {
        const w = ctx.measureText(txt).width;
        ctx.fillRect(p.x + w + (n ? 3 : 0), p.y - p.size * 0.5, p.size * 0.42, p.size * 0.98);
      }
    }
    ctx.restore();
  }
}

// ---------------------------------------------------------------------------
// scene: observatory
// ---------------------------------------------------------------------------

function drawObservatory(t) {
  const sc = TL.scenes.find(s => s.id === 'observatory');
  const fade = window01(t, sc.start, sc.end, 3.0, 1.6);
  if (fade <= 0) return;
  // draw at full strength and fade the finished picture, so layers never
  // show through each other mid-fade
  const a = 1;
  const p = clamp((t - sc.start) / (sc.end - sc.start));
  const push = lerp(1.0, 1.075, easeInOut(p));
  const lift = lerp(0, -18, easeInOut(p));

  ctx.save();
  ctx.globalAlpha = a;

  // sky gradient
  const g = ctx.createLinearGradient(0, 0, 0, H * 0.8);
  g.addColorStop(0, '#010209');
  g.addColorStop(0.6, '#050b1c');
  g.addColorStop(1, '#0c1a33');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H);

  const cam = (f) => {
    const s = 1 + (push - 1) * f;
    ctx.setTransform(s, 0, 0, s, W / 2 - s * W / 2, H * 0.62 - s * H * 0.62 + lift * f);
  };

  // stars + milky way, slowly turning about a pole above the frame
  cam(0.35);
  const pole = { x: W * 0.36, y: -H * 1.1 };
  const rot = (t - 20) * 0.0021;
  ctx.translate(pole.x, pole.y);
  ctx.rotate(rot);
  ctx.translate(-pole.x, -pole.y);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = a * 0.95;
  ctx.drawImage(SKY, W / 2 - 1400, H / 2 - 1400);
  for (const s of BRIGHT_STARS) {
    const px = W / 2 - 1400 + s.x, py = H / 2 - 1400 + s.y;
    if (px < -100 || px > W + 100 || py < -100 || py > H) continue;
    const tw = 0.62 + 0.38 * Math.sin(t * s.fr + s.ph) * Math.sin(t * s.fr * 0.37 + s.ph * 2);
    const spr = s.tint === 1 ? GLOW.warm : s.tint === 2 ? GLOW.blue : GLOW.white;
    const r = s.r * 5;
    ctx.globalAlpha = a * tw * 0.9;
    ctx.drawImage(spr, px - r, py - r, r * 2, r * 2);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // a meteor
  const mt = (t - 21.2) / 0.7;
  if (mt > 0 && mt < 1) {
    const x0 = W * 0.22, y0 = H * 0.16;
    const len = 260 * Math.sin(mt * Math.PI);
    const hx = x0 + mt * 420, hy = y0 + mt * 170;
    const lg = ctx.createLinearGradient(hx, hy, hx - len * 0.93, hy - len * 0.37);
    lg.addColorStop(0, 'rgba(235,245,255,0.9)');
    lg.addColorStop(1, 'rgba(235,245,255,0)');
    ctx.globalAlpha = a * Math.sin(mt * Math.PI);
    ctx.strokeStyle = lg;
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(hx, hy); ctx.lineTo(hx - len * 0.93, hy - len * 0.37); ctx.stroke();
  }

  // airglow along the horizon
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = a;
  const ag = ctx.createLinearGradient(0, H * 0.5, 0, H * 0.78);
  ag.addColorStop(0, 'rgba(30,110,110,0)');
  ag.addColorStop(1, 'rgba(40,120,125,0.10)');
  ctx.fillStyle = ag;
  ctx.fillRect(0, H * 0.5, W, H * 0.3);
  const town = ctx.createRadialGradient(W * 0.12, H * 0.76, 0, W * 0.12, H * 0.76, W * 0.35);
  town.addColorStop(0, 'rgba(255,140,70,0.10)');
  town.addColorStop(1, 'rgba(255,140,70,0)');
  ctx.fillStyle = town;
  ctx.fillRect(0, H * 0.3, W, H * 0.6);
  ctx.globalCompositeOperation = 'source-over';

  // ridges
  cam(0.7);
  ctx.drawImage(FAR.far, -FAR.pad, 0);
  // low mist between the ridges
  const mist = ctx.createLinearGradient(0, H * 0.66, 0, H * 0.8);
  mist.addColorStop(0, 'rgba(60,80,120,0)');
  mist.addColorStop(0.7, 'rgba(60,80,120,0.10)');
  mist.addColorStop(1, 'rgba(60,80,120,0)');
  ctx.fillStyle = mist;
  ctx.fillRect(-200, H * 0.62, W + 400, H * 0.2);
  cam(1.0);
  ctx.drawImage(FAR.near, -FAR.pad, 0);

  // hut window + aviation light
  const hw = FAR.hut;
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = 'rgba(255,190,110,0.95)';
  ctx.fillRect(hw.x - 34, hw.y - 30, 14, 10);
  ctx.globalAlpha = a * 0.5;
  ctx.drawImage(GLOW.warm, hw.x - 27 - 26, hw.y - 25 - 26, 52, 52);
  const blink = ((t + 0.3) % 1.7) < 0.22 ? 1 : 0;
  if (blink) {
    const f = FAR.feed;
    ctx.globalAlpha = a;
    ctx.drawImage(GLOW.red, f.x - 26, f.y - 26, 52, 52);
    ctx.fillStyle = '#ff4030';
    ctx.fillRect(f.x - 2, f.y - 2, 4, 4);
  }
  const blink2 = ((t + 1.1) % 2.3) < 0.22 ? 1 : 0;
  if (blink2) {
    const m = hw.mast;
    ctx.globalAlpha = a * 0.8;
    ctx.drawImage(GLOW.red, m.x - 18, m.y - 18, 36, 36);
  }
  ctx.globalCompositeOperation = 'source-over';
  ctx.setTransform(1, 0, 0, 1, 0, 0);

  // shade the lower third so narration reads cleanly
  ctx.globalAlpha = a;
  const lowg = ctx.createLinearGradient(0, H * 0.72, 0, H);
  lowg.addColorStop(0, 'rgba(0,0,0,0)');
  lowg.addColorStop(1, 'rgba(0,0,0,0.6)');
  ctx.fillStyle = lowg;
  ctx.fillRect(0, H * 0.72, W, H * 0.28);
  ctx.globalAlpha = 1 - fade;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// scene: the signal on the scope
// ---------------------------------------------------------------------------

const PH = { x: 120, y: 150, w: 1680, h: 400 };      // waterfall panel
const SCOPE = { x: 120, y: 660, w: 1680, h: 200 };   // oscilloscope panel
const PHOSPHOR = '143,247,208';

function pulseIndexAt(tt) {
  const pt = TL.pulses.times;
  let lo = 0, hi = pt.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (pt[m] <= tt) lo = m + 1; else hi = m; }
  return lo - 1;
}
function pulseDur(i) {
  const pt = TL.pulses.times;
  const gap = i + 1 < pt.length ? pt[i + 1] - pt[i] : 0.09;
  return Math.min(0.09, 0.6 * gap);
}

function hud(text, x, y, size, alpha, align = 'left') {
  ctx.font = `bold ${size}px ${FONT}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillStyle = `rgba(${PHOSPHOR},${alpha})`;
  ctx.fillText(text, x, y);
  ctx.textAlign = 'left';
}

function drawSignal(t) {
  const sc = TL.scenes.find(s => s.id === 'signal');
  const fade = window01(t, sc.start, sc.end, 1.0, 1.0);
  if (fade <= 0) return;
  const a = 1;
  const pt = TL.pulses.times, bits = TL.pulses.bits;
  const tEnd = pt[pt.length - 1] + pulseDur(pt.length - 1);
  const tv = Math.min(t, tEnd + 0.25); // the display freezes when the signal stops

  ctx.save();
  ctx.globalAlpha = a;
  ctx.fillStyle = '#010504';
  ctx.fillRect(0, 0, W, H);

  // gentle power-on flicker
  const on = smooth(sc.start, sc.start + 0.6, t);
  const flick = 0.92 + 0.08 * Math.sin(t * 61.0) * Math.sin(t * 17.3);
  ctx.globalAlpha = a * on * flick;

  // panels
  ctx.strokeStyle = `rgba(${PHOSPHOR},0.22)`;
  ctx.lineWidth = 1;
  for (const P of [PH, SCOPE]) {
    ctx.strokeRect(P.x + 0.5, P.y + 0.5, P.w, P.h);
    ctx.save();
    ctx.strokeStyle = `rgba(${PHOSPHOR},0.06)`;
    for (let gx = 1; gx < 12; gx++) {
      const xx = P.x + gx * P.w / 12;
      ctx.beginPath(); ctx.moveTo(xx, P.y); ctx.lineTo(xx, P.y + P.h); ctx.stroke();
    }
    for (let gy = 1; gy < 6; gy++) {
      const yy = P.y + gy * P.h / 6;
      ctx.beginPath(); ctx.moveTo(P.x, yy); ctx.lineTo(P.x + P.w, yy); ctx.stroke();
    }
    ctx.restore();
  }

  // waterfall: frequency up, time scrolling left
  const speed = 250; // px per second
  const fLo = 850, fHi = 1570;
  const fy = f => PH.y + PH.h - (f - fLo) / (fHi - fLo) * PH.h;
  ctx.save();
  ctx.beginPath(); ctx.rect(PH.x, PH.y, PH.w, PH.h); ctx.clip();
  const off = (tv * speed) % 1680;
  ctx.globalAlpha = a * on * 0.55;
  ctx.drawImage(WATERFALL_NOISE, PH.x - off, PH.y);
  ctx.drawImage(WATERFALL_NOISE, PH.x - off + 1680, PH.y);
  ctx.globalAlpha = a * on;
  ctx.globalCompositeOperation = 'lighter';
  const tMin = tv - PH.w / speed;
  let i0 = Math.max(0, pulseIndexAt(tMin) - 1);
  const i1 = pulseIndexAt(tv);
  for (let i = i0; i <= i1; i++) {
    if (i < 0) continue;
    const st = pt[i], d = pulseDur(i);
    const xr = PH.x + PH.w - (tv - st) * speed;
    const len = Math.max(1.2, Math.min(d, tv - st) * speed);
    const y = fy(bits[i] ? TL.pulses.freq_one : TL.pulses.freq_zero);
    ctx.fillStyle = `rgba(${PHOSPHOR},0.95)`;
    ctx.fillRect(xr, y - 3, len, 6);
    ctx.fillStyle = `rgba(${PHOSPHOR},0.12)`;
    ctx.fillRect(xr - 2, y - 14, len + 4, 28);
  }
  ctx.restore();
  // frequency labels
  ctx.globalAlpha = a * on;
  hud('1420 Hz', PH.x + 14, fy(TL.pulses.freq_one) - 26, 18, 0.55);
  hud('1000 Hz', PH.x + 14, fy(TL.pulses.freq_zero) - 26, 18, 0.55);

  // oscilloscope: the last 25 ms of demodulated audio
  const win = 0.025;
  const mid = SCOPE.y + SCOPE.h / 2;
  const rnd = mulberry32(Math.floor(tv * 1000));
  ctx.save();
  ctx.beginPath(); ctx.rect(SCOPE.x, SCOPE.y, SCOPE.w, SCOPE.h); ctx.clip();
  const path = [];
  for (let px = 0; px <= SCOPE.w; px += 2) {
    const tau = tv - win + (px / SCOPE.w) * win;
    const i = pulseIndexAt(tau);
    let v = 0;
    if (i >= 0) {
      const d = pulseDur(i), dt = tau - pt[i];
      if (dt < d) {
        const env = Math.min(1, dt / 0.003, (d - dt) / 0.003);
        const f = bits[i] ? TL.pulses.freq_one : TL.pulses.freq_zero;
        v = env * Math.sin(2 * Math.PI * f * tau);
      }
    }
    v += (rnd() - 0.5) * 0.12;
    path.push([SCOPE.x + px, mid - v * SCOPE.h * 0.38]);
  }
  ctx.globalCompositeOperation = 'lighter';
  for (const [lw, al] of [[7, 0.10], [3, 0.25], [1.4, 0.95]]) {
    ctx.strokeStyle = `rgba(${PHOSPHOR},${al})`;
    ctx.lineWidth = lw;
    ctx.beginPath();
    path.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.stroke();
  }
  ctx.restore();

  // HUD
  const count = clamp(pulseIndexAt(tv) + 1, 0, 1679);
  const utc = 3 * 3600 + 14 * 60 + 7 + (tv - 35.0);
  const hh = String(Math.floor(utc / 3600)).padStart(2, '0');
  const mm = String(Math.floor(utc / 60) % 60).padStart(2, '0');
  const ss = (utc % 60).toFixed(2).padStart(5, '0');
  hud('RX-3  //  L-BAND  1420.405 MHz  //  BW 2.0 kHz', PH.x, 108, 20, 0.7);
  hud(`${hh}:${mm}:${ss} UTC`, PH.x + PH.w, 108, 20, 0.7, 'right');
  hud('CH-2  DEMOD', SCOPE.x, SCOPE.y - 22, 18, 0.55);
  const done = t > tEnd + 0.2;
  const blinkOn = !done || Math.floor((t - tEnd) / 0.45) % 2 === 0;
  hud('PULSES', SCOPE.x + SCOPE.w - 260, SCOPE.y - 22, 18, 0.55);
  if (blinkOn) hud(String(count).padStart(4, '0'), SCOPE.x + SCOPE.w, SCOPE.y - 24, 30, 0.95, 'right');
  const rate = count > 1 && !done ? 5 * Math.exp(0.2459 * (tv - 35.0)) : 0;
  hud(`RATE ${rate.toFixed(0).padStart(3, ' ')}/s`, PH.x + PH.w, PH.y + PH.h + 26, 18, 0.55, 'right');
  const recOn = Math.floor(t / 0.8) % 2 === 0;
  if (!done && recOn) {
    ctx.fillStyle = 'rgba(255,70,60,0.9)';
    ctx.beginPath(); ctx.arc(PH.x + 8, PH.y + PH.h + 26, 6, 0, 7); ctx.fill();
  }
  hud(done ? 'END OF TRANSMISSION' : 'RECORDING', PH.x + 24, PH.y + PH.h + 26, 18, done ? 0.9 : 0.55);

  // CRT texture
  ctx.globalCompositeOperation = 'source-over';
  ctx.globalAlpha = a;
  ctx.drawImage(SCANLINES, 0, 0);
  const lowg = ctx.createLinearGradient(0, H * 0.78, 0, H);
  lowg.addColorStop(0, 'rgba(0,0,0,0)');
  lowg.addColorStop(1, 'rgba(0,0,0,0.75)');
  ctx.fillStyle = lowg;
  ctx.fillRect(0, H * 0.78, W, H * 0.22);
  ctx.globalAlpha = 1 - fade;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// the 23 x 73 picture: decode, recognition, difference
// ---------------------------------------------------------------------------

const COLS = 23, ROWS = 73;

// layout of the grid over time: centered while it fills, then slides left,
// then pushes in on the two figures
function gridLayout(t) {
  const pitch0 = 13;
  const cx0 = W / 2, cy0 = H / 2;
  const mv = TL.grid.move, zm = TL.zoom;
  const m = easeInOut(clamp((t - mv.start) / (mv.end - mv.start)));
  const cx1 = W * 0.26;
  let pitch = pitch0;
  let cx = lerp(cx0, cx1, m), cy = cy0;
  let ox = cx - COLS * pitch / 2, oy = cy - ROWS * pitch / 2;
  // slow drift during recognition
  const drift = smooth(82, 104, t) * 0.03;
  pitch *= 1 + drift;
  ox = cx - COLS * pitch / 2; oy = cy - ROWS * pitch / 2;

  const z = easeInOut(clamp((t - zm.start) / (zm.end - zm.start)));
  if (z > 0) {
    const pitch1 = 13 * 3.15;
    const rc = { c: 11.5, r: 51.5 };               // center of the figures
    const tx = W / 2, ty = H / 2 - 50;
    const ox1 = tx - rc.c * pitch1, oy1 = ty - rc.r * pitch1;
    pitch = lerp(pitch, pitch1, z);
    ox = lerp(ox, ox1, z);
    oy = lerp(oy, oy1, z);
  }
  return { ox, oy, pitch };
}

function drawGrid(t) {
  const fill = TL.grid.fill;
  if (t < fill.start - 0.2 || t > 126.5) return;
  const L = gridLayout(t);
  const sent = TL.grid.sent, ret = TL.grid.returned, rowT = TL.grid.row_times;
  const rowDur = (fill.end - fill.start) / ROWS;
  const fadeOut = 1 - smooth(124.0, 126.0, t);
  const cell = L.pitch * 0.78;
  const scan = TL.scan;
  const scanP = easeInOut(clamp((t - scan.start) / (scan.end - scan.start)));
  const scanRow = t >= scan.start ? scanP * ROWS : -1;
  const voice = envAt('voice_rms', t);
  const zoomP = easeInOut(clamp((t - TL.zoom.start) / (TL.zoom.end - TL.zoom.start)));

  ctx.save();
  ctx.globalAlpha = fadeOut;

  for (let r = 0; r < ROWS; r++) {
    const y = L.oy + r * L.pitch;
    if (y < -L.pitch || y > H + L.pitch) continue;
    for (let c = 0; c < COLS; c++) {
      const bt = rowT[r] + (c / COLS) * rowDur;
      if (t < bt) continue;
      const x = L.ox + c * L.pitch;
      if (x < -L.pitch || x > W + L.pitch) continue;
      const on = ret[r][c], was = sent[r][c];
      const age = t - bt;
      const flash = Math.exp(-age * 7);
      const revealed = r < scanRow;
      const vb = TL.grid.visitor_box;
      const inVisitor = r >= vb.r0 && r <= vb.r1 && c >= vb.c0 && c <= vb.c1;
      const added = on && revealed && (inVisitor || !was);
      const removed = !on && was && revealed;
      // outside the two figures, everything recedes during the push-in
      const focus = r >= 46 && r <= 58 ? 1 : 1 - zoomP;
      if (focus <= 0.002) continue;
      ctx.globalAlpha = fadeOut * focus;

      if (on) {
        if (added) {
          const pulse = 0.75 + 0.25 * Math.sin(t * 3.1 + r * 0.4);
          const speak = t > 116.5 ? voice : 0;
          ctx.fillStyle = `rgba(255,${Math.round(96 + 60 * speak)},${Math.round(60 + 40 * speak)},${clamp(pulse + speak * 0.6)})`;
          ctx.shadowColor = 'rgba(255,90,50,0.9)';
          ctx.shadowBlur = L.pitch * (0.6 + 1.6 * speak);
        } else {
          ctx.fillStyle = `rgba(${Math.round(lerp(226, 255, flash))},${Math.round(lerp(236, 255, flash))},255,${0.9})`;
          ctx.shadowColor = 'rgba(160,210,255,0.7)';
          ctx.shadowBlur = L.pitch * (0.35 + flash * 1.2);
        }
        ctx.fillRect(x, y, cell, cell);
      } else {
        ctx.shadowBlur = 0;
        if (removed) {
          const ghost = 0.35 * (1 - smooth(scan.end, scan.end + 2.5, t));
          ctx.strokeStyle = `rgba(255,90,60,${ghost})`;
          ctx.lineWidth = Math.max(1, L.pitch * 0.06);
          ctx.strokeRect(x + 0.5, y + 0.5, cell - 1, cell - 1);
        } else {
          ctx.fillStyle = `rgba(150,190,255,${0.05 + flash * 0.4})`;
          ctx.fillRect(x + cell * 0.35, y + cell * 0.35, cell * 0.3, cell * 0.3);
        }
      }
    }
  }
  ctx.shadowBlur = 0;
  ctx.globalAlpha = fadeOut;

  // scanline
  if (t >= scan.start - 0.1 && t <= scan.end + 0.4) {
    const sy = L.oy + scanRow * L.pitch;
    const sa = window01(t, scan.start - 0.1, scan.end + 0.4, 0.2, 0.4);
    const x0 = L.ox - 40, x1 = L.ox + COLS * L.pitch + 40;
    const trail = ctx.createLinearGradient(0, sy - 90, 0, sy);
    trail.addColorStop(0, 'rgba(120,230,255,0)');
    trail.addColorStop(1, `rgba(120,230,255,${0.16 * sa})`);
    ctx.fillStyle = trail;
    ctx.fillRect(x0, sy - 90, x1 - x0, 90);
    ctx.globalCompositeOperation = 'lighter';
    ctx.fillStyle = `rgba(200,250,255,${0.95 * sa})`;
    ctx.shadowColor = 'rgba(120,230,255,1)';
    ctx.shadowBlur = 18;
    ctx.fillRect(x0, sy - 1, x1 - x0, 2);
    ctx.shadowBlur = 0;
    ctx.globalCompositeOperation = 'source-over';
  }

  // HUD: row counter and incoming bitstream while filling
  const hudA = window01(t, fill.start, TL.grid.move.start + 0.6, 0.3, 0.8);
  if (hudA > 0) {
    let rowsDone = 0;
    while (rowsDone < ROWS && rowT[rowsDone] <= t) rowsDone++;
    ctx.globalAlpha = hudA * 0.75;
    ctx.font = `bold 20px ${FONT}`;
    ctx.fillStyle = '#9fb4d8';
    ctx.textBaseline = 'middle';
    ctx.fillText(`23 × ${String(rowsDone).padStart(2, '0')}`, L.ox + COLS * L.pitch + 36, L.oy + rowsDone * L.pitch - L.pitch / 2);
    ctx.fillText(`${String(Math.min(1679, rowsDone * 23)).padStart(4, '0')} / 1679`, L.ox - 36 - 150, H / 2);
  }
  ctx.restore();
}

// the alien line: subtitle and waveform
function drawVoice(t) {
  const v = TL.voice;
  const a = window01(t, v.start - 0.6, 122.2, 0.5, 1.2) * (1 - smooth(124, 126, t));
  if (a <= 0) return;
  ctx.save();
  // waveform strip
  const y0 = H * 0.9;
  const wv = ENV && ENV.voice_wave;
  const pts = [];
  const span = 0.12; // seconds visible
  for (let px = 0; px <= W; px += 3) {
    const tau = t - span / 2 + (px / W) * span;
    let s = 0;
    if (wv) {
      const k = (tau - wv.start) * wv.rate;
      const i = Math.floor(k);
      if (i >= 0 && i < wv.samples.length - 1) s = lerp(wv.samples[i], wv.samples[i + 1], k - i);
    }
    const taper = Math.sin(Math.PI * px / W);
    pts.push([px, y0 - s * 70 * taper]);
  }
  ctx.globalAlpha = a;
  ctx.globalCompositeOperation = 'lighter';
  for (const [lw, al] of [[8, 0.08], [3, 0.25], [1.5, 0.9]]) {
    ctx.strokeStyle = `rgba(255,140,80,${al})`;
    ctx.lineWidth = lw;
    ctx.beginPath();
    pts.forEach(([x, y], k) => k ? ctx.lineTo(x, y) : ctx.moveTo(x, y));
    ctx.stroke();
  }
  ctx.globalCompositeOperation = 'source-over';

  // subtitle, word by word as it is spoken
  const words = (TL.voice.words || [
    { w: 'WE', t: v.start + 0.05 }, { w: 'HEARD', t: v.start + 0.55 }, { w: 'YOU.', t: v.start + 1.2 },
  ]);
  let s = '';
  for (const wd of words) if (t >= wd.t) s += (s ? ' ' : '') + wd.w;
  ctx.font = `bold 40px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#ffd2a8';
  ctx.shadowColor = 'rgba(255,120,60,0.7)';
  ctx.shadowBlur = 18;
  // lay the full line out so words don't shift as they appear
  const full = words.map(w => w.w).join(' ');
  const fw = ctx.measureText(full).width;
  ctx.textAlign = 'left';
  ctx.fillText(s, W / 2 - fw / 2, H * 0.805);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// scene: ending — title and credits
// ---------------------------------------------------------------------------

function drawTitle(t) {
  const tc = TL.title_card;
  const a = window01(t, tc.start, tc.hold_until + tc.out, tc.in, tc.out);
  if (a <= 0) return;
  const p = clamp((t - tc.start) / (tc.hold_until + tc.out - tc.start));
  const spread = lerp(1.0, 1.12, p);
  ctx.save();
  ctx.globalAlpha = a;
  ctx.font = `bold 150px ${FONT}`;
  ctx.textBaseline = 'middle';
  ctx.textAlign = 'center';
  const letters = tc.text.split('');
  const step = 150 * spread;
  const total = step * (letters.length - 1);
  ctx.fillStyle = '#f2f1ea';
  ctx.shadowColor = 'rgba(190,215,255,0.55)';
  ctx.shadowBlur = lerp(40, 14, smooth(tc.start, tc.start + tc.in, t));
  letters.forEach((ch, i) => ctx.fillText(ch, W / 2 - total / 2 + i * step, H / 2));
  ctx.restore();
}

function drawCredits(t) {
  const cr = TL.credits;
  const a = window01(t, cr.start, cr.end, 1.0, 1.0);
  if (a <= 0) return;
  ctx.save();
  ctx.font = `bold 26px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  cr.lines.forEach((line, i) => {
    const la = a * smooth(cr.start + i * 0.6, cr.start + i * 0.6 + 1.0, t);
    ctx.globalAlpha = la;
    ctx.fillStyle = i === cr.lines.length - 1 ? '#f2f1ea' : '#a9a8a2';
    ctx.fillText(line, W / 2, H / 2 - 50 + i * 56 + (i === cr.lines.length - 1 ? 20 : 0));
  });
  ctx.restore();
}

// ---------------------------------------------------------------------------
// entry points
// ---------------------------------------------------------------------------

window.init = async function (timeline, audioEnv) {
  TL = timeline;
  ENV = audioEnv;
  await document.fonts.load(`bold 34px ${FONT}`);
  GLOW.white = glowSprite(245, 248, 255);
  GLOW.blue = glowSprite(180, 205, 255);
  GLOW.warm = glowSprite(255, 200, 150);
  GLOW.red = glowSprite(255, 60, 40);
  SKY = buildSky();
  FAR = buildRidges();
  WATERFALL_NOISE = buildWaterfallNoise();
  SCANLINES = buildScanlines();
  VIGNETTE = buildVignette();
  return true;
};

window.renderFrame = function (t) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, W, H);

  drawObservatory(t);
  drawSignal(t);
  drawGrid(t);
  drawVoice(t);
  drawTitle(t);
  drawCredits(t);
  drawText(t);

  ctx.globalAlpha = 1;
  ctx.drawImage(VIGNETTE, 0, 0);
  return true;
};
