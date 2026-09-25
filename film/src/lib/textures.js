// Procedural textures painted on 2D canvases. No image files are used anywhere in the film.
import * as THREE from 'three';
import { rng } from './anim.js';

function canvas(w, h = w) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')];
}

function toTexture(c, { repeat = 1, srgb = true, aniso = 8 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = aniso;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

function speckle(ctx, w, h, r, count, alpha, light = false) {
  for (let i = 0; i < count; i++) {
    const v = light ? 200 + r() * 55 : r() * 60;
    ctx.fillStyle = `rgba(${v},${v * 0.9},${v * 0.8},${alpha * r()})`;
    const s = 0.5 + r() * 2.5;
    ctx.fillRect(r() * w, r() * h, s, s);
  }
}

// Compressed-junk cube: a jumble of squashed cans, plastic and scrap.
export function junkCubeTexture(seed = 1) {
  const S = 512;
  const [c, ctx] = canvas(S);
  const r = rng(seed);
  ctx.fillStyle = '#7a6250';
  ctx.fillRect(0, 0, S, S);
  const palette = ['#8a5a44', '#9c7550', '#6f7a72', '#b8a07a', '#5d6a70', '#a09a8c', '#7a5a48', '#a0664a', '#cbbd9c', '#6e6a58', '#56504a', '#a8906a'];
  for (let i = 0; i < 170; i++) {
    ctx.save();
    ctx.translate(r() * S, r() * S);
    ctx.rotate((r() - 0.5) * 0.9);
    const w = 30 + r() * 140, h = 12 + r() * 55;
    ctx.fillStyle = palette[Math.floor(r() * palette.length)];
    ctx.globalAlpha = 0.55 + r() * 0.3;
    ctx.beginPath();
    ctx.moveTo(-w / 2, -h / 2);
    ctx.lineTo(w / 2 + (r() - 0.5) * 12, -h / 2 + (r() - 0.5) * 8);
    ctx.lineTo(w / 2, h / 2);
    ctx.lineTo(-w / 2 + (r() - 0.5) * 12, h / 2 + (r() - 0.5) * 8);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 0.35;
    ctx.strokeStyle = '#1c130e';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    if (r() < 0.18) {
      // faded printed stripes on squashed cans
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = ['#e8dcc0', '#b8503a', '#4f7f9a', '#d8b050'][Math.floor(r() * 4)];
      ctx.fillRect(-w / 2, -h / 6, w, h / 3);
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
  // creases and dark gaps
  ctx.strokeStyle = 'rgba(20,12,8,0.55)';
  for (let i = 0; i < 90; i++) {
    ctx.lineWidth = 0.5 + r() * 2.5;
    ctx.beginPath();
    let x = r() * S, y = r() * S;
    ctx.moveTo(x, y);
    for (let k = 0; k < 4; k++) {
      x += (r() - 0.5) * 60;
      y += (r() - 0.5) * 60;
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  // rust bloom + dust
  for (let i = 0; i < 40; i++) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(120,55,25,0.45)');
    g.addColorStop(1, 'rgba(120,55,25,0)');
    ctx.save();
    ctx.translate(r() * S, r() * S);
    ctx.scale(20 + r() * 60, 20 + r() * 60);
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
    ctx.restore();
  }
  speckle(ctx, S, S, r, 9000, 0.35);
  speckle(ctx, S, S, r, 3000, 0.25, true);
  // compressed edges: darker border
  const edge = ctx.createLinearGradient(0, 0, S, 0);
  ctx.strokeStyle = 'rgba(25,15,10,0.6)';
  ctx.lineWidth = 10;
  ctx.strokeRect(0, 0, S, S);
  ctx.fillStyle = edge;
  return toTexture(c);
}

// Grayscale sand/dirt detail, tiled across the ground (also used as bump).
export function groundDetailTexture(seed = 7) {
  const S = 512;
  const [c, ctx] = canvas(S);
  const r = rng(seed);
  ctx.fillStyle = '#b8b8b8';
  ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 70; i++) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    const v = 150 + r() * 90;
    g.addColorStop(0, `rgba(${v},${v},${v},0.35)`);
    g.addColorStop(1, `rgba(${v},${v},${v},0)`);
    ctx.save();
    const x = r() * S, y = r() * S, s = 30 + r() * 90;
    for (const [ox, oy] of [[0, 0], [S, 0], [-S, 0], [0, S], [0, -S]]) {
      ctx.setTransform(s, 0, 0, s * (0.5 + r() * 0.5), x + ox, y + oy);
      ctx.fillStyle = g;
      ctx.fillRect(-1, -1, 2, 2);
    }
    ctx.restore();
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  for (let i = 0; i < 26000; i++) {
    const v = 90 + r() * 165;
    ctx.fillStyle = `rgba(${v},${v},${v},${0.25 + r() * 0.35})`;
    const s = r() < 0.97 ? 1 + r() * 1.5 : 2 + r() * 3;
    ctx.fillRect(r() * S, r() * S, s, s);
  }
  // small pebbles
  for (let i = 0; i < 260; i++) {
    const x = r() * S, y = r() * S, rad = 1.5 + r() * 3.5;
    ctx.fillStyle = `rgba(60,60,60,0.35)`;
    ctx.beginPath();
    ctx.ellipse(x + 1, y + 1.2, rad, rad * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
    const v = 170 + r() * 70;
    ctx.fillStyle = `rgb(${v},${v},${v})`;
    ctx.beginPath();
    ctx.ellipse(x, y, rad, rad * 0.8, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  return toTexture(c, { srgb: false });
}

// Painted metal with scratches, chipped edges and a dusty bottom. Used for Bolt.
export function paintedMetalTexture(base = '#2f9aa3', seed = 3, { dirt = 0.5, stripe = null } = {}) {
  const S = 512;
  const [c, ctx] = canvas(S);
  const r = rng(seed);
  ctx.fillStyle = base;
  ctx.fillRect(0, 0, S, S);
  // subtle paint mottling
  for (let i = 0; i < 60; i++) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    const light = r() < 0.5;
    g.addColorStop(0, light ? 'rgba(255,255,240,0.08)' : 'rgba(0,0,0,0.08)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.setTransform(40 + r() * 80, 0, 0, 40 + r() * 80, r() * S, r() * S);
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  if (stripe) {
    ctx.fillStyle = stripe;
    ctx.fillRect(0, S * 0.7, S, S * 0.08);
  }
  // scratches
  for (let i = 0; i < 120; i++) {
    ctx.strokeStyle = r() < 0.6 ? 'rgba(230,225,210,0.35)' : 'rgba(40,30,25,0.3)';
    ctx.lineWidth = 0.6 + r();
    ctx.beginPath();
    const x = r() * S, y = r() * S, a = r() * Math.PI, l = 4 + r() * 26;
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(a) * l, y + Math.sin(a) * l);
    ctx.stroke();
  }
  // paint chips showing primer/rust
  for (let i = 0; i < 45; i++) {
    const x = r() * S, y = r() * S, s = 2 + r() * 7;
    ctx.fillStyle = r() < 0.5 ? '#8a4a2a' : '#b7b3a6';
    ctx.beginPath();
    ctx.ellipse(x, y, s, s * (0.4 + r() * 0.6), r() * 3, 0, Math.PI * 2);
    ctx.fill();
  }
  // edge wear along borders (faces are unwrapped individually)
  ctx.strokeStyle = 'rgba(210,200,180,0.35)';
  ctx.lineWidth = 6;
  ctx.strokeRect(3, 3, S - 6, S - 6);
  // dust gathering towards the bottom (v = 0 is bottom in three.js)
  const g = ctx.createLinearGradient(0, S * (1 - dirt), 0, S);
  g.addColorStop(0, 'rgba(150,110,70,0)');
  g.addColorStop(1, 'rgba(150,110,70,0.55)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, S, S);
  speckle(ctx, S, S, r, 5000, 0.18);
  return toTexture(c);
}

export function treadTexture() {
  const [c, ctx] = canvas(64, 256);
  ctx.fillStyle = '#2a2624';
  ctx.fillRect(0, 0, 64, 256);
  for (let y = 0; y < 256; y += 32) {
    ctx.fillStyle = '#4a433d';
    ctx.fillRect(0, y, 64, 14);
    ctx.fillStyle = '#5f5750';
    ctx.fillRect(0, y, 64, 3);
    ctx.fillStyle = '#16120f';
    ctx.fillRect(0, y + 14, 64, 3);
  }
  const t = toTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}

export function glowSprite(size = 128, soft = 2.0) {
  const [c, ctx] = canvas(size);
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (let i = 0; i <= 10; i++) {
    const k = i / 10;
    g.addColorStop(k, `rgba(255,255,255,${Math.pow(1 - k, soft)})`);
  }
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  return toTexture(c, { srgb: false });
}

// Puffy dust-cloud sprite (soft lumpy disc).
export function puffSprite(size = 128) {
  const [c, ctx] = canvas(size);
  const r = rng(11);
  for (let i = 0; i < 14; i++) {
    const x = size / 2 + (r() - 0.5) * size * 0.35;
    const y = size / 2 + (r() - 0.5) * size * 0.35;
    const rad = size * (0.18 + r() * 0.16);
    const g = ctx.createRadialGradient(x, y, 0, x, y, rad);
    g.addColorStop(0, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
  }
  return toTexture(c, { srgb: false });
}

// Four-pointed twinkle (for sparkles and the cartoon stars around a bonked head).
export function sparkleSprite(size = 128) {
  const [c, ctx] = canvas(size);
  const m = size / 2;
  const g = ctx.createRadialGradient(m, m, 0, m, m, m * 0.35);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  for (const rot of [0, Math.PI / 2]) {
    ctx.save();
    ctx.translate(m, m);
    ctx.rotate(rot);
    ctx.beginPath();
    ctx.moveTo(-m * 0.95, 0);
    ctx.quadraticCurveTo(0, m * 0.06, m * 0.95, 0);
    ctx.quadraticCurveTo(0, -m * 0.06, -m * 0.95, 0);
    ctx.fill();
    ctx.restore();
  }
  return toTexture(c, { srgb: false });
}

export function starShapeSprite(size = 128) {
  const [c, ctx] = canvas(size);
  const m = size / 2;
  ctx.translate(m, m);
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const a = (i / 10) * Math.PI * 2 - Math.PI / 2;
    const rad = i % 2 === 0 ? m * 0.9 : m * 0.4;
    ctx.lineTo(Math.cos(a) * rad, Math.sin(a) * rad);
  }
  ctx.closePath();
  ctx.lineJoin = 'round';
  ctx.lineWidth = m * 0.12;
  ctx.strokeStyle = 'rgba(255,255,255,1)';
  ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,1)';
  ctx.fill();
  return toTexture(c, { srgb: false });
}

export function heartSprite(size = 128) {
  const [c, ctx] = canvas(size);
  const m = size / 2;
  ctx.translate(m, m * 1.05);
  ctx.scale(m / 16, m / 16);
  ctx.beginPath();
  ctx.moveTo(0, 10);
  ctx.bezierCurveTo(-14, 0, -14, -12, -6, -12);
  ctx.bezierCurveTo(-2, -12, 0, -9, 0, -7);
  ctx.bezierCurveTo(0, -9, 2, -12, 6, -12);
  ctx.bezierCurveTo(14, -12, 14, 0, 0, 10);
  ctx.fillStyle = 'white';
  ctx.fill();
  return toTexture(c, { srgb: false });
}

// Faded tin-can label.
export function canLabelTexture() {
  const [c, ctx] = canvas(512, 256);
  ctx.fillStyle = '#b8583d';
  ctx.fillRect(0, 0, 512, 256);
  ctx.fillStyle = '#e8d8b0';
  ctx.fillRect(0, 70, 512, 110);
  ctx.fillStyle = '#6e8a4e';
  ctx.font = 'bold 70px Fredoka, sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText('BEANS', 256, 150);
  ctx.fillText('BEANS', 0, 150);
  ctx.fillText('BEANS', 512, 150);
  const r = rng(5);
  for (let i = 0; i < 70; i++) {
    const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
    g.addColorStop(0, 'rgba(110,60,30,0.6)');
    g.addColorStop(1, 'rgba(110,60,30,0)');
    ctx.setTransform(10 + r() * 40, 0, 0, 10 + r() * 30, r() * 512, r() * 256);
    ctx.fillStyle = g;
    ctx.fillRect(-1, -1, 2, 2);
  }
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  speckle(ctx, 512, 256, r, 3000, 0.3);
  return toTexture(c);
}

export function barkTexture() {
  const [c, ctx] = canvas(256);
  const r = rng(21);
  ctx.fillStyle = '#6b4a33';
  ctx.fillRect(0, 0, 256, 256);
  for (let i = 0; i < 70; i++) {
    ctx.strokeStyle = r() < 0.5 ? 'rgba(40,25,15,0.6)' : 'rgba(140,105,75,0.4)';
    ctx.lineWidth = 1 + r() * 3;
    const x = r() * 256;
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.bezierCurveTo(x + (r() - 0.5) * 20, 90, x + (r() - 0.5) * 20, 170, x + (r() - 0.5) * 10, 256);
    ctx.stroke();
  }
  return toTexture(c);
}

export function letterSprite(ch = 'Z', size = 128) {
  const [c, ctx] = canvas(size);
  ctx.font = `700 ${size * 0.8}px Fredoka, sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.lineWidth = size * 0.08;
  ctx.strokeStyle = 'rgba(40,60,120,0.8)';
  ctx.strokeText(ch, size / 2, size / 2 + size * 0.05);
  ctx.fillStyle = 'white';
  ctx.fillText(ch, size / 2, size / 2 + size * 0.05);
  return toTexture(c, { srgb: false });
}
