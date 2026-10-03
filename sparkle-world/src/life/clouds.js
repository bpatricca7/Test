// Fluffy voxel clouds: one mesh of puffy boxes on a wrapping grid that follows the camera and
// drifts with the wind. Every puff has an "appear at" coverage value, so the sky can fill up
// with clouds (cloudy / rain / snow weather) and clear again: puffs inflate from their middle
// instead of popping in. Colors (top / side / bottom) are set per frame by daynight.js.

import * as THREE from 'three';
import { mulberry32 } from '../core/util.js';

const CELL = 6; // world units per cloud cell
const LAYER = 2.1; // height per cloud layer
const N = 64; // cells per side (the grid wraps)
export const CLOUD_PERIOD = CELL * N;

const vert = /* glsl */ `
attribute vec2 cellC;
attribute float thr;
attribute float topF;
attribute float shade;
attribute float cellH;
uniform vec3 uCam;
uniform vec2 uDrift;
uniform float uPeriod;
uniform float uCoverage;
uniform float uBaseY;
varying float vShade;
varying float vTopF;
varying float vDepth;
varying float vEdge;
void main() {
  float grow = clamp((uCoverage - thr) / 0.06, 0.0, 1.0);
  if (grow <= 0.002) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  grow = grow * grow * (3.0 - 2.0 * grow);
  vec2 c = cellC + uDrift;
  vec2 w = uCam.xz + mod(c - uCam.xz + 0.5 * uPeriod, uPeriod) - 0.5 * uPeriod;
  vec2 local = (position.xz - cellC) * (0.6 + 0.4 * grow);
  float mid = uBaseY + cellH * 0.5;
  float y = mid + (topF - 0.5) * cellH * grow;
  vec3 p = vec3(w.x + local.x, y, w.y + local.y);
  vec4 mv = viewMatrix * vec4(p, 1.0);
  vShade = shade;
  vTopF = topF;
  vDepth = length(mv.xyz);
  vEdge = length(w - uCam.xz) / (0.5 * uPeriod);
  gl_Position = projectionMatrix * mv;
}`;

const frag = /* glsl */ `
uniform vec3 uTopCol;
uniform vec3 uSideCol;
uniform vec3 uBotCol;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
varying float vShade;
varying float vTopF;
varying float vDepth;
varying float vEdge;
void main() {
  vec3 side = mix(uBotCol, uSideCol, 0.35 + 0.65 * vTopF);
  vec3 col = vShade > 0.95 ? uTopCol : vShade < 0.05 ? uBotCol : side * (0.94 + 0.12 * vShade);
  float fog = smoothstep(uFogNear, uFogFar, vDepth);
  fog = max(fog, smoothstep(0.7, 0.98, vEdge));
  gl_FragColor = vec4(mix(col, uFogColor, fog), 1.0);
}`;

/** Build the cell grid: appear threshold (0..1.1) and layer count per cell. */
function generateCells(seed) {
  const rand = mulberry32(seed ^ 0x51ed270b);
  const thr = new Float32Array(N * N).fill(9);
  const layers = new Uint8Array(N * N);
  const blobs = 70;
  for (let b = 0; b < blobs; b++) {
    const cx = rand() * N, cz = rand() * N;
    const rx = 2.2 + rand() * 4.2, rz = rx * (0.55 + rand() * 0.35);
    const appear = rand() * 0.95;
    const R = Math.ceil(Math.max(rx, rz)) + 1;
    for (let dz = -R; dz <= R; dz++) {
      for (let dx = -R; dx <= R; dx++) {
        const nx = (dx + 0.5 - (cx % 1)) / rx, nz = (dz + 0.5 - (cz % 1)) / rz;
        // bumpy edge
        const d = nx * nx + nz * nz + (rand() - 0.5) * 0.1;
        if (d > 1) continue;
        const i = ((Math.floor(cx) + dx) % N + N) % N, j = ((Math.floor(cz) + dz) % N + N) % N;
        const k = j * N + i;
        const t = appear * 0.8 + d * 0.28;
        if (t < thr[k]) thr[k] = t;
        const L = d < 0.18 && rx > 3.4 ? 3 : d < 0.55 ? 2 : 1;
        if (L > layers[k]) layers[k] = L;
      }
    }
  }
  return { thr, layers };
}

function buildGeometry(seed) {
  const { thr, layers } = generateCells(seed);
  const pos = [], cc = [], th = [], tf = [], sh = [], ch = [];
  const idx = [];
  let v = 0;
  const quad = (pts, cellX, cellZ, t, h, shade) => {
    for (const [x, y, z, top] of pts) {
      pos.push(x, y, z);
      cc.push(cellX, cellZ);
      th.push(t);
      tf.push(top);
      sh.push(shade);
      ch.push(h);
    }
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    v += 4;
  };
  const at = (i, j) => (((j % N) + N) % N) * N + (((i % N) + N) % N);
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const k = j * N + i;
      const L = layers[k];
      if (!L) continue;
      const t = thr[k];
      const h = L * LAYER;
      const x0 = i * CELL, x1 = x0 + CELL, z0 = j * CELL, z1 = z0 + CELL;
      const cx = x0 + CELL / 2, cz = z0 + CELL / 2;
      // top (CCW seen from above) and bottom
      quad([[x0, 0, z0, 1], [x0, 0, z1, 1], [x1, 0, z1, 1], [x1, 0, z0, 1]], cx, cz, t, h, 1);
      quad([[x0, 0, z0, 0], [x1, 0, z0, 0], [x1, 0, z1, 0], [x0, 0, z1, 0]], cx, cz, t, h, 0);
      // sides where the neighbour is lower, missing, or may be hidden while this one shows
      const sides = [
        [1, 0, [[x1, 0, z0, 0], [x1, 0, z0, 1], [x1, 0, z1, 1], [x1, 0, z1, 0]], 0.62],
        [-1, 0, [[x0, 0, z1, 0], [x0, 0, z1, 1], [x0, 0, z0, 1], [x0, 0, z0, 0]], 0.5],
        [0, 1, [[x1, 0, z1, 0], [x1, 0, z1, 1], [x0, 0, z1, 1], [x0, 0, z1, 0]], 0.56],
        [0, -1, [[x0, 0, z0, 0], [x0, 0, z0, 1], [x1, 0, z0, 1], [x1, 0, z0, 0]], 0.44],
      ];
      for (const [di, dj, pts, shade] of sides) {
        const n = at(i + di, j + dj);
        if (layers[n] >= L && thr[n] <= t + 1e-4) continue;
        quad(pts, cx, cz, t, h, shade);
      }
    }
  }
  // faces sorted by their appear threshold: only the prefix below the coverage is drawn
  const order = Array.from({ length: v / 4 }, (_, q) => q).sort((a, b) => th[a * 4] - th[b * 4]);
  const sortedIdx = new Uint32Array(order.length * 6);
  const faceThr = new Float32Array(order.length);
  order.forEach((q, n) => {
    for (let k = 0; k < 6; k++) sortedIdx[n * 6 + k] = idx[q * 6 + k];
    faceThr[n] = th[q * 4];
  });
  const g = new THREE.BufferGeometry();
  g.userData.faceThr = faceThr;
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('cellC', new THREE.Float32BufferAttribute(cc, 2));
  g.setAttribute('thr', new THREE.Float32BufferAttribute(th, 1));
  g.setAttribute('topF', new THREE.Float32BufferAttribute(tf, 1));
  g.setAttribute('shade', new THREE.Float32BufferAttribute(sh, 1));
  g.setAttribute('cellH', new THREE.Float32BufferAttribute(ch, 1));
  g.setIndex(new THREE.BufferAttribute(sortedIdx, 1));
  return g;
}

/**
 * Create the cloud layer. Returns { mesh, uniforms, setSeed(seed), update(dt, camera) }.
 * uniforms.uCoverage: 0.3 (a few fair-weather puffs) .. 1.1 (a full grey-lavender sky).
 */
export function createClouds(scene) {
  const uniforms = {
    uCam: { value: new THREE.Vector3() },
    uDrift: { value: new THREE.Vector2() },
    uPeriod: { value: CLOUD_PERIOD },
    uCoverage: { value: 0.42 },
    uBaseY: { value: 67 },
    uTopCol: { value: new THREE.Color(1, 1, 1) },
    uSideCol: { value: new THREE.Color(0.95, 0.95, 1) },
    uBotCol: { value: new THREE.Color(0.86, 0.86, 0.97) },
    uFogColor: { value: new THREE.Color(0.8, 0.9, 1) },
    uFogNear: { value: 120 },
    uFogFar: { value: 260 },
  };
  const material = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag });
  let seed = -1;
  const mesh = new THREE.Mesh(new THREE.BufferGeometry(), material);
  mesh.frustumCulled = false;
  mesh.renderOrder = -5;
  mesh.name = 'clouds';
  mesh.visible = false;
  mesh.userData.envWarm = true;
  scene.add(mesh);
  return {
    mesh,
    uniforms,
    setSeed(s) {
      s |= 0;
      if (s === seed) return;
      seed = s;
      mesh.geometry.dispose();
      mesh.geometry = buildGeometry(s);
    },
    update(dt, cam, wind = 1) {
      uniforms.uCam.value.copy(cam);
      // draw only the faces whose puff is (at least partly) out: binary search the sorted list
      const ft = mesh.geometry.userData.faceThr;
      if (ft) {
        const cov = uniforms.uCoverage.value;
        let lo = 0, hi = ft.length;
        while (lo < hi) {
          const m = (lo + hi) >> 1;
          if (ft[m] < cov) lo = m + 1;
          else hi = m;
        }
        mesh.geometry.setDrawRange(0, lo * 6);
      }
      const d = uniforms.uDrift.value;
      d.x = (d.x + dt * 1.1 * wind) % CLOUD_PERIOD;
      d.y = (d.y + dt * 0.25 * wind) % CLOUD_PERIOD;
    },
  };
}
