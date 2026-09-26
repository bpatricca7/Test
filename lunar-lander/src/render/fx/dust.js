// Surface interaction effects of the LM:
//   * descent-engine dust: below ~40 m the DPS exhaust scours the regolith. Lunar dust has no air to
//     hold it up, so it does not billow: grains leave the impingement point in flat radial sheets at
//     1-4 deg elevation and hundreds of m/s, travelling ballistically — on the 16-mm film it reads as a
//     fast, streaky, translucent sheet flowing outward that washes out the ground near touchdown.
//     Drawn as (a) a terrain-conforming radial "sheet" (polar-grid mesh, heights sampled from
//     world/moon.js, time-sliced) with a streaky, outward-scrolling density, and (b) GPU streak
//     particles. Both are lit by the Sun (forward-scattering phase function) and show the LM's shadow.
//   * touchdown puff from the footpads; crash burst;
//   * APS liftoff: fire-in-the-hole blast at the descent-stage deck and a burst of insulation-foil
//     fragments (Kapton gold, aluminised Mylar, black) glinting as they tumble along ballistic arcs.
//
// Owned by the SKY-FX agent.

import * as THREE from 'three';
import { MOON, SUN, LM } from '../../core/constants.js';
import { terrainHeight } from '../../world/moon.js';
import { ParticlePool } from './particles.js';

const G_MOON = MOON.mu / (MOON.radius * MOON.radius);
const RINGS = 22;
const SPOKES = 72;
const SHEET_R = 160; // m
const DUST_ALBEDO = 0.13; // single-scattering albedo x (column optical depth normalisation) of the grains

const sheetVert = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_vertex>
  varying vec3 vLocal;
  varying vec3 vWorld;
  void main() {
    vLocal = position;
    vec4 wp = modelMatrix * vec4(position, 1.0);
    vWorld = wp.xyz;
    gl_Position = projectionMatrix * viewMatrix * wp;
    #include <logdepthbuf_vertex>
  }
`;

const sheetFrag = /* glsl */ `
  #include <common>
  #include <logdepthbuf_pars_fragment>
  uniform vec3 uCenter;     // impingement point (local)
  uniform vec3 uE1;
  uniform vec3 uE2;
  uniform vec3 uTilt;       // horizontal plume tilt (local, |v| = sin tilt)
  uniform float uTime;
  uniform float uIntensity;
  uniform float uReach;     // e-folding radius of the sheet (m)
  uniform vec3 uSunDir;
  uniform float uSunI;
  uniform vec3 uDustColor;
  ${'${VSHADOW}'}
  varying vec3 vLocal;
  varying vec3 vWorld;

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

  void main() {
    #include <logdepthbuf_fragment>
    vec3 rel = vLocal - uCenter;
    vec2 q = vec2(dot(rel, uE1), dot(rel, uE2));
    float r = length(q);
    vec2 dir = q / max(r, 1e-3);
    // radial structure: broad, soft, variable-width rays of dust (constant angular width) scrolling
    // outward fast, riding on a coarse density field that also streams outward, so the sheet reads as
    // a flowing veil with streaks in it rather than hairlines painted on the ground
    float n3 = vnoise(vec3(dir * 5.0 + 3.0, r * 0.05 - uTime * 2.0));
    float ang = atan(dir.y, dir.x) + 0.05 * sin(r * 0.09 + n3 * 5.0);
    vec2 cs = vec2(cos(ang), sin(ang));
    float n1 = vnoise(vec3(cs * 9.0, r * 0.12 - uTime * 9.0));
    float n2 = vnoise(vec3(cs * 30.0 + 7.0, r * 0.35 - uTime * 23.0));
    float n4 = vnoise(vec3(q * 0.07 + 11.0, r * 0.06 - uTime * 5.0));
    float streak = (0.5 + 0.65 * smoothstep(0.25, 0.85, n1)) * (0.75 + 0.25 * n2) * (0.55 + 0.6 * n3) * (0.6 + 0.8 * n4);
    // where the rays converge they merge into one turbulent veil (no hard vanishing point)
    streak = mix(0.75 * (0.6 + 0.8 * n4), streak, smoothstep(3.0, 14.0, r));
    // more dust downwind of a tilted plume
    float aniso = 1.0 + 1.6 * dot(dir, vec2(dot(uTilt, uE1), dot(uTilt, uE2)));
    // radial profile: scoured centre, dense ring, long thin tail, and a thick diffuse veil near the
    // impingement point that hides most of the surface below ~10 m (Apollo 11/12/15 film)
    float reach = uReach * max(0.3, aniso);
    float outer = 1.0 - smoothstep(0.75 * ${SHEET_R.toFixed(1)}, ${SHEET_R.toFixed(1)}, r);
    float prof = smoothstep(1.0, 6.0, r) * exp(-r / reach) * outer;
    float veil = 0.75 * smoothstep(0.3, 2.5, r) * exp(-r / (0.6 * reach)) * (0.7 + 0.6 * n4) * outer;
    float a = clamp(uIntensity * (prof * streak + veil) * max(aniso, 0.0) * 1.1, 0.0, 0.82);
    if (a < 0.002) discard;
    // single scattering of sunlight by the grains (fine regolith is strongly forward scattering)
    vec3 toEye = normalize(-vWorld);
    float c = dot(-uSunDir, toEye);
    float g = 0.55;
    float hg = (1.0 - g * g) / pow(1.0 + g * g - 2.0 * g * c, 1.5);
    float gb = -0.25;
    float hb = (1.0 - gb * gb) / pow(1.0 + gb * gb - 2.0 * gb * c, 1.5);
    float phase = 0.65 * hg + 0.35 * hb;
    float lit = 1.0;
    #ifdef USE_VSHADOW
      lit = mix(0.15, 1.0, vesselShadow(vWorld));
    #endif
    vec3 L = uSunI / (4.0 * PI) * ${DUST_ALBEDO.toFixed(3)} * phase * lit * uDustColor;
    gl_FragColor = vec4(L * a, a);
  }
`;

/**
 * @param {object} ctx RenderContext
 * @returns {{group: THREE.Group, update(frame, t, dt): void}}
 */
export function createSurfaceEffects(ctx) {
  const group = new THREE.Group();
  group.name = 'surface-fx';
  const low = ctx.quality === 'low';
  const game = ctx.game;

  // ------------------------------------------------------------------ dust sheet
  const nV = 1 + RINGS * SPOKES;
  const sheetPos = new Float32Array(nV * 3);
  const idx = [];
  for (let s = 0; s < SPOKES; s++) idx.push(0, 1 + s, 1 + ((s + 1) % SPOKES));
  for (let rI = 0; rI < RINGS - 1; rI++) {
    for (let s = 0; s < SPOKES; s++) {
      const a = 1 + rI * SPOKES + s;
      const b = 1 + rI * SPOKES + ((s + 1) % SPOKES);
      const c = a + SPOKES;
      const d = b + SPOKES;
      idx.push(a, c, d, a, d, b);
    }
  }
  const sheetGeo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(sheetPos, 3);
  sheetGeo.setAttribute('position', posAttr);
  sheetGeo.setIndex(idx);
  sheetGeo.boundingSphere = new THREE.Sphere(new THREE.Vector3(), SHEET_R * 2);
  const vs = ctx.vesselShadow;
  const sheetMat = new THREE.ShaderMaterial({
    vertexShader: sheetVert,
    fragmentShader: sheetFrag.replace('${VSHADOW}', vs ? vs.glsl : ''),
    defines: vs ? { USE_VSHADOW: '' } : {},
    uniforms: {
      uCenter: { value: new THREE.Vector3() },
      uE1: { value: new THREE.Vector3(1, 0, 0) },
      uE2: { value: new THREE.Vector3(0, 1, 0) },
      uTilt: { value: new THREE.Vector3() },
      uTime: { value: 0 },
      uIntensity: { value: 0 },
      uReach: { value: 30 },
      uSunDir: { value: ctx.sunDir.clone() },
      uSunI: { value: SUN.intensity },
      uDustColor: { value: new THREE.Color(1.0, 0.95, 0.88) },
      ...(vs ? vs.uniforms : {}),
    },
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const sheet = new THREE.Mesh(sheetGeo, sheetMat);
  sheet.frustumCulled = false;
  sheet.layers.set(ctx.LAYERS.FX);
  sheet.renderOrder = 5;
  sheet.visible = false;
  group.add(sheet);

  // sheet anchor (MCI) and time-sliced height sampling
  const anchor = new THREE.Vector3();
  let anchorValid = false;
  const build = { active: false, inPlace: false, i: 0, anchor: new THREE.Vector3(), up: new THREE.Vector3(), e1: new THREE.Vector3(), e2: new THREE.Vector3(), h0: 0, data: new Float32Array(nV * 3) };
  const _d = new THREE.Vector3();
  const ringR = new Float32Array(RINGS);
  for (let i = 0; i < RINGS; i++) ringR[i] = 0.35 * Math.pow(SHEET_R / 0.35, i / (RINGS - 1));

  function vertexDir(B, i, out) {
    let r = 0;
    let a = 0;
    if (i > 0) {
      r = ringR[Math.floor((i - 1) / SPOKES)];
      a = (((i - 1) % SPOKES) / SPOKES) * Math.PI * 2;
    }
    out.copy(B.anchor).addScaledVector(B.e1, r * Math.cos(a)).addScaledVector(B.e2, r * Math.sin(a)).normalize();
    return r;
  }
  function writeVertex(B, i, h, target) {
    const r = vertexDir(B, i, _d);
    // a hair above the ground, rising ~1.2 deg with distance (grains leave at low elevation)
    const lift = 0.12 + r * 0.021;
    _d.multiplyScalar(MOON.radius + h + lift).sub(B.anchor);
    target[i * 3] = _d.x;
    target[i * 3 + 1] = _d.y;
    target[i * 3 + 2] = _d.z;
  }
  function startBuild(pointMCI) {
    build.active = true;
    build.i = 0;
    build.anchor.copy(pointMCI);
    build.up.copy(pointMCI).normalize();
    build.e1.set(-build.up.y, build.up.x, 0).normalize();
    if (build.e1.lengthSq() < 0.5) build.e1.set(1, 0, 0);
    build.e2.crossVectors(build.up, build.e1);
    build.h0 = terrainHeight(build.up.x, build.up.y, build.up.z);
    build.inPlace = !anchorValid;
    if (build.inPlace) {
      // first sheet: publish a flat sheet at once, then refine the heights in place
      for (let i = 0; i < nV; i++) writeVertex(build, i, build.h0, sheetPos);
      posAttr.needsUpdate = true;
      anchor.copy(build.anchor);
      anchorValid = true;
      sheetMat.uniforms.uE1.value.copy(build.e1);
      sheetMat.uniforms.uE2.value.copy(build.e2);
    }
  }
  function stepBuild(budgetMs) {
    const t0 = performance.now();
    const B = build;
    const target = B.inPlace ? sheetPos : B.data;
    while (B.i < nV && performance.now() - t0 < budgetMs) {
      for (let k = 0; k < 16 && B.i < nV; k++, B.i++) {
        vertexDir(B, B.i, _d);
        writeVertex(B, B.i, terrainHeight(_d.x, _d.y, _d.z), target);
      }
    }
    if (B.inPlace) posAttr.needsUpdate = true;
    if (B.i >= nV) {
      B.active = false;
      if (!B.inPlace) {
        sheetPos.set(B.data);
        posAttr.needsUpdate = true;
        anchor.copy(B.anchor);
        sheetMat.uniforms.uE1.value.copy(B.e1);
        sheetMat.uniforms.uE2.value.copy(B.e2);
      }
      anchorValid = true;
    }
  }

  // ------------------------------------------------------------------ particle pools (world-anchored)
  const streaks = new ParticlePool(ctx, { capacity: low ? 3000 : 9000, style: 'streak', vesselShadow: true, shutter: 1 / 40, fadeIn: 0.04, name: 'dust-streaks' });
  const puffs = new ParticlePool(ctx, { capacity: low ? 1200 : 2500, style: 'puff', vesselShadow: true, fadeIn: 0.05, name: 'dust-puffs' });
  const glints = new ParticlePool(ctx, { capacity: low ? 500 : 1100, style: 'glint', fadeIn: 0.0, name: 'debris' });
  const flashes = new ParticlePool(ctx, { capacity: 200, style: 'puff', additive: true, fadeIn: 0.02, name: 'blast' });
  const pools = [streaks, puffs, glints, flashes];
  for (const p of pools) group.add(p.mesh);
  const poolAnchor = new THREE.Vector3();
  let poolAnchorValid = false;
  const poolUp = new THREE.Vector3();

  function ensurePoolAnchor(pointMCI) {
    const busy = pools.some((p) => p.active);
    if (!poolAnchorValid || (!busy && poolAnchor.distanceTo(pointMCI) > 50) || poolAnchor.distanceTo(pointMCI) > 3000) {
      if (busy) pools.forEach((p) => p.clear());
      poolAnchor.copy(pointMCI);
      poolAnchorValid = true;
      poolUp.copy(pointMCI).normalize();
      for (const p of [streaks, puffs, glints]) p.uniforms.uGravity.value.copy(poolUp).multiplyScalar(-G_MOON);
      flashes.uniforms.uGravity.value.set(0, 0, 0);
    }
  }

  // ------------------------------------------------------------------ helpers
  const _v = new THREE.Vector3();
  const _w = new THREE.Vector3();
  const _p = new THREE.Vector3();
  const _nozzle = new THREE.Vector3();
  const _exh = new THREE.Vector3();
  const _up = new THREE.Vector3();
  const _imp = new THREE.Vector3();
  const _e1 = new THREE.Vector3();
  const _e2 = new THREE.Vector3();
  const _toCam = new THREE.Vector3();

  function groundHeightAt(p) {
    _d.copy(p).normalize();
    return terrainHeight(_d.x, _d.y, _d.z);
  }
  /** Dust grain radiance (per unit opacity) as seen from the camera at MCI point p. */
  function dustRadiance(p, frame, out) {
    _toCam.copy(frame.cameraMCI).sub(p).normalize();
    const c = -frame.sunDir.dot(_toCam);
    const g = 0.55;
    const hg = (1 - g * g) / Math.pow(1 + g * g - 2 * g * c, 1.5);
    const gb = -0.25;
    const hb = (1 - gb * gb) / Math.pow(1 + gb * gb - 2 * gb * c, 1.5);
    const L = (SUN.intensity / (4 * Math.PI)) * DUST_ALBEDO * (0.65 * hg + 0.35 * hb);
    return out.set(L * 1.0, L * 0.95, L * 0.88);
  }
  const _col = new THREE.Vector3();

  // ------------------------------------------------------------------ one-shot events
  let pendingTouchdown = false;
  let pendingCrash = null;
  let debrisDone = false;
  game.events.on('touchdown', (e) => {
    if (!e || e.vessel === 'LM') pendingTouchdown = true;
  });
  game.events.on('crash', (e) => {
    if (!e || e.vessel === 'LM' || e.vessel === 'CSM') pendingCrash = e?.vessel || 'LM';
  });
  game.events.on('scenario', () => {
    pools.forEach((p) => p.clear());
    poolAnchorValid = false;
    anchorValid = false;
    build.active = false;
    debrisDone = false;
    dustLevel = 0;
  });

  function touchdownPuff(lm, frame) {
    ensurePoolAnchor(lm.pos);
    dustRadiance(lm.pos, frame, _col);
    const up = _up.copy(lm.pos).normalize();
    for (const pad of lm.gear.pads) {
      _p.copy(pad.pos).applyQuaternion(lm.quat).add(lm.pos);
      const h = groundHeightAt(_p);
      _p.normalize().multiplyScalar(MOON.radius + h + 0.05);
      for (let i = 0; i < (low ? 25 : 55); i++) {
        const a = Math.random() * Math.PI * 2;
        _e1.set(-up.y, up.x, 0).normalize();
        _e2.crossVectors(up, _e1);
        const sp = 0.4 + Math.random() * 2.2;
        _v.copy(_e1).multiplyScalar(Math.cos(a) * sp).addScaledVector(_e2, Math.sin(a) * sp).addScaledVector(up, 0.3 + Math.random() * 1.6);
        _w.copy(_p).sub(poolAnchor).addScaledVector(_e1, Math.cos(a) * 0.4).addScaledVector(_e2, Math.sin(a) * 0.4);
        puffs.emit(_w, _v, 1.2 + Math.random() * 1.6, 0.06, 0.3 + Math.random() * 0.25, _col.x, _col.y, _col.z, 0.18);
      }
    }
  }

  function crashBurst(v, frame) {
    ensurePoolAnchor(v.pos);
    dustRadiance(v.pos, frame, _col);
    const up = _up.copy(v.pos).normalize();
    _p.copy(v.pos).addScaledVector(up, 1.5).sub(poolAnchor);
    for (let i = 0; i < (low ? 250 : 600); i++) {
      _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(2 + Math.random() * 14);
      _v.addScaledVector(up, Math.abs(_v.dot(up)) * 0.5 + 2);
      puffs.emit(_p, _v, 2 + Math.random() * 4, 0.2, 1.2 + Math.random(), _col.x, _col.y, _col.z, 0.35);
    }
    for (let i = 0; i < (low ? 150 : 400); i++) {
      _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(3 + Math.random() * 20);
      _v.addScaledVector(up, 4 + Math.random() * 6);
      const life = ballisticLife(_v.dot(up), 1.5);
      const k = Math.random();
      const c = k < 0.45 ? [1.0, 0.7, 0.32] : k < 0.8 ? [0.92, 0.92, 0.95] : [0.2, 0.17, 0.14];
      glints.emit(_p, _v, life, 0.03, 0.03 + Math.random() * 0.05, c[0], c[1], c[2], 1, Math.random(), 4 + Math.random() * 30);
    }
    for (let i = 0; i < 40; i++) {
      _v.set(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).multiplyScalar(6);
      flashes.emit(_p, _v, 0.15 + Math.random() * 0.2, 0.5, 3.0, 0.8, 0.5, 0.22, 1, Math.random(), 0, 3);
    }
  }

  function ballisticLife(vUp, h0) {
    return Math.min(20, (vUp + Math.sqrt(Math.max(0, vUp * vUp + 2 * G_MOON * h0))) / G_MOON);
  }

  /** Ascent-stage liftoff: blast on the descent-stage deck + foil fragments. */
  function liftoffDebris(lm, frame) {
    const ds = lm.descentStage;
    if (!ds) return;
    ensurePoolAnchor(ds.pos);
    const up = _up.set(0, 1, 0).applyQuaternion(ds.quat);
    _e1.set(1, 0, 0).applyQuaternion(ds.quat);
    _e2.set(0, 0, 1).applyQuaternion(ds.quat);
    const deckY = LM.descentStage.yTop;
    const count = low ? 280 : 700;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const rr = Math.sqrt(Math.random()) * 2.0;
      _p.copy(ds.pos).addScaledVector(up, deckY + 0.05 + Math.random() * 0.25).addScaledVector(_e1, Math.cos(a) * rr).addScaledVector(_e2, Math.sin(a) * rr);
      const hG = _p.length() - (MOON.radius + groundHeightAt(_p));
      _p.sub(poolAnchor);
      const outS = 2 + Math.random() * 11;
      const upS = 3 + Math.random() * 16;
      _v.copy(_e1).multiplyScalar(Math.cos(a) * outS).addScaledVector(_e2, Math.sin(a) * outS).addScaledVector(up, upS);
      const life = ballisticLife(upS, Math.max(0.2, hG));
      const k = Math.random();
      const c = k < 0.55 ? [1.0, 0.68, 0.3] : k < 0.85 ? [0.95, 0.95, 0.97] : [0.18, 0.15, 0.12];
      glints.emit(_p, _v, life, 0.025, 0.02 + Math.random() * 0.06, c[0], c[1], c[2], 1, Math.random(), 3 + Math.random() * 25);
    }
    // blast: the APS exhaust hits the deck — a short orange-white flash and grey debris dust
    dustRadiance(ds.pos, frame, _col);
    _p.copy(ds.pos).addScaledVector(up, deckY + 0.3).sub(poolAnchor);
    for (let i = 0; i < 60; i++) {
      const a = Math.random() * Math.PI * 2;
      _v.copy(_e1).multiplyScalar(Math.cos(a) * 10).addScaledVector(_e2, Math.sin(a) * 10).addScaledVector(up, Math.random() * 4);
      flashes.emit(_p, _v, 0.1 + Math.random() * 0.12, 0.3, 1.6, 0.5, 0.32, 0.16, 1, Math.random(), 0, 4);
    }
    // a little regolith kicked off the deck and the ground next to it (fast, low, fine)
    for (let i = 0; i < (low ? 60 : 140); i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 6 + Math.random() * 20;
      _v.copy(_e1).multiplyScalar(Math.cos(a) * sp).addScaledVector(_e2, Math.sin(a) * sp).addScaledVector(up, Math.random() * 2.5);
      puffs.emit(_p, _v, 0.5 + Math.random() * 0.8, 0.05, 0.3, _col.x, _col.y, _col.z, 0.07);
    }
  }

  // ------------------------------------------------------------------ per-frame
  let dustLevel = 0;
  let emitAcc = 0;

  return {
    group,
    pools: { streaks, puffs, glints, flashes },
    sheet,
    /** Internal state for tests/debugging. */
    debugState: () => ({ building: build.active, built: build.i, anchorValid, dustLevel }),
    /**
     * @param {object} frame
     * @param {number} t fx clock
     * @param {number} dt fx step (0 when paused)
     * @param {number} [gain] exposure-dependent gain for self-luminous effects (see effects.js)
     */
    update(frame, t, dt, gain = 1) {
      const lm = frame.vessels.LM;
      // --- liftoff debris (once per staging, when the APS lights near the descent stage)
      const e = lm.mainEngine;
      const firing = !!(e && e.firing && e.throttle > 1e-3);
      if (lm.staged && lm.descentStage && !debrisDone && firing && lm.pos.distanceTo(lm.descentStage.pos) < 25) {
        debrisDone = true;
        liftoffDebris(lm, frame);
      }
      if (!lm.staged) debrisDone = false;
      if (pendingTouchdown) {
        pendingTouchdown = false;
        touchdownPuff(lm, frame);
      }
      if (pendingCrash) {
        const v = frame.vessels[pendingCrash] || lm;
        pendingCrash = null;
        if (v.tel && v.tel.altitude < 100) crashBurst(v, frame);
      }

      // --- descent-engine dust (DPS only; the APS plume is deflected by the descent stage)
      let target = 0;
      let hNoz = Infinity;
      if (firing && e.name === 'DPS' && !lm.crashed) {
        _nozzle.copy(e.nozzleExit).applyQuaternion(lm.quat).add(lm.pos);
        _up.copy(_nozzle).normalize();
        const hg = groundHeightAt(_nozzle);
        hNoz = _nozzle.length() - (MOON.radius + hg);
        if (hNoz < 55) {
          _exh.copy(e.thrustLine || e.thrustDir).negate().applyQuaternion(lm.quat).normalize();
          const down = -_exh.dot(_up);
          if (down > 0.25) {
            const dist = hNoz / down;
            _imp.copy(_nozzle).addScaledVector(_exh, dist);
            const hImp = groundHeightAt(_imp);
            _imp.normalize().multiplyScalar(MOON.radius + hImp);
            const thrN = Math.min(2, e.throttle / 0.3);
            const hf = THREE.MathUtils.smoothstep(hNoz, 3, 42);
            target = Math.min(1.6, thrN * (1 - hf) * (1 + 0.8 * (1 - THREE.MathUtils.smoothstep(hNoz, 1.5, 10))));
          }
        }
      }
      if (dt > 0) dustLevel += (target - dustLevel) * (1 - Math.exp(-dt / (target > dustLevel ? 0.25 : 0.12)));
      const U = sheetMat.uniforms;
      if (dustLevel > 0.01 && target > 0) {
        // (re)build the terrain-conforming sheet around the impingement point
        if (!anchorValid && !build.active) startBuild(_imp);
        else if (anchorValid && !build.active && anchor.distanceTo(_imp) > 18) startBuild(_imp);
        U.uCenter.value.copy(_imp).sub(anchor);
        // plume tilt (horizontal component of the exhaust direction) biases the flow
        const tilt = _v.copy(_exh).addScaledVector(_up, -_exh.dot(_up));
        U.uTilt.value.copy(tilt);
        // streak particles
        ensurePoolAnchor(_imp);
        dustRadiance(_imp, frame, _col);
        const rate = (low ? 2500 : 7000) * Math.min(1.5, dustLevel);
        emitAcc += rate * dt;
        _e1.set(-_up.y, _up.x, 0).normalize();
        _e2.crossVectors(_up, _e1);
        const th = tilt.length();
        const tx = th > 1e-4 ? tilt.dot(_e1) / th : 0;
        const ty = th > 1e-4 ? tilt.dot(_e2) / th : 0;
        let guard = 0;
        while (emitAcc >= 1 && guard++ < 2000) {
          emitAcc -= 1;
          let a = Math.random() * Math.PI * 2;
          // downwind bias for a tilted plume
          if (th > 0.02 && Math.random() < Math.min(0.6, th * 4)) a = Math.atan2(ty, tx) + (Math.random() - 0.5) * 1.6;
          const ca = Math.cos(a);
          const sa = Math.sin(a);
          const r0 = 0.6 + Math.random() * 2.5;
          const elev = (0.6 + Math.random() * 3.2) * (Math.PI / 180);
          const sp = 55 + Math.random() * 150;
          _p.copy(_imp).addScaledVector(_e1, ca * r0).addScaledVector(_e2, sa * r0).addScaledVector(_up, 0.08 + Math.random() * 0.15).sub(poolAnchor);
          _v.copy(_e1).multiplyScalar(ca * Math.cos(elev) * sp).addScaledVector(_e2, sa * Math.cos(elev) * sp).addScaledVector(_up, Math.sin(elev) * sp);
          const reach = 40 + 90 * Math.min(1, dustLevel);
          const life = Math.min(1.4, (reach * (0.4 + 0.6 * Math.random())) / sp);
          const w = 0.03 + Math.random() * 0.06;
          streaks.emit(_p, _v, life, w, w * 3.5, _col.x, _col.y, _col.z, 0.22 + 0.2 * Math.random());
        }
      } else emitAcc = 0;
      if (build.active) stepBuild(build.inPlace ? 2.5 : 1.5);
      U.uIntensity.value = anchorValid ? dustLevel : 0;
      U.uReach.value = 8 + 16 * Math.min(1.5, dustLevel);
      U.uTime.value = t;
      U.uSunDir.value.copy(frame.sunDir);
      sheet.visible = anchorValid && dustLevel > 0.01;
      if (anchorValid) sheet.position.copy(anchor).sub(frame.origin);

      // --- pools
      if (poolAnchorValid) {
        const pos = _w.copy(poolAnchor).sub(frame.origin);
        for (const p of pools) p.mesh.position.copy(pos);
        glints.uniforms.uSunLocal.value.copy(frame.sunDir);
        glints.uniforms.uIntensity.value = 1.0;
        flashes.uniforms.uIntensity.value = gain;
      }
      for (const p of pools) p.update(t);
    },
  };
}
