// The sea material (docs/teams/ocean.md §11.1): MeshLambertMaterial with vertex colors, patched
// with onBeforeCompile (the swayMaterial pattern, src/things/outdoor/models-tree.js) to bend each
// instanced animal in its own space (a tail kick, a wiggle, flippers, a pulsing bell, curling
// arms) and to tint it from per-instance colors. Lighting and fog are Lambert's own, so the
// animals darken at night and fade in the fog like pets and furniture.
//
// Per instance: iSwim = (phase, amplitude, extra, shade), iTint = (body rgb, glow),
// iAcc = (accent rgb, flags: 1 = saddle shown). Per vertex: aSea = (along, mask, limb), aPivot.

import * as THREE from 'three';

export const SEA_MODES = ['kick', 'wiggle', 'flap', 'pulse', 'curl', 'flutter', 'snip'];

// rotate d about the Z axis (flap) or the Y axis (flutter) by a
const ROT = /* glsl */ `
vec3 seaRotZ(vec3 d, float a) { float c = cos(a), s = sin(a); return vec3(c * d.x - s * d.y, s * d.x + c * d.y, d.z); }
vec3 seaRotY(vec3 d, float a) { float c = cos(a), s = sin(a); return vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z); }
`;

const BEND = {
  kick: /* glsl */ `
    transformed.y += iSwim.y * sin(iSwim.x - seaAlong * 2.4) * seaAlong * seaAlong * 0.35;
    if (abs(seaLimb - 1.0) < 0.5) transformed = aPivot + seaRotZ(transformed - aPivot, 0.25 * iSwim.y * sin(iSwim.x * 0.5) * sign(aPivot.x));
    transformed.x += iSwim.z * seaAlong * seaAlong;`,
  wiggle: /* glsl */ `
    transformed.x += iSwim.y * sin(iSwim.x - seaAlong * 3.0) * seaAlong * 0.25;
    transformed.x += iSwim.z * seaAlong * seaAlong;`,
  flap: /* glsl */ `
    if (abs(seaLimb - 1.0) < 0.5) transformed = aPivot + seaRotZ(transformed - aPivot, iSwim.y * sin(iSwim.x) * sign(aPivot.x));
    transformed.x += iSwim.z * seaAlong * seaAlong;`,
  snip: /* glsl */ `
    if (abs(seaLimb - 1.0) < 0.5) transformed = aPivot + seaRotY(transformed - aPivot, iSwim.y * sin(iSwim.x) * sign(aPivot.x));
    if (abs(seaLimb - 2.0) < 0.5) transformed.y += 0.025 * sin(iSwim.x * 2.0 + aPivot.z * 9.0 + aPivot.x * 4.0);`,
  flutter: /* glsl */ `
    if (abs(seaLimb - 1.0) < 0.5) transformed = aPivot + seaRotY(transformed - aPivot, iSwim.y * sin(iSwim.x));
    transformed.x += iSwim.z * seaAlong * seaAlong * 0.3;`,
  pulse: /* glsl */ `
    if (seaAlong < 0.5) { float k = 1.0 + iSwim.y * sin(iSwim.x); transformed.x *= k; transformed.z *= k; transformed.y *= 2.0 - k; }
    else { float t = sin(iSwim.x - seaAlong * 4.0) * seaAlong * 0.08; transformed.x += t; transformed.z += t * 0.6; }`,
  curl: /* glsl */ `
    if (seaLimb > 1.5 && seaLimb < 2.5) {
      transformed.y += iSwim.z * seaAlong * seaAlong;
      float sw = sin(iSwim.x + aPivot.x * 7.0 + aPivot.z * 5.0) * seaAlong * 0.05;
      transformed.x += sw; transformed.z -= sw;
    }`,
};

const VERT_HEAD = /* glsl */ `
attribute vec3 aSea;
attribute vec3 aPivot;
attribute vec4 iSwim;
attribute vec4 iTint;
attribute vec4 iAcc;
varying vec3 vSeaTint;
varying vec3 vSeaAcc;
varying float vSeaMask;
varying float vSeaShade;
varying float vSeaGlow;
${ROT}`;

const FRAG_HEAD = /* glsl */ `
varying vec3 vSeaTint;
varying vec3 vSeaAcc;
varying float vSeaMask;
varying float vSeaShade;
varying float vSeaGlow;`;

const cache = new Map();

/** The cached material of a bend mode (shared, never disposed). */
export function seaMaterial(mode) {
  let m = cache.get(mode);
  if (m) return m;
  m = new THREE.MeshLambertMaterial({ vertexColors: true });
  m.userData.shared = true;
  const bend = BEND[mode] || '';
  m.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader
      .replace('#include <common>', `#include <common>\n${VERT_HEAD}`)
      .replace('#include <begin_vertex>', `#include <begin_vertex>
    float seaAlong = aSea.x;
    float seaLimb = aSea.z;
    ${bend}
    if (abs(seaLimb - 3.0) < 0.5 && iAcc.w < 0.5) transformed = aPivot;
    vSeaTint = iTint.rgb;
    vSeaAcc = iAcc.rgb;
    vSeaMask = aSea.y;
    vSeaShade = iSwim.w;
    vSeaGlow = seaLimb < 1.5 ? iTint.w : 0.0;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
    vec3 seaK = vSeaMask < 0.5 ? vec3(1.0) : (vSeaMask < 1.5 ? vSeaTint : vSeaAcc);
    diffuseColor.rgb *= seaK * vSeaShade;`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    totalEmissiveRadiance += diffuseColor.rgb * vSeaGlow;`);
  };
  m.customProgramCacheKey = () => 'sw-sea-' + mode;
  cache.set(mode, m);
  return m;
}
