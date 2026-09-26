// Apollo 11 Command Module "Columbia" crew compartment (CSM-CABIN agent).
//
// Contract (ARCHITECTURE.md §6): createCSMCabin(ctx) -> { root, update(frame, vessel), setActive(on) }
//
//   root        THREE.Group in the CSM body frame (-Z forward toward the apex/tunnel, +Y crew head-up
//               toward the side hatch, +X right; metres; origin at the CM/SM interface like the exterior
//               model). Every mesh is on LAYERS.CABIN. The pressure vessel is a closed shadow caster whose
//               only openings are the five windows (CSM.windows), so ctx.sunLight (shadow box centred on
//               the eye in IVA) throws crisp sun patches exactly where the real sunlight would fall.
//   update()    floating origin (root.position = vessel.pos - origin, root.quaternion = vessel.quat), live
//               instruments (2 FDAIs, 2 DSKYs, EMS, GPI, timers, C&W matrix, 3 MASTER ALARMs, SPS/RCS/ECS/
//               EPS meters driven by csm/systems.js), switches that follow the vehicle state (SC CONT,
//               CMC MODE, MAN ATT, ΔV THRUST, docking probe...), the CDR's hand controllers (RHC / THC
//               follow vessel.ctrl), window bounce lights, floods, the interior environment.
//   setActive() visibility (only rendered in IVA of the CSM).
//
// Build: csm/shell.js (pressure vessel, windows, bulkheads, tunnel, side hatch), csm/mdc.js (Main
// Display Console panels 1-3), csm/sidePanels.js (panels 5, 8, 15, 16), csm/leb.js (Lower Equipment
// Bay: G&N station, optics, DSKY 2), csm/couches.js, csm/controls.js (RHC/THC), csm/stowage.js
// (lockers), csm/details.js (hatches' mechanisms, floods, hoses, COAS, cameras, checklists),
// csm/dressing.js (pouches, cue cards, pencils on the walls), csm/optimize.js (triangle budget and the
// static merge: one draw per material for everything that never moves),
// csm/lighting.js, csm/systems.js (EPS/ECS/propulsion display model), csm/layout.js (geometry).
import * as THREE from 'three';
import { LAYERS } from '../../core/constants.js';
import * as KIT from './kit/index.js';
import { createCabinMaterials } from './csm/materials.js';
import { buildShell } from './csm/shell.js';
import { buildMDC } from './csm/mdc.js';
import { buildSidePanels } from './csm/sidePanels.js';
import { buildLEB } from './csm/leb.js';
import { buildCouches } from './csm/couches.js';
import { buildControllers } from './csm/controls.js';
import { buildStowage } from './csm/stowage.js';
import { buildDetails } from './csm/details.js';
import { buildDressing } from './csm/dressing.js';
import { createCabinLighting } from './csm/lighting.js';
import { createSystems, updateSystems } from './csm/systems.js';
import { optimizeCabin, updateLOD, mergeStatic } from './csm/optimize.js';

/**
 * Per-quality build settings: panel canvas resolution scale (texture memory ~ tex²) and the
 * smallest part (bounding-sphere radius, m) that still casts a sun shadow.
 */
export const CABIN_QUALITY = {
  low: { tex: 0.55, castMin: 0.02 },
  medium: { tex: 0.8, castMin: 0.0075 },
  high: { tex: 1, castMin: 0.0075 },
};

/**
 * Controls whose state this module changes after the build (syncSwitches). Everything else is
 * static and may be merged; add an id here before driving a new control.
 */
const DRIVEN = new Set([
  'manRoll', 'manPitch', 'manYaw', 'cmcMode', 'scCont', 'rate', 'dvThrustA', 'dvThrustB', 'gmblP1', 'gmblY1', 'gmblP2', 'gmblY2',
  'emsFunc', 'emsMode', 'probe1', 'probe2', 'tbProbe1', 'tbProbe2', 'lpIsol', 'lpIss', 'lpOpt', 'tbSpsHe1', 'tbSpsHe2',
]);

const _eye = new THREE.Vector3();
const _qInv = new THREE.Quaternion();

/**
 * Create the Command Module crew compartment.
 * @param {object} ctx RenderContext (uses ctx.renderer for the interior environment map, ctx.quality)
 * @param {{merge?: boolean}} [opts] merge=false keeps every part as its own mesh (debug / comparisons)
 * @returns {{root: THREE.Group, update(frame: object, vessel: object): void, setActive(on: boolean): void,
 *   parts: object, systems: object, stats(): {triangles: number, meshes: number, drawables: number}}}
 */
export function createCSMCabin(ctx, opts = {}) {
  const root = new THREE.Group();
  root.name = 'CSMCabin';
  root.visible = false;

  const Q = CABIN_QUALITY[ctx?.quality] || CABIN_QUALITY.high;
  const M = createCabinMaterials({ texScale: Q.tex });
  const mat = (k) => (k === 'glass' ? KIT.getMaterial('glass') : M.get(k));
  const sys = createSystems();
  const sysFn = () => sys;

  const shell = buildShell(mat);
  const mdc = buildMDC(mat, { systems: sysFn, texScale: Q.tex, coaming: M.coaming });
  const side = buildSidePanels(mat, { texScale: Q.tex });
  const leb = buildLEB(mat, { systems: sysFn, texScale: Q.tex });
  const couches = buildCouches(mat);
  const controllers = buildControllers(mat);
  const stowage = buildStowage(mat, M.atlas);
  const details = buildDetails(mat, shell);
  const dressing = buildDressing(mat);
  root.add(shell.group, mdc.group, side.group, leb.group, couches.group, controllers.group, stowage.group, details.group, dressing.group);
  M.atlas.commit();

  // resolution-matched copies of the kit's parametric hardware + near/far LOD for instanced banks
  const optimized = optimizeCabin(root);

  // everything on the cabin layer; shadows for opaque geometry
  KIT.setLayerRecursive(root, LAYERS.CABIN);
  root.traverse((o) => {
    if (!o.isMesh || o.userData.shadowOnly) return;
    const m = o.material;
    const transparent = m && (m.transparent || m.blending === THREE.AdditiveBlending);
    if (!transparent && !m?.userData?.noShadow) {
      // parts smaller than ~a shadow-map texel pair (switch nuts, washers, bushings, breaker
      // collars: < 7.5 mm) only receive: their shadows would be sub-texel noise, and skipping them
      // halves the triangles of the sunlight shadow pass (levers, guards and covers still cast)
      const g = o.geometry;
      if (!g.boundingSphere) g.computeBoundingSphere();
      o.castShadow = !(g.boundingSphere && g.boundingSphere.radius < Q.castMin);
      o.receiveShadow = true;
    } else {
      o.castShadow = false;
      // cover glass / combiners / window panes only ADD reflections (additive blending) — they
      // must still receive the cabin's shadow, or the Sun's specular glint shows on glass sitting
      // in the dark behind the closed hull (e.g. a white blob on the COAS with the Sun astern)
      if (transparent) o.receiveShadow = true;
    }
  });
  // instrument parts that do not stand proud of the panel face (cases, backplates, face plates, balls,
  // drums, needles lying on the dial under the glass) can only shadow what lies deeper in the same
  // recess, and the protruding bezel around that recess already casts the same shadow edge. Only the
  // proud parts (bezels, knobs, keys, guards) cast; everything keeps receiving.
  {
    const inv = new THREE.Matrix4();
    const rel = new THREE.Matrix4();
    const box = new THREE.Box3();
    root.updateMatrixWorld(true);
    for (const inst of [...mdc.instruments, ...leb.instruments]) {
      const obj = inst.object;
      if (!obj) continue;
      inv.copy(obj.matrixWorld).invert();
      obj.traverse((o) => {
        if (!o.isMesh || !o.castShadow || o.isInstancedMesh) return;
        const g = o.geometry;
        if (!g.boundingBox) g.computeBoundingBox();
        box.copy(g.boundingBox).applyMatrix4(rel.multiplyMatrices(inv, o.matrixWorld));
        if (box.max.z < 0.0008) o.castShadow = false;
      });
    }
  }
  // thin single-surface shell: cast from both faces so no light leaks at grazing angles
  M.get('wall').shadowSide = THREE.DoubleSide;

  // draw-call budget: bake everything that never moves into one mesh per material. Instruments,
  // the hand controllers and the controls this module drives (DRIVEN: switches, rotaries and
  // talkbacks that follow the vehicle state) stay live; nothing else is ever touched after the build.
  const dynamic = new Set([controllers.group]);
  for (const inst of [...mdc.instruments, ...leb.instruments]) if (inst.object && !inst.object.userData.mergeStatic) dynamic.add(inst.object);
  for (const map of [mdc.controls, side.controls, leb.controls]) {
    for (const [id, h] of map) {
      if (!DRIVEN.has(id)) continue;
      const obj = h?.isObject3D ? h : h?.object?.isObject3D ? h.object : null;
      if (obj) dynamic.add(obj);
    }
  }
  const merged = opts.merge === false ? null : mergeStatic(root, { dynamic });

  const lighting = createCabinLighting(ctx, root, { floods: details.floods });
  lighting.collectMaterials();

  const instruments = [...mdc.instruments, ...leb.instruments];
  const controls = new Map([...mdc.controls, ...side.controls, ...leb.controls]);

  // ---- switches / talkbacks that follow the vehicle state
  const last = new Map();
  const setSw = (id, st) => {
    if (last.get(id) === st) return;
    if (!DRIVEN.has(id) && !last.has('!' + id)) {
      last.set('!' + id, true);
      console.warn(`csm cabin: control '${id}' is driven but not listed in DRIVEN (it may have been merged)`);
    }
    const h = controls.get(id);
    if (!h) return;
    if (h.setState) h.setState(st);
    else if (h.setIndex) h.setIndex(st);
    last.set(id, st);
  };
  const setCover = (id, open) => {
    const k = id + ':cover';
    if (last.get(k) === open) return;
    controls.get(id)?.setCoverOpen?.(open);
    last.set(k, open);
  };
  const rotaryLevel = (id, levels) => {
    const r = controls.get(id);
    return r && r.index != null ? levels[r.index] ?? 1 : 1;
  };
  function syncSwitches(v) {
    const g = v.gnc || {};
    const eng = v.mainEngine || {};
    const man = g.rcsMode === 'PULSE' ? 2 : g.rcsMode === 'DIRECT' ? 0 : 1;
    setSw('manRoll', man);
    setSw('manPitch', man);
    setSw('manYaw', man);
    const auto = g.autopilot && g.autopilot !== 'OFF';
    setSw('cmcMode', auto ? 0 : g.attHold !== false ? 1 : 2);
    setSw('scCont', 0);
    setSw('rate', v.ctrl?.fine ? 1 : 0);
    const armed = !!eng.armed;
    setSw('dvThrustA', armed ? 0 : 1);
    setSw('dvThrustB', armed ? 0 : 1);
    setCover('dvThrustA', armed);
    setCover('dvThrustB', armed);
    for (const id of ['gmblP1', 'gmblY1', 'gmblP2', 'gmblY2']) setSw(id, armed ? 1 : 2);
    setSw('emsFunc', eng.firing ? 0 : 5);
    setSw('emsMode', eng.firing ? 1 : 2);
    setSw('probe1', v.docked ? 2 : 1);
    setSw('probe2', v.docked ? 2 : 1);
    const probeTb = v.docked ? 'grey' : 'barber';
    for (const id of ['tbProbe1', 'tbProbe2']) {
      if (last.get(id) !== probeTb) {
        controls.get(id)?.setState?.(probeTb);
        last.set(id, probeTb);
      }
    }
    // LEB G&N condition lamps (panel 122) repeat the computer / inertial-subsystem cautions
    const cwl = v.cw?.lights || {};
    const lamps = { lpIsol: !!(cwl.CMC || v.agc?.alarmCode), lpIss: !!cwl.ISS, lpOpt: false };
    for (const [id, on] of Object.entries(lamps)) {
      if (last.get(id) === on) continue;
      controls.get(id)?.setLit?.(on);
      last.set(id, on);
    }
    // SPS helium valves open (grey) while the engine is armed
    const heTb = armed ? 'grey' : 'barber';
    for (const id of ['tbSpsHe1', 'tbSpsHe2']) {
      if (last.get(id) !== heTb) {
        controls.get(id)?.setState?.(heTb);
        last.set(id, heTb);
      }
    }
  }

  let active = false;
  const api = {
    root,
    systems: sys,
    optimized,
    merged,
    quality: Q,
    parts: { shell, mdc, side, leb, couches, controllers, stowage, details, dressing, lighting, materials: M, controls },
    setActive(on) {
      on = !!on;
      if (on && !active) lighting.activate();
      if (!on && active) lighting.deactivate();
      active = on;
      root.visible = on;
    },
    update(frame, v) {
      if (!root.visible || !v) return;
      root.position.copy(v.pos).sub(frame.origin);
      root.quaternion.copy(v.quat);
      // (world matrices: main.js updates the scene graph once per frame after all modules)
      // eye in cabin coordinates -> distance LOD of the switch / breaker banks
      _qInv.copy(v.quat).invert();
      _eye.copy(frame.cameraMCI ?? frame.origin).sub(v.pos).applyQuaternion(_qInv);
      updateLOD(optimized.lods, _eye);
      const dt = frame.dt ?? 0.016;
      const game = frame.game;
      updateSystems(sys, v, game.time.met, dt);
      for (const inst of instruments) inst.update(v, game, dt);
      controllers.update(v, dt);
      syncSwitches(v);
      lighting.update(frame, v, {
        flood: rotaryLevel('flood', [0, 0.35, 0.65, 1]),
        integral: rotaryLevel('integral', [0, 0.18, 0.32, 0.5]),
      });
    },
    /** Triangle / draw statistics of the cabin (debug & tests). */
    stats() {
      let triangles = 0;
      let meshes = 0;
      let drawables = 0;
      root.traverse((o) => {
        if (!o.isMesh || !o.geometry) return;
        meshes++;
        const n = o.geometry.index ? o.geometry.index.count / 3 : o.geometry.attributes.position.count / 3;
        triangles += n * (o.isInstancedMesh ? o.count : 1);
        drawables++;
      });
      return { triangles: Math.round(triangles), meshes, drawables };
    },
  };
  return api;
}
