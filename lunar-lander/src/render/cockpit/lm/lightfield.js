// Cabin light field (LM-CABIN agent).
//
// Indirect light in the LM cabin (the renderer's hemisphere "ground bounce", and the cabin's interior
// environment map) is uniform in three.js: every surface receives the same ambient no matter whether
// it faces the glowing windows or sits deep in the aft midsection behind the PLSS. Real cabin light
// falls off strongly away from the windows and toward the floor and corners. This patches the cabin's
// own MeshStandardMaterials (never the kit's shared ones) to scale their INDIRECT diffuse/specular
// (applied right after three's ambient-occlusion step) by a smooth function of the cabin-space
// position — a cheap, stable stand-in for baked global illumination. Direct lights (sun patches,
// floods, window area lights) are not affected.
import * as THREE from 'three';

/** Shared uniforms (one set for the whole cabin). */
export function createLightField() {
  const uniforms = {
    uCabinInv: { value: new THREE.Matrix4() }, // world(render) -> cabin body frame
    uFieldAft: { value: 0.45 }, // indirect multiplier deep in the aft midsection
    uFieldFloor: { value: 0.55 }, // multiplier at floor level
  };
  const glsl = /* glsl */ `
    uniform mat4 uCabinInv;
    uniform float uFieldAft;
    uniform float uFieldFloor;
    varying vec3 vCabinPos;
    float cabinField() {
      vec3 p = vCabinPos;
      // distance behind the windows (front cabin z -1.25 .. -0.18, midsection to +1.2)
      float aft = smoothstep(-1.0, 1.05, p.z);
      float f = mix(1.0, uFieldAft, aft);
      // floor and lower walls are darker (the windows look down past them)
      f *= mix(uFieldFloor, 1.0, smoothstep(3.46, 4.35, p.y));
      // under the ceiling the light from the windows is weaker too
      f *= mix(1.0, 0.8, smoothstep(5.35, 5.7, p.y));
      // lateral: the outboard corners behind the side consoles
      f *= mix(1.0, 0.75, smoothstep(0.85, 1.15, abs(p.x)) * (1.0 - smoothstep(4.6, 5.0, p.y)));
      return f;
    }
  `;
  const patched = new WeakSet();
  return {
    uniforms,
    /** Patch a material (idempotent). */
    patch(m) {
      if (!m || patched.has(m) || !m.isMeshStandardMaterial) return;
      patched.add(m);
      const prev = m.onBeforeCompile;
      const prevKey = m.customProgramCacheKey ? m.customProgramCacheKey.bind(m) : () => '';
      m.onBeforeCompile = (sh, r) => {
        if (prev) prev.call(m, sh, r);
        sh.uniforms.uCabinInv = uniforms.uCabinInv;
        sh.uniforms.uFieldAft = uniforms.uFieldAft;
        sh.uniforms.uFieldFloor = uniforms.uFieldFloor;
        sh.vertexShader = sh.vertexShader
          .replace('#include <common>', '#include <common>\nuniform mat4 uCabinInv;\nvarying vec3 vCabinPos;')
          .replace(
            '#include <project_vertex>',
            `#include <project_vertex>
            #ifdef USE_INSTANCING
              vCabinPos = (uCabinInv * modelMatrix * instanceMatrix * vec4(transformed, 1.0)).xyz;
            #else
              vCabinPos = (uCabinInv * modelMatrix * vec4(transformed, 1.0)).xyz;
            #endif`,
          );
        sh.fragmentShader = sh.fragmentShader
          .replace('#include <common>', '#include <common>\n' + glsl)
          .replace(
            '#include <aomap_fragment>',
            `#include <aomap_fragment>
            {
              float cf = cabinField();
              reflectedLight.indirectDiffuse *= cf;
              reflectedLight.indirectSpecular *= mix(1.0, cf, 0.7);
            }`,
          );
      };
      m.customProgramCacheKey = () => prevKey() + '|lmfield';
      m.needsUpdate = true;
    },
    /** Update the world->cabin matrix (call after the root's world matrix is updated). */
    update(root) {
      uniforms.uCabinInv.value.copy(root.matrixWorld).invert();
    },
  };
}
