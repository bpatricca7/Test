// The Earth, as seen from the Moon: 1.9 deg across, rendered as a proxy sphere inside the far plane
// (distance D, radius scaled so the angular size and direction — including lunar-orbit parallax —
// are exact).
//
// Shading (all in the same linear radiance units as the terrain, lit by SUN.intensity):
//   * surface albedo from the procedural map (real continents), Earth-fixed frame spun with GMST
//     from the mission clock, so the right face of the planet looks at the Moon at 102:45 GET;
//   * clouds (thick, bright, slightly forward-scattering) with their shadows near the terminator;
//   * ocean sun glint (GGX, wave-slope roughness, water Fresnel);
//   * Rayleigh single scattering: blue in-scatter over the dark oceans, haze toward the limb,
//     reddened sunlight along the terminator (long air-mass), extinction of the surface light;
//   * an atmosphere shell outside the solid limb: the thin blue line of the sunlit limb, which
//     wraps a little onto the night side (twilight ring);
//   * local adaptation: when the global exposure is very high the Earth's radiance is compressed so it
//     never burns out to a white disc (the eye adapts locally; a camera would not).
// Day/night terminator comes from SUN_DIR — from Tranquility Base the Earth is ~40 % lit.
//
// Owned by the SKY-FX agent.

import * as THREE from 'three';
import { EARTH, SUN } from '../../core/constants.js';
import { mciToEarthFixedMatrix } from './celestial.js';

const D = 5.0e7; // m — proxy distance of the Earth's centre from the camera
const EARTH_MCI = new THREE.Vector3(EARTH.distance, 0, 0);
const ATMO_SCALE = 25000 / EARTH.radius; // visible scale height (exaggerated ~3x so it resolves)
const SHELL = 1.035;

const common = /* glsl */ `
  uniform vec3 uSunDir;
  uniform float uSunI;   // SUN.intensity x local-adaptation gain
  // Rayleigh zenith optical depth at ~680/550/440 nm
  const vec3 TAU_R = vec3(0.045, 0.098, 0.235);
  float rayleighPhase(float c) { return 0.75 * (1.0 + c * c); }
`;

const earthVert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vN;
  varying vec3 vPos;
  void main() {
    vN = normal;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }
`;

const earthFrag = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  ${common}
  uniform sampler2D uAlbedo;
  uniform sampler2D uClouds;
  uniform mat3 uToEF;
  varying vec3 vN;
  varying vec3 vPos;

  vec2 lonLatUV(vec3 p) {
    float lon = atan(p.y, p.x);
    float lat = asin(clamp(p.z, -1.0, 1.0));
    float u1 = lon / 6.2831853 + 0.5;
    float u2 = fract(u1 + 0.5) - 0.5;
    float u = fwidth(u1) <= fwidth(u2) + 1e-6 ? u1 : u2;
    return vec2(u, 0.5 - lat / 3.14159265);
  }

  void main() {
    #include <logdepthbuf_fragment>
    vec3 N = normalize(vN);
    vec3 V = normalize(-vPos);
    vec3 L = uSunDir;
    float NdotL = dot(N, L);
    float NdotV = max(dot(N, V), 1e-3);
    vec3 pEF = uToEF * N;
    vec2 uv = lonLatUV(pEF);
    vec4 alb = texture2D(uAlbedo, uv);
    float water = alb.a;
    vec2 cl = texture2D(uClouds, uv).rg;
    float cloud = cl.r;
    // cloud shadow: sample toward the Sun (cloud tops ~1 % of R above the surface near the terminator)
    vec3 LEF = uToEF * L;
    vec3 tang = LEF - pEF * dot(LEF, pEF);
    vec2 sh = vec2(dot(tang, vec3(-pEF.y, pEF.x, 0.0)) / max(dot(pEF.xy, pEF.xy), 1e-3) / 6.2831853, -tang.z / 3.14159265);
    float cShadow = texture2D(uClouds, uv + sh * 0.012 / max(NdotL, 0.08)).r;

    // air masses along the view and sun paths
    float mV = 1.0 / (NdotV + 0.025);
    float mL = 1.0 / (max(NdotL, 0.0) + 0.1);
    vec3 Tsun = exp(-TAU_R * mL);
    vec3 Tview = exp(-TAU_R * mV);
    float lit = smoothstep(-0.01, 0.04, NdotL);

    // surface (Lambert) + cloud shadows
    vec3 E = uSunI * Tsun * max(NdotL, 0.0);
    vec3 surf = alb.rgb / PI * E * (1.0 - 0.55 * cShadow * (1.0 - cloud));
    // ocean glint
    vec3 H = normalize(L + V);
    float NdotH = max(dot(N, H), 0.0);
    float a2 = 0.13 * 0.13;
    float dd = NdotH * NdotH * (a2 - 1.0) + 1.0;
    float Dg = a2 / (PI * dd * dd);
    float F = 0.02 + 0.98 * pow(1.0 - max(dot(V, H), 0.0), 5.0);
    surf += water * (1.0 - cloud) * uSunI * Tsun * Dg * F / (4.0 * NdotV) * lit;
    // clouds: thick, bright, softer terminator than Lambert
    float cl0 = pow(max(NdotL, 0.0), 0.8);
    vec3 cloudRad = uSunI / PI * 0.78 * Tsun * cl0 * (0.85 + 0.15 * cl.g);
    vec3 col = mix(surf, cloudRad, cloud);
    col *= mix(Tview, vec3(1.0), 0.35 * cloud);
    // Rayleigh in-scatter along the view path (sunlit air; twilight glow just past the terminator)
    float air = smoothstep(-0.12, 0.12, NdotL);
    float ph = rayleighPhase(dot(-V, L));
    vec3 inscat = uSunI / (4.0 * PI) * ph * (1.0 - Tview) * air * mix(vec3(1.0), exp(-TAU_R * min(mL, 18.0)), 0.9);
    col += inscat * (1.0 - 0.6 * cloud);
    gl_FragColor = vec4(col, 1.0);
  }
`;

const shellVert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vPos;
  void main() {
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vPos = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }
`;

const shellFrag = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  ${common}
  uniform vec3 uCenter;   // Earth centre (render space)
  uniform float uRadius;  // Earth radius (render units)
  uniform float uScaleH;  // scale height / R
  varying vec3 vPos;
  void main() {
    #include <logdepthbuf_fragment>
    vec3 d = normalize(vPos);
    float t = dot(uCenter, d);
    vec3 q = d * t - uCenter;             // closest approach of the view ray to the centre
    float h = length(q) / uRadius - 1.0;  // tangent altitude (Earth radii)
    float px = fwidth(h);
    if (h < -px) discard;                 // the planet itself covers this (its shader adds the haze)
    vec3 nc = q / max(length(q), 1e-6);
    // slant optical depth of a tangent ray ~ tau_zenith * sqrt(2 pi R/H) * exp(-h/H)
    float k = sqrt(6.2831853 / uScaleH) * exp(-max(h, 0.0) / uScaleH);
    vec3 tau = TAU_R * k;
    float sunC = dot(nc, uSunDir);
    float lit = smoothstep(-0.28, 0.12, sunC);
    // light reaching the limb column is reddened when it grazes the terminator
    vec3 Tsun = exp(-TAU_R * 8.0 * (1.0 - smoothstep(-0.1, 0.4, sunC)));
    float ph = rayleighPhase(dot(-d, uSunDir)) + 0.6 * pow(max(dot(d, uSunDir), 0.0), 8.0);
    vec3 col = uSunI / (4.0 * PI) * ph * (1.0 - exp(-tau)) * lit * Tsun;
    col *= smoothstep(-px, px, h); // antialiased inner edge
    gl_FragColor = vec4(col, 1.0);
  }
`;

/**
 * @param {object} ctx RenderContext
 * @param {{earthAlbedo: THREE.Texture, earthClouds: THREE.Texture}} tex
 * @returns {{group: THREE.Group, update(frame): void}}
 */
export function createEarth(ctx, tex) {
  const seg = ctx.quality === 'low' ? 48 : 96;
  const sunDir = { value: ctx.sunDir.clone() };
  const sunI = { value: SUN.intensity };
  let adapt = 1;
  let lastWall = performance.now();
  const earthMat = new THREE.ShaderMaterial({
    vertexShader: earthVert,
    fragmentShader: earthFrag,
    uniforms: {
      uSunDir: sunDir,
      uSunI: sunI,
      uAlbedo: { value: tex.earthAlbedo },
      uClouds: { value: tex.earthClouds },
      uToEF: { value: new THREE.Matrix3() },
    },
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const earth = new THREE.Mesh(new THREE.SphereGeometry(1, seg, seg / 2), earthMat);
  earth.renderOrder = -1e6 + 3;
  const shellMat = new THREE.ShaderMaterial({
    vertexShader: shellVert,
    fragmentShader: shellFrag,
    uniforms: {
      uSunDir: sunDir,
      uSunI: sunI,
      uCenter: { value: new THREE.Vector3() },
      uRadius: { value: 1 },
      uScaleH: { value: ATMO_SCALE },
    },
    blending: THREE.AdditiveBlending,
    depthTest: false,
    depthWrite: false,
    toneMapped: false,
  });
  const shell = new THREE.Mesh(new THREE.SphereGeometry(SHELL, seg, seg / 2), shellMat);
  shell.renderOrder = -1e6 + 4;
  const group = new THREE.Group();
  group.name = 'earth';
  group.add(earth, shell);
  for (const m of [earth, shell]) {
    m.frustumCulled = false;
    m.layers.set(ctx.LAYERS.WORLD);
  }
  const rel = new THREE.Vector3();
  return {
    group,
    update(frame) {
      rel.copy(EARTH_MCI).sub(frame.origin); // doubles
      const dist = rel.length();
      rel.multiplyScalar(1 / dist);
      const s = (EARTH.radius * D) / dist;
      group.position.copy(rel).multiplyScalar(D);
      group.scale.setScalar(s);
      group.updateMatrixWorld(true);
      sunDir.value.copy(frame.sunDir);
      // Local adaptation (what the eye does, and what a photographer's dodge does): when the global
      // exposure opens up for a dim foreground or the dark sky, the small, very bright Earth would burn
      // out to a white disc. Compress its radiance toward the exposure where it looks its best (x3.5),
      // eased so it cannot pump.
      const ex = ctx.exposureInfo;
      const want = ex && ex.valid ? Math.min(1, Math.pow(3.5 / ex.multiplier, 0.95)) : 1;
      const now = performance.now();
      const wdt = Math.min(0.25, (now - lastWall) / 1000);
      lastWall = now;
      adapt += (want - adapt) * Math.min(1, wdt * 4);
      sunI.value = SUN.intensity * adapt;
      mciToEarthFixedMatrix(frame.time || 0, earthMat.uniforms.uToEF.value);
      shellMat.uniforms.uCenter.value.copy(group.position);
      shellMat.uniforms.uRadius.value = s;
    },
  };
}
