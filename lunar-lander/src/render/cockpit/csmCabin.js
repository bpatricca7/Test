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
import { createCabinLighting } from './csm/lighting.js';
import { createSystems, updateSystems } from './csm/systems.js';

/**
 * Create the Command Module crew compartment.
 * @param {object} ctx RenderContext (uses ctx.renderer for the interior environment map)
 * @returns {{root: THREE.Group, update(frame: object, vessel: object): void, setActive(on: boolean): void,
 *   parts: object, systems: object, stats(): {triangles: number, meshes: number, drawables: number}}}
 */
export function createCSMCabin(ctx) {
  const root = new THREE.Group();
  root.name = 'CSMCabin';
  root.visible = false;

  const M = createCabinMaterials();
  const mat = (k) => (k === 'glass' ? KIT.getMaterial('glass') : M.get(k));
  const sys = createSystems();
  const sysFn = () => sys;

  const shell = buildShell(mat);
  const mdc = buildMDC(mat, { systems: sysFn });
  const side = buildSidePanels(mat);
  const leb = buildLEB(mat, { systems: sysFn });
  const couches = buildCouches(mat);
  const controllers = buildControllers(mat);
  const stowage = buildStowage(mat, M.atlas);
  const details = buildDetails(mat, shell);
  root.add(shell.group, mdc.group, side.group, leb.group, couches.group, controllers.group, stowage.group, details.group);
  M.atlas.commit();

  // everything on the cabin layer; shadows for opaque geometry
  KIT.setLayerRecursive(root, LAYERS.CABIN);
  root.traverse((o) => {
    if (!o.isMesh || o.userData.shadowOnly) return;
    const m = o.material;
    const transparent = m && (m.transparent || m.blending === THREE.AdditiveBlending);
    if (!transparent && !m?.userData?.noShadow) {
      o.castShadow = true;
      o.receiveShadow = true;
    } else {
      o.castShadow = false;
    }
  });
  // thin single-surface shell: cast from both faces so no light leaks at grazing angles
  M.get('wall').shadowSide = THREE.DoubleSide;

  const lighting = createCabinLighting(ctx, root, { floods: details.floods });
  lighting.collectMaterials();

  const instruments = [...mdc.instruments, ...leb.instruments];
  const controls = new Map([...mdc.controls, ...side.controls, ...leb.controls]);

  // ---- switches / talkbacks that follow the vehicle state
  const last = new Map();
  const setSw = (id, st) => {
    if (last.get(id) === st) return;
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
    parts: { shell, mdc, side, leb, couches, controllers, stowage, details, lighting, materials: M, controls },
    setActive(on) {
      on = !!on;
      if (on && !active) lighting.activate();
      active = on;
      root.visible = on;
    },
    update(frame, v) {
      if (!root.visible || !v) return;
      root.position.copy(v.pos).sub(frame.origin);
      root.quaternion.copy(v.quat);
      root.updateMatrixWorld(true);
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
