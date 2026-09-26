// Apollo 11 Lunar Module "Eagle" crew compartment (LM-CABIN agent).
//
// Contract (ARCHITECTURE.md §6): createLMCabin(ctx) -> { root, update(frame, vessel), setActive(on) }
//
//   root        THREE.Group in the LM body frame (+Y up, -Z forward/windows, +X right, metres; origin at
//               the footpad plane like the exterior model). Every mesh is on LAYERS.CABIN. The cabin is
//               a closed shadow caster whose only openings are the two triangular windows and the
//               overhead docking window, so ctx.sunLight (shadow box centred on the eye in IVA) throws
//               crisp sun patches onto the panels exactly where the real sunlight would fall.
//   update()    floating origin (root.position = vessel.pos - origin, root.quaternion = vessel.quat),
//               live instruments (FDAIs, tapes, X-pointers, timers, C&W, MASTER ALARM, LUNAR CONTACT,
//               DSKY, DEDA, meters), switches that follow the vehicle state (ENG ARM, THR CONT,
//               ATTITUDE CONTROL, MODE CONT, ABORT STAGE), the hand controllers (ACA / TTCA follow
//               vessel.ctrl), window bounce lights, floods and the interior environment.
//   setActive() visibility (only rendered in IVA of the LM).
//
// Build: lm/shell.js (structure), lm/panels.js (panels & instruments), lm/controls.js (ACA/TTCA),
// lm/details.js (fittings), lm/lpdReticle.js (LPD on the CDR window), lm/lighting.js.
import * as THREE from 'three';
import { LAYERS } from '../../core/constants.js';
import * as KIT from './kit/index.js';
import { createCabinMaterials } from './lm/materials.js';
import { buildShell } from './lm/shell.js';
import { buildPanels } from './lm/panels.js';
import { buildControllers } from './lm/controls.js';
import { buildDetails } from './lm/details.js';
import { buildLPDReticle } from './lm/lpdReticle.js';
import { createCabinLighting } from './lm/lighting.js';
import { lowPolyKitHardware } from './lm/lod.js';
import { createLightField } from './lm/lightfield.js';

/**
 * Create the LM crew compartment.
 * @param {object} ctx RenderContext (uses ctx.renderer for the interior environment map)
 * @returns {{root: THREE.Group, update(frame: object, vessel: object): void, setActive(on: boolean): void,
 *   parts: object, stats(): {triangles: number, meshes: number, drawables: number}}}
 */
export function createLMCabin(ctx) {
  const root = new THREE.Group();
  root.name = 'LMCabin';
  root.visible = false;

  const M = createCabinMaterials();
  const mat = (k) => M.get(k);
  const shell = buildShell(mat);
  const panels = buildPanels();
  const lod = lowPolyKitHardware(panels.group); // ~240 breakers + ~180 toggles: cabin-distance LOD
  const controllers = buildControllers(mat);
  const details = buildDetails(mat);
  const lpd = buildLPDReticle(mat);
  root.add(shell.group, panels.group, controllers.group, details.group, lpd.group);

  // everything on the cabin layer; shadows on for opaque geometry
  KIT.setLayerRecursive(root, LAYERS.CABIN);
  // tiny parts (instrument internals, lamp lenses, screws...) do not cast: they cannot throw a
  // visible shadow but would double the shadow pass draw calls
  root.updateMatrixWorld(true);
  const _s = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    const transparent = m && (m.transparent || m.blending === THREE.AdditiveBlending);
    o.receiveShadow = !transparent;
    if (transparent || m?.userData?.noShadow) {
      o.castShadow = false;
      return;
    }
    if (!o.geometry.boundingSphere) o.geometry.computeBoundingSphere();
    o.getWorldScale(_s);
    const r = o.geometry.boundingSphere.radius * Math.max(_s.x, _s.y, _s.z);
    o.castShadow = o.isInstancedMesh || r > 0.012;
  });

  const lighting = createCabinLighting(ctx, root, { floods: details.floods, materials: M });
  lighting.collectMaterials();
  // shape the uniform indirect light (env + hemisphere fill) by position in the cabin
  const field = createLightField();
  root.traverse((o) => {
    if (!o.isMesh) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      if (m && !String(m.name).startsWith('kit:')) field.patch(m);
    }
  });

  // ---- dynamic switch / button state
  const C = panels.controls;
  const last = new Map();
  const setSw = (id, st) => {
    if (last.get(id) === st) return;
    const h = C.get(id);
    if (!h?.setState) return;
    h.setState(st);
    last.set(id, st);
  };
  const rotaryLevel = (id, levels) => {
    const r = C.get(id);
    return r && r.index != null ? levels[r.index] ?? 1 : 1;
  };
  let staged = null;

  function syncSwitches(v) {
    const g = v.gnc || {};
    const eng = v.mainEngine || {};
    setSw('engArm', eng.armed ? (v.staged ? 0 : 2) : 1);
    setSw('thrCont', g.throttleMode === 'AUTO' ? 0 : 1);
    const att = g.rcsMode === 'PULSE' ? 0 : g.rcsMode === 'DIRECT' ? 2 : 1;
    setSw('attRoll', att);
    setSw('attPitch', att);
    setSw('attYaw', att);
    setSw('guidCont', 0);
    setSw('modeContPGNS', g.autopilot === 'GUIDANCE' ? 0 : g.attHold !== false || (g.autopilot && g.autopilot !== 'OFF') ? 1 : 2);
    setSw('ldgAnt', v.landed ? 1 : 0);
    if (staged !== !!v.staged) {
      staged = !!v.staged;
      C.get('abortStageBtn')?.press?.(staged);
      C.get('tbStage')?.setState?.(staged ? 'barber' : 'grey');
      C.get('tbCrsfd')?.setState?.('barber');
    }
  }

  let active = false;
  let tSim = 0;
  const api = {
    root,
    parts: { shell, panels, controllers, details, lpd, lighting, materials: M, lod, field },
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
      field.update(root);
      const dt = frame.dt ?? 0.016;
      tSim += dt;
      const game = frame.game;
      for (const inst of panels.instruments) inst.update(v, game, dt);
      controllers.update(v, dt);
      syncSwitches(v);
      lighting.update(frame, v, {
        flood: rotaryLevel('flood', [0, 0.45, 1]),
        integral: rotaryLevel('integral', [0, 0.22, 0.5]),
      });
      // sunlight entering the cabin brightens the aft midsection by inter-reflection
      field.uniforms.uFieldAft.value = 0.45 + 0.4 * Math.min(1, lighting.state.sunIn * 4);
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
        const inst = o.isInstancedMesh ? o.count : 1;
        triangles += n * inst;
        drawables++;
      });
      return { triangles: Math.round(triangles), meshes, drawables };
    },
  };
  return api;
}
