// Star field: point sprites at infinity with an analytic Gaussian point-spread function.
//
// Each star is drawn as a small sprite centred exactly on its (sub-pixel) projected position; the
// fragment shader evaluates a normalised Gaussian PSF, so a star's integrated energy is the same no
// matter where it falls on the pixel grid — no shimmering or popping while the camera turns.
// Radiance is physical up to one art-directed constant: flux ~ 10^(-0.4 m). Auto-exposure in post.js
// decides what is visible: bright stars remain barely visible over a sunlit landscape, the full
// field (and the Milky Way) comes out when the view is dark.
//
// Owned by the SKY-FX agent.

import * as THREE from 'three';
import { buildStarCatalog } from './starCatalog.js';

export const SKY_RADIUS = 1e8; // m — "infinity" (inside the camera far plane of 1e9 m)
/** Integrated star brightness of a magnitude-0 star (render radiance x CSS px^2). */
const STAR_K = 0.2;

const vert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  attribute float aMag;
  attribute vec3 aColor;
  uniform float uPixelRatio;
  uniform float uGain;
  uniform float uZoom;      // > 1 when the camera zooms in (narrow FOV): fainter stars resolve better
  varying vec3 vColor;
  varying float vSigma;     // PSF sigma in physical pixels
  varying float vSize;
  void main() {
    vec4 mv = viewMatrix * vec4(position * 1.0e8, 1.0);
    gl_Position = projectionMatrix * mv;
    float flux = pow(10.0, -0.4 * aMag) * uGain * mix(1.0, uZoom, 0.5);
    // brighter stars get a slightly wider core (film/eye saturation)
    float sigmaCss = clamp(0.62 + 0.16 * (2.5 - aMag), 0.62, 1.35);
    float sigma = sigmaCss * uPixelRatio;
    float peak = flux * ${STAR_K.toFixed(3)} / (6.2831853 * sigmaCss * sigmaCss);
    vColor = aColor * peak;
    vSigma = sigma;
    vSize = ceil(sigma * 7.0) + 1.0;
    gl_PointSize = vSize;
    #include <logdepthbuf_vertex>
  }
`;

const frag = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  varying vec3 vColor;
  varying float vSigma;
  varying float vSize;
  void main() {
    #include <logdepthbuf_fragment>
    vec2 d = (gl_PointCoord - 0.5) * vSize;
    float r2 = dot(d, d);
    float psf = exp(-0.5 * r2 / (vSigma * vSigma));
    // faint wide wing (lens scatter) so the brightest stars have a soft glow
    psf += 0.012 * exp(-0.5 * r2 / (9.0 * vSigma * vSigma));
    gl_FragColor = vec4(vColor * psf, 1.0);
  }
`;

/**
 * Create the star field Points object.
 * @param {object} ctx RenderContext
 * @returns {{object: THREE.Points, update(frame): void, catalog: object}}
 */
export function createStars(ctx) {
  const n = ctx.quality === 'low' ? 5000 : 9000;
  const cat = buildStarCatalog({ count: n });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(cat.dir, 3));
  g.setAttribute('aMag', new THREE.BufferAttribute(cat.mag, 1));
  g.setAttribute('aColor', new THREE.BufferAttribute(cat.color, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SKY_RADIUS);
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uPixelRatio: { value: 1 },
      uGain: { value: 1 },
      uZoom: { value: 1 },
    },
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    transparent: false, // stays in the opaque list so renderOrder puts it before everything else
    toneMapped: false,
  });
  const pts = new THREE.Points(g, mat);
  pts.frustumCulled = false;
  pts.renderOrder = -1e6 + 1;
  pts.layers.set(ctx.LAYERS.WORLD);
  pts.name = 'stars';
  return {
    object: pts,
    catalog: cat,
    update(frame) {
      mat.uniforms.uPixelRatio.value = ctx.renderer.getPixelRatio();
      const fov = ctx.camera.fov || 60;
      mat.uniforms.uZoom.value = Math.max(1, 55 / fov);
    },
  };
}
