// scene.environment: a PMREM-filtered environment for image-based reflections on gold foil, Mylar,
// polished metal and window glass.
//
// The environment is rendered from a tiny procedural scene — a sphere around the cube camera whose
// shader traces each direction against the Moon (unit sphere, camera at the vessel's radius):
//   * black sky (stars are far too faint to matter in reflections);
//   * the Sun as a small spot (a few % of the direct light — the directional light already provides
//     the analytic highlight; the spot gives mirror-like surfaces a visible sun reflection);
//   * the lunar ground: Lommel–Seeliger reflectance with the opposition surge (bright down-Sun, dark
//     toward the Sun), lit only where the Sun is up (terminator/night side from orbit), limb and horizon
//     at the true dip for the current altitude.
// Rebuilt when the local vertical moves > 3 deg, the altitude changes by > 15 %, or every 10 s.
//
// Owned by the SKY-FX agent.

import * as THREE from 'three';
import { MOON, SUN } from '../../core/constants.js';

const envVert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vDir;
  void main() {
    vDir = position;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    #include <logdepthbuf_vertex>
  }
`;

const envFrag = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uUp;        // local vertical at the vessel (MCI)
  uniform float uRadius;   // vessel radius / Moon radius (>= 1)
  uniform vec3 uSunDir;
  uniform float uSunI;
  uniform float uAlbedo;
  uniform float uSunSpot;  // radiance of the env sun spot
  uniform float uSunCos;   // cos of the spot radius
  varying vec3 vDir;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 d = normalize(vDir);
    vec3 c = uUp * uRadius;
    // ray / unit-sphere intersection
    float b = dot(c, d);
    float disc = b * b - (dot(c, c) - 1.0);
    vec3 col = vec3(0.0);
    float t = -b - sqrt(max(disc, 0.0));
    if (disc > 0.0 && t > 0.0) {
      vec3 n = normalize(c + d * t);
      float mu0 = dot(n, uSunDir);
      float mu = max(dot(n, -d), 0.0);
      if (mu0 > 0.0) {
        float cosA = clamp(dot(uSunDir, -d), -1.0, 1.0);
        float alpha = acos(cosA);
        // Lommel-Seeliger with a simple phase function and opposition surge
        float phase = exp(-0.9 * alpha) * (1.0 + 0.8 * exp(-alpha / 0.06));
        float r = 2.0 * mu0 / (mu0 + mu + 1e-3) * phase;
        col = vec3(1.0, 0.95, 0.89) * uSunI / PI * uAlbedo * r;
      }
      // antialias the limb a little so the horizon is not a razor edge in the blurred mips
      col *= smoothstep(0.0, 0.02, sqrt(max(disc, 0.0)));
    } else {
      float s = dot(d, uSunDir);
      col = vec3(1.0, 0.96, 0.9) * uSunSpot * smoothstep(uSunCos - 0.00012, uSunCos + 0.00012, s);
    }
    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * @param {object} ctx RenderContext
 * @returns {{update(frame): void, texture: THREE.Texture|null, force(): void}}
 */
export function createEnvironment(ctx) {
  const { renderer, scene } = ctx;
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envScene = new THREE.Scene();
  const spotDeg = 1.2; // spot radius (deg) — resolvable by the cube map
  const spotCos = Math.cos((spotDeg * Math.PI) / 180);
  const spotSolid = 2 * Math.PI * (1 - spotCos);
  const mat = new THREE.ShaderMaterial({
    vertexShader: envVert,
    fragmentShader: envFrag,
    uniforms: {
      uUp: { value: new THREE.Vector3(0, 0, 1) },
      uRadius: { value: 1.0001 },
      uSunDir: { value: ctx.sunDir.clone() },
      uSunI: { value: SUN.intensity },
      uAlbedo: { value: 0.12 },
      // 4 % of the solar irradiance in the spot (the directional light carries the rest)
      uSunSpot: { value: (0.04 * SUN.intensity) / spotSolid },
      uSunCos: { value: spotCos },
    },
    side: THREE.BackSide,
    depthWrite: false,
    depthTest: false,
    toneMapped: false,
  });
  envScene.add(new THREE.Mesh(new THREE.SphereGeometry(10, 96, 48), mat));
  const size = ctx.quality === 'low' ? 64 : 128;

  let rt = null;
  const lastUp = new THREE.Vector3();
  let lastR = 0;
  let lastTime = -1e9;
  let forced = true;
  const up = new THREE.Vector3();

  function rebuild() {
    const next = pmrem.fromScene(envScene, 0, 0.1, 100, { size });
    if (rt) rt.dispose();
    rt = next;
    scene.environment = rt.texture;
    api.texture = rt.texture;
  }

  const api = {
    texture: null,
    force() {
      forced = true;
    },
    update(frame) {
      const v = frame.active;
      if (!v) return;
      const p = v.pos;
      const r = p.length();
      if (!(r > 0)) return;
      up.copy(p).multiplyScalar(1 / r);
      const R = Math.max(1.00001, r / MOON.radius);
      const now = performance.now() / 1000;
      const moved = lastUp.lengthSq() === 0 || up.dot(lastUp) < Math.cos((3 * Math.PI) / 180);
      const altNow = Math.max(10, r - MOON.radius);
      const altThen = Math.max(10, lastR * MOON.radius - MOON.radius);
      const climbed = Math.abs(Math.log(altNow / altThen)) > 0.15 && Math.abs(altNow - altThen) > 50;
      if (forced || moved || climbed || now - lastTime > 10) {
        mat.uniforms.uUp.value.copy(up);
        mat.uniforms.uRadius.value = R;
        mat.uniforms.uSunDir.value.copy(frame.sunDir);
        lastUp.copy(up);
        lastR = R;
        lastTime = now;
        forced = false;
        rebuild();
      }
    },
  };
  return api;
}
