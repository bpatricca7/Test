// Distant-CSM stand-in. When the CSM would project to less than SPECK_PX (1.5 px) — e.g. seen from
// the LM on the surface or during powered descent, hundreds of km away — csmModel.js hides its ~40
// draws / 76k triangles and draws this single sunlit point instead: the "moving star" the Apollo crews
// saw when the command module passed overhead. Owned by the CSM-MODEL agent.
//
// The point uses the same Gaussian point-spread function as the sky's stars (render/sky/stars.js), so
// its integrated energy does not depend on where it falls on the pixel grid (no shimmer while it
// drifts across the sky). Its brightness is the larger of
//   - PHYSICAL: mean sunlit radiance x projected area in pixels x Lambert-sphere phase — continuous
//     with the resolved model at the hand-over size, so nothing pops;
//   - PERCEPTUAL: the star scale of sky/stars.js applied to the vehicle's real apparent magnitude
//     (about mag -3.5 at 100 km, -0.7 at 380 km at full phase), gated like the stars by the camera's
//     dark-adaptation state (ctx.exposureTexture .a) and capped at the hand-over brightness.
// The SM rendezvous beacon (a xenon flash once per second, visible at hundreds of km) is added on the
// perceptual scale while it flashes. Nothing but the flash is drawn while the CSM is in the Moon's
// shadow.

import * as THREE from 'three';
import { SUN, MOON } from '../../../core/constants.js';

/** Hand-over size: below this projected diameter (physical px) the point replaces the model. */
export const SPECK_PX = 1.5;
/** Integrated brightness of a magnitude-0 star in sky/stars.js (render radiance x CSS px^2). */
const STAR_K = 0.2;
const SUN_MAG = -26.74;
/** Effective hemispherical albedo of the CSM (aluminised-Mylar CM, white-painted SM and radiators). */
export const CSM_ALBEDO = 0.5;
/**
 * Mean projected area of the CSM (m^2): a quarter of the surface area of the convex hull
 * (SM cylinder 3.9 m x 7.5 m, CM cone, SPS bell).
 */
export const CSM_AREA = 34;
const SIGMA_CSS = 0.62; // PSF sigma (CSS px), as the faint stars

const vert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform vec3 uPhys;       // physical peak radiance
  uniform vec3 uStar;       // perceptual (star-scale) peak radiance, before adaptation gating
  uniform vec3 uFlash;      // beacon flash (not gated: a xenon flash reads even in a bright frame)
  uniform float uSize;
  uniform sampler2D tAdapt; // post.js adaptation state (a = star visibility)
  uniform float uUseAdapt;
  varying vec3 vColor;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float vis = uUseAdapt > 0.5 ? clamp(texture2D(tAdapt, vec2(0.5)).a, 0.0, 1.0) : 1.0;
    vColor = max(uPhys, uStar * vis) + uFlash * mix(0.35, 1.0, vis);
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
const TINT = new THREE.Vector3(0.97, 0.99, 1.0); // silver/white vehicle: neutral, a touch cool
const _p = new THREE.Vector3();
const _c = new THREE.Vector3();
const _ds = new THREE.Vector2();

/**
 * Projected diameter of a sphere of radius `radius` at `dist` metres, in physical pixels.
 * @param {object} ctx RenderContext (camera fov, renderer drawing-buffer height)
 */
export function projectedPx(ctx, radius, dist) {
  const fov = ctx.camera?.fov || 60;
  const h = ctx.renderer?.getDrawingBufferSize ? ctx.renderer.getDrawingBufferSize(_ds).y : 1080;
  const pxAngle = (2 * Math.tan((fov * Math.PI) / 360)) / Math.max(1, h);
  return (2 * radius) / (Math.max(1e-3, dist) * pxAngle);
}

/**
 * Lambert-sphere phase function.
 * @param {number} cosA cosine of the Sun-vehicle-observer angle
 */
export function lambertPhase(cosA) {
  const c = Math.max(-1, Math.min(1, cosA));
  const a = Math.acos(c);
  return ((Math.PI - a) * c + Math.sin(a)) / Math.PI;
}

/** true when the MCI point is inside the Moon's shadow cylinder (Sun direction `sun`, unit). */
export function inMoonShadow(pMCI, sun) {
  if (!sun) return false;
  const s = pMCI.dot(sun);
  return s < 0 && _p.copy(pMCI).addScaledVector(sun, -s).length() < MOON.radius;
}

/**
 * Create the speck (a single-vertex THREE.Points) to be added to the CSM root.
 * @param {object} ctx RenderContext
 * @param {{radius: number, area?: number, albedo?: number}} o bounding radius (m), mean projected area
 * @returns {{points: THREE.Points, update(frame: object, centreMCI: THREE.Vector3, flashOn: boolean): void,
 *   info: {phase: number, lit: number, mag: number}, dispose(): void}}
 */
export function createSpeck(ctx, o) {
  const area = o.area ?? CSM_AREA;
  const albedo = o.albedo ?? CSM_ALBEDO;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(3), 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), o.radius);
  const mat = new THREE.ShaderMaterial({
    name: 'CSM speck',
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uPhys: { value: new THREE.Vector3() },
      uStar: { value: new THREE.Vector3() },
      uFlash: { value: new THREE.Vector3() },
      uSize: { value: 6 },
      uSigma: { value: SIGMA_CSS },
      tAdapt: { value: null },
      uUseAdapt: { value: 0 },
    },
    blending: THREE.AdditiveBlending,
    depthTest: true, // hidden behind the Moon / the other spacecraft
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  });
  mat.userData.noShadow = true;
  const points = new THREE.Points(g, mat);
  points.name = 'CSM speck';
  points.castShadow = false;
  points.receiveShadow = false;
  points.userData.ivaVisible = true;
  // FX layer: seen by the main camera only (not by the vessel-shadow or sunlight shadow passes)
  points.layers.set(ctx.LAYERS?.FX ?? 4);
  points.visible = false;
  const info = { phase: 0, lit: 0, mag: Infinity };

  return {
    points,
    info,
    /**
     * @param {object} frame FrameContext (origin = camera MCI, sunDir)
     * @param {THREE.Vector3} centreMCI MCI position of the vehicle's centre
     * @param {boolean} flashOn rendezvous beacon flashing this frame
     */
    update(frame, centreMCI, flashOn) {
      const U = mat.uniforms;
      _c.copy(centreMCI).sub(frame.origin); // camera -> vehicle
      const d = Math.max(1, _c.length());
      const pr = ctx.renderer?.getPixelRatio ? ctx.renderer.getPixelRatio() : 1;
      const px = projectedPx(ctx, o.radius, d); // diameter in physical px
      const pxPerM = px / (2 * o.radius);
      const sun = frame.sunDir;
      const phase = sun ? lambertPhase(-_c.dot(sun) / d) : 1;
      const lit = inMoonShadow(centreMCI, sun) ? 0 : 1;
      const L = (SUN.intensity * albedo) / Math.PI; // sunlit radiance at full phase
      const fluxPhys = L * area * pxPerM * pxPerM * phase * lit;
      // hand-over brightness: the cap of the perceptual term, so the speck is never brighter than the
      // resolved model it replaces
      const capFull = (L * area * SPECK_PX * SPECK_PX) / (4 * o.radius * o.radius);
      const cap = capFull * phase * lit;
      // perceptual: real apparent magnitude on the star scale (CSS px^2 -> physical px^2)
      const ratio = (albedo * area * phase * lit) / (Math.PI * d * d);
      info.phase = phase;
      info.lit = lit;
      info.mag = ratio > 0 ? SUN_MAG - 2.5 * Math.log10(ratio) : Infinity;
      const star = ratio > 0 ? Math.min(cap, Math.pow(10, -0.4 * info.mag) * STAR_K * pr * pr) : 0;
      let flash = 0;
      if (flashOn) {
        // xenon rendezvous beacon: ~ magnitude -3 at 100 km for the short flash
        const m = -3 + 5 * Math.log10(d / 1e5);
        flash = Math.min(4 * capFull, Math.pow(10, -0.4 * m) * STAR_K * pr * pr);
      }
      const sigma = SIGMA_CSS * pr;
      const norm = 1 / (2 * Math.PI * sigma * sigma);
      U.uPhys.value.set(SUN_COLOR.r, SUN_COLOR.g, SUN_COLOR.b).multiply(TINT).multiplyScalar(fluxPhys * norm);
      U.uStar.value.set(SUN_COLOR.r, SUN_COLOR.g, SUN_COLOR.b).multiply(TINT).multiplyScalar(star * norm);
      U.uFlash.value.set(0.9, 0.95, 1.0).multiplyScalar(flash * norm); // xenon: blue-white
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
