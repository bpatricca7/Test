// Tiny particle bursts for the Dress-Up preview (the world's particle system lives in the
// game scene; the Studio renders its own little scene). Pooled, no per-frame allocations.

import * as THREE from 'three';
import { hexToUnit } from '../../core/util.js';

const MAX = 160;
const KINDS = {
  sparkle: { cell: 0, colors: ['#FFFFFF', '#FFE38A', '#FFB8D6', '#B8E1FF', '#D9C8FF'], speed: 1.4, life: 0.8, size: 0.16, grav: -0.8 },
  heart: { cell: 1, colors: ['#FF5FA2', '#FF8CC6', '#FFB8D6'], speed: 0.6, life: 1.3, size: 0.22, grav: -1.4, up: 0.9 },
  star: { cell: 2, colors: ['#FFD43B', '#FFE38A', '#FFFFFF'], speed: 1.6, life: 0.9, size: 0.2, grav: -0.6 },
  note: { cell: 3, colors: ['#9C7BFF', '#FF5FA2', '#3FD8B0'], speed: 0.4, life: 1.4, size: 0.2, grav: -0.8, up: 0.5 },
  zzz: { cell: 3, colors: ['#FFFFFF', '#E6DDFF'], speed: 0.2, life: 1.8, size: 0.2, grav: -0.4, up: 0.3 },
};

function atlas() {
  const S = 64;
  const c = document.createElement('canvas');
  c.width = S * 4;
  c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = '#fff';
  // sparkle
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
  // heart
  g.save();
  g.translate(S * 1.5, S / 2 + 4);
  g.beginPath();
  g.moveTo(0, S * 0.32);
  g.bezierCurveTo(-S * 0.55, -S * 0.02, -S * 0.25, -S * 0.42, 0, -S * 0.16);
  g.bezierCurveTo(S * 0.25, -S * 0.42, S * 0.55, -S * 0.02, 0, S * 0.32);
  g.fill();
  g.restore();
  // star
  g.save();
  g.translate(S * 2.5, S / 2 + 2);
  g.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? S * 0.46 : S * 0.2;
    const a = -Math.PI / 2 + (i / 10) * Math.PI * 2;
    g.lineTo(Math.cos(a) * r, Math.sin(a) * r);
  }
  g.fill();
  g.restore();
  // music note
  g.save();
  g.translate(S * 3.5, S / 2);
  g.beginPath();
  g.ellipse(-8, 14, 12, 9, -0.4, 0, Math.PI * 2);
  g.fill();
  g.fillRect(1, -22, 6, 36);
  g.beginPath();
  g.moveTo(1, -22);
  g.quadraticCurveTo(18, -16, 16, 2);
  g.quadraticCurveTo(14, -10, 7, -12);
  g.fill();
  g.restore();
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const vert = /* glsl */ `
attribute vec4 pcolor;
attribute vec2 psize;
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
  vec2 uv = vec2((vCell + gl_PointCoord.x) * 0.25, 1.0 - gl_PointCoord.y);
  vec4 t = texture2D(uAtlas, uv);
  if (t.a * vColor.a < 0.02) discard;
  gl_FragColor = vec4(vColor.rgb * t.rgb, t.a * vColor.a);
}`;

export class Sparkles {
  constructor(scene) {
    this.pos = new Float32Array(MAX * 3);
    this.vel = new Float32Array(MAX * 3);
    this.col = new Float32Array(MAX * 4);
    this.size = new Float32Array(MAX * 2);
    this.life = new Float32Array(MAX);
    this.max = new Float32Array(MAX);
    this.grav = new Float32Array(MAX);
    this.base = new Float32Array(MAX);
    this.next = 0;
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    this.aSize = new THREE.BufferAttribute(this.size, 2).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('pcolor', this.aCol);
    geo.setAttribute('psize', this.aSize);
    this.tex = atlas();
    this.uniforms = { uAtlas: { value: this.tex }, uScale: { value: 400 } };
    this.material = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false });
    this.points = new THREE.Points(geo, this.material);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    this.geo = geo;
    this._rgb = [0, 0, 0];
    scene.add(this.points);
  }

  emit(kind, p, o = {}) {
    const k = KINDS[kind] || KINDS.sparkle;
    const n = Math.min(40, o.count || 6);
    const spread = o.spread ?? 0.3;
    for (let q = 0; q < n; q++) {
      const i = this.next;
      this.next = (i + 1) % MAX;
      const a = Math.random() * Math.PI * 2, r = Math.random();
      this.pos[i * 3] = p.x + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 1] = p.y + (Math.random() - 0.5) * spread;
      this.pos[i * 3 + 2] = p.z + (Math.random() - 0.5) * spread;
      this.vel[i * 3] = Math.cos(a) * k.speed * r;
      this.vel[i * 3 + 1] = (k.up || 0) + (0.3 + Math.random() * 0.7) * k.speed * 0.6;
      this.vel[i * 3 + 2] = Math.sin(a) * k.speed * r;
      // raw sRGB: this shader writes its color without conversion (like the world particles)
      const rgb = hexToUnit(o.color || k.colors[Math.floor(Math.random() * k.colors.length)], this._rgb);
      this.col[i * 4] = rgb[0];
      this.col[i * 4 + 1] = rgb[1];
      this.col[i * 4 + 2] = rgb[2];
      this.col[i * 4 + 3] = 1;
      this.base[i] = k.size * (o.scale || 1) * (0.7 + Math.random() * 0.6);
      this.size[i * 2] = this.base[i];
      this.size[i * 2 + 1] = k.cell;
      this.life[i] = this.max[i] = k.life * (0.7 + Math.random() * 0.5);
      this.grav[i] = k.grav;
    }
  }

  update(dt, pixelHeight, fov) {
    this.uniforms.uScale.value = pixelHeight / (2 * Math.tan((fov * Math.PI) / 360));
    for (let i = 0; i < MAX; i++) {
      if (this.life[i] <= 0) continue;
      this.life[i] -= dt;
      if (this.life[i] <= 0) {
        this.col[i * 4 + 3] = 0;
        this.size[i * 2] = 0;
        continue;
      }
      const t = this.life[i] / this.max[i];
      this.vel[i * 3 + 1] -= this.grav[i] * dt;
      const drag = 1 - Math.min(1, 1.6 * dt);
      this.vel[i * 3] *= drag;
      this.vel[i * 3 + 2] *= drag;
      this.pos[i * 3] += this.vel[i * 3] * dt;
      this.pos[i * 3 + 1] += this.vel[i * 3 + 1] * dt;
      this.pos[i * 3 + 2] += this.vel[i * 3 + 2] * dt;
      this.col[i * 4 + 3] = Math.min(1, t * 2.5);
      this.size[i * 2] = this.base[i] * (0.6 + 0.4 * Math.sin(t * Math.PI));
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
  }

  clear() {
    this.life.fill(0);
    this.col.fill(0);
    this.size.fill(0);
  }

  dispose() {
    if (this.points.parent) this.points.parent.remove(this.points);
    this.geo.dispose();
    this.material.dispose();
    this.tex.dispose();
  }
}
