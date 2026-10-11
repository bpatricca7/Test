// Falling weather drawn on the GPU: rain streaks, drifting snowflakes and candy "sprinkle rain"
// (instanced quads on a lattice that wraps around the camera, so nothing is updated per drop
// on the CPU), plus little ripple rings where drops land. A heightmap texture of the world
// (top solid or water block per column) hides drops under roofs and trees, so it never rains
// inside a house.

import * as THREE from 'three';
import { SHAPES } from '../core/registry.js';

// ---------- world heightmap ----------

export class Heightmap {
  constructor() {
    this.world = null;
    this.data = null;
    this.tex = null;
    this.row = 0;
    this.dirty = false;
    this.placeholder = new THREE.DataTexture(new Uint8Array([0]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
    this.placeholder.needsUpdate = true;
  }

  attach(world, props) {
    this.detach();
    this.world = world;
    this.props = props;
    this.data = new Uint8Array(world.sx * world.sz);
    for (let z = 0; z < world.sz; z++) this.refreshRow(z);
    this.tex = new THREE.DataTexture(this.data, world.sx, world.sz, THREE.RedFormat, THREE.UnsignedByteType);
    this.tex.magFilter = this.tex.minFilter = THREE.NearestFilter;
    this.tex.wrapS = this.tex.wrapT = THREE.ClampToEdgeWrapping;
    this.tex.needsUpdate = true;
  }

  detach() {
    if (this.tex) this.tex.dispose();
    this.tex = null;
    this.world = null;
    this.data = null;
  }

  /** Top solid or liquid block of a column (0 when empty). */
  scan(x, z) {
    const w = this.world, b = w.blocks, solid = this.props.solid, shape = this.props.shape;
    for (let y = w.sy - 1; y > 0; y--) {
      const id = b[(y * w.sz + z) * w.sx + x];
      if (id !== 0 && (solid[id] || shape[id] === SHAPES.liquid)) return y;
    }
    return 0;
  }

  refreshRow(z) {
    const w = this.world, d = this.data;
    let changed = false;
    for (let x = 0; x < w.sx; x++) {
      const h = this.scan(x, z);
      const i = z * w.sx + x;
      if (d[i] !== h) { d[i] = h; changed = true; }
    }
    if (changed) this.dirty = true;
  }

  setColumn(x, z) {
    if (!this.world || x < 0 || z < 0 || x >= this.world.sx || z >= this.world.sz) return;
    const h = this.scan(x, z);
    const i = z * this.world.sx + x;
    if (this.data[i] !== h) { this.data[i] = h; this.dirty = true; }
  }

  top(x, z) {
    const w = this.world;
    if (!w) return 0;
    x = Math.min(w.sx - 1, Math.max(0, x | 0));
    z = Math.min(w.sz - 1, Math.max(0, z | 0));
    return this.data[z * w.sx + x];
  }

  /** Keep up with edits that sent no events (prefabs, undo): a few rows per frame. */
  tick(rows = 3) {
    if (!this.world) return;
    for (let i = 0; i < rows; i++) {
      this.refreshRow(this.row);
      this.row = (this.row + 1) % this.world.sz;
    }
    if (this.dirty && this.tex) {
      this.tex.needsUpdate = true;
      this.dirty = false;
    }
  }
}

// ---------- precipitation ----------

const precipVert = /* glsl */ `
attribute vec4 aSeed;
attribute vec3 aTint;
uniform vec3 uCam;
uniform float uTime;
uniform vec3 uBox;
uniform float uAmount;
uniform float uMode; // 0 rain, 1 snow, 2 sprinkles
uniform sampler2D uHeight;
uniform vec3 uWorld; // sx, sz, has heightmap
uniform vec2 uWind;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vTint;
void main() {
  vUv = vec2(position.x + 0.5, position.y);
  vTint = aTint;
  float visible = step(aSeed.w, uAmount);
  bool snow = uMode > 0.5 && uMode < 1.5;
  float speed = uMode < 0.5 ? 15.0 + aSeed.w * 6.0 : snow ? 1.5 + aSeed.w * 1.1 : 4.5 + aSeed.w * 2.5;
  vec3 wp = aSeed.xyz * uBox + vec3(uWind.x, 0.0, uWind.y) * uTime * (snow ? 0.5 : 1.0);
  wp.y -= uTime * speed;
  if (snow) {
    wp.x += sin(uTime * 0.9 + aSeed.w * 30.0) * 0.7;
    wp.z += cos(uTime * 0.7 + aSeed.x * 25.0) * 0.7;
  }
  vec3 rel = mod(wp - uCam + 0.5 * uBox, uBox) - 0.5 * uBox;
  vec3 p = uCam + rel;
  float top = -1000.0;
  if (uWorld.z > 0.5) {
    vec2 huv = (floor(p.xz) + 0.5) / uWorld.xy;
    top = texture2D(uHeight, huv).r * 255.0 + 1.0;
  }
  float above = step(top, p.y);
  float edge = 1.0 - smoothstep(0.38, 0.5, abs(rel.y) / uBox.y);
  float fade = 1.0 - smoothstep(0.55, 1.0, length(rel.xz) / (0.5 * uBox.x));
  // drops right in front of the lens would be huge smears: let them fade out
  float near = smoothstep(1.4, 3.2, length(p - cameraPosition));
  vAlpha = visible * above * edge * fade * near;
  if (vAlpha < 0.002) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  vec3 offs;
  if (uMode < 0.5) {
    // rain: a streak standing along the fall direction, turned to face the camera
    vec3 dir = normalize(vec3(uWind.x / speed, 1.0, uWind.y / speed));
    vec3 side = normalize(cross(dir, normalize(cameraPosition - p)));
    offs = side * position.x * 0.04 + dir * position.y * (0.8 + aSeed.w * 0.5);
  } else {
    vec3 right = vec3(viewMatrix[0][0], viewMatrix[1][0], viewMatrix[2][0]);
    vec3 up = vec3(viewMatrix[0][1], viewMatrix[1][1], viewMatrix[2][1]);
    float ang = aSeed.x * 6.283 + uTime * (snow ? 0.7 : 2.6) * (aSeed.w - 0.5) * 2.0;
    vec2 c = vec2(position.x, position.y - 0.5);
    vec2 r = vec2(c.x * cos(ang) - c.y * sin(ang), c.x * sin(ang) + c.y * cos(ang));
    float size = snow ? 0.2 + aSeed.w * 0.16 : 0.42;
    offs = (right * r.x + up * r.y) * size;
  }
  gl_Position = projectionMatrix * viewMatrix * vec4(p + offs, 1.0);
}`;

const precipFrag = /* glsl */ `
uniform float uMode;
uniform float uLight;
varying vec2 vUv;
varying float vAlpha;
varying vec3 vTint;
void main() {
  vec2 c = vUv - 0.5;
  float a;
  vec3 col;
  if (uMode < 0.5) {
    a = smoothstep(0.5, 0.05, abs(c.x)) * smoothstep(0.0, 0.45, vUv.y) * smoothstep(1.0, 0.85, vUv.y) * 0.62;
    col = vec3(0.84, 0.92, 1.0);
  } else if (uMode < 1.5) {
    float r = length(c);
    float ang = atan(c.y, c.x);
    float arms = smoothstep(0.06, 0.0, abs(sin(ang * 3.0)) * r) * smoothstep(0.48, 0.3, r);
    a = max(smoothstep(0.3, 0.12, r) * 0.95, arms * 0.75);
    col = vec3(1.0);
  } else {
    vec2 q = vec2(abs(c.x), max(abs(c.y) - 0.22, 0.0));
    float d = length(q) - 0.11;
    a = smoothstep(0.03, -0.01, d);
    col = vTint + vec3(0.35) * smoothstep(0.02, -0.06, c.x + 0.02) * step(d, -0.03);
  }
  a *= vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(col * uLight, a);
}`;

const SPRINKLE_COLORS = ['#FF6FB5', '#FFC94D', '#3FD8B0', '#6CC6FF', '#B69CFF', '#FFFFFF', '#FF8C8C'];

/** One layer of falling things. mode: 0 rain, 1 snow, 2 sprinkles (rain layer switches 0/2). */
export function createPrecip(scene, heightmap, { count, box, mode }) {
  const quad = new THREE.InstancedBufferGeometry();
  quad.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, 0, 0.5, 0, 0, -0.5, 1, 0, 0.5, 1, 0]), 3));
  quad.setIndex([0, 1, 2, 2, 1, 3]);
  const seed = new Float32Array(count * 4), tint = new Float32Array(count * 3);
  let s = 12345 + mode * 999;
  const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    seed[i * 4] = rnd(); seed[i * 4 + 1] = rnd(); seed[i * 4 + 2] = rnd(); seed[i * 4 + 3] = rnd();
    const hex = SPRINKLE_COLORS[i % SPRINKLE_COLORS.length];
    tint[i * 3] = parseInt(hex.slice(1, 3), 16) / 255;
    tint[i * 3 + 1] = parseInt(hex.slice(3, 5), 16) / 255;
    tint[i * 3 + 2] = parseInt(hex.slice(5, 7), 16) / 255;
  }
  quad.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seed, 4));
  quad.setAttribute('aTint', new THREE.InstancedBufferAttribute(tint, 3));
  quad.instanceCount = count;
  const uniforms = {
    uCam: { value: new THREE.Vector3() }, uTime: { value: 0 }, uBox: { value: new THREE.Vector3(...box) },
    uAmount: { value: 0 }, uMode: { value: mode }, uHeight: { value: heightmap.placeholder },
    uWorld: { value: new THREE.Vector3(1, 1, 0) }, uWind: { value: new THREE.Vector2(0.8, 0.3) }, uLight: { value: 1 },
  };
  const mesh = new THREE.Mesh(quad, new THREE.ShaderMaterial({
    uniforms, vertexShader: precipVert, fragmentShader: precipFrag,
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 8;
  mesh.visible = false;
  mesh.userData.envWarm = true;
  scene.add(mesh);
  return {
    mesh, uniforms, count,
    update(t, cam, amount, light, lowQuality) {
      mesh.visible = amount > 0.002;
      if (!mesh.visible) return;
      uniforms.uTime.value = t;
      uniforms.uCam.value.copy(cam);
      uniforms.uAmount.value = amount;
      uniforms.uLight.value = light;
      quad.instanceCount = lowQuality ? count >> 1 : count;
      const hm = heightmap;
      if (hm.tex && hm.world) {
        uniforms.uHeight.value = hm.tex;
        uniforms.uWorld.value.set(hm.world.sx, hm.world.sz, 1);
      } else {
        uniforms.uHeight.value = hm.placeholder;
        uniforms.uWorld.value.set(1, 1, 0);
      }
    },
  };
}

// ---------- ripples where drops land ----------

const rippleVert = /* glsl */ `
attribute vec4 aRip; // x, y, z, birth time
attribute vec3 aCol;
uniform float uTime;
varying vec2 vUv;
varying float vAge;
varying vec3 vCol;
void main() {
  vAge = (uTime - aRip.w) / 0.75;
  vUv = position.xz + 0.5;
  vCol = aCol;
  if (vAge < 0.0 || vAge > 1.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  vec3 p = aRip.xyz + position * 0.95;
  gl_Position = projectionMatrix * viewMatrix * vec4(p, 1.0);
}`;

const rippleFrag = /* glsl */ `
uniform float uLight;
varying vec2 vUv;
varying float vAge;
varying vec3 vCol;
void main() {
  float r = length(vUv * 2.0 - 1.0);
  float R = 0.2 + 0.8 * vAge;
  float ring = smoothstep(0.1, 0.0, abs(r - R)) + 0.6 * smoothstep(0.08, 0.0, abs(r - R * 0.55)) * step(0.3, vAge);
  float a = ring * (1.0 - vAge) * 0.75;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vCol * uLight, a);
}`;

export function createRipples(scene, max = 72) {
  const g = new THREE.InstancedBufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, 0, -0.5, 0.5, 0, -0.5, -0.5, 0, 0.5, 0.5, 0, 0.5]), 3));
  g.setIndex([0, 2, 1, 1, 2, 3]);
  const rip = new Float32Array(max * 4).fill(-100), col = new Float32Array(max * 3).fill(1);
  const aRip = new THREE.InstancedBufferAttribute(rip, 4).setUsage(THREE.DynamicDrawUsage);
  const aCol = new THREE.InstancedBufferAttribute(col, 3).setUsage(THREE.DynamicDrawUsage);
  g.setAttribute('aRip', aRip);
  g.setAttribute('aCol', aCol);
  g.instanceCount = max;
  const uniforms = { uTime: { value: 0 }, uLight: { value: 1 } };
  const mesh = new THREE.Mesh(g, new THREE.ShaderMaterial({
    uniforms, vertexShader: rippleVert, fragmentShader: rippleFrag,
    transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2,
  }));
  mesh.frustumCulled = false;
  mesh.renderOrder = 7;
  mesh.userData.envWarm = true;
  scene.add(mesh);
  let next = 0, lastSpawn = -10;
  return {
    mesh, uniforms,
    spawn(x, y, z, t, r = 0.85, gg = 0.93, b = 1) {
      const i = next;
      next = (next + 1) % max;
      rip[i * 4] = x; rip[i * 4 + 1] = y; rip[i * 4 + 2] = z; rip[i * 4 + 3] = t;
      col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = b;
      aRip.needsUpdate = true;
      aCol.needsUpdate = true;
      lastSpawn = t;
    },
    update(t, light) {
      uniforms.uTime.value = t;
      uniforms.uLight.value = light;
      mesh.visible = t - lastSpawn < 1;
    },
    clear() {
      rip.fill(-100);
      aRip.needsUpdate = true;
      lastSpawn = -10;
    },
  };
}
