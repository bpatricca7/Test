// Post-processing: HDR -> auto-exposure -> bloom -> ACES filmic / sRGB -> SMAA (FXAA on 'low') -> film.
// Contract (ARCHITECTURE.md §6): createPost(ctx) -> { render(frame), setSize(w, h) }
//
// Pipeline (EffectComposer, HalfFloat targets throughout):
//   RenderPass            scene in linear HDR (terrain/sky/vessels output physical-ish radiance)
//   ExposurePass          GPU-only metering + temporal adaptation, no CPU read-back:
//                           1. meter  : 128-px-wide map of log-luminance statistics (16 taps/texel)
//                           2. reduce : 8x8 blocks
//                           3. adapt  : 1x1 ping-pong — target EV from the statistics, clamped per view
//                                       (exterior / IVA), eased with separate brighten/darken rates;
//                                       also measures how much of the Sun disc is visible
//                           4. apply  : colour x exposure, clamp (so the Sun cannot blow the bloom up),
//                                       plus analytic Sun glare scaled by the visible fraction
//   UnrealBloomPass       subtle, high threshold (in exposed units): Sun, engine glow, specular glints,
//                         lit indicator lamps
//   OutputPass            ACES filmic tone mapping + sRGB (renderer.toneMapping / outputColorSpace)
//   SMAAPass | FXAAPass   (no MSAA with the logarithmic depth buffer)
//   FinishPass            dither (always) + optional very subtle film grain & vignette
//                         (game.settings.filmGrain, default on)
//
// Metering (the "photographer"): a log-average in which sunlit pixels dominate and black sky counts
// ~2 %, so a small sunlit spacecraft against space is exposed for the spacecraft, a sunlit landscape
// comes out light grey like Apollo 16-mm film, and an all-dark view opens up (stars, Milky Way).
// A highlight guard (the LINEAR mean of the sunlit pixels must not exceed `hi` after exposure) stops a
// small bright object — the Earth, a distant spacecraft — from being burnt out against the black sky. The Sun disc and
// extreme speculars are excluded from the statistics.
//
// Owned by the SKY-FX agent.

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { SMAAPass } from 'three/addons/postprocessing/SMAAPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { SUN } from '../core/constants.js';

// ------------------------------------------------------------------------------ exposure settings
/**
 * Exposure behaviour per view. EVs are log2 of the linear multiplier applied to scene radiance.
 * key: target for the metered (log-average) luminance; hi: target for the mean of the sunlit pixels
 * (highlight guard); min/max: clamps; up/down: adaptation time constants (s) when the image gets
 * brighter / darker.
 */
export const EXPOSURE_PROFILES = {
  exterior: { key: 0.2, hi: 0.8, minEV: Math.log2(0.04), maxEV: Math.log2(160), up: 1.6, down: 0.45 },
  iva: { key: 0.13, hi: 1.6, minEV: Math.log2(0.25), maxEV: Math.log2(120), up: 1.2, down: 0.35 },
};
const MAX_EXPOSED = 64; // clamp after exposure (ACES is fully white long before that)
const SUN_DETECT = 2000; // HDR radiance that identifies Sun-disc pixels (sun.js draws ~3e4)
const METER_W = 128;

const quadVert = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const meterFrag = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform vec2 uSrcTexel;   // 1 / source size
  uniform vec2 uCell;       // meter cell size in source uv
  varying vec2 vUv;
  void main() {
    vec4 acc = vec4(0.0);
    vec2 base = vUv - 0.5 * uCell;
    for (int j = 0; j < 4; j++) {
      for (int i = 0; i < 4; i++) {
        vec2 uv = base + (vec2(float(i), float(j)) + 0.5) * 0.25 * uCell;
        vec3 c = texture2D(tDiffuse, uv).rgb;
        float L = dot(c, vec3(0.2126, 0.7152, 0.0722));
        if (!(L < ${SUN_DETECT.toFixed(1)})) continue; // Sun / extreme speculars / NaN: ignore
        vec2 q = uv - 0.5;
        float cw = 1.0 - 1.2 * dot(q, q);               // mild centre weighting
        float lit = smoothstep(0.0015, 0.008, L);
        float w = cw * mix(0.02, 1.0, lit);
        float lg = log(max(L, 1e-4));
        // the highlight guard ignores speculars / the Sun's anti-aliased rim (> 30)
        float g = L < 30.0 ? cw * lit : 0.0;
        acc += vec4(w * lg, w, g * L, g);
      }
    }
    gl_FragColor = acc / 16.0;
  }
`;

const reduceFrag = /* glsl */ `
  uniform sampler2D tSrc;
  uniform ivec2 uSrcSize;
  varying vec2 vUv;
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
  uniform ivec2 uReduceSize;
  uniform float uCount;      // number of meter texels
  uniform sampler2D tPrev;
  uniform sampler2D tDiffuse; // HDR scene (Sun visibility)
  uniform float uDt;
  uniform float uSnap;
  uniform float uKey;
  uniform float uHi;
  uniform float uMinEV;
  uniform float uMaxEV;
  uniform float uComp;
  uniform float uTauUp;
  uniform float uTauDown;
  uniform float uOverride;   // > -90: fixed EV
  uniform vec3 uSun;         // xy = Sun uv, z = 1 when in front of the camera
  uniform vec2 uSunR;        // Sun radius in uv (x, y)
  varying vec2 vUv;
  void main() {
    vec4 s = vec4(0.0);
    for (int j = 0; j < 32; j++) {
      if (j >= uReduceSize.y) break;
      for (int i = 0; i < 32; i++) {
        if (i >= uReduceSize.x) break;
        s += texelFetch(tReduce, ivec2(i, j), 0);
      }
    }
    float meanLog = s.x / max(s.y, 1e-6);
    float litCov = s.w / uCount;
    float litMean = s.z / max(s.w, 1e-6); // LINEAR mean of the sunlit pixels (highlight-dominated)
    float evAvg = log2(uKey) - meanLog / log(2.0) + uComp;
    float evHi = log2(uHi / max(litMean, 1e-4)) + uComp;
    float guard = smoothstep(2.0e-5, 4.0e-4, litCov);
    float target = clamp(evAvg, uMinEV, uMaxEV);
    target = min(target, mix(uMaxEV, evHi, guard));
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
    float v = uSnap > 0.5 ? vis : mix(prev.g, vis, 1.0 - exp(-uDt * 25.0));
    gl_FragColor = vec4(ev, v, target, 1.0);
  }
`;

const applyFrag = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform sampler2D tAdapt;
  uniform vec3 uSun;          // xy = Sun uv, z = in front
  uniform float uAspect;      // width / height
  uniform vec3 uSunColor;
  uniform float uGlare;       // glare strength
  varying vec2 vUv;
  void main() {
    vec4 ad = texture2D(tAdapt, vec2(0.5));
    float E = exp2(ad.r);
    vec3 c = texture2D(tDiffuse, vUv).rgb * E;
    c = min(c, vec3(${MAX_EXPOSED.toFixed(1)}));
    c = max(c, vec3(0.0));
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
    gl_FragColor = vec4(c, 1.0);
  }
`;

// Encodes the adapted EV (16-bit fixed point in R/G) and Sun visibility (B) into an RGBA8 texel so the
// CPU can read it back asynchronously (HalfFloat read-back is not portable).
const encodeFrag = /* glsl */ `
  uniform sampler2D tAdapt;
  varying vec2 vUv;
  void main() {
    vec4 a = texture2D(tAdapt, vec2(0.5));
    float x = clamp((a.r + 16.0) / 32.0, 0.0, 1.0) * 255.0;
    gl_FragColor = vec4(floor(x) / 255.0, fract(x), clamp(a.g, 0.0, 1.0), 1.0);
  }
`;

const bloomPrefilterFrag = /* glsl */ `
  uniform sampler2D tDiffuse;
  uniform float luminosityThreshold;
  uniform float smoothWidth; // soft knee width
  varying vec2 vUv;
  void main() {
    vec3 c = texture2D(tDiffuse, vUv).rgb;
    float L = max(c.r, max(c.g, c.b));
    float k = smoothWidth;
    float soft = clamp(L - luminosityThreshold + k, 0.0, 2.0 * k);
    soft = soft * soft / (4.0 * k + 1e-4);
    float w = max(soft, L - luminosityThreshold) / max(L, 1e-4);
    gl_FragColor = vec4(c * w, 1.0);
  }
`;

const finishShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uGrain: { value: 1 },
    uVignette: { value: 1 },
    uAspect: { value: 16 / 9 },
  },
  vertexShader: quadVert,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float uTime;
    uniform float uGrain;
    uniform float uVignette;
    uniform float uAspect;
    varying vec2 vUv;
    float h12(vec2 p) {
      vec3 p3 = fract(vec3(p.xyx) * 0.1031);
      p3 += dot(p3, p3.yzx + 33.33);
      return fract((p3.x + p3.y) * p3.z);
    }
    void main() {
      vec3 c = texture2D(tDiffuse, vUv).rgb; // display-referred sRGB
      vec2 q = (vUv - 0.5) * vec2(uAspect, 1.0);
      // gentle optical vignette (cos^4-like, ~12 % in the corners)
      c *= 1.0 - uVignette * 0.13 * smoothstep(0.15, 1.05, dot(q, q) * 1.6);
      // film grain: luminance-weighted (strongest in the mid-tones), animated, fine
      vec2 px = gl_FragCoord.xy;
      float n = h12(px + fract(uTime * 7.31) * 173.0) + h12(px * 1.37 + fract(uTime * 3.17) * 311.0) - 1.0;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c += uGrain * n * 0.028 * l * (1.0 - l) * 2.0;
      // dither (always): +-0.5 LSB triangular noise kills banding in the black sky gradients
      float dn = h12(px + 0.5 + fract(uTime) * 91.0) - h12(px.yx + 7.0 + fract(uTime) * 57.0);
      c += dn / 255.0;
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

class ExposurePass extends Pass {
  constructor() {
    super();
    this.needsSwap = true;
    const rt = (w, h) =>
      new THREE.WebGLRenderTarget(w, h, {
        type: THREE.HalfFloatType,
        depthBuffer: false,
        minFilter: THREE.NearestFilter,
        magFilter: THREE.NearestFilter,
      });
    this.meterRT = rt(METER_W, 72);
    this.reduceRT = rt(16, 9);
    this.adaptRT = [rt(1, 1), rt(1, 1)];
    this.cur = 0;
    this.meterMat = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: meterFrag,
      uniforms: { tDiffuse: { value: null }, uSrcTexel: { value: new THREE.Vector2() }, uCell: { value: new THREE.Vector2() } },
      depthTest: false,
      depthWrite: false,
    });
    this.reduceMat = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: reduceFrag,
      uniforms: { tSrc: { value: this.meterRT.texture }, uSrcSize: { value: new THREE.Vector2(METER_W, 72) } },
      depthTest: false,
      depthWrite: false,
    });
    this.adaptMat = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: adaptFrag,
      uniforms: {
        tReduce: { value: this.reduceRT.texture },
        uReduceSize: { value: new THREE.Vector2(16, 9) },
        uCount: { value: METER_W * 72 },
        tPrev: { value: null },
        tDiffuse: { value: null },
        uDt: { value: 0 },
        uSnap: { value: 1 },
        uKey: { value: 0.2 },
        uHi: { value: 1.5 },
        uMinEV: { value: -4 },
        uMaxEV: { value: 3 },
        uComp: { value: 0 },
        uTauUp: { value: 1.5 },
        uTauDown: { value: 0.5 },
        uOverride: { value: -100 },
        uSun: { value: new THREE.Vector3() },
        uSunR: { value: new THREE.Vector2() },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.applyMat = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: applyFrag,
      uniforms: {
        tDiffuse: { value: null },
        tAdapt: { value: null },
        uSun: { value: new THREE.Vector3() },
        uAspect: { value: 16 / 9 },
        uSunColor: { value: new THREE.Color(SUN.color) },
        uGlare: { value: 1 },
      },
      depthTest: false,
      depthWrite: false,
    });
    this.encodeRT = new THREE.WebGLRenderTarget(1, 1, { depthBuffer: false, minFilter: THREE.NearestFilter, magFilter: THREE.NearestFilter });
    this.encodeMat = new THREE.ShaderMaterial({
      vertexShader: quadVert,
      fragmentShader: encodeFrag,
      uniforms: { tAdapt: { value: null } },
      depthTest: false,
      depthWrite: false,
    });
    this.encode = false; // set by the owner on frames that should refresh encodeRT
    this.quad = new FullScreenQuad(null);
    this.srcW = 1;
    this.srcH = 1;
  }

  setSize(w, h) {
    this.srcW = w;
    this.srcH = h;
    const mh = Math.max(8, Math.round((METER_W * h) / w));
    this.meterRT.setSize(METER_W, mh);
    const rw = Math.ceil(METER_W / 8);
    const rh = Math.ceil(mh / 8);
    this.reduceRT.setSize(rw, rh);
    this.reduceMat.uniforms.uSrcSize.value.set(METER_W, mh);
    this.adaptMat.uniforms.uReduceSize.value.set(rw, rh);
    this.adaptMat.uniforms.uCount.value = METER_W * mh;
    this.meterMat.uniforms.uSrcTexel.value.set(1 / w, 1 / h);
    this.meterMat.uniforms.uCell.value.set(1 / METER_W, 1 / mh);
    this.applyMat.uniforms.uAspect.value = w / h;
  }

  render(renderer, writeBuffer, readBuffer) {
    const q = this.quad;
    // 1. meter
    this.meterMat.uniforms.tDiffuse.value = readBuffer.texture;
    q.material = this.meterMat;
    renderer.setRenderTarget(this.meterRT);
    q.render(renderer);
    // 2. reduce
    q.material = this.reduceMat;
    renderer.setRenderTarget(this.reduceRT);
    q.render(renderer);
    // 3. adapt (ping-pong)
    const prev = this.adaptRT[this.cur];
    const next = this.adaptRT[1 - this.cur];
    this.adaptMat.uniforms.tPrev.value = prev.texture;
    this.adaptMat.uniforms.tDiffuse.value = readBuffer.texture;
    q.material = this.adaptMat;
    renderer.setRenderTarget(next);
    q.render(renderer);
    this.cur = 1 - this.cur;
    if (this.encode) {
      this.encodeMat.uniforms.tAdapt.value = next.texture;
      q.material = this.encodeMat;
      renderer.setRenderTarget(this.encodeRT);
      q.render(renderer);
    }
    // 4. apply
    this.applyMat.uniforms.tDiffuse.value = readBuffer.texture;
    this.applyMat.uniforms.tAdapt.value = next.texture;
    q.material = this.applyMat;
    renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
    q.render(renderer);
  }

  get adaptTarget() {
    return this.adaptRT[this.cur];
  }

  dispose() {
    this.meterRT.dispose();
    this.reduceRT.dispose();
    this.adaptRT.forEach((r) => r.dispose());
    this.encodeRT.dispose();
    [this.meterMat, this.reduceMat, this.adaptMat, this.applyMat, this.encodeMat].forEach((m) => m.dispose());
    this.quad.dispose();
  }
}

/**
 * Create the post-processing chain.
 * @param {object} ctx RenderContext
 * @returns {{render(frame): void, setSize(w: number, h: number): void, exposure: object,
 *   readExposure(): {ev: number, multiplier: number, sunVisible: number}, composer: EffectComposer}}
 *   Also sets ctx.exposureInfo = {ev, multiplier, sunVisible, valid} (refreshed asynchronously).
 */
export function createPost(ctx) {
  const { renderer, scene, camera, game } = ctx;
  if (game.settings.filmGrain === undefined) game.settings.filmGrain = true; // added setting (UI may expose it)
  if (game.settings.exposureComp === undefined) game.settings.exposureComp = 0; // EV compensation
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const composer = new EffectComposer(renderer); // HalfFloat read/write targets
  composer.setPixelRatio(renderer.getPixelRatio());
  const renderPass = new RenderPass(scene, camera);
  const exposurePass = new ExposurePass();
  const low = ctx.quality === 'low';
  const bloom = new UnrealBloomPass(new THREE.Vector2(256, 256), 0.22, 0.1, 3.0);
  // Replace the stock hard-threshold high-pass (which passes the WHOLE value of every pixel above the
  // threshold, so large over-exposed areas bloom into huge halos) with a subtractive soft-knee
  // prefilter: only the energy above the threshold glows, like real lens scatter of hot spots.
  bloom.highPassUniforms.smoothWidth.value = 1.5;
  bloom.materialHighPassFilter.fragmentShader = bloomPrefilterFrag;
  bloom.materialHighPassFilter.needsUpdate = true;
  // weight the mip chain toward the tight core: a crisp glow around hot spots, only a faint wide skirt
  bloom.compositeMaterial.uniforms.bloomFactors.value = [1.0, 0.55, 0.28, 0.12, 0.05];
  const output = new OutputPass();
  const aa = low ? new FXAAPass() : new SMAAPass();
  const finish = new ShaderPass(finishShader);
  composer.addPass(renderPass);
  composer.addPass(exposurePass);
  composer.addPass(bloom);
  composer.addPass(output);
  composer.addPass(aa);
  composer.addPass(finish);

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
    composer.setPixelRatio(pr);
    composer.setSize(w, h);
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
    const a = exposurePass.adaptMat.uniforms;
    a.uDt.value = wallDt;
    a.uSnap.value = snapFrames > 0 ? 1 : 0;
    if (snapFrames > 0) snapFrames--;
    a.uKey.value = prof.key;
    a.uHi.value = prof.hi;
    a.uMinEV.value = prof.minEV;
    a.uMaxEV.value = prof.maxEV;
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
    const ap = exposurePass.applyMat.uniforms;
    ap.uSun.value.set(su, sv, front ? 1 : 0);
    ap.uGlare.value = iva ? 0.8 : 1.0;

    const film = game.settings.filmGrain !== false;
    finish.uniforms.uGrain.value = film ? 1 : 0;
    finish.uniforms.uVignette.value = film ? 1 : 0.35;
    finish.uniforms.uTime.value = fxTime;
    finish.uniforms.uAspect.value = camera.aspect || 16 / 9;
  }

  // ---- asynchronous exposure read-back (no pipeline stall) -> ctx.exposureInfo for other modules
  const info = { ev: 0, multiplier: 1, sunVisible: 0, valid: false };
  ctx.exposureInfo = info; // added field: effects/cabins may scale self-luminous things by it
  const px8 = new Uint8Array(4);
  let pending = false;
  let frameNo = 0;
  const decode = (b) => {
    info.ev = ((b[0] + b[1] / 255) / 255) * 32 - 16;
    info.multiplier = Math.pow(2, info.ev);
    info.sunVisible = b[2] / 255;
    info.valid = true;
    return info;
  };
  const canAsync = typeof renderer.readRenderTargetPixelsAsync === 'function' && renderer.capabilities.isWebGL2 !== false;
  function pollExposure() {
    if (pending || !canAsync) return;
    pending = true;
    renderer
      .readRenderTargetPixelsAsync(exposurePass.encodeRT, 0, 0, 1, 1, px8)
      .then((b) => decode(b))
      .catch(() => {})
      .finally(() => {
        pending = false;
      });
  }

  return {
    composer,
    exposure,
    passes: { renderPass, exposurePass, bloom, output, aa, finish },
    render(frame) {
      syncSize();
      updateUniforms(frame);
      frameNo++;
      exposurePass.encode = frameNo % 4 === 0 || !info.valid;
      composer.render(frame?.dt || 1 / 60);
      if (exposurePass.encode) pollExposure();
    },
    setSize,
    /**
     * Read back the current exposure synchronously (debug/tests only — stalls the GPU pipeline).
     * @returns {{ev:number, multiplier:number, sunVisible:number}}
     */
    readExposure() {
      renderer.readRenderTargetPixels(exposurePass.encodeRT, 0, 0, 1, 1, px8);
      const r = { ...decode(px8) };
      exposure.last = r;
      return r;
    },
  };
}
