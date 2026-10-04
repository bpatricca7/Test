// The sea material (docs/teams/ocean.md §11.1): MeshLambertMaterial with vertex colors, patched
// with onBeforeCompile (the swayMaterial pattern, src/things/outdoor/models-tree.js) to bend each
// instanced animal in its own space (a tail kick, a wiggle, flippers, a pulsing bell, curling
// arms) and to tint it from per-instance colors. Lighting and fog are Lambert's own, so the
// animals darken at night and fade in the fog like pets and furniture.
//
// Per instance: iSwim = (phase, amplitude, extra, shade), iTint = (body rgb, glow),
// iAcc = (accent rgb, flags: 1 = saddle shown), iSurf = the y of the water surface it swims in
// (-1e4: on dry land). Per vertex: aSea = (along, mask, limb), aPivot.
//
// Seen through the water: the water surface is about 75% opaque (alpha 190/255), so an animal
// drawn before it showed at about 25%: faint blue ghosts from her camera above the water. The sea
// meshes draw AFTER the water instead (renderOrder 1, depth written; flagged transparent only for
// that order, every pixel stays fully opaque, so no part of an animal ever shows through another).
// A pixel with the surface BETWEEN it and the camera (under the water seen from above, or above
// the water seen from under it) takes on the water's own colour: SEE_NEAR just under the surface,
// SEE_PER more per block of depth, at most SEE_FAR, eased in over the first few hundredths of a
// block so the waterline is soft. It is mixed into the animal's colour BEFORE lighting, so at night
// it darkens with everything else. Those pixels are also a little brighter with a soft light rim,
// so an animal of nearly the water's colour keeps its outline. Pixels on the camera's side of the
// surface (a fin or a leaping dolphin seen from above; every animal around a camera under the
// water) are drawn exactly as on land.

import * as THREE from 'three';

export const SEA_MODES = ['kick', 'wiggle', 'flap', 'pulse', 'curl', 'flutter', 'snip'];

/** How much of the water's colour lies over an animal across the surface (see above). */
export const SEE_NEAR = 0.2, SEE_PER = 0.07, SEE_FAR = 0.42;
/** Under the surface: a little brighter overall (SEE_LIFT) and a light rim (SEE_RIM). */
export const SEE_LIFT = 1.08, SEE_RIM = 0.45;
/** The water's own middle colour (src/world/paint/nature.js paintWater). */
export const SEA_WATER = '#5CC7E8';
/** The sea meshes' draw order: after every water chunk (renderOrder <= 0), before particles (10). */
export const SEA_ORDER = 1;

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
attribute float iSurf;
varying float vSeaUnder;
varying float vSeaSurf;
varying vec3 vSeaTint;
varying vec3 vSeaAcc;
varying float vSeaMask;
varying float vSeaShade;
varying float vSeaGlow;
${ROT}`;

const FRAG_HEAD = /* glsl */ `
varying float vSeaUnder;
varying float vSeaSurf;
varying vec3 vSeaTint;
varying vec3 vSeaAcc;
varying float vSeaMask;
varying float vSeaShade;
varying float vSeaGlow;`;

/** Mask 3 (a turtle's head and flippers): the body colour this much toward white. */
export const SKIN = 0.25;

const glsl = (hex) => { const c = new THREE.Color(hex); return `vec3(${c.r.toFixed(4)}, ${c.g.toFixed(4)}, ${c.b.toFixed(4)})`; };

const cache = new Map();

/** The cached material of a bend mode (shared, never disposed). */
export function seaMaterial(mode) {
  let m = cache.get(mode);
  if (m) return m;
  // transparent only to be drawn after the water; every pixel is opaque (alpha 1)
  m = new THREE.MeshLambertMaterial({ vertexColors: true, transparent: true, depthWrite: true });
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
    vSeaGlow = seaLimb < 1.5 ? iTint.w : 0.0;
    vSeaSurf = iSurf;
    vSeaUnder = iSurf - (modelMatrix * instanceMatrix * vec4(transformed, 1.0)).y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
    vec3 seaK = vSeaMask < 0.5 ? vec3(1.0) : (vSeaMask < 1.5 ? vSeaTint : (vSeaMask < 2.5 ? vSeaAcc : mix(vSeaTint, vec3(1.0), ${SKIN.toFixed(3)})));
    diffuseColor.rgb *= seaK * vSeaShade;
    // across the surface from the camera (see above): the water's colour over it
    float seaThru = 0.0;
    if (vSeaSurf > -1000.0 && (cameraPosition.y - vSeaSurf) * vSeaUnder > 0.0) {
      float seaD = abs(vSeaUnder);
      seaThru = smoothstep(0.0, 0.06, seaD) * clamp(${SEE_NEAR.toFixed(3)} + ${SEE_PER.toFixed(3)} * seaD, 0.0, ${SEE_FAR.toFixed(3)});
      diffuseColor.rgb = mix(diffuseColor.rgb, ${glsl(SEA_WATER)}, seaThru);
    }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    totalEmissiveRadiance += diffuseColor.rgb * vSeaGlow;`)
      .replace('#include <opaque_fragment>', `
    // a little brighter with a soft light rim across the surface (following the light: dim at night)
    if (seaThru > 0.0) {
      float seaRim = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.0);
      float seaLum = dot(outgoingLight, vec3(0.299, 0.587, 0.114));
      float seaOn = seaThru / ${SEE_NEAR.toFixed(3)};
      seaOn = min(seaOn, 1.0);
      outgoingLight = mix(outgoingLight, outgoingLight * (${SEE_LIFT.toFixed(3)} + ${SEE_RIM.toFixed(3)} * seaRim) + vec3(seaLum * seaRim * ${SEE_RIM.toFixed(3)}), seaOn);
    }
    diffuseColor.a = 1.0;
    #include <opaque_fragment>`);
  };
  m.customProgramCacheKey = () => 'sw-sea3-' + mode;
  cache.set(mode, m);
  return m;
}
