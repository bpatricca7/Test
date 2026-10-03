// Vehicle effects: a boat's foam wake (one flat ribbon, preallocated ring buffer like the
// unicorn's RainbowTrail) and headlight beams (two soft additive cones and a glow on the
// ground in front). No per-frame allocations; the pooled point light the driven vehicle
// borrows (entities.extraLights) is wired in index.js.

import * as THREE from 'three';

const N = 56; // wake points

let foamTex = null;
function foamTexture() {
  if (foamTex) return foamTex;
  const c = document.createElement('canvas');
  c.width = 64;
  c.height = 8;
  const g = c.getContext('2d');
  // across the ribbon: bright foamy edges, see-through middle
  const grad = g.createLinearGradient(0, 0, 64, 0);
  grad.addColorStop(0, 'rgba(255,255,255,0)');
  grad.addColorStop(0.12, 'rgba(255,255,255,0.95)');
  grad.addColorStop(0.3, 'rgba(235,250,255,0.35)');
  grad.addColorStop(0.5, 'rgba(235,250,255,0.18)');
  grad.addColorStop(0.7, 'rgba(235,250,255,0.35)');
  grad.addColorStop(0.88, 'rgba(255,255,255,0.95)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 8);
  foamTex = new THREE.CanvasTexture(c);
  foamTex.colorSpace = THREE.SRGBColorSpace;
  foamTex.userData.shared = true;
  return foamTex;
}

/**
 * A horizontal foam strip that widens as it ages (a V behind the boat). push(x, y, z, sx, sz)
 * adds a point (sx, sz: the boat's sideways unit vector) when it moved far enough.
 */
export class WakeRibbon {
  constructor(parent) {
    this.px = new Float32Array(N);
    this.py = new Float32Array(N);
    this.pz = new Float32Array(N);
    this.sx = new Float32Array(N);
    this.sz = new Float32Array(N);
    this.age = new Float32Array(N).fill(99);
    this.head = 0;
    this.count = 0;
    this.life = 1.6;
    this.width = 1.1;
    const geo = new THREE.BufferGeometry();
    this.pos = new Float32Array(N * 2 * 3);
    this.col = new Float32Array(N * 2 * 4);
    const uv = new Float32Array(N * 2 * 2);
    for (let i = 0; i < N; i++) {
      uv[i * 4] = 0; uv[i * 4 + 1] = i / (N - 1);
      uv[i * 4 + 2] = 1; uv[i * 4 + 3] = i / (N - 1);
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
      map: foamTexture(), vertexColors: true, transparent: true, depthWrite: false, side: THREE.DoubleSide,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    this.mesh = new THREE.Mesh(geo, this.mat);
    this.mesh.name = 'vehicle-wake';
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    this.mesh.visible = false;
    parent.add(this.mesh);
    this.lx = 0; this.lz = 0;
  }

  push(x, y, z, sx, sz) {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(sx) || !Number.isFinite(sz)) return;
    if (this.count > 0) {
      const dx = x - this.lx, dz = z - this.lz;
      if (dx * dx + dz * dz < 0.09) return;
    }
    this.head = (this.head + 1) % N;
    this.px[this.head] = x; this.py[this.head] = y; this.pz[this.head] = z;
    this.sx[this.head] = sx; this.sz[this.head] = sz;
    this.age[this.head] = 0;
    this.count = Math.min(N, this.count + 1);
    this.lx = x; this.lz = z;
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
    let lx = this.px[this.head], ly = this.py[this.head], lz = this.pz[this.head];
    let lsx = this.sx[this.head], lsz = this.sz[this.head];
    for (let k = 0; k < N; k++) {
      const i = (this.head - k + N) % N;
      let x = this.px[i], y = this.py[i], z = this.pz[i], sx = this.sx[i], sz = this.sz[i];
      const u = this.age[i] / this.life;
      let a = 1 - u;
      if (k >= this.count || a <= 0) {
        a = 0;
        x = lx; y = ly; z = lz; sx = lsx; sz = lsz;
      }
      lx = x; ly = y; lz = z; lsx = sx; lsz = sz;
      const w = this.width * (0.5 + 1.6 * Math.min(1, u)) * 0.5;
      const o = k * 6;
      this.pos[o] = x - sx * w; this.pos[o + 1] = y; this.pos[o + 2] = z - sz * w;
      this.pos[o + 3] = x + sx * w; this.pos[o + 4] = y; this.pos[o + 5] = z + sz * w;
      const alpha = Math.max(0, a) * 0.85 * (k === 0 ? 0 : 1);
      const c = k * 8;
      this.col[c] = this.col[c + 1] = this.col[c + 2] = 1; this.col[c + 3] = alpha;
      this.col[c + 4] = this.col[c + 5] = this.col[c + 6] = 1; this.col[c + 7] = alpha;
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
  }

  clear() {
    this.age.fill(99);
    this.count = 0;
    this.mesh.visible = false;
  }

  dispose() {
    if (this.mesh.parent) this.mesh.parent.remove(this.mesh);
    this.geo.dispose();
    this.mat.dispose();
  }
}

// ---------- headlights ----------

const BEAM_LEN = 4.2;
let beamGeo = null, glowTex = null;

/** An open cone, apex at the origin, opening toward +Z, alpha fading along its length. */
function beamGeometry() {
  if (beamGeo) return beamGeo;
  const g = new THREE.ConeGeometry(0.85, BEAM_LEN, 18, 4, true);
  g.rotateX(-Math.PI / 2); // apex toward -Z
  g.translate(0, 0, BEAM_LEN / 2); // apex at the origin
  const pos = g.attributes.position;
  const col = new Float32Array(pos.count * 4);
  for (let i = 0; i < pos.count; i++) {
    const t = Math.min(1, Math.max(0, pos.getZ(i) / BEAM_LEN));
    col[i * 4] = 1; col[i * 4 + 1] = 0.93; col[i * 4 + 2] = 0.72;
    col[i * 4 + 3] = (1 - t) * (1 - t);
  }
  g.setAttribute('color', new THREE.BufferAttribute(col, 4));
  g.userData.shared = true;
  beamGeo = g;
  return g;
}

function glowTexture() {
  if (glowTex) return glowTex;
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 2, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,240,190,0.9)');
  grad.addColorStop(0.5, 'rgba(255,230,170,0.35)');
  grad.addColorStop(1, 'rgba(255,230,170,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  glowTex = new THREE.CanvasTexture(c);
  glowTex.colorSpace = THREE.SRGBColorSpace;
  glowTex.userData.shared = true;
  return glowTex;
}

/**
 * Two beams from the lamps and a soft pool of light on the ground in front, in the vehicle's
 * model space (add .group to the model). set(on, strength) shows them; strength follows the dark.
 */
export class Headlights {
  constructor(lamps, size) {
    this.group = new THREE.Group();
    this.group.name = 'headlights';
    this.mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.2, blending: THREE.AdditiveBlending,
      depthWrite: false, side: THREE.DoubleSide,
    });
    this.glowMat = new THREE.MeshBasicMaterial({
      map: glowTexture(), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
    });
    const list = Array.isArray(lamps) && lamps.length ? lamps : [[size[0] / 2, 0.6, size[2]]];
    for (const l of list) {
      const m = new THREE.Mesh(beamGeometry(), this.mat);
      m.position.set(l[0], l[1], l[2]);
      m.rotation.x = 0.12; // aim a little down at the road
      m.renderOrder = 4;
      this.group.add(m);
    }
    this.glowGeo = new THREE.PlaneGeometry(size[0] + 1.2, 3.2);
    this.glowGeo.rotateX(-Math.PI / 2);
    const glow = new THREE.Mesh(this.glowGeo, this.glowMat);
    glow.position.set(size[0] / 2, 0.04, size[2] + 1.7);
    glow.renderOrder = 3;
    this.group.add(glow);
    this.group.visible = false;
    this.on = false;
  }

  /** on: lamps lit; dark: 0 by day .. 1 at night (how strong the beams look). */
  set(on, dark = 1) {
    this.on = !!on;
    const k = Number.isFinite(dark) ? Math.max(0, Math.min(1, dark)) : 1;
    this.group.visible = this.on && k > 0.02;
    this.mat.opacity = 0.05 + 0.2 * k;
    this.glowMat.opacity = 0.15 + 0.5 * k;
  }

  dispose() {
    if (this.group.parent) this.group.parent.remove(this.group);
    this.mat.dispose();
    this.glowMat.dispose();
    this.glowGeo.dispose();
  }
}
