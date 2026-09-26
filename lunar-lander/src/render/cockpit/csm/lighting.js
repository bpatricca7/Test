// Command Module cabin lighting (CSM-CABIN agent).
//
// Light inside the real CM comes from:
//   1. direct sunlight through the five windows — the renderer's ctx.sunLight (shadow box centred
//      on the eye in IVA) occluded by the closed shell, so the sun patches are crisp and exactly
//      shaped by the window pockets;
//   2. the sunlit Moon seen through the windows — one RectAreaLight in each side window and in the
//      hatch window (the three big ones), scaled by how much sunlit ground the window sees
//      (altitude, attitude, Sun elevation at the ground below); the rendezvous windows feed the
//      ambient term only;
//   3. inter-reflection from sun patches and the grey interior — the cabin's own interior
//      environment map (kit createCabinEnvironment, in cabin coordinates, rotated with the vessel)
//      whose intensity follows the light entering the cabin;
//   4. the floodlights (under the MDC wings, LEB) — dimmable PointLights, no shadows;
//   5. panel integral lighting (legend glow) and the indicator lamps / displays.
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import * as KIT from '../kit/index.js';
import { MOON, SUN, LAYERS } from '../../../core/constants.js';
import { windowFrames } from './layout.js';

const KIT_REFLECTIVE = ['chrome', 'satinMetal', 'darkMetal', 'aluminium', 'blackGloss', 'glass'];
const _up = new THREE.Vector3();
const _n = new THREE.Vector3();
const _sunB = new THREE.Vector3();
const _qi = new THREE.Quaternion();
let rectInit = false;

/**
 * @param {object} ctx RenderContext
 * @param {THREE.Group} root cabin root (lights are parented to it: body frame)
 * @param {{floods: Array<{position: THREE.Vector3, lens: THREE.Mesh}>}} o
 */
export function createCabinLighting(ctx, root, o) {
  if (!rectInit) {
    RectAreaLightUniformsLib.init();
    rectInit = true;
  }
  const lights = new THREE.Group();
  lights.name = 'CSMCabin:lights';
  root.add(lights);

  // ---- floods
  const floods = o.floods.map((f, i) => {
    const l = new THREE.PointLight(0xffeedd, 0.5, 3.2, 2);
    l.position.copy(f.position);
    l.castShadow = false;
    lights.add(l);
    return { light: l, lens: f.lens, base: i === 2 ? 0.35 : 0.5 };
  });

  // ---- window lights (lunar surface glow)
  const W = windowFrames();
  const windows = [];
  for (const id of Object.keys(W)) {
    const f = W[id];
    const w = { id, n: f.z.clone(), area: f.round ? Math.PI * (f.w / 2) ** 2 : f.w * f.h, light: null };
    if (id === 'sideLeft' || id === 'sideRight' || id === 'hatch') {
      const rl = new THREE.RectAreaLight(0xfff4e6, 0, f.w * 1.3, f.h * 1.3);
      // inside the cabin end of the pocket, facing into the cabin (RectAreaLight emits along -Z)
      rl.position.copy(f.origin).addScaledVector(f.z, -0.2);
      rl.lookAt(f.origin.clone().addScaledVector(f.z, -1));
      lights.add(rl);
      w.light = rl;
    }
    windows.push(w);
  }

  // ---- interior environment (cabin coordinates)
  const env = KIT.createCabinEnvironment(ctx.renderer, {
    panel: 0.3,
    windows: windows.map((w) => ({ dir: w.n.clone(), size: w.id.startsWith('side') || w.id === 'hatch' ? 0.9 : 0.6, radiance: 0.9 })),
  });

  lights.traverse((x) => x.layers.set(LAYERS.CABIN));
  for (const x of lights.children) x.layers.enableAll();

  const envMats = new Map();
  function collectMaterials() {
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      const list = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of list) {
        if (!m || !m.isMeshStandardMaterial || envMats.has(m)) continue;
        if (m.envMap && m.envMap !== env) continue;
        if (KIT_REFLECTIVE.some((nm) => KIT.getMaterial(nm) === m)) continue;
        m.envMap = env;
        m.needsUpdate = true;
        envMats.set(m, m.userData.envScale ?? (m.envMapIntensity || 1));
      }
    });
    for (const nm of KIT_REFLECTIVE) envMats.set(KIT.getMaterial(nm), nm === 'glass' ? 0.8 : 1);
  }

  const state = { envK: 0.5, sunIn: 0, groundIn: 0 };
  let integralSet = -1;
  return {
    env,
    state,
    collectMaterials,
    activate() {
      KIT.setCabinEnvironment(env, { intensity: 1, glassIntensity: 0.8 });
      integralSet = -1;
    },
    /**
     * @param {object} frame FrameContext
     * @param {object} v CSM vessel
     * @param {{flood: number, integral: number}} settings levels 0..1
     */
    update(frame, v, settings = {}) {
      if (KIT.getMaterial('chrome').envMap !== env) KIT.setCabinEnvironment(env, { intensity: 1, glassIntensity: 0.8 });
      _qi.copy(v.quat).invert();
      _sunB.copy(frame.sunDir).applyQuaternion(_qi);
      _up.copy(v.pos).normalize();
      const r = v.pos.length();
      // Sun hidden behind the Moon? (cylindrical shadow approximation)
      const along = v.pos.dot(frame.sunDir);
      const perp = Math.sqrt(Math.max(0, r * r - along * along));
      const eclipsed = along < 0 && perp < MOON.radius;
      const sunElev = Math.max(0, frame.sunDir.dot(_up));
      const moonAng = Math.asin(Math.min(1, MOON.radius / Math.max(r, MOON.radius + 1)));
      const groundL = (0.12 * SUN.intensity * sunElev) / Math.PI * 1.5;
      let sunIn = 0;
      let groundIn = 0;
      for (const w of windows) {
        _n.copy(w.n).applyQuaternion(v.quat);
        const down = -_n.dot(_up);
        const horizon = -Math.cos(moonAng);
        const see = THREE.MathUtils.clamp(((down - horizon) / (1 - horizon + 1e-6)) * 0.55 + 0.3 * Math.min(1, moonAng / 1.2), 0, 1);
        const L = groundL * see;
        if (w.light) w.light.intensity = L * 7;
        groundIn += L * w.area;
        if (!eclipsed) sunIn += Math.max(0, w.n.dot(_sunB)) * w.area;
      }
      state.sunIn = sunIn;
      state.groundIn = groundIn;
      state.eclipsed = eclipsed;
      const floodLevel = settings.flood ?? 0.6;
      const target = 0.14 + 2.0 * sunIn + 7 * groundIn + 0.3 * floodLevel;
      state.envK += (target - state.envK) * Math.min(1, (frame.dt || 0.016) * 3);
      for (const [m, base] of envMats) {
        m.envMapIntensity = base * state.envK;
        m.envMapRotation.setFromQuaternion(v.quat);
      }
      for (const f of floods) {
        f.light.intensity = f.base * floodLevel;
        f.lens.material.emissiveIntensity = 2.0 * floodLevel;
      }
      const integ = settings.integral ?? 0.3;
      if (Math.abs(integ - integralSet) > 1e-3) {
        KIT.setIntegralLighting(integ);
        integralSet = integ;
      }
    },
  };
}
