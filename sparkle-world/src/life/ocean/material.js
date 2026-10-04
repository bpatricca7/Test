// The sea material (docs/teams/ocean.md §11.1): MeshLambertMaterial with vertex colors, patched
// with onBeforeCompile (the swayMaterial pattern, src/things/outdoor/models-tree.js) to bend each
// instanced animal in its own space (a tail kick, a wiggle, flippers, a pulsing bell, curling
// arms) and to tint it from per-instance colors. Lighting and fog are Lambert's own, so the
// animals darken at night and fade in the fog like pets and furniture.
//
// Per instance: iSwim = (phase, amplitude, extra, shade), iTint = (body rgb, glow),
// iAcc = (accent rgb, flags: 1 = saddle shown), iSurf = (the y of the liquid's surface it swims
// in, -1e4 on dry land or seen through glass; the liquid's own colour rgb). Per vertex:
// aSea = (along, mask, limb), aPivot.
//
// Seen through the water: the water surface is about 75% opaque (alpha 190/255), so an animal
// drawn before it showed at about 25%: faint blue ghosts from her camera above the water. The sea
// meshes draw AFTER the water instead (renderOrder SEA_ORDER, depth written; flagged transparent
// only for that order, every pixel stays fully opaque, so no part of an animal ever shows through
// another). A pixel with the surface BETWEEN it and the camera (under the water seen from above,
// or above the water seen from under it) takes on a little of the liquid's own colour (water,
// chocolate milk, strawberry milk): SEE_NEAR just under the surface, SEE_PER more per block of
// depth, at most SEE_FAR, eased in over the first few hundredths of a block so the waterline is
// soft. The animal's colour is first made a little richer (SEE_SAT) so the liquid never washes a
// sunny seahorse or an orange starfish grey. It is mixed BEFORE lighting, so at night it darkens
// with everything else. Those pixels also get dappled wave light (moving caustics, SEE_CAUST) and
// a soft darker edge (SEE_EDGE) that outlines even a small animal against the bright water.
// Pixels on the camera's side of the surface (a fin or a leaping dolphin seen from above; every
// animal around a camera under the water) are drawn exactly as on land.
//
// Glass: see-through blocks (glass, jelly blocks, ice) do not write depth, so an animal drawn
// after them would cover them. A kind with any animal seen through such a block (index.js
// _glassTick) draws in SEA_BEHIND order instead, BEFORE every see-through chunk (the glass and
// the water then blend over it as they do over anything else), without its own liquid colour.
//
// At night every sea animal gets a soft moonlit glow (SEA_NIGHT of its own colour) on top of the
// jellies' own glow and a pale moonlit edge, so a fish or an octopus near her never turns into a
// dim smudge and a blue dolphin keeps its outline against the night sky.

import * as THREE from 'three';

export const SEA_MODES = ['kick', 'wiggle', 'flap', 'pulse', 'curl', 'flutter', 'snip'];

/** How much of the liquid's colour lies over an animal across the surface (see above). */
export const SEE_NEAR = 0.1, SEE_PER = 0.04, SEE_FAR = 0.2;
/** Under the surface: richer colour (SEE_SAT), a little brighter (SEE_LIFT), wave light, a soft edge. */
export const SEE_SAT = 0.4, SEE_LIFT = 1.06, SEE_CAUST = 0.22, SEE_EDGE = 0.3;
/** At night: this much of its own colour as a soft glow, and a pale moonlit edge (SEA_NIGHT_RIM of MOON). */
export const SEA_NIGHT = 0.3, SEA_NIGHT_RIM = 0.4;
const MOON = '#BFD4FF';
/** The liquids' own middle colours (src/world/paint/nature.js paintWater, paint/candy.js). */
export const SEA_WATER = '#5CC7E8';
export const SEA_LIQUIDS = { water: SEA_WATER, choco_milk: '#9A654D', strawberry_milk: '#F494BC' };
/** Draw order: after every see-through chunk (renderOrder <= 0), before particles (3+). */
export const SEA_ORDER = 1;
/** Draw order seen through glass: before every see-through chunk (>= -1e4), after the horizon ring (-1e6). */
export const SEA_BEHIND = -1e5;
/** Shared uniforms of every sea material: the clock (wave light) and the night (0..1). */
export const SEA_U = { uSeaTime: { value: 0 }, uSeaNight: { value: 0 } };

// rotate d about the Z axis (flap) or the Y axis (flutter) by a
const ROT = /* glsl */ `
vec3 seaRotZ(vec3 d, float a) { float c = cos(a), s = sin(a); return vec3(c * d.x - s * d.y, s * d.x + c * d.y, d.z); }
vec3 seaRotY(vec3 d, float a) { float c = cos(a), s = sin(a); return vec3(c * d.x + s * d.z, d.y, -s * d.x + c * d.z); }
`;

const BEND = {
  kick: /* glsl */ `
    transformed.y += iSwim.y * sin(iSwim.x - seaAlong * 2.4) * seaAlong * seaAlong * 0.26;
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
attribute vec4 iSurf;
varying float vSeaUnder;
varying float vSeaSurf;
varying vec3 vSeaLiq;
varying vec2 vSeaW;
varying vec3 vSeaTint;
varying vec3 vSeaAcc;
varying float vSeaMask;
varying float vSeaShade;
varying float vSeaGlow;
${ROT}`;

const FRAG_HEAD = /* glsl */ `
uniform float uSeaTime;
uniform float uSeaNight;
varying float vSeaUnder;
varying float vSeaSurf;
varying vec3 vSeaLiq;
varying vec2 vSeaW;
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
    vSeaSurf = iSurf.x;
    vSeaLiq = iSurf.yzw;
    vec4 seaWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
    vSeaW = seaWorld.xz;
    vSeaUnder = iSurf.x - seaWorld.y;`);
    shader.fragmentShader = shader.fragmentShader
      .replace('#include <common>', `#include <common>\n${FRAG_HEAD}`)
      .replace('#include <color_fragment>', `#include <color_fragment>
    vec3 seaK = vSeaMask < 0.5 ? vec3(1.0) : (vSeaMask < 1.5 ? vSeaTint : (vSeaMask < 2.5 ? vSeaAcc : mix(vSeaTint, vec3(1.0), ${SKIN.toFixed(3)})));
    diffuseColor.rgb *= seaK * vSeaShade;
    // across the surface from the camera (see above): a little of the liquid's colour over it
    float seaThru = 0.0;
    if (vSeaSurf > -1000.0 && (cameraPosition.y - vSeaSurf) * vSeaUnder > 0.0) {
      float seaD = abs(vSeaUnder);
      seaThru = smoothstep(0.0, 0.06, seaD) * clamp(${SEE_NEAR.toFixed(3)} + ${SEE_PER.toFixed(3)} * seaD, 0.0, ${SEE_FAR.toFixed(3)});
      float seaL = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));
      diffuseColor.rgb = max(mix(vec3(seaL), diffuseColor.rgb, 1.0 + ${SEE_SAT.toFixed(3)} * min(seaThru / ${SEE_NEAR.toFixed(3)}, 1.0)), 0.0);
      diffuseColor.rgb = mix(diffuseColor.rgb, vSeaLiq, seaThru);
    }`)
      .replace('#include <emissivemap_fragment>', `#include <emissivemap_fragment>
    totalEmissiveRadiance += diffuseColor.rgb * (vSeaGlow + uSeaNight * ${SEA_NIGHT.toFixed(3)});
    // and a pale moonlit edge, so its outline shows against the night sky and the dark water
    totalEmissiveRadiance += ${glsl(MOON)} * (uSeaNight * ${SEA_NIGHT_RIM.toFixed(3)} * pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 2.0));`)
      .replace('#include <opaque_fragment>', `
    // under the surface: dappled wave light moving over it and a soft darker edge (see above)
    if (seaThru > 0.0) {
      float seaOn = min(seaThru / ${SEE_NEAR.toFixed(3)}, 1.0);
      float c1 = sin(vSeaW.x * 2.3 + uSeaTime * 1.3 + sin(vSeaW.y * 1.7 - uSeaTime * 0.9));
      float c2 = sin(vSeaW.y * 2.1 - uSeaTime * 1.1 + sin(vSeaW.x * 1.5 + uSeaTime * 0.7));
      float seaCaust = smoothstep(0.3, 0.9, c1 * c2);
      float seaEdge = pow(1.0 - clamp(abs(dot(normal, normalize(vViewPosition))), 0.0, 1.0), 3.0);
      outgoingLight *= mix(1.0, (${SEE_LIFT.toFixed(3)} + ${SEE_CAUST.toFixed(3)} * seaCaust) * (1.0 - ${SEE_EDGE.toFixed(3)} * seaEdge), seaOn);
    }
    diffuseColor.a = 1.0;
    #include <opaque_fragment>`);
    shader.uniforms.uSeaTime = SEA_U.uSeaTime;
    shader.uniforms.uSeaNight = SEA_U.uSeaNight;
  };
  m.customProgramCacheKey = () => 'sw-sea4-' + mode;
  cache.set(mode, m);
  return m;
}
