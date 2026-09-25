// Shared uniforms + GLSL snippets. The "bloom" (the world turning green) is a
// growing circle around the planting spot that every material listens to.
import * as THREE from 'three';

export const LAYOUT = {
  work: [-4.2, 2.6], // Bolt's stacking spot
  pile: [-1.5, -4.8], // junk pile where the sprout is found
  lumaLand: [3.2, -8.5],
  plant: [2.6, 1.6], // planting spot = center of the magic bloom
  seat: [-7.5, 7.5], // sunset seat
};

// Spots where the characters act: keep loose junk out of them.
export const KEEP_CLEAR = [
  [-7.2, 5.6, 1.6], [-5.4, 5.0, 1.6], [-3.6, 4.4, 1.8], [-1.6, 4.0, 1.6], [-3.6, 3.2, 1.6], // Bolt's intro + work area
  [-1.5, -4.2, 1.4], [0.2, -6.2, 1.6], [1.6, -7.2, 1.6], [3.2, -8.5, 2.2], // pile, hiding spot, meeting, landing
  [0.3, -1.8, 2.6], [-3.6, -0.6, 1.2], [-0.2, 0.7, 1.4], [3.1, 1.9, 1.4], [4.2, 2.3, 1.4], // loops + chase
  [2.6, 1.6, 2.4], [-8.0, 8.8, 2.0], // planting spot, sunset seat
];
// Opening crane shot corridor: no towers here.
export const CAMERA_CORRIDOR = [[3, 50, 6], [3, 42, 6], [3, 34, 6], [2.5, 26, 5], [2, 19, 5], [0.8, 14, 4]];

export const shared = {
  uBloomCenter: { value: new THREE.Vector2(LAYOUT.plant[0], LAYOUT.plant[1]) },
  uBloomRadius: { value: -20 },
  uFrontGlow: { value: 0 },
  uTime: { value: 0 },
  uWind: { value: 1 },
};

export const NOISE_GLSL = /* glsl */ `
float gHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float gNoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(gHash(i), gHash(i + vec2(1, 0)), u.x), mix(gHash(i + vec2(0, 1)), gHash(i + vec2(1, 1)), u.x), u.y);
}
float bloomMask(vec3 wp, float soft) {
  float d = length(wp.xz - uBloomCenter);
  float edge = uBloomRadius + (gNoise(wp.xz * 0.22) - 0.5) * 5.0;
  return 1.0 - smoothstep(edge - soft, edge, d);
}
float bloomFront(vec3 wp) {
  float d = length(wp.xz - uBloomCenter);
  float edge = uBloomRadius + (gNoise(wp.xz * 0.22) - 0.5) * 5.0;
  return exp(-pow((d - edge) / 1.6, 2.0));
}
`;

export const UNIFORM_DECL = /* glsl */ `
uniform vec2 uBloomCenter;
uniform float uBloomRadius, uFrontGlow, uTime, uWind;
`;

// Adds world-position varying + shared uniforms to a built-in material.
export function patchMaterial(material, { vertexHead = '', vertexBody = '', fragHead = '', fragReplace = {} , key }) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, shared);
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${UNIFORM_DECL}\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\n${NOISE_GLSL}\n${vertexHead}`)
      .replace('#include <project_vertex>', `${vertexBody}\n#include <project_vertex>`)
      .replace(
        '#include <worldpos_vertex>',
        `#include <worldpos_vertex>
        {
          vec4 wp4 = vec4(transformed, 1.0);
          vec3 wn = objectNormal;
          #ifdef USE_INSTANCING
            wp4 = instanceMatrix * wp4;
            wn = mat3(instanceMatrix) * wn;
          #endif
          vWPos = (modelMatrix * wp4).xyz;
          vWNormal = normalize(mat3(modelMatrix) * wn);
        }`,
      );
    let fs = shader.fragmentShader.replace('#include <common>', `#include <common>\n${UNIFORM_DECL}\nvarying vec3 vWPos;\nvarying vec3 vWNormal;\n${NOISE_GLSL}\n${fragHead}`);
    for (const [k, v] of Object.entries(fragReplace)) fs = fs.replace(k, v);
    shader.fragmentShader = fs;
  };
  material.customProgramCacheKey = () => key;
  return material;
}
