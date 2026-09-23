// ECHO (animated cut) — scene "valley" (film 9.0–27.0 s).
//
// November 16, 1974. A giant radio dish set into a moonlit jungle valley
// powers up and sends 1,679 bits to the stars.
//   crane    9.0–18.0  high over misty karst hills, sweeping down onto the dish
//   power_up 14.5      aviation beacons, platform work lights, dish sheen
//   transmit 17.0–24.0 shockwave across the dish, a column of light, the bits
//                      stream up it in order (bit i leaves at 17 + i/1679 * 7);
//                      each row of 23 bits is one turn of a rising helix
//   tilt_up  20.0–27.0 the camera rises and tilts to look straight up the beam
//
// Everything is a pure function of film time t. Performance notes (SwiftShader):
// per-pixel noise and mipmapped texture sampling are very expensive there, so
// the terrain bakes most of its detail per vertex, uses one non-mipmapped
// texture fetch for tree crowns, and the sky is drawn after the opaque scene.
// The compositor has no MSAA; cables are analytic anti-aliased ribbons.

import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------------------------------------------------------------------------
// world layout (1 unit = 1 m, dish centre at the origin, rim at y = 0)
// ---------------------------------------------------------------------------
const DISH_A = 152.5;                                        // aperture radius
const DISH_R = 265.0;                                        // sphere radius
const DISH_CY = Math.sqrt(DISH_R * DISH_R - DISH_A * DISH_A); // sphere centre height (216.7)
const dishY = r => DISH_CY - Math.sqrt(DISH_R * DISH_R - Math.min(r, DISH_R) ** 2);
const DISH_BOTTOM = dishY(0);                                // -48.3

const TOWER_R = 232, TOWER_TOP = 140;
const TOWER_AZ = [90, 210, 330].map(d => d * Math.PI / 180);
const PLAT_RC = 37;                                          // platform circumradius
const PLAT_Y0 = 110, PLAT_Y1 = 120;                          // bottom / top chord
const FOCAL_R = DISH_R / 2;
const focalY = x => DISH_CY - Math.sqrt(FOCAL_R * FOCAL_R - x * x);
const ARM_AZ = 25 * Math.PI / 180;

const MOON_AZ = 318 * Math.PI / 180, MOON_EL = 21 * Math.PI / 180;

const BEAM_R = 20;            // visible column radius
const BEAM_HALO = 70;         // halo cylinder radius
const BIT_Y0 = DISH_BOTTOM + 4, BIT_V0 = 110, BIT_ACC = 95;  // bit flight
const BIT_RH = 15;            // helix radius: each row of 23 bits is one turn
const BIT_TRAIL = 0.11;       // s of trail behind every bit

export async function create(env) {
  const { THREE, TL, W, H, renderer, U } = env;
  const VT = TL.valley;
  const BITS = VT.bits;
  const NB = BITS.length;
  const T_POWER = VT.power_up;
  const T_TX0 = VT.transmit.start, T_TX1 = VT.transmit.end;

  // -------------------------------------------------------------------------
  // colour helpers: pick colours by the sRGB value they should end up as
  // after ACES, so the grade matches the brief (#02040b -> #0c1a33)
  // -------------------------------------------------------------------------
  const s2l = v => (v <= 0.04045 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  const hexRGB = hex => [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255].map(v => v / 255);
  function acesFwd(c) {
    const s = 1 / 0.6, r = c[0] * s, g = c[1] * s, b = c[2] * s;
    const x = 0.59719 * r + 0.35458 * g + 0.04823 * b;
    const y = 0.07600 * r + 0.90834 * g + 0.01566 * b;
    const z = 0.02840 * r + 0.13383 * g + 0.83777 * b;
    const f = v => (v * (v + 0.0245786) - 0.000090537) / (v * (0.983729 * v + 0.4329510) + 0.238081);
    const X = f(x), Y = f(y), Z = f(z);
    return [1.60475 * X - 0.53108 * Y - 0.07367 * Z,
      -0.10208 * X + 1.10813 * Y - 0.00605 * Z,
      -0.00327 * X - 0.07276 * Y + 1.07602 * Z];
  }
  /** linear pre-tonemap colour that displays as the given sRGB hex */
  function graded(hex) {
    const want = hexRGB(hex).map(s2l);
    let c = want.map(v => v * 1.5 + 0.004);
    for (let it = 0; it < 200; it++) {
      const o = acesFwd(c);
      c = c.map((v, i) => Math.max(0, v + (want[i] - o[i]) * 1.2));
    }
    return new THREE.Vector3(c[0], c[1], c[2]);
  }

  const MOON_DIR = new THREE.Vector3(Math.cos(MOON_EL) * Math.cos(MOON_AZ), Math.sin(MOON_EL),
    Math.cos(MOON_EL) * Math.sin(MOON_AZ));

  // -------------------------------------------------------------------------
  // a tileable RGBA value-noise texture: shaders sample this instead of
  // evaluating noise per pixel (much cheaper on a software GPU)
  // -------------------------------------------------------------------------
  function periodicNoise(size, f0, oct, seed) {
    const acc = new Float32Array(size * size);
    let amp = 1;
    for (let o = 0; o < oct; o++) {
      const f = f0 << o;
      const rnd = U.mulberry32(seed * 131 + o);
      const lat = new Float32Array(f * f);
      for (let i = 0; i < f * f; i++) lat[i] = rnd();
      for (let y = 0; y < size; y++) {
        const gy = y / size * f, iy = Math.floor(gy), fy = gy - iy, sy = fy * fy * (3 - 2 * fy);
        const y0 = iy % f, y1 = (iy + 1) % f;
        for (let x = 0; x < size; x++) {
          const gx = x / size * f, ix = Math.floor(gx), fx = gx - ix, sx = fx * fx * (3 - 2 * fx);
          const x0 = ix % f, x1 = (ix + 1) % f;
          const a = lat[y0 * f + x0], b = lat[y0 * f + x1], c = lat[y1 * f + x0], d = lat[y1 * f + x1];
          acc[y * size + x] += amp * ((a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy);
        }
      }
      amp *= 0.5;
    }
    let lo = Infinity, hi = -Infinity;
    for (const v of acc) { lo = Math.min(lo, v); hi = Math.max(hi, v); }
    for (let i = 0; i < acc.length; i++) acc[i] = (acc[i] - lo) / (hi - lo);
    return acc;
  }
  function dataTexture(data, size) {
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = THREE.LinearFilter;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.generateMipmaps = true;
    tex.needsUpdate = true;
    return tex;
  }
  function makeNoiseTexture(size) {
    const data = new Uint8Array(size * size * 4);
    [[8, 4, 11], [16, 3, 23], [32, 3, 37], [4, 5, 41]].forEach(([f0, oct, seed], ch) => {
      const n = periodicNoise(size, f0, oct, seed);
      for (let i = 0; i < size * size; i++) data[i * 4 + ch] = Math.round(n[i] * 255);
    });
    return dataTexture(data, size);
  }
  // canopy texture: (r, g) = tree-crown height and how much each crown's
  // surface turns toward the moon (round domes on a jittered grid, lit on
  // the moon side); (b, a) = clump noise and its slope toward the moon
  function makeCanopyTexture(size) {
    const data = new Uint8Array(size * size * 4);
    const L = MOON_DIR;
    const wrap = v => ((v % size) + size) % size;
    // crowns
    const CELLS = 36, cs = size / CELLS;
    const rnd = U.mulberry32(777);
    // two crowns per cell: a big one and a smaller one filling the gaps
    const jx = [], jy = [], jr = [], jv = [];
    for (let i = 0; i < CELLS * CELLS; i++) {
      jx.push(0.15 + 0.7 * rnd(), rnd()); jy.push(0.15 + 0.7 * rnd(), rnd()); jr.push(0.5 + 0.55 * rnd(), 0.3 + 0.25 * rnd());
      jv.push(0.6 + 0.4 * rnd(), 0.55 + 0.45 * rnd());   // crown-to-crown brightness
    }
    const leaf = periodicNoise(size, 128, 2, 91);
    const hgt = new Float32Array(size * size);
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const gx = (x + 0.5) / cs, gy = (y + 0.5) / cs, ix = Math.floor(gx), iy = Math.floor(gy);
      let best = 0;
      for (let dj = -1; dj <= 1; dj++) for (let di = -1; di <= 1; di++) {
        const cx = ix + di, cy = iy + dj;
        const c = (((cy % CELLS) + CELLS) % CELLS) * CELLS + (((cx % CELLS) + CELLS) % CELLS);
        for (let k = 2 * c; k < 2 * c + 2; k++) {
          const R = jr[k];
          const d2 = ((gx - cx - jx[k]) ** 2 + (gy - cy - jy[k]) ** 2) / (R * R);
          if (d2 < 1) best = Math.max(best, R * Math.sqrt(1 - d2) * jv[k]);
        }
      }
      hgt[y * size + x] = best + 0.12 * leaf[y * size + x];
    }
    const hs = (x, y) => hgt[wrap(y) * size + wrap(x)];
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
      const i = y * size + x;
      // surface normal of the crown field (heights in cell units -> texels)
      const dx = (hs(x + 1, y) - hs(x - 1, y)) * 0.5 * cs * 0.9, dz = (hs(x, y + 1) - hs(x, y - 1)) * 0.5 * cs * 0.9;
      const nl = Math.hypot(dx, 1, dz);
      const delta = (-dx * L.x + L.y - dz * L.z) / nl - L.y;
      data[i * 4] = Math.round(U.clamp(hgt[i] / 1.0) * 255);
      data[i * 4 + 1] = Math.round(U.clamp(0.5 + 0.5 * delta) * 255);
    }
    // blurred copy (b, a) for the middle distance: sampling a mipmapped
    // texture with a per-pixel LOD is very slow on SwiftShader, so the
    // texture has no mips and we blend sharp -> blurred -> average ourselves
    const BL = 3;
    for (let ch = 0; ch < 2; ch++) {
      const src = new Float32Array(size * size), tmp = new Float32Array(size * size);
      for (let i = 0; i < size * size; i++) src[i] = data[i * 4 + ch];
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let a = 0;
        for (let k = -BL; k <= BL; k++) a += src[y * size + wrap(x + k)];
        tmp[y * size + x] = a / (2 * BL + 1);
      }
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        let a = 0;
        for (let k = -BL; k <= BL; k++) a += tmp[wrap(y + k) * size + x];
        data[(y * size + x) * 4 + 2 + ch] = Math.round(a / (2 * BL + 1));
      }
    }
    const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
    tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
    tex.magFilter = tex.minFilter = THREE.LinearFilter;
    tex.generateMipmaps = false;
    tex.needsUpdate = true;
    return tex;
  }
  const NOISE = makeNoiseTexture(256);

  // -------------------------------------------------------------------------
  // shared uniforms + GLSL (sky colour, mist, aerial fog)
  // -------------------------------------------------------------------------
  const C = {
    uCamPos: { value: new THREE.Vector3() },
    uTime: { value: 0 },
    uNoise: { value: NOISE },
    uMoonDir: { value: MOON_DIR },
    uMoonCol: { value: new THREE.Vector3(0.58, 0.70, 1.0).multiplyScalar(0.95) },
    uAmb: { value: graded(0x0b1627) },
    uZenith: { value: graded(0x02040b) },
    uHorizon: { value: graded(0x10203a) },
    uMoonGlow: { value: new THREE.Vector3(0.18, 0.23, 0.36) },
    uMistCol: { value: graded(0x22324d) },
    uBeamCol: { value: new THREE.Vector3(0.55, 0.8, 1.0) },
    uFogDens: { value: 0.00012 },
    uMistDens: { value: 0.0016 },
    uMistH: { value: 24.0 },
    uMistBase: { value: -30.0 },
    uBeam: { value: 0 },      // column intensity 0..1 (+ flash)
    uPower: { value: 0 },     // transmitter power-up 0..1
    uShock: { value: -1 },    // seconds since the transmit shockwave
    uWork: { value: 0 },      // platform work lights
    uRed: { value: 0 },       // aviation beacons (blink envelope)
    uPowerR: { value: 0 },    // radius the power-up sheen has spread to
  };

  const COMMON = /* glsl */`
uniform vec3 uCamPos;
uniform float uTime;
uniform sampler2D uNoise;
uniform vec3 uMoonDir, uMoonCol, uAmb, uZenith, uHorizon, uMoonGlow, uMistCol, uBeamCol;
uniform float uFogDens, uMistDens, uMistH, uMistBase;
uniform float uBeam, uPower, uShock, uWork, uRed;
vec3 skyColor(vec3 rd) {
  float h = clamp(rd.y, 0.0, 1.0);
  vec3 c = mix(uHorizon, uZenith, pow(h, 0.5));
  float mu = max(dot(rd, uMoonDir), 0.0);
  float mu2 = mu * mu, mu4 = mu2 * mu2, mu8 = mu4 * mu4, mu32 = mu8 * mu8; mu32 *= mu32;
  c += uMoonGlow * (0.25 * mu4 + 0.5 * mu32 * mu8);
  return c;
}
// height fog + aerial perspective; returns (multiply, add) so it can be
// evaluated per vertex and applied per pixel
void atmos(vec3 wp, float mistMul, out float fmul, out vec3 fadd) {
  vec3 d = wp - uCamPos;
  float dist = length(d);
  vec3 rd = d / dist;
  float e0 = exp(-(uCamPos.y - uMistBase) / uMistH);
  float e1 = exp(-clamp(wp.y - uMistBase, -80.0, 1e4) / uMistH);
  float m = abs(rd.y) < 1e-3 ? e0 * dist : uMistH * (e0 - e1) / rd.y;
  float fm = 1.0 - exp(-m * uMistDens * mistMul);
  float mu = max(dot(rd, uMoonDir), 0.0);
  vec3 mc = uMistCol * (0.6 + 0.9 * mu * mu * mu);
  mc += uBeamCol * min(uBeam, 1.0) * 0.07 * exp(-length(wp.xz) / 200.0);
  float fa = 1.0 - exp(-dist * uFogDens);
  fmul = (1.0 - fm) * (1.0 - fa);
  fadd = mc * fm * (1.0 - fa) + skyColor(rd) * fa;
}
vec3 applyAtmos(vec3 col, vec3 wp) {
  float fm; vec3 fa;
  atmos(wp, mix(0.2, 1.0, smoothstep(170.0, 560.0, length(wp.xz))), fm, fa);
  return col * fm + fa;
}
`;

  const VS_WORLD = /* glsl */`
varying vec3 vWorld;
varying vec3 vNormal;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

  const scene3 = new THREE.Scene();
  const cam = new THREE.PerspectiveCamera(46, W / H, 2.0, 70000);
  cam.rotation.order = 'YXZ';
  const PX_SCALE = H / (2 * Math.tan(cam.fov * Math.PI / 360));  // px per unit at depth 1

  // -------------------------------------------------------------------------
  // terrain: karst "haystack" hills around a sinkhole, far ridges, canopy
  // -------------------------------------------------------------------------
  const TW = TOWER_AZ.map(a => ({ x: TOWER_R * Math.cos(a), z: TOWER_R * Math.sin(a), a }));
  function h2(i, j, s) {
    let h = Math.imul(i, 374761393) ^ Math.imul(j, 668265263) ^ Math.imul(s + 17, 1442695041);
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  }
  function mogoteGrid(x, z, cell, seed, hmin, hmax) {
    const ci = Math.floor(x / cell), cj = Math.floor(z / cell);
    let sum = 0;
    for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
      const i = ci + di, j = cj + dj;
      const cx = (i + 0.1 + 0.8 * h2(i, j, seed)) * cell, cz = (j + 0.1 + 0.8 * h2(i, j, seed + 1)) * cell;
      const R = cell * (0.45 + 0.4 * h2(i, j, seed + 2));
      const d = Math.sqrt((x - cx) ** 2 + (z - cz) ** 2) / R;
      if (d < 1) {
        const Hh = hmin + (hmax - hmin) * Math.pow(h2(i, j, seed + 3), 1.4);
        const s = 1 - U.smooth(0.15, 1.0, d);
        sum += Hh * s * (0.8 + 0.2 * (1 - d));
      }
    }
    return sum;
  }
  function terrainParts(x, z) {
    const r = Math.hypot(x, z);
    const base = (U.fbm3(x * 0.0017, 0.37, z * 0.0017, 5) - 0.5) * 130;
    const mog = mogoteGrid(x, z, 230, 1, 25, 105) * 0.8 + mogoteGrid(x + 71, z - 133, 150, 9, 15, 60) * 0.6;
    let h = base + mog;
    const far = U.smooth(1700, 6500, r);
    if (far > 0) h += far * (U.fbm3(x * 0.00042 + 3.1, 1.3, z * 0.00042 - 2.2, 5) * 1300 - 380);
    // the sinkhole: near the dish the ground drops to the rim, with walls around it
    const w = U.smooth(165, 480, r);
    const bowl = 4 + 34 * U.smooth(160, 330, r);
    h = U.lerp(bowl, h + 22, w);
    for (const T of TW) {
      const d2 = (x - T.x) ** 2 + (z - T.z) ** 2;
      h += 24 * Math.exp(-d2 / (60 * 60));
    }
    h = U.lerp(0.4, h, U.smooth(153.0, 161, r));
    // canopy lumps where the mesh is fine enough to carry them
    const spacing = 0.014 * r;
    const amp = 4.0 * U.clamp(1 - spacing / 9) * U.smooth(160, 172, r);
    if (amp > 0) h += (U.vnoise3(x * 0.13, 5.5, z * 0.13) - 0.5) * amp + (U.vnoise3(x * 0.31, 2.5, z * 0.31) - 0.5) * amp * 0.5;
    // valley-ness: low ground between the hills holds the mist
    const valley = (1 - U.smooth(4, 38, mog * w + (1 - w) * 60)) * (0.45 + 0.55 * (1 - U.smooth(-40, 45, base))) * (1 - far * 0.4);
    return { h, valley, spacing };
  }
  const height = (x, z) => terrainParts(x, z).h;

  let terrainMat;
  const terrain = new THREE.Group();
  terrain.name = 'terrain';
  scene3.add(terrain);
  {
    const NR = 190, NA = 352, r0 = DISH_A, r1 = 9500;
    const ringR = i => r0 * Math.pow(r1 / r0, i / (NR - 1));
    const NV = NR * NA;
    const pos = new Float32Array(NV * 3), det = new Float32Array(NV * 4), clump = new Float32Array(NV * 2);
    const mlx = MOON_DIR.x / Math.hypot(MOON_DIR.x, MOON_DIR.z), mlz = MOON_DIR.z / Math.hypot(MOON_DIR.x, MOON_DIR.z);
    for (let i = 0; i < NR; i++) {
      const r = ringR(i);
      for (let j = 0; j < NA; j++) {
        const a = (j + (i % 2) * 0.5) / NA * Math.PI * 2;
        const x = r * Math.cos(a), z = r * Math.sin(a);
        const k = i * NA + j;
        const P = terrainParts(x, z);
        pos[k * 3] = x; pos[k * 3 + 1] = P.h; pos[k * 3 + 2] = z;
        // canopy crowns baked per vertex where the mesh is fine enough
        const fineAmt = U.clamp(1 - P.spacing / 7);
        const crown = U.vnoise3(x * 0.16, 1.5, z * 0.16) * 0.6 + U.vnoise3(x * 0.37, 8.5, z * 0.37) * 0.4;
        det[k * 4] = U.lerp(0.5, crown, fineAmt);
        det[k * 4 + 1] = U.fbm3(x * 0.006, 4.4, z * 0.006, 3);
        det[k * 4 + 2] = P.valley;
        det[k * 4 + 3] = 1 - U.smooth(156.5, 159.5, r);
        // clumps of trees (~35 m) and their slope toward the moon
        const ca = U.clamp(1 - P.spacing / 30);
        const c0 = U.fbm3(x * 0.028, 7.7, z * 0.028, 3), c1 = U.fbm3((x + mlx * 6) * 0.028, 7.7, (z + mlz * 6) * 0.028, 3);
        clump[k * 2] = U.lerp(0.5, c0, ca);
        clump[k * 2 + 1] = (c0 - c1) * 4.0 * ca;
      }
    }
    const quadIdx = (i, j) => {
      const a = i * NA + j, b = i * NA + (j + 1) % NA, c = (i + 1) * NA + j, d = (i + 1) * NA + (j + 1) % NA;
      return [a, b, c, b, d, c];
    };
    // normals from the whole grid, so chunk borders are seamless
    const full = [];
    for (let i = 0; i < NR - 1; i++) for (let j = 0; j < NA; j++) full.push(...quadIdx(i, j));
    const g0 = new THREE.BufferGeometry();
    g0.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    g0.setIndex(full);
    g0.computeVertexNormals();
    const nrm = g0.attributes.normal.array;
    g0.dispose();

    const canopyTex = makeCanopyTexture(512);
    terrainMat = new THREE.ShaderMaterial({
      uniforms: {
        ...C, uCanopy: { value: canopyTex }, uValley: { value: 1.6 }, uPixAng: { value: 1 / PX_SCALE },
        uVeg: { value: new THREE.Vector3(0.040, 0.054, 0.035) },
      },
      // few varyings on purpose: on SwiftShader the per-pixel cost of the
      // terrain is dominated by interpolating them
      vertexShader: /* glsl */`
${COMMON}
uniform float uValley, uPixAng;
uniform vec3 uVeg;
attribute vec4 aDet;
attribute vec2 aClump;
varying vec4 vA;       // crown texture uv, crown LOD, crown-bump weight
varying vec3 vL;       // moon light scale, ambient scale (both incl. albedo and fog), N.L + clump slope
varying vec3 vFogAdd;  // in-scattered fog / mist + beam light
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * viewMatrix * w;
  vec3 vv = w.xyz - uCamPos;
  float dist = length(vv);
  vec3 rd = vv / dist;
  // texture LOD for the crown texture (0.39 m texels): pixel footprint,
  // widened at grazing angles
  float cosv = abs(dot(rd, normal));
  float lod = log2(max(dist * uPixAng / 0.39 / sqrt(max(cosv, 0.08)), 1e-3)) + 0.22;
  // albedo brightness: tree clumps (baked), colour patches, rim walkway
  float canopy = aDet.x * 0.3 + aClump.x * 0.7;
  float alb = mix((0.8 + 0.4 * aDet.y) * (0.6 + 0.8 * canopy), 1.6, aDet.w);
  float fm; vec3 fa;
  atmos(w.xyz, 1.0, fm, fa);
  // ground mist pooled in the valleys between the hills, drifting slowly
  vec4 pm = textureLod(uNoise, w.xz * 0.00022 + vec2(uTime * 0.0011, uTime * 0.0004), 0.0);
  float patchv = smoothstep(0.3, 0.75, pm.a) * (0.45 + 0.55 * pm.g);
  float clear = smoothstep(220.0, 700.0, length(w.xz));
  float thick = aDet.z * patchv * clear;
  float vm = 1.0 - exp(-thick * uValley * (0.5 + 0.5 / (0.25 + abs(rd.y))));
  float mu = max(dot(rd, uMoonDir), 0.0);
  vec3 mc = uMistCol * (0.8 + 0.8 * mu * mu);
  float fmul = fm * (1.0 - vm);
  vec3 add = fa + mc * vm * fm;
  if (uBeam > 0.0) {
    // light from the beam spills onto the ground around the dish, and the
    // shockwave rolls over the canopy
    float r = length(w.xz);
    vec3 lb = normalize(vec3(-w.x, 80.0, -w.z));
    add += uVeg * alb * uBeamCol * min(uBeam, 1.0) * 0.28 / (1.0 + r * r / 7000.0) * max(0.2 + 0.8 * dot(normal, lb), 0.0) * fmul;
    float rs = 150.0 + uShock * 420.0;
    float x = (r - rs) / (40.0 + uShock * 25.0);
    add += uBeamCol * exp(-x * x) * exp(-uShock * 1.5) * 0.05 * fmul;
  }
  vL = vec3(alb * 1.55 * fmul, alb * (0.5 + 0.5 * normal.y) * 1.8 * fmul, dot(normal, uMoonDir) + aClump.y * (1.0 - aDet.w));
  vA = vec4(w.xz * 0.005, lod, 1.0 - aDet.w);
  vFogAdd = add;
}`,
      fragmentShader: /* glsl */`
${COMMON}
uniform sampler2D uCanopy;
uniform vec3 uVeg;
varying vec4 vA;
varying vec3 vL;
varying vec3 vFogAdd;
void main() {
  // tree crowns (~8 m): sharp texture up close, a blurred copy further
  // out, their average beyond that
  float midF = smoothstep(0.3, 1.6, vA.z), farF = smoothstep(1.8, 3.6, vA.z);
  float crownH = 0.62, delta = 0.0;
  if (farF < 1.0) {
    vec4 ca = textureLod(uCanopy, vA.xy, 0.0);
    vec2 cr = mix(ca.rg, ca.ba, midF);
    crownH = mix(cr.x, 0.62, farF);
    delta = (cr.y - 0.5) * 2.2 * (1.0 - farF) * vA.w;
  }
  float lit = clamp(vL.z + delta, 0.0, 1.3);
  float ao = 0.4 + 0.6 * crownH;
  vec3 col = uVeg * ao * (uMoonCol * (vL.x * lit) + uAmb * vL.y);
  gl_FragColor = vec4(col + vFogAdd, 1.0);
}`,
    });

    // chunks: radial bands x angular sectors, so three.js can frustum-cull
    // them and draw them front to back (early depth rejection)
    const ringAt = r => Math.round((NR - 1) * Math.log(r / r0) / Math.log(r1 / r0));
    const bands = [0, ringAt(420), ringAt(900), ringAt(2000), ringAt(4500), NR - 1];
    const NSEC = 16, SC = NA / NSEC;
    for (let b = 0; b < bands.length - 1; b++) {
      const i0 = bands[b], i1 = bands[b + 1];
      for (let s = 0; s < NSEC; s++) {
        const rows = i1 - i0 + 1, cols = SC + 1;
        const p = new Float32Array(rows * cols * 3), nn = new Float32Array(rows * cols * 3), dd = new Float32Array(rows * cols * 4), cc = new Float32Array(rows * cols * 2);
        let cx = 0, cy = 0, cz = 0;
        for (let i = 0; i < rows; i++) for (let j = 0; j < cols; j++) {
          const src = (i0 + i) * NA + (s * SC + j) % NA, dst = i * cols + j;
          for (let c = 0; c < 3; c++) { p[dst * 3 + c] = pos[src * 3 + c]; nn[dst * 3 + c] = nrm[src * 3 + c]; }
          for (let c = 0; c < 4; c++) dd[dst * 4 + c] = det[src * 4 + c];
          cc[dst * 2] = clump[src * 2]; cc[dst * 2 + 1] = clump[src * 2 + 1];
          cx += p[dst * 3]; cy += p[dst * 3 + 1]; cz += p[dst * 3 + 2];
        }
        const nv = rows * cols;
        cx /= nv; cy /= nv; cz /= nv;
        for (let v = 0; v < nv; v++) { p[v * 3] -= cx; p[v * 3 + 1] -= cy; p[v * 3 + 2] -= cz; }
        const ind = [];
        for (let i = 0; i < rows - 1; i++) for (let j = 0; j < cols - 1; j++) {
          const a = i * cols + j, bb = a + 1, c = a + cols, d = c + 1;
          ind.push(a, bb, c, bb, d, c);
        }
        const geo = new THREE.BufferGeometry();
        geo.setAttribute('position', new THREE.BufferAttribute(p, 3));
        geo.setAttribute('normal', new THREE.BufferAttribute(nn, 3));
        geo.setAttribute('aDet', new THREE.BufferAttribute(dd, 4));
        geo.setAttribute('aClump', new THREE.BufferAttribute(cc, 2));
        geo.setIndex(ind);
        geo.computeBoundingSphere();
        const m = new THREE.Mesh(geo, terrainMat);
        m.position.set(cx, cy, cz);
        terrain.add(m);
      }
    }
  }

  // -------------------------------------------------------------------------
  // sky: gradient, moon, Milky Way glow; stars, Milky Way points, the cluster
  // -------------------------------------------------------------------------
  const sky = new THREE.Group();
  scene3.add(sky);
  const GAL_N = new THREE.Vector3(0.42, 0.20, 0.89).normalize();          // galactic pole
  const GAL_C = new THREE.Vector3().crossVectors(GAL_N, new THREE.Vector3(0, 1, 0)).normalize()
    .applyAxisAngle(GAL_N, -0.5);                                         // galactic centre direction
  const GAL_B = new THREE.Vector3().crossVectors(GAL_N, GAL_C).normalize();
  {
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...C, uGalN: { value: GAL_N }, uGalC: { value: GAL_C }, uGalB: { value: GAL_B }, uMW: { value: new THREE.Vector3(0.035, 0.042, 0.06) } },
      vertexShader: /* glsl */`
varying vec3 vDir;
void main() {
  vDir = position;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`,
      fragmentShader: /* glsl */`
${COMMON}
uniform vec3 uGalN, uGalC, uGalB, uMW;
varying vec3 vDir;
void main() {
  vec3 rd = normalize(vDir);
  vec3 c = skyColor(rd);
  float up = smoothstep(-0.02, 0.35, rd.y);
  // Milky Way glow with dust lanes (galactic lon/lat into the noise texture)
  float gl = dot(rd, uGalN);
  float band = exp(-gl * gl / 0.03);
  if (band > 0.01) {
    float lon = atan(dot(rd, uGalB), dot(rd, uGalC)) / 6.2831853;
    vec4 n = textureLod(uNoise, vec2(lon * 2.0, gl * 1.3), 0.0);
    vec4 n2 = textureLod(uNoise, vec2(lon * 6.0, gl * 4.0 + 0.3), 0.0);
    float cl = n.a * 0.6 + n2.r * 0.4;
    float lane = 1.0 - 0.8 * exp(-pow((gl - 0.015 + 0.04 * (n.g - 0.5)) / 0.03, 2.0)) * smoothstep(0.35, 0.6, n2.g);
    float core = 0.5 + 1.2 * pow(max(dot(rd, uGalC), 0.0), 4.0);
    c += uMW * band * (0.15 + 1.6 * cl * cl) * lane * core * up;
  }
  // globular cluster glow at the zenith, where the beam points
  float z2 = dot(rd.xz, rd.xz);
  if (rd.y > 0.0) c += vec3(0.045, 0.05, 0.055) * exp(-z2 / 0.00010) + vec3(0.010, 0.012, 0.018) * exp(-z2 / 0.0010);
  // the moon
  float md = dot(rd, uMoonDir);
  if (md > 0.9999) {
    float disc = smoothstep(cos(0.0118), cos(0.0110), md);
    vec3 t1 = normalize(cross(uMoonDir, vec3(0.0, 1.0, 0.0)));
    vec3 t2 = cross(t1, uMoonDir);
    vec2 q = vec2(dot(rd, t1), dot(rd, t2)) / 0.0118;
    float mar = textureLod(uNoise, q * 0.18 + 0.3, 0.0).a;
    float limb = sqrt(max(1.0 - dot(q, q), 0.0));
    vec3 moon = vec3(2.3, 2.35, 2.5) * (0.7 + 0.3 * smoothstep(0.35, 0.7, mar)) * (0.72 + 0.28 * limb);
    c = mix(c, moon, disc);
  }
  gl_FragColor = vec4(c, 1.0);
}`,
      side: THREE.BackSide, depthWrite: false, depthTest: true,
    });
    const m = new THREE.Mesh(new THREE.SphereGeometry(30000, 48, 24), mat);
    m.renderOrder = 10;   // after the opaque scene: only uncovered pixels are shaded
    m.frustumCulled = false;
    m.name = 'skydome';
    sky.add(m);
  }
  {
    // stars + Milky Way + globular cluster as one Points cloud
    const rnd = U.mulberry32(1974);
    const P = [], S = [], Col = [];
    const R = 26000;
    const v = new THREE.Vector3();
    const tint = () => {
      const k = rnd();
      if (k < 0.12) return [1.0, 0.78, 0.58];
      if (k < 0.35) return [1.0, 0.93, 0.82];
      if (k < 0.75) return [0.9, 0.94, 1.0];
      return [0.75, 0.85, 1.0];
    };
    const push = (dir, size, b, t) => {
      P.push(dir.x * R, dir.y * R, dir.z * R);
      S.push(size);
      Col.push(t[0] * b, t[1] * b, t[2] * b);
    };
    for (let i = 0; i < 8000; i++) {
      const y = -0.1 + 1.1 * rnd(), a = rnd() * Math.PI * 2, s = Math.sqrt(1 - y * y);
      v.set(s * Math.cos(a), y, s * Math.sin(a));
      const b = 0.06 + 0.3 * Math.pow(rnd(), 6) + 2.2 * Math.pow(rnd(), 40);
      push(v, 2.4 + 1.8 * Math.sqrt(b / 2.5), b, tint());
    }
    for (let i = 0; i < 30000; i++) {
      // Milky Way: latitude gaussian around the galactic plane, clumpy
      const lon = rnd() * Math.PI * 2;
      const lat = U.gauss(rnd) * 0.085 * (0.6 + 0.8 * rnd());
      v.copy(GAL_C).multiplyScalar(Math.cos(lon) * Math.cos(lat))
        .addScaledVector(GAL_B, Math.sin(lon) * Math.cos(lat)).addScaledVector(GAL_N, Math.sin(lat));
      if (v.y < -0.1) continue;
      const clump = U.fbm3(v.x * 4 + 9, v.y * 4, v.z * 4, 4);
      if (rnd() > Math.pow(clump, 2.2) * 2.2) continue;
      push(v, 2.2, 0.06 + 0.14 * Math.pow(rnd(), 3), tint());
    }
    for (let i = 0; i < 1400; i++) {
      // globular cluster at the zenith (the beam's vanishing point)
      const rr = 0.001 + 0.013 * Math.pow(rnd(), 1.8);
      const a = rnd() * Math.PI * 2;
      v.set(Math.sin(rr) * Math.cos(a), Math.cos(rr), Math.sin(rr) * Math.sin(a));
      push(v, 2.2, 0.06 + 0.25 * Math.pow(rnd(), 4), [1.0, 0.95, 0.85]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(S, 1));
    geo.setAttribute('aCol', new THREE.Float32BufferAttribute(Col, 3));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: C.uTime },
      vertexShader: /* glsl */`
uniform float uTime;
attribute float aSize;
attribute vec3 aCol;
varying vec3 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float ext = smoothstep(-0.03, 0.3, position.y / 26000.0);
  float tw = 0.82 + 0.18 * sin(uTime * (3.0 + fract(position.x * 0.013) * 5.0) + position.z * 0.01);
  vC = aCol * ext * tw;
  gl_PointSize = aSize;
}`,
      fragmentShader: /* glsl */`
varying vec3 vC;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  gl_FragColor = vec4(vC * exp(-dot(q, q) * 18.0), 1.0);
}`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = -5;
    pts.name = 'stars';
    sky.add(pts);
  }

  // -------------------------------------------------------------------------
  // the dish: spherical reflector of aluminium panels
  // -------------------------------------------------------------------------
  {
    const NR = 90, NA = 240;
    const pos = [], idx = [];
    pos.push(0, DISH_BOTTOM, 0);
    for (let i = 1; i <= NR; i++) {
      const r = DISH_A * i / NR;
      for (let j = 0; j < NA; j++) {
        const a = j / NA * Math.PI * 2;
        pos.push(r * Math.cos(a), dishY(r), r * Math.sin(a));
      }
    }
    for (let j = 0; j < NA; j++) idx.push(0, 1 + (j + 1) % NA, 1 + j);
    for (let i = 1; i < NR; i++) for (let j = 0; j < NA; j++) {
      const a = 1 + (i - 1) * NA + j, b = 1 + (i - 1) * NA + (j + 1) % NA;
      const c = 1 + i * NA + j, d = 1 + i * NA + (j + 1) % NA;
      idx.push(a, b, c, b, d, c);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...C, uPowerR: C.uPowerR },
      vertexShader: VS_WORLD,
      fragmentShader: /* glsl */`
${COMMON}
uniform float uPowerR;
varying vec3 vWorld;
varying vec3 vNormal;
float h21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
void main() {
  vec3 N = normalize(vec3(0.0, ${DISH_CY.toFixed(2)}, 0.0) - vWorld);
  float rho = length(vWorld.xz);
  // panels: a 5 m grid, each panel slightly tilted and tinted
  vec2 g = vWorld.xz / 5.0;
  vec2 cell = floor(g);
  float hp = h21(cell), hq = h21(cell + 17.3);
  vec3 vv = vWorld - uCamPos;
  float dist = length(vv);
  float cosv = max(abs(dot(vv / dist, N)), 0.06);
  vec2 fw = vec2(dist * ${(1 / PX_SCALE).toFixed(7)} / 5.0 / sqrt(cosv));
  vec2 dl = abs(fract(g) - 0.5);
  vec2 lc = clamp((dl - 0.47) / max(fw, 1e-4) + 0.5, 0.0, 1.0);
  float line = max(lc.x, lc.y);
  float far = smoothstep(0.12, 0.4, max(fw.x, fw.y));
  line = mix(line, 0.1, far);
  float var = mix(hp, 0.5, far);
  vec3 Np = normalize(N + 0.05 * vec3(hp - 0.5, 0.0, hq - 0.5) * (1.0 - far));
  vec3 rd = vv / dist;
  vec3 R = reflect(rd, Np);
  float ndl = max(dot(N, uMoonDir), 0.0);
  vec3 alb = vec3(0.075, 0.08, 0.088) * (0.8 + 0.4 * var);
  vec3 col = alb * (uMoonCol * ndl * 1.3 + uAmb * 2.0);
  // the dish is a dim mirror of the sky; the moon smears across the panels
  float mr = max(dot(R, uMoonDir), 0.0);
  float mr2 = mr * mr, mr4 = mr2 * mr2, mr16 = mr4 * mr4; mr16 *= mr16;
  col += skyColor(R) * 0.3 + uMoonCol * (0.10 * mr16 + 0.5 * pow(mr, 250.0)) * (0.6 + 0.8 * mix(hq, 0.5, far));
  col *= 1.0 - 0.5 * line;
  // transmitter power-up: a faint sheen with slow rings flowing outward
  float ripple = 0.6 + 0.4 * sin(rho * 0.09 - uTime * 3.0);
  float wake = smoothstep(uPowerR, uPowerR - 30.0, rho);   // the sheen spreads out from the centre
  vec3 energy = uBeamCol * uPower * wake * (0.025 + 0.08 * exp(-rho / 55.0)) * ripple;
  energy += uBeamCol * uPower * wake * line * 0.05 * (1.0 - far);
  // beam base
  energy += uBeamCol * uBeam * (0.05 * exp(-rho / 45.0) + 0.3 * exp(-rho * rho / 150.0));
  // transmit shockwave across the reflector
  if (uShock > 0.0) {
    float rs = ${DISH_A.toFixed(2)} * (1.0 - pow(1.0 - clamp(uShock / 1.3, 0.0, 1.0), 2.5));
    float x = (rho - rs) / 6.0;
    float wv = exp(-x * x) * (1.0 - smoothstep(0.9, 1.5, uShock));
    float trail = smoothstep(rs, rs - 60.0, rho) * exp(-uShock * 2.0);
    energy += uBeamCol * (2.2 * wv + 0.18 * trail) * (0.6 + 0.4 * line);
  }
  col += energy;
  col = applyAtmos(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}`,
    });
    const _m = new THREE.Mesh(geo, mat); _m.name = 'dish'; _m.renderOrder = -2; scene3.add(_m);
  }

  // -------------------------------------------------------------------------
  // structures: towers, rim wall, platform truss, azimuth arm, dome, feed
  // -------------------------------------------------------------------------
  const CONCRETE = [0.105, 0.105, 0.10], STEEL = [0.09, 0.095, 0.105], DOME = [0.30, 0.31, 0.32];
  const parts = [];
  const up = new THREE.Vector3(0, 1, 0);
  function colored(geo, col, kind) {
    geo = geo.index ? geo.toNonIndexed() : geo;
    geo.deleteAttribute('uv');
    const n = geo.attributes.position.count;
    const c = new Float32Array(n * 3), k = new Float32Array(n);
    for (let i = 0; i < n; i++) { c[i * 3] = col[0]; c[i * 3 + 1] = col[1]; c[i * 3 + 2] = col[2]; k[i] = kind; }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    geo.setAttribute('aKind', new THREE.BufferAttribute(k, 1));
    return geo;
  }
  function beam(a, b, w, col = STEEL, d = w) {
    const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
    const len = A.distanceTo(B);
    const g = new THREE.BoxGeometry(w, len, d);
    const q = new THREE.Quaternion().setFromUnitVectors(up, B.clone().sub(A).normalize());
    g.applyQuaternion(q);
    const m = A.clone().add(B).multiplyScalar(0.5);
    g.translate(m.x, m.y, m.z);
    parts.push(colored(g, col, 0));
  }
  const towerInfo = [];
  for (const T of TW) {
    // stand on the lowest point of the footprint
    let g = height(T.x, T.z);
    for (let i = 0; i < 9; i++) g = Math.min(g, height(T.x + 8 * Math.cos(i), T.z + 8 * Math.sin(i)));
    const base = g - 6, hgt = TOWER_TOP - base;
    const rot = -T.a + Math.PI / 4;
    const shaft = new THREE.CylinderGeometry(5.0, 9.5, hgt, 4, 1, false);
    shaft.rotateY(rot);
    shaft.translate(T.x, base + hgt / 2, T.z);
    parts.push(colored(shaft, CONCRETE, 1));
    for (let k = 1; k <= 4; k++) {
      const y = base + 6 + (TOWER_TOP - 10 - base - 6) * k / 4.6;
      const f = (y - base) / hgt;
      const rr = U.lerp(9.5, 5.0, f) + 0.9;
      const band = new THREE.CylinderGeometry(rr, rr, 2.2, 4, 1, false);
      band.rotateY(rot);
      band.translate(T.x, y, T.z);
      parts.push(colored(band, CONCRETE, 1));
    }
    const cap = new THREE.CylinderGeometry(7.4, 6.4, 6, 4, 1, false);
    cap.rotateY(rot);
    cap.translate(T.x, TOWER_TOP - 1, T.z);
    parts.push(colored(cap, CONCRETE, 1));
    // cable saddle on top
    const ca = Math.cos(T.a), sa = Math.sin(T.a);
    beam([T.x - ca * 5, TOWER_TOP + 2.5, T.z - sa * 5], [T.x + ca * 5, TOWER_TOP + 2.5, T.z + sa * 5], 3.4, STEEL, 5.0);
    towerInfo.push({ ...T, base, g });
  }
  {
    // rim wall
    const wall = new THREE.CylinderGeometry(DISH_A + 1.2, DISH_A + 1.2, 3.0, 240, 1, true);
    wall.translate(0, -0.8, 0);
    parts.push(colored(wall, CONCRETE, 1));
    const lip = new THREE.RingGeometry(DISH_A - 0.3, DISH_A + 1.4, 240, 1);
    lip.rotateX(-Math.PI / 2);
    lip.translate(0, 0.7, 0);
    parts.push(colored(lip, CONCRETE, 1));
  }
  // platform: triangular truss
  const corner = TOWER_AZ.map(a => [PLAT_RC * Math.cos(a), PLAT_RC * Math.sin(a)]);
  for (let s = 0; s < 3; s++) {
    const [ax, az] = corner[s], [bx, bz] = corner[(s + 1) % 3];
    beam([ax, PLAT_Y0, az], [bx, PLAT_Y0, bz], 1.8);
    beam([ax, PLAT_Y1, az], [bx, PLAT_Y1, bz], 1.8);
    const NS = 8;
    for (let k = 0; k <= NS; k++) {
      const f = k / NS, x = U.lerp(ax, bx, f), z = U.lerp(az, bz, f);
      beam([x, PLAT_Y0, z], [x, PLAT_Y1, z], 0.9);
      if (k < NS) {
        const f2 = (k + 1) / NS, x2 = U.lerp(ax, bx, f2), z2 = U.lerp(az, bz, f2);
        if (k % 2) beam([x, PLAT_Y0, z], [x2, PLAT_Y1, z2], 0.7); else beam([x, PLAT_Y1, z], [x2, PLAT_Y0, z2], 0.7);
      }
    }
    // inner bracing to the centre
    beam([ax, PLAT_Y1, az], [0, PLAT_Y1, 0], 1.1);
    beam([ax, PLAT_Y0, az], [ax * 0.45, PLAT_Y0 - 3, az * 0.45], 1.1);
    // corner towers of the platform
    beam([ax, PLAT_Y0 - 3, az], [ax, PLAT_Y1 + 4, az], 4.5, STEEL, 4.5);
  }
  let DOME_POS;
  {
    // circular track under the triangle
    const NT = 40, RT = 17, YT = PLAT_Y0 - 3.5;
    for (let k = 0; k < NT; k++) {
      const a0 = k / NT * Math.PI * 2, a1 = (k + 1) / NT * Math.PI * 2;
      beam([RT * Math.cos(a0), YT, RT * Math.sin(a0)], [RT * Math.cos(a1), YT, RT * Math.sin(a1)], 1.5);
    }
    // the azimuth arm: a bow-shaped truss along the focal arc
    const ax = Math.cos(ARM_AZ), az = Math.sin(ARM_AZ);
    const px = -az, pz = ax;               // across the arm
    const NA = 16, SPAN = 46, DEPTH = 8, HALF = 3.2;
    const P = (x, y, side) => [ax * x + px * side, y, az * x + pz * side];
    for (let k = 0; k <= NA; k++) {
      const x = -SPAN + 2 * SPAN * k / NA;
      const yb = focalY(x) + 2.0, yt = yb + DEPTH;
      for (const s of [-HALF, HALF]) beam(P(x, yb, s), P(x, yt, s), 0.7);
      beam(P(x, yb, -HALF), P(x, yb, HALF), 0.6);
      beam(P(x, yt, -HALF), P(x, yt, HALF), 0.6);
      if (k < NA) {
        const x2 = -SPAN + 2 * SPAN * (k + 1) / NA;
        const yb2 = focalY(x2) + 2.0, yt2 = yb2 + DEPTH;
        for (const s of [-HALF, HALF]) {
          beam(P(x, yb, s), P(x2, yb2, s), 1.3);
          beam(P(x, yt, s), P(x2, yt2, s), 1.3);
          if (k % 2) beam(P(x, yb, s), P(x2, yt2, s), 0.5); else beam(P(x, yt, s), P(x2, yb2, s), 0.5);
        }
      }
    }
    // hangers from the track down to the arm
    for (const x of [-12, 0, 12]) for (const s of [-HALF, HALF]) beam(P(x, focalY(x) + 2 + DEPTH, s), P(x * 1.1, YT, s * 1.4), 1.0);
    // Gregorian dome on one end, line feed on the other
    const dx = 22, dyTop = focalY(dx) + 2.0;
    const dome = new THREE.SphereGeometry(10.5, 36, 20);
    dome.scale(1, 0.92, 1);
    dome.translate(ax * dx, dyTop - 11.5, az * dx);
    parts.push(colored(dome, DOME, 2));
    const collar = new THREE.CylinderGeometry(6.5, 7.5, 3.0, 24);
    collar.translate(ax * dx, dyTop - 1.5, az * dx);
    parts.push(colored(collar, STEEL, 0));
    const fx = -24, fy = focalY(fx) + 2.0;
    const top = new THREE.Vector3(ax * fx, fy, az * fx);
    const dir = top.clone().sub(new THREE.Vector3(0, DISH_CY, 0)).normalize();
    const feed = new THREE.CylinderGeometry(1.4, 0.35, 29, 12);
    feed.translate(0, -14.5, 0);
    feed.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, -1, 0), dir));
    feed.translate(top.x, top.y, top.z);
    parts.push(colored(feed, STEEL, 0));
    DOME_POS = new THREE.Vector3(ax * dx, dyTop - 11.5, az * dx);
  }
  {
    const geo = mergeGeometries(parts, false);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...C, uDomePos: { value: DOME_POS }, uRedPos: { value: towerInfo.map(T => new THREE.Vector3(T.x, TOWER_TOP + 5, T.z)) } },
      vertexShader: /* glsl */`
attribute vec3 color;
attribute float aKind;
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vCol;
varying float vKind;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  vNormal = normalize(mat3(modelMatrix) * normal);
  vCol = color;
  vKind = aKind;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
      fragmentShader: /* glsl */`
${COMMON}
uniform vec3 uDomePos;
uniform vec3 uRedPos[3];
varying vec3 vWorld;
varying vec3 vNormal;
varying vec3 vCol;
varying float vKind;
void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(uCamPos - vWorld);
  vec3 alb = vCol;
  if (vKind > 0.5 && vKind < 1.5) {
    // weathered concrete: vertical rain streaks and blotches
    float s = textureLod(uNoise, vec2((vWorld.x + vWorld.z) * 0.02, vWorld.y * 0.002), 1.0).g * 0.6
            + textureLod(uNoise, vec2(vWorld.x - vWorld.z, vWorld.y) * 0.006, 1.0).a * 0.4;
    alb *= (0.6 + 0.8 * s) * (0.55 + 0.45 * smoothstep(-10.0, 120.0, vWorld.y));
  }
  float ndl = max(dot(N, uMoonDir), 0.0);
  vec3 col = alb * (uMoonCol * ndl * 1.25 + uAmb * (1.4 + 0.8 * N.y));
  // cool sky rim on silhouettes
  float fr = 1.0 - max(dot(N, V), 0.0);
  fr = fr * fr * fr;
  col += fr * (uHorizon * 1.4 + uMoonCol * 0.04 * max(dot(N, uMoonDir) + 0.4, 0.0));
  // steel catches a moon glint
  if (vKind < 0.5 || vKind > 1.5) {
    vec3 Hv = normalize(uMoonDir + V);
    col += uMoonCol * pow(max(dot(N, Hv), 0.0), 40.0) * 0.2;
  }
  // light from the beam column
  vec2 toA = -vWorld.xz;
  float da = length(toA);
  vec3 Lb = vec3(toA.x, 0.0, toA.y) / max(da, 1e-3);
  float above = smoothstep(-50.0, -20.0, vWorld.y);
  col += alb * uBeamCol * min(uBeam, 1.3) * above * 2.2 / (1.0 + da * da / 1600.0) * max(0.25 + 0.75 * dot(N, Lb), 0.0);
  // work lights on the platform and around the dome
  vec3 l1 = vec3(0.0, ${(PLAT_Y0 - 6).toFixed(1)}, 0.0) - vWorld; float d1 = length(l1);
  col += alb * vec3(1.0, 0.82, 0.6) * uWork * 1.3 / (1.0 + d1 * d1 / 700.0) * max(0.2 + 0.8 * dot(N, l1 / d1), 0.0);
  vec3 l2 = (uDomePos + vec3(0.0, -16.0, 0.0)) - vWorld; float d2 = length(l2);
  col += alb * vec3(1.0, 0.86, 0.66) * uWork * 1.5 / (1.0 + d2 * d2 / 200.0) * max(0.1 + 0.9 * dot(N, l2 / d2), 0.0);
  // red beacons tint the tower tops
  for (int i = 0; i < 3; i++) {
    vec3 l = uRedPos[i] - vWorld; float d = length(l);
    col += alb * vec3(1.0, 0.08, 0.04) * uRed * 3.0 / (1.0 + d * d / 25.0) * max(0.3 + 0.7 * dot(N, l / d), 0.0);
  }
  col = applyAtmos(col, vWorld);
  gl_FragColor = vec4(col, 1.0);
}`,
    });
    const _m = new THREE.Mesh(geo, mat); _m.name = 'struct'; _m.renderOrder = -3; scene3.add(_m);
  }

  // -------------------------------------------------------------------------
  // cables: screen-space ribbons with analytic anti-aliasing and hair shading
  // -------------------------------------------------------------------------
  {
    const cp = [], ct = [], cs = [], cw = [], ci = [];
    let base = 0;
    function cable(a, b, sag, width, n = 40) {
      const A = new THREE.Vector3(...a), B = new THREE.Vector3(...b);
      const pts = [];
      for (let i = 0; i <= n; i++) {
        const f = i / n;
        pts.push(A.clone().lerp(B, f).add(new THREE.Vector3(0, -4 * sag * f * (1 - f), 0)));
      }
      for (let i = 0; i <= n; i++) {
        const t = pts[Math.min(i + 1, n)].clone().sub(pts[Math.max(i - 1, 0)]).normalize();
        for (const s of [-1, 1]) {
          cp.push(pts[i].x, pts[i].y, pts[i].z);
          ct.push(t.x, t.y, t.z);
          cs.push(s);
          cw.push(width);
        }
        if (i < n) {
          const k = base + i * 2;
          ci.push(k, k + 1, k + 2, k + 1, k + 3, k + 2);
        }
      }
      base += (n + 1) * 2;
    }
    towerInfo.forEach((T, i) => {
      const ca = Math.cos(T.a), sa = Math.sin(T.a), px = -sa, pz = ca;
      const [cx, cz] = corner[i];
      // main cables: tower saddle -> platform corner
      for (const o of [-1.5, -0.5, 0.5, 1.5]) {
        cable([T.x - ca * 4 + px * o * 1.2, TOWER_TOP + 3.2, T.z - sa * 4 + pz * o * 1.2],
          [cx + ca * 1.5 + px * o * 0.8, PLAT_Y1 + 2.5, cz + sa * 1.5 + pz * o * 0.8], 3.2, 0.34);
      }
      // backstays: tower top -> ground anchors behind the tower
      for (const off of [-0.34, -0.13, 0.13, 0.34]) {
        const aa = T.a + off, rr = TOWER_R + 120;
        const x = rr * Math.cos(aa), z = rr * Math.sin(aa);
        cable([T.x + ca * 4, TOWER_TOP + 3.2, T.z + sa * 4], [x, height(x, z) + 1, z], 1.6, 0.3);
      }
      // tie-downs: platform corner -> anchors below the reflector
      for (const o of [-1.2, 1.2]) {
        cable([cx + px * o, PLAT_Y0 - 3, cz + pz * o], [cx * 1.05 + px * o * 2, dishY(PLAT_RC) - 3, cz * 1.05 + pz * o * 2], 0, 0.22, 16);
      }
    });
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(cp, 3));
    geo.setAttribute('aTan', new THREE.Float32BufferAttribute(ct, 3));
    geo.setAttribute('aSide', new THREE.Float32BufferAttribute(cs, 1));
    geo.setAttribute('aWidth', new THREE.Float32BufferAttribute(cw, 1));
    geo.setIndex(ci);
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...C, uRes: { value: new THREE.Vector2(W, H) } },
      vertexShader: /* glsl */`
${COMMON}
uniform vec2 uRes;
attribute vec3 aTan;
attribute float aSide;
attribute float aWidth;
varying float vPx;
varying float vHalf;
varying float vCov;
varying vec3 vCol;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  vec4 c0 = projectionMatrix * mv;
  vec4 c1 = projectionMatrix * (modelViewMatrix * vec4(position + aTan * 2.0, 1.0));
  vec2 s0 = c0.xy / c0.w * uRes * 0.5, s1 = c1.xy / c1.w * uRes * 0.5;
  vec2 dir = s1 - s0;
  dir = length(dir) > 1e-4 ? normalize(dir) : vec2(1.0, 0.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  float wpx = aWidth * projectionMatrix[1][1] * uRes.y * 0.5 / max(-mv.z, 0.1);
  float draw = max(wpx, 1.3);
  vCov = wpx / draw;
  vHalf = draw * 0.5;
  vPx = aSide * (vHalf + 1.0);
  c0.xy += nrm * vPx / (uRes * 0.5) * c0.w;
  gl_Position = c0;
  // shade per vertex: hair-style moon highlight, beam and work light
  vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
  vec3 V = normalize(uCamPos - wp);
  float tl = dot(aTan, uMoonDir), tv = dot(aTan, V);
  float diff = sqrt(max(1.0 - tl * tl, 0.0));
  float spec = pow(max(tl * tv + diff * sqrt(max(1.0 - tv * tv, 0.0)), 0.0), 60.0);
  vec3 col = vec3(0.07) * (uMoonCol * diff * 0.8 + uAmb * 2.0) + uMoonCol * spec * 0.5;
  float da = length(wp.xz);
  col += uBeamCol * uBeam * 0.3 / (1.0 + da * da / 3600.0);
  vec3 lw = wp - vec3(0.0, 110.0, 0.0);
  col += vec3(1.0, 0.8, 0.6) * uWork * 0.1 / (1.0 + dot(lw, lw) / 1600.0);
  vCol = applyAtmos(col, wp);
}`,
      fragmentShader: /* glsl */`
varying float vPx;
varying float vHalf;
varying float vCov;
varying vec3 vCol;
void main() {
  float a = clamp(vHalf + 0.5 - abs(vPx), 0.0, 1.0) * vCov;
  gl_FragColor = vec4(vCol, a);
}`,
      transparent: true, depthWrite: false, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = 2;
    m.name = 'cables';
    scene3.add(m);
  }

  // -------------------------------------------------------------------------
  // point lights: aviation beacons, platform work lights
  // -------------------------------------------------------------------------
  {
    const P = [], Col = [], Sz = [], K = [], Ph = [];
    const add = (p, col, size, kind, phase) => { P.push(...p); Col.push(...col); Sz.push(size); K.push(kind); Ph.push(phase); };
    towerInfo.forEach((T, i) => {
      add([T.x, TOWER_TOP + 5.5, T.z], [1.0, 0.1, 0.05], 7, 0, 0);
      add([T.x, U.lerp(T.base, TOWER_TOP, 0.55), T.z], [1.0, 0.1, 0.05], 5, 0, 0.0);
      const [cx, cz] = corner[i];
      add([cx, PLAT_Y1 + 5, cz], [1.0, 0.12, 0.05], 5, 0, 0);
    });
    const rnd = U.mulberry32(99);
    for (let s = 0; s < 3; s++) {
      const [ax, az] = corner[s], [bx, bz] = corner[(s + 1) % 3];
      for (const f of [0.0, 0.25, 0.5, 0.75]) add([U.lerp(ax, bx, f) * 1.02, PLAT_Y0 - 0.5, U.lerp(az, bz, f) * 1.02], [1.0, 0.86, 0.66], 4.5, 1, rnd());
    }
    const ax = Math.cos(ARM_AZ), az = Math.sin(ARM_AZ);
    for (const x of [-44, -30, -10, 10, 30, 44]) add([ax * x, focalY(x) + 1.5, az * x], [1.0, 0.9, 0.75], 2.6, 1, rnd());
    for (let k = 0; k < 6; k++) {
      const a = k / 6 * Math.PI * 2;
      add([DOME_POS.x + 9 * Math.cos(a), DOME_POS.y - 7.5, DOME_POS.z + 9 * Math.sin(a)], [1.0, 0.88, 0.7], 2.4, 1, rnd());
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(P, 3));
    geo.setAttribute('aCol', new THREE.Float32BufferAttribute(Col, 3));
    geo.setAttribute('aSize', new THREE.Float32BufferAttribute(Sz, 1));
    geo.setAttribute('aKind', new THREE.Float32BufferAttribute(K, 1));
    geo.setAttribute('aPhase', new THREE.Float32BufferAttribute(Ph, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { ...C, uPx: { value: PX_SCALE }, uTPow: { value: T_POWER } },
      vertexShader: /* glsl */`
uniform float uTime, uRed, uWork, uPx, uTPow;
attribute vec3 aCol;
attribute float aSize, aKind, aPhase;
varying vec3 vC;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  float I;
  if (aKind < 0.5) I = uRed * 7.0;
  else {
    float on = uTime - (uTPow + 0.25 + aPhase * 0.9);
    float flick = on < 0.0 ? 0.0 : (on < 0.35 ? step(0.45, fract(sin(floor(uTime * 24.0) * 12.9898 + aPhase * 78.233) * 43758.5453)) : 1.0);
    I = uWork * flick * 6.0;
  }
  float px = aSize * uPx / max(-mv.z, 1.0);
  float ps = clamp(px, 3.0, 64.0);
  I *= min(px * px / (ps * ps) * 4.0, 1.0);
  vC = aCol * I;
  gl_PointSize = ps;
}`,
      fragmentShader: /* glsl */`
varying vec3 vC;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r2 = dot(q, q) * 4.0;
  gl_FragColor = vec4(vC * (exp(-r2 * 10.0) + 0.25 * exp(-r2 * 3.0)), 1.0);
}`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 3;
    pts.name = 'lights';
    scene3.add(pts);
  }

  // -------------------------------------------------------------------------
  // the beam: an analytic glowing column (drawn on the back faces of a
  // cylinder so each pixel is shaded once)
  // -------------------------------------------------------------------------
  const BEAM_TOP = 40000;
  let beamMat;
  {
    const geo = new THREE.CylinderGeometry(BEAM_HALO, BEAM_HALO, BEAM_TOP - DISH_BOTTOM, 48, 1, true);
    geo.translate(0, (BEAM_TOP + DISH_BOTTOM) / 2, 0);
    beamMat = new THREE.ShaderMaterial({
      uniforms: { ...C, uFront: { value: 0 }, uPulseY: { value: -1e5 } },
      vertexShader: /* glsl */`
varying vec3 vWorld;
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vWorld = w.xyz;
  gl_Position = projectionMatrix * viewMatrix * w;
}`,
      fragmentShader: /* glsl */`
${COMMON}
uniform float uFront, uPulseY;
varying vec3 vWorld;
void main() {
  vec3 ro = uCamPos;
  vec3 rd = normalize(vWorld - ro);
  vec2 o = ro.xz, d = rd.xz;
  float dd = max(dot(d, d), 1e-6);
  float od = dot(o, d);
  float s = -od / dd;                         // closest approach to the axis
  float q = s > 0.0 ? sqrt(max(dot(o, o) - od * od / dd, 0.0)) : length(o);
  float sg = sign(o.x * d.y - o.y * d.x);
  float y = ro.y + rd.y * max(s, 0.0);
  float sinT = sqrt(dd);                      // sin of angle between ray and axis
  float qr = q / ${BEAM_R.toFixed(1)};
  float core = exp(-q * q / 12.0);            // thin bright carrier
  float col = exp(-qr * qr * 2.0);            // the column
  float halo = exp(-qr * 1.2) * (1.0 - smoothstep(${(BEAM_HALO * 0.55).toFixed(1)}, ${BEAM_HALO.toFixed(1)}, q));
  // energy rising through the column
  float n = textureLod(uNoise, vec2(sg * qr * 0.35 + 0.5, (y - uTime * 520.0) * 0.0009), 1.0).g;
  float n2 = textureLod(uNoise, vec2(sg * qr * 0.8, (y - uTime * 900.0) * 0.0023), 1.0).b;
  float I = core * 0.5 + col * (0.022 + 0.06 * n * n2 * 2.0) + halo * 0.008;
  // path length through the column grows as we look up it (capped)
  I *= min(1.0 / max(sinT, 1e-3), 2.0);
  float vert = smoothstep(${DISH_BOTTOM.toFixed(1)}, ${(DISH_BOTTOM + 25).toFixed(1)}, y) * (1.0 - smoothstep(uFront - 150.0 - 0.3 * (uFront - ${DISH_BOTTOM.toFixed(1)}), uFront, y));
  vert *= 0.5 + 0.5 * exp(-max(y, 0.0) / 1500.0);
  float py = (y - uPulseY) / (60.0 + 0.1 * (uPulseY - ${DISH_BOTTOM.toFixed(1)}));
  float pulse = exp(-py * py);
  vec3 c = uBeamCol * (I * vert * uBeam + pulse * (core + col * 0.3) * 1.2 * vert);
  gl_FragColor = vec4(c, 1.0);
}`,
      side: THREE.BackSide, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const m = new THREE.Mesh(geo, beamMat);
    m.frustumCulled = false;
    m.renderOrder = 4;
    m.name = 'beam';
    scene3.add(m);
  }

  // -------------------------------------------------------------------------
  // the 1,679 bits: heads (sprites) and trails (screen-space streaks)
  // -------------------------------------------------------------------------
  const BIT_GLSL = /* glsl */`
uniform float uTime, uPx;
const float T0 = ${T_TX0.toFixed(3)}, DUR = ${(T_TX1 - T_TX0).toFixed(3)}, NB = ${NB.toFixed(1)};
vec3 bitPos(float idx, float age) {
  float y = ${BIT_Y0.toFixed(2)} + ${BIT_V0.toFixed(2)} * age + 0.5 * ${BIT_ACC.toFixed(2)} * age * age;
  float ang = idx * 6.2831853 / 23.0 + floor(idx / 23.0) * 2.3999632 + age * 0.35;
  float rad = ${BIT_RH.toFixed(2)} * (1.0 - exp(-age * 6.0));
  return vec3(cos(ang) * rad, y, sin(ang) * rad);
}
float bitAge(float idx) { return uTime - (T0 + idx / NB * DUR); }
`;
  {
    const idx = new Float32Array(NB), bit = new Float32Array(NB), pos = new Float32Array(NB * 3);
    for (let i = 0; i < NB; i++) { idx[i] = i; bit[i] = BITS[i]; }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
    geo.setAttribute('aBit', new THREE.BufferAttribute(bit, 1));
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: C.uTime, uPx: { value: PX_SCALE } },
      vertexShader: /* glsl */`
${BIT_GLSL}
attribute float aIdx, aBit;
varying vec3 vC;
void main() {
  float age = bitAge(aIdx);
  if (age <= 0.0) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); gl_PointSize = 0.0; vC = vec3(0.0); return; }
  vec4 mv = modelViewMatrix * vec4(bitPos(aIdx, age), 1.0);
  gl_Position = projectionMatrix * mv;
  float w = aBit > 0.5 ? 4.0 : 2.0;
  float px = w * uPx / max(-mv.z, 1.0);
  float ps = clamp(px, 3.0, 40.0);
  float e = min(px * px / (ps * ps) * 3.0, 1.0);
  vec3 c = aBit > 0.5 ? vec3(0.85, 0.93, 1.0) * 2.8 : vec3(0.35, 0.55, 1.0) * 0.45;
  vC = c * e * smoothstep(0.05, 0.9, age);
  gl_PointSize = ps;
}`,
      fragmentShader: /* glsl */`
varying vec3 vC;
void main() {
  vec2 q = gl_PointCoord - 0.5;
  float r2 = dot(q, q) * 4.0;
  gl_FragColor = vec4(vC * (exp(-r2 * 9.0) + 0.12 * exp(-r2 * 2.5)), 1.0);
}`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });
    const pts = new THREE.Points(geo, mat);
    pts.frustumCulled = false;
    pts.renderOrder = 6;
    pts.name = 'bitheads';
    scene3.add(pts);
  }
  {
    const n = NB * 4;
    const idx = new Float32Array(n), bit = new Float32Array(n), end = new Float32Array(n), side = new Float32Array(n);
    const ind = [];
    for (let i = 0; i < NB; i++) {
      for (let k = 0; k < 4; k++) {
        const v = i * 4 + k;
        idx[v] = i; bit[v] = BITS[i]; end[v] = k >> 1; side[v] = (k & 1) ? 1 : -1;
      }
      const b = i * 4;
      ind.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(new Float32Array(n * 3), 3));
    geo.setAttribute('aIdx', new THREE.BufferAttribute(idx, 1));
    geo.setAttribute('aBit', new THREE.BufferAttribute(bit, 1));
    geo.setAttribute('aEnd', new THREE.BufferAttribute(end, 1));
    geo.setAttribute('aSide', new THREE.BufferAttribute(side, 1));
    geo.setIndex(ind);
    const mat = new THREE.ShaderMaterial({
      uniforms: { uTime: C.uTime, uPx: { value: PX_SCALE }, uRes: { value: new THREE.Vector2(W, H) } },
      vertexShader: /* glsl */`
${BIT_GLSL}
uniform vec2 uRes;
attribute float aIdx, aBit, aEnd, aSide;
varying vec3 vC;
varying float vU;
void main() {
  float age = bitAge(aIdx);
  vC = vec3(0.0); vU = 0.0;
  if (age <= 0.02) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  vec3 h = (modelViewMatrix * vec4(bitPos(aIdx, age), 1.0)).xyz;
  vec3 t = (modelViewMatrix * vec4(bitPos(aIdx, max(age - ${BIT_TRAIL.toFixed(3)}, 0.0)), 1.0)).xyz;
  // keep both ends in front of the camera
  float zn = -3.0;
  if (h.z > zn && t.z > zn) { gl_Position = vec4(0.0, 0.0, 2.0, 1.0); return; }
  if (t.z > zn) t = h + (t - h) * ((zn - h.z) / (t.z - h.z));
  if (h.z > zn) h = t + (h - t) * ((zn - t.z) / (h.z - t.z));
  vec4 ch = projectionMatrix * vec4(h, 1.0), ct = projectionMatrix * vec4(t, 1.0);
  vec2 sh = ch.xy / ch.w * uRes * 0.5, st = ct.xy / ct.w * uRes * 0.5;
  vec2 dir = sh - st;
  float len = length(dir);
  dir = len > 1e-3 ? dir / len : vec2(0.0, 1.0);
  vec2 nrm = vec2(-dir.y, dir.x);
  vec4 c = aEnd < 0.5 ? ch : ct;
  float w = aBit > 0.5 ? 1.2 : 0.6;
  float px = w * uPx / max(-(aEnd < 0.5 ? h.z : t.z), 1.0);
  float ps = clamp(px, 1.5, 7.0);
  c.xy += (nrm * aSide * ps + (aEnd < 0.5 ? dir * ps : vec2(0.0))) / (uRes * 0.5) * c.w;
  gl_Position = c;
  vec3 col = aBit > 0.5 ? vec3(0.7, 0.85, 1.0) * 0.8 : vec3(0.3, 0.5, 1.0) * 0.15;
  vC = col * min(px / ps, 1.0) * (aEnd < 0.5 ? 1.0 : 0.0) * smoothstep(0.1, 0.9, age);
  vU = aSide;
}`,
      fragmentShader: /* glsl */`
varying vec3 vC;
varying float vU;
void main() {
  float a = 1.0 - vU * vU;
  gl_FragColor = vec4(vC * a * a, 1.0);
}`,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    });
    const m = new THREE.Mesh(geo, mat);
    m.frustumCulled = false;
    m.renderOrder = 5;
    m.name = 'bittrails';
    scene3.add(m);
  }

  // -------------------------------------------------------------------------
  // camera: Hermite spline through keys (position, yaw, pitch), C1 in time
  // -------------------------------------------------------------------------
  const D2R = Math.PI / 180;
  const polar = (phi, r, y) => [r * Math.cos(phi * D2R), y, r * Math.sin(phi * D2R)];
  function yawPitchTo(p, target) {
    const dx = target[0] - p[0], dy = target[1] - p[1], dz = target[2] - p[2];
    const l = Math.hypot(dx, dy, dz);
    return [Math.atan2(-dx, -dz), Math.asin(dy / l)];
  }
  const KEYS = [];
  // key(t, azimuth, radius, height, look target | view azimuth, yaw offset,
  //     pitch offset, absolute pitch)
  function key(t, phi, r, y, look, dyaw = 0, dpitch = 0, pitchAbs = null) {
    const p = polar(phi, r, y);
    let [yaw, pitch] = Array.isArray(look) ? yawPitchTo(p, look) : [Math.atan2(-Math.cos(look * D2R), -Math.sin(look * D2R)), 0];
    yaw += dyaw * D2R; pitch += dpitch * D2R;
    if (pitchAbs !== null) pitch = pitchAbs * D2R;
    if (KEYS.length) {
      const prev = KEYS[KEYS.length - 1][4];
      while (yaw - prev > Math.PI) yaw -= 2 * Math.PI;
      while (yaw - prev < -Math.PI) yaw += 2 * Math.PI;
    }
    KEYS.push([t, ...p, yaw, pitch]);
  }
  key(9.0, 150, 1900, 560, 336, 0, 7);
  key(11.0, 155, 1640, 500, 338, 0, 3);
  key(12.8, 166, 1260, 400, [0, 0, 0], 5, 3);
  key(14.5, 184, 900, 305, [0, 40, 0], 4, 1);
  key(16.0, 204, 640, 245, [0, 50, 0], 3, 0);
  key(17.5, 222, 450, 215, [0, 35, 0], 2, 0);
  key(19.5, 240, 380, 235, [0, 40, 0], 0, 0, -26);
  key(22.0, 252, 300, 285, [0, 285, 0], 16, 0, 2);
  key(24.5, 264, 190, 385, [0, 385, 0], 24, 0, 46);
  key(27.0, 276, 80, 600, [0, 600, 0], 22, 0, 86);
  // natural cubic splines through the keys (C2: no kinks in speed), in time
  function naturalSpline(ts, ys) {
    const n = ts.length, h = [], al = [], l = [1], mu = [0], z = [0], c = new Array(n).fill(0), b = [], d = [];
    for (let i = 0; i < n - 1; i++) h[i] = ts[i + 1] - ts[i];
    for (let i = 1; i < n - 1; i++) al[i] = 3 / h[i] * (ys[i + 1] - ys[i]) - 3 / h[i - 1] * (ys[i] - ys[i - 1]);
    for (let i = 1; i < n - 1; i++) {
      l[i] = 2 * (ts[i + 1] - ts[i - 1]) - h[i - 1] * mu[i - 1];
      mu[i] = h[i] / l[i];
      z[i] = (al[i] - h[i - 1] * z[i - 1]) / l[i];
    }
    for (let j = n - 2; j >= 0; j--) {
      c[j] = z[j] - mu[j] * c[j + 1];
      b[j] = (ys[j + 1] - ys[j]) / h[j] - h[j] * (c[j + 1] + 2 * c[j]) / 3;
      d[j] = (c[j + 1] - c[j]) / (3 * h[j]);
    }
    return t => {
      t = U.clamp(t, ts[0], ts[n - 1]);
      let j = 0;
      while (j < n - 2 && t > ts[j + 1]) j++;
      const x = t - ts[j];
      return ys[j] + b[j] * x + c[j] * x * x + d[j] * x * x * x;
    };
  }
  const CAM = [1, 2, 3, 4, 5].map(c => naturalSpline(KEYS.map(k => k[0]), KEYS.map(k => k[c])));
  const camAt = t => CAM.map(f => f(t));
  // sanity: the camera must stay clear of the hills
  for (let t = 9; t <= 27; t += 0.25) {
    const [x, y, z] = camAt(t);
    const g = height(x, z);
    if (y - g < 25) console.warn(`valley: camera only ${(y - g).toFixed(1)} m above ground at t=${t}`);
  }

  // -------------------------------------------------------------------------
  // per-frame state
  // -------------------------------------------------------------------------
  function beamLevel(t) {
    if (t < T_TX0) return 0;
    const a = t - T_TX0;
    return U.smooth(0, 0.3, a) + 1.2 * Math.exp(-a * 3.0) * U.smooth(0, 0.05, a);
  }

  function update(t) {
    C.uTime.value = t;
    const [x, y, z, yaw, pitch] = camAt(t);
    cam.position.set(x, y, z);
    // a small jolt when the transmitter fires
    const sa = t - T_TX0;
    const jolt = sa > 0 ? 0.003 * Math.exp(-sa * 2.5) : 0;
    cam.rotation.set(pitch + jolt * Math.sin(t * 71.0) * Math.sin(t * 13.0), yaw + jolt * 0.7 * Math.sin(t * 57.0 + 1.3), jolt * 0.5 * Math.sin(t * 43.0));
    cam.updateMatrixWorld();
    C.uCamPos.value.copy(cam.position);
    sky.position.copy(cam.position);

    C.uPower.value = U.smooth(T_POWER, T_POWER + 2.2, t) * (1 - 0.6 * U.smooth(T_TX0 + 0.3, T_TX0 + 3, t));
    C.uWork.value = t >= T_POWER ? 1 : 0;
    C.uPowerR.value = 190 * U.easeOut(U.prog(t, T_POWER, T_POWER + 1.8));
    // aviation beacons: ~40 flashes a minute, soft incandescent ramp
    if (t >= T_POWER + 0.1) {
      const ph = ((t - T_POWER - 0.1) / 1.5) % 1;
      C.uRed.value = U.smooth(0, 0.06, ph) * (1 - U.smooth(0.32, 0.55, ph));
    } else C.uRed.value = 0;
    C.uBeam.value = beamLevel(t);
    C.uShock.value = t - T_TX0;
    // the column climbs out of the dish, accelerating away, a bright pulse at its head
    const front = DISH_BOTTOM + 1400 * sa + 2500 * sa * sa;
    beamMat.uniforms.uFront.value = t < T_TX0 ? -1e5 : front;
    beamMat.uniforms.uPulseY.value = t < T_TX0 ? -1e5 : front - 120;
  }

  function bloom(t) {
    const a = t - T_TX0;
    const kick = a > 0 ? 0.3 * Math.exp(-a * 1.5) : 0;
    return { strength: 0.65 + kick, radius: 0.32, threshold: 0.6 };
  }

  // keep the lower third calm while narration is up
  function overlay(t, g) {
    let a = 0;
    for (const cue of TL.text) {
      if (cue.slot !== 'lower' || cue.start > 27 || cue.hold_until < 9) continue;
      a = Math.max(a, U.window01(t, cue.start - 0.6, cue.hold_until + cue.fade + 0.4, 0.8, 0.8));
    }
    if (a <= 0) return;
    const gr = g.createLinearGradient(0, H, 0, H * 0.64);
    gr.addColorStop(0, `rgba(0,2,8,${0.45 * a})`);
    gr.addColorStop(0.5, `rgba(0,2,8,${0.22 * a})`);
    gr.addColorStop(1, 'rgba(0,2,8,0)');
    g.fillStyle = gr;
    g.fillRect(0, H * 0.64, W, H * 0.36);
  }

  return { scene: scene3, camera: cam, update, bloom, overlay };
}
