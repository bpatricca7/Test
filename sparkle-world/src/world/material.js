// The one block ShaderMaterial (GLSL3, sampler2DArray), in three variants sharing uniforms:
// opaque, cutout (alpha test) and translucent (blended, no depth write).
//
// Colors in these uniforms are raw sRGB 0..1 values: the shader writes its result directly
// (no output color conversion), matching the hex colors used for the sky and fog.

import * as THREE from 'three';

const vertexShader = /* glsl */ `
in float layer;
in float shade;
in vec2 light;
uniform float uTime;
out vec2 vUv;
flat out float vLayer;
flat out float vAnim;
out float vShade;
out vec2 vLight;
out float vFogDepth;
out vec3 vWorld;

void main() {
  vec3 p = position;
  float L = layer;
  vAnim = 0.0;
  vec4 world = modelMatrix * vec4(p, 1.0);
  if (L >= 1024.0) {
    // animated tile (water): gentle bob of the surface, the shader also drifts its uvs
    L -= 1024.0;
    vAnim = 1.0;
    float f = fract(p.y);
    if (f > 0.8 && f < 0.95) {
      world.y += (sin(uTime * 1.3 + world.x * 0.7 + world.z * 0.3) + sin(uTime * 0.9 + world.z * 0.8)) * 0.025 - 0.03;
    }
  }
  vLayer = L;
  vUv = uv;
  vShade = shade;
  vLight = light;
  vWorld = world.xyz;
  vec4 mv = viewMatrix * world;
  vFogDepth = length(mv.xyz);
  gl_Position = projectionMatrix * mv;
}
`;

const fragmentShader = /* glsl */ `
precision highp float;
precision highp sampler2DArray;
uniform sampler2DArray uAtlas;
uniform float uDaylight;
uniform float uAmbient;
uniform vec3 uSkyColor;
uniform vec3 uBlockLightColor;
uniform vec3 uFogColor;
uniform float uFogNear;
uniform float uFogFar;
uniform float uTime;
uniform float uOpacity;
in vec2 vUv;
flat in float vLayer;
flat in float vAnim;
in float vShade;
in vec2 vLight;
in float vFogDepth;
in vec3 vWorld;
out vec4 fragColor;

// light level (0..1) -> brightness: soft falloff so torches and windows read nicely
float curve(float v) {
  return pow(0.86, (1.0 - v) * 15.0);
}

void main() {
  vec2 uv = vUv;
  if (vAnim > 0.5) {
    uv += vec2(sin(uTime * 0.6 + vWorld.z * 0.45), cos(uTime * 0.5 + vWorld.x * 0.45)) * 0.07;
  }
  vec4 tex = texture(uAtlas, vec3(uv, vLayer));
#ifdef CUTOUT
  if (tex.a < 0.5) discard;
  tex.a = 1.0;
#endif
  vec3 sky = uSkyColor * (curve(vLight.x) * uDaylight);
  vec3 blk = uBlockLightColor * curve(vLight.y) * step(0.01, vLight.y);
  vec3 lightCol = max(max(sky, blk), vec3(uAmbient));
  vec3 color = tex.rgb * vShade * lightCol;
  float fog = smoothstep(uFogNear, uFogFar, vFogDepth);
  color = mix(color, uFogColor, fog);
#ifdef TRANSLUCENT
  fragColor = vec4(color, mix(tex.a * uOpacity, 1.0, fog * 0.6));
#else
  fragColor = vec4(color, 1.0);
#endif
}
`;

/** Shared uniforms: daynight.js updates these (daylight, sky/fog colors, fog distances). */
export function createBlockUniforms(atlas) {
  return {
    uAtlas: { value: atlas },
    uDaylight: { value: 1 },
    uAmbient: { value: 0.45 },
    uSkyColor: { value: new THREE.Color(1, 1, 1) },
    uBlockLightColor: { value: new THREE.Color(1.0, 0.86, 0.62) },
    uFogColor: { value: new THREE.Color(0.8, 0.92, 1.0) },
    uFogNear: { value: 40 },
    uFogFar: { value: 120 },
    uTime: { value: 0 },
    uOpacity: { value: 1 },
  };
}

/** Build the three material variants that share one uniforms object. */
export function createBlockMaterials(uniforms) {
  const base = {
    glslVersion: THREE.GLSL3,
    vertexShader,
    fragmentShader,
    uniforms,
  };
  const opaque = new THREE.ShaderMaterial({ ...base });
  const cutout = new THREE.ShaderMaterial({ ...base, defines: { CUTOUT: 1 }, side: THREE.DoubleSide });
  const translucent = new THREE.ShaderMaterial({
    ...base,
    defines: { TRANSLUCENT: 1 },
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
  });
  return { opaque, cutout, translucent };
}
