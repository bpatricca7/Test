// Terrain & rock shading: lunar photometry, baked Sun-horizon shadows, procedural micro-craters.
//
// Output is LINEAR RADIANCE in three.js light units (a white Lambertian facing the Sun at SUN.intensity
// would be SUN.intensity/pi); tone mapping/exposure happen in post.
//
// Photometry (lunar regolith is strongly backscattering, NOT Lambertian):
//   L = I/pi * A * f(alpha) * [ 2 Lw(alpha) mu0/(mu0+mu) + (1 - Lw(alpha)) mu0 ]      (Lunar-Lambert, McEwen 1991)
//   f(alpha): phase function incl. the opposition surge (shadow hiding + coherent backscatter), normalised
//   to 1 at alpha = 0: the bright halo around the antisolar point / the spacecraft's own shadow.
//   A: normal albedo from moon.js x fine-scale variation; mu0 = cos(incidence), mu = cos(emission).
//
// Sub-vertex detail: 3D cellular craters in bands of size (same statistics/morphology as moon.js),
// shaded with analytic normals and ANALYTIC IN-BOWL SHADOWS (the rim toward the Sun occludes the floor
// when its height over the floor exceeds distance * tan(sun elevation)) — the crisp black crater
// shadows of Apollo photography at every scale down to the pixel. Bands are enabled only where the
// mesh cannot resolve those sizes and faded by the pixel footprint (no aliasing).

import * as THREE from 'three';
import { SUN } from '../../core/constants.js';

/** Micro-crater bands: cell sizes shrink 2.4x from 48 km; each pixel evaluates up to 3 bands. */
export const BAND_COUNT = 16;
const BAND_CELL0 = 48000;
export const BAND_CELLS = (() => {
  const a = [];
  let c = BAND_CELL0;
  for (let i = 0; i < BAND_COUNT; i++) {
    a.push(c);
    c /= 2.4;
  }
  return a;
})();

// Shared GLSL: photometry + hash + micro-crater bands.
export const LUNAR_GLSL = /* glsl */ `
  uniform vec3 uSunDir;
  uniform vec3 uSunColor;
  uniform float uSunI;
  uniform vec3 uEarthDir;
  uniform vec3 uCamMCI;

  // Lunar phase function incl. opposition surge (1 at alpha = 0).
  float lunarPhase(float alpha) {
    float surge = 1.0 / (1.0 + tan(0.5 * min(alpha, 3.0)) / 0.055);
    return 0.62 * exp(-alpha / 0.75) + 0.38 * surge + 0.02;
  }
  // Lunar-Lambert limb-darkening weight (McEwen 1991), alpha in radians.
  float lunarLw(float alpha) {
    float a = alpha * 57.29578;
    return clamp(1.0 - 0.019 * a + 0.000242 * a * a - 0.00000146 * a * a * a, 0.0, 1.0);
  }
  // Radiance factor (x I/pi x A) for unit vectors N (surface), L (to Sun), V (to viewer).
  float lunarReflectance(vec3 N, vec3 L, vec3 V) {
    float mu0 = dot(N, L);
    if (mu0 <= 0.0) return 0.0;
    float mu = max(dot(N, V), 0.02);
    float alpha = acos(clamp(dot(L, V), -1.0, 1.0));
    float lw = lunarLw(alpha);
    return lunarPhase(alpha) * (2.0 * lw * mu0 / (mu0 + mu) + (1.0 - lw) * mu0);
  }

  // --- hashing of camera-relative band coordinates. Cells are wrapped to a period of 289 so the
  // (double-precision, CPU-side) camera offset can be reduced modulo the period without seams.
  vec4 cellRand(vec3 c) {
    c = mod(c, 289.0);
    vec4 p4 = fract(c.xyzx * vec4(0.1031, 0.1030, 0.0973, 0.1099));
    p4 += dot(p4, p4.wzxy + 33.33);
    return fract((p4.xxyz + p4.yzzw) * p4.zywx);
  }
  float hash13(vec3 c) {
    c = mod(c, 289.0);
    vec3 p3 = fract(c * 0.1031);
    p3 += dot(p3, p3.zyx + 31.32);
    return fract((p3.x + p3.y) * p3.z);
  }
  float valueNoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = x - i;
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }

  // Crater cross-section in units of the rim radius (a = 1). k = freshness (0 degraded .. 1 fresh).
  float craterH(float t, float k) {
    if (t >= 1.9) return 0.0;
    float dep = 0.38 * (0.22 + 0.78 * k);
    float rim = 0.072 * (0.25 + 0.75 * k);
    float hf;
    if (t < 1.0) {
      float t2 = t * t;
      hf = -dep + (dep + rim) * t2 * (1.5 - 0.5 * t2);
    } else {
      float it = 1.0 / t;
      hf = rim * it * it * it * (1.0 - smoothstep(1.45, 1.9, t));
    }
    float sd = 1.0 - smoothstep(0.0, 1.15, t);
    float q = (t - 1.02) / 0.38;
    float hd = (-dep * sd + rim * 0.85 * exp(-q * q)) * (1.0 - smoothstep(1.5, 1.9, t));
    return mix(hd, hf, k * k * (3.0 - 2.0 * k));
  }

  // One band of micro-craters. x: band coordinates (cells), up: local vertical,
  // Lt/tanE: tangential sun dir & tan(sun elevation). Accumulates slope (grad, per metre of lateral
  // distance), shadow (multiplicative), brightness of fresh craters.
  // Cheap pass over the 8 candidate cells picks the crater whose ball contains p most deeply; only that
  // one is shaded (SIMD-friendly: the expensive part runs once per band).
  void craterBand(vec3 x, vec3 up, vec3 Lt, float tanE, vec3 Vt, float tanV, float dens, float w, inout vec3 grad, inout float shadow, inout float bright, inout float cavity) {
    vec3 b = floor(x - 0.5);
    vec3 l = x - b;                        // in [0.5, 1.5)
    float best = 1.0;
    vec3 bq = vec3(0.0);
    vec4 br = vec4(0.0);
    float brho2 = 0.25;
    for (int k = 0; k < 8; k++) {
      vec3 o = vec3(float(k & 1), float((k >> 1) & 1), float(k >> 2));
      vec4 r = cellRand(b + o);
      vec3 q = o + r.xyz - l;            // p -> candidate (cells)
      float sc = 0.55 + 0.45 * fract(r.w * 7.31 + r.y * 1.7); // ball radius scale (size spread)
      float rho2 = 0.25 * sc * sc;
      float score = dot(q, q) / rho2 + step(dens, r.w) * 2.0;
      if (score < best) { best = score; bq = q; br = r; brho2 = rho2; }
    }
    if (best >= 1.0) return;
    float dp = dot(bq, up);
    float a2 = (brho2 - dp * dp) * 0.25;
    vec3 lat = bq - dp * up;               // p -> crater centre, lateral
    float s2 = max(dot(lat, lat), 1e-8);
    float t = sqrt(s2 / a2);
    if (t >= 1.9) return;
    float a = sqrt(a2);
    {
      // irregular outline (2nd/3rd angular harmonics), fading out beyond the rim
      vec3 side = cross(up, Lt);
      float il = inversesqrt(s2);
      float ct = dot(-lat, Lt) * il;
      float st = dot(-lat, side) * il;
      vec4 hw = fract(br * 7.919 + 0.31) - 0.5;
      float wob = hw.x * 0.09 * (ct * ct - st * st) + hw.y * 0.09 * (2.0 * ct * st)
                + hw.z * 0.07 * ct * (4.0 * ct * ct - 3.0) + hw.w * 0.07 * st * (3.0 - 4.0 * st * st);
      t /= 1.0 + wob * (1.0 - smoothstep(1.0, 1.6, t));
    }
    float fr = fract(br.w * 13.37 + br.x * 3.1);
    fr *= fr;
    fr *= fr;
    fr *= fr;                             // u^8: most small craters are old and subdued
    float h = craterH(t, fr);
    float dh = (craterH(t + 0.02, fr) - h) / 0.02;  // d h / d t (units of a)
    vec3 dirOut = -lat / sqrt(s2);                  // from centre toward p
    grad += w * dh * dirOut;                        // slope = dh/ds (a cancels)
    cavity += w * min(0.0, h) * 1.5;
    bright += w * fr * fr * (t < 1.0 ? 0.7 + 0.3 * t * t : max(0.0, 1.0 - (t - 1.0) / 0.9));
    // analytic shadow cast by the rim on the bowl, minus the part hidden from the viewer by the
    // near rim (looking down-sun, crater shadows hide behind the rims just like in Apollo photos)
    if (t < 1.0 && tanE < 3.0) {
      vec3 side = cross(up, Lt);
      vec2 v = vec2(dot(-lat, Lt), dot(-lat, side)) / a;       // p rel. centre, units of a
      float bb = v.x;
      float lam = -bb + sqrt(max(bb * bb - dot(v, v) + 1.0, 0.0)); // distance to the rim toward the Sun
      float need = craterH(1.0, fr) - h;                          // rim height over p (units of a)
      float pen = 0.03 + lam * 0.012;
      float lit = smoothstep(-pen, pen, lam * tanE - need);
      vec2 vc = vec2(dot(-lat, Vt), dot(-lat, cross(up, Vt))) / a;
      float lamV = -vc.x + sqrt(max(vc.x * vc.x - dot(vc, vc) + 1.0, 0.0)); // distance to the rim toward the viewer
      float seen = smoothstep(-pen, pen, lamV * tanV - need);
      shadow *= 1.0 - 0.93 * w * (1.0 - lit) * seen;
    }
  }

  // Pebbles & small clods (2-17 cm): rounded bumps that catch the Sun and cast their own long
  // low-Sun shadows on the regolith (the ground point is shadowed when the ray toward the Sun passes
  // under the pebble's profile). Same nearest-candidate scheme as the craters.
  void pebbleBand(vec3 x, vec3 up, vec3 Lt, float tanE, float dens, float w, inout vec3 grad, inout float shadow, inout float albedoMul) {
    vec3 b = floor(x - 0.5);
    vec3 l = x - b;
    float best = 1.0;
    vec3 bq = vec3(0.0);
    vec4 br = vec4(0.0);
    float brr = 1.0;
    for (int k = 0; k < 8; k++) {
      vec3 o = vec3(float(k & 1), float((k >> 1) & 1), float(k >> 2));
      vec4 r = cellRand(b + o + 101.0);
      vec3 q = o + r.xyz - l;
      float dp = dot(q, up);
      float rho = 0.12 + 0.2 * fract(r.w * 5.73);
      float rr2 = rho * rho - dp * dp;           // footprint radius^2 (ball ∩ surface)
      vec3 lat = q - dp * up;
      // reach: the pebble itself plus its shadow (up to ~5 radii down-sun)
      float d2 = dot(lat, lat);
      float score = (rr2 > 0.0 && r.w < dens) ? d2 / (rr2 * 36.0) : 2.0;
      if (score < best) { best = score; bq = lat; br = r; brr = rr2; }
    }
    if (best >= 1.0) return;
    float rp = sqrt(brr);                          // footprint radius (cells)
    vec2 v = vec2(dot(-bq, Lt), dot(-bq, cross(up, Lt))) / rp; // p rel. centre, units of rp
    float s = length(v);
    float hr = 0.45 + 0.5 * fract(br.w * 17.1);   // height / radius
    if (s < 1.0) {
      // on the pebble: dome normal, a touch brighter/greyer than the soil
      float zz = sqrt(max(1.0 - s * s, 0.02));
      vec3 dirOut = s > 1e-4 ? -bq / (s * rp) : vec3(0.0);
      grad += w * min(hr * s / zz, 3.0) * dirOut;
      albedoMul *= mix(1.0, 1.25 + 0.3 * br.x, w);
    } else if (v.x < 0.0 && abs(v.y) < 1.0) {
      // on the ground down-sun of the pebble
      float top = hr * sqrt(1.0 - v.y * v.y);
      float ray = -v.x * tanE - (1.0 - sqrt(1.0 - v.y * v.y)) * tanE;
      shadow *= 1.0 - w * 0.9 * smoothstep(-0.06, 0.06, top - ray);
    }
  }
  // Bump mapping from screen-space derivatives of a height field (no tangents needed).
  // Degenerate derivatives (surfaces seen exactly edge-on, e.g. skirts) fall back to N: a NaN here would
  // survive the half-float post pipeline as a black pixel.
  vec3 bumpNormal(vec3 pos, vec3 N, float H) {
    vec3 sx = dFdx(pos);
    vec3 sy = dFdy(pos);
    vec3 r1 = cross(sy, N);
    vec3 r2 = cross(N, sx);
    float det = dot(sx, r1);
    if (abs(det) < 1e-12) return N;
    vec3 g = sign(det) * (dFdx(H) * r1 + dFdy(H) * r2);
    vec3 nb = abs(det) * N - g;
    float l2 = dot(nb, nb);
    return l2 > 1e-24 ? nb * inversesqrt(l2) : N;
  }
  // Safe normalisation (returns fallback for zero-length vectors).
  vec3 safeNormalize(vec3 v, vec3 fallback) {
    float l2 = dot(v, v);
    return l2 > 1e-24 ? v * inversesqrt(l2) : fallback;
  }
`;

const TERRAIN_VERT = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute vec3 morph;
  attribute vec4 aux;
  uniform vec2 uMorphRange;
  varying vec3 vPos;
  varying vec3 vNrm;
  varying vec4 vAux;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float m = smoothstep(uMorphRange.x, uMorphRange.y, length(wp.xyz));
    wp = modelMatrix * vec4(position + morph * m, 1.0);
    vPos = wp.xyz;
    vNrm = normalize(mat3(modelMatrix) * normal);
    vAux = aux;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }
`;

function terrainFrag(vesselGLSL) {
  return /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  ${vesselGLSL}
  ${LUNAR_GLSL}
  uniform vec3 uBandOff[${BAND_COUNT}];
  uniform float uBandCell[${BAND_COUNT}];
  uniform vec2 uMeshK;        // mesh resolves craters larger than distance * uMeshK (near, far chunks)
  uniform float uMinMeshD;    // ... but never smaller than this (finest LOD)
  uniform float uBands;       // number of bands evaluated per pixel (quality)
  uniform float uFill;        // light scattered into shadows by the sunlit surroundings
  varying vec3 vPos;
  varying vec3 vNrm;
  varying vec4 vAux;

  void main() {
    #include <logdepthbuf_fragment>
    vec3 up = normalize(uCamMCI + vPos);
    vec3 N = safeNormalize(vNrm, up);
    vec3 V = safeNormalize(-vPos, up);
    vec3 L = uSunDir;
    float dist = length(vPos);
    float albedo = vAux.x;
    float mare = vAux.z;
    float freshV = vAux.w;

    // --- Sun horizon shadow (crisp sub-vertex edge from the interpolated horizon delta)
    float hd = vAux.y;
    float pen = max(0.0047, 1.2 * fwidth(hd));
    float vis = clamp(0.5 - hd / (2.0 * pen), 0.0, 1.0);

    // --- micro-craters & fine detail
    float sinE = dot(L, up);
    vec3 Lt = L - sinE * up;
    float lt = length(Lt);
    Lt = lt > 1e-4 ? Lt / lt : vec3(0.0);
    float tanE = sinE / max(lt, 1e-4);
    float sinV = dot(V, up);
    vec3 Vt = V - sinV * up;
    float vt = length(Vt);
    Vt = vt > 1e-4 ? Vt / vt : vec3(0.0);
    float tanV = sinV / max(vt, 1e-4);
    vec3 grad = vec3(0.0);
    float shadow = 1.0;
    float bright = 0.0;
    float cavity = 0.0;
    float meshMin = max(dist * mix(uMeshK.x, uMeshK.y, smoothstep(12000.0, 40000.0, dist)), uMinMeshD);
    float fwP = length(fwidth(vPos)); // metres per pixel
    // first band whose largest craters (0.5 cell) are below the mesh resolution; then 3 bands down
    int i0 = int(clamp(ceil(log(${(0.5 * BAND_CELL0).toFixed(1)} / meshMin) / log(2.4) - 0.3), 0.0, float(${BAND_COUNT} - 1)));
    for (int j = 0; j < 3; j++) {
      int i = i0 + j;
      if (i >= ${BAND_COUNT} || float(j) >= uBands) break;
      float cell = uBandCell[i];
      float dmax = 0.5 * cell;
      // band weight: only below mesh resolution, and only while craters span > ~2.5 px
      float wMesh = 1.0 - smoothstep(meshMin * 0.5, meshMin, dmax);
      float wPix = smoothstep(2.5, 6.0, dmax / fwP);
      float w = wMesh * wPix;
      // crater density: highlands near saturation; maria have few large (post-flooding) craters
      float mareDens = dmax > 3000.0 ? 0.12 : dmax > 600.0 ? 0.25 : dmax > 150.0 ? 0.45 : 0.72;
      float dens = mix(0.85, mareDens, mare);
      vec3 x = vPos / cell + uBandOff[i];
      craterBand(x, up, Lt, tanE, Vt, tanV, dens, w, grad, shadow, bright, cavity);
    }
    // pebbles within a few tens of metres
    float albedoMul = 1.0;
    if (fwP < 0.03) {
      float wp1 = smoothstep(0.03, 0.012, fwP);
      pebbleBand(vPos / uBandCell[13] + uBandOff[13], up, Lt, tanE, mix(0.1, 0.3, mare), wp1, grad, shadow, albedoMul);
      if (fwP < 0.008) {
        float wp2 = smoothstep(0.008, 0.004, fwP);
        pebbleBand(vPos / uBandCell[14] + uBandOff[14], up, Lt, tanE, 0.35, wp2, grad, shadow, albedoMul);
      }
    }
    // perturbed normal (slopes add in the tangent plane)
    vec3 g = grad - dot(grad, up) * up;
    N = safeNormalize(N - g, up);
    // fractal regolith roughness at the two scales just above the pixel footprint
    {
      int m0 = int(clamp(floor(log(${BAND_CELL0.toFixed(1)} / (fwP * 5.0)) / log(2.4)), 1.0, float(${BAND_COUNT} - 1)));
      float Hb = 0.0;
      for (int j = 0; j < 2; j++) {
        int i = m0 - j;
        float cell = uBandCell[i];
        float wf = smoothstep(3.0, 8.0, cell / fwP);
        Hb += wf * valueNoise(vPos / cell + uBandOff[i] + 57.0) * cell * 0.045;
      }
      N = bumpNormal(vPos, N, Hb);
    }

    // albedo mottling at every scale (immature ejecta, space-weathering patches, regolith grain):
    // two noise octaves pinned to the band lattice just above the pixel footprint (no aliasing, and
    // the pattern is fixed to the ground, not the screen)
    float mott = 0.0;
    {
      int m0 = int(clamp(floor(log(${BAND_CELL0.toFixed(1)} / (fwP * 6.0)) / log(2.4)), 1.0, float(${BAND_COUNT} - 1)));
      for (int j = 0; j < 2; j++) {
        int i = m0 - j;
        float cell = uBandCell[i];
        float wf = smoothstep(3.0, 9.0, cell / fwP);
        mott += wf * (valueNoise(vPos / cell + uBandOff[i]) - 0.5) * (j == 0 ? 0.06 : 0.09);
      }
    }
    float A = albedo * (1.0 + mott) * (1.0 + 0.9 * bright * (1.0 - 0.4 * freshV)) * albedoMul;
    A *= 1.0 + 0.08 * cavity;

    // colour: mature mare is brownish-grey, highlands a lighter warm grey, fresh ejecta neutral/bluish
    vec3 tintMare = vec3(1.0, 0.965, 0.92);
    vec3 tintHigh = vec3(1.0, 0.975, 0.945);
    vec3 tintFresh = vec3(0.98, 0.985, 1.0);
    vec3 tint = mix(mix(tintHigh, tintMare, mare), tintFresh, clamp(freshV + bright * 0.5, 0.0, 1.0));

    float direct = lunarReflectance(N, L, V) * vis * shadow;
    direct *= vesselShadow(vPos);
    // light scattered from the sunlit surroundings into shadows (sky is black)
    float fill = uFill * max(sinE, 0.0) * (0.5 + 0.5 * dot(N, up));
    // earthshine on the night side (tiny)
    float earth = 1.2e-4 * max(dot(N, uEarthDir), 0.0);
    vec3 col = uSunColor * (uSunI / PI) * A * tint * (direct + fill + earth);
    col = max(col, vec3(0.0)); // never emit NaN/negative radiance into the HDR pipeline
    gl_FragColor = vec4(col, 1.0);
    #include <tonemapping_fragment>
    #include <colorspace_fragment>
  }
`;
}

/** Shared lighting uniforms (one object used by terrain and rocks). */
export function createLunarUniforms(ctx) {
  return {
    uSunDir: { value: ctx.sunDir.clone() },
    uSunColor: { value: new THREE.Color(SUN.color) },
    uSunI: { value: SUN.intensity },
    uEarthDir: { value: new THREE.Vector3(1, 0, 0) },
    uCamMCI: { value: new THREE.Vector3() },
    uFill: { value: 0.035 },
  };
}

/**
 * Terrain ShaderMaterial. Per-chunk uniform: uMorphRange (set in onBeforeRender).
 * @param {object} ctx RenderContext
 * @param {object} lunar shared uniforms from createLunarUniforms
 * @param {{bands:number, meshK:number}} opts
 */
export function createTerrainMaterial(ctx, lunar, opts) {
  const bandOff = [];
  for (let i = 0; i < BAND_COUNT; i++) bandOff.push(new THREE.Vector3());
  const uniforms = {
    ...lunar,
    ...ctx.vesselShadow.uniforms,
    uMorphRange: { value: new THREE.Vector2(1e30, 2e30) },
    uBandOff: { value: bandOff },
    uBandCell: { value: BAND_CELLS.slice() },
    uMeshK: { value: new THREE.Vector2(opts.meshK, opts.meshKFar ?? opts.meshK) },
    uMinMeshD: { value: opts.minMeshD ?? 4 },
    uBands: { value: opts.bands },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: TERRAIN_VERT,
    fragmentShader: terrainFrag(ctx.vesselShadow.glsl),
    extensions: { derivatives: true },
  });
  mat.name = 'LunarTerrain';
  return mat;
}

/** Update per-frame band offsets (double-precision camera position modulo the hash period). */
export function updateBandOffsets(mat, camMCI) {
  const off = mat.uniforms.uBandOff.value;
  for (let i = 0; i < BAND_COUNT; i++) {
    const c = BAND_CELLS[i];
    const P = 289;
    off[i].set(
      ((camMCI.x / c) % P + P) % P,
      ((camMCI.y / c) % P + P) % P,
      ((camMCI.z / c) % P + P) % P,
    );
  }
}
