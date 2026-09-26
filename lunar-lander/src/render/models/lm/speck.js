// Distant-LM stand-in: when the LM (or the descent stage left on the surface) would project to less
// than ~1.5 px, lmModel.js hides its ~50 meshes / 40k triangles and draws this single sunlit point
// instead. Owned by the LM-MODEL agent.
//
// The point uses the same Gaussian point-spread function as the sky module's stars (sky/stars.js), so
// its integrated energy does not depend on where it falls on the pixel grid (no shimmer while it
// drifts). Its brightness is the larger of
//   - PHYSICAL: mean sunlit radiance x projected area in pixels x Lambert-sphere phase — continuous
//     with the resolved model at the hand-over size, so nothing pops;
//   - PERCEPTUAL: the star scale of sky/stars.js applied to the vehicle's real apparent magnitude
//     (the Apollo crews saw each other as a bright "star" at 100+ km), gated like the stars by the
//     camera's dark-adaptation state (ctx.exposureTexture .a) and capped at the hand-over brightness.
// The ascent stage's tracking light (a 1-Hz xenon flash, specified visible at hundreds of km) is
// added on the perceptual scale while it flashes. Nothing is drawn while the vehicle is in the
// Moon's shadow (apart from the flash).

import * as THREE from 'three';
import { SUN, MOON } from '../../../core/constants.js';

/** Hand-over size: below this projected diameter (physical px) the point replaces the model. */
export const SPECK_PX = 1.5;
/** Integrated brightness of a magnitude-0 star in sky/stars.js (render radiance x CSS px^2). */
const STAR_K = 0.2;
const SUN_MAG = -26.74;
/** Effective hemispherical albedo of the LM (gold/black foil, grey panels). */
const ALBEDO = 0.3;
const SIGMA_CSS = 0.62; // PSF sigma (CSS px), as the faint stars

const vert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform vec3 uPhys;       // physical peak radiance
  uniform vec3 uStar;       // perceptual (star-scale) peak radiance, before adaptation gating
  uniform float uSize;
  uniform sampler2D tAdapt; // post.js adaptation state (a = star visibility)
  uniform float uUseAdapt;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float vis = uUseAdapt > 0.5 ? clamp(texture2D(tAdapt, vec2(0.5)).a, 0.0, 1.0) : 1.0;
    vColor = max(uPhys, uStar * vis);
    gl_PointSize = uSize;
    #include <logdepthbuf_vertex>
  }
`;

const frag = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uSigma;
  uniform float uSize;
  varying vec3 vColor;
  void main() {
    #include <logdepthbuf_fragment>
    vec2 d = (gl_PointCoord - 0.5) * uSize;
    float psf = exp(-0.5 * dot(d, d) / (uSigma * uSigma));
    gl_FragColor = vec4(vColor * psf, 1.0);
  }
`;

const SUN_COLOR = new THREE.Color(SUN.color);
const _p = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ds = new THREE.Vector2();

/**
 * Projected size of a sphere of radius `radius` at `dist` metres, in physical pixels.
 * @param {object} ctx RenderContext (camera fov, renderer drawing-buffer height)
 */
export function projectedPx(ctx, radius, dist) {
  const fov = ctx.camera?.fov || 60;
  const h = ctx.renderer?.getDrawingBufferSize ? ctx.renderer.getDrawingBufferSize(_ds).y : 1080;
  const pxAngle = (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(1, h);
  return (2 * radius) / (Math.max(1e-3, dist) * pxAngle);
}

/**
 * Create one speck (a single-vertex THREE.Points) to be added to a model group.
 * @param {object} ctx RenderContext
 * @param {{name: string, radius: number, area: number, flash?: boolean}} o bounding radius (m),
 *   mean projected area (m^2), whether it carries the tracking light
 * @returns {{points: THREE.Points, update(frame: object, centreMCI: THREE.Vector3, flashOn: boolean): void}}
 */
export function createSpeck(ctx, o) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), o.radius);
  const mat = new THREE.ShaderMaterial({
    name: `${o.name} speck`,
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uPhys: { value: new THREE.Vector3() },
      uStar: { value: new THREE.Vector3() },
      uSize: { value: 6 },
      uSigma: { value: SIGMA_CSS },
      tAdapt: { value: null },
      uUseAdapt: { value: 0 },
    },
    blending: THREE.AdditiveBlending,
    depthTest: true, // hidden behind the Moon / the own spacecraft
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  });
  mat.userData.noShadow = true;
  const points = new THREE.Points(g, mat);
  points.name = `${o.name} speck`;
  points.castShadow = false;
  points.receiveShadow = false;
  // FX layer: seen by the main camera only (not by the vessel-shadow or sunlight shadow passes)
  points.layers.set(ctx.LAYERS?.FX ?? 4);
  points.visible = false;

  return {
    points,
    /**
     * @param {object} frame FrameContext
     * @param {THREE.Vector3} centreMCI MCI position of the vehicle's centre
     * @param {boolean} flashOn tracking light flashing this frame
     */
    update(frame, centreMCI, flashOn) {
      const U = mat.uniforms;
      _c.copy(centreMCI).sub(frame.origin); // camera -> vehicle (render space: camera at 0)
      const d = Math.max(1, _c.length());
      const pr = ctx.renderer?.getPixelRatio ? ctx.renderer.getPixelRatio() : 1;
      const px = projectedPx(ctx, o.radius, d); // diameter in physical px
      const pxPerM = px / (2 * o.radius);
      // phase (Lambert sphere): alpha = Sun - vehicle - observer angle
      const sun = frame.sunDir;
      const cosA = sun ? Math.max(-1, Math.min(1, -_c.dot(sun) / d)) : 1;
      const a = Math.acos(cosA);
      const phase = ((Math.PI - a) * cosA + Math.sin(a)) / Math.PI;
      // Moon shadow (cylinder)
      let lit = 1;
      if (sun) {
        const s = centreMCI.dot(sun);
        if (s < 0 && _p.copy(centreMCI).addScaledVector(sun, -s).length() < MOON.radius) lit = 0;
      }
      const L = (SUN.intensity * ALBEDO) / Math.PI; // sunlit radiance at full phase
      const areaPx = o.area * pxPerM * pxPerM;
      const fluxPhys = L * areaPx * phase * lit;
      // hand-over brightness: the cap for the perceptual term (same phase / shadow as the model), so
      // the speck is never brighter than the resolved model it replaces
      const capPx = (o.area * SPECK_PX * SPECK_PX) / (4 * o.radius * o.radius);
      const capFull = L * capPx;
      const cap = capFull * phase * lit;
      // perceptual: real apparent magnitude on the star scale (CSS px^2 -> physical px^2)
      const ratio = (ALBEDO * o.area * phase * lit) / (Math.PI * d * d);
      let star = ratio > 0 ? Math.pow(10, -0.4 * (SUN_MAG - 2.5 * Math.log10(ratio))) * STAR_K * pr * pr : 0;
      star = Math.min(star, cap);
      if (o.flash && flashOn) {
        // xenon tracking light: ~ magnitude -3 at 100 km for the 80-ms flash
        const m = -3 + 5 * Math.log10(d / 1e5);
        star += Math.min(4 * capFull, Math.pow(10, -0.4 * m) * STAR_K * pr * pr);
      }
      const sigma = SIGMA_CSS * pr;
      const norm = 1 / (2 * Math.PI * sigma * sigma);
      U.uPhys.value.set(SUN_COLOR.r, SUN_COLOR.g, SUN_COLOR.b).multiplyScalar(fluxPhys * norm);
      // gold-dominated vehicle: a faint warm cast on the reflected light
      U.uPhys.value.multiply(_p.set(1.0, 0.93, 0.8));
      U.uStar.value.set(SUN_COLOR.r, SUN_COLOR.g, SUN_COLOR.b).multiply(_p.set(1.0, 0.95, 0.85)).multiplyScalar(star * norm);
      U.uSigma.value = sigma;
      U.uSize.value = Math.ceil(sigma * 7) + 1;
      const tex = ctx.exposureTexture || null;
      U.tAdapt.value = tex;
      U.uUseAdapt.value = tex ? 1 : 0;
    },
    dispose() {
      g.dispose();
      mat.dispose();
    },
  };
}
