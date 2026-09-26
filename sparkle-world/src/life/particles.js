// Particles: game.particles.emit(kind, position, opts) from ONE pooled THREE.Points (<= 800
// particles, one draw call). Kinds: sparkle heart star bubble splash zzz note leaf petal
// confetti rainbow_trail smoke_puff, plus glint snowflake gem firefly magic (extras).
// opts: { count, color, colors, spread, scale, speed, life, dir: [x,y,z] (push), gravity }.
// Sprites are painted on a canvas atlas as glossy stickers: red channel = "tint me", green =
// white highlight, alpha = shape, so any color stays shiny. Each kind has its own little
// motion (hearts sway up, petals flutter down, bubbles pop, Zzz drift one after another...).
// The ambient life (butterflies, fireflies, falling petals, bubbles...) lives in ambient.js.

import * as THREE from 'three';
import { hexToUnit } from '../core/util.js';
import { installAmbient } from './ambient.js';

const MAX = 800;
const CELL = 64;
const RAINBOW = ['#FF8C8C', '#FFB86B', '#FFE066', '#8EE08A', '#7CCBFF', '#B69CFF', '#FF9DE2'];

// cells: 0 sparkle 1 heart 2 star 3 bubble 4 drop 5 Z 6 note 7 leaf 8 petal 9 confetti
//        10 soft dot 11 puff 12 snowflake 13 glow 14 ring 15 gem shard
const KINDS = {
  sparkle: { cell: 0, colors: ['#FFFFFF', '#FFE38A', '#FFB8D6', '#B8E1FF', '#D9C8FF'], count: 10, speed: 2.4, up: 0.5, gravity: -0.6, drag: 2.4, life: 0.8, size: 0.34, spin: 2, twinkle: 1 },
  heart: { cell: 1, colors: ['#FF5FA2', '#FF8CC6', '#FFB8D6', '#FF7AB8'], count: 6, speed: 1.0, up: 1.3, gravity: -0.5, drag: 1.6, life: 1.5, size: 0.44, sway: 0.7, grow: 1, wobble: 0.25 },
  star: { cell: 2, colors: ['#FFD43B', '#FFE38A', '#FFF3B0', '#FFC94D'], count: 8, speed: 2.8, up: 1.2, gravity: 2.2, drag: 2, life: 1.1, size: 0.4, spin: 4 },
  bubble: { cell: 3, colors: ['#9FE0FF', '#C7B8FF', '#FFC2E2', '#B8F5E6'], count: 8, speed: 0.7, up: 0.9, gravity: -0.35, drag: 1.2, life: 1.9, size: 0.36, sway: 0.6, pop: 1 },
  splash: { cell: 4, colors: ['#8FD8FF', '#BFE9FF', '#6CC6FF'], count: 14, speed: 2.4, up: 3.2, gravity: 11, drag: 0.6, life: 0.7, size: 0.22 },
  zzz: { cell: 5, colors: ['#FFFFFF', '#E6DDFF', '#D7C9FF'], count: 3, speed: 0.05, up: 0.5, gravity: 0, drag: 0, life: 2.6, size: 0.46, sway: 0.4, grow: 1, stagger: 0.6, push: [0.3, 0, 0.1], wobble: 0.3 },
  note: { cell: 6, colors: ['#9C7BFF', '#FF5FA2', '#3FD8B0', '#6CC6FF', '#FFB13B'], count: 3, speed: 0.5, up: 0.95, gravity: -0.15, drag: 1, life: 1.7, size: 0.44, sway: 0.55, wobble: 0.4, stagger: 0.14 },
  leaf: { cell: 7, colors: ['#8EDB7E', '#6CC468', '#A8E28C', '#B5D96A'], count: 5, speed: 0.8, up: 0.5, gravity: 2.4, drag: 3.2, life: 2.8, size: 0.28, sway: 1.1, spin: 2.4 },
  petal: { cell: 8, colors: ['#FFB8D6', '#FFD6E8', '#FF9EC8', '#FFE4F0'], count: 5, speed: 0.6, up: 0.2, gravity: 1.5, drag: 3.4, life: 3.8, size: 0.22, sway: 1.2, spin: 2.2 },
  confetti: { cell: 9, colors: ['#FF5FA2', '#FFC94D', '#3FD8B0', '#6CC6FF', '#9C7BFF', '#FF8C8C'], count: 40, speed: 4.6, up: 4.6, gravity: 6, drag: 2.6, life: 2.3, size: 0.22, spin: 9, sway: 0.9 },
  rainbow_trail: { cell: 10, colors: RAINBOW, count: 6, speed: 0.3, up: 0.15, gravity: -0.2, drag: 2, life: 1.1, size: 0.34, cycle: 1 },
  smoke_puff: { cell: 11, colors: ['#FFFFFF', '#F6F0FA', '#FFF4FA'], count: 8, speed: 0.9, up: 0.5, gravity: -0.5, drag: 2.5, life: 1.5, size: 0.55, grow: 2, alpha: 0.85 },
  // extras
  glint: { cell: 0, colors: ['#FFFFFF', '#E8F6FF', '#FFF6D8'], count: 1, speed: 0, up: 0, gravity: 0, drag: 0, life: 0.7, size: 0.26, twinkle: 1, spin: 1 },
  snowflake: { cell: 12, colors: ['#FFFFFF', '#EAF6FF'], count: 6, speed: 0.6, up: 0.2, gravity: 0.6, drag: 2, life: 2.4, size: 0.26, sway: 0.7, spin: 1.5 },
  gem: { cell: 15, colors: ['#FF6FB5', '#A77BFF', '#5CC8FF', '#3FE0B5', '#FFD04D'], count: 12, speed: 3.2, up: 2.2, gravity: 5.5, drag: 1.4, life: 1.0, size: 0.24, spin: 7 },
  firefly: { cell: 13, colors: ['#FFF3A0', '#E4FF9A', '#FFE08A'], count: 1, speed: 0.2, up: 0.1, gravity: 0, drag: 0.5, life: 2, size: 0.3, sway: 0.4, twinkle: 0.5 },
  magic: { cell: 14, colors: ['#FFB8F0', '#C7B8FF', '#B8F0FF'], count: 3, speed: 0.1, up: 0.2, gravity: 0, drag: 1, life: 0.8, size: 0.9, grow: 3 },
};
const KIND_LIST = Object.entries(KINDS).map(([name, k], i) => { k.name = name; k.index = i; return k; });

const vert = /* glsl */ `
attribute vec4 pcolor; // rgb + alpha
attribute vec4 pdata;  // size, atlas cell, rotation, -
uniform float uScale;
varying vec4 vColor;
varying float vCell;
varying float vRot;
void main() {
  vColor = pcolor;
  vCell = pdata.y;
  vRot = pdata.z;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(pdata.x * uScale / max(0.1, -mv.z), 256.0);
  gl_Position = projectionMatrix * mv;
  if (pcolor.a < 0.004) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`;

const frag = /* glsl */ `
uniform sampler2D uAtlas;
varying vec4 vColor;
varying float vCell;
varying float vRot;
void main() {
  vec2 p = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  p = vec2(c * p.x - s * p.y, s * p.x + c * p.y) + 0.5;
  if (p.x < 0.0 || p.y < 0.0 || p.x > 1.0 || p.y > 1.0) discard;
  float cx = mod(vCell, 4.0), cy = floor(vCell / 4.0);
  vec2 uv = (vec2(cx, 3.0 - cy) + vec2(p.x, 1.0 - p.y)) * 0.25;
  vec4 t = texture2D(uAtlas, uv);
  float a = t.a * vColor.a;
  if (a < 0.02) discard;
  // raw sRGB like the block shader: red = tint, green = white highlight
  gl_FragColor = vec4(min(vColor.rgb * t.r + vec3(t.g), vec3(1.0)), a);
}`;

// ---------- sprite atlas ----------

const TINT = 'rgb(255,0,0)', SHADE = 'rgb(196,0,0)', HI = 'rgb(70,225,0)', WHITE = 'rgb(0,255,0)';

function starPath(g, cx, cy, R, r, n = 5, rot = -Math.PI / 2) {
  g.beginPath();
  for (let i = 0; i < n * 2; i++) {
    const a = rot + (i / (n * 2)) * Math.PI * 2;
    const rad = i % 2 === 0 ? R : r;
    g.lineTo(cx + Math.cos(a) * rad, cy + Math.sin(a) * rad);
  }
  g.closePath();
}

function heartPath(g, cx, cy, s) {
  g.beginPath();
  g.moveTo(cx, cy + s * 0.38);
  g.bezierCurveTo(cx - s * 0.62, cy - s * 0.02, cx - s * 0.32, cy - s * 0.5, cx, cy - s * 0.2);
  g.bezierCurveTo(cx + s * 0.32, cy - s * 0.5, cx + s * 0.62, cy - s * 0.02, cx, cy + s * 0.38);
  g.closePath();
}

function blob(g, x, y, rx, ry, color, rot = 0) {
  g.fillStyle = color;
  g.beginPath();
  g.ellipse(x, y, rx, ry, rot, 0, Math.PI * 2);
  g.fill();
}

function radial(g, x, y, r, stops) {
  const gr = g.createRadialGradient(x, y, 0, x, y, r);
  for (const [o, c] of stops) gr.addColorStop(o, c);
  g.fillStyle = gr;
  g.fillRect(x - r, y - r, r * 2, r * 2);
}

const PAINT = [
  // 0 sparkle: glow + long four-point star with a white heart
  (g, x, y) => {
    radial(g, x, y, 26, [[0, 'rgba(255,110,0,0.55)'], [1, 'rgba(255,0,0,0)']]);
    g.fillStyle = TINT;
    starPath(g, x, y, 27, 5, 4, 0);
    g.fill();
    g.fillStyle = 'rgb(110,210,0)';
    starPath(g, x, y, 14, 3.5, 4, 0);
    g.fill();
    blob(g, x, y, 4.5, 4.5, WHITE);
  },
  // 1 glossy heart
  (g, x, y) => {
    g.fillStyle = SHADE;
    heartPath(g, x, y + 2, 56);
    g.fill();
    g.fillStyle = TINT;
    heartPath(g, x, y, 48);
    g.fill();
    blob(g, x - 11, y - 8, 7, 4.5, HI, -0.7);
    blob(g, x - 4, y - 13, 2.5, 2.5, WHITE);
  },
  // 2 chubby star
  (g, x, y) => {
    g.lineJoin = 'round';
    g.fillStyle = SHADE; g.strokeStyle = SHADE; g.lineWidth = 7;
    starPath(g, x, y + 2, 25, 12);
    g.fill(); g.stroke();
    g.fillStyle = TINT; g.strokeStyle = TINT; g.lineWidth = 5;
    starPath(g, x, y, 22, 10.5);
    g.fill(); g.stroke();
    blob(g, x - 6, y - 7, 5, 3, HI, -0.6);
  },
  // 3 bubble: clear with a colored rim and a shine
  (g, x, y) => {
    radial(g, x, y, 27, [[0, 'rgba(255,50,0,0.12)'], [0.75, 'rgba(255,60,0,0.3)'], [0.92, 'rgba(255,100,0,0.95)'], [1, 'rgba(255,0,0,0)']]);
    g.strokeStyle = 'rgba(40,240,0,0.95)';
    g.lineWidth = 4;
    g.lineCap = 'round';
    g.beginPath();
    g.arc(x, y, 17, Math.PI * 1.1, Math.PI * 1.45);
    g.stroke();
    blob(g, x + 11, y + 10, 3, 3, 'rgba(0,255,0,0.8)');
  },
  // 4 droplet
  (g, x, y) => {
    g.fillStyle = TINT;
    g.beginPath();
    g.moveTo(x, y - 22);
    g.bezierCurveTo(x + 5, y - 10, x + 15, y, x + 15, y + 8);
    g.arc(x, y + 8, 15, 0, Math.PI);
    g.bezierCurveTo(x - 15, y, x - 5, y - 10, x, y - 22);
    g.fill();
    blob(g, x - 6, y + 5, 3.5, 6, HI, 0.3);
  },
  // 5 chunky Z
  (g, x, y) => {
    g.lineJoin = 'round'; g.lineCap = 'round';
    const path = () => { g.beginPath(); g.moveTo(x - 14, y - 15); g.lineTo(x + 14, y - 15); g.lineTo(x - 14, y + 15); g.lineTo(x + 14, y + 15); };
    g.strokeStyle = SHADE; g.lineWidth = 15; path(); g.stroke();
    g.strokeStyle = TINT; g.lineWidth = 10; path(); g.stroke();
    g.strokeStyle = 'rgba(60,230,0,0.9)'; g.lineWidth = 3;
    g.beginPath(); g.moveTo(x - 12, y - 17); g.lineTo(x + 4, y - 17); g.stroke();
  },
  // 6 music note
  (g, x, y) => {
    g.fillStyle = TINT;
    blob(g, x - 8, y + 14, 11, 8, TINT, -0.4);
    g.fillRect(x + 1, y - 22, 6, 36);
    g.beginPath();
    g.moveTo(x + 7, y - 22);
    g.quadraticCurveTo(x + 24, y - 14, x + 18, y + 2);
    g.quadraticCurveTo(x + 18, y - 10, x + 7, y - 10);
    g.fill();
    blob(g, x - 11, y + 11, 4, 2.5, HI, -0.4);
  },
  // 7 leaf with a vein
  (g, x, y) => {
    g.fillStyle = TINT;
    g.beginPath();
    g.moveTo(x - 20, y + 20);
    g.quadraticCurveTo(x - 20, y - 16, x + 20, y - 20);
    g.quadraticCurveTo(x + 16, y + 18, x - 20, y + 20);
    g.fill();
    g.strokeStyle = SHADE; g.lineWidth = 3; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x - 17, y + 17); g.quadraticCurveTo(x, y + 2, x + 16, y - 16); g.stroke();
    blob(g, x - 6, y - 6, 5, 2.5, 'rgba(90,200,0,0.7)', -0.8);
  },
  // 8 cherry petal (with the little notch)
  (g, x, y) => {
    g.fillStyle = TINT;
    g.beginPath();
    g.moveTo(x, y + 22);
    g.bezierCurveTo(x - 24, y + 4, x - 18, y - 22, x - 5, y - 18);
    g.lineTo(x, y - 11);
    g.lineTo(x + 5, y - 18);
    g.bezierCurveTo(x + 18, y - 22, x + 24, y + 4, x, y + 22);
    g.fill();
    radial(g, x, y + 14, 12, [[0, 'rgba(120,200,0,0.7)'], [1, 'rgba(255,0,0,0)']]);
  },
  // 9 confetti ribbon
  (g, x, y) => {
    g.fillStyle = TINT;
    g.beginPath();
    g.roundRect ? g.roundRect(x - 9, y - 17, 18, 34, 5) : g.rect(x - 9, y - 17, 18, 34);
    g.fill();
    g.fillStyle = 'rgba(70,225,0,0.85)';
    g.fillRect(x - 5, y - 13, 4, 26);
  },
  // 10 soft dot
  (g, x, y) => radial(g, x, y, 26, [[0, 'rgb(130,200,0)'], [0.35, 'rgb(255,70,0)'], [0.7, 'rgba(255,0,0,0.75)'], [1, 'rgba(255,0,0,0)']]),
  // 11 fluffy puff
  (g, x, y) => {
    for (const [dx, dy, r] of [[-10, 4, 15], [9, 5, 14], [0, -7, 17], [2, 9, 13]]) {
      radial(g, x + dx, y + dy, r + 6, [[0, 'rgba(255,40,0,1)'], [0.7, 'rgba(255,20,0,0.95)'], [1, 'rgba(255,0,0,0)']]);
    }
    blob(g, x - 5, y - 11, 6, 3.5, 'rgba(60,200,0,0.55)', -0.3);
  },
  // 12 snowflake
  (g, x, y) => {
    g.strokeStyle = WHITE; g.lineCap = 'round'; g.lineWidth = 3.5;
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      const ex = x + Math.cos(a) * 22, ey = y + Math.sin(a) * 22;
      g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke();
      for (const s of [-1, 1]) {
        const bx = x + Math.cos(a) * 13, by = y + Math.sin(a) * 13;
        g.beginPath(); g.moveTo(bx, by); g.lineTo(bx + Math.cos(a + s * 0.8) * 7, by + Math.sin(a + s * 0.8) * 7); g.stroke();
      }
    }
    blob(g, x, y, 4, 4, WHITE);
  },
  // 13 glow (fireflies, magic dust)
  (g, x, y) => radial(g, x, y, 28, [[0, 'rgb(90,255,0)'], [0.18, 'rgba(255,170,0,1)'], [0.45, 'rgba(255,60,0,0.45)'], [1, 'rgba(255,0,0,0)']]),
  // 14 magic ring
  (g, x, y) => {
    radial(g, x, y, 28, [[0.55, 'rgba(255,0,0,0)'], [0.72, 'rgba(255,120,0,0.9)'], [0.8, 'rgba(255,60,0,0.5)'], [1, 'rgba(255,0,0,0)']]);
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + 0.4;
      g.fillStyle = 'rgb(60,230,0)';
      starPath(g, x + Math.cos(a) * 20, y + Math.sin(a) * 20, 5, 1.5, 4, 0);
      g.fill();
    }
  },
  // 15 gem shard
  (g, x, y) => {
    g.fillStyle = TINT;
    g.beginPath(); g.moveTo(x - 14, y - 8); g.lineTo(x - 7, y - 17); g.lineTo(x + 7, y - 17); g.lineTo(x + 14, y - 8); g.lineTo(x, y + 20); g.closePath(); g.fill();
    g.fillStyle = SHADE;
    g.beginPath(); g.moveTo(x + 14, y - 8); g.lineTo(x, y + 20); g.lineTo(x + 3, y - 8); g.closePath(); g.fill();
    g.fillStyle = HI;
    g.beginPath(); g.moveTo(x - 7, y - 17); g.lineTo(x + 7, y - 17); g.lineTo(x + 3, y - 8); g.lineTo(x - 9, y - 8); g.closePath(); g.fill();
  },
];

function atlasTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = CELL * 4;
  const g = c.getContext('2d');
  PAINT.forEach((paint, i) => {
    g.save();
    const ox = (i % 4) * CELL, oy = Math.floor(i / 4) * CELL;
    g.beginPath();
    g.rect(ox + 1, oy + 1, CELL - 2, CELL - 2);
    g.clip();
    paint(g, ox + CELL / 2, oy + CELL / 2);
    g.restore();
  });
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.NoColorSpace; // channels are data (tint / highlight), not colors
  return t;
}

// ---------- the pool ----------

export class Particles {
  constructor(game) {
    this.game = game;
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.color = new Float32Array(MAX * 4);
    this.data = new Float32Array(MAX * 4);
    this.age = new Float32Array(MAX);
    this.life = new Float32Array(MAX).fill(0);
    this.base = new Float32Array(MAX);
    this.phase = new Float32Array(MAX);
    this.spin = new Float32Array(MAX);
    this.kind = new Uint8Array(MAX);
    this.grav = new Float32Array(MAX);
    this.next = 0;
    this._wasAny = false;
    this._cycle = 0;
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage);
    this.aData = new THREE.BufferAttribute(this.data, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('pcolor', this.aColor);
    geo.setAttribute('pdata', this.aData);
    this.uniforms = { uAtlas: { value: atlasTexture() }, uScale: { value: 600 } };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    this.points.name = 'particles';
    this.points.userData.envWarm = true;
    game.scene.add(this.points);
    this._rgbCache = new Map();
    this.kinds = Object.keys(KINDS);
  }

  _rgb(hex) {
    let v = this._rgbCache.get(hex);
    if (!v) {
      v = hexToUnit(hex, [0, 0, 0]);
      this._rgbCache.set(hex, v);
    }
    return v;
  }

  /** Burst of `kind` particles at a position (Vector3 or [x,y,z]). */
  emit(kind, position, opts = {}) {
    const k = KINDS[kind] || KINDS.sparkle;
    if (!position) return;
    const px = position.x ?? position[0], py = position.y ?? position[1], pz = position.z ?? position[2];
    const low = this.game.profile.settings.quality === 'low';
    const count = Math.max(1, Math.round((opts.count || k.count) * (low ? 0.5 : 1)));
    const spread = opts.spread ?? 0.35;
    const scale = opts.scale ?? 1;
    const speed = (opts.speed ?? 1) * k.speed;
    const lifeMul = opts.life ?? 1;
    const push = opts.dir || k.push;
    const palette = opts.colors || k.colors;
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      const i3 = i * 3, i4 = i * 4;
      this.pos[i3] = px + (Math.random() - 0.5) * spread;
      this.pos[i3 + 1] = py + (Math.random() - 0.5) * spread;
      this.pos[i3 + 2] = pz + (Math.random() - 0.5) * spread;
      this.vel[i3] = Math.cos(a) * speed * r + (push ? push[0] : 0);
      this.vel[i3 + 1] = (k.up || 0) + (Math.random() * 0.8 + 0.2) * speed * 0.6 + (push ? push[1] : 0);
      this.vel[i3 + 2] = Math.sin(a) * speed * r + (push ? push[2] : 0);
      let hex;
      if (opts.color) hex = opts.color;
      else if (k.cycle) hex = palette[(this._cycle++) % palette.length];
      else hex = palette[Math.floor(Math.random() * palette.length)];
      const rgb = this._rgb(hex);
      this.color[i4] = rgb[0];
      this.color[i4 + 1] = rgb[1];
      this.color[i4 + 2] = rgb[2];
      this.color[i4 + 3] = 0;
      this.base[i] = k.size * scale * (0.75 + Math.random() * 0.5);
      this.data[i4] = 0;
      this.data[i4 + 1] = k.cell;
      this.data[i4 + 2] = k.spin ? Math.random() * Math.PI * 2 : 0;
      this.spin[i] = k.spin ? (Math.random() - 0.5) * 2 * k.spin : 0;
      this.phase[i] = Math.random() * Math.PI * 2;
      this.life[i] = k.life * lifeMul * (0.75 + Math.random() * 0.45);
      this.age[i] = k.stagger ? -n * k.stagger : 0;
      this.kind[i] = k.index;
      this.grav[i] = opts.gravity ?? k.gravity;
    }
  }

  update(dt) {
    // pixels per world unit at distance 1 (matches the perspective projection)
    const cam = this.game.camera;
    this.uniforms.uScale.value = this.game.renderer.domElement.height / (2 * Math.tan((cam.fov * Math.PI) / 360));
    let any = false;
    const P = this.pos, V = this.vel, C = this.color, D = this.data;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      const age = (this.age[i] += dt);
      const i3 = i * 3, i4 = i * 4;
      if (age < 0) { C[i4 + 3] = 0; continue; }
      const life = this.life[i];
      if (age >= life) {
        this.life[i] = 0;
        C[i4 + 3] = 0;
        D[i4] = 0;
        continue;
      }
      const k = KIND_LIST[this.kind[i]];
      const t = age / life; // 0 -> 1
      V[i3 + 1] -= this.grav[i] * dt;
      if (k.drag) {
        const drag = Math.max(0, 1 - k.drag * dt);
        V[i3] *= drag;
        V[i3 + 2] *= drag;
        if (this.grav[i] > 0 && k.drag > 2) V[i3 + 1] *= Math.max(0, 1 - (k.drag - 2) * dt); // flutter: slow fall
      }
      let x = V[i3] * dt, z = V[i3 + 2] * dt;
      if (k.sway) {
        const ph = this.phase[i];
        x += Math.cos(age * 2.6 + ph) * k.sway * dt;
        z += Math.sin(age * 2.1 + ph) * k.sway * 0.6 * dt;
      }
      P[i3] += x;
      P[i3 + 1] += V[i3 + 1] * dt;
      P[i3 + 2] += z;
      // size & alpha curves
      let size = this.base[i];
      let alpha = (k.alpha || 1) * Math.min(1, age * 12, (1 - t) * 3.5);
      if (k.grow) size *= Math.min(1, age * 8) * (0.55 + 0.45 * t * (1 + (k.grow - 1) * 0.35));
      else if (k.pop) {
        size *= Math.min(1, age * 6) * (0.8 + 0.3 * t);
        if (t > 0.9) { size *= 1 + (t - 0.9) * 5; alpha *= (1 - t) * 10; }
      } else size *= 0.55 + 0.45 * Math.sin(Math.min(1, t * 1.15) * Math.PI) + (t < 0.2 ? 0.25 : 0);
      if (k.twinkle) size *= 0.55 + 0.45 * Math.abs(Math.sin(age * 9 * k.twinkle + this.phase[i]));
      C[i4 + 3] = alpha;
      D[i4] = size;
      if (k.spin) D[i4 + 2] += this.spin[i] * dt;
      else if (k.wobble) D[i4 + 2] = Math.sin(age * 3.2 + this.phase[i]) * k.wobble;
    }
    if (any || this._wasAny) {
      this.aPos.needsUpdate = true;
      this.aColor.needsUpdate = true;
      this.aData.needsUpdate = true;
    }
    this._wasAny = any;
  }

  /** Number of live particles (debug). */
  alive() {
    let n = 0;
    for (let i = 0; i < MAX; i++) if (this.life[i] > 0) n++;
    return n;
  }

  clear() {
    this.life.fill(0);
    this.color.fill(0);
    this.data.fill(0);
    this.aColor.needsUpdate = true;
    this.aData.needsUpdate = true;
  }
}

export function install(game) {
  const particles = new Particles(game);
  game.particles = particles;
  game.addSystem({
    name: 'particles',
    update: (dt) => particles.update(dt),
    onWorldUnload: () => particles.clear(),
  });
  installAmbient(game);
}
