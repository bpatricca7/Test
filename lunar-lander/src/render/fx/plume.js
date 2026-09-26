// Engine exhaust in vacuum: analytic emission volume, ray-marched in the fragment shader.
//
// Hypergolic engines (Aerozine 50 / N2O4) in vacuum have nearly invisible plumes: the gas expands
// so fast that it is transparent within a few nozzle diameters. What a camera sees is a faint warm
// glow right at the exit plane and a translucent, rapidly widening cone that fades with distance —
// no flame, no shock diamonds. The volume here is exactly that:
//   density(y, r) = (Re / R(y))^2 * exp(-k r^2 / R(y)^2) * axial fade,   R(y) = Re + y tan(theta)
// integrated along each view ray (analytic entry/exit of a bounding cylinder, 14-20 jittered steps),
// with a hot core near the exit, slow turbulence and a subtle flicker. Throttle scales brightness,
// length and core size; ignition adds a short fuel-rich flash.
//
// The same shader (instanced) draws the RCS jets: short, wide vapour cones with a bright onset flash.
//
// Owned by the SKY-FX agent.

import * as THREE from 'three';

export const plumeVert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  uniform float uRb;   // bounding radius at the far end
  uniform float uRe;   // exit radius
  uniform float uLb;   // bounding length
  #ifdef INSTANCED_JETS
  attribute vec4 aJet; // intensity, flash, seed, unused
  varying vec4 vJet;
  #endif
  varying vec3 vLocal;
  varying vec3 vCamLocal;
  void main() {
    // unit cylinder (y 0..1, radius 1 at both ends) -> truncated cone around the plume
    float y = position.y;
    float rr = mix(uRe * 1.15, uRb, y);
    vec3 p = vec3(position.x * rr, y * uLb, position.z * rr);
    vLocal = p;
    #ifdef USE_INSTANCING
      mat4 m = modelMatrix * instanceMatrix;
    #else
      mat4 m = modelMatrix;
    #endif
    #ifdef INSTANCED_JETS
      vJet = aJet;
    #endif
    vCamLocal = (inverse(m) * vec4(cameraPosition, 1.0)).xyz;
    vec4 wp = m * vec4(p, 1.0);
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }
`;

export const plumeFrag = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform float uRe;
  uniform float uTan;
  uniform float uLen;     // visible length (fades out by here)
  uniform float uRb;
  uniform float uLb;
  uniform float uK;       // radial falloff
  uniform float uFallPow; // axial density falloff exponent: 2 = free expansion (main engine), ~1 for RCS
  uniform float uTime;
  uniform float uIntensity;
  uniform float uFlash;
  uniform float uCoreHot;
  uniform vec3 uCoreColor;
  uniform vec3 uBodyColor;
  uniform vec3 uFlashColor;
  #ifdef INSTANCED_JETS
  varying vec4 vJet;
  #endif
  varying vec3 vLocal;
  varying vec3 vCamLocal;

  float hash13(vec3 p) {
    p = fract(p * 0.1031);
    p += dot(p, p.zyx + 31.32);
    return fract((p.x + p.y) * p.z);
  }
  float vnoise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(hash13(i), hash13(i + vec3(1, 0, 0)), f.x), mix(hash13(i + vec3(0, 1, 0)), hash13(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(hash13(i + vec3(0, 0, 1)), hash13(i + vec3(1, 0, 1)), f.x), mix(hash13(i + vec3(0, 1, 1)), hash13(i + vec3(1, 1, 1)), f.x), f.y), f.z);
  }

  // ray vs truncated cone bounding volume (approximated by the cylinder of radius uRb, y in [0, uLb])
  vec2 bounds(vec3 ro, vec3 rd) {
    float t0 = -1e9, t1 = 1e9;
    if (abs(rd.y) > 1e-6) {
      float a = (0.0 - ro.y) / rd.y;
      float b = (uLb - ro.y) / rd.y;
      t0 = max(t0, min(a, b));
      t1 = min(t1, max(a, b));
    } else if (ro.y < 0.0 || ro.y > uLb) {
      return vec2(1.0, 0.0);
    }
    float A = dot(rd.xz, rd.xz);
    float B = dot(ro.xz, rd.xz);
    float C = dot(ro.xz, ro.xz) - uRb * uRb;
    if (A > 1e-9) {
      float D = B * B - A * C;
      if (D < 0.0) return vec2(1.0, 0.0);
      float s = sqrt(D);
      t0 = max(t0, (-B - s) / A);
      t1 = min(t1, (-B + s) / A);
    } else if (C > 0.0) {
      return vec2(1.0, 0.0);
    }
    return vec2(max(t0, 0.0), t1);
  }

  void main() {
    #include <logdepthbuf_fragment>
    float inten = uIntensity;
    float flash = uFlash;
    float seed = 0.0;
    #ifdef INSTANCED_JETS
      inten *= vJet.x;
      flash = vJet.y;
      seed = vJet.z * 17.0;
      if (inten + flash <= 1e-4) discard;
    #endif
    vec3 ro = vCamLocal;
    vec3 rd = normalize(vLocal - vCamLocal);
    vec2 tb = bounds(ro, rd);
    if (tb.y <= tb.x) discard;
    const int N = ${'${STEPS}'};
    float dt = (tb.y - tb.x) / float(N);
    float jit = hash13(vec3(gl_FragCoord.xy, uTime * 60.0));
    vec3 acc = vec3(0.0);
    float lenF = uLen * (1.0 + 0.5 * flash);
    float tanF = uTan * (1.0 + 0.6 * flash);
    for (int i = 0; i < N; i++) {
      vec3 p = ro + rd * (tb.x + (float(i) + jit) * dt);
      float y = p.y;
      if (y < 0.0) continue;
      float R = uRe + y * tanF;
      float r2 = dot(p.xz, p.xz) / (R * R);
      float fall = pow(uRe / R, uFallPow);
      float axial = 1.0 - smoothstep(0.35 * lenF, lenF, y);
      // slow turbulence carried downstream + fast flicker
      float turb = 0.8 + 0.4 * vnoise(vec3(p.x * 2.0 / R, y * 1.3 / uRe - uTime * 23.0, p.z * 2.0 / R + seed));
      float d = fall * exp(-uK * r2) * axial * turb;
      // colour: warm core near the exit, pale translucent body downstream
      float c = exp(-y / (0.9 * uRe));
      vec3 col = mix(uBodyColor, uCoreColor, c) + uCoreHot * uCoreColor * exp(-y / (0.35 * uRe)) * exp(-3.0 * r2);
      col += flash * uFlashColor * exp(-y / (2.5 * uRe));
      acc += col * d;
    }
    acc *= dt / uRe * inten;
    gl_FragColor = vec4(acc, 1.0);
  }
`;

/** Unit cylinder geometry (y 0..1, radius 1), closed, for the plume bounding volume. */
export function plumeGeometry(radial = 24) {
  const g = new THREE.CylinderGeometry(1, 1, 1, radial, 1, false);
  g.translate(0, 0.5, 0);
  return g;
}

/**
 * Create the ShaderMaterial for a plume (or instanced RCS jets).
 * @param {object} o {steps, instanced}
 */
export function createPlumeMaterial({ steps = 18, instanced = false } = {}) {
  const defines = {};
  if (instanced) defines.INSTANCED_JETS = '';
  return new THREE.ShaderMaterial({
    vertexShader: plumeVert,
    fragmentShader: plumeFrag.replace('${STEPS}', String(steps)),
    defines,
    uniforms: {
      uRe: { value: 0.5 },
      uTan: { value: 0.35 },
      uLen: { value: 8 },
      uRb: { value: 3 },
      uLb: { value: 10 },
      uK: { value: 2.2 },
      uFallPow: { value: 2.0 },
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uFlash: { value: 0 },
      uCoreHot: { value: 1.0 },
      uCoreColor: { value: new THREE.Color(1.0, 0.55, 0.28) },
      uBodyColor: { value: new THREE.Color(0.55, 0.5, 0.62) },
      uFlashColor: { value: new THREE.Color(1.0, 0.8, 0.55) },
    },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    toneMapped: false,
  });
}

// Per-engine look. Lengths in m; radiance scale is in the scene's linear units.
const ENGINE_LOOK = {
  DPS: { len: 9, tan: 0.42, k: 2.4, inten: 0.07, core: 1.4, coreColor: [1.0, 0.56, 0.3], body: [0.6, 0.52, 0.62] },
  APS: { len: 6, tan: 0.45, k: 2.4, inten: 0.09, core: 1.6, coreColor: [1.0, 0.6, 0.32], body: [0.62, 0.55, 0.6] },
  SPS: { len: 18, tan: 0.34, k: 2.2, inten: 0.07, core: 1.2, coreColor: [1.0, 0.62, 0.36], body: [0.64, 0.6, 0.62] },
};

/**
 * Main engine plume for one vessel.
 * @param {object} ctx RenderContext
 * @returns {{object: THREE.Mesh, update(frame, vessel, t, dt, group): void}}
 */
export function createEnginePlume(ctx) {
  const mat = createPlumeMaterial({ steps: ctx.quality === 'low' ? 12 : 20 });
  const mesh = new THREE.Mesh(plumeGeometry(32), mat);
  mesh.frustumCulled = false;
  mesh.layers.set(ctx.LAYERS.FX);
  mesh.renderOrder = 20;
  mesh.visible = false;
  const u = mat.uniforms;
  const exhaust = new THREE.Vector3();
  const up = new THREE.Vector3(0, 1, 0);
  const camLocal = new THREE.Vector3();
  const inv = new THREE.Matrix4();
  let wasFiring = false;
  let flash = 0;
  let level = 0; // smoothed visual level
  let flick = 0;

  return {
    object: mesh,
    /**
     * @param {object} frame
     * @param {object} v vessel
     * @param {number} t fx clock (s)
     * @param {number} dt fx step (s)
     * @param {number} [groundDist] distance from the nozzle exit to the ground along the exhaust (m), Infinity if none
     * @param {number} [gain] exposure-dependent brightness gain (see effects.js)
     */
    update(frame, v, t, dt, groundDist = Infinity, gain = 1) {
      const e = v.mainEngine;
      const firing = !!(e && e.firing && e.throttle > 1e-3 && !v.crashed);
      if (firing && !wasFiring) flash = 1;
      wasFiring = firing;
      const target = firing ? Math.max(0.05, e.throttle) : 0;
      // engine start builds up in ~0.3 s, tail-off ~0.25 s (physics throttle already models this)
      level += (target - level) * (1 - Math.exp(-dt / 0.05));
      flash *= Math.exp(-dt / 0.12);
      if (level < 0.004 && flash < 0.01) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      const look = ENGINE_LOOK[e.name] || ENGINE_LOOK.DPS;
      const Re = e.nozzleExitRadius || 0.5;
      const thr = Math.min(1, level);
      const len = Math.min(look.len * (0.45 + 0.55 * thr), Math.max(1.5, groundDist * 1.05));
      u.uRe.value = Re;
      u.uTan.value = look.tan;
      u.uLen.value = len;
      u.uLb.value = len * 1.5;
      u.uRb.value = Re + len * 1.5 * look.tan * 1.8;
      u.uK.value = look.k;
      u.uCoreHot.value = look.core * (0.6 + 0.4 * thr);
      u.uCoreColor.value.setRGB(...look.coreColor);
      u.uBodyColor.value.setRGB(...look.body);
      flick = 0.92 + 0.08 * Math.sin(t * 91.0) * Math.sin(t * 37.3 + 1.3);
      u.uIntensity.value = gain * look.inten * (0.35 + 0.65 * thr) * Math.min(1, level / 0.05) * flick;
      u.uFlash.value = flash;
      u.uTime.value = t;
      // orientation: plume local +Y along the exhaust (opposite the thrust line), origin at the exit
      exhaust.copy(e.thrustLine || e.thrustDir).negate().normalize();
      mesh.position.copy(e.nozzleExit);
      mesh.quaternion.setFromUnitVectors(up, exhaust);
      mesh.updateMatrix();
      // camera inside the bounding volume -> draw back faces
      mesh.updateMatrixWorld(true);
      inv.copy(mesh.matrixWorld).invert();
      camLocal.set(0, 0, 0).applyMatrix4(inv);
      const rAt = Re + Math.max(0, camLocal.y) * (u.uRb.value - Re) / u.uLb.value;
      const inside = camLocal.y > -0.2 && camLocal.y < u.uLb.value + 0.2 && Math.hypot(camLocal.x, camLocal.z) < rAt + 0.3;
      mat.side = inside ? THREE.BackSide : THREE.FrontSide;
    },
  };
}
