// LM cabin lighting (LM-CABIN agent).
//
// Light in a real LM cabin comes from (1) direct sunlight through the three windows — here the
// renderer's ctx.sunLight with its tight IVA shadow box, occluded by the closed cabin shell, so the
// sun patches are crisp and exactly shaped by the window frames; (2) the brilliant lunar surface
// seen through the windows — one RectAreaLight per front window, scaled by how much sunlit ground
// the window sees (altitude, attitude, Sun elevation); (3) inter-reflection from the sun patches and
// the grey interior — the cabin's own interior environment map (PMREM of a grey room with bright
// window patches, in cabin coordinates and rotated with the vessel every frame) whose intensity
// follows the light entering the cabin; (4) the two overhead floodlights (dimmable, PointLights, no
// shadows) and (5) panel integral lighting (legend glow) and the indicator lamps.
import * as THREE from 'three';
import { RectAreaLightUniformsLib } from 'three/addons/lights/RectAreaLightUniformsLib.js';
import * as KIT from '../kit/index.js';
import { LM, MOON, SUN, LAYERS } from '../../../core/constants.js';
import { triNormal } from './layout.js';

const KIT_REFLECTIVE = ['chrome', 'satinMetal', 'darkMetal', 'aluminium', 'blackGloss', 'glass'];
const _up = new THREE.Vector3();
const _n = new THREE.Vector3();
const _sunB = new THREE.Vector3();
const _qi = new THREE.Quaternion();

let rectInit = false;

/**
 * @param {object} ctx RenderContext
 * @param {THREE.Group} root cabin root (lights are parented to it: body frame)
 * @param {object} o { floods: [{position, lens}], materials (cabin set) }
 */
export function createCabinLighting(ctx, root, o) {
  const THREE_ = THREE;
  if (!rectInit) {
    RectAreaLightUniformsLib.init();
    rectInit = true;
  }
  const lights = new THREE_.Group();
  lights.name = 'LMCabin:lights';
  root.add(lights);

  // ---- floods (overhead fixtures above each station)
  const floods = o.floods.map((f) => {
    const l = new THREE_.PointLight(0xfff0de, 0.45, f.aft ? 2.5 : 3.5, 2);
    l.position.copy(f.position);
    l.castShadow = false;
    lights.add(l);
    return { light: l, lens: f.lens, k: f.aft ? 0.3 : 1 };
  });

  // ---- window bounce lights (lunar surface glow through the two front windows)
  const windows = [];
  for (const tri of [LM.windows.cdr, LM.windows.lmp]) {
    const n = triNormal(tri);
    const c = tri[0].clone().add(tri[1]).add(tri[2]).divideScalar(3);
    const rl = new THREE_.RectAreaLight(0xfff4e6, 0, 0.5, 0.5);
    rl.position.copy(c).addScaledVector(n, -0.03);
    // face into the cabin (lights look along their -Z)
    rl.lookAt(c.clone().addScaledVector(n, -1));
    lights.add(rl);
    windows.push({ light: rl, n, area: 0.29 });
  }
  const over = LM.windows.overhead;
  const overWin = { n: over.normal.clone(), area: over.width * over.height };

  // ---- interior environment map (cabin coordinates; rotated with the vessel per frame)
  const env = KIT.createCabinEnvironment(ctx.renderer, {
    panel: 0.3,
    windows: [
      { dir: windows[0].n.clone(), size: 1.3, radiance: 1.0 },
      { dir: windows[1].n.clone(), size: 1.3, radiance: 1.0 },
      { dir: over.normal.clone(), size: 0.5, radiance: 0.5 },
    ],
  });

  lights.traverse((x) => x.layers.set(LAYERS.CABIN));
  for (const x of lights.children) x.layers.enableAll();

  // every PBR material in the cabin gets the interior env map (unless it already has one)
  const envMats = new Map(); // material -> base intensity
  function collectMaterials() {
    root.traverse((obj) => {
      if (!obj.isMesh) return;
      const list = Array.isArray(obj.material) ? obj.material : [obj.material];
      for (const m of list) {
        if (!m || !m.isMeshStandardMaterial || envMats.has(m)) continue;
        if (m.envMap && m.envMap !== env) continue;
        if (KIT_REFLECTIVE.some((nm) => KIT.getMaterial(nm) === m)) continue; // handled below
        m.envMap = env;
        m.needsUpdate = true;
        envMats.set(m, m.userData.envScale ?? (m.envMapIntensity || 1));
      }
    });
    for (const nm of KIT_REFLECTIVE) envMats.set(KIT.getMaterial(nm), nm === 'glass' ? 0.8 : 1);
  }

  const state = { envK: 0.6, floodLevel: 1, bounce: 0, sunIn: 0 };
  let integralSet = -1;

  return {
    env,
    state,
    collectMaterials,
    /** Called when the cabin becomes active: take over the kit's shared reflective materials. */
    activate() {
      KIT.setCabinEnvironment(env, { intensity: 1, glassIntensity: 0.8 });
      integralSet = -1;
    },
    /**
     * Per-frame update.
     * @param {object} frame FrameContext
     * @param {object} v LM vessel state
     * @param {{flood: number, integral: number}} settings 0..1 levels from the panel knobs
     */
    update(frame, v, settings) {
      // keep the kit's shared reflective materials on our env (another cabin may have changed them)
      const chrome = KIT.getMaterial('chrome');
      if (chrome.envMap !== env) KIT.setCabinEnvironment(env, { intensity: 1, glassIntensity: 0.8 });
      // Sun in body axes
      _qi.copy(v.quat).invert();
      _sunB.copy(frame.sunDir).applyQuaternion(_qi);
      _up.copy(v.pos).normalize();
      const r = v.pos.length();
      const alt = Math.max(0, r - MOON.radius);
      // Sun elevation at the sub-vessel point (the ground below is lit only if > 0)
      const sunElev = Math.max(0, frame.sunDir.dot(_up));
      // apparent angular radius of the Moon: fraction of a window's view filled by ground
      const moonAng = Math.asin(Math.min(1, MOON.radius / Math.max(r, MOON.radius + 1)));
      const groundL = 0.12 * SUN.intensity * sunElev / Math.PI * 1.6; // lunar radiance, opposition-boosted
      let sunIn = 0;
      let groundIn = 0;
      for (const w of windows) {
        _n.copy(w.n).applyQuaternion(v.quat);
        // how far below the local horizon the window looks (-1 up .. +1 straight down)
        const down = -_n.dot(_up);
        const horizon = -Math.cos(moonAng); // dip: ground visible where the look direction is below this
        const see = THREE.MathUtils.clamp((down - horizon) / (1 - horizon + 1e-6) * 0.5 + 0.35 * Math.min(1, moonAng / 1.2), 0, 1);
        const L = groundL * see;
        w.light.intensity = L * 5; // ground radiance through the glass, x ~5 for inter-reflection inside the cabin
        groundIn += L * w.area;
        sunIn += Math.max(0, w.n.dot(_sunB)) * w.area;
      }
      sunIn += Math.max(0, overWin.n.dot(_sunB)) * overWin.area;
      state.sunIn = sunIn;
      // interior bounce: sun patches + ground glow; dim floor level from the floods
      const floodLevel = settings?.flood ?? 1;
      const target = 0.08 + 2.0 * sunIn + 4 * groundIn + 0.1 * floodLevel;
      state.envK += (target - state.envK) * Math.min(1, (frame.dt || 0.016) * 3);
      for (const [m, base] of envMats) {
        m.envMapIntensity = base * state.envK;
        m.envMapRotation.setFromQuaternion(v.quat);
      }
      for (const f of floods) {
        f.light.intensity = 0.2 * f.k * floodLevel;
        f.lens.material.emissiveIntensity = 1.1 * floodLevel;
      }
      const integ = settings?.integral ?? 0.25;
      if (Math.abs(integ - integralSet) > 1e-3) {
        KIT.setIntegralLighting(integ);
        integralSet = integ;
      }
    },
  };
}
