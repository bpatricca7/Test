// The Sun: a 0.533-deg HDR disc with limb darkening, seen from airless space (no atmosphere, no
// scattering: a hard-edged white disc in a black sky). Glare/bloom is added in post.js from the
// pixels that are actually visible, so terrain and spacecraft occlude it correctly.
//
// Owned by the SKY-FX agent.

import * as THREE from 'three';
import { SUN } from '../../core/constants.js';

const D = 4.5e7; // m — proxy distance (inside the far plane; sky objects are drawn first, no depth)
/** HDR radiance at disc centre (three.js units). Far above anything else (post clamps & detects it). */
export const SUN_RADIANCE = 3.0e4;
/** Threshold used by post.js to recognise Sun pixels in the HDR buffer. */
export const SUN_DETECT = 2000;

const vert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform vec3 uCenter;
  uniform vec3 uRight;
  uniform vec3 uUp;
  uniform float uHalf;
  varying vec2 vUv;
  void main() {
    vUv = position.xy;
    vec3 p = uCenter + (position.x * uRight + position.y * uUp) * uHalf;
    gl_Position = projectionMatrix * (viewMatrix * vec4(p, 1.0));
    #include <logdepthbuf_vertex>
  }
`;

const frag = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uColor;
  uniform float uRadiance;
  uniform float uRel;   // disc radius in quad units
  varying vec2 vUv;
  void main() {
    #include <logdepthbuf_fragment>
    float r = length(vUv) / uRel;
    float aa = max(fwidth(r), 1e-4);
    float cov = 1.0 - smoothstep(1.0 - aa, 1.0 + aa, r);
    if (cov <= 0.0) discard;
    float mu = sqrt(max(0.0, 1.0 - min(r, 1.0) * min(r, 1.0)));
    // limb darkening (Neckel & Labs style, visible band): I(mu)/I(1) = 1 - u (1 - mu) - v (1 - mu^2)
    float ld = 1.0 - 0.47 * (1.0 - mu) - 0.23 * (1.0 - mu * mu);
    // slightly redder limb
    vec3 col = uColor * vec3(1.0, 0.97 + 0.03 * mu, 0.92 + 0.08 * mu);
    gl_FragColor = vec4(col * uRadiance * ld * cov, 1.0);
  }
`;

/**
 * @param {object} ctx RenderContext
 * @returns {{object: THREE.Mesh, update(frame): void}}
 */
export function createSun(ctx) {
  const radius = D * Math.tan((SUN.angularDiameterDeg / 2) * (Math.PI / 180));
  const halfQuad = radius * 1.6;
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uCenter: { value: new THREE.Vector3() },
      uRight: { value: new THREE.Vector3() },
      uUp: { value: new THREE.Vector3() },
      uHalf: { value: halfQuad },
      uRel: { value: radius / halfQuad },
      uColor: { value: new THREE.Color(SUN.color) },
      uRadiance: { value: SUN_RADIANCE },
    },
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const geo = new THREE.PlaneGeometry(2, 2);
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1e6 + 2;
  mesh.layers.set(ctx.LAYERS.WORLD);
  mesh.name = 'sun';
  const tmp = new THREE.Vector3();
  return {
    object: mesh,
    update(frame) {
      const s = frame.sunDir;
      const u = mat.uniforms;
      u.uCenter.value.copy(s).multiplyScalar(D);
      tmp.set(0, 0, 1);
      if (Math.abs(s.z) > 0.9) tmp.set(1, 0, 0);
      u.uRight.value.crossVectors(tmp, s).normalize();
      u.uUp.value.crossVectors(s, u.uRight.value).normalize();
    },
  };
}
