// Pet effects: the unicorn's rainbow ribbon trail and the floating "Z" of sleeping pets.
// Both are preallocated (no per-frame allocations) and live in the pets group.

import * as THREE from 'three';
import { FONT } from './kit.js';

const RAINBOW = ['#FF6F91', '#FFA25C', '#FFE066', '#7EE08A', '#6CC6FF', '#A98BFF'];

let rainbowTex = null;
function rainbowTexture() {
  if (rainbowTex) return rainbowTex;
  const c = document.createElement('canvas');
  c.width = 4;
  c.height = 64;
  const g = c.getContext('2d');
  const band = 64 / RAINBOW.length;
  RAINBOW.forEach((col, i) => {
    g.fillStyle = col;
    g.fillRect(0, Math.round(i * band), 4, Math.ceil(band));
  });
  // soft white edges so the ribbon reads as a glowing band
  const grad = g.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.55)');
  grad.addColorStop(0.12, 'rgba(255,255,255,0)');
  grad.addColorStop(0.88, 'rgba(255,255,255,0)');
  grad.addColorStop(1, 'rgba(255,255,255,0.55)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 4, 64);
  rainbowTex = new THREE.CanvasTexture(c);
  rainbowTex.colorSpace = THREE.SRGBColorSpace;
  rainbowTex.userData.shared = true;
  return rainbowTex;
}

const N = 56; // trail points

/**
 * A vertical rainbow ribbon that follows a point. push(x, y, z) adds a point when it moved
 * far enough; update(dt) ages the points (they fade out and shrink).
 */
export class RainbowTrail {
  constructor(parent) {
    this.px = new Float32Array(N);
    this.py = new Float32Array(N);
    this.pz = new Float32Array(N);
    this.age = new Float32Array(N).fill(99);
    this.head = 0;
    this.count = 0;
    this.life = 1.7;
    this.width = 0.62;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 2 * 3);
    this.col = new Float32Array(N * 2 * 4);
    const uv = new Float32Array(N * 2 * 2);
    for (let i = 0; i < N; i++) {
      uv[i * 4] = i / (N - 1); uv[i * 4 + 1] = 1;
      uv[i * 4 + 2] = i / (N - 1); uv[i * 4 + 3] = 0;
    }
    const idx = [];
    for (let i = 0; i < N - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, b, c, b, d, c);
    }
    this.aPos = new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage);
    this.aCol = new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('color', this.aCol);
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(idx);
    this.geo = geo;
    this.mat = new THREE.MeshBasicMaterial({
      map: rainbowTexture(), vertexColors: true, transparent: true, depthWrite: false,
      side: THREE.DoubleSide, fog: false,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.lx = 0; this.ly = 0; this.lz = 0;
  }

  push(x, y, z) {
    if (this.count > 0) {
      const dx = x - this.lx, dy = y - this.ly, dz = z - this.lz;
      if (dx * dx + dy * dy + dz * dz < 0.06) return;
    }
    this.head = (this.head + 1) % N;
    this.px[this.head] = x; this.py[this.head] = y; this.pz[this.head] = z;
    this.age[this.head] = 0;
    this.count = Math.min(N, this.count + 1);
    this.lx = x; this.ly = y; this.lz = z;
  }

  update(dt) {
    let alive = 0;
    for (let i = 0; i < N; i++) {
      this.age[i] += dt;
      if (this.age[i] < this.life) alive++;
    }
    if (!alive) {
      this.mesh.visible = false;
      this.count = 0;
      return;
    }
    this.mesh.visible = true;
    // newest -> oldest along the strip
    let lastX = this.px[this.head], lastY = this.py[this.head], lastZ = this.pz[this.head];
    for (let k = 0; k < N; k++) {
      const i = (this.head - k + N) % N;
      let x = this.px[i], y = this.py[i], z = this.pz[i];
      let a = 1 - this.age[i] / this.life;
      if (k >= this.count || a <= 0) {
        a = 0;
        x = lastX; y = lastY; z = lastZ;
      }
      lastX = x; lastY = y; lastZ = z;
      const w = this.width * (0.35 + 0.65 * Math.max(0, a)) * 0.5;
      const o = k * 6;
      this.pos[o] = x; this.pos[o + 1] = y + w; this.pos[o + 2] = z;
      this.pos[o + 3] = x; this.pos[o + 4] = y - w; this.pos[o + 5] = z;
      const alpha = Math.max(0, a) * 0.9 * (k === 0 ? 0 : 1);
      const c = k * 8;
      this.col[c] = this.col[c + 1] = this.col[c + 2] = 1; this.col[c + 3] = alpha;
      this.col[c + 4] = this.col[c + 5] = this.col[c + 6] = 1; this.col[c + 7] = alpha;
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ---------- floating Z's ----------

let zTex = null;
function zTexture() {
  if (zTex) return zTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  g.font = `700 50px ${FONT}`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.lineWidth = 9;
  g.strokeStyle = '#FFFFFF';
  g.strokeText('Z', 32, 34);
  g.fillStyle = '#9C7BFF';
  g.fillText('Z', 32, 34);
  zTex = new THREE.CanvasTexture(c);
  zTex.colorSpace = THREE.SRGBColorSpace;
  return zTex;
}

export class ZzzPool {
  constructor(parent, size = 14) {
    this.items = [];
    for (let i = 0; i < size; i++) {
      const m = new THREE.SpriteMaterial({ map: zTexture(), transparent: true, depthWrite: false, fog: false });
      const s = new THREE.Sprite(m);
      s.visible = false;
      s.renderOrder = 6;
      parent.add(s);
      this.items.push({ s, life: 0, x: 0, y: 0, z: 0, drift: 0 });
    }
    this.next = 0;
  }

  spawn(x, y, z) {
    const it = this.items[this.next];
    this.next = (this.next + 1) % this.items.length;
    it.life = 2.2;
    it.x = x; it.y = y; it.z = z;
    it.drift = (Math.random() - 0.5) * 0.6;
    it.s.visible = true;
  }

  update(dt) {
    for (const it of this.items) {
      if (it.life <= 0) continue;
      it.life -= dt;
      if (it.life <= 0) {
        it.s.visible = false;
        continue;
      }
      const u = 1 - it.life / 2.2;
      it.s.position.set(it.x + Math.sin(u * 5) * 0.12 + it.drift * u, it.y + u * 0.9, it.z);
      const sc = 0.14 + u * 0.2;
      it.s.scale.set(sc, sc, 1);
      it.s.material.opacity = Math.min(1, it.life * 1.5) * Math.min(1, u * 6);
      it.s.material.rotation = Math.sin(u * 4) * 0.3;
    }
  }

  clear() {
    for (const it of this.items) {
      it.life = 0;
      it.s.visible = false;
    }
  }
}
