// Particles: game.particles.emit(kind, position, opts) from one pooled THREE.Points (<= 800).
// Kinds: sparkle heart star bubble splash zzz note leaf petal confetti rainbow_trail
// smoke_puff. This core version draws them all from a small sprite atlas; the Environment
// team adds ambient spawners (butterflies, fireflies, petals) and richer effects.

import * as THREE from 'three';
import { hexToUnit } from '../core/util.js';

const MAX = 800;
// atlas cells (2x2): 0 sparkle, 1 heart, 2 soft dot, 3 star
const KINDS = {
  sparkle: { cell: 0, colors: ['#FFFFFF', '#FFE38A', '#FFB8D6', '#B8E1FF', '#D9C8FF'], count: 10, speed: 2.2, life: 0.7, size: 0.28, gravity: -1.5 },
  heart: { cell: 1, colors: ['#FF5FA2', '#FF8CC6', '#FFB8D6'], count: 6, speed: 1.2, life: 1.2, size: 0.4, gravity: -2.5, up: 1.6 },
  star: { cell: 3, colors: ['#FFD43B', '#FFE38A', '#FFFFFF'], count: 8, speed: 2.5, life: 0.9, size: 0.35, gravity: -1 },
  bubble: { cell: 2, colors: ['#CFF1FF', '#FFFFFF', '#B8E1FF'], count: 8, speed: 0.6, life: 1.6, size: 0.25, gravity: -1.2, up: 0.8 },
  splash: { cell: 2, colors: ['#9FDFFF', '#FFFFFF', '#6CC6FF'], count: 14, speed: 3, life: 0.6, size: 0.2, gravity: 9, up: 3 },
  zzz: { cell: 2, colors: ['#FFFFFF', '#E6DDFF'], count: 3, speed: 0.3, life: 2, size: 0.3, gravity: -0.6, up: 0.4 },
  note: { cell: 3, colors: ['#9C7BFF', '#FF5FA2', '#3FD8B0'], count: 3, speed: 0.6, life: 1.4, size: 0.35, gravity: -1, up: 0.8 },
  leaf: { cell: 2, colors: ['#8EDB7E', '#6CC468'], count: 5, speed: 0.8, life: 2, size: 0.2, gravity: 1 },
  petal: { cell: 1, colors: ['#FFB8D6', '#FFD6E8'], count: 5, speed: 0.6, life: 2.5, size: 0.18, gravity: 0.6 },
  confetti: { cell: 3, colors: ['#FF5FA2', '#FFC94D', '#3FD8B0', '#6CC6FF', '#9C7BFF'], count: 40, speed: 4.5, life: 1.8, size: 0.2, gravity: 5, up: 4 },
  rainbow_trail: { cell: 2, colors: ['#FF6B6B', '#FFA94D', '#FFD43B', '#A9E34B', '#6CC6FF', '#9C7BFF'], count: 6, speed: 0.3, life: 1, size: 0.3, gravity: 0 },
  smoke_puff: { cell: 2, colors: ['#FFFFFF', '#F0EAF5'], count: 8, speed: 1, life: 1.2, size: 0.5, gravity: -0.8 },
};

const vert = /* glsl */ `
attribute vec4 pcolor; // rgb + alpha
attribute vec2 psize;  // size, atlas cell
uniform float uScale;
varying vec4 vColor;
varying float vCell;
void main() {
  vColor = pcolor;
  vCell = psize.y;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = psize.x * uScale / max(0.1, -mv.z);
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
uniform sampler2D uAtlas;
varying vec4 vColor;
varying float vCell;
void main() {
  // cells are laid out on the canvas top-left first; the texture is flipped (row 0 = top)
  vec2 cell = vec2(mod(vCell, 2.0), 1.0 - floor(vCell / 2.0));
  vec2 uv = (cell + vec2(gl_PointCoord.x, 1.0 - gl_PointCoord.y)) * 0.5;
  vec4 t = texture2D(uAtlas, uv);
  if (t.a * vColor.a < 0.02) discard;
  gl_FragColor = vec4(vColor.rgb * t.rgb, t.a * vColor.a);
}`;

function atlasTexture() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S * 2;
  c.height = S * 2;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  // 0: four-point sparkle
  g.save();
  g.translate(S / 2, S / 2);
  g.beginPath();
  for (let i = 0; i < 8; i++) {
    const r = i % 2 === 0 ? S * 0.48 : S * 0.1;
    const a = (i / 8) * Math.PI * 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.fill();
  g.restore();
  // 1: heart
  g.save();
  g.translate(S + S / 2, S / 2 + 4);
  g.beginPath();
  g.moveTo(0, S * 0.32);
  g.bezierCurveTo(-S * 0.55, -S * 0.02, -S * 0.25, -S * 0.42, 0, -S * 0.16);
  g.bezierCurveTo(S * 0.25, -S * 0.42, S * 0.55, -S * 0.02, 0, S * 0.32);
  g.fill();
  g.restore();
  // 2: soft dot
  const grad = g.createRadialGradient(S / 2, S + S / 2, 0, S / 2, S + S / 2, S / 2);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.85)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, S, S, S);
  // 3: five-point star
  g.fillStyle = '#fff';
  g.save();
  g.translate(S + S / 2, S + S / 2 + 2);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? S * 0.46 : S * 0.2;
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.fill();
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class Particles {
  constructor(game) {
    this.game = game;
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.color = new Float32Array(MAX * 4);
    this.size = new Float32Array(MAX * 2);
    this.life = new Float32Array(MAX);
    this.maxLife = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.baseSize = new Float32Array(MAX);
    this.next = 0;
    this.alive = 0;
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aColor = new THREE.BufferAttribute(this.color, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('pcolor', this.aColor);
    geo.setAttribute('psize', this.aSize);
    this.uniforms = { uAtlas: { value: atlasTexture() }, uScale: { value: 600 } };
    this.points = new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag,
      transparent: true, depthWrite: false,
    }));
    this.points.frustumCulled = false;
    this.points.renderOrder = 10;
    game.scene.add(this.points);
    this._rgb = [0, 0, 0];
  }

  /** Burst of `kind` particles at a Vector3. opts: { count, color, spread, scale } */
  emit(kind, position, opts = {}) {
    const k = KINDS[kind] || KINDS.sparkle;
    const low = this.game.profile.settings.quality === 'low';
    const count = Math.max(1, Math.round((opts.count || k.count) * (low ? 0.5 : 1)));
    const spread = opts.spread ?? 0.35;
    const scale = opts.scale ?? 1;
    for (let n = 0; n < count; n++) {
      const i = this.next;
      this.next = (this.next + 1) % MAX;
      const a = Math.random() * Math.PI * 2;
      const r = Math.random();
      this.pos[i * 3] = position.x + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = position.y + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 2] = position.z + (Math.random() - 0.5) * spread;
      this.vel[i * 3] = Math.cos(a) * k.speed * r;
      this.vel[i * 3 + 1] = (k.up || 0) + (Math.random() * 0.8 + 0.2) * k.speed * 0.6;
      this.vel[i * 3 + 2] = Math.sin(a) * k.speed * r;
      // raw sRGB: this shader writes its color without conversion, like the block shader
      const rgb = hexToUnit(opts.color || k.colors[Math.floor(Math.random() * k.colors.length)], this._rgb);
      this.color[i * 4] = rgb[0];
      this.color[i * 4 + 1] = rgb[1];
      this.color[i * 4 + 2] = rgb[2];
      this.color[i * 4 + 3] = 1;
      this.baseSize[i] = k.size * scale * (0.7 + Math.random() * 0.6);
      this.size[i * 2] = this.baseSize[i];
      this.size[i * 2 + 1] = k.cell;
      this.life[i] = k.life * (0.7 + Math.random() * 0.5);
      this.maxLife[i] = this.life[i];
      this.grav[i] = k.gravity;
    }
  }

  update(dt) {
    // pixels per world unit at distance 1 (matches the perspective projection)
    const cam = this.game.camera;
    this.uniforms.uScale.value = this.game.renderer.domElement.height / (2 * Math.tan((cam.fov * Math.PI) / 360));
    let any = false;
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      any = true;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.color[i * 4 + 3] = 0;
        this.size[i * 2] = 0;
        continue;
      }
      const t = this.life[i] / this.maxLife[i];
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      const drag = 1 - Math.min(1, 1.8 * dt);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.color[i * 4 + 3] = Math.min(1, t * 2.5);
      this.size[i * 2] = this.baseSize[i] * (0.6 + 0.4 * Math.sin(t * Math.PI));
    }
    if (any || this._wasAny) {
      this.aPos.needsUpdate = true;
      this.aColor.needsUpdate = true;
      this.aSize.needsUpdate = true;
    }
    this._wasAny = any;
  }

  clear() {
    this.life.fill(0);
    this.color.fill(0);
    this.size.fill(0);
    this.aColor.needsUpdate = true;
    this.aSize.needsUpdate = true;
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
}
