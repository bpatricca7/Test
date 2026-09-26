// Post-processing: HDR -> auto-exposure -> bloom -> AgX tone curve / sRGB -> SMAA (FXAA on 'low').
// Contract (ARCHITECTURE.md §6): createPost(ctx) -> { render(frame), setSize(w, h) }
//
// Pipeline (hand-rolled, bandwidth-lean: only the scene target is full-resolution HalfFloat):
//   scene                 rendered once into a linear HDR RGBA16F target (physical-ish radiance)
//   exposure              GPU-only metering + temporal adaptation, no CPU read-back (all tiny passes):
//                           1. meter  : 2 x 128-px-wide maps of log-luminance statistics (16 taps/texel):
//                                       left half = whole frame, right half = spacecraft spot meter
//                           2. reduce : 8x8 blocks
//                           3. adapt  : 1x1 ping-pong — target EV from the statistics, clamped per view
//                                       (exterior / IVA), eased with separate brighten/darken rates;
//                                       also measures how much of the Sun disc is visible and how dark
//                                       the frame is (star visibility)
//   bloom                 dual-filter pyramid (half-res start, 5 levels; 'low': quarter-res, 3 levels).
//                         The prefilter applies the exposure and a HIGH soft-knee threshold near the top of
//                         the tone curve, so only the Sun, engine glow and true specular glints scatter —
//                         never diffuse sunlit paint, foil or regolith.
//   composite             ONE full-resolution pass: exposure x HDR + Sun glare + bloom -> AgX tone curve
//                         (long film-like shoulder, mild Ektachrome-ish look) -> sRGB -> vignette, grain,
//                         dither -> RGBA8
//   SMAA | FXAA           to the screen (no MSAA with the logarithmic depth buffer)
//
// Metering (the "photographer"): a log-average in which sunlit pixels dominate and black sky counts
// ~2 %, so a small sunlit spacecraft against space is exposed for the spacecraft, a sunlit landscape
// comes out mid grey like Apollo 16-mm film, and an all-dark view opens up (stars, Milky Way).
// Two highlight guards keep bright things from burning out:
//   * frame guard: the LINEAR mean of the sunlit pixels must not exceed `hi` after exposure (the Earth,
//     a distant spacecraft against the black sky);
//   * spacecraft spot meter: in exterior views each vessel's projected disc is metered separately, and the
//     energy-weighted mean of its sunlit pixels (dominated by the brightest faces) must not exceed `vHi`.
//     Vertical sunlit faces at a 10.8 deg Sun receive ~5x the irradiance of the ground and have 3-8x its
//     albedo — without this guard a spacecraft over a sunlit landscape exposes 4-5 stops over and clips.
// A sunlit scene also caps how far the exposure may open (`litMaxEV`, the "sunny 16" rule: Apollo crews
// opened up only ~2 stops for up-Sun shots), so dark high-phase regolith is not pushed to mid grey and
// the stars stay invisible, as in every Apollo photograph with sunlit ground in the frame.
// The Sun disc and extreme speculars are excluded from the statistics.
//
// Owned by the SKY-FX agent.

import * as THREE from 'three';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAShader } from 'three/addons/shaders/FXAAShader.js';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SUN } from '../core/constants.js';

// ------------------------------------------------------------------------------ exposure settings
/**
 * Exposure behaviour per view. EVs are log2 of the linear multiplier applied to scene radiance.
 * key: target for the metered (log-average) luminance; hi: target for the mean of the sunlit pixels
 * (frame highlight guard); vHi: target for the energy-weighted mean of a spacecraft's sunlit pixels
 * (spot-meter guard), vPull: how many stops the spot meter may pull the frame exposure down; min/max: clamps; litMaxEV: max EV while sunlit surface fills the frame;
 * up/down: adaptation time constants (s) when the image gets brighter / darker.
 */
export const EXPOSURE_PROFILES = {
  exterior: { key: 0.19, hi: 0.8, vHi: 6.5, vPull: 1.25, minEV: Math.log2(0.04), maxEV: Math.log2(160), litMaxEV: Math.log2(20), up: 1.6, down: 0.45 },
  iva: { key: 0.14, hi: 1.6, vHi: 6.5, vPull: 2.0, minEV: Math.log2(0.25), maxEV: Math.log2(120), litMaxEV: Math.log2(120), up: 1.2, down: 0.35 },
};
/**
 * Bloom settings (exposed units, i.e. after exposure, before the tone curve; AgX reaches white at ~16).
 * threshold/knee: soft-knee start of the glow; strength: glow added to the image.
 */
export const BLOOM = { threshold: 9, knee: 4, strength: 0.14, strengthIVA: 0.12 };
const MAX_EXPOSED = 64; // clamp after exposure (the tone curve is fully white long before that)
const SUN_DETECT = 2000; // HDR radiance that identifies Sun-disc pixels (sun.js draws ~3e4)
const METER_W = 128;
const SURF_L = 4e-4; // HDR luminance above which a pixel is "day-side surface" (night/earthshine ~3e-5)

const quadVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Left half (x < METER_W): whole-frame statistics  (w*log L, w, g*L, g)
// Right half: spacecraft spot statistics             (s*Lc^2, s*Lc, s, surface)
const meterFrag = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uCell;       // meter cell size in source uv
  uniform vec4 uSpot0;      // spot meters: xy = centre uv, zw = radius uv (z = 0: off)
  uniform vec4 uSpot1;
  float inSpot(vec2 uv, vec4 s) {
    if (s.z <= 0.0) return 0.0;
    vec2 d = (uv - s.xy) / s.zw;
    return step(dot(d, d), 1.0);
  }
  void main() {
    float mw = ${METER_W.toFixed(1)};
    bool spot = gl_FragCoord.x >= mw;
    vec2 cellUv = vec2(mod(gl_FragCoord.x, mw) / mw, gl_FragCoord.y * uCell.y);
    vec4 acc = vec4(0.0);
    vec2 base = cellUv - 0.5 * uCell;
    for (int j = 0; j < 4; j++) {
      for (int i = 0; i < 4; i++) {
        vec2 uv = base + (vec2(float(i), float(j)) + 0.5) * 0.25 * uCell;
        vec3 c = texture2D(tDiffuse, uv).rgb;
        float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
        if (!(L < ${SUN_DETECT.toFixed(1)})) continue; // Sun / extreme speculars / NaN: ignore
        float lit = smoothstep(0.0015, 0.008, L);
        if (spot) {
          float s = max(inSpot(uv, uSpot0), inSpot(uv, uSpot1)) * lit;
          float Lc = min(L, 12.0); // a few mirror glints must not dictate the exposure
          acc += vec4(s * Lc * Lc, s * Lc, s, step(${SURF_L.toFixed(6)}, L));
        } else {
          vec2 q = uv - 0.5;
          float cw = 1.0 - 1.2 * dot(q, q);               // mild centre weighting
          float w = cw * mix(0.02, 1.0, lit);
          float lg = log(max(L, 1e-4));
          // the highlight guard ignores speculars / the Sun's anti-aliased rim (> 30)
          float g = L < 30.0 ? cw * lit : 0.0;
          acc += vec4(w * lg, w, g * L, g);
        }
      }
    }
    gl_FragColor = acc / 16.0;
  }
`;

const reduceFrag = /* glsl */ `
  uniform sampler2D tSrc;
  uniform ivec2 uSrcSize;
  void main() {
    ivec2 o = ivec2(gl_FragCoord.xy) * 8;
    vec4 acc = vec4(0.0);
    for (int j = 0; j < 8; j++) {
      for (int i = 0; i < 8; i++) {
        ivec2 p = o + ivec2(i, j);
        if (p.x < uSrcSize.x && p.y < uSrcSize.y) acc += texelFetch(tSrc, p, 0);
      }
    }
    gl_FragColor = acc;
  }
`;

const adaptFrag = /* glsl */ `
  uniform sampler2D tReduce;
  uniform ivec2 uReduceSize; // x = columns of ONE half
  uniform float uCount;      // number of meter texels (one half)
  uniform sampler2D tPrev;
  uniform sampler2D tDiffuse; // HDR scene (Sun visibility)
  uniform float uDt;
  uniform float uSnap;
  uniform float uKey;
  uniform float uHi;
  uniform float uVHi;
  uniform float uVPull;
  uniform float uMinEV;
  uniform float uMaxEV;
  uniform float uLitMaxEV;
  uniform float uExterior;
  uniform float uComp;
  uniform float uTauUp;
  uniform float uTauDown;
  uniform float uOverride;   // > -90: fixed EV
  uniform vec3 uSun;         // xy = Sun uv, z = 1 when in front of the camera
  uniform vec2 uSunR;        // Sun radius in uv (x, y)
  void main() {
    vec4 s = vec4(0.0);
    vec4 v = vec4(0.0);
    for (int j = 0; j < 64; j++) {
      if (j >= uReduceSize.y) break;
      for (int i = 0; i < 32; i++) {
        if (i >= uReduceSize.x) break;
        s += texelFetch(tReduce, ivec2(i, j), 0);
        v += texelFetch(tReduce, ivec2(i + uReduceSize.x, j), 0);
      }
    }
    float meanLog = s.x / max(s.y, 1e-6);
    float litCov = s.w / uCount;
    float litMean = s.z / max(s.w, 1e-6); // LINEAR mean of the sunlit pixels (highlight-dominated)
    float surfCov = v.w / uCount;
    // "sunny 16": with sunlit surface filling the frame the exposure may open only so far
    float maxEV = mix(uMaxEV, min(uMaxEV, uLitMaxEV), smoothstep(0.01, 0.06, surfCov));
    float evAvg = log2(uKey) - meanLog / log(2.0) + uComp;
    float evHi = log2(uHi / max(litMean, 1e-4)) + uComp;
    float guard = smoothstep(2.0e-5, 4.0e-4, litCov);
    float target = clamp(evAvg, uMinEV, maxEV);
    target = min(target, mix(maxEV, evHi, guard));
    // spacecraft spot meter: energy-weighted mean of the vessel's sunlit pixels
    float vCov = v.z / uCount;
    float vMean = v.x / max(v.y, 1e-6);
    float evV = log2(uVHi / max(vMean, 1e-4)) + uComp;
    float vGuard = smoothstep(1.0e-4, 1.5e-3, vCov);
    // ...but never more than uVPull stops below the frame exposure: the tone curve's long shoulder holds
    // the rest (a photographer exposes for the scene and lets the brightest paint roll off)
    target = min(target, mix(maxEV, max(evV, target - uVPull), vGuard));
    target = max(target, uMinEV);
    if (uOverride > -90.0) target = uOverride;

    vec4 prev = texture2D(tPrev, vec2(0.5));
    float rate = target > prev.r ? 1.0 / uTauUp : 1.0 / uTauDown;
    float ev = uSnap > 0.5 ? target : prev.r + (target - prev.r) * (1.0 - exp(-uDt * rate));
    if (!(abs(ev) < 100.0)) ev = target; // NaN / first frame guard

    // fraction of the Sun disc that is visible (12 samples inside 80 % of the radius)
    float vis = 0.0;
    if (uSun.z > 0.5) {
      for (int k = 0; k < 12; k++) {
        float a = float(k) * 2.3999632; // golden angle
        float r = 0.8 * sqrt((float(k) + 0.5) / 12.0);
        vec2 uv = uSun.xy + vec2(cos(a), sin(a)) * r * uSunR;
        if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) continue;
        float L = dot(texture2D(tDiffuse, uv).rgb, vec3(0.2126, 0.7152, 0.0722));
        vis += step(${SUN_DETECT.toFixed(1)}, L);
      }
      vis /= 12.0;
    }
    float sv = uSnap > 0.5 ? vis : mix(prev.g, vis, 1.0 - exp(-uDt * 25.0));

    // Star visibility: an eye / camera adapted to sunlit surfaces does not see stars. Outside, any
    // day-side surface counts; inside, only sunlit pixels (the cabin itself is lamp-lit).
    float cov = uExterior > 0.5 ? max(litCov, surfCov) : litCov;
    float starT = 1.0 - smoothstep(0.003, 0.025, cov);
    float star = uSnap > 0.5 ? starT : mix(prev.a, starT, 1.0 - exp(-uDt * (starT > prev.a ? 0.7 : 3.0)));
    if (!(abs(star) < 2.0)) star = starT;
    gl_FragColor = vec4(ev, sv, target, star);
  }
`;

// Encodes the adapted EV (16-bit fixed point in R/G), Sun visibility (B) and star visibility (A) into an
// RGBA8 texel so the CPU can read it back asynchronously (HalfFloat read-back is not portable).
const encodeFrag = /* glsl */ `
  uniform sampler2D tAdapt;
  void main() {
    vec4 a = texture2D(tAdapt, vec2(0.5));
    float x = clamp((a.r + 16.0) / 32.0, 0.0, 1.0) * 255.0;
    gl_FragColor = vec4(floor(x) / 255.0, fract(x), clamp(a.g, 0.0, 1.0), clamp(a.a, 0.0, 1.0));
  }
`;

// ------------------------------------------------------------------------------ bloom (dual filter)
// Prefilter: exposure, clamp, soft-knee threshold, 4 bilinear taps (covers 4x4 source texels) with a
// Karis average so single sparkling texels (foil crinkles) cannot flicker the glow.
const bloomPrefilterFrag = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tAdapt;
  uniform vec2 uTexel;       // source texel size
  uniform float uThreshold;
  uniform float uKnee;
  varying vec2 vUv;
  vec3 tap(vec2 uv, float E) {
    vec3 c = clamp(texture2D(tDiffuse, uv).rgb * E, 0.0, ${MAX_EXPOSED.toFixed(1)});
    float L = max(c.r, max(c.g, c.b));
    float k = uKnee;
    float soft = clamp(L - uThreshold + k, 0.0, 2.0 * k);
    soft = soft * soft / (4.0 * k + 1e-4);
    return c * (max(soft, L - uThreshold) / max(L, 1e-4));
  }
  void main() {
    float E = exp2(texture2D(tAdapt, vec2(0.5)).r);
    vec3 a = tap(vUv + uTexel * vec2(-1.0, -1.0), E);
    vec3 b = tap(vUv + uTexel * vec2(1.0, -1.0), E);
    vec3 c = tap(vUv + uTexel * vec2(-1.0, 1.0), E);
    vec3 d = tap(vUv + uTexel * vec2(1.0, 1.0), E);
    vec4 wl = 1.0 / (1.0 + vec4(dot(a, vec3(0.2126, 0.7152, 0.0722)), dot(b, vec3(0.2126, 0.7152, 0.0722)),
                                dot(c, vec3(0.2126, 0.7152, 0.0722)), dot(d, vec3(0.2126, 0.7152, 0.0722))) * 0.25);
    vec3 s = (a * wl.x + b * wl.y + c * wl.z + d * wl.w) / (wl.x + wl.y + wl.z + wl.w);
    gl_FragColor = vec4(s, 1.0);
  }
`;

const bloomDownFrag = /* glsl */ `
  uniform sampler2D tSrc;
  uniform vec2 uTexel; // source texel size
  varying vec2 vUv;
  void main() {
    vec2 h = uTexel * 0.5;
    vec3 s = texture2D(tSrc, vUv).rgb * 4.0;
    s += texture2D(tSrc, vUv - h).rgb;
    s += texture2D(tSrc, vUv + h).rgb;
    s += texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb;
    s += texture2D(tSrc, vUv - vec2(h.x, -h.y)).rgb;
    gl_FragColor = vec4(s / 8.0, 1.0);
  }
`;

// up_i = down_i + uWeight * tent(up_{i+1})
const bloomUpFrag = /* glsl */ `
  uniform sampler2D tSrc;   // coarser level (already accumulated)
  uniform sampler2D tBase;  // this level's downsampled image
  uniform vec2 uTexel;      // coarse texel size
  uniform float uWeight;
  varying vec2 vUv;
  void main() {
    vec2 h = uTexel * 0.5;
    vec3 s = texture2D(tSrc, vUv + vec2(-h.x * 2.0, 0.0)).rgb;
    s += texture2D(tSrc, vUv + vec2(-h.x, h.y)).rgb * 2.0;
    s += texture2D(tSrc, vUv + vec2(0.0, h.y * 2.0)).rgb;
    s += texture2D(tSrc, vUv + vec2(h.x, h.y)).rgb * 2.0;
    s += texture2D(tSrc, vUv + vec2(h.x * 2.0, 0.0)).rgb;
    s += texture2D(tSrc, vUv + vec2(h.x, -h.y)).rgb * 2.0;
    s += texture2D(tSrc, vUv + vec2(0.0, -h.y * 2.0)).rgb;
    s += texture2D(tSrc, vUv + vec2(-h.x, -h.y)).rgb * 2.0;
    gl_FragColor = vec4(texture2D(tBase, vUv).rgb + uWeight * s / 12.0, 1.0);
  }
`;

// ------------------------------------------------------------------------------ composite
const compositeFrag = /* glsl */ `
  uniform sampler2D tDiffuse;  // HDR scene
  uniform sampler2D tBloom;
  uniform sampler2D tAdapt;
  uniform float uBloom;        // bloom strength (0: no bloom texture)
  uniform vec3 uSun;           // xy = Sun uv, z = in front
  uniform float uAspect;       // width / height
  uniform vec3 uSunColor;
  uniform float uGlare;        // glare strength
  uniform float uTime;
  uniform float uGrain;
  uniform float uVignette;
  varying vec2 vUv;

  // AgX (Blender / Filament, as in three.js) with a mild look: a touch more contrast and saturation,
  // like the Ektachrome of the Apollo magazines — the long shoulder keeps sunlit spacecraft paint
  // light grey with visible panel lines instead of clipping it to white.
  const mat3 PP_SRGB_TO_2020 = mat3(vec3(0.6274, 0.0691, 0.0164), vec3(0.3293, 0.9195, 0.0880), vec3(0.0433, 0.0113, 0.8956));
  const mat3 PP_2020_TO_SRGB = mat3(vec3(1.6605, -0.1246, -0.0182), vec3(-0.5876, 1.1329, -0.1006), vec3(-0.0728, -0.0083, 1.1187));
  vec3 ppAgxContrast(vec3 x) {
    vec3 x2 = x * x;
    vec3 x4 = x2 * x2;
    return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
  }
  vec3 ppAgx(vec3 color) {
    const mat3 inset = mat3(vec3(0.856627153315983, 0.137318972929847, 0.11189821299995),
      vec3(0.0951212405381588, 0.761241990602591, 0.0767994186031903),
      vec3(0.0482516061458583, 0.101439036467562, 0.811302368396859));
    const mat3 outset = mat3(vec3(1.1271005818144368, -0.1413297634984383, -0.14132976349843826),
      vec3(-0.11060664309660323, 1.157823702216272, -0.11060664309660294),
      vec3(-0.016493938717834573, -0.016493938717834257, 1.2519364065950405));
    color = inset * (PP_SRGB_TO_2020 * color);
    color = log2(max(color, 1e-10));
    color = clamp((color + 12.47393) / 16.5, 0.0, 1.0);
    color = ppAgxContrast(color);
    // look (ASC CDL: power, saturation)
    float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
    color = pow(max(color, 0.0), vec3(1.03));
    color = luma + 1.22 * (color - luma);
    color = outset * color;
    color = pow(max(vec3(0.0), color), vec3(2.2));
    return clamp(PP_2020_TO_SRGB * color, 0.0, 1.0);
  }
  vec3 ppSRGB(vec3 c) {
    return mix(pow(c, vec3(0.41666)) * 1.055 - vec3(0.055), c * 12.92, vec3(lessThanEqual(c, vec3(0.0031308))));
  }
  float h12(vec2 p) {
    vec3 p3 = fract(vec3(p.xyx) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    return fract((p3.x + p3.y) * p3.z);
  }

  void main() {
    vec4 ad = texture2D(tAdapt, vec2(0.5));
    float E = exp2(ad.r);
    vec3 c = clamp(texture2D(tDiffuse, vUv).rgb * E, 0.0, ${MAX_EXPOSED.toFixed(1)});
    float vis = ad.g;
    if (vis > 0.001 && uSun.z > 0.5) {
      vec2 d = (vUv - uSun.xy) * vec2(uAspect, 1.0);
      float r = length(d);                    // in screen heights
      // veiling glare: bright core falling off ~ r^-2, a wide faint skirt, and a slight lift of the
      // blacks (lens/eye scatter). No rings, no streaks.
      float core = 0.018 / (r * r + 0.00012);
      float skirt = 0.06 * exp(-r * 5.0) + 0.015 * exp(-r * 1.4);
      vec3 g = uSunColor * vis * uGlare * (core * 0.012 + skirt);
      // two very faint soft ghosts opposite the Sun through the centre (multi-element lens)
      vec2 gp1 = vec2(0.5) - (uSun.xy - 0.5) * 0.55;
      vec2 gp2 = vec2(0.5) - (uSun.xy - 0.5) * 1.25;
      float g1 = exp(-dot((vUv - gp1) * vec2(uAspect, 1.0), (vUv - gp1) * vec2(uAspect, 1.0)) / 0.0035);
      float g2 = exp(-dot((vUv - gp2) * vec2(uAspect, 1.0), (vUv - gp2) * vec2(uAspect, 1.0)) / 0.012);
      g += vis * uGlare * (g1 * vec3(0.010, 0.012, 0.016) + g2 * vec3(0.012, 0.009, 0.006));
      c += g;
    }
    if (uBloom > 0.0) c += texture2D(tBloom, vUv).rgb * uBloom;
    c = ppSRGB(ppAgx(c)); // display-referred sRGB

    vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
    // gentle optical vignette (cos^4-like, ~12 % in the corners)
    c *= 1.0 - uVignette * 0.13 * smoothstep(0.15, 1.05, dot(q, q) * 1.6);
    // film grain: luminance-weighted (strongest in the mid-tones), animated, fine
    vec2 px = gl_FragCoord.xy;
    float n = h12(px + fract(uTime * 7.31) * 173.0) + h12(px * 1.37 + fract(uTime * 3.17) * 311.0) - 1.0;
    float l = dot(c, vec3(0.299, 0.587, 0.114));
    c += uGrain * n * 0.028 * l * (1.0 - l) * 2.0;
    // dither (always, the target is 8-bit): +-0.5 LSB triangular noise kills banding in the black sky
    float dn = h12(px + 0.5 + fract(uTime) * 91.0) - h12(px.yx + 7.0 + fract(uTime) * 57.0);
    c += dn / 255.0;
    gl_FragColor = vec4(clamp(c, 0.0, 1.0), 1.0);
  }
`;

const shaderMat = (fragmentShader, uniforms) =>
  new THREE.ShaderMaterial({ vertexShader: quadVert, fragmentShader, uniforms, depthTest: false, depthWrite: false, toneMapped: false });

class ExposureStage {
  constructor() {
    const rt = (w, h) =>
      new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType,
        depthBuffer: false,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
      });
    this.meterRT = rt(METER_W * 2, 72);
    this.reduceRT = rt(32, 9);
    this.adaptRT = [rt(1, 1), rt(1, 1)];
    this.cur = 0;
    this.meterMat = shaderMat(meterFrag, {
      tDiffuse: { value: null },
      uCell: { value: new THREE.Vector2() },
      uSpot0: { value: new THREE.Vector4() },
      uSpot1: { value: new THREE.Vector4() },
    });
    this.reduceMat = shaderMat(reduceFrag, { tSrc: { value: this.meterRT.texture }, uSrcSize: { value: new THREE.Vector2(METER_W * 2, 72) } });
    this.adaptMat = shaderMat(adaptFrag, {
      tReduce: { value: this.reduceRT.texture },
      uReduceSize: { value: new THREE.Vector2(16, 9) },
      uCount: { value: METER_W * 72 },
      tPrev: { value: null },
      tDiffuse: { value: null },
      uDt: { value: 0 },
      uSnap: { value: 1 },
      uKey: { value: 0.2 },
      uHi: { value: 1.5 },
      uVHi: { value: 3 },
      uVPull: { value: 1 },
      uMinEV: { value: -4 },
      uMaxEV: { value: 3 },
      uLitMaxEV: { value: 3 },
      uExterior: { value: 1 },
      uComp: { value: 0 },
      uTauUp: { value: 1.5 },
      uTauDown: { value: 0.5 },
      uOverride: { value: -100 },
      uSun: { value: new THREE.Vector3() },
      uSunR: { value: new THREE.Vector2() },
    });
    this.encodeRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.encodeMat = shaderMat(encodeFrag, { tAdapt: { value: null } });
    this.encode = false; // set by the owner on frames that should refresh encodeRT
  }

  setSize(w, h) {
    const mh = Math.max(8, Math.min(512, Math.round((METER_W * h) / w)));
    this.meterRT.setSize(METER_W * 2, mh);
    const rw = METER_W / 8;
    const rh = Math.ceil(mh / 8);
    this.reduceRT.setSize(rw * 2, rh);
    this.reduceMat.uniforms.uSrcSize.value.set(METER_W * 2, mh);
    this.adaptMat.uniforms.uReduceSize.value.set(rw, rh);
    this.adaptMat.uniforms.uCount.value = METER_W * mh;
    this.meterMat.uniforms.uCell.value.set(1 / METER_W, 1 / mh);
  }

  run(renderer, quad, hdrTexture) {
    this.meterMat.uniforms.tDiffuse.value = hdrTexture;
    quad.material = this.meterMat;
    renderer.setRenderTarget(this.meterRT);
    quad.render(renderer);
    quad.material = this.reduceMat;
    renderer.setRenderTarget(this.reduceRT);
    quad.render(renderer);
    const prev = this.adaptRT[this.cur];
    const next = this.adaptRT[1 - this.cur];
    this.adaptMat.uniforms.tPrev.value = prev.texture;
    this.adaptMat.uniforms.tDiffuse.value = hdrTexture;
    quad.material = this.adaptMat;
    renderer.setRenderTarget(next);
    quad.render(renderer);
    this.cur = 1 - this.cur;
    if (this.encode) {
      this.encodeMat.uniforms.tAdapt.value = next.texture;
      quad.material = this.encodeMat;
      renderer.setRenderTarget(this.encodeRT);
      quad.render(renderer);
    }
    return next.texture;
  }

  get adaptTarget() {
    return this.adaptRT[this.cur];
  }

  dispose() {
    this.meterRT.dispose();
    this.reduceRT.dispose();
    this.adaptRT.forEach((r) => r.dispose());
    this.encodeRT.dispose();
    [this.meterMat, this.reduceMat, this.adaptMat, this.encodeMat].forEach((m) => m.dispose());
  }
}

class BloomStage {
  /**
   * @param {number} levels pyramid levels
   * @param {number} startDiv first level resolution divisor (2 = half, 4 = quarter)
   */
  constructor(levels, startDiv) {
    this.levels = levels;
    this.startDiv = startDiv;
    const rt = () => new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
    this.down = Array.from({ length: levels }, rt);
    this.up = Array.from({ length: Math.max(0, levels - 1) }, rt);
    this.preMat = shaderMat(bloomPrefilterFrag, {
      tDiffuse: { value: null },
      tAdapt: { value: null },
      uTexel: { value: new THREE.Vector2() },
      uThreshold: { value: BLOOM.threshold },
      uKnee: { value: BLOOM.knee },
    });
    this.downMat = shaderMat(bloomDownFrag, { tSrc: { value: null }, uTexel: { value: new THREE.Vector2() } });
    this.upMat = shaderMat(bloomUpFrag, { tSrc: { value: null }, tBase: { value: null }, uTexel: { value: new THREE.Vector2() }, uWeight: { value: 0.6 } });
    this.weight = 0.6; // coarser levels' share: a crisp core and only a faint wide skirt
    this.srcW = 1;
    this.srcH = 1;
  }

  /** Normalisation so the pyramid sum of a flat field returns the field. */
  get norm() {
    let s = 0;
    for (let i = 0; i < this.levels; i++) s += Math.pow(this.weight, i);
    return 1 / s;
  }

  setSize(w, h) {
    this.srcW = w;
    this.srcH = h;
    let bw = Math.max(1, Math.round(w / this.startDiv));
    let bh = Math.max(1, Math.round(h / this.startDiv));
    for (let i = 0; i < this.levels; i++) {
      this.down[i].setSize(bw, bh);
      if (i < this.levels - 1) this.up[i].setSize(bw, bh);
      bw = Math.max(1, Math.round(bw / 2));
      bh = Math.max(1, Math.round(bh / 2));
    }
  }

  run(renderer, quad, hdrTexture, adaptTexture, threshold, knee) {
    const p = this.preMat.uniforms;
    p.tDiffuse.value = hdrTexture;
    p.tAdapt.value = adaptTexture;
    p.uThreshold.value = threshold;
    p.uKnee.value = Math.max(0.01, knee);
    // taps at +-1 source texel (bilinear -> each tap averages 2x2): a 4x4 footprint
    p.uTexel.value.set(1 / this.srcW, 1 / this.srcH).multiplyScalar(this.startDiv / 2);
    quad.material = this.preMat;
    renderer.setRenderTarget(this.down[0]);
    quad.render(renderer);
    quad.material = this.downMat;
    for (let i = 1; i < this.levels; i++) {
      const src = this.down[i - 1];
      this.downMat.uniforms.tSrc.value = src.texture;
      this.downMat.uniforms.uTexel.value.set(1 / src.width, 1 / src.height);
      renderer.setRenderTarget(this.down[i]);
      quad.render(renderer);
    }
    quad.material = this.upMat;
    this.upMat.uniforms.uWeight.value = this.weight;
    let coarse = this.down[this.levels - 1];
    for (let i = this.levels - 2; i >= 0; i--) {
      this.upMat.uniforms.tSrc.value = coarse.texture;
      this.upMat.uniforms.tBase.value = this.down[i].texture;
      this.upMat.uniforms.uTexel.value.set(1 / coarse.width, 1 / coarse.height);
      renderer.setRenderTarget(this.up[i]);
      quad.render(renderer);
      coarse = this.up[i];
    }
    return coarse.texture;
  }

  dispose() {
    [...this.down, ...this.up].forEach((r) => r.dispose());
    [this.preMat, this.downMat, this.upMat].forEach((m) => m.dispose());
  }
}

/**
 * Create the post-processing chain.
 * @param {object} ctx RenderContext
 * @returns {{render(frame): void, setSize(w: number, h: number): void, exposure: object,
 *   readExposure(): {ev: number, multiplier: number, sunVisible: number, starVisibility: number},
 *   bloom: object, passes: object, dispose(): void}}
 *   Also sets ctx.exposureInfo = {ev, multiplier, sunVisible, starVisibility, valid} (refreshed
 *   asynchronously) and ctx.exposureTexture (the 1x1 GPU adaptation state: r = EV, g = Sun visibility,
 *   a = star visibility; one frame old when read during scene rendering).
 */
export function createPost(ctx) {
  const { renderer, scene, camera, game } = ctx;
  if (game.settings.filmGrain === undefined) game.settings.filmGrain = true; // added setting (UI may expose it)
  if (game.settings.exposureComp === undefined) game.settings.exposureComp = 0; // EV compensation
  // Tone mapping and the sRGB encode happen in the composite pass; nothing is drawn straight to the
  // canvas with a tone-mapped material.
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const quality = ctx.quality || 'high';
  const low = quality === 'low';
  const hdrRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, depthBuffer: true, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const ldrRT = new THREE.WebGLRenderTarget(1, 1, { type: THREE.UnsignedByteType, depthBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter });
  const quad = new FullScreenQuad(null);
  const exposureStage = new ExposureStage();
  const bloomStage = low ? new BloomStage(3, 4) : quality === 'medium' ? new BloomStage(4, 2) : new BloomStage(5, 2);
  const bloom = { threshold: BLOOM.threshold, knee: BLOOM.knee, strength: BLOOM.strength, enabled: true };
  const compositeMat = shaderMat(compositeFrag, {
    tDiffuse: { value: hdrRT.texture },
    tBloom: { value: null },
    tAdapt: { value: null },
    uBloom: { value: bloom.strength },
    uSun: { value: new THREE.Vector3() },
    uAspect: { value: 16 / 9 },
    uSunColor: { value: new THREE.Color(SUN.color) },
    uGlare: { value: 1 },
    uTime: { value: 0 },
    uGrain: { value: 1 },
    uVignette: { value: 1 },
  });
  let fxaaMat = null;
  let smaa = null;
  if (low) {
    fxaaMat = new THREE.ShaderMaterial({
      name: 'FXAA',
      uniforms: THREE.UniformsUtils.clone(FXAAShader.uniforms),
      vertexShader: FXAAShader.vertexShader,
      fragmentShader: FXAAShader.fragmentShader,
      depthTest: false,
      depthWrite: false,
      toneMapped: false,
    });
    fxaaMat.uniforms.tDiffuse.value = ldrRT.texture;
  } else {
    smaa = new SMAAPass();
    smaa.renderToScreen = true;
  }

  // ---- sizing: follow the window and the device pixel ratio (checked every frame)
  const size = new THREE.Vector2();
  let curW = 0;
  let curH = 0;
  let curPR = 0;
  function setSize(w, h) {
    const pr = renderer.getPixelRatio();
    curW = w;
    curH = h;
    curPR = pr;
    const pw = Math.max(1, Math.floor(w * pr));
    const ph = Math.max(1, Math.floor(h * pr));
    hdrRT.setSize(pw, ph);
    ldrRT.setSize(pw, ph);
    exposureStage.setSize(pw, ph);
    bloomStage.setSize(pw, ph);
    compositeMat.uniforms.uAspect.value = pw / ph;
    if (fxaaMat) fxaaMat.uniforms.resolution.value.set(1 / pw, 1 / ph);
    if (smaa) smaa.setSize(pw, ph);
  }
  function syncSize() {
    const pr = Math.min(window.devicePixelRatio || 1, ctx.qualitySettings?.pixelRatio ?? 2);
    if (Math.abs(renderer.getPixelRatio() - pr) > 1e-3) {
      renderer.setPixelRatio(pr);
      renderer.setSize(window.innerWidth, window.innerHeight, false);
    }
    renderer.getSize(size);
    if (size.x !== curW || size.y !== curH || renderer.getPixelRatio() !== curPR) setSize(size.x, size.y);
  }
  window.addEventListener('resize', syncSize);
  syncSize();

  // ---- exposure control state
  const exposure = {
    override: null, // fixed EV (log2 multiplier) for debugging, or null for auto
    profile: 'exterior',
    last: null,
  };
  let snapFrames = 8;
  let readyTail = 5;
  const snap = () => {
    snapFrames = Math.max(snapFrames, 3);
  };
  game.events.on('camera', snap);
  game.events.on('vessel', snap);
  game.events.on('scenario', snap);
  let lastProfile = null;
  let lastWall = performance.now();
  let fxTime = 0;

  const sunV = new THREE.Vector3();
  const camQ = new THREE.Quaternion();
  const tmp = new THREE.Vector3();
  const cen = new THREE.Vector3();

  /**
   * Spot-meter ellipse (uv centre + radii) of a spacecraft's bounding sphere, or zeros when it is not
   * in front of the camera. Same framing centres/radii as the exterior cameras.
   */
  function spotFor(v, frame, out, tanHalf) {
    out.set(0, 0, 0, 0);
    if (!v || !v.pos || !v.quat) return out;
    let radius;
    if (v.docked && v.type !== 'CSM') return out; // the docked stack is metered once, on the CSM
    if (v.docked) {
      cen.set(0, 0, -3.0);
      radius = 10;
    } else if (v.type === 'LM') {
      cen.set(0, v.staged ? 4.6 : 3.2, 0);
      radius = v.staged ? 3 : 5;
    } else {
      cen.set(0, 0, 1.5);
      radius = 6;
    }
    cen.applyQuaternion(v.quat).add(v.pos).sub(frame.origin); // render space (camera at 0)
    const dist = cen.length();
    tmp.copy(cen).applyQuaternion(camQ); // camera space
    if (dist < radius * 1.05) {
      out.set(0.5, 0.5, 4, 4); // camera inside the sphere: meter the whole frame
      return out;
    }
    if (tmp.z > radius) return out; // behind the camera
    const p = tmp.copy(cen).project(camera);
    const ry = Math.min(4, radius / Math.sqrt(dist * dist - radius * radius) / tanHalf / 2);
    const u = p.x * 0.5 + 0.5;
    const w = p.y * 0.5 + 0.5;
    const rx = ry / (camera.aspect || 1);
    if (u < -rx || u > 1 + rx || w < -ry || w > 1 + ry) return out;
    out.set(u, w, rx, ry);
    return out;
  }

  function updateUniforms(frame) {
    const now = performance.now();
    const wallDt = Math.min(0.25, Math.max(0, (now - lastWall) / 1000));
    lastWall = now;
    fxTime += wallDt;
    const iva = frame.viewMode === 'iva';
    const prof = EXPOSURE_PROFILES[iva ? 'iva' : 'exterior'];
    exposure.profile = iva ? 'iva' : 'exterior';
    if (lastProfile !== exposure.profile) snap();
    lastProfile = exposure.profile;
    // snap while the page is still loading (first frames / terrain streaming)
    if (!window.__READY) snapFrames = Math.max(snapFrames, 1);
    else if (readyTail > 0) {
      readyTail--;
      snapFrames = Math.max(snapFrames, 1);
    }
    const a = exposureStage.adaptMat.uniforms;
    a.uDt.value = wallDt;
    a.uSnap.value = snapFrames > 0 ? 1 : 0;
    if (snapFrames > 0) snapFrames--;
    a.uKey.value = prof.key;
    a.uHi.value = prof.hi;
    a.uVHi.value = prof.vHi;
    a.uVPull.value = prof.vPull;
    a.uMinEV.value = prof.minEV;
    a.uMaxEV.value = prof.maxEV;
    a.uLitMaxEV.value = prof.litMaxEV;
    a.uExterior.value = iva ? 0 : 1;
    a.uTauUp.value = prof.up;
    a.uTauDown.value = prof.down;
    a.uComp.value = game.settings.exposureComp || 0;
    a.uOverride.value = exposure.override == null ? -100 : exposure.override;

    // Sun position on screen (render space direction == MCI)
    camQ.copy(camera.quaternion).invert();
    sunV.copy(frame.sunDir).applyQuaternion(camQ); // camera space
    const front = sunV.z < -1e-3;
    sunV.copy(frame.sunDir).multiplyScalar(1e6).project(camera);
    const su = sunV.x * 0.5 + 0.5;
    const sv = sunV.y * 0.5 + 0.5;
    const tanHalf = Math.tan(((camera.fov || 60) * Math.PI) / 360);
    const rUvY = Math.tan(((SUN.angularDiameterDeg / 2) * Math.PI) / 180) / tanHalf / 2;
    a.uSun.value.set(su, sv, front ? 1 : 0);
    a.uSunR.value.set(rUvY / (camera.aspect || 1), rUvY);
    const cu = compositeMat.uniforms;
    cu.uSun.value.set(su, sv, front ? 1 : 0);
    cu.uGlare.value = iva ? 0.8 : 1.0;

    // spacecraft spot meters (never the vessel whose cabin we are sitting in)
    const m = exposureStage.meterMat.uniforms;
    const vs = frame.vessels || game.vessels || {};
    const own = iva ? frame.ivaVessel : null;
    spotFor(own === 'LM' ? null : vs.LM, frame, m.uSpot0.value, tanHalf);
    spotFor(own === 'CSM' ? null : vs.CSM, frame, m.uSpot1.value, tanHalf);

    const film = game.settings.filmGrain !== false;
    cu.uGrain.value = film ? 1 : 0;
    cu.uVignette.value = film ? 1 : 0.35;
    cu.uTime.value = fxTime;
    cu.uBloom.value = bloom.enabled ? bloom.strength * (iva ? BLOOM.strengthIVA / BLOOM.strength : 1) * bloomStage.norm : 0;
  }

  // ---- asynchronous exposure read-back (no pipeline stall) -> ctx.exposureInfo for other modules
  const info = { ev: 0, multiplier: 1, sunVisible: 0, starVisibility: 1, valid: false };
  ctx.exposureInfo = info; // added field: effects/cabins may scale self-luminous things by it
  ctx.exposureTexture = exposureStage.adaptTarget.texture;
  const px8 = new Uint8Array(4);
  let pending = false;
  let frameNo = 0;
  const decode = (b) => {
    info.ev = ((b[0] + b[1] / 255) / 255) * 32 - 16;
    info.multiplier = Math.pow(2, info.ev);
    info.sunVisible = b[2] / 255;
    info.starVisibility = b[3] / 255;
    info.valid = true;
    return info;
  };
  const canAsync = typeof renderer.readRenderTargetPixelsAsync === 'function' && renderer.capabilities.isWebGL2 !== false;
  function pollExposure() {
    if (pending || !canAsync) return;
    pending = true;
    renderer
      .readRenderTargetPixelsAsync(exposureStage.encodeRT, 0, 0, 1, 1, px8)
      .then((b) => decode(b))
      .catch(() => {})
      .finally(() => {
        pending = false;
      });
  }

  function renderChain() {
    // 1. scene -> HDR
    renderer.setRenderTarget(hdrRT);
    renderer.clear(true, true, false);
    renderer.render(scene, camera);
    // 2. exposure
    const adaptTex = exposureStage.run(renderer, quad, hdrRT.texture);
    ctx.exposureTexture = adaptTex;
    // 3. bloom
    let bloomTex = null;
    if (bloom.enabled && bloom.strength > 0) bloomTex = bloomStage.run(renderer, quad, hdrRT.texture, adaptTex, bloom.threshold, bloom.knee);
    // 4. composite -> LDR
    const cu = compositeMat.uniforms;
    cu.tAdapt.value = adaptTex;
    cu.tBloom.value = bloomTex;
    if (!bloomTex) cu.uBloom.value = 0;
    quad.material = compositeMat;
    renderer.setRenderTarget(ldrRT);
    quad.render(renderer);
    // 5. anti-aliasing -> screen
    if (fxaaMat) {
      quad.material = fxaaMat;
      renderer.setRenderTarget(null);
      quad.render(renderer);
    } else {
      smaa.render(renderer, null, ldrRT);
    }
  }

  return {
    exposure,
    bloom,
    /** Debug / compatibility handles. `passes.bloom` is the live bloom settings object. */
    passes: { exposure: exposureStage, bloom, bloomStage, composite: compositeMat, aa: smaa || fxaaMat },
    targets: { hdr: hdrRT, ldr: ldrRT },
    render(frame) {
      syncSize();
      updateUniforms(frame);
      frameNo++;
      exposureStage.encode = frameNo % 4 === 0 || !info.valid;
      renderChain();
      if (exposureStage.encode) pollExposure();
    },
    setSize,
    /**
     * Read back the current exposure synchronously (debug/tests only — stalls the GPU pipeline).
     * @returns {{ev:number, multiplier:number, sunVisible:number, starVisibility:number}}
     */
    readExposure() {
      renderer.readRenderTargetPixels(exposureStage.encodeRT, 0, 0, 1, 1, px8);
      const r = { ...decode(px8) };
      exposure.last = r;
      return r;
    },
    dispose() {
      window.removeEventListener('resize', syncSize);
      hdrRT.dispose();
      ldrRT.dispose();
      exposureStage.dispose();
      bloomStage.dispose();
      compositeMat.dispose();
      if (fxaaMat) fxaaMat.dispose();
      if (smaa) smaa.dispose();
      quad.dispose();
    },
  };
}
