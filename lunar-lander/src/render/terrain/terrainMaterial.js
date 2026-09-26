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

/** Detail bands: cell sizes shrink 2.4x from 48 km down to ~7 mm (regolith grain); micro-craters use the
 * first CRATER_BANDS of them, each pixel evaluates up to 3 crater bands. */
export const BAND_COUNT = 19;
const CRATER_BANDS = 16;
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
  float orbitK = 0.0; // 0 near the ground .. 1 from orbit (set by the terrain shader per pixel)
  float gPixCell = 0.0; // pixel footprint in cells of the band being shaded
  float gDeg = 0.22;    // depth of fully degraded craters (x fresh depth)

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
    float dep = 0.38 * (gDeg + (1.0 - gDeg) * k);
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
  // distance), shadow (multiplicative), brightness of fresh/steep craters.
  // Cheap pass over the 8 candidate cells picks the TWO craters whose balls contain p most deeply (so
  // craters overlap and a band can approach saturation); only those are shaded.
  // Sizes follow a steep power law inside each band (many small craters, few large ones).
  void shadeCrater(vec3 bq, vec4 br, float brho2, vec3 up, vec3 Lt, float tanE, vec3 Vt, float tanV, float young, float w, inout vec3 grad, inout float shadow, inout float bright, inout float cavity) {
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
    fr = pow(fr, young);                  // metre-scale ones even more so (fast steady-state erosion)
    float h = craterH(t, fr);
    float dh = (craterH(t + 0.02, fr) - h) / 0.02;  // d h / d t (units of a)
    vec3 dirOut = -lat / sqrt(s2);                  // from centre toward p
    grad += w * dh * dirOut;                        // slope = dh/ds (a cancels)
    cavity += w * min(0.0, h) * 1.5;
    bright += w * fr * fr * (t < 1.0 ? 0.7 + 0.3 * t * t : max(0.0, 1.0 - (t - 1.0) / 0.9));
    // steep walls and rim crests expose immature (brighter) soil even on fairly old craters: the main
    // reason craters stay visible under a high Sun, when shading contrast is nearly gone
    bright += w * smoothstep(0.05, 0.3, abs(dh)) * (0.22 + 0.5 * fr) * (1.0 - 0.6 * orbitK);
    // seen from orbit every crater carries a crisp bright rim crest, brighter upper walls, a bright
    // ejecta apron when fresh, and a darker, mature floor: the albedo pattern that keeps highland
    // photographs saturated with craters even under a high Sun (when the shading is nearly gone).
    // The crest is never narrower than ~1.5 px (no sparkle).
    if (orbitK > 0.0) {
      float cw = max(0.08, 1.5 * gPixCell / a);
      float cq = (t - 1.0) / cw;
      float crest = exp(-cq * cq);
      float wall = smoothstep(0.5, 0.92, t) * (1.0 - smoothstep(0.92, 1.02, t));
      float apron = t > 1.0 ? fr * max(0.0, 1.0 - (t - 1.0) / 0.7) : 0.0;
      bright += w * orbitK * (crest * (0.06 + 0.75 * fr) + wall * (0.03 + 0.3 * fr) + apron * 0.45);
      bright -= w * orbitK * (1.0 - smoothstep(0.25, 0.75, t)) * (1.0 - fr) * 0.12;
    }
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

  // nc: candidates per 2x2x2 block (8: one per cell, 16: two, 24: three - a denser, saturated band)
  void craterBand(vec3 x, vec3 up, vec3 Lt, float tanE, vec3 Vt, float tanV, float dens, float dens2, float young, float w, int nc, inout vec3 grad, inout float shadow, inout float bright, inout float cavity) {
    vec3 b = floor(x - 0.5);
    vec3 l = x - b;                        // in [0.5, 1.5)
    float best = 1.0;
    float best2 = 1.0;
    vec3 bq = vec3(0.0);
    vec3 bq2 = vec3(0.0);
    vec4 br = vec4(0.0);
    vec4 br2 = vec4(0.0);
    float brho2 = 0.25;
    float brho22 = 0.25;
    for (int k = 0; k < 24; k++) {
      if (k >= nc) break;
      // up to three candidates per cell (the others derived from the same hash): dense, overlapping craters
      int kc = k & 7;
      vec3 o = vec3(float(kc & 1), float((kc >> 1) & 1), float(kc >> 2));
      vec4 r = cellRand(b + o);
      float dd = dens;
      if (k >= 16) {
        r = fract(r.wzyx * 3.913 + vec4(0.271, 0.859, 0.462, 0.953));
        dd = dens2;
      } else if (k >= 8) {
        r = fract(r.zxwy * 5.371 + vec4(0.618, 0.337, 0.791, 0.143));
        dd = dens2;
      }
      vec3 q = o + r.xyz - l;            // p -> candidate (cells)
      float u = fract(r.w * 7.31 + r.y * 1.7);
      float sc = 0.3 + 0.7 * u * u;      // ball radius scale: power-law size spread
      float rho2 = 0.25 * sc * sc;
      float score = dot(q, q) / rho2 + step(dd, r.w) * 2.0;
      if (score < best) {
        best2 = best; bq2 = bq; br2 = br; brho22 = brho2;
        best = score; bq = q; br = r; brho2 = rho2;
      } else if (score < best2) {
        best2 = score; bq2 = q; br2 = r; brho22 = rho2;
      }
    }
    if (best < 1.0) shadeCrater(bq, br, brho2, up, Lt, tanE, Vt, tanV, young, w, grad, shadow, bright, cavity);
    if (best2 < 1.0) shadeCrater(bq2, br2, brho22, up, Lt, tanE, Vt, tanV, young, w, grad, shadow, bright, cavity);
  }

  // Pebbles & clods (1-15 cm): angular fragments, partly buried in the regolith, that catch the Sun and
  // cast their own long low-Sun shadows. Each fragment is a (vertically flattened) ball cut by three
  // random planes (flat fracture faces, sharp edges), sunk 10-90 % into the soil: the ball of radius rho
  // around a 3D cell candidate intersects the local ground plane, the part above it is the visible clod.
  // Shading uses the exact facet/dome normal; the shadow is an exact ray test of the ground point toward
  // the Sun against the same convex body (rounded, tapering tips, facetted outlines). Candidates are
  // gathered from three 2x2x2 blocks stepped toward the Sun, so shadows up to ~1.3 cells long are
  // complete; the strongest occluder wins (no double counting between overlapping blocks).
  // Body in "scaled" local coordinates (Lt, side, up*sc) with sc = 1/flattening: a ball of radius rho.
  // Returns the entry/exit interval of the ray o + t d (t >= 0) through the body (miss: t0 >= t1).
  vec2 clodRay(vec3 o, vec3 d, float rho, vec3 n1, vec3 n2, vec3 n3, vec3 hc) {
    float bq = dot(o, d);
    float cq = dot(o, o) - rho * rho;
    float disc = bq * bq - cq;
    if (disc <= 0.0) return vec2(1.0, 0.0);
    float sq = sqrt(disc);
    float t0 = max(-bq - sq, 0.0);
    float t1 = -bq + sq;
    // planar cuts n.x <= h
    vec3 dn = vec3(dot(n1, d), dot(n2, d), dot(n3, d));
    vec3 nu = hc - vec3(dot(n1, o), dot(n2, o), dot(n3, o));
    for (int i = 0; i < 3; i++) {
      float den = dn[i];
      float num = nu[i];
      if (abs(den) < 1e-5) { if (num < 0.0) return vec2(1.0, 0.0); continue; }
      float tt = num / den;
      if (den > 0.0) t1 = min(t1, tt); else t0 = max(t0, tt);
    }
    return vec2(t0, t1);
  }
  void pebbleBand(vec3 x, vec3 up, vec3 Lt, float tanE, float dens, float rmax, float w, inout vec3 grad, inout float shadow, inout float albedoMul) {
    vec3 side = cross(up, Lt);
    float tE = max(tanE, 0.1);
    float bestTop = 0.0;     // tallest clod over p (scaled height above ground, in cells)
    vec3 bestG = vec3(0.0);
    float bestA = 1.0;
    float occ = 0.0;         // strongest shadow
    float ao = 0.0;          // contact darkening at the foot of clods
    for (int blk = 0; blk < 3; blk++) {
      vec3 xq = x + Lt * (0.5 * float(blk));
      vec3 b = floor(xq - 0.5);
      for (int k = 0; k < 8; k++) {
        vec3 o8 = vec3(float(k & 1), float((k >> 1) & 1), float(k >> 2));
        vec3 cc = b + o8;
        vec4 r = cellRand(cc + 101.0);
        if (r.w >= dens) continue;
        vec3 q = cc + r.xyz - x;                    // p -> candidate (cells)
        float dp = dot(q, up);
        float u = fract(r.w * 5.73 + r.x * 3.1);
        float rho = rmax * (0.25 + 0.75 * u * u * u); // power law: many small, few large
        if (abs(dp) >= rho * 0.97) continue;
        vec4 r2 = cellRand(cc + 211.0);
        float hr = 0.5 + 0.45 * r2.x;               // flattening (height / width)
        float sc = 1.0 / hr;
        float sink = 0.1 + 0.8 * abs(dp) / rho;      // buried fraction of the (scaled) ball
        float zg = sink * rho;                       // ground plane height above the centre (scaled)
        vec3 lat = q - dp * up;
        vec2 v = vec2(dot(-lat, Lt), dot(-lat, side)); // p rel. centre (cells)
        float v2 = dot(v, v);
        // three fracture planes (normals point outward; mostly sideways/up) at 55-85 % of rho
        vec4 r3 = cellRand(cc + 307.0);
        float a1 = r2.y * 6.2832;
        float a2 = a1 + 2.1 + r2.z * 0.8;
        float a3 = a2 + 1.8 + r3.x * 1.0;
        float e1 = 0.15 + 0.9 * r3.y;
        float e2 = 0.1 + 0.8 * r3.z;
        float e3 = 0.6 + 0.7 * r3.w;
        vec3 n1 = vec3(cos(e1) * cos(a1), cos(e1) * sin(a1), sin(e1));
        vec3 n2 = vec3(cos(e2) * cos(a2), cos(e2) * sin(a2), sin(e2));
        vec3 n3 = vec3(cos(e3) * cos(a3), cos(e3) * sin(a3), sin(e3));
        vec3 hc = rho * vec3(0.62 + 0.25 * r2.w, 0.58 + 0.25 * fract(r2.w * 7.3), 0.6 + 0.3 * fract(r2.y * 5.1));
        // --- on the clod: top of the body above p (vertical ray from below the ground)
        float zs2 = rho * rho - v2;
        if (zs2 > zg * zg) {
          float zs = sqrt(zs2);                      // sphere top (scaled, rel. centre)
          float ztop = zs;
          vec2 gz = -v / max(zs, 1e-4 * rho);          // d ztop / d v
          // planes: n.xy . v + n.z z <= h  ->  z <= (h - n.xy . v) / n.z
          float zp = (hc.x - dot(n1.xy, v)) / n1.z;
          if (zp < ztop) { ztop = zp; gz = -n1.xy / n1.z; }
          zp = (hc.y - dot(n2.xy, v)) / n2.z;
          if (zp < ztop) { ztop = zp; gz = -n2.xy / n2.z; }
          zp = (hc.z - dot(n3.xy, v)) / n3.z;
          if (zp < ztop) { ztop = zp; gz = -n3.xy / n3.z; }
          float top = ztop - zg;
          if (top > bestTop) {
            bestTop = top;
            // slope (real units): scaled height / sc, gradient with respect to lateral position
            vec2 g2 = gz / sc;
            float gl = length(g2);
            if (gl > 4.0) g2 *= 4.0 / gl;
            // v is measured toward p from the centre along (-lat): the gradient of height w.r.t. p
            bestG = g2.x * Lt + g2.y * side;
            bestA = 0.9 + 0.28 * r3.x * r3.y + 0.06 * (r2.z - 0.5);
          }
          continue;
        }
        // --- on the ground: contact darkening and the clod's shadow
        float rf2 = rho * rho - zg * zg;              // footprint radius^2 (of the ball)
        ao = max(ao, (1.0 - smoothstep(rf2, rf2 * 2.2, v2)) * (1.0 - sink) * 0.5);
        vec3 o3 = vec3(v, zg);
        vec3 d3 = normalize(vec3(1.0, 0.0, tE * sc));
        vec2 tt = clodRay(o3, d3, rho, n1, n2, n3, hc);
        float len = tt.y - tt.x;                       // chord through the body (soft penumbra)
        if (len > 0.0) {
          float s = smoothstep(0.0, 0.14 * rho, len);
          // fade the tips of very long shadows before they reach the edge of the candidate blocks
          s *= 1.0 - smoothstep(0.95, 1.3, tt.x * d3.x);
          occ = max(occ, s);
        }
      }
    }
    if (bestTop > 0.0) {
      grad += w * bestG;
      albedoMul *= mix(1.0, bestA, w);
      // a clod's own sunlit top is not shadowed by its own body
    } else {
      shadow *= 1.0 - w * 0.94 * occ;
      albedoMul *= 1.0 - w * 0.22 * ao;
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
  uniform vec3 uCamMCI;
  uniform float uLimb;        // silhouette refinement factor (terrain.js: chunks near the limb split later)
  varying vec3 vPos;
  varying vec3 vNrm;
  varying vec4 vAux;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    float dv = length(wp.xyz);
    float F = 1.0;
    if (uLimb > 0.0) {
      // same grazing factor as the CPU-side split (per vertex, so neighbouring chunks agree at edges)
      float cosg = abs(dot(wp.xyz, normalize(uCamMCI + wp.xyz))) / max(dv, 1e-3);
      F += uLimb * (1.0 - smoothstep(0.08, 0.3, cosg));
    }
    float m = smoothstep(uMorphRange.x * F, uMorphRange.y * F, dv);
    wp = modelMatrix * vec4(position + morph * m, 1.0);
    vPos = wp.xyz;
    vNrm = normalize(mat3(modelMatrix) * normal);
    vAux = aux;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }
`;

function terrainFrag(vesselGLSL, rockGLSL) {
  return /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  ${vesselGLSL}
  ${rockGLSL}
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
    // resolved relief: steep slopes (crater walls, massifs, scarps) expose immature, brighter soil
    float steep = smoothstep(0.015, 0.14, 1.0 - dot(N, up));
    vec3 V = safeNormalize(-vPos, up);
    vec3 L = uSunDir;
    float dist = length(vPos);
    float sinV0 = dot(V, up);
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
    // metres per pixel (along the view, i.e. the larger footprint). From the smooth view ray and the
    // sphere normal, NOT from fwidth(vPos): the derivatives of the faceted mesh jump from one triangle
    // row to the next at grazing angles (a facet tilted by 1 deg changes the footprint 2-3x at a 2 deg
    // grazing view), which switched detail octaves and band weights row by row = horizontal banding.
    float fwP = dist * length(fwidth(V)) / max(abs(sinV0), 0.025);
    orbitK = smoothstep(4000.0, 40000.0, dist);
    // km-scale craters seen from orbit: degraded ones keep more relief (wall shading carries them)
    gDeg = mix(0.22, 0.42, orbitK);
    // first band whose largest craters (0.5 cell) are below the mesh resolution; then 3 bands down
    // From orbit the mesh (a few vertices per km-sized crater) renders craters as soft lumps without crisp
    // rims: let the shader draw sizes up to ~2x further above the mesh resolution, and one band more.
    meshMin *= 1.0 + 1.2 * orbitK;
    float nBands = uBands + step(0.3, orbitK);
    int i0 = int(clamp(ceil(log(${(0.5 * BAND_CELL0).toFixed(1)} / meshMin) / log(2.4) - 0.3), 0.0, float(${CRATER_BANDS} - 1)));
    for (int j = 0; j < 4; j++) {
      int i = i0 + j;
      if (i >= ${CRATER_BANDS} || float(j) >= nBands) break;
      float cell = uBandCell[i];
      float dmax = 0.5 * cell;
      // band weight: only below mesh resolution, and only while craters span > ~2.5 px
      float wMesh = 1.0 - smoothstep(meshMin * 0.5, meshMin, dmax);
      float wPix = smoothstep(2.5, 6.0, dmax / fwP);
      float w = wMesh * wPix;
      // crater density: highlands near saturation; maria have few large (post-flooding) craters
      // (two craters per cell and a power-law size spread: these are per-candidate densities)
      float mareDens = dmax > 3000.0 ? 0.3 : dmax > 600.0 ? 0.4 : dmax > 150.0 ? 0.45 : 0.6;
      float mareDens2 = dmax > 3000.0 ? 0.08 : dmax > 600.0 ? 0.2 : dmax > 150.0 ? 0.3 : 0.45;
      float dens = mix(0.85, mareDens, mare);
      float dens2 = mix(0.75, mareDens2, mare);
      vec3 x = vPos / cell + uBandOff[i];
      gPixCell = fwP / cell;
      // young: exponent on the freshness; km-scale craters seen from orbit keep crisper rims
      float young = dmax < 8.0 ? 1.6 : mix(1.0, 0.55, smoothstep(150.0, 1500.0, dmax));
      craterBand(x, up, Lt, tanE, Vt, tanV, dens, dens2, young, w, 16, grad, shadow, bright, cavity);
    }
    // pebbles & clods within a few tens of metres (0.55 m cells: 3-14 cm; 0.23 m cells: 1-6 cm)
    float albedoMul = 1.0;
    if (fwP < 0.03) {
      float wp1 = smoothstep(0.03, 0.012, fwP);
      pebbleBand(vPos / uBandCell[13] + uBandOff[13], up, Lt, tanE, mix(0.45, 0.6, mare), 0.26, wp1, grad, shadow, albedoMul);
      if (fwP < 0.01) {
        float wp2 = smoothstep(0.01, 0.005, fwP);
        pebbleBand(vPos / uBandCell[14] + uBandOff[14], up, Lt, tanE, 1.0, 0.26, wp2, grad, shadow, albedoMul);
      }
    }
    // perturbed normal (slopes add in the tangent plane)
    vec3 g = grad - dot(grad, up) * up;
    N = safeNormalize(N - g, up);
    // fractal regolith roughness at the scales just above the pixel footprint: three octaves pinned to
    // the band lattice, cross-faded continuously with the footprint (no seams where the set changes).
    // At grain scale (< ~3 cm) the relief gets rougher (granular soil instead of smooth clay).
    {
      float Lr = log(${BAND_CELL0.toFixed(1)} / (fwP * 5.0)) / log(2.4);
      int m0 = int(clamp(floor(Lr), 2.0, float(${BAND_COUNT} - 1)));
      float fr = clamp(Lr - float(m0), 0.0, 1.0);
      float Hb = 0.0;
      for (int j = 0; j < 3; j++) {
        int i = m0 - j;
        float cell = uBandCell[i];
        float u = fr + float(j);
        float wf = smoothstep(0.0, 1.0, u) * (1.0 - smoothstep(2.0, 3.0, u));
        // (metre-scale soil is smooth between craters: large, blobby noise bumps read as smeared
        // streaks under the grazing Sun; the grain below a few cm is rough)
        float amp = mix(0.012, 0.07, smoothstep(0.4, 0.02, cell));
        Hb += wf * valueNoise(vPos / cell + uBandOff[i] + 57.0) * cell * amp;
      }
      N = bumpNormal(vPos, N, Hb);
    }

    // albedo mottling at every scale (immature ejecta, space-weathering patches, regolith grain):
    // three noise octaves pinned to the band lattice just above the pixel footprint, cross-faded (no
    // aliasing, no seams, and the pattern is fixed to the ground, not the screen)
    float mott = 0.0;
    {
      float Lr = log(${BAND_CELL0.toFixed(1)} / (fwP * 6.0)) / log(2.4);
      int m0 = int(clamp(floor(Lr), 2.0, float(${BAND_COUNT} - 1)));
      float fr = clamp(Lr - float(m0), 0.0, 1.0);
      for (int j = 0; j < 3; j++) {
        int i = m0 - j;
        float cell = uBandCell[i];
        float u = fr + float(j);
        float wf = smoothstep(0.0, 1.0, u) * (1.0 - smoothstep(2.0, 3.0, u));
        float amp = mix(0.065, 0.13, smoothstep(0.1, 0.01, cell));
        mott += wf * (valueNoise(vPos / cell + uBandOff[i]) - 0.5) * amp;
      }
    }
    // fresh/steep crater brightening: moderate near the ground (immature soil is ~1.3-1.6x brighter, not
    // 3x), stronger from orbit where albedo is what keeps craters visible under a high Sun
    float kBright = mix(0.32, 0.9, orbitK);
    float A = albedo * (1.0 + mott) * (1.0 + kBright * min(bright, 1.3) * (1.0 - 0.4 * freshV)) * albedoMul;
    A *= max(1.0 + 0.08 * cavity, 0.6);
    // (strongest from orbit, where it is what keeps craters visible under a high Sun; near the ground the
    // sunward walls of small craters are already bright from the incidence angle alone)
    A *= 1.0 + mix(0.06, 0.4, smoothstep(3000.0, 40000.0, dist)) * steep * (1.0 - 0.5 * freshV);

    // colour: mature mare is brownish-grey, highlands a lighter warm grey, fresh ejecta neutral/bluish
    vec3 tintMare = vec3(1.0, 0.965, 0.92);
    vec3 tintHigh = vec3(1.0, 0.975, 0.945);
    vec3 tintFresh = vec3(0.98, 0.985, 1.0);
    vec3 tint = mix(mix(tintHigh, tintMare, mare), tintFresh, clamp(freshV + bright * 0.5, 0.0, 1.0));

    float direct = lunarReflectance(N, L, V) * vis * shadow;
    direct *= vesselShadow(vPos);
    if (dist < 3000.0) direct *= rockShadow(vPos, 0.02);
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
    ...opts.rockShadow.uniforms,
    uMorphRange: { value: new THREE.Vector2(1e30, 2e30) },
    uLimb: { value: 0 },
    uBandOff: { value: bandOff },
    uBandCell: { value: BAND_CELLS.slice() },
    uMeshK: { value: new THREE.Vector2(opts.meshK, opts.meshKFar ?? opts.meshK) },
    uMinMeshD: { value: opts.minMeshD ?? 4 },
    uBands: { value: opts.bands },
  };
  const mat = new THREE.ShaderMaterial({
    uniforms,
    vertexShader: TERRAIN_VERT,
    fragmentShader: terrainFrag(ctx.vesselShadow.glsl, opts.rockShadow.glsl),
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
