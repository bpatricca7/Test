// Point-sprite particle clouds. Every effect is a pure function of time.
import * as THREE from 'three';
import { glowSprite, puffSprite, sparkleSprite, starShapeSprite, heartSprite } from '../lib/textures.js';
import { hash1, clamp, ease, smoothstep } from '../lib/anim.js';

const vert = /* glsl */ `
attribute float aSize; attribute vec4 aColor; attribute float aRot;
uniform float uScale;
varying vec4 vColor; varying float vRot;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = min(aSize * uScale / max(-mv.z, 0.05), 900.0);
  gl_Position = projectionMatrix * mv;
  vColor = aColor; vRot = aRot;
}`;
const frag = /* glsl */ `
uniform sampler2D map; uniform float uAdditive;
varying vec4 vColor; varying float vRot;
void main() {
  vec2 pc = gl_PointCoord - 0.5;
  float c = cos(vRot), s = sin(vRot);
  pc = vec2(c * pc.x - s * pc.y, s * pc.x + c * pc.y) + 0.5;
  float a = texture2D(map, pc).a * vColor.a;
  if (a < 0.002) discard;
  gl_FragColor = uAdditive > 0.5 ? vec4(vColor.rgb * a, 1.0) : vec4(vColor.rgb, a);
}`;

export class SpriteCloud {
  constructor(scene, max, map, additive = true) {
    this.max = max;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.rot = new Float32Array(max);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aRot', new THREE.BufferAttribute(this.rot, 1).setUsage(THREE.DynamicDrawUsage));
    this.uniforms = { map: { value: map }, uScale: { value: 500 }, uAdditive: { value: additive ? 1 : 0 } };
    this.mat = new THREE.ShaderMaterial({
      uniforms: this.uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false,
      blending: additive ? THREE.CustomBlending : THREE.NormalBlending,
      blendSrc: THREE.OneFactor, blendDst: THREE.OneFactor, blendEquation: THREE.AddEquation,
    });
    this.points = new THREE.Points(g, this.mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 5 : 4;
    scene.add(this.points);
    this.n = 0;
  }
  begin() { this.n = 0; }
  add(x, y, z, size, r, g, b, a, rot = 0) {
    if (this.n >= this.max || a <= 0.001) return;
    const i = this.n++;
    this.pos[i * 3] = x; this.pos[i * 3 + 1] = y; this.pos[i * 3 + 2] = z;
    this.col[i * 4] = r; this.col[i * 4 + 1] = g; this.col[i * 4 + 2] = b; this.col[i * 4 + 3] = a;
    this.size[i] = size; this.rot[i] = rot;
  }
  end(camera, height) {
    const g = this.points.geometry;
    g.setDrawRange(0, this.n);
    for (const k of ['position', 'aColor', 'aSize', 'aRot']) g.attributes[k].needsUpdate = true;
    this.uniforms.uScale.value = (height * camera.projectionMatrix.elements[5]) / 2;
  }
}

const H = (i, k) => hash1(i * 17.13 + k * 3.71);
const wrap = (v, R) => ((((v + R) % (2 * R)) + 2 * R) % (2 * R)) - R;

export class Effects {
  constructor(scene) {
    this.glow = new SpriteCloud(scene, 9000, glowSprite(64, 1.6), true);
    this.sparkle = new SpriteCloud(scene, 2000, sparkleSprite(), true);
    this.dust = new SpriteCloud(scene, 3000, puffSprite(), false);
    this.stars = new SpriteCloud(scene, 200, starShapeSprite(), false);
    this.hearts = new SpriteCloud(scene, 100, heartSprite(), false);
    this.all = [this.glow, this.sparkle, this.dust, this.stars, this.hearts];
  }
  begin() { for (const c of this.all) c.begin(); }
  end(camera, height) { for (const c of this.all) c.end(camera, height); }

  // Floating motes of dust catching the light around `center`.
  motes(t, center, { count = 500, radius = 10, height = 4, color = [1, 0.85, 0.6], alpha = 0.5, size = 0.035, drift = [0.25, 0.0, 0.1] } = {}) {
    for (let i = 0; i < count; i++) {
      const sx = H(i, 1) * 2 - 1, sz = H(i, 2) * 2 - 1;
      const x = center[0] + wrap(sx * radius + drift[0] * t + Math.sin(t * 0.3 + i) * 0.3, radius);
      const z = center[2] + wrap(sz * radius + drift[2] * t + Math.cos(t * 0.27 + i) * 0.3, radius);
      const y = center[1] + H(i, 3) * height + Math.sin(t * 0.5 + i * 1.7) * 0.15;
      const tw = 0.5 + 0.5 * Math.sin(t * (1 + H(i, 4) * 2) + i);
      this.glow.add(x, y, z, size * (0.5 + H(i, 5)), color[0], color[1], color[2], alpha * (0.4 + 0.6 * tw));
    }
  }

  // Burst of dust at `pos` starting at t0.
  puff(t, t0, pos, { count = 40, size = 0.6, spread = 1.4, up = 0.6, life = 2.2, color = [0.85, 0.66, 0.46], alpha = 0.55, seed = 0, ring = false } = {}) {
    const age = t - t0;
    if (age < 0 || age > life) return;
    for (let i = 0; i < count; i++) {
      const s = seed * 131 + i;
      const a = H(s, 1) * Math.PI * 2;
      const sp = spread * (0.4 + H(s, 2) * 0.8) * (ring ? 1 : H(s, 6) + 0.3);
      const k = ease.outCubic(clamp(age / (life * (0.6 + H(s, 3) * 0.4))));
      const x = pos[0] + Math.cos(a) * sp * k;
      const z = pos[2] + Math.sin(a) * sp * k;
      const y = pos[1] + 0.05 + up * k * (0.3 + H(s, 4)) ;
      const fade = (1 - smoothstep(life * 0.3, life, age)) * smoothstep(0, 0.08, age);
      const sz = size * (0.5 + H(s, 5) * 0.8) * (0.5 + k * 1.2);
      const shade = 0.85 + H(s, 7) * 0.3;
      this.dust.add(x, y, z, sz, color[0] * shade, color[1] * shade, color[2] * shade, alpha * fade, H(s, 8) * 6);
    }
  }

  // Twinkling sparkles in a sphere around `center`.
  sparkles(t, center, { count = 30, radius = 0.4, color = [0.7, 1, 0.6], size = 0.08, alpha = 1, rise = 0.15, seed = 0 } = {}) {
    for (let i = 0; i < count; i++) {
      const s = seed * 71 + i;
      const period = 1.2 + H(s, 1) * 1.5;
      const ph = ((t + H(s, 2) * period) % period) / period;
      const a = H(s, 3) * Math.PI * 2, b = H(s, 4) * 2 - 1;
      const rr = radius * Math.cbrt(H(s, 5));
      const x = center[0] + Math.cos(a) * Math.sqrt(1 - b * b) * rr;
      const z = center[2] + Math.sin(a) * Math.sqrt(1 - b * b) * rr;
      const y = center[1] + b * rr * 0.6 + ph * rise;
      const tw = Math.sin(ph * Math.PI);
      this.sparkle.add(x, y, z, size * (0.5 + H(s, 6)) * tw, color[0], color[1], color[2], alpha * tw, t * 0.5 + H(s, 7));
    }
  }

  // Glowing trail following a path function p(time) -> [x,y,z].
  trail(t, pathFn, { n = 50, dt = 0.02, color = [0.4, 0.9, 1.0], size = 0.12, alpha = 0.8 } = {}) {
    for (let i = 0; i < n; i++) {
      const tt = t - i * dt;
      const p = pathFn(tt);
      if (!p) continue;
      const k = 1 - i / n;
      const j = [H(i, 1) - 0.5, H(i, 2) - 0.5, H(i, 3) - 0.5];
      this.glow.add(p[0] + j[0] * 0.08 * (1 - k), p[1] + j[1] * 0.08 * (1 - k), p[2] + j[2] * 0.08 * (1 - k), size * (0.3 + 0.7 * k), color[0], color[1], color[2], alpha * k * k);
      if (i % 5 === 0) this.sparkle.add(p[0] + j[0] * 0.3, p[1] + j[1] * 0.3, p[2] + j[2] * 0.3, size * 0.9 * k, 1, 1, 1, alpha * k, tt);
    }
  }

  fireflies(t, center, { count = 60, radius = 8, height = 2.5, alpha = 1, seed = 3 } = {}) {
    for (let i = 0; i < count; i++) {
      const s = seed * 97 + i;
      const a = H(s, 1) * Math.PI * 2 + t * 0.05 * (H(s, 2) - 0.5);
      const rr = radius * Math.sqrt(H(s, 3));
      const x = center[0] + Math.cos(a) * rr + Math.sin(t * 0.4 + s) * 0.6;
      const z = center[2] + Math.sin(a) * rr + Math.cos(t * 0.33 + s * 1.3) * 0.6;
      const y = center[1] + 0.3 + H(s, 4) * height + Math.sin(t * 0.7 + s * 2.1) * 0.3;
      const blink = Math.pow(0.5 + 0.5 * Math.sin(t * (1.2 + H(s, 5) * 1.5) + s * 5), 3);
      this.glow.add(x, y, z, 0.14, 0.95, 1.0, 0.45, alpha * (0.15 + 0.85 * blink));
      this.glow.add(x, y, z, 0.03, 1.4, 1.4, 1.0, alpha * blink);
    }
  }

  // Cartoon stars circling a bonked head.
  dizzyStars(t, center, amount) {
    if (amount <= 0) return;
    for (let i = 0; i < 5; i++) {
      const a = t * 4 + (i / 5) * Math.PI * 2;
      const x = center[0] + Math.cos(a) * 0.32, z = center[2] + Math.sin(a) * 0.32;
      const y = center[1] + Math.sin(a * 2) * 0.03;
      this.stars.add(x, y, z, 0.12 * amount, 1.0, 0.85, 0.2, amount, t * 3 + i);
      this.glow.add(x, y, z, 0.2 * amount, 1.0, 0.8, 0.3, 0.4 * amount);
    }
  }

  hearts3(t, t0, center, { count = 5, life = 2.2, size = 0.12 } = {}) {
    const age = t - t0;
    if (age < 0 || age > life) return;
    for (let i = 0; i < count; i++) {
      const k = clamp((age - i * 0.18) / (life - 0.8));
      if (k <= 0 || k >= 1) continue;
      const x = center[0] + Math.sin(k * 6 + i * 2) * 0.12 + (i - count / 2) * 0.07;
      const y = center[1] + k * 0.7;
      const z = center[2];
      const a = Math.sin(k * Math.PI);
      this.hearts.add(x, y, z, size * (0.6 + 0.6 * a), 1.0, 0.35, 0.55, a, Math.sin(k * 8 + i) * 0.3);
    }
  }

  // Water droplets from a spout position/direction.
  water(t, t0, t1, spout, dir, { rate = 60 } = {}) {
    if (t < t0) return;
    const n = Math.floor((Math.min(t, t1) - t0) * rate);
    for (let i = Math.max(0, n - 40); i < n; i++) {
      const born = t0 + i / rate;
      const age = t - born;
      if (age > 0.6 || age < 0) continue;
      const jx = (H(i, 1) - 0.5) * 0.25, jz = (H(i, 2) - 0.5) * 0.25;
      const x = spout[0] + (dir[0] + jx) * age * 1.1;
      const z = spout[2] + (dir[2] + jz) * age * 1.1;
      const y = spout[1] + dir[1] * age - 4.9 * age * age;
      if (y < spout[3]) continue;
      this.glow.add(x, y, z, 0.035, 0.6, 0.85, 1.0, 0.9);
    }
  }

  // Dirt kicked up while digging.
  dirt(t, t0, t1, pos, { rate = 25 } = {}) {
    if (t < t0) return;
    const n = Math.floor((Math.min(t, t1) - t0) * rate);
    for (let i = Math.max(0, n - 40); i < n; i++) {
      const born = t0 + i / rate;
      const age = t - born;
      if (age > 0.7 || age < 0) continue;
      const a = H(i, 1) * Math.PI * 2;
      const v = 0.6 + H(i, 2) * 0.6;
      const x = pos[0] + Math.cos(a) * v * age * 0.8;
      const z = pos[2] + Math.sin(a) * v * age * 0.8;
      const y = pos[1] + (1.6 + H(i, 3)) * age - 4.9 * age * age;
      if (y < pos[1] - 0.02) continue;
      this.dust.add(x, y, z, 0.06, 0.1, 0.06, 0.035, 1.0, H(i, 4) * 6);
    }
  }

  // Rising sparkles along the green wave front and drifting petals.
  petals(t, center, { count = 80, radius = 6, height = 3, alpha = 1 } = {}) {
    for (let i = 0; i < count; i++) {
      const fall = 0.35 + H(i, 1) * 0.3;
      const ph = ((t * fall * 0.25 + H(i, 2)) % 1);
      const x = center[0] + (H(i, 3) - 0.5) * radius * 2 + Math.sin(t * 1.3 + i) * 0.4 + ph * 1.5;
      const z = center[2] + (H(i, 4) - 0.5) * radius * 2 + Math.cos(t * 1.1 + i) * 0.3;
      const y = center[1] + height * (1 - ph);
      this.hearts.add(x, y, z, 0.05, 1.0, 0.72, 0.85, alpha * Math.sin(ph * Math.PI), t * 2 + i);
    }
  }
}
