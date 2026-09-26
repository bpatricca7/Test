// Milky Way: a sky dome sampling a galactic-coordinate texture (skyGen.js), very faint in absolute
// terms — it only emerges when auto-exposure opens up for a dark view (night side, looking away
// from sunlit surfaces), exactly like a real camera.
//
// Owned by the SKY-FX agent.

import * as THREE from 'three';
import { mciToGalacticMatrix } from './celestial.js';

const vert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vDir;
  void main() {
    vDir = position;
    vec4 mv = viewMatrix * vec4(position * 1.0e8, 1.0);
    gl_Position = projectionMatrix * mv;
    #include <logdepthbuf_vertex>
  }
`;

const frag = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform sampler2D uTex;
  uniform mat3 uToGal;
  uniform float uIntensity;
  varying vec3 vDir;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 g = uToGal * normalize(vDir);
    float l = atan(g.y, g.x);
    float b = asin(clamp(g.z, -1.0, 1.0));
    // seam-free longitude (pick the parameterisation with the smaller derivative)
    float u1 = l / 6.2831853 + 0.5;
    float u2 = fract(u1 + 0.5) - 0.5;
    float u = fwidth(u1) <= fwidth(u2) + 1e-6 ? u1 : u2;
    vec2 uv = vec2(u, 0.5 - b / 3.14159265);
    vec3 c = texture2D(uTex, uv).rgb;
    c *= c; // sqrt-encoded
    gl_FragColor = vec4(c * uIntensity, 1.0);
  }
`;

/**
 * @param {object} ctx RenderContext
 * @param {THREE.Texture} tex Milky Way texture (galactic equirectangular)
 */
export function createMilkyWay(ctx, tex) {
  const geo = new THREE.SphereGeometry(1, 64, 32);
  const mat = new THREE.ShaderMaterial({
    vertexShader: vert,
    fragmentShader: frag,
    uniforms: {
      uTex: { value: tex },
      uToGal: { value: mciToGalacticMatrix() },
      uIntensity: { value: 0.00022 },
    },
    side: THREE.BackSide,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = -1e6;
  mesh.layers.set(ctx.LAYERS.WORLD);
  mesh.name = 'milkyWay';
  return { object: mesh, material: mat };
}
